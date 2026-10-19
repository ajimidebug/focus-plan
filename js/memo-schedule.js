/* Explicit plans and execution timestamps; never infer activity from memo text. */
(function () {
  'use strict';
  const App = window.App = window.App || {}, S = () => App.store, M = () => App.memoCore;
  const $ = id => document.getElementById(id), esc = value => S().esc(String(value ?? ''));
  let selectedDay, mode = false, interval, view = 'compare', rangeHours = 6, keyword = '', showLegacy = true, showHidden = false;
  const clone = x => JSON.parse(JSON.stringify(x));
  function state() {
    const d = S().data();
    if (d.memoSchedule === undefined) d.memoSchedule = { version: 1, items: [], sessions: [] };
    const x = d.memoSchedule;
    if (!x || x.version !== 1 || !Array.isArray(x.items) || !Array.isArray(x.sessions)) throw new Error('时间线格式异常，请先下载完整备份');
    if (x.items.some(p => !p || typeof p.id !== 'string' || !M().validDate(p.day) || !Number.isFinite(p.start) || (p.type !== 'point' && p.type !== 'span') || (p.type === 'span' && (!Number.isFinite(p.end) || p.end <= p.start))) || x.sessions.some(s => !s || !Array.isArray(s.chunks) || !['running', 'paused', 'ended'].includes(s.status) || s.chunks.some(c => !Number.isFinite(c.start) || (c.end != null && (!Number.isFinite(c.end) || c.end < c.start))))) throw new Error('时间线记录异常，请先下载完整备份');
    return x;
  }
  function resolve(ref) {
    if (!ref) return null;
    const d = S().data();
    if (ref.kind === 'queue') { const task = (d.queue || []).concat(d.queueDone || []).find(t => t.id === ref.id); return task ? { task, ref: { kind: 'queue', id: task.id } } : null; }
    if (ref.kind === 'project') { const task = (d.memoProjects || []).find(t => t.id === ref.id); return task ? { task, ref: { kind: 'project', id: task.id, day: ref.day || M().userDay() } } : null; }
    if (ref.kind === 'daily') { const task = (d.daily || []).find(t => t.id === ref.id); return task ? { task, ref: { kind: 'daily', id: task.id, day: ref.day || M().userDay() } } : null; }
    const tasks = d.days[ref.day]?.tasks || {};
    const matches = Object.entries(tasks).flatMap(([list, items]) => (items || []).filter(t => t.id === ref.id).map(task => ({ task, ref: { kind: 'task', id: task.id, day: ref.day, list } })));
    if (matches.length !== 1) return null;
    const found = matches[0];
    if (found.task.memoProjectId) return resolve({ kind: 'project', id: found.task.memoProjectId, day: ref.day });
    if (found.task.fromQueue) return resolve({ kind: 'queue', id: found.task.fromQueue });
    if (found.task.fromDaily) return resolve({ kind: 'daily', id: found.task.fromDaily, day: ref.day });
    return found;
  }
  function find(ref) { return resolve(ref)?.task; }
  function canonical(ref) { return resolve(ref)?.ref || ref; }
  function key(ref) { const r = canonical(ref); return JSON.stringify([r.kind, r.id, r.kind === 'queue' ? '' : r.day || '']); }
  function sources() {
    const d = S().data(), out = [], dayKey = selectedDay || M().naturalDay();
    (d.queue || []).forEach(t => out.push({ ref: { kind: 'queue', id: t.id }, title: t.text, label: '队列 · ' + t.text }));
    const day = S().getDay(dayKey);
    ['required', 'ideal', 'extra'].forEach(list => (day.tasks[list] || []).filter(t => !t.memoProjectId).forEach(t => { const found = resolve({ kind: 'task', id: t.id, day: dayKey, list }); if (found) out.push({ ref: found.ref, title: found.task.text, label: '当天 · ' + found.task.text }); }));
    (d.daily || []).forEach(t => out.push({ ref: { kind: 'daily', id: t.id, day: dayKey }, title: t.text, label: '基础 · ' + t.text }));
    (d.memoProjects || []).filter(t => !t.archived && (!t.createdDay || t.createdDay <= dayKey)).forEach(t => out.push({ ref: { kind: 'project', id: t.id, day: dayKey }, title: t.text, label: '每日推进 · ' + t.text }));
    const seen = new Set(); return out.filter(x => { const k = key(x.ref); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function elapsed(session, now = Date.now()) { return session.chunks.reduce((sum, c) => sum + Math.max(0, (c.end == null ? now : c.end) - c.start), 0); }
  function duration(ms) { const sec = Math.floor(Math.max(0, ms) / 1000); return Math.floor(sec / 3600) + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  function active() { return state().sessions.find(s => s.status === 'running'); }
  function pauseCore(session, now) { summaryCache = null; if (session.status !== 'running') return; const chunk = session.chunks[session.chunks.length - 1]; chunk.end = Math.max(chunk.start, now); session.status = 'paused'; }
  function startRef(ref, now = Date.now(), itemId = null) {
    summaryCache = null; const d = state(), found = resolve(ref); if (!found || found.task.archived) throw new Error('任务已删除或停用，请重新选择');
    if (isDone({ ref: found.ref })) throw new Error('任务已完成；取消完成后再计时');
    const running = active(); if (running && key(running.ref) === key(found.ref) && (itemId == null || running.itemId === itemId)) return running;
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
    const d = state(), k = key(ref); d.sessions.filter(s => key(s.ref) === k && s.status !== 'ended').forEach(s => stopSession(s, now));
    if (deleted) d.items.filter(p => key(p.ref) === k).forEach(p => { p.deleted = true; });
  }
  function isDone(item) { const found = resolve(item.ref); if (!found) return false; const t = found.task, r = found.ref; return r.kind === 'queue' ? !!(t.doneAt || t.doneDay) : (r.kind === 'daily' || r.kind === 'project') ? !!t.days?.[r.day] : !!t.done; }
  function savePlan(input, id) {
    summaryCache = null;
    const d = state();
    if (!M().validDate(input.day) || !Number.isFinite(input.start) || !['point', 'span'].includes(input.type) || (input.type === 'span' && (!Number.isFinite(input.end) || input.end <= input.start || input.end - input.start > 86400000))) throw new Error('请填写有效的日期和时间，时间段最长24小时');
    const found = resolve(input.ref); if (!found) throw new Error('关联任务已移动，请重新选择');
    const old = id && d.items.find(p => p.id === id && !p.deleted); if (id && !old) throw new Error('计划已删除');
    const next = Object.assign(old || { id: S().uid(), createdAt: new Date().toISOString() }, input, { ref: clone(found.ref), updatedAt: new Date().toISOString() });
    if (!old) d.items.push(next); return next;
  }
  function dayStart(day) { return Date.parse(day + 'T00:00:00+08:00'); }
  function at(day, clock, next = false) { return Date.parse((next ? M().shiftDay(day, 1) : day) + 'T' + clock + ':00+08:00'); }
  function time(value) { return M().clock(value); }
  function offset(value, start) { return Math.max(0, Math.min(1440, (value - start) / 60000)); }
  function columns(events) {
    const sorted = events.slice().sort((a, b) => a.start - b.start || a.end - b.end), groups = []; let group = [], end = -Infinity;
    sorted.forEach(e => { if (group.length && e.start >= end) { groups.push(group); group = []; end = -Infinity; } group.push(Object.assign({}, e)); end = Math.max(end, e.end); });
    if (group.length) groups.push(group);
    return groups.flatMap(g => { const ends = []; g.forEach(e => { let column = ends.findIndex(end => end <= e.start); if (column < 0) column = ends.length; ends[column] = e.end; e.column = column; }); return g.map(e => Object.assign(e, { columns: ends.length })); });
  }
  async function perform(mutate) {
    try { if (await App.memoActions.commit(mutate)) { render(); App.tasks?.renderAll(); App.queue?.render(); return true; } }
    catch (e) { App.ui.toast(e.message); const b = $('schedule-retry'); if (b) b.hidden = false; }
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
    const dayMs = dayStart(day), focus = focusMinute == null ? (day === M().naturalDay(now) ? (now - dayMs) / 60000 : 720) : focusMinute;
    const span = rangeHours * 60, from = Math.max(0, Math.min(1440 - span, Math.floor((focus - span / 3) / 30) * 30));
    return { dayMs, from, to: from + span, scale: 1.2 };
  }
  function legacyRecords(day) { return (S().data().days[day]?.timeline || []).map((record, index) => ({ record, id: record.id || 'legacy-index-' + index, index })); }
  function visibleRecords(day, now = Date.now()) {
    const base = dayStart(day), end = base + 86400000, d = state();
    const plans = d.items.filter(p => !p.deleted && !p.suspendedByArchive && p.start < end && (p.type === 'point' ? p.start >= base : p.end > base));
    const sessions = d.sessions.filter(s => s.chunks.some(c => c.start < end && (c.end ?? now) > base));
    const legacy = legacyRecords(day).filter(x => showHidden || !x.record.memoHidden);
    const matches = title => !keyword || String(title).toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
    const completions = (S().data().memoEvents || []).filter(e => e.active && e.kind !== 'cancellation' && M().naturalDay(e.at) === day && matches(e.title));
    return { completions, plans: plans.filter(p => matches(find(p.ref)?.text || p.title)).sort((a, b) => a.start - b.start), sessions: sessions.filter(s => matches(s.title)), legacy: legacy.filter(x => matches(x.record.content)) };
  }
  function tick() {
    try {
      const d = state(), now = Date.now(), current = d.sessions.find(s => s.status === 'running'), paused = d.sessions.filter(s => s.status === 'paused');
      const live = $('schedule-live'); if (live) live.textContent = current ? '执行中 · ' + current.title + ' ' + duration(elapsed(current, now)) : paused.length ? '有 ' + paused.length + ' 项计时已暂停' : '';
      const controls = $('mw-live-controls'), shown = current || paused[0];
      if (controls) { const signature = shown ? shown.id + ':' + shown.status : ''; if (controls.dataset.session !== signature) { controls.dataset.session = signature; const ref = shown && esc(JSON.stringify(shown.ref)); controls.innerHTML = shown ? (shown.status === 'running' ? '<button class="btn btn-small" data-schedule-command="pause" data-schedule-ref="' + ref + '">暂停</button>' : '<button class="btn btn-small" data-schedule-command="start" data-session-id="' + esc(shown.id) + '" data-schedule-ref="' + ref + '">继续</button>') + '<button class="btn btn-small" data-schedule-command="end" data-schedule-ref="' + ref + '">结束</button>' : ''; } }
      const back = $('schedule-active'); if (back) back.hidden = !current && !paused.length;
      document.querySelectorAll('[data-inline-session]').forEach(el => { const s = d.sessions.find(x => x.id === el.dataset.inlineSession); if (s) el.textContent = (s.status === 'running' ? '计时中 ' : s.status === 'paused' ? '已暂停 ' : '已结束 ') + duration(elapsed(s, now)); });
      if (!mode || document.hidden || !$('view-tasks')?.classList.contains('active')) return;
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
      const activeIndex = new Map(); (schedule.sessions || []).filter(s => s.status !== 'ended').forEach(s => activeIndex.set(key(s.ref), s));
      summaryCache = { schedule, revision: data._storageRevision, index, activeIndex };
    }
    const plans = summaryCache.index.get(key(ref)) || [];
    return plans.slice(0, 2).map(p => p.day.slice(5) + ' ' + time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : '')).join('；') + (plans.length > 2 ? ' 等' + plans.length + '段' : '');
  }
  function rowControls(ref) {
    try { const r = canonical(ref), encoded = esc(JSON.stringify(r)), summary = planSummary(r);
      const session = summaryCache?.schedule === S().data().memoSchedule ? summaryCache.activeIndex?.get(key(r)) : null;
      const command = (act, text) => '<button type="button" class="btn btn-small" data-schedule-command="' + act + '" data-schedule-ref="' + encoded + '"' + (session ? ' data-session-id="' + esc(session.id) + '"' : '') + '>' + text + '</button>';
      return '<span class="schedule-row-tools">' + command('plan', summary ? '修改／追加时间' : '安排时间') + (session ? '<strong class="schedule-inline-status" data-inline-session="' + esc(session.id) + '">' + (session.status === 'running' ? '计时中 ' : '已暂停 ') + duration(elapsed(session)) + '</strong>' + command(session.status === 'running' ? 'pause' : 'start', session.status === 'running' ? '暂停' : '继续') + command('end', '结束') : isDone({ ref: r }) ? '<small>已完成</small>' : command('start', '开始计时')) + (summary ? '<small class="schedule-row-summary">' + esc(summary) + '</small>' : '') + '</span>';
    } catch (_) { return '<small>时间安排暂不可用，请先备份</small>'; }
  }
  function arrange(ref, day) {
    const found = resolve(ref); if (!found) return App.ui.toast('任务已移动或删除');
    selectedDay = day || found.ref.day || selectedDay || M().naturalDay();
    const plans = state().items.filter(p => !p.deleted && key(p.ref) === key(found.ref));
    if (!plans.length) return choosePlan(null, found.ref);
    App.ui.openModal('任务时间安排 · ' + found.task.text, plans.map(p => '<div class="memo-queue-row"><strong>' + esc(p.day + ' ' + time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + '</strong><button class="btn btn-small" data-act="edit-plan" data-id="' + esc(p.id) + '">修改</button></div>').join(''), '<button class="btn btn-primary" data-act="add-plan">＋ 再安排一段</button><button class="btn" data-act="close">关闭</button>');
    App.ui.bindActions({ 'edit-plan': b => choosePlan(b.dataset.id), 'add-plan': () => choosePlan(null, found.ref), close: App.ui.closeModal });
  }
  function legacyModal(id) {
    const day = selectedDay, entry = id != null && legacyRecords(day).find(x => x.id === id), old = entry?.record;
    const m = App.ui.openModal(old ? '旧时间记录' : '补记时间记录', '<p class="hint">保留原记录来源；这里的时段不会自动算作新执行计时。</p><label for="sl-content">内容</label><textarea id="sl-content" class="memo-action-text"></textarea><div class="schedule-fields"><label>开始<input type="time" id="sl-start" aria-label="记录开始时间"></label><label>结束<input type="time" id="sl-end" aria-label="记录结束时间"></label><label>记录时长（分钟）<input type="number" min="0" id="sl-minutes" aria-label="记录时长"></label></div><p id="sl-error" role="alert"></p>' + (old?.hourPlanId ? '<p class="hint">这是一条小时代汇总，独立展示，不与下属记录重复累计。</p>' : ''), '<button class="btn" data-act="close">关闭</button>' + (old ? '<button class="btn" data-act="details">来源详情</button><button class="btn" data-act="hide">' + (old.memoHidden ? '恢复显示' : '隐藏记录') + '</button>' : '') + '<button class="btn btn-primary" data-act="save">保存记录</button>', { lock: true });
    const q = sel => m.querySelector(sel); q('#sl-content').value = old?.content || ''; q('#sl-start').value = S().hhmmOf(old?.start ?? 720); q('#sl-end').value = S().hhmmOf(old?.end ?? 750); q('#sl-minutes').value = old?.minutes ?? 30; q('#sl-content').focus();
    async function save(button, hide) {
      button.disabled = true;
      try { const saved = await App.memoActions.commit(() => {
        const list = S().getDay(day).timeline;
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
  function render() {
    const root = $('memo-schedule-panel'); if (!root) return;
    try {
      selectedDay = selectedDay || M().naturalDay(); const d = state(), now = Date.now(), f = frame(selectedDay, now), records = visibleRecords(selectedDay, now); root.dataset.frameFrom = String(f.from); root.dataset.completionCount = String(records.completions.length); App.timeline?.setDate(selectedDay);
      function event(startMs, endMs, props) { const start = Math.max(f.from, (startMs - f.dayMs) / 60000), end = Math.min(f.to, (endMs - f.dayMs) / 60000); return end >= start && start <= f.to && end >= f.from ? Object.assign({ start, end: Math.max(start + .001, end), realEnd: end }, props) : null; }
      const planned = records.plans.map(p => event(p.start, p.end ?? p.start, { title: find(p.ref)?.text || p.title, type: p.type, card: 'p-' + p.id, id: p.id })).filter(Boolean), actual = [];
      records.sessions.forEach(s => s.chunks.forEach((c, i) => { const e = event(c.start, c.end ?? now, { title: s.title, type: 'span', card: 's-' + s.id, id: s.id + '-' + i, live: c.end == null ? c.start : null }); if (e) actual.push(e); }));
      if (showLegacy) records.legacy.forEach(x => { const r = x.record; if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) return; const e = event(f.dayMs + r.start * 60000, f.dayMs + r.end * 60000, { title: r.content, type: 'span', card: 'l-' + x.id, id: x.id, legacy: true, aggregate: !!r.hourPlanId }); if (e) actual.push(e); });
      records.completions.forEach(e => { const marker = event(Date.parse(e.at), Date.parse(e.at), { title: '✓ ' + time(Date.parse(e.at)) + ' 勾选完成 · ' + e.title, type: 'point', card: 'c-' + e.id, id: e.id, completed: true }); if (marker) actual.push(marker); });
      const pointGroups = [];
      function groupPoints(list) { const groups = new Map(), result = []; list.forEach(e => { if (e.type !== 'point') return result.push(e); const k = Math.floor(e.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }); groups.forEach(items => { if (items.length === 1) result.push(items[0]); else { const index = pointGroups.push(items) - 1; result.push(Object.assign({}, items[0], { group: index, title: S().hhmmOf(Math.floor(items[0].start)) + ' 同刻 ' + items.length + ' 项（展开）' })); } }); return result; }
      function blocks(list) { list = groupPoints(list); let labelEnd = []; return columns(list.map(e => Object.assign({}, e, { end: Math.max(e.end, e.start + (e.type === 'point' || (e.realEnd - e.start) * f.scale < 24 ? 28 / f.scale : 0)) }))).map(e => { const height = Math.max(2, (e.realEnd - e.start) * f.scale), short = height < 24 || e.type === 'point'; const anchor = (e.start - f.from) * f.scale, labelTop = short ? Math.max(anchor, labelEnd[e.column] || 0) : anchor; labelEnd[e.column] = labelTop + (short ? 28 : height); 
        return '<button type="button" class="schedule-block ' + (e.legacy ? 'schedule-legacy' : 'schedule-new') + (e.type === 'point' ? ' schedule-point' : '') + (e.completed ? ' schedule-completed' : '') + (short ? ' schedule-short' : '') + (e.aggregate ? ' schedule-aggregate' : '') + '" style="top:' + (e.start - f.from) * f.scale + 'px;--label-offset:' + (labelTop - anchor) + 'px;height:' + height + 'px;left:' + e.column * 100 / e.columns + '%;width:calc(' + 100 / e.columns + '% - 5px)" data-sc="' + (e.group == null ? 'card' : 'point-group') + '" data-group="' + (e.group ?? '') + '" data-card="' + esc(e.card) + '" title="' + esc(e.title) + '" aria-label="查看：' + esc(e.title) + '"' + (e.live != null ? ' data-live-start="' + e.live + '"' : '') + '><span>' + esc(e.type === 'point' && !e.completed && e.group == null ? S().hhmmOf(Math.round(e.start)) + ' ' + e.title : e.title) + '</span></button>';
      }).join(''); }
      const status = { running: '执行中', paused: '已暂停', ended: '本段已结束' };
      const button = (act, id, text, primary = false) => '<button class="btn btn-small' + (primary ? ' btn-primary' : '') + '" data-sc="' + act + '" data-id="' + esc(id) + '">' + text + '</button>';
      const plannedKeys = new Set(records.plans.map(p => key(p.ref))), waiting = sources().filter(x => !plannedKeys.has(key(x.ref)) && !isDone({ ref: x.ref }));
      root.innerHTML = '<div class="schedule-header"><h2>时间轴</h2><div class="memo-queue-actions">' + button('add', '', '＋ 安排时间', true) + button('legacy-add', '', '补记时段') + '</div></div><p class="hint schedule-explanation">北京时间自然日；笔记仍按04:00分日。蓝色为计划，绿色为执行，灰色为旧记录；小时代汇总不重复累计。</p><div class="schedule-toolbar"><input type="date" id="schedule-date" aria-label="时间线日期" data-transient="true" value="' + selectedDay + '">' + button('today', '', '今天') + button('now', '', '现在') + '<select id="schedule-view" aria-label="时间轴视图"><option value="compare">图表：计划／执行</option><option value="plan">图表：计划</option><option value="actual">图表：执行／旧记录</option></select><select id="schedule-range" aria-label="显示时间范围"><option value="4">附近4小时</option><option value="8">附近8小时</option><option value="24">全天</option></select>' + button('prev', '', '前一段') + button('next', '', '后一段') + '</div><details class="schedule-filters"><summary>筛选与备份</summary><input type="search" id="schedule-keyword" aria-label="筛选时间记录" placeholder="搜索任务或记录" data-transient="true"><label><input type="checkbox" id="schedule-legacy">显示旧时间记录</label><label><input type="checkbox" id="schedule-hidden">包括已隐藏记录</label>' + button('backup', '', '下载完整备份') + button('import', '', '导入完整备份') + button('csv', '', '导出旧记录CSV') + '</details><button class="btn btn-small" id="schedule-retry" data-sc="retry" hidden>重试保存</button><div class="schedule-chart" data-mode="' + view + '"><div class="schedule-legend"><span>时间</span><strong>实际</strong><strong>预期</strong></div><div class="schedule-axis" style="height:' + (f.to - f.from) * f.scale + 'px"><div class="schedule-hours">' + Array.from({ length: Math.floor((f.to - f.from) / 60) + 1 }, (_, i) => { const minute = f.from + i * 60; return '<span style="top:' + i * 60 * f.scale + 'px">' + S().hhmmOf(minute) + '</span>'; }).join('') + '</div><div class="schedule-lane schedule-actual-lane">' + blocks(actual) + '</div><div class="schedule-lane schedule-plan-lane">' + blocks(planned) + '</div><div id="schedule-now"></div></div></div><div class="schedule-cards">' + records.completions.map(e => '<article class="schedule-card" id="schedule-card-c-' + esc(e.id) + '"><span class="schedule-kind">勾选完成</span><strong>' + esc(e.title) + '</strong><p>' + esc(M().naturalDay(e.at) + ' ' + time(Date.parse(e.at))) + (e.sourceDay !== selectedDay ? ' · 任务日期 ' + esc(e.sourceDay) : '') + '</p></article>').join('') + records.plans.map(p => '<article class="schedule-card" id="schedule-card-p-' + esc(p.id) + '"><span class="schedule-kind">计划</span><strong>' + esc(find(p.ref)?.text || p.title) + '</strong><p>' + esc(time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + ' · <span data-plan-clock="' + esc(p.id) + '"></span></p><div class="memo-queue-actions">' + (find(p.ref) ? (isDone(p) ? '' : button('start', p.id, '开始本段')) + button('complete', p.id, isDone(p) ? '取消任务完成' : '完成任务', true) : '<span>原任务已移动或删除</span>') + button('edit', p.id, '改时间') + button('unschedule', p.id, '移除安排') + '</div></article>').join('') + records.sessions.map(s => '<article class="schedule-card" id="schedule-card-s-' + esc(s.id) + '"><span class="schedule-kind">执行' + (s.itemId ? ' · 关联计划' : ' · 未预先安排') + '</span><strong>' + esc(s.title) + '</strong><p>' + status[s.status] + ' · <span data-schedule-elapsed="' + esc(s.id) + '">' + duration(elapsed(s)) + '</span></p><p class="hint">' + s.chunks.map(c => esc(M().naturalDay(c.start) + ' ' + time(c.start) + '—' + (c.end == null ? '进行中' : (M().naturalDay(c.end) !== M().naturalDay(c.start) ? M().naturalDay(c.end) + ' ' : '') + time(c.end)))).join('；') + '</p><div class="memo-queue-actions">' + (s.status === 'running' ? button('pause-session', s.id, '暂停') : s.status === 'paused' ? button('resume-session', s.id, '继续计时') : '') + (s.status !== 'ended' ? button('stop-session', s.id, '结束本段') : '') + (find(s.ref) ? button('complete-session', s.id, isDone(s) ? '取消任务完成' : '完成任务') : '<span>原任务已删除；执行记录保留</span>') + '</div></article>').join('') + (showLegacy ? records.legacy.map(x => '<article class="schedule-card schedule-old-card" id="schedule-card-l-' + esc(x.id) + '"><span class="schedule-kind">' + (x.record.hourPlanId ? '小时代汇总 · 不重复累计' : x.record.auto ? '原版自动记录' : '手动时间记录') + (x.record.memoHidden ? ' · 已隐藏' : '') + '</span><strong>' + esc(x.record.content) + '</strong><p>' + esc(S().hhmmOf(x.record.start) + '—' + S().hhmmOf(x.record.end)) + ' · 原记录 ' + esc(x.record.minutes ?? 0) + ' 分钟</p>' + button('legacy-edit', x.id, '查看／编辑') + '</article>').join('') : '') + '</div><details class="card"><summary>待安排任务（' + waiting.length + '）</summary>' + waiting.map((x, i) => '<div class="memo-queue-row"><strong>' + esc(x.title) + '</strong> <button class="btn btn-small" data-sc="arrange" data-index="' + i + '">安排时间</button><button class="btn btn-small" data-sc="start-now" data-index="' + i + '">现在开始</button></div>').join('') + '</details>';
      const q = id => root.querySelector('#' + id); q('schedule-view').value = view; q('schedule-range').value = String(rangeHours); q('schedule-keyword').value = keyword; q('schedule-legacy').checked = showLegacy; q('schedule-hidden').checked = showHidden;
      q('schedule-date').onchange = e => { if (M().validDate(e.target.value)) { selectedDay = e.target.value; focusMinute = null; render(); } };
      q('schedule-view').onchange = e => { view = e.target.value; render(); }; q('schedule-range').onchange = e => { rangeHours = Number(e.target.value); render(); };
      q('schedule-keyword').onchange = e => { keyword = e.target.value; render(); }; q('schedule-legacy').onchange = e => { showLegacy = e.target.checked; render(); }; q('schedule-hidden').onchange = e => { showHidden = e.target.checked; render(); };
      root.onclick = e => {
        const b = e.target.closest('[data-sc]'); if (!b) return; const act = b.dataset.sc, id = b.dataset.id, p = d.items.find(p => p.id === id), session = d.sessions.find(s => s.id === id);
        if (act === 'add' || act === 'edit') return choosePlan(id);
        if (act === 'arrange') return arrange(waiting[Number(b.dataset.index)]?.ref);
        if (act === 'start-now') return startUI(waiting[Number(b.dataset.index)]?.ref);
        if (act === 'start' && p) return startUI(p.ref, p.id);
        if (act === 'complete' && p) return completeRef(p.ref);
        if (act === 'complete-session' && session) return completeRef(session.ref);
        if (act === 'pause-session' && session) return perform(() => pauseCore(session, Date.now()));
        if (act === 'resume-session' && session) return startUI(session.ref, session.itemId || null);
        if (act === 'stop-session' && session) return perform(() => stopSession(session, Date.now()));
        if (act === 'unschedule' && p) return App.ui.confirm('移除这项时间安排并结束它关联的活动计时？任务、积分与历史执行保留。', '移除安排', () => perform(() => { stopCore(p.id); p.deleted = true; }));
        if (act === 'legacy-add') return legacyModal(null);
        if (act === 'legacy-edit') return legacyModal(id);
        if (act === 'backup') return App.backup.exportCurrent();
        if (act === 'import') return App.backup.importFile();
        if (act === 'csv') return S().exportCSV();
        if (act === 'retry') return perform(() => {});
        if (act === 'today' || act === 'now') { selectedDay = M().naturalDay(); focusMinute = null; render(); return; }
        if (act === 'prev' || act === 'next') { focusMinute = Math.max(0, Math.min(1439, (f.from + f.to) / 2 + (act === 'prev' ? -1 : 1) * rangeHours * 60)); render(); return; }
        if (act === 'point-group') { const items = pointGroups[Number(b.dataset.group)] || []; App.ui.openModal('同刻任务', items.map(item => '<p>' + esc(item.title) + '</p>').join(''), '<button class="btn" data-act="close">关闭</button>'); App.ui.bindActions({ close: App.ui.closeModal }); return; }
        if (act === 'card') { const card = document.getElementById('schedule-card-' + b.dataset.card); card?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      };
      tick();
    } catch (e) { root.textContent = e.message; }
  }
  function setMode(value) { mode = value; $('memo-schedule-panel').hidden = !value; if (value) render(); }
  function open(options = {}) { selectedDay = options.day || selectedDay || M().naturalDay(); focusMinute = options.focusMinute ?? null; if (options.legacy) { showLegacy = true; view = 'compare'; } if (App.memoWorkspace && !options.workspace) return App.memoWorkspace.showPane('timeline', true, options); setMode(true); }
  function init() {
    selectedDay = M().naturalDay(); rangeHours = 4; view = 'compare'; $('task-list-switch').onclick = () => setMode(false); $('task-schedule-switch').onclick = () => open(); $('memo-trash-open').onclick = () => App.memoActions.trash();
    $('schedule-active').onclick = () => { const d = state(), session = active() || d.sessions.find(s => s.status === 'paused'); if (session) { selectedDay = M().naturalDay(session.chunks[session.chunks.length - 1].start); focusMinute = (session.chunks[session.chunks.length - 1].start - dayStart(selectedDay)) / 60000; App.app?.switchView('tasks'); open({ day: selectedDay, focusMinute, focusCard: 's-' + session.id }); } };
    document.addEventListener('click', e => { const button = e.target.closest('[data-schedule-command]'); if (!button) return; e.preventDefault(); e.stopImmediatePropagation(); try { const ref = JSON.parse(button.dataset.scheduleRef); const act = button.dataset.scheduleCommand; if (act === 'plan') return arrange(ref, ref.day || M().naturalDay()); if (act === 'pause' || act === 'end') return perform(() => state().sessions.filter(s => key(s.ref) === key(ref) && s.status !== 'ended').forEach(s => act === 'pause' ? pauseCore(s, Date.now()) : stopSession(s, Date.now()))); const previousText = button.textContent, session = state().sessions.find(s => s.id === button.dataset.sessionId); button.disabled = true; button.textContent = '保存中…'; return Promise.resolve(startUI(ref, session?.itemId || null)).finally(() => { if (button.isConnected) { button.disabled = false; button.textContent = previousText; } }); } catch (error) { App.ui.toast(error.message); } }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (mode) render(); tick(); } }); window.addEventListener('focus-storage', tick);
    if (interval) clearInterval(interval); interval = setInterval(tick, 1000); tick();
  }
  App.memoSchedule = { setDay: day => { if (M().validDate(day)) selectedDay = day; }, init, render, tick, open, rowControls, arrange, resolve, canonical, key, state, startCore, startRef, stopCore, stopRef, pause, savePlan, elapsed, columns, find, frame, visibleRecords, busy: () => { try { return state().sessions.some(s => s.status !== 'ended'); } catch (_) { return true; } } };
})();
