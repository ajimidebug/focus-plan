/* Explicit plans and execution timestamps; never infer activity from memo text. */
(function () {
  'use strict';
  const App = window.App = window.App || {}, S = () => App.store, M = () => App.memoCore;
  const $ = id => document.getElementById(id), esc = value => S().esc(String(value ?? ''));
  let selectedDay, mode = false, interval, view = 'combined', rangeHours = 6, keyword = '', showLegacy = true, showHidden = false;
  const clone = x => JSON.parse(JSON.stringify(x));
  function state() {
    const d = S().data();
    if (d.memoSchedule === undefined) d.memoSchedule = { version: 1, items: [], sessions: [] };
    const x = d.memoSchedule;
    if (!x || x.version !== 1 || !Array.isArray(x.items) || !Array.isArray(x.sessions)) throw new Error('时间线格式异常，请先下载完整备份');
    if (x.items.some(p => !p || typeof p.id !== 'string' || !M().validDate(p.day) || !Number.isFinite(p.start) || (p.type !== 'point' && p.type !== 'span') || (p.type === 'span' && (!Number.isFinite(p.end) || p.end <= p.start))) || x.sessions.some(s => !s || !Array.isArray(s.chunks) || !['running', 'paused', 'ended'].includes(s.status) || s.chunks.some(c => !Number.isFinite(c.start) || (c.end != null && (!Number.isFinite(c.end) || c.end < c.start))))) throw new Error('时间线记录异常，请先下载完整备份');
    return x;
  }
  function resolve(ref, visited = new Set()) {
    const token = JSON.stringify(ref); if (visited.has(token)) return null; visited.add(token);
    if (!ref) return null;
    const d = S().data();
    if (ref.kind === 'checkin') {const task=(d.checkins||[]).find(t=>t.id===ref.id);return task?{task,ref:{kind:'checkin',id:task.id,day:ref.day||M().userDay()}}:null;}
    if (ref.kind === 'queue') { const task = (d.queue || []).concat(d.queueDone || []).find(t => t.id === ref.id); return task && !task.memoDismissed ? { task, ref: { kind: 'queue', id: task.id } } : null; }
    if (ref.kind === 'project') { const task = (d.memoProjects || []).find(t => t.id === ref.id); return task ? { task, ref: { kind: 'project', id: task.id, day: ref.day || M().userDay() } } : null; }
    if (ref.kind === 'daily') { const task = (d.daily || []).find(t => t.id === ref.id); return task ? { task, ref: { kind: 'daily', id: task.id, day: ref.day || M().userDay() } } : null; }
    const tasks = d.days[ref.day]?.tasks || {};
    const matches = Object.entries(tasks).flatMap(([list, items]) => (items || []).filter(t => t.id === ref.id).map(task => ({ task, ref: { kind: 'task', id: task.id, day: ref.day, list } })));
    const live = matches.filter(x => !x.task.memoMovedTo);
    if (live.length > 1 || !matches.length) return null;
    const found = live[0] || matches[matches.length - 1];
    if (found.task.memoMovedTo) return resolve(found.task.memoMovedTo, visited);
    if (found.task.memoDismissed) return null;
    if (found.task.memoProjectId) return resolve({ kind: 'project', id: found.task.memoProjectId, day: ref.day });
    if (found.task.fromQueue) return resolve({ kind: 'queue', id: found.task.fromQueue });
    if (found.task.fromDaily) return resolve({ kind: 'daily', id: found.task.fromDaily, day: ref.day });
    return found;
  }
  function find(ref) { return resolve(ref)?.task; }
  function canonical(ref) { return resolve(ref)?.ref || ref; }
  function key(ref) { const r = canonical(ref); return JSON.stringify([r.kind, r.id, r.kind === 'queue' ? '' : r.day || '']); }
  const repeats = ref => ['project', 'daily', 'checkin'].includes(ref.kind);
  // Statistics can span dates; completion and ledger identities remain dated.
  function timerKey(ref) { const r = canonical(ref); return repeats(r) ? JSON.stringify([r.kind, r.id]) : key(r); }
  function sources(forDay) {
    const d = S().data(), out = [], dayKey = forDay || selectedDay || M().userDay();
    (d.queue || []).filter(t=>!t.memoDismissed&&!t.archived&&!App.memoReview?.hidden(t,t.assignment?.list)&&(!t.assignment||t.assignment.day===dayKey)).forEach(t => out.push({ ref: { kind: 'queue', id: t.id }, title: t.text, label: '队列 · ' + t.text }));
    const day = S().getDay(dayKey);
    ['required', 'ideal', 'extra'].forEach(list => (day.tasks[list] || []).filter(t => !t.memoProjectId && !t.memoMovedTo && !t.memoDismissed && !App.memoReview?.hidden(t,list)).forEach(t => { const found = resolve({ kind: 'task', id: t.id, day: dayKey, list }); if (found) out.push({ ref: found.ref, title: found.task.text, label: '当天 · ' + found.task.text }); }));
    (d.daily || []).filter(t=>!t.archived).forEach(t => out.push({ ref: { kind: 'daily', id: t.id, day: dayKey }, title: t.text, label: '基础 · ' + t.text }));
    (d.memoProjects || []).filter(t => !t.archived && (!t.createdDay || t.createdDay <= dayKey)).forEach(t => out.push({ ref: { kind: 'project', id: t.id, day: dayKey }, title: t.text, label: '每日推进 · ' + t.text }));
    App.memoFinance?.plans(dayKey).filter(x=>!x.r.hidden&&!x.it.archived).forEach(x=>out.push({ref:{kind:'checkin',id:x.it.id,day:dayKey},title:x.it.text,label:'打卡 · '+x.it.text}));const seen = new Set(); return out.filter(x => { const k = key(x.ref); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function unscheduled(day=selectedDay||M().userDay()){const base=dayStart(day),keys=new Set(state().items.filter(p=>!p.deleted&&!p.suspendedByArchive&&!p.suspendedByReview&&p.start<base+86400000&&(p.type==='point'?p.start>=base:p.end>base)).map(p=>key(p.ref)));return sources(day).filter(x=>!keys.has(key(x.ref))&&!isDone({ref:x.ref}));}
  // Execution time is calculated from actual timer chunks, never planned spans.
  // Keep it separate from legacy timeline minutes until overlap reconciliation.
  function dayExecutionMs(day, now = Date.now()) {
    const x = S().data().memoSchedule;
    if (!x || !Array.isArray(x.sessions)) return 0;
    const start = dayStart(day), end = start + 86400000;
    const intervals = [];
    x.sessions.forEach(session => (session.chunks || []).forEach(chunk => {
      const a = Math.max(start, Number(chunk.start));
      const b = Math.min(end, Number(chunk.end == null ? now : chunk.end), now);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) intervals.push([a, b]);
    }));
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0, left = -Infinity, right = -Infinity;
    intervals.forEach(([a, b]) => {
      if (a > right) { if (right > left) total += right - left; left = a; right = b; }
      else right = Math.max(right, b);
    });
    if (right > left) total += right - left;
    return total;
  }
  // Union intervals for totals, retaining raw segments for inspection/export.
  function unionMs(intervals) {
    let total=0,left=null,right=null;
    intervals.filter(x=>x.end>x.start).slice().sort((a,b)=>a.start-b.start).forEach(x=>{
      if(right===null||x.start>right){if(right!==null)total+=right-left;left=x.start;right=x.end;}
      else right=Math.max(right,x.end);
    });return total+(right===null?0:right-left);
  }
  function chunks(sessions, now, from=-Infinity, to=now) {
    return sessions.flatMap(s=>(s.chunks||[]).map((c,i)=>({id:(s.id||'legacy:'+s.ref.kind+':'+s.ref.id+':'+s.chunks[0]?.start)+':'+i,sessionId:s.id||null,index:i,start:Math.max(c.start,from),end:Math.min(c.end??now,now,to),rawStart:c.start,rawEnd:c.end??null}))).filter(c=>c.end>c.start).sort((a,b)=>a.start-b.start||a.end-b.end);
  }
  function elapsed(session, now = Date.now()) { return unionMs(chunks([session],now)); }
  function execution(ref, now=Date.now()) {
    const r=canonical(ref),day=repeats(r)?r.day||M().userDay(now):null;
    const sessions=(S().data().memoSchedule?.sessions||[]).filter(s=>timerKey(s.ref)===timerKey(r));
    const segments=chunks(sessions,now,day?dayStart(day):-Infinity,day?dayStart(M().shiftDay(day,1)):now);
    let right=-Infinity;segments.forEach(c=>{c.overlap=c.start<right;right=Math.max(right,c.end);});
    return {day,segments,actualMs:unionMs(segments),overlap:segments.some(c=>c.overlap)};
  }
  // A read-only projection of actual chunks. Assignment/completion dates never
  // decide which user day receives elapsed time; missing tasks retain session titles.
  function executionIndex(now = Date.now(), throughDay = M().userDay(now)) {
    const days = {}, sessions = S().data().memoSchedule?.sessions || [];
    const limit = Math.min(now, dayStart(M().shiftDay(throughDay, 1)));
    sessions.forEach(s => {
      const found = resolve(s.ref), r = found?.ref || s.ref, taskKey = timerKey(r);
      const title = found?.task.text || s.title || '历史任务（关联已不可用）';
      chunks([s], limit).forEach(c => {
        for (let day = M().userDay(c.start); day <= throughDay; day = M().shiftDay(day, 1)) {
          const left = dayStart(day), right = dayStart(M().shiftDay(day, 1));
          if (left >= c.end) break;
          const start = Math.max(left, c.start), end = Math.min(right, c.end);
          if (end <= start) continue;
          const ongoing = c.rawEnd === null && s.status === 'running' && end === now && now < right;
          const status = !found ? '历史记录，关联已不可用' : found.task.archived ? '已停用' : isDone({ref:repeats(r)?{...r,day}:r}) ? '已完成' : s.status === 'paused' ? '未完成，已暂停' : '未完成';
          (days[day] || (days[day] = {segments:[],actualMs:0})).segments.push({
            id:c.id, taskKey, title, status, start, end,
            rawStart:c.rawStart, rawEnd:c.rawEnd, ongoing,
            clipped:start !== c.rawStart || (c.rawEnd !== null && end !== c.rawEnd) || end === right && c.rawEnd === null
          });
        }
      });
    });
    Object.values(days).forEach(x => {
      x.segments.sort((a,b) => a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
      // The same stable ID/range is a reference, never an extra contribution.
      const seen = new Set(); x.segments = x.segments.filter(c => {
        const k = JSON.stringify([c.id,c.start,c.end]); if (seen.has(k)) return false; seen.add(k); return true;
      });
      let right = -Infinity;
      x.segments.forEach(c => { c.overlap = c.start < right; right = Math.max(right,c.end); });
      x.actualMs = unionMs(x.segments);
    });
    return days;
  }
  function columnItems(day,list) {
    const d=S().data(),items=(d.days[day]?.tasks[list]||[]).filter(t=>!t.fromQueue&&!t.fromDaily&&!t.memoProjectId&&!t.memoMovedTo&&!t.memoDismissed&&!App.memoReview?.hidden(t,list)).map(task=>({task,ref:{kind:'task',id:task.id,day,list}}));
    App.memoFlow?.assigned(day,list).filter(t=>!t.archived&&!App.memoReview?.hidden(t,list)).forEach(task=>items.push({task,ref:{kind:'queue',id:task.id}}));
    (d.memoProjects||[]).filter(t=>(!t.archived||t.days?.[day])&&(!t.createdDay||t.createdDay<=day)&&(t.memoCategoryDays?.[day]||'extra')===list).forEach(task=>items.push({task,ref:{kind:'project',id:task.id,day}}));
    (d.daily||[]).filter(t=>(!t.archived||t.days?.[day])&&t.memoCategoryDays?.[day]===list).forEach(task=>items.push({task,ref:{kind:'daily',id:task.id,day}}));
    const seen=new Set();return items.flatMap(x=>{const found=resolve(x.ref);if(!found||seen.has(key(found.ref)))return [];seen.add(key(found.ref));return [{task:found.task,ref:found.ref,done:isDone({ref:found.ref})}];});
  }
  function timing(ref, now = Date.now()) {
    const r = canonical(ref); planSummary(r);
    const sessions = summaryCache?.timerIndex?.get(timerKey(r)) || [];
    const today = M().userDay(now), day = repeats(r) && r.day ? r.day : today;
    const within = (s, start = -Infinity, end = now) => unionMs(chunks([s],now,start,end));
    const inDay = (s, d) => within(s, dayStart(d), dayStart(M().shiftDay(d, 1)));
    const dayTotal=d=>unionMs(chunks(sessions,now,dayStart(d),dayStart(M().shiftDay(d,1))));
    const allMs=unionMs(chunks(sessions,now)),dayMs=dayTotal(day),todayMs=day===today?dayMs:dayTotal(today);
    const rank = s => s.status === 'running' ? 2 : s.status === 'paused' ? 1 : 0, last = s => s.chunks.at(-1)?.end ?? s.chunks.at(-1)?.start ?? 0;
    const eligible = repeats(r) && day !== today ? sessions.filter(s => s.ref.day === day || inDay(s, day) > 0) : sessions;
    const session = eligible.slice().sort((a, b) => rank(b) - rank(a) || last(b) - last(a))[0] || null;
    // Keep totalMs compatible with existing completion snapshots: repeats use their target day.
    return { totalMs: repeats(r) ? dayMs : allMs, allMs, dayMs, todayMs, day, currentMs: session ? within(session) : 0, session };
  }
  function executionHTML(timing) {
    return '<details class="execution-detail"><summary>执行时段</summary><pre>'+esc(timing?.executionText||'旧完成记录未保存详细时段快照；未推测实际用时。')+'</pre></details>';
  }
  function timingText(t) { return (t.day === M().userDay() ? '今日 ' : t.day + ' ') + duration(t.dayMs) + ' · 累计 ' + duration(t.allMs) + '\n' + (t.session?.status === 'ended' ? '上次 ' : '本次 ') + duration(t.currentMs); }
  function duration(ms) { const sec = Math.floor(Math.max(0, ms) / 1000); return Math.floor(sec / 3600) + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  // Read-only display projection. Attribute overlaps to prior sessions first so
  // the two colors always add up to the existing union-of-intervals total.
  function meterTiming(ref, session = null, now = Date.now()) {
    const t = timing(ref, now), r = canonical(ref), daily = repeats(r);
    const sessions = summaryCache?.timerIndex?.get(timerKey(r)) || [];
    const day = M().userDay(now), from = daily ? dayStart(day) : -Infinity;
    const to = daily ? dayStart(M().shiftDay(day, 1)) : now;
    const current = session && session.status !== 'ended' ? session : null;
    const totalMs = daily ? t.todayMs : t.allMs;
    const previousMs = Math.min(totalMs, unionMs(chunks(sessions.filter(s => s !== current && (!current || s.id !== current.id)), now, from, to)));
    return { totalMs, previousMs, currentMs: Math.max(0, totalMs - previousMs), daily };
  }
  function meterState(ms, expected, daily = false, previousMs = 0) {
    ms = Math.max(0, Number(ms) || 0); expected = Number(expected);
    previousMs = Math.min(ms, Math.max(0, Number(previousMs) || 0));
    const valid = Number.isFinite(expected) && expected > 0, limit = valid ? expected * 60000 : 0;
    const over = valid && ms > limit, bounded = valid && !over;
    // Expected time is a fixed landmark. Extend the SAME cumulative axis in
    // doubling steps; never reset elapsed time to an hourly remainder.
    let rangeMs = valid ? limit : 3600000;
    while (rangeMs < ms) rangeMs *= 2;
    const fill = Math.min(100, ms / rangeMs * 100), previous = previousMs / rangeMs * 100;
    const stepMinutes = rangeMs / 60000 / 4;
    const seconds = Math.floor(Math.max(0, over ? ms - limit : ms) / 1000), hours = Math.floor(seconds / 3600), rest = seconds % 3600;
    const elapsedLabel = (hours ? hours + '小时＋' : '') + Math.floor(rest / 60) + '分' + String(rest % 60).padStart(2, '0') + '秒';
    const prefix = (daily ? '今日预计 ' : '预计总用时 ') + expected + '分钟 · ';
    const detail = bounded ? prefix + (ms === limit ? '达到预计时长' : '剩余 ' + duration(limit - ms)) : over ? prefix + '超时 ' + elapsedLabel : (daily ? '今日累计刻度 · ' : '累计用时刻度 · ') + elapsedLabel;
    return { valid, over, bounded, fill, previous, current: fill - previous, rangeMs, stepMinutes,
      expectedPosition: valid ? limit / rangeMs * 100 : null, detail, tick: '25%',
      state: over ? 'overtime' : bounded ? 'expected' : 'unbounded' };
  }
  function active() { return state().sessions.find(s => s.status === 'running'); }
  function pauseCore(session, now) { summaryCache = null; if (session.status !== 'running') return; const chunk = session.chunks[session.chunks.length - 1]; chunk.end = Math.max(chunk.start, now); session.status = 'paused'; }
  function startRef(ref, now = Date.now(), itemId = null) {
    summaryCache = null; const d = state(), found = resolve(ref); if (!found || found.task.archived) throw new Error('任务已删除或停用，请重新选择');
    App.memoReview?.assertExecutable(found.ref);
    if (isDone({ ref: found.ref })) throw new Error('任务已完成；取消完成后再计时');
    const running = active(); if (running && timerKey(running.ref) === timerKey(found.ref) && (itemId == null || running.itemId === itemId)) return running;
    if (running) pauseCore(running, now);
    let session = d.sessions.slice().reverse().find(s => key(s.ref) === key(found.ref) && s.status === 'paused' && (s.itemId || null) === itemId);
    if (session) { session.status = 'running'; session.chunks.push({ start: now, end: null }); }
    else { session = { id: S().uid(), itemId, ref: clone(found.ref), title: found.task.text, status: 'running', chunks: [{ start: now, end: null }] }; d.sessions.push(session); }
    return session;
  }
  function startCore(id, now = Date.now()) { const item = state().items.find(p => p.id === id && !p.deleted); if (!item) throw new Error('计划已删除'); return startRef(item.ref, now, id); }
  function stopSession(session, now) { pauseCore(session, now); session.status = 'ended'; }
  function stopCore(id, now = Date.now()) { state().sessions.filter(s => s.itemId === id && s.status !== 'ended').forEach(s => stopSession(s, now)); }
  function pause(id, now = Date.now()) { const s = state().sessions.find(s => s.itemId === id && s.status === 'running'); if (s) pauseCore(s, now); }
  function stopRef(ref, now = Date.now(), deleted = false) {
    const d = state(), k = key(ref), r = canonical(ref);
    d.sessions.filter(s => s.status !== 'ended' && (key(s.ref) === k || repeats(r) && timerKey(s.ref) === timerKey(r) && s.chunks.some(c => c.start < dayStart(M().shiftDay(r.day, 1)) && (c.end ?? now) > dayStart(r.day)))).forEach(s => stopSession(s, now));
    if (deleted) d.items.filter(p => key(p.ref) === k).forEach(p => { p.deleted = true; });
  }
  function isDone(item) { const found = resolve(item.ref); if (!found) return false; const t = found.task, r = found.ref; return r.kind==='checkin'?(App.memoPenalty?.policy(t,r.day).mode==='punch'?false:Number(t.days?.[r.day]||0)>=Math.max(1,App.memoFinance?.plans(r.day).find(x=>x.it.id===t.id)?.r.target??S().habitRules(t).target)):r.kind === 'queue' ? !!(t.doneAt || t.doneDay) : (r.kind === 'daily' || r.kind === 'project') ? !!t.days?.[r.day] : !!t.done; }
  function savePlan(input, id) {
    summaryCache = null;
    const d = state();
    if (!M().validDate(input.day) || !Number.isFinite(input.start) || !['point', 'span'].includes(input.type) || (input.type === 'span' && (!Number.isFinite(input.end) || input.end <= input.start || input.end - input.start > 86400000))) throw new Error('请填写有效的日期和时间，时间段最长24小时');
    const found = resolve(input.ref); if (!found) throw new Error('关联任务已移动，请重新选择');
    const old = id && d.items.find(p => p.id === id && !p.deleted); if (id && !old) throw new Error('计划已删除');
    if(old?.memoReviewRoundId&&!input.reviewSync){if(input.type!=='point')throw Error('复习到期是时间点；请另加学习时段');App.memoReview.rescheduleCore(old.memoReviewRoundId,input.start);return old;}
    const next = Object.assign(old || { id: S().uid(), createdAt: new Date().toISOString() }, input, { ref: clone(found.ref), updatedAt: new Date().toISOString() });
    if (!old) d.items.push(next); return next;
  }
  function dayStart(day) { return Date.parse(day + (S().data().memoFlow ? 'T04:00:00+08:00' : 'T00:00:00+08:00')); }
  function at(day, clock, next = false) { return Date.parse(((next || (S().data().memoFlow && clock < '04:00')) ? M().shiftDay(day, 1) : day) + 'T' + clock + ':00+08:00'); }
  function time(value) { return M().clock(value); }
  function offset(value, start) { return Math.max(0, Math.min(1440, (value - start) / 60000)); }
  function columns(events) {
    const sorted = events.slice().sort((a, b) => a.start - b.start || a.end - b.end), groups = []; let group = [], end = -Infinity;
    sorted.forEach(e => { if (group.length && e.start >= end) { groups.push(group); group = []; end = -Infinity; } group.push(Object.assign({}, e)); end = Math.max(end, e.end); });
    if (group.length) groups.push(group);
    return groups.flatMap(g => { const ends = []; g.forEach(e => { let column = ends.findIndex(end => end <= e.start); if (column < 0) column = ends.length; ends[column] = e.end; e.column = column; }); return g.map(e => Object.assign(e, { columns: ends.length })); });
  }
  function denseLayout(events,gap=1,limit=2,markers=false){
    const sorted=events.map(e=>Object.assign({},e,{layoutEnd:Math.max(e.end,e.start+gap)})).sort((a,b)=>a.start-b.start),groups=[];let group=[],end=-Infinity;
    sorted.forEach(e=>{if(group.length&&e.start>=end){groups.push(group);group=[];end=-Infinity;}group.push(e);end=Math.max(end,e.layoutEnd);});if(group.length)groups.push(group);
    return groups.flatMap(g=>{const placed=columns(g.map(e=>Object.assign({},e,{end:e.layoutEnd})));if((markers&&g.length>1)||placed[0]?.columns>limit){return [{...g[0],end:Math.max(...g.map(x=>x.end)),realEnd:Math.max(...g.map(x=>x.realEnd)),column:0,columns:1,members:g.map(({layoutEnd,...e})=>e),live:null,title:(markers?'完成 ':'重叠 ')+g.length+' 项'}];}return placed.map(e=>({...e,end:g.find(x=>x.id===e.id)?.end??e.end}));});
  }
  async function perform(mutate, retry = false) {
    if (App.memoActions.busy() && !retry) { App.ui.toast('请先重试保存当前操作'); return false; }
    try { if (await App.memoActions.commit(mutate)) { if ($('mw-error')) $('mw-error').textContent = ''; render(); App.tasks?.renderAll(); App.queue?.render(); return true; } }
    catch (e) { App.ui.toast(e.message); const message = $('mw-error'); if (message) { message.textContent = e.message; const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重试保存'; retry.onclick = () => perform(() => {}, true); message.appendChild(retry); } const b = $('schedule-retry'); if (b) b.hidden = false; }
    return false;
  }
  function choosePlan(id, preset) {
    const old = id && state().items.find(p => p.id === id), all = sources();
    if (preset && !all.some(x => key(x.ref) === key(preset))) { const found = resolve(preset); if (found) all.unshift({ ref: found.ref, title: found.task.text, label: found.task.text }); }
    if (old && !all.some(x => key(x.ref) === key(old.ref))) all.unshift({ ref: old.ref, title: old.title, label: old.title });
    const m = App.ui.openModal(old ? '修改时间计划' : '安排任务时间',
      '<label for="sp-source">关联任务</label><select id="sp-source"><option value="new">＋ 新建队列任务</option>' + all.map((x, i) => '<option value="' + i + '">' + esc(x.label) + '</option>').join('') + '</select>' +
      '<div id="sp-new-wrap"><label for="sp-title">新任务名称</label><input id="sp-title" maxlength="500"></div>' +
      '<label for="sp-day">日期（北京时间）</label><input type="date" id="sp-day">' +
      '<div class="schedule-fields"><label>开始／时间点<input type="time" id="sp-start" aria-label="计划开始时间"></label><label id="sp-end-wrap">结束（选填）<input type="time" id="sp-end" aria-label="计划结束时间"><span><input type="checkbox" id="sp-next">次日结束</span></label></div>' +
      '<p class="hint">只修改计划，不改写已经发生的执行计时。重叠任务不会自动顺延。</p><p id="sp-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存计划</button>', { lock: true });
    const q = s => m.querySelector(s), ref = old?.ref || preset;
    q('#sp-source').value = ref ? String(all.findIndex(x => key(x.ref) === key(ref))) : 'new';
    q('#sp-day').value = old?.day || selectedDay;
    App.ui.dateContext(m,{getDay:()=>q('#sp-day').value,label:'安排到',sourceDay:old?.day,saveSelector:'[data-act=save]'});
    q('#sp-start').value = old ? time(old.start) : M().clock();
    q('#sp-end').value = old?.end ? time(old.end) : '';
    q('#sp-next').checked = old?.end ? M().naturalDay(old.end) !== old.day : false;
    if (old) q('#sp-source').disabled = true;
    function visibility() { q('#sp-new-wrap').hidden = q('#sp-source').value !== 'new'; }
    q('#sp-source').onchange = visibility; visibility();
    (q('#sp-source').value === 'new' ? q('#sp-title') : q('#sp-start')).focus();
    App.ui.bindActions({ cancel: () => { if (!App.memoActions.busy()) App.ui.closeModal(); }, save: async button => {
      button.disabled = true;
      try {
        const saved = await App.memoActions.commit(() => {
          let source = all[Number(q('#sp-source').value)];
          if (q('#sp-source').value === 'new') {
            const text = q('#sp-title').value.trim(); if (!text) throw new Error('请填写任务名称');
            const task = { id: S().uid(), text, points: S().settings().queuePoints ?? 5, createdAt: new Date().toISOString() }; S().data().queue.push(task);
            source = { ref: { kind: 'queue', id: task.id }, title: text };
          }
          if (!source) throw new Error('请选择关联任务');
          const day = q('#sp-day').value, type = q('#sp-end').value ? 'span' : 'point';
          if (source.ref.kind === 'project' || source.ref.kind === 'daily') source = Object.assign({}, source, { ref: Object.assign({}, source.ref, { day }) });
          savePlan({ ref: source.ref, title: source.title, day, type, start: at(day, q('#sp-start').value), end: type === 'span' ? at(day, q('#sp-end').value, q('#sp-next').checked) : null }, old?.id);
          selectedDay = day;
        });
        if (saved) { App.ui.closeModal(); render(); App.tasks?.renderAll(); App.queue?.render(); }
      } catch (e) { q('#sp-error').textContent = e.message; if (App.memoActions.busy()) button.textContent = '重试保存'; }
      finally { button.disabled = false; }
    } });
  }
  let focusMinute = null;
  function frame(day, now = Date.now()) {
    const dayMs = dayStart(day), focus = focusMinute == null ? (day === (S().data().memoFlow ? M().userDay(now) : M().naturalDay(now)) ? (now - dayMs) / 60000 : 720) : focusMinute;
    const span = rangeHours * 60, from = Math.max(0, Math.min(1440 - span, Math.floor((focus - span / 3) / 30) * 30));
    return { dayMs, from, to: from + span, scale: 1.2 };
  }
  function legacyRecords(day) {
    const user = !!S().data().memoFlow, base = dayStart(day), end = base + 86400000;
    return [day].concat(user ? [M().shiftDay(day,1)] : []).flatMap(sourceDay => (S().data().days[sourceDay]?.timeline || []).map((record,index) => ({record,sourceDay,id:record.id || 'legacy-index-'+sourceDay+'-'+index,index,startMs:Date.parse(sourceDay+'T00:00:00+08:00')+record.start*60000,endMs:Date.parse(sourceDay+'T00:00:00+08:00')+record.end*60000}))).filter(x=>!user || x.startMs<end && x.endMs>base);
  }
  function visibleRecords(day, now = Date.now()) {
    const base = dayStart(day), end = base + 86400000, d = state();
    const plans = d.items.filter(p => !p.deleted && !p.suspendedByArchive && !p.suspendedByBackfill && !p.suspendedByReview && p.start < end && (p.type === 'point' ? p.start >= base : p.end > base));
    const sessions = d.sessions.filter(s => s.chunks.some(c => c.start < end && (c.end ?? now) > base));
    const legacy = legacyRecords(day).filter(x => showHidden || !x.record.memoHidden);
    const matches = title => !keyword || String(title).toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
    const completions = (S().data().memoEvents || []).filter(e => e.active && e.kind !== 'cancellation' && (S().data().memoFlow ? M().userDay(e.at) : M().naturalDay(e.at)) === day && matches(e.title));
    return { completions, plans: plans.filter(p => matches(find(p.ref)?.text || p.title)).sort((a, b) => a.start - b.start), sessions: sessions.filter(s => matches(s.title)), legacy: legacy.filter(x => matches(x.record.content)) };
  }
  function tick() {
    try {
      const d = state(), now = Date.now(), current = d.sessions.find(s => s.status === 'running'), paused = d.sessions.filter(s => s.status === 'paused').sort((a,b)=>(b.chunks.at(-1)?.end||b.chunks.at(-1)?.start||0)-(a.chunks.at(-1)?.end||a.chunks.at(-1)?.start||0));
      App.memoFinance?.dayTick();
      const stat = $('stat-memo-execution');
      if (stat) {
        const value = stat.querySelector('.stat-value');
        if (value) value.textContent = S().fmtDur(dayExecutionMs(M().userDay(now), now) / 60000);
      }
      const live = $('schedule-live'); if (live) live.textContent = current ? '执行中 · ' + current.title + ' ' + duration(elapsed(current, now)) : paused.length ? '有 ' + paused.length + ' 项计时已暂停' : '';
      const controls = $('mw-live-controls'), shown = current || paused[0];
      if (controls) { const signature = shown ? shown.id + ':' + shown.status : ''; if (controls.dataset.session !== signature) { controls.dataset.session = signature; const ref = shown && esc(JSON.stringify(shown.ref)); controls.innerHTML = shown ? (shown.status === 'running' ? '<button class="btn btn-small" data-schedule-command="pause" data-schedule-ref="' + ref + '">暂停</button>' : '<button class="btn btn-small" data-schedule-command="start" data-session-id="' + esc(shown.id) + '" data-schedule-ref="' + ref + '">继续</button>') + '<button class="btn btn-small" data-schedule-command="end" data-schedule-ref="' + ref + '">结束</button>' : ''; } }
      App.memoFloat?.update(current||paused[0],paused);
      App.memoActions?.tick?.();
      const back = $('schedule-active'); if (back) back.hidden = !current && !paused.length;
      document.querySelectorAll('[data-task-timing]').forEach(el=>{const t=timing(JSON.parse(el.dataset.taskTiming),now);el.textContent=timingText(t);});
      if (!mode || document.hidden || !$('view-memo-timeaxis')?.classList.contains('active') && !$('view-tasks')?.classList.contains('active')) return;
      const f = frame(selectedDay, now);
      const panel = $('memo-schedule-panel'); if (panel?.dataset.frameFrom !== String(f.from)) { render(); return; }
      const pos = (now - f.dayMs) / 60000, line = $('schedule-now');
      if (line) { line.hidden = pos < f.from || pos > f.to; line.style.top = (pos - f.from) * f.scale + 'px'; line.textContent = '现在 ' + time(now); }
      document.querySelectorAll('[data-schedule-elapsed]').forEach(el => { const session = d.sessions.find(s => s.id === el.dataset.scheduleElapsed); if (session) el.textContent = duration(elapsed(session, now)); });
      document.querySelectorAll('[data-plan-clock]').forEach(el => { const p = d.items.find(p => p.id === el.dataset.planClock); if (!p) return;
        el.textContent = isDone(p) ? '任务已完成' : now < p.start ? '距计划时间 ' + duration(p.start - now) : p.type === 'point' ? '时间已到' : now < p.end ? '距计划结束 ' + duration(p.end - now) : '计划区间已结束';
      });
      document.querySelectorAll('[data-live-start]').forEach(el => { const start = Number(el.dataset.liveStart), startMin = (start - f.dayMs) / 60000;
        el.style.height = Math.max(2, (Math.min(f.to, pos) - Math.max(f.from, startMin)) * f.scale) + 'px';
      });
    } catch (e) { const live = $('schedule-live'); if (live) live.textContent = e.message; }
  }
  function completeRef(ref) {
    const found = resolve(ref); if (!found) return App.ui.toast('原任务已移动或删除'); const r = found.ref;
    return r.kind === 'project' ? App.memoActions.project(r.id, r.day) : r.kind === 'queue' ? App.memoActions.queue(r.id) : r.kind === 'daily' ? App.memoActions.daily(r.id, r.day) : App.memoActions.task(r.list, r.id, r.day);
  }
  function startUI(ref, itemId = null) {
    const run = () => perform(() => startRef(ref, Date.now(), itemId));
    if (App.memoActions.busy()) return App.ui.toast('请先重试保存当前操作');
    const current = active(); return current && (key(current.ref) !== key(ref) || (itemId && current.itemId !== itemId)) ? App.ui.confirm('暂停“' + esc(current.title) + '”，开始这项任务？', '切换计时', run) : run();
  }
  let summaryCache = null;
  function planSummary(ref) {
    const data = S().data(), schedule = data.memoSchedule;
    if (!schedule || schedule.version !== 1 || !Array.isArray(schedule.items)) return '';
    if (!summaryCache || summaryCache.schedule !== schedule || summaryCache.revision !== data._storageRevision) {
      const index = new Map();
      schedule.items.filter(p => !p.deleted).forEach(p => { const k = key(p.ref); if (!index.has(k)) index.set(k, []); index.get(k).push(p); });
      index.forEach(list => list.sort((a, b) => a.start - b.start));
      const activeIndex=new Map(),sessionIndex=new Map(),timerIndex=new Map();(schedule.sessions||[]).forEach(s=>{const k=key(s.ref);if(!sessionIndex.has(k))sessionIndex.set(k,[]);sessionIndex.get(k).push(s);const tk=timerKey(s.ref);if(!timerIndex.has(tk))timerIndex.set(tk,[]);timerIndex.get(tk).push(s);if(s.status!=='ended'&&activeIndex.get(k)?.status!=='running')activeIndex.set(k,s);});
      summaryCache = { schedule, revision: data._storageRevision, index, activeIndex, sessionIndex, timerIndex };
    }
    const targetDay = find(ref)?.assignment?.day || ref.day;
    const plans = (summaryCache.index.get(key(ref)) || []).filter(p => !targetDay || p.day === targetDay);
    return plans.slice(0, 2).map(p => p.day.slice(5) + ' ' + time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : '')).join('；') + (plans.length > 2 ? ' 等' + plans.length + '段' : '');
  }
  function rowControls(ref) {
    try { const r = canonical(ref), encoded = esc(JSON.stringify(r)), summary = planSummary(r);
      const t=timing(r),session=t.session?.status!=='ended'?t.session:null;
      const command = (act, text) => '<button type="button" class="btn btn-small" data-schedule-command="' + act + '" data-schedule-ref="' + (session && act !== 'plan' ? esc(JSON.stringify(session.ref)) : encoded) + '"' + (session ? ' data-session-id="' + esc(session.id) + '"' : '') + '>' + text + '</button>';
      const stats=t.session?'<strong class="schedule-inline-status" data-task-timing="'+encoded+'">'+esc(timingText(t))+'</strong>':'';
      return '<div class="schedule-row-tools"><span class="mw-plan-control">'+command('plan',summary||'安排时间')+'</span><span class="mw-timer-control">'+stats+(session?command(session.status==='running'?'pause':'start',session.status==='running'?'Ⅱ 暂停计时':'▶ 继续计时')+'<details class="mw-session-menu"><summary>计时操作</summary>'+command('end','结束')+'</details>':isDone({ref:r})?'<small>已完成</small>':command('start','▶ 开始计时'))+'</span></div>';


    } catch (_) { return '<small>时间安排暂不可用，请先备份</small>'; }
  }
  function arrange(ref, day) {
    const found = resolve(ref); if (!found) return App.ui.toast('任务已移动或删除');
    selectedDay = day || found.ref.day || selectedDay || M().userDay();
    const plans = state().items.filter(p => !p.deleted && key(p.ref) === key(found.ref));
    if (!plans.length) return choosePlan(null, found.ref);
    App.ui.openModal('任务时间安排 · ' + found.task.text, plans.map(p => '<div class="memo-queue-row"><strong>' + esc(p.day + ' ' + time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + '</strong><button class="btn btn-small" data-act="edit-plan" data-id="' + esc(p.id) + '">修改</button></div>').join(''), '<button class="btn btn-primary" data-act="add-plan">＋ 再安排一段</button><button class="btn" data-act="close">关闭</button>');
    App.ui.bindActions({ 'edit-plan': b => choosePlan(b.dataset.id), 'add-plan': () => choosePlan(null, found.ref), close: App.ui.closeModal });
  }
  function legacyModal(id) {
    const entry = id != null && legacyRecords(selectedDay).find(x => x.id === id), old = entry?.record, day = entry?.sourceDay || selectedDay;
    const m = App.ui.openModal(old ? '旧时间记录' : '补记时间记录', '<p class="hint">保留原记录来源；这里的时段不会自动算作新执行计时。</p><label for="sl-content">内容</label><textarea id="sl-content" class="memo-action-text"></textarea><div class="schedule-fields"><label>开始<input type="time" id="sl-start" aria-label="记录开始时间"></label><label>结束<input type="time" id="sl-end" aria-label="记录结束时间"></label><label>记录时长（分钟）<input type="number" min="0" id="sl-minutes" aria-label="记录时长"></label></div><p id="sl-error" role="alert"></p>' + (old?.hourPlanId ? '<p class="hint">这是一条小时代汇总，独立展示，不与下属记录重复累计。</p>' : ''), '<button class="btn" data-act="close">关闭</button>' + (old ? '<button class="btn" data-act="details">来源详情</button><button class="btn" data-act="hide">' + (old.memoHidden ? '恢复显示' : '隐藏记录') + '</button>' : '') + '<button class="btn btn-primary" data-act="save">保存记录</button>', { lock: true });
    const q = sel => m.querySelector(sel); q('#sl-content').value = old?.content || ''; q('#sl-start').value = S().hhmmOf(old?.start ?? 720); q('#sl-end').value = S().hhmmOf(old?.end ?? 750); q('#sl-minutes').value = old?.minutes ?? 30; q('#sl-content').focus();
    async function save(button, hide) {
      button.disabled = true;
      try { const saved = await App.memoActions.commit(() => {
        const sourceDay = old || !S().data().memoFlow || q('#sl-start').value >= '04:00' ? day : M().shiftDay(day,1);
        const list = S().getDay(sourceDay).timeline;
        const target = old ? list.find(r => r === old || (old.id && r.id === old.id)) : null;
        if (old && !target) throw new Error('记录已变化，请重新打开');
        if (hide) { target.memoHidden = !target.memoHidden; return; }
        const content = q('#sl-content').value, start = S().minOfDay(q('#sl-start').value), end = S().minOfDay(q('#sl-end').value), minutes = Number(q('#sl-minutes').value);
        if (!/^\d{2}:\d{2}$/.test(q('#sl-start').value) || !/^\d{2}:\d{2}$/.test(q('#sl-end').value) || !content.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(minutes) || minutes < 0) throw new Error('请填写有效的内容、起止时间和记录时长');
        const next = Object.assign({}, target || { id: S().uid(), category: 'aux', countAsStudy: false, auto: false }, { content, start, end, minutes });
        if (target) list[list.indexOf(target)] = next; else list.push(next);
      }); if (saved) { App.ui.closeModal(); render(); } }
      catch (e) { q('#sl-error').textContent = e.message; }
      finally { button.disabled = false; }
    }
    App.ui.bindActions({ close: () => { if (!App.memoActions.busy()) App.ui.closeModal(); }, save: b => save(b, false), hide: b => save(b, true), details: () => { if (old?.hourPlanId) App.timeline?.showHourDetails(old, day); else App.ui.toast(old?.auto ? '原版自动时间记录；原始字段保留' : '手动时间记录；原始字段保留'); } });
  }
  function detailGroups(records) {
    const map = new Map(), checkins = [];
    const group = (ref, title) => { const k = key(ref); if (!map.has(k)) map.set(k, { ref, title, ids: [], running: false, done: false }); return map.get(k); };
    records.plans.forEach(p => { const g = group(p.ref, find(p.ref)?.text || p.title); g.ids.push('p-' + p.id); g.done = isDone(p); });
    records.sessions.forEach(s => { const g = group(s.ref, s.title); g.ids.push('s-' + s.id); g.running ||= s.status === 'running'; g.done ||= isDone(s); });
    records.completions.forEach(e => {
      if (e.kind === 'checkin') return checkins.push('c-' + e.id);
      const ref = { kind: e.kind, id: e.sourceId, day: e.sourceDay, list: e.sourceList }, g = group(ref, e.title);
      g.ids.push('c-' + e.id); g.done = true;
    });
    const groups = [...map.values()];
    return { pending: groups.filter(g => !g.done).sort((a, b) => Number(b.running) - Number(a.running)), completed: groups.filter(g => g.done), checkins };
  }
  function foldDetails(root, records, expanded) {
    const cards = root.querySelector('.schedule-cards'), waiting = root.querySelector('.schedule-waiting'), groups = detailGroups(records), saved = new Map([...cards.children].map(el => [el.id, el]));
    cards.replaceChildren();
    const appendGroup = (parent, g) => { const section = document.createElement('section'); section.className = 'schedule-task-group'; section.dataset.taskKey = key(g.ref); if (g.running) section.classList.add('schedule-task-running'); g.ids.forEach(id => { const card = saved.get('schedule-card-' + id); if (card) section.appendChild(card); }); parent.appendChild(section); };
    groups.pending.forEach(g => appendGroup(cards, g));
    if (waiting) cards.appendChild(waiting);
    const disclosure = (label, attr) => { const d = document.createElement('details'), summary = document.createElement('summary'); d.className = 'schedule-folded'; d.setAttribute(attr, ''); summary.textContent = label; d.appendChild(summary); cards.appendChild(d); return d; };
    if (showLegacy && records.legacy.length) { const old = disclosure('旧记录（' + records.legacy.length + '）', 'data-schedule-old'); records.legacy.forEach(x => { const card = saved.get('schedule-card-l-' + x.id); if (card) old.appendChild(card); }); }
    if (groups.checkins.length) { const log = disclosure('打卡记录（' + groups.checkins.length + '）', 'data-schedule-checkins'); groups.checkins.forEach(id => { const card = saved.get('schedule-card-' + id); if (card) log.appendChild(card); }); }
    if (groups.completed.length) { const done = disclosure('已完成（' + groups.completed.length + '）', 'data-schedule-done'); done.open = expanded; groups.completed.forEach(g => appendGroup(done, g)); }
  }
  function render() {
    const root = $('memo-schedule-panel'); if (!root) return;
    try {
      const expanded = !!root.querySelector('[data-schedule-done]')?.open && root.dataset.foldDay === selectedDay;
      selectedDay = selectedDay || M().userDay(); const d = state(), now = Date.now(), f = frame(selectedDay, now), records = visibleRecords(selectedDay, now); root.dataset.frameFrom = String(f.from); root.dataset.completionCount = String(records.completions.length); App.timeline?.setDate(selectedDay);
      function event(startMs, endMs, props) {
        const fromMs = f.dayMs + f.from * 60000, toMs = f.dayMs + f.to * 60000;
        // Half-open windows keep boundary points in exactly one frame / user day.
        if (startMs === endMs ? startMs < fromMs || startMs >= toMs : endMs <= fromMs || startMs >= toMs) return null;
        const start = Math.max(f.from, (startMs - f.dayMs) / 60000), end = Math.min(f.to, (endMs - f.dayMs) / 60000);
        return Object.assign({ start, end: Math.max(start + .001, end), realEnd: end, originalStart:startMs, originalEnd:endMs }, props);
      }
      const planned = records.plans.map(p => event(p.start, p.end ?? p.start, { title: find(p.ref)?.text || p.title, type: p.type, planned: true, card: 'p-' + p.id, id: p.id })).filter(Boolean), actual = [], completed = [];
      records.sessions.forEach(s => s.chunks.forEach((c, i) => { const e = event(c.start, c.end ?? now, { title: s.title, type: 'span', card: 's-' + s.id, id: s.id + '-' + i, taskToken:timerKey(s.ref), live: c.end == null ? c.start : null }); if (e) actual.push(e); }));
      if (showLegacy) records.legacy.forEach(x => { const r = x.record; if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) return; const e = event(x.startMs, x.endMs, { title: r.content, type: 'span', card: 'l-' + x.id, id: x.id, legacy: true, aggregate: !!r.hourPlanId }); if (e) actual.push(e); });
      records.completions.forEach(e => { const marker = event(Date.parse(e.at), Date.parse(e.at), { title: e.title, type: 'point', card: 'c-' + e.id, id: e.id, completed: true }); if (marker) completed.push(marker); });
      const pointGroups = [];
      function groupPoints(list) { const groups = new Map(), result = []; list.forEach(e => { if (e.type !== 'point') return result.push(e); const k = Math.floor(e.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }); groups.forEach(items => { if (items.length === 1) result.push(items[0]); else { const index = pointGroups.push(items) - 1; result.push(Object.assign({}, items[0], { group: index, title: time(f.dayMs + Math.floor(items[0].start) * 60000) + ' 同刻 ' + items.length + ' 项（展开）' })); } }); return result; }
      const parts=new Map();actual.sort((a,b)=>a.start-b.start).forEach(e=>{if(!e.taskToken)return;const n=(parts.get(e.taskToken)||0)+1;parts.set(e.taskToken,n);e.part=n;});
      const densityGroups=[];
      function blocks(list, marker = false) {
        const limit = root.clientWidth < 900 ? 1 : 2;
        const isExecution=!marker&&list===actual;
        const layout=isExecution?columns(list.map(e=>({...e}))):denseLayout(list, (marker ? 44 : 50) / f.scale, marker ? 1 : limit, marker);
        return layout.map(e => {
          const group = e.members ? densityGroups.push(e.members) - 1 : null;
          const liveStart = e.members?.some(member => member.live != null) ? f.dayMs + e.start * 60000 : e.live;
          const height = Math.max(2, (e.realEnd - e.start) * f.scale), short = height < 44 || e.type === 'point';
          const kind = marker ? '完成' : e.planned ? '预计' : e.legacy ? (e.aggregate ? '汇总' : '旧记录') : '计时';
          const stamp = time(e.originalStart), displayTitle = e.members ? e.members.length + (marker ? '次完成' : '条记录') : e.title;
          const label = kind + ' · ' + stamp + (marker || e.type === 'point' ? '' : '—' + time(e.originalEnd));
          return '<button type="button" class="schedule-block ' + (isExecution?'schedule-execution ':'') + (marker ? 'completion-marker ' : e.legacy ? 'schedule-legacy ' : 'schedule-new ') + (e.planned ? 'schedule-is-plan ' : '') + (e.aggregate ? 'schedule-aggregate ' : '') + (e.members ? 'schedule-density-group ' : '') + (e.type === 'point' ? 'schedule-point ' : '') + (short ? 'schedule-short ' : '') + (liveStart != null ? 'schedule-running ' : '') + '" style="top:' + ((e.start-f.from)*f.scale) + 'px;height:' + (marker ? 42 : height) + 'px;left:' + (e.column*100/e.columns) + '%;width:calc(' + (100/e.columns) + '% - 3px)" data-task-token="'+esc(e.taskToken||'')+'" data-sc="' + (group === null ? 'card' : 'density-group') + '" data-density="' + group + '" data-card="' + esc(e.card) + '" title="' + esc(label + ' · ' + displayTitle + (e.members ? '；展开查看每条起止时间' : '')) + '" aria-label="查看：' + esc(label + ' · ' + displayTitle + (e.members ? '；展开查看每条起止时间' : '')) + '"' + (liveStart != null ? ' data-live-start="' + liveStart + '"' : '') + '><small>' + esc(marker ? stamp : liveStart != null ? '执行中 · '+stamp : e.members ? '展开查看' : isExecution?stamp+'—'+time(e.originalEnd):kind) + '</small><span>' + esc((e.part?'第'+e.part+'段 · ':'')+displayTitle) + '</span></button>';
        }).join('');
      }
      const chart = '<div class="schedule-chart" data-mode="' + view + '"><div class="schedule-legend"><span class="schedule-time-heading">时间</span><strong class="schedule-plan-heading">预计</strong><strong class="schedule-actual-heading">计时</strong><strong class="schedule-completion-heading">完成</strong></div><div class="schedule-axis" style="height:' + (f.to - f.from) * f.scale + 'px"><div class="schedule-hours">' + Array.from({ length: Math.floor((f.to - f.from) / 60) + 1 }, (_, i) => { const minute = f.from + i * 60; return '<span style="top:' + i * 60 * f.scale + 'px">' + ((S().data().memoFlow && minute >= 1200 ? '次日' : '') + S().hhmmOf((minute + (S().data().memoFlow ? 240 : 0)) % 1440)) + '</span>'; }).join('') + '</div><div class="schedule-lane schedule-plan-lane" aria-label="预计安排">' + blocks(planned) + '</div><div class="schedule-lane schedule-actual-lane" aria-label="实际计时与来源记录">' + blocks(actual) + '</div><div class="schedule-lane schedule-completion-lane" aria-label="完成时刻">' + blocks(completed, true) + '</div><div id="schedule-now"></div></div></div>';
      const status = { running: '执行中', paused: '已暂停', ended: '本段已结束' };
      const button = (act, id, text, primary = false) => '<button class="btn btn-small' + (primary ? ' btn-primary' : '') + '" data-sc="' + act + '" data-id="' + esc(id) + '">' + text + '</button>';
      const allWaiting=unscheduled(selectedDay),waiting=allWaiting.filter(x=>!keyword||x.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
      root.innerHTML = '<div class="schedule-header"><h2>时间轴</h2><div class="memo-queue-actions">' + button('add', '', '＋ 安排时间', true) + button('legacy-add', '', '补记时段') + '</div></div><p class="hint schedule-explanation">北京时间04:00分日 · 预计安排、实际计时、完成时刻分轨；完成点不代表用时。</p><div class="schedule-toolbar"><input type="date" id="schedule-date" aria-label="时间线日期" data-transient="true" value="' + selectedDay + '">' + button('today', '', '今天') + button('now', '', '现在') + '<select id="schedule-view" aria-label="时间轴视图"><option value="combined">综合：预计／计时／完成</option><option value="compare">对照：计时／预计／完成</option><option value="plan">图表：计划</option><option value="actual">图表：计时与完成</option></select><select id="schedule-range" aria-label="显示时间范围"><option value="4">附近4小时</option><option value="8">附近8小时</option><option value="24">全天</option></select>' + button('prev', '', '前一段') + button('next', '', '后一段') + '</div><details class="schedule-filters"><summary>筛选与备份</summary><input type="search" id="schedule-keyword" aria-label="筛选时间记录" placeholder="搜索任务或记录" data-transient="true"><label><input type="checkbox" id="schedule-legacy">显示旧时间记录</label><label><input type="checkbox" id="schedule-hidden">包括已隐藏记录</label>' + button('backup', '', '下载完整备份') + button('import', '', '导入完整备份') + button('csv', '', '导出旧记录CSV') + '</details><button class="btn btn-small" id="schedule-retry" data-sc="retry" hidden>重试保存</button>' + chart + '<div class="schedule-cards">' + records.completions.map(e => '<article class="schedule-card" id="schedule-card-c-' + esc(e.id) + '"><span class="schedule-kind">勾选完成</span><strong>' + esc(e.title) + '</strong><p>' + esc(M().naturalDay(e.at) + ' ' + time(Date.parse(e.at))) + (e.sourceDay !== selectedDay ? ' · 任务日期 ' + esc(e.sourceDay) : '') + '</p>'+executionHTML(e.timing)+'</article>').join('') + records.plans.map(p => '<article class="schedule-card" id="schedule-card-p-' + esc(p.id) + '"><span class="schedule-kind">计划</span><strong>' + esc(find(p.ref)?.text || p.title) + '</strong><p>' + esc(time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + ' · <span data-plan-clock="' + esc(p.id) + '"></span></p><div class="memo-queue-actions">' + (find(p.ref) ? (isDone(p) ? '' : button('start', p.id, '开始本段')) + button('complete', p.id, isDone(p) ? '取消任务完成' : '完成任务', true) : '<span>原任务已移动或删除</span>') + button('edit', p.id, '改时间') + button('unschedule', p.id, '移除安排') + '</div></article>').join('') + records.sessions.map(s => '<article class="schedule-card" id="schedule-card-s-' + esc(s.id) + '"><span class="schedule-kind">执行' + (s.itemId ? ' · 关联计划' : ' · 未预先安排') + '</span><strong>' + esc(s.title) + '</strong><p>' + status[s.status] + ' · <span data-schedule-elapsed="' + esc(s.id) + '">' + duration(elapsed(s)) + '</span></p><details class="execution-detail"><summary>执行片段（'+s.chunks.length+'段）</summary><p class="hint">' + s.chunks.map(c => esc(M().naturalDay(c.start) + ' ' + time(c.start) + '—' + (c.end == null ? '进行中' : (M().naturalDay(c.end) !== M().naturalDay(c.start) ? M().naturalDay(c.end) + ' ' : '') + time(c.end)))).join('；') + '</p></details><div class="memo-queue-actions">' + (s.status === 'running' ? button('pause-session', s.id, '暂停') : s.status === 'paused' ? button('resume-session', s.id, '继续计时') : '') + (s.status !== 'ended' ? button('stop-session', s.id, '结束本段') : '') + (find(s.ref) ? button('complete-session', s.id, isDone(s) ? '取消任务完成' : '完成任务') : '<span>原任务已删除；执行记录保留</span>') + '</div></article>').join('') + (showLegacy ? records.legacy.map(x => '<article class="schedule-card schedule-old-card" id="schedule-card-l-' + esc(x.id) + '"><span class="schedule-kind">' + (x.record.hourPlanId ? '小时代汇总 · 不重复累计' : x.record.auto ? '原版自动记录' : '手动时间记录') + (x.record.memoHidden ? ' · 已隐藏' : '') + '</span><strong>' + esc(x.record.content) + '</strong><p>' + esc(S().hhmmOf(x.record.start) + '—' + S().hhmmOf(x.record.end)) + ' · 原记录 ' + esc(x.record.minutes ?? 0) + ' 分钟</p>' + button('legacy-edit', x.id, '查看／编辑') + '</article>').join('') : '') + '</div><details class="card schedule-waiting"><summary>未排时间（' + (keyword?'匹配 '+waiting.length+'／共 '+allWaiting.length:allWaiting.length) + '）</summary>' + waiting.map((x, i) => '<div class="memo-queue-row"><small>'+esc(x.ref.kind==='queue'&&!find(x.ref)?.assignment?'尚未安排到当天的队列':'所选日期任务')+'</small><strong>' + esc(x.title) + '</strong> <button class="btn btn-small" data-sc="arrange" data-index="' + i + '">安排时间</button><button class="btn btn-small" data-sc="start-now" data-index="' + i + '">现在开始</button></div>').join('') + '</details>';
      foldDetails(root, records, expanded); root.dataset.foldDay = selectedDay;
      const q = id => root.querySelector('#' + id); q('schedule-view').value = view; q('schedule-range').value = String(rangeHours); q('schedule-keyword').value = keyword; q('schedule-legacy').checked = showLegacy; q('schedule-hidden').checked = showHidden;
      q('schedule-date').onchange = e => { if (M().validDate(e.target.value)) { selectedDay = e.target.value; focusMinute = null; render(); } };
      q('schedule-view').onchange = e => { view = e.target.value; render(); }; q('schedule-range').onchange = e => { rangeHours = Number(e.target.value); render(); };
      q('schedule-keyword').onchange = e => { keyword = e.target.value; render(); }; q('schedule-legacy').onchange = e => { showLegacy = e.target.checked; render(); }; q('schedule-hidden').onchange = e => { showHidden = e.target.checked; render(); };
      root.onclick = e => {
        const token=e.target.closest('[data-task-token]')?.dataset.taskToken;if(token)root.querySelectorAll('[data-task-token]').forEach(b=>b.classList.toggle('schedule-selected',b.dataset.taskToken===token));
        const b = e.target.closest('[data-sc]'); if (!b) return; const act = b.dataset.sc, id = b.dataset.id, p = d.items.find(p => p.id === id), session = d.sessions.find(s => s.id === id);
        if(act==='density-group'){const entries=densityGroups[Number(b.dataset.density)]||[],m=App.ui.openModal('时间记录明细',entries.map((x,i)=>'<p><strong>'+esc(x.title)+'</strong><br>'+esc(time(x.originalStart??(f.dayMs+x.start*60000))+(x.completed?' · 完成':('—'+time(x.originalEnd??(f.dayMs+x.realEnd*60000))+' · '+(x.planned?'计划':x.legacy?'旧记录':'实际'))))+' <button class="btn" data-density-open="'+i+'">查看详情</button></p>').join(''),'<button class="btn" data-act="close">关闭</button>');m.onclick=e=>{const b=e.target.closest('[data-density-open]');if(!b)return;const x=entries[Number(b.dataset.densityOpen)],card=document.getElementById('schedule-card-'+x.card);App.ui.closeModal();for(let el=card?.parentElement;el&&el!==root;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;card?.scrollIntoView({block:'center'});};App.ui.bindActions({close:App.ui.closeModal});return;}
        if (act === 'add' || act === 'edit') return choosePlan(id);
        if (act === 'arrange') return arrange(waiting[Number(b.dataset.index)]?.ref);
        if (act === 'start-now') return startUI(waiting[Number(b.dataset.index)]?.ref);
        if (act === 'start' && p) return startUI(p.ref, p.id);
        if (act === 'complete' && p) return completeRef(p.ref);
        if (act === 'complete-session' && session) return completeRef(session.ref);
        if (act === 'pause-session' && session) return perform(() => pauseCore(session, Date.now()));
        if (act === 'resume-session' && session) return startUI(session.ref, session.itemId || null);
        if (act === 'stop-session' && session) return perform(() => stopSession(session, Date.now()));
        if (act === 'unschedule' && p?.memoReviewRoundId) return App.memoReview.manage(App.memoReview.round(p.memoReviewRoundId).seriesId);
        if (act === 'unschedule' && p) return App.ui.confirm('移除这项时间安排并结束它关联的活动计时？任务、积分与历史执行保留。', '移除安排', () => perform(() => { stopCore(p.id); p.deleted = true; }));
        if (act === 'legacy-add') return legacyModal(null);
        if (act === 'legacy-edit') return legacyModal(id);
        if (act === 'backup') return App.backup.exportCurrent();
        if (act === 'import') return App.backup.importFile();
        if (act === 'csv') return S().exportCSV();
        if (act === 'retry') return perform(() => {}, true);
        if (act === 'today' || act === 'now') { selectedDay = M().userDay(); focusMinute = null; render(); return; }
        if (act === 'prev' || act === 'next') { focusMinute = Math.max(0, Math.min(1439, (f.from + f.to) / 2 + (act === 'prev' ? -1 : 1) * rangeHours * 60)); render(); return; }
        if (act === 'point-group') { const items = pointGroups[Number(b.dataset.group)] || []; App.ui.openModal('同刻任务', items.map(item => '<p>' + esc(item.title) + '</p>').join(''), '<button class="btn" data-act="close">关闭</button>'); App.ui.bindActions({ close: App.ui.closeModal }); return; }
        if (act === 'card') { const card = document.getElementById('schedule-card-' + b.dataset.card); for (let el = card?.parentElement; el && el !== root; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true; card?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      };
      tick();
    } catch (e) { root.textContent = e.message; }
  }
  function setMode(value) { mode = value; $('memo-schedule-panel').hidden = !value; if (value) render(); }
  function open(options = {}) { selectedDay = options.day || selectedDay || M().userDay(); focusMinute = options.focusMinute ?? null; if (options.legacy) { showLegacy = true; view = 'combined'; } if (!options.workspace) { App.app.switchView('timeline'); return open(Object.assign({}, options, { workspace: true })); } setMode(true); }
  function init() {
    selectedDay = M().userDay(); rangeHours = 4; view = 'combined'; $('task-list-switch').onclick = () => setMode(false); $('task-schedule-switch').onclick = () => open(); $('memo-trash-open').onclick = () => App.memoActions.trash();
    $('schedule-active').onclick = () => { const d = state(), session = active() || d.sessions.find(s => s.status === 'paused'); if (session) { selectedDay = M().userDay(session.chunks[session.chunks.length - 1].start); focusMinute = (session.chunks[session.chunks.length - 1].start - dayStart(selectedDay)) / 60000; App.app?.switchView('tasks'); open({ day: selectedDay, focusMinute, focusCard: 's-' + session.id }); } };
    document.addEventListener('click', async e => {
      const button = e.target.closest('[data-schedule-command]'); if (!button) return;
      e.preventDefault(); e.stopImmediatePropagation();
      try {
        const ref = JSON.parse(button.dataset.scheduleRef), act = button.dataset.scheduleCommand;
        if (act === 'plan') return arrange(ref, ref.day || M().userDay());
        const previousText = button.textContent; button.disabled = true; button.textContent = '保存中…';
        let ok = false;
        try {
          if (act === 'retry') ok = await perform(() => {}, true);
          else if (act === 'pause' || act === 'end') ok = await perform(() => state().sessions.filter(s => key(s.ref) === key(ref) && s.status !== 'ended').forEach(s => act === 'pause' ? pauseCore(s, Date.now()) : stopSession(s, Date.now())));
          else { const session = state().sessions.find(s => s.id === button.dataset.sessionId); ok = await startUI(ref, session?.itemId || null); }
        } finally {
          if (button.isConnected) { button.disabled = false; button.textContent = previousText;
            if (!ok && App.memoActions.busy()) { button.dataset.scheduleCommand = 'retry'; button.textContent = '重试保存'; const row = button.closest('.mw-task-timing') || button.parentElement; let error = row.querySelector('.mw-timing-error'); if (!error) { error = document.createElement('p'); error.className = 'mw-timing-error'; error.setAttribute('role', 'alert'); row.appendChild(error); } error.textContent = '计时操作尚未保存，请重试，不要刷新。'; }
          }
        }
      } catch (error) { App.ui.toast(error.message); }
    }, true);

    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (mode) render(); tick(); } }); window.addEventListener('focus-storage', tick);
    if (interval) clearInterval(interval); interval = setInterval(tick, 1000); tick();
  }
  App.memoSchedule = { invalidate:()=>{summaryCache=null;},meterTiming,meterState,setDay: day => { if (M().validDate(day)) selectedDay = day; }, init, render, tick, open, rowControls, arrange, resolve, canonical, key, timerKey, state, pauseCore, startCore, startRef, stopCore, stopRef, pause, savePlan, elapsed, unionMs, execution, executionIndex, executionHTML, columnItems, dayExecutionMs, timing, timingText, columns, find, frame, visibleRecords, detailGroups, denseLayout, sources, unscheduled, busy: () => { try { return state().sessions.some(s => s.status !== 'ended'); } catch (_) { return true; } } };
})();
