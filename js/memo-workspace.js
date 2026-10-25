/* Memo workspace: explicit task editing, stable queue order and daily project occurrences. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, $ = id => document.getElementById(id), esc = x => S().esc(String(x ?? ''));
  const names = { required: '必做任务', ideal: '理想任务', extra: '长期拓展' };
  let pane = 'today', taskDay, positions = {}, ready = false, lastDay, completionFocus;
  const projects = () => S().data().memoProjects || [];
  const button = (act, text, attrs = '', primary = false) => '<button type="button" class="btn btn-small' + (primary ? ' btn-primary' : '') + '" data-mw="' + act + '" ' + attrs + '>' + text + '</button>';
  function sortedQueue() { return (S().data().queue || []).slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (a.rank ?? (S().data().queue.indexOf(a) * 1024)) - (b.rank ?? (S().data().queue.indexOf(b) * 1024))); }
  function orderQueue() { S().data().queue = sortedQueue(); }
  function moveQueue(id, action) {
    orderQueue(); const q = S().data().queue, t = q.find(x => x.id === id); if (!t) throw new Error('任务已移动');
    const group = q.filter(x => !!x.pinned === !!t.pinned), i = group.indexOf(t);
    if (action === 'pin') { t.pinned = !t.pinned; t.rank = Math.min(0, ...q.filter(x => !!x.pinned === !!t.pinned).map(x => x.rank ?? 0)) - 1024; }
    else { const j = i + (action === 'up' ? -1 : 1); if (j < 0 || j >= group.length) return; [group[i], group[j]] = [group[j], group[i]]; group.forEach((x, n) => x.rank = n * 1024); }
    orderQueue();
  }
  async function commit(fn, retry = false) { if (A.memoActions.busy() && !retry) { A.ui.toast('请先重试保存当前操作'); return false; } try { if (await A.memoActions.commit(fn)) { $('mw-error').textContent = ''; render(); A.app.refreshStats(); A.memoSchedule.render(); return true; } }
    catch (e) { A.ui.toast(e.message); $('mw-error').textContent = e.message; const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重试保存'; retry.onclick = () => commit(() => {}, true); $('mw-error').appendChild(retry); } return false; }
  function refAttrs(ref) { return 'data-ref="' + esc(JSON.stringify(ref)) + '"'; }
  function doneFor(t, ref) { return ['project', 'daily'].includes(ref.kind) ? !!t.days?.[ref.day] : ref.kind === 'queue' ? !!(t.doneAt || t.doneDay) : !!t.done; }
  function card(t, ref, options = {}) {
    const done = doneFor(t, ref), attrs = refAttrs(ref);
    const points = score(t,ref);
    return '<article class="mw-task' + (done ? ' mw-done' : '') + '" data-mw-card data-score="'+scoreBand(points)+'" ' + attrs + '><div class="mw-task-heading">' + button('complete', done ? '✓' : '○', attrs + ' aria-label="' + (done ? '取消完成：' : '完成：') + esc(t.text) + '" aria-pressed="' + done + '"') + '<div class="mw-task-title"><strong>' + esc(t.text) + '</strong><div class="mw-task-meta">' + (ref.kind === 'queue' ? '<span>' + (t.pinned ? '置顶 · ' : '') + (options.number ? '第' + options.number + '项' : '已安排') + '</span>' : ref.kind === 'project' ? '<span>每日推进 · ' + esc(ref.day) + '</span>' : '') + (points != null ? '<span>＋' + esc(points) + '分</span>' : '') + '</div></div>' + button('edit', '编辑', attrs + ' aria-label="编辑：' + esc(t.text) + '"') + '</div><div class="mw-task-timing">' + A.memoSchedule.rowControls(ref) + '</div>' +
      (true ? '<div class="mw-task-extras">' + (['task','queue'].includes(ref.kind) && (!done || t.overdueEventId) ? button('assign', done ? '安排与扣分记录' : ref.kind === 'queue' ? (t.assignment ? '调整今日安排' : '安排到今天') : '调整安排', attrs) : '') + (!done && ['task','queue'].includes(ref.kind) && (t.originalDay || (t.assignment?.day || ref.day) < M().userDay()) ? button('backfill', '补记完成', attrs) : '') + (t.originalDay ? '<small class="mw-late">' + esc(A.memoFlow.lateLabel(t)) + '</small>' : '') + (t.assignment ? '<small>' + esc(t.assignment.day + ' · ' + names[t.assignment.list]) + '</small>' : '') + (t.note ? '<details class="mw-note"><summary>备注</summary><p>' + esc(t.note) + '</p></details>' : '') + (options.reorder ? '<details class="mw-manage"><summary>更多操作</summary><div>' + button('pin', t.pinned ? '取消置顶' : '置顶', attrs) + button('up', '上移', attrs) + button('down', '下移', attrs) + '</div></details>' : '') + '</div>' : '') + '</article>';
  }
  function taskSection(items) {
    const open = items.filter(x => !doneFor(x.task, x.ref)), done = items.filter(x => doneFor(x.task, x.ref));
    return open.map(x => card(x.task, x.ref)).join('') + (!open.length ? '<p class="hint mw-empty">暂无未完成任务</p>' : '') + (done.length ? '<details class="mw-completed"><summary>已完成（' + done.length + '）</summary>' + done.map(x => card(x.task, x.ref)).join('') + '</details>' : '');
  }
  function score(t,ref){if(ref.list==='required'||t.assignment?.list==='required')return null;if(ref.kind==='project')return Math.max(0,Number(t.points)||0);return Math.max(0,Number(t.points??(ref.kind==='queue'?S().settings().queuePoints??5:ref.list==='ideal'?S().settings().idealPoints??10:S().settings().extPoints??5))||0);}
  function scoreBand(n){return n===null?'group':n===0?'zero':n<5?'low':n<10?'medium':'high';}
  function taskItems(day,list){
    const items=(S().getDay(day).tasks[list]||[]).filter(t=>!t.fromQueue&&!t.fromDaily&&!t.memoProjectId&&!t.memoMovedTo&&!t.memoDismissed).map(task=>({task,ref:{kind:'task',id:task.id,day,list}}));
    A.memoFlow?.assigned(day,list).forEach(task=>items.push({task,ref:{kind:'queue',id:task.id}}));
    if(list==='extra')projects().filter(p=>!p.archived&&(!p.createdDay||p.createdDay<=day)).forEach(task=>items.push({task,ref:{kind:'project',id:task.id,day}}));
    const seen=new Set();const result=items.filter(x=>{const found=A.memoSchedule.resolve(x.ref);if(!found)return false;const ref=found.ref,key=A.memoSchedule.key(ref);x.task=found.task;if(seen.has(key))return false;seen.add(key);x.ref=ref;return true;});if(list==='extra')return result.map((x,i)=>({x,i})).sort((a,b)=>Number(doneFor(a.x.task,a.x.ref))-Number(doneFor(b.x.task,b.x.ref))||(!doneFor(a.x.task,a.x.ref)?score(b.x.task,b.x.ref)-score(a.x.task,a.x.ref):0)||a.i-b.i).map(v=>v.x);return result;
  }
  // Calendar's original compact columns and row markup, without mutation controls.
  function overviewHTML(day){
    const dt=new Date(day+'T12:00:00+08:00'),wd=['日','一','二','三','四','五','六'][dt.getUTCDay()];
    let html='<section class="card mw-overview"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">🗓 '+Number(day.slice(5,7))+'月'+Number(day.slice(8))+'日 周'+wd+'</h3></div><div class="cal-cols" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    [['required','✅ 必须'],['ideal','⭐ 理想'],['extra','🌱 拓展']].forEach(([list,name])=>{
      const items=taskItems(day,list);
      html+='<div class="cal-col" data-overview-list="'+list+'" tabindex="0" role="group" aria-label="'+names[list]+'，点击空白添加任务" style="border:1px solid var(--line);border-radius:10px;padding:9px 10px"><div class="cal-col-head" style="font-size:13px;font-weight:700;margin-bottom:6px">'+name+' <span class="tag">'+items.length+'</span></div>';
      items.forEach(({task:t,ref})=>{
        html+='<div class="cal-task'+(doneFor(t,ref)?' done':'')+'" data-score="'+scoreBand(score(t,ref))+'" data-overview-ref="'+esc(JSON.stringify(ref))+'" tabindex="0" role="button" aria-label="打开任务：'+esc(t.text)+'" style="border-bottom:1px dashed var(--line);padding:6px 2px"><span class="t-text" title="'+esc(t.text)+'" style="font-size:13.5px;word-break:break-all">'+esc(t.text)+(doneFor(t,ref)?' ✓':'')+(A.tasks?.carryTagHTML?.(t)||'')+(A.tasks?.lecTagHTML?.(t)||'')+'</span>';
        if(t.originalDay&&!doneFor(t,ref))html+='<span class="ov-late" title="'+esc(A.memoFlow.lateLabel(t))+'">顺延</span>';
        if(t.standard)html+='<div class="t-std" style="font-size:11.5px;color:#f59e0b;margin-top:2px">📌 标准：'+esc(t.standard)+'</div>';
        (t.groups||[]).forEach(g=>{const subs=g.subs||[];html+='<div class="t-ctx grp">🧩 '+esc(g.name||'任务组')+(subs.length?'（'+subs.filter(x=>x.done===true).length+'/'+subs.length+'）':'')+'</div>';subs.forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});});
        (t.subs||[]).forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+'（限'+esc(x.minutes)+'分）'+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});
        html+='</div>';
      });if(list==='required')html+=A.memoGoals?.html(day,true)||'';html+='</div>';
    });return html+'</div></section>';
  }
  function overviewClick(e,day){
    const goal=e.target.closest('[data-goal]');if(goal){e.preventDefault();e.stopImmediatePropagation();return A.memoGoals.editor(goal.dataset.goal);}
    if(window.getSelection()?.toString())return;
    const task=e.target.closest('[data-overview-ref]'),col=e.target.closest('[data-overview-list]');if(!col)return;
    e.preventDefault();e.stopImmediatePropagation();if(task)complete(JSON.parse(task.dataset.overviewRef));else{taskDay=day;editor(null,col.dataset.overviewList);}
  }
  function renderTasks() {
    taskDay = taskDay || M().userDay(); const day = S().getDay(taskDay), occurrenceDay = taskDay === M().userDay() ? M().userDay() : taskDay;
    const root = $('mw-today');
    root.innerHTML = '<div class="mw-toolbar"><input type="date" id="mw-day" aria-label="任务日期" value="' + esc(taskDay) + '">' + button('yesterday','昨天') + button('today', '今天') + button('tomorrow', '明天') + '<small>北京时间04:00分日</small>' + button('add-required', '＋ 添加任务', '', true) + button('ddl', '截止日期', 'id="mw-ddl"') + '</div>' + overviewHTML(taskDay) + '<div class="mw-full-list">' + ['required', 'ideal', 'extra'].map(list => {
      const items = taskItems(taskDay,list);
      return '<section class="mw-group" id="mw-column-'+list+'"><div class="mw-group-head"><h2>' + names[list] + '<small> · 待做 ' + items.filter(x => !doneFor(x.task, x.ref)).length + '</small></h2>' + button('add-' + list, '＋ 添加', 'aria-label="添加' + names[list] + '"') + '</div>' + taskSection(items) + (list==='required'?(A.memoGoals?.html(taskDay,false)||''):'') + (list === 'extra' ? '<details class="mw-project-help"><summary>项目说明与已停用项目</summary><p class="hint">一次性任务按日期保留；每日推进项目持续显示，可在编辑中停用。</p>' + (S().data().daily || []).filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-daily', '恢复基础任务', refAttrs({ kind: 'daily', id: p.id })) + '</p>').join('') + projects().filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-project', '恢复项目', refAttrs({ kind: 'project', id: p.id })) + '</p>').join('') + '</details>' : '') + '</section>';
    }).join('') + '</div>' + backlog() + ((S().data().daily || []).some(t => !t.archived) ? '<section class="mw-group"><h2>原有基础任务</h2>' + taskSection(S().data().daily.filter(t => !t.archived).map(task => ({ task, ref: { kind: 'daily', id: task.id, day: occurrenceDay } }))) + '</section>' : '');
    ['yesterday','today','tomorrow'].forEach((k,i)=>{const b=root.querySelector('[data-mw="'+k+'"]');b?.setAttribute('aria-pressed',String(taskDay===M().shiftDay(M().userDay(),i-1)));});
    A.ms?.refresh();
    $('mw-day').onchange = e => { if (M().validDate(e.target.value)) { taskDay = e.target.value; renderTasks(); } };
  }
  function renderQueue() {
    const all = sortedQueue().filter(t=>!t.memoDismissed), q = all.filter(t => !t.assignment), assigned = all.filter(t => t.assignment), done = S().data().queueDone || [];
    $('mw-queue').innerHTML = '<div class="mw-group-head"><h2>任务队列</h2>' + button('add-queue', '＋ 添加任务', '', true) + '</div><div class="mw-queue-grid">' + q.map((t, i) => card(t, { kind: 'queue', id: t.id }, { number: i + 1, first: i === 0, reorder: true })).join('') + '</div>' + (!q.length ? '<p class="hint">添加准备做的任务，再安排顺序。</p>' : '') + (assigned.length ? '<details class="mw-assigned"><summary>已安排（' + assigned.length + '）</summary>' + assigned.map(t => card(t, { kind: 'queue', id: t.id }, { number: '已安排', reorder: true })).join('') + '</details>' : '') + '<details><summary>已完成（' + done.length + '）</summary>' + done.slice(0, 100).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已完成' })).join('') + '</details>';
  }
  function preserve(renderFn) {
    const root = $(pane === 'queue' ? 'mw-queue' : 'mw-today'), disclosures = new Set();
    const detailKey = el => (el.closest('[data-mw-card]')?.dataset.ref || root?.id) + ':' + (el.classList.contains('mw-completed') ? el.closest('.mw-group')?.querySelector('h2')?.textContent.replace(/ · 待做.*/, '') : el.querySelector('summary')?.textContent);
    root?.querySelectorAll('details[open]').forEach(el => disclosures.add(detailKey(el)));
    const anchor = [...(root?.querySelectorAll('[data-mw-card]') || [])].find(el => el.getBoundingClientRect().bottom > 0), ref = anchor?.dataset.ref, offset = anchor?.getBoundingClientRect().top;
    renderFn();
    root?.querySelectorAll('details').forEach(el => { if (disclosures.has(detailKey(el))) el.open = true; });
    if (ref && document.body.dataset.view === 'tasks' && pane !== 'timeline') requestAnimationFrame(() => { const next = [...root.querySelectorAll('[data-mw-card]')].find(el => el.dataset.ref === ref); if (next) window.scrollBy(0, next.getBoundingClientRect().top - offset); });
  }
  function render() { if (!ready) return; preserve(() => { renderTasks(); renderQueue(); renderHistory(); renderPending(); applyPane(); }); A.memoSchedule.tick?.(); A.app?.refreshStats();
    if (completionFocus) { const ref = completionFocus.ref, t = A.memoSchedule.find(ref); if (t && doneFor(t, ref) !== completionFocus.before) { const cardEl = [...document.querySelectorAll('[data-mw-card]')].find(el => el.dataset.ref === JSON.stringify(ref)); const folded = cardEl?.closest('.mw-completed:not([open])'); (folded?.querySelector('summary') || cardEl?.querySelector('[data-mw="complete"]'))?.focus({ preventScroll: true }); completionFocus = null; } }
  }
  function applyPane() { ['today', 'queue', 'history', 'pending'].forEach(p => { const el = $('mw-' + p); el.hidden = p !== pane; document.querySelector('[data-mw-pane="' + p + '"]')?.setAttribute('aria-pressed', String(p === pane)); });
    const sessions = A.memoSchedule.state().sessions, shown = sessions.find(s => s.status === 'running') || sessions.find(s => s.status === 'paused');
    const container = pane === 'timeline' ? null : $(pane === 'queue' ? 'mw-queue' : 'mw-today');
    $('mw-live')?.classList.toggle('mw-local-timer', !!shown && [...(container?.querySelectorAll('[data-mw-card]') || [])].some(el => A.memoSchedule.key(JSON.parse(el.dataset.ref)) === A.memoSchedule.key(shown.ref)));
  }
  function showPane(next, save = true, options = {}) {
    if (next === 'timeline') { A.app.switchView('timeline'); return A.memoSchedule.open(Object.assign({}, options, { workspace: true })); }
    if (save) positions[pane] = window.scrollY;
    pane = next; applyPane(); if (next === 'timeline') A.memoSchedule.open(Object.assign({}, options, { workspace: true }));
    requestAnimationFrame(() => { if (options.focusCard) $('schedule-card-' + options.focusCard)?.scrollIntoView({ block: 'center' }); else window.scrollTo({ top: positions[next] || 0 }); });
  }
  function enter(next, day) { if(day && M().validDate(day)){taskDay=day;render();}  if (next) showPane(next, false); else { applyPane(); requestAnimationFrame(() => window.scrollTo({ top: positions[pane] || 0 })); } }
  function leave() { positions[pane] = window.scrollY; }
  function timingFields() { return '<details open><summary>安排时间（选填）</summary><div class="schedule-fields"><label>开始／时间点<input type="time" id="mw-start"></label><label>结束（选填）<input type="time" id="mw-end"></label></div><label><input type="checkbox" id="mw-next">次日结束</label><p class="hint">只填开始即为时间点；都不填则暂不安排。</p></details>'; }
  function saveTiming(modal, ref, title, day) {
    const start = modal.querySelector('#mw-start').value, end = modal.querySelector('#mw-end').value;
    if (!start && !end) return;
    if (!start) throw new Error('请补充开始时间');
    A.memoSchedule.savePlan({ ref, title, day, type: end ? 'span' : 'point', start: Date.parse((start < '04:00' ? M().shiftDay(day,1) : day) + 'T' + start + ':00+08:00'), end: end ? Date.parse(((modal.querySelector('#mw-next').checked || end < '04:00') ? M().shiftDay(day, 1) : day) + 'T' + end + ':00+08:00') : null });
  }
  function editor(ref, list) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const existing = ref && A.memoSchedule.find(ref), day = ref?.day || taskDay || M().userDay(), kind = ref?.kind || (list === 'queue' ? 'queue' : 'task');
    const m = A.ui.openModal(existing ? '编辑任务' : '添加' + (names[list] || '队列任务'), (!existing && kind === 'task' ? '<label>任务栏目<select id="mw-list">' + Object.keys(names).map(k => '<option value="' + k + '"' + (k === list ? ' selected' : '') + '>' + names[k] + '</option>').join('') + '</select></label>' : '') + '<label for="mw-title">任务名称</label><textarea id="mw-title" rows="2"></textarea><label for="mw-note-edit">备注（选填）</label><textarea id="mw-note-edit" rows="2"></textarea>' +
      (existing && kind === 'task' && ref?.list === 'required' ? '' : '<label for="mw-points">完成积分</label><input type="number" id="mw-points" min="0">') + (!existing && kind === 'task' ? '<fieldset id="mw-repeat-wrap"><legend>长期拓展完成方式</legend><label><input type="radio" name="mw-repeat" value="once">一次性完成</label><label><input type="radio" name="mw-repeat" value="daily" checked>每日推进</label></fieldset>' : '') +
      '<label>预计用时（分钟，选填）<input id="mw-estimate" type="number" min="0" max="1440"></label>' + timingFields() + (existing ? '<p class="hint">这里可追加一段安排；修改已有时间请点卡片上的“修改／追加时间”。</p>' : '') + '<p id="mw-form-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button>' + (existing ? '<button class="btn btn-danger" data-act="delete">' + (kind === 'project' || kind === 'daily' ? '停用' : '删除') + '</button>' + (kind === 'task' && ref.list === 'extra' ? '<button class="btn" data-act="convert">转为每日推进</button>' : '') : '') + '<button class="btn btn-primary" data-act="save">保存</button>', { lock: true });
    const q = s => m.querySelector(s); q('#mw-title').value = existing?.text || ''; q('#mw-note-edit').value = existing?.note || ''; if (q('#mw-points')) q('#mw-points').value = existing?.points ?? (kind === 'queue' ? S().settings().queuePoints ?? 5 : list === 'ideal' || ref?.list === 'ideal' ? S().settings().idealPoints ?? 10 : S().settings().extPoints ?? 5);
    q('#mw-estimate').value = existing?.estimatedMinutes || '';
    const selectList = q('#mw-list');
    if (selectList) { let pointsEdited = false; q('#mw-points').addEventListener('input', () => { pointsEdited = true; }); const update = () => { if (!pointsEdited) q('#mw-points').value = selectList.value === 'ideal' ? S().settings().idealPoints ?? 10 : S().settings().extPoints ?? 5; q('#mw-repeat-wrap').hidden = selectList.value !== 'extra'; q('#mw-points').hidden = selectList.value === 'required'; q('#mw-points').previousElementSibling.hidden = selectList.value === 'required'; }; selectList.onchange = update; update(); }
    q('#mw-title').focus();
    if (kind === 'project') { const hist = document.createElement('details'); hist.innerHTML = '<summary>每日完成记录</summary>' + Object.keys(existing.days || {}).sort().reverse().map(k => '<button type="button" class="btn" data-project-day="' + esc(k) + '">' + esc(k) + ' · 取消本日完成</button>').join(''); q('#mw-form-error').before(hist); hist.querySelectorAll('[data-project-day]').forEach(b => b.onclick = () => A.memoActions.project(ref.id, b.dataset.projectDay)); }
    async function save(b, convert = false) {
      b.disabled = true;
      try { if (await A.memoActions.commit(() => {
        const text = q('#mw-title').value.trim(); if (!text) throw new Error('请填写任务名称'); if (!existing && text.includes('\n')) throw new Error('一次添加一个任务，正文说明可写在备注中');
        const selectedList = q('#mw-list')?.value || list;
        const d = S().data(), isProject = kind === 'project' || convert || (selectedList === 'extra' && q('[name="mw-repeat"]:checked')?.value === 'daily');
        let t = existing, targetRef = ref;
        if (isProject && kind !== 'project') {
          if (existing?.memoProjectId) throw new Error('此任务已转换，请编辑对应每日项目');
          if (!d.memoProjects) d.memoProjects = [];
          t = { id: S().uid(), text, days: {}, createdAt: new Date().toISOString(), createdDay: day, source: existing ? { id: existing.id, day, list: ref.list } : null };
          d.memoProjects.push(t); targetRef = { kind: 'project', id: t.id, day: ref?.day || (day === M().userDay() ? M().userDay() : day) }; t.createdDay = targetRef.day;
          if (existing) { if (existing.done) throw new Error('已完成的旧任务保留历史，请新建每日推进项目'); A.memoSchedule.stopRef(ref); existing.memoProjectId = t.id; }; // Preserve historical source and its ledger; never infer a merge by title.
        } else if (!t) {
          t = { id: S().uid(), createdAt: new Date().toISOString() };
          if (kind === 'queue') { (d.queue || (d.queue = [])).push(t); targetRef = { kind: 'queue', id: t.id }; }
          else { S().getDay(day).tasks[selectedList].push(t); targetRef = { kind: 'task', id: t.id, list: selectedList, day }; }
        }
        t.estimatedMinutes = Math.min(1440, Math.max(0, Number(q('#mw-estimate').value) || 0)); t.dateBasis = 'user';
        t.text = text; t.note = q('#mw-note-edit').value; if (q('#mw-points')) t.points = Math.max(0, Number(q('#mw-points').value) || 0);
        saveTiming(m, targetRef, text, targetRef.kind === 'project' ? targetRef.day : day);
      })) { A.ui.closeModal(); render(); A.memoSchedule.render(); } }
      catch (e) { q('#mw-form-error').textContent = e.message; b.textContent = A.memoActions.busy() ? '重试保存' : '保存'; }
      finally { b.disabled = false; }
    }
    A.ui.bindActions({ cancel: () => { if (!A.memoActions.busy()) A.ui.closeModal(); }, save, convert: b => save(b, true), delete: () => {
      if (A.memoActions.busy()) return;
      if (kind === 'project' || kind === 'daily') A.ui.confirm('停用后不再列入当前清单，历史完成、积分和笔记保留，可恢复。', '停用项目', () => commit(() => { existing.archived = true; const state = A.memoSchedule.state(); state.sessions.filter(s => s.ref.kind === kind && s.ref.id === ref.id).forEach(s => A.memoSchedule.stopRef(s.ref)); state.items.filter(p => p.ref.kind === kind && p.ref.id === ref.id && p.start >= Date.now()).forEach(p => p.suspendedByArchive = true); }).then(ok => { if (ok) A.ui.closeModal(); }));
      else A.memoActions.deleteTask(ref);
    } });
  }
  function complete(ref) { ref = A.memoSchedule.canonical(ref); const t = A.memoSchedule.find(ref); if (t) completionFocus = { ref, before: doneFor(t, ref) }; if (ref.kind === 'task') A.memoActions.task(ref.list, ref.id, ref.day); else if (ref.kind === 'queue') A.memoActions.queue(ref.id); else if (ref.kind === 'daily') A.memoActions.daily(ref.id, ref.day); else A.memoActions.project(ref.id, ref.day); }

  function datedTasks() {
    const rows = [];
    Object.entries(S().data().days).forEach(([day, data]) => ['required', 'ideal', 'extra'].forEach(list => (data.tasks[list] || []).filter(t => !t.fromQueue && !t.fromDaily && !t.memoProjectId).forEach(task => rows.push({ task, ref: { kind: 'task', id: task.id, day, list } }))));
    A.memoFlow?.queues().forEach(task => { if(task.assignment)rows.push({task,ref:{kind:'queue',id:task.id},day:task.assignment.day,list:task.assignment.list}); (task.assignmentHistory || []).filter(a=>a.day && a.list).forEach(a=>rows.push({task:Object.assign({},task,{memoMovedTo:{kind:'queue',id:task.id}}),ref:{kind:'queue',id:task.id},day:a.day,list:a.list})); });
    return rows;
  }
  function historyRow(x) {
    const t = x.task, day = x.day || x.ref.day, list = x.list || x.ref.list;
    const status = t.memoMovedTo ? '已重新安排' : t.memoDismissed ? '未完成 · 不再安排' : t.done || t.doneAt ? (t.backfillDay ? (t.backfillDay <= t.originalDay ? '补记按时完成' : '补记延期完成') : t.originalDay ? '延期完成' : '已完成') : '未完成';
    return '<article class="mw-history-row"><strong>' + esc(t.text) + '</strong><p>' + esc(day + ' · ' + names[list] + ' · ' + status + (status === '未完成' ? (day < S().data().memoFlow?.startedDay ? ' · 旧任务，待安排' : list !== 'required' ? ' · 待重新安排' : '') : '')) + '</p>' + (!t.memoMovedTo && !t.memoDismissed ? (t.done || t.doneAt ? button('open-day', '查看当天', refAttrs(Object.assign({}, x.ref, {day}))) : button('enqueue','加入队列',refAttrs(x.ref)) + button('backfill', '补记完成', refAttrs(x.ref)) + button('assign', '重新安排', refAttrs(x.ref)) + button('dismiss', '不再安排', refAttrs(x.ref))) : t.memoDismissed ? button('restore-pending', '恢复待安排', refAttrs(x.ref)) : '') + '</article>';
  }
  function backlog() {
    const rows = datedTasks().filter(x => (x.day || x.ref.day) < M().userDay() && !x.task.done && !x.task.doneAt && !x.task.memoMovedTo && !x.task.memoDismissed);
    return '<details class="mw-backlog"><summary>往日未完成（' + rows.length + '）</summary>' + rows.sort((a,b) => (a.day || a.ref.day).localeCompare(b.day || b.ref.day)).map(historyRow).join('') + '</details>';
  }
  function renderPending(){const rows=datedTasks().filter(x=>(x.day||x.ref.day)<M().userDay()&&!x.task.done&&!x.task.doneAt&&!x.task.memoMovedTo&&!x.task.memoDismissed);$('mw-pending').innerHTML='<h2>待重新安排 <small>'+rows.length+'</small></h2>'+ (rows.map(historyRow).join('')||'<p>暂无待重新安排任务</p>');document.querySelector('[data-mw-pane="pending"]').textContent='待重新安排 '+rows.length;}
  let historyFrom = '', historyTo = '', historyStatus = '', historyList = '';
  function renderHistory() {
    const root = $('mw-history'); if (!root) return;
    const rows = datedTasks().filter(x => { const day = x.day || x.ref.day, t = x.task, status = t.memoMovedTo ? 'moved' : t.memoDismissed ? 'dismissed' : t.done || t.doneAt ? 'done' : 'pending'; return (!historyFrom || day >= historyFrom) && (!historyTo || day <= historyTo) && (!historyStatus || historyStatus === status) && (!historyList || historyList === (x.list || x.ref.list)); });
    root.innerHTML = '<h2>任务历史</h2><div class="schedule-fields"><label>从<input type="date" id="mh-from" value="' + historyFrom + '"></label><label>至<input type="date" id="mh-to" value="' + historyTo + '"></label><label>栏目<select id="mh-list"><option value="">全部</option>' + Object.entries(names).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('') + '</select></label><label>状态<select id="mh-status"><option value="">全部</option><option value="pending">未完成</option><option value="done">已完成</option><option value="moved">已重新安排</option><option value="dismissed">不再安排</option></select></label></div>' + (rows.sort((a,b)=>(b.day || b.ref.day).localeCompare(a.day || a.ref.day)).map(historyRow).join('') || '<p>没有符合条件的任务</p>');
    $('mh-list').value=historyList; $('mh-status').value=historyStatus;
    ['from','to','list','status'].forEach(k => $('mh-'+k).onchange = e => { if(k==='from')historyFrom=e.target.value; if(k==='to')historyTo=e.target.value; if(k==='list')historyList=e.target.value; if(k==='status')historyStatus=e.target.value; renderHistory(); });
  }
  function assignmentEditor(ref) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const t = A.memoSchedule.find(ref); if (!t) return;
    const m = A.ui.openModal('安排 · ' + t.text, '<label>日期<input type="date" id="ma-day" value="'+M().userDay()+'"></label><label>栏目<select id="ma-list">'+Object.entries(names).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><p class="hint">同一任务只完成、奖励一次。必做按整组奖励；理想和一次性拓展使用任务分值。原计划与执行记录保留，新的具体时间请重新安排。</p><p id="ma-error" role="alert"></p>', '<button class="btn" data-act="cancel">关闭</button><button class="btn" data-act="queue">放回队列</button>' + (t.overdueEventId ? '<button class="btn" data-act="forgive">纠正错误扣分</button>' : '') + '<button class="btn btn-primary" data-act="save">安排</button>', {lock:true});
    m.querySelector('#ma-list').value = t.assignment?.list || ref.list || 'ideal';
    async function save(b, target) { b.disabled=true; try { if(await A.memoActions.commit(()=>A.memoFlow.moveCore(ref,m.querySelector('#ma-day').value,m.querySelector('#ma-list').value,target))) { A.ui.closeModal(); render(); A.memoSchedule.render(); } } catch(e) { m.querySelector('#ma-error').textContent=e.message; if(A.memoActions.busy()) b.textContent='重试保存'; } finally {b.disabled=false;} }
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:b=>save(b,'task'),queue:b=>save(b,'queue'),forgive:()=>{
      if(A.memoActions.busy())return;
      const reason=document.createElement('input'); reason.id='ma-reason'; reason.placeholder='说明实际按时完成或错误原因'; m.querySelector('#ma-error').before(reason);
      const b=m.querySelector('[data-act="forgive"]'); b.textContent='确认纠正'; b.onclick=async()=>{try{if(await A.memoActions.commit(()=>A.memoFlow.forgiveCore(ref,reason.value))){A.ui.closeModal();render();A.app.refreshStats();}}catch(e){m.querySelector('#ma-error').textContent=e.message;}};
    }});
  }

  function renderReview(day) {
    const root = $('review-card'); root.innerHTML = '<label>今日复盘</label><textarea id="mw-review-text" rows="6"></textarea><button class="btn btn-primary" id="mw-review-save">保存复盘</button><p id="mw-review-status" role="status"></p>';
    $('mw-review-text').value = day.review?.text || '';
    $('mw-review-save').onclick = async () => { const text = $('mw-review-text').value; if (await commit(() => { day.review = { text, at: new Date().toISOString() }; })) $('mw-review-status').textContent = '已保存'; };
  }
  function init() {
    ready = true; taskDay = M().userDay(); lastDay = taskDay;
    const root = $('view-tasks');
    const axis = document.createElement('section'); axis.id = 'view-memo-timeaxis'; axis.className = 'view'; document.querySelector('main').appendChild(axis); axis.appendChild($('memo-schedule-panel'));
    const error = document.createElement('button'); error.id = 'flow-save-error'; error.className = 'btn btn-danger'; error.hidden = true; document.querySelector('main').before(error);
    root.insertAdjacentHTML('afterbegin', '<div class="mw-tabs" role="group" aria-label="任务子页面">' + [['today','当天任务'],['queue','任务队列'],['pending','待重新安排']].map(([id, label]) => '<button class="btn" data-mw-pane="' + id + '">' + label + '</button>').join('') + '</div><p id="mw-error" role="alert"></p><div id="mw-today"></div><div id="mw-queue" hidden></div><div id="mw-history" hidden></div><div id="mw-pending" hidden></div>');
    // Keep legacy review content reachable, with mutation entries retired in memo mode.
    const review = document.createElement('section'); review.id = 'view-memo-review'; review.className = 'view'; review.innerHTML = '<h2>今日复盘</h2><p class="hint">完成和补记请在任务中操作，统一关联笔记、积分与时间轴。</p>'; $('review-card').parentNode.removeChild($('review-card')); review.appendChild(document.createElement('div')).id = 'review-card'; document.querySelector('main').appendChild(review);
    document.querySelectorAll('.mn-grid, header nav').forEach(el => el.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" data-view="memo-review">今日复盘</button>'));
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend', '<button class="btn" id="mw-trash">删除记录</button>'); $('mw-trash').onclick = () => A.memoActions.trash(); document.querySelector('#main-nav')?.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" id="mw-trash-desktop">删除记录</button>'); if ($('mw-trash-desktop')) $('mw-trash-desktop').onclick = () => A.memoActions.trash();
    document.querySelectorAll('[data-view="memo-review"]').forEach(b => b.onclick = () => { A.app.switchView('memo-review'); const d = S().getDay(M().userDay()); renderReview(d); });
    $('schedule-active').before($('schedule-live')); const live = document.createElement('div'); live.id = 'mw-live'; live.append($('schedule-live'), $('schedule-active')); const controls = document.createElement('span'); controls.id = 'mw-live-controls'; live.appendChild(controls); document.querySelector('main').before(live);
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend','<button class="btn" id="mw-open-history">任务历史</button>');$('mw-open-history').onclick=()=>{$('mn-sheet')?.classList.add('hidden');A.app.switchView('tasks');showPane('history');};
    root.querySelectorAll('[data-mw-pane]').forEach(b => b.onclick = () => showPane(b.dataset.mwPane));
    root.addEventListener('click', e => {
      const goal=e.target.closest('[data-goal]');if(goal){e.preventDefault();e.stopImmediatePropagation();return A.memoGoals.editor(goal.dataset.goal);}
      if(e.target.closest('.mw-overview'))return overviewClick(e,taskDay);
      const b = e.target.closest('[data-mw]'), cardEl = e.target.closest('[data-mw-card]');
      if (b) { e.preventDefault(); e.stopImmediatePropagation(); const act = b.dataset.mw, ref = b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
        if(act==='enqueue')return commit(()=>A.memoFlow.moveCore(ref,M().userDay(),'ideal','queue'));
        if(act==='goal-add')return A.memoGoals.editor();
        if(act==='goal-edit')return A.memoGoals.editor(b.dataset.id);
        if(act==='ddl')return A.ms.open();
        if(act==='column'){const col=$('mw-column-'+b.dataset.column);$('mw-today').querySelector('.mw-board').scrollTo({left:col.offsetLeft-col.parentElement.offsetLeft,behavior:'smooth'});return;}
        if (act.startsWith('add-')) return editor(null, act.slice(4));
        if (act === 'edit') return editor(ref);
        if (act === 'open-day') { taskDay = ref.day; showPane('today'); return render(); }
        if (act === 'backfill') return A.memoFlow.backfill(ref);
        if (act === 'assign') return assignmentEditor(ref);
        if (act === 'restore-pending') return commit(() => { const t = ref.kind==='queue' ? A.memoFlow.queues().find(t=>t.id===ref.id) : S().data().days[ref.day]?.tasks[ref.list]?.find(t=>t.id===ref.id); if(t)delete t.memoDismissed; });
        if (act === 'dismiss') return commit(() => { const t = A.memoSchedule.find(ref); if (t) { A.memoSchedule.stopRef(ref); t.memoDismissed = new Date().toISOString(); } });
        if (act === 'complete') return complete(ref);
        if (act === 'today' || act === 'tomorrow' || act === 'yesterday') { taskDay = act === 'today' ? M().userDay() : M().shiftDay(M().userDay(), act==='yesterday'?-1:1); return renderTasks(); }
        if (act === 'restore-daily') return commit(() => { S().data().daily.find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'daily' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (act === 'restore-project') return commit(() => { projects().find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'project' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (['pin', 'up', 'down'].includes(act)) return commit(() => moveQueue(ref.id, act));
      }
      if (cardEl && !e.target.closest('button,input,textarea,select,a,summary,details,[data-schedule-command]') && !window.getSelection()?.toString()) { e.stopImmediatePropagation(); editor(JSON.parse(cardEl.dataset.ref)); }
    }, true);
    root.addEventListener('keydown',e=>{if(e.target.matches('[data-overview-ref],[data-overview-list],[data-goal]')&&['Enter',' '].includes(e.key)&&!e.isComposing)overviewClick(e,taskDay);});
    A.tasks.renderAll = render; A.queue.render = () => preserve(renderQueue);
    setInterval(() => { const now = M().userDay(); if (now !== lastDay) { if (taskDay === lastDay) taskDay = now; lastDay = now; render(); } }, 30000);
    render();
  }
  A.memoWorkspace = { score, scoreBand, taskItems, overviewHTML, overviewClick, init, render, enter, leave, showPane, editor, sortedQueue, orderQueue, moveQueue, saveTiming, projects, renderHistory };
})();
