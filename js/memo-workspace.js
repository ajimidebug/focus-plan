/* Memo workspace: explicit task editing, stable queue order and daily project occurrences. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, $ = id => document.getElementById(id), esc = x => S().esc(String(x ?? ''));
  const names = { required: '必做任务', ideal: '理想任务', extra: '长期拓展' };
  let pane = 'today', taskDay, positions = {}, ready = false, lastDay, lastCivilDay, completionFocus;
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
    const points = score(t,ref), category = ref.list || t.assignment?.list || (ref.kind === 'project' ? t.memoCategoryDays?.[ref.day]||'extra' : 'queue');
    return '<article class="mw-task' + (done ? ' mw-done' : '') + '" data-mw-card data-carried="'+!!A.memoFlow.isCarried(t)+'" data-category="'+category+'" data-bounty="'+!!A.memoOrganize?.bounty(points)+'" data-score="'+scoreBand(points)+'" ' + attrs + '><div class="mw-task-heading">' + button('complete', done ? '✓' : '○', attrs + ' aria-label="' + (done ? '取消完成：' : '完成：') + esc(t.text) + '" aria-pressed="' + done + '"') + '<div class="mw-task-title"><strong>' + esc(t.text) + '</strong>' + scoreHTML(points) + '<div class="mw-task-meta">' + (ref.kind === 'queue' ? '<span>' + (t.pinned ? '置顶 · ' : '') + (options.number ? '第' + options.number + '项' : '已安排') + '</span>' : ref.kind === 'project' ? '<span>每日推进 · ' + esc(ref.day) + '</span>' : '') + (A.memoReview?.label(t)||'')+(A.memoRecurrence?.label(t)||'')+'</div></div>' + button('edit', '编辑', attrs + ' aria-label="编辑：' + esc(t.text) + '"') + '</div><div class="mw-task-timing">' + A.memoSchedule.rowControls(ref) + '</div>' +
      (true ? '<details class="mw-task-extras"><summary>更多操作</summary><div class="mw-task-secondary">' + (['task','queue'].includes(ref.kind) && (!done || t.overdueEventId) ? button('assign', done ? '安排与扣分记录' : ref.kind === 'queue' ? (t.assignment ? '调整今日安排' : '安排到今天') : '调整安排', attrs) : '') + (!done && ['task','queue'].includes(ref.kind) && (t.originalDay || (t.assignment?.day || ref.day) < M().userDay()) ? button('backfill', '补记完成', attrs) : '') + (A.memoFlow.isCarried(t) ? '<details class="mw-late-detail"><summary>顺延记录</summary><small>' + esc(A.memoFlow.lateLabel(t)) + '</small></details>' : '') + (t.assignment ? '<small>' + esc(t.assignment.day + ' · ' + names[t.assignment.list]) + '</small>' : '') + (done?A.memoSchedule.executionHTML((S().data().memoEvents||[]).find(e=>e.active&&e.kind===ref.kind&&e.sourceId===ref.id&&(ref.kind==='queue'||e.sourceDay===ref.day))?.timing):'') + (t.note ? '<details class="mw-note"><summary>备注</summary><p>' + esc(t.note) + '</p></details>' : '') + (options.reorder ? '<details class="mw-manage"><summary>更多操作</summary><div>' + button('pin', t.pinned ? '取消置顶' : '置顶', attrs) + button('up', '上移', attrs) + button('down', '下移', attrs) + '</div></details>' : '') + '</div></details>' : '') + '</article>';
  }
  function taskSection(items) {
    const open = items.filter(x => !doneFor(x.task, x.ref)), done = items.filter(x => doneFor(x.task, x.ref));
    return open.map(x => card(x.task, x.ref)).join('') + (!open.length ? '<p class="hint mw-empty">暂无未完成任务</p>' : '') + (done.length ? '<details class="mw-completed"><summary>已完成（' + done.length + '）</summary>' + done.map(x => card(x.task, x.ref)).join('') + '</details>' : '');
  }
  function score(t,ref){if((ref.list==='required'||t.assignment?.list==='required')&&!['project','daily'].includes(ref.kind))return null;if(ref.kind==='project')return Math.max(0,Number(t.points)||0);return Math.max(0,Number(t.points??(ref.kind==='queue'?S().settings().queuePoints??5:ref.list==='ideal'?S().settings().idealPoints??1:S().settings().extPoints??5))||0);}
  function scoreHTML(n){return n===null?'':(A.memoOrganize?.badge(n)||'')+'<small class="mw-score">+'+esc(n)+'分</small>';}
  function scoreBand(n){return n===null?'group':n===0?'zero':n<5?'low':n<10?'medium':'high';}
  function taskItems(day,list){
    return A.memoSchedule.columnItems(day,list).concat(A.memoFlow.deferred?.(day,list)||[]).map((x,i)=>({x,i})).sort((a,b)=>Number(a.x.done)-Number(b.x.done)||(!a.x.done&&list!=='required'?score(b.x.task,b.x.ref)-score(a.x.task,a.x.ref):0)||a.i-b.i).map(v=>v.x);
  }
  function deferredHTML(x,compact=false){
    const t=x.task,current=A.memoSchedule.find(x.currentRef),attrs='data-deferred-source="'+esc(JSON.stringify(x.ref))+'"';
    return '<article class="'+(compact?'cal-task':'mw-task')+' mw-deferred" '+attrs+'><strong>'+esc(t.text)+'</strong><small class="mw-deferred-status">'+esc(x.closed?'已补记至'+x.toDay+' · 本日安排结束':'未完成 · 已延期至'+x.toDay)+'</small>'+(x.legacy?'<small>旧延期记录，内容按现存记录展示</small>':'')+
      (!x.legacy?(t.subs||[]).concat((t.groups||[]).flatMap(g=>g.subs||[])).map(s=>'<small>'+esc((s.done===true?'✓ ':'○ ')+s.text)+'</small>').join(''):'')+
      (!compact&&t.note?'<details><summary>当时备注</summary><p>'+esc(t.note)+'</p></details>':'')+
      (current?'<div class="mw-deferred-actions"><button class="btn btn-small" data-deferred-open="'+esc(JSON.stringify(x.currentRef))+'">查看当前任务</button>'+(!current.done&&!current.doneAt?'<button class="btn btn-small" data-deferred-day="'+esc(x.ref.day)+'" data-deferred-backfill="'+esc(JSON.stringify(x.currentRef))+'">补记本日完成</button>':'')+'</div>':'')+'</article>';
  }
  function openDeferred(ref){const t=A.memoSchedule.find(ref),day=ref.day||t?.assignment?.day;if(day){taskDay=day;pane='today';render();}else showPane('queue');}
  // Calendar's original compact columns and row markup, without mutation controls.
  function overviewHTML(day){
    const dt=new Date(day+'T12:00:00+08:00'),wd=['日','一','二','三','四','五','六'][dt.getUTCDay()];
    let html='<section class="card mw-overview"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">🗓 '+Number(day.slice(5,7))+'月'+Number(day.slice(8))+'日 周'+wd+'</h3></div><div class="cal-cols" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    [['required','✅ 必须'],['ideal','⭐ 理想'],['extra','🌱 拓展']].forEach(([list,name])=>{
      const items=taskItems(day,list),progress=A.memoFinance.column(day,list);
      html+='<div class="cal-col" data-overview-list="'+list+'" tabindex="0" role="group" aria-label="'+names[list]+'，点击空白添加任务" style="border:1px solid var(--line);border-radius:10px;padding:9px 10px"><div class="cal-col-head" style="font-size:13px;font-weight:700;margin-bottom:6px">'+name+' <span class="mw-column-count">'+progress.label+'</span></div><div class="mw-column-meter" role="img" aria-label="'+esc(names[list]+'：'+progress.label)+'"><span style="width:'+progress.percent+'%"></span></div>'+(progress.supervision?'<small class="mw-column-extra">监督 '+progress.supervision+'项</small>':'');
      function rows(items){let html='';items.forEach(x=>{if(x.deferred){html+=deferredHTML(x,true);return;}const {task:t,ref}=x;
        html+='<div class="cal-task'+(doneFor(t,ref)?' done':'')+'" data-carried="'+!!A.memoFlow.isCarried(t)+'" data-category="'+list+'" data-bounty="'+!!A.memoOrganize?.bounty(score(t,ref))+'" data-score="'+scoreBand(score(t,ref))+'" data-overview-ref="'+esc(JSON.stringify(ref))+'" tabindex="0" role="button" aria-label="打开任务：'+esc(t.text+(A.memoFlow.isCarried(t)?'，逾期顺延':'')+(score(t,ref)!==null?'，'+score(t,ref)+'分':''))+'" style="border-bottom:1px dashed var(--line);padding:6px 2px"><span class="t-text" title="'+esc(t.text)+'" style="font-size:13.5px;word-break:break-all"><span class="ov-task-name">'+esc(t.text)+(doneFor(t,ref)?' ✓':'')+'</span>'+scoreHTML(score(t,ref))+(A.tasks?.carryTagHTML?.(t)||'')+(A.tasks?.lecTagHTML?.(t)||'')+(A.memoReview?.label(t)||'')+(A.memoRecurrence?.label(t)||'')+'</span>';
        if(t.standard)html+='<div class="t-std" style="font-size:11.5px;color:#f59e0b;margin-top:2px">📌 标准：'+esc(t.standard)+'</div>';
        (t.groups||[]).forEach(g=>{const subs=g.subs||[];html+='<div class="t-ctx grp">🧩 '+esc(g.name||'任务组')+(subs.length?'（'+subs.filter(x=>x.done===true).length+'/'+subs.length+'）':'')+'</div>';subs.forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});});
        (t.subs||[]).forEach(x=>{html+='<div class="t-ctx sub"><span>· '+esc(x.text)+'（限'+esc(x.minutes)+'分）'+(x.done===true?' ✓':x.done===false?' ✗':'')+'</span></div>';});
        html+='</div>';
      });return html;}const open=items.filter(x=>!doneFor(x.task,x.ref)),done=items.filter(x=>doneFor(x.task,x.ref));html+=(list==='extra'&&A.memoOrganize?A.memoOrganize.grouped(open,rows,true):rows(open))+(A.memoFinance?.planned(day,list,false)||'');html+=A.memoOrganize?.fold('overview:'+day+':'+list,rows(done),done.length)||'';if(list==='required')html+=A.memoGoals?.html(day,true)||'';html+='</div>';
    });return html+'</div></section>';
  }
  function overviewClick(e,day){
    const goal=e.target.closest('[data-goal]');if(goal){e.preventDefault();e.stopImmediatePropagation();return A.memoGoals.editor(goal.dataset.goal);}
    if(e.target.closest('[data-goal-group]'))return;
    if(e.target.closest('[data-deferred-source]'))return;
    if(e.target.closest('summary,button,input,select,a'))return;if(window.getSelection()?.toString())return;
    const task=e.target.closest('[data-overview-ref]'),col=e.target.closest('[data-overview-list]');if(!col)return;
    e.preventDefault();e.stopImmediatePropagation();if(task)complete(JSON.parse(task.dataset.overviewRef));else{taskDay=day;const group=e.target.closest('[data-family-id]');if(group)A.memoOrganize.add(group.dataset.familyId);else editor(null,col.dataset.overviewList);}
  }
  function categoryBody(items,day,list){const open=items.filter(x=>x.deferred||!doneFor(x.task,x.ref)),done=items.filter(x=>!x.deferred&&doneFor(x.task,x.ref)),renderItem=x=>x.deferred?deferredHTML(x):card(x.task,x.ref);return (list==='extra'&&A.memoOrganize?A.memoOrganize.grouped(open,rows=>rows.map(renderItem).join('')):open.map(renderItem).join(''))+(A.memoFinance?.planned(day,list,false)||'')+(A.memoOrganize?.fold('full:'+day+':'+list,done.map(x=>'<small>'+esc((S().data().memoTaskGroups||[]).find(g=>g.id===x.task.memoGroup)?.name||'')+'</small>'+card(x.task,x.ref)).join(''),done.length)||'');}
  function renderTasks() {
    taskDay = taskDay || M().userDay();if(A.memoRecurrence?.needsDay(taskDay)&&!A.memoActions.busy()){const requestedDay=taskDay;commit(()=>A.memoRecurrence.ensureCore(requestedDay));return;} const day = S().getDay(taskDay), occurrenceDay = taskDay === M().userDay() ? M().userDay() : taskDay;
    const root = $('mw-today');
    root.innerHTML = '<div class="mw-toolbar"><input type="date" id="mw-day" aria-label="任务日期" value="' + esc(taskDay) + '">' + '<div class="mw-day-shortcuts" role="group" aria-label="快捷日期">'+button('yesterday','昨天')+button('today','今天')+button('tomorrow','明天')+'</div>' + '<small>北京时间04:00分日</small>' + button('add-required', '＋ 添加任务', '', true) + button('ddl', '截止日期', 'id="mw-ddl"') + '</div>' + (A.memoReview?.summary(taskDay)||'') + overviewHTML(taskDay) + (A.memoFinance?.panel(taskDay)||'') + '<div class="mw-full-list">' + ['required', 'ideal', 'extra'].map(list => {
      const items = taskItems(taskDay,list);
      return '<section class="mw-group" id="mw-column-'+list+'"><div class="mw-group-head"><h2>' + names[list] + '<small> · 待做 ' + (items.filter(x => !x.deferred&&!doneFor(x.task, x.ref)).length+(A.memoFinance?.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode!=='punch'&&x.n<x.r.target).length||0)) + ((A.memoFinance?.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode==='punch').length||0)?' · 监督 '+A.memoFinance.plans(taskDay).filter(x=>x.r.list===list&&A.memoPenalty?.policy(x.it,taskDay).mode==='punch').length:'') + '</small></h2>' + button('add-' + list, '＋ 添加', 'aria-label="添加' + names[list] + '"') + '</div>' + categoryBody(items,taskDay,list) + (list==='required'?(A.memoGoals?.html(taskDay,false)||''):'') + (list === 'extra' ? (A.memoRecurrence?.registry()||'')+(A.memoReview?.registry()||'')+'<details class="mw-project-help"><summary>项目说明与已停用项目</summary><p class="hint">长期拓展是三栏分类；长期项目是持续任务实体；积分习惯仅为安排引用，不会生成第二条积分任务。一次性任务保留日期，每日推进项目可以停用。</p>' + (S().data().daily || []).filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-daily', '恢复基础任务', refAttrs({ kind: 'daily', id: p.id })) + '</p>').join('') + projects().filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-project', '恢复项目', refAttrs({ kind: 'project', id: p.id })) + '</p>').join('') + '</details>' : '') + '</section>';
    }).join('') + '</div>' + backlog() + ((S().data().daily || []).some(t => !t.archived) ? '<section class="mw-group"><h2>原有基础任务</h2>' + taskSection(S().data().daily.filter(t => !t.archived&&!t.memoCategoryDays?.[occurrenceDay]).map(task => ({ task, ref: { kind: 'daily', id: task.id, day: occurrenceDay } }))) + '</section>' : '');
    ['yesterday','today','tomorrow'].forEach((k,i)=>{const b=root.querySelector('[data-mw="'+k+'"]');b?.setAttribute('aria-pressed',String(taskDay===M().shiftDay(M().userDay(),i-1)));});
    A.ms?.refresh();
    $('mw-day').onchange = e => { if (M().validDate(e.target.value)) { taskDay = e.target.value; renderTasks(); } };
  }
  function renderQueue() {
    const all = sortedQueue().filter(t=>!t.memoDismissed&&!A.memoReview?.hidden(t,t.assignment?.list)), q = all.filter(t => !t.assignment), assigned = all.filter(t => t.assignment), done = S().data().queueDone || [];
    $('mw-queue').innerHTML = '<section class="mw-waiting-section"><h2>需要重新安排</h2>'+pendingHTML()+'</section><section class="mw-waiting-section"><div class="mw-group-head"><h2>尚未安排</h2>' + button('add-queue', '＋ 添加任务', '', true) + '</div><div class="mw-queue-grid">' + q.map(waitingRow).join('') + '</div>' + (!q.length ? '<p class="hint">添加准备做的任务，再安排顺序。</p>' : '') + (assigned.filter(t=>t.assignment.day>=M().userDay()).length ? '<details class="mw-assigned"><summary>已安排（' + assigned.filter(t=>t.assignment.day>=M().userDay()).length + '）</summary>' + assigned.filter(t=>t.assignment.day>=M().userDay()).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已安排', reorder: true })).join('') + '</details>' : '') + '<details><summary>已完成（' + done.length + '）</summary>' + done.slice(0, 100).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已完成' })).join('') + '</details></section>';
  }
  function preserve(renderFn) {
    const root = $(pane === 'queue' ? 'mw-queue' : 'mw-today'), disclosures = new Set();
    const detailKey = el => el.dataset.foldKey||el.dataset.family||(el.closest('[data-ref]')?.dataset.ref || root?.id) + ':' + (el.classList.contains('mw-completed') ? el.closest('.mw-group')?.querySelector('h2')?.textContent.replace(/ · 待做.*/, '') : el.querySelector('summary')?.textContent);
    root?.querySelectorAll('details[open]').forEach(el => disclosures.add(detailKey(el)));
    const anchor = [...(root?.querySelectorAll('[data-mw-card],.mw-history-row[data-ref]') || [])].find(el => el.getBoundingClientRect().bottom > 0), ref = anchor?.dataset.ref, offset = anchor?.getBoundingClientRect().top;
    renderFn();
    root?.querySelectorAll('details').forEach(el => { if (disclosures.has(detailKey(el))) el.open = true; });
    if (ref && document.body.dataset.view === 'tasks' && pane !== 'timeline') requestAnimationFrame(() => { const next = [...root.querySelectorAll('[data-mw-card],.mw-history-row[data-ref]')].find(el => el.dataset.ref === ref); if (next) window.scrollBy(0, next.getBoundingClientRect().top - offset); });
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
    if(next==='pending')next='queue';
    if (next === 'timeline') { A.app.switchView('timeline'); return A.memoSchedule.open(Object.assign({}, options, { workspace: true })); }
    if (save) positions[pane] = window.scrollY;
    pane = next; applyPane(); if (next === 'timeline') A.memoSchedule.open(Object.assign({}, options, { workspace: true }));
    requestAnimationFrame(() => { if (options.focusCard) $('schedule-card-' + options.focusCard)?.scrollIntoView({ block: 'center' }); else window.scrollTo({ top: positions[next] || 0 }); });
  }
  function enter(next, day) { if(day && M().validDate(day)){taskDay=day;render();}  if (next) showPane(next, false); else { applyPane(); requestAnimationFrame(() => window.scrollTo({ top: positions[pane] || 0 })); } }
  function returnToday() {
    if(document.querySelector('#modal-root .modal-mask')||A.memoActions.busy())return;
    taskDay=M().userDay();positions.today=0;pane='today';render();
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'})));
  }
  function leave() { positions[pane] = window.scrollY; }
  function timingFields() { return '<details open><summary>安排时间（选填）</summary><div class="schedule-fields"><label>开始／时间点<input type="time" id="mw-start"></label><label>结束（选填）<input type="time" id="mw-end"></label></div><label><input type="checkbox" id="mw-next">次日结束</label><p class="hint">只填开始即为时间点；都不填则暂不安排。</p></details>'; }
  function saveTiming(modal, ref, title, day) {
    const start = modal.querySelector('#mw-start').value, end = modal.querySelector('#mw-end').value;
    if (!start && !end) return;
    if (!start) throw new Error('请补充开始时间');
    A.memoSchedule.savePlan({ ref, title, day, type: end ? 'span' : 'point', start: Date.parse((start < '04:00' ? M().shiftDay(day,1) : day) + 'T' + start + ':00+08:00'), end: end ? Date.parse(((modal.querySelector('#mw-next').checked || end < '04:00') ? M().shiftDay(day, 1) : day) + 'T' + end + ':00+08:00') : null });
  }
  function editor(ref, list, reviewExecution = false) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const reviewLink=ref&&A.memoReview?.locate(ref);if(reviewLink&&!reviewExecution)return A.memoReview.manage(reviewLink.series.id);
    const existing = ref && A.memoSchedule.find(ref), day = ref?.day || taskDay || M().userDay(), kind = ref?.kind || (list === 'queue' ? 'queue' : 'task');
    const m = A.ui.openModal(existing ? '编辑任务' : '添加' + (names[list] || '队列任务'), (!existing && kind === 'task' ? '<label>任务栏目<select id="mw-list">' + Object.keys(names).map(k => '<option value="' + k + '"' + (k === list ? ' selected' : '') + '>' + names[k] + '</option>').join('') + '</select></label>' : '') + '<div class="mw-title-field"><label for="mw-title">任务名称</label><textarea id="mw-title" rows="2"></textarea></div>' +
      (existing && kind === 'task' && ref?.list === 'required' ? '' : '<div id="mw-points-field"><label for="mw-points">完成积分</label><input type="number" id="mw-points" min="0" inputmode="decimal"></div>') + '<label for="mw-note-edit">备注（选填）</label><textarea id="mw-note-edit" rows="2"></textarea>' + (!existing && kind === 'task' ? '<fieldset id="mw-repeat-wrap"><legend>重复方式</legend><label><input type="radio" name="mw-repeat" value="once" checked>一次性完成</label><label><input type="radio" name="mw-repeat" value="daily">每日推进</label><label><input type="radio" name="mw-repeat" value="review">间隔复习</label><label><input type="radio" name="mw-repeat" value="cycle">固定周期</label></fieldset>' : '') +
      '<label>预计用时（分钟，选填）<input id="mw-estimate" type="number" min="0" max="1440"></label>' + timingFields() + (existing ? '<p class="hint">这里可追加一段安排；修改已有时间请点卡片上的“修改／追加时间”。</p>' : '') + '<p id="mw-form-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button>' + (existing ? '<button class="btn btn-danger" data-act="delete">' + (kind === 'project' || kind === 'daily' ? '停用' : '删除') + '</button>' + (kind === 'task' && ref.list === 'extra' && !reviewLink ? '<button class="btn" data-act="convert">转为每日推进</button>' : '') : '') + '<button class="btn mw-save-start" data-act="save-start">保存并立即开始</button><button class="btn btn-primary" data-act="save">保存</button>', { lock: true, cancelOnBackdrop: true });
    m.classList.add('mw-task-editor');
    const q = s => m.querySelector(s); q('#mw-title').value = existing?.text || ''; q('#mw-note-edit').value = existing?.note || ''; if (q('#mw-points')) q('#mw-points').value = existing?.points ?? (kind === 'queue' ? S().settings().queuePoints ?? 5 : list === 'ideal' || ref?.list === 'ideal' ? S().settings().idealPoints ?? 1 : S().settings().extPoints ?? 5);
    q('#mw-estimate').value = existing?.estimatedMinutes || '';
    A.memoOrganize?.editor(m,existing,list||ref?.list,ref);const selectList = q('#mw-list');
    if (selectList) { let pointsEdited = false; q('#mw-points').addEventListener('input', () => { pointsEdited = true; }); const update = () => { if (!pointsEdited) q('#mw-points').value = selectList.value === 'ideal' ? S().settings().idealPoints ?? 1 : S().settings().extPoints ?? 5; q('#mw-repeat-wrap').hidden = false;q('[name="mw-repeat"][value="daily"]').closest('label').hidden=selectList.value!=='extra'; q('#mw-points-field').hidden = selectList.value === 'required'; }; selectList.onchange = update; update(); }
    m.querySelectorAll('[name="mw-repeat"]').forEach(r=>r.addEventListener('change',()=>{if(r.checked&&['review','cycle'].includes(r.value)&&!A.memoActions.busy()){const draft={text:q('#mw-title').value,note:q('#mw-note-edit').value};A.ui.closeModal();if(r.value==='review')A.memoReview.newEditor(null,draft);else A.memoRecurrence.newEditor({...draft,list:q('#mw-list')?.value||list,points:Number(q('#mw-points')?.value)||0,estimatedMinutes:Number(q('#mw-estimate').value)||0});}}));
    if(existing&&!reviewLink&&A.memoReview&&['task','queue'].includes(kind)){const link=document.createElement('button');link.className='btn';link.type='button';link.textContent='建立间隔复习';link.onclick=()=>{if(!A.memoActions.busy())A.memoReview.newEditor(ref);};m.querySelector('.modal-actions').prepend(link);}
    if(existing&&A.memoRecurrence?.locate(ref)){const manage=document.createElement('button');manage.className='btn';manage.textContent='周期历史与后续规则';manage.onclick=()=>A.memoRecurrence.manage(A.memoRecurrence.locate(ref).series.id);m.querySelector('.modal-actions').prepend(manage);}
    q('#mw-title').focus();
    if (kind === 'project') { const hist = document.createElement('details'); hist.innerHTML = '<summary>每日完成记录</summary>' + Object.keys(existing.days || {}).sort().reverse().map(k => '<button type="button" class="btn" data-project-day="' + esc(k) + '">' + esc(k) + ' · 取消本日完成</button>').join(''); q('#mw-form-error').before(hist); hist.querySelectorAll('[data-project-day]').forEach(b => b.onclick = () => A.memoActions.project(ref.id, b.dataset.projectDay)); }
    const immediate=q('[data-act="save-start"]');
    const running=existing&&A.memoSchedule.state().sessions.slice().reverse().find(s=>A.memoSchedule.key(s.ref)===A.memoSchedule.key(ref)&&s.status!=='ended');
    immediate.hidden=day!==M().userDay()||!!(existing&&(existing.archived||doneFor(existing,ref)));
    immediate.textContent=running?.status==='running'?'保存并返回':running?'保存并继续计时':'保存并立即开始';
    A.ui.dateContext(m, { day: kind==='queue'?(existing?.assignment?.day||null):day, saveSelector:'[data-act=save]', noStart:!!(existing&&(existing.archived||doneFor(existing,ref))) || day!==M().userDay() });
    let submitting=false,savedRef=null,taskSaved=false;
    async function save(b, convert = false, begin = false) {
      if(submitting)return;submitting=true;const actions=[...m.querySelectorAll('.modal-actions button')];actions.forEach(x=>x.disabled=true);
      try { if(!taskSaved){if (await A.memoActions.commit(() => {
        const text = q('#mw-title').value.trim(); if (!text) throw new Error('请填写任务名称'); if (!existing && text.includes('\n')) throw new Error('一次添加一个任务，正文说明可写在备注中');
        const selectedList = q('#mw-list')?.value || list;
        const d = S().data(), isProject = kind === 'project' || convert || (selectedList === 'extra' && q('[name="mw-repeat"]:checked')?.value === 'daily');
        const current=existing?A.memoSchedule.find(ref):null;if(existing&&!current)throw new Error('任务已移动或删除，请重新打开');
        let t = current, targetRef = ref;
        if (isProject && kind !== 'project') {
          if (current?.memoProjectId) throw new Error('此任务已转换，请编辑对应每日项目');
          if (!d.memoProjects) d.memoProjects = [];
          t = { id: S().uid(), text, days: {}, createdAt: new Date().toISOString(), createdDay: day, source: existing ? { id: existing.id, day, list: ref.list } : null };
          d.memoProjects.push(t); targetRef = { kind: 'project', id: t.id, day: ref?.day || (day === M().userDay() ? M().userDay() : day) }; t.createdDay = targetRef.day;
          if (current) { if (current.done) throw new Error('已完成的旧任务保留历史，请新建每日推进项目'); A.memoSchedule.stopRef(ref); current.memoProjectId = t.id; }; // Preserve historical source and its ledger; never infer a merge by title.
        } else if (!t) {
          t = { id: S().uid(), createdAt: new Date().toISOString() };
          if (kind === 'queue') { (d.queue || (d.queue = [])).push(t); targetRef = { kind: 'queue', id: t.id }; }
          else { S().getDay(day).tasks[selectedList].push(t); targetRef = { kind: 'task', id: t.id, list: selectedList, day }; }
        }
        t.estimatedMinutes = Math.min(1440, Math.max(0, Number(q('#mw-estimate').value) || 0)); t.dateBasis = 'user';
        t.text = text; t.note = q('#mw-note-edit').value; if (q('#mw-points')) t.points = Math.max(0, Number(q('#mw-points').value) || 0);
        if(q('#task-group'))t.memoGroup=q('#task-group').value;saveTiming(m, targetRef, text, targetRef.kind === 'project' ? targetRef.day : day); savedRef=targetRef;
      })){taskSaved=true;}else return;}
      if(begin){if(day!==M().userDay())throw Error('日期已改变，任务已保存，请关闭后重新开始');if(!await A.memoActions.commit(()=>A.memoSchedule.startRef(savedRef)))return;}
      A.ui.closeModal();render();A.memoSchedule.render();if(begin)A.ui.toast('任务已保存，计时已开始或保持运行');
      }catch(e){q('#mw-form-error').textContent=(taskSaved?'任务已保存；计时尚未保存成功。':'')+e.message;b.textContent=A.memoActions.busy()?'重试保存':taskSaved?'重试开始计时':'重新保存';}
      finally{submitting=false;const pending=A.memoActions.busy();actions.forEach(x=>x.disabled=pending||taskSaved);if(!pending){const cancel=q('[data-act="cancel"]');if(cancel)cancel.disabled=false;}if(b.isConnected)b.disabled=false;m.querySelectorAll('input,textarea,select').forEach(x=>x.disabled=pending||taskSaved);}
    }
    A.ui.bindActions({ cancel: () => { if (!submitting&&!A.memoActions.busy()) A.ui.closeModal(); }, save, 'save-start':b=>save(b,false,true), convert: b => save(b, true), delete: () => {
      if (A.memoActions.busy()) return;
      if (kind === 'project' || kind === 'daily') A.ui.confirm('停用后不再列入当前清单，历史完成、积分和笔记保留，可恢复。', '停用项目', () => commit(() => { const current=A.memoSchedule.find(ref);if(!current)throw new Error('任务已不存在，请重新打开');current.archived = true; const state = A.memoSchedule.state(); state.sessions.filter(s => s.ref.kind === kind && s.ref.id === ref.id).forEach(s => A.memoSchedule.stopRef(s.ref)); state.items.filter(p => p.ref.kind === kind && p.ref.id === ref.id && p.start >= Date.now()).forEach(p => p.suspendedByArchive = true); }).then(ok => { if (ok) A.ui.closeModal(); }));
      else A.memoActions.deleteTask(ref);
    } });
  }
  function complete(ref) { ref = A.memoSchedule.canonical(ref); const t = A.memoSchedule.find(ref); if (t) completionFocus = { ref, before: doneFor(t, ref) }; if (ref.kind === 'task') A.memoActions.task(ref.list, ref.id, ref.day); else if (ref.kind === 'queue') A.memoActions.queue(ref.id); else if (ref.kind === 'daily') A.memoActions.daily(ref.id, ref.day); else A.memoActions.project(ref.id, ref.day); }

  function datedTasks() {
    const rows = [];
    Object.entries(S().data().days).forEach(([day, data]) => ['required', 'ideal', 'extra'].forEach(list => (data.tasks[list] || []).filter(t => !t.fromQueue && !t.fromDaily && !t.memoProjectId).forEach(task => rows.push({ task, ref: { kind: 'task', id: task.id, day, list } }))));
    A.memoFlow?.queues().forEach(task => { if(task.assignment)rows.push({task,ref:{kind:'queue',id:task.id},day:task.assignment.day,list:task.assignment.list}); const seen=new Set();(task.assignmentHistory||[]).filter(a=>a.day&&a.list).forEach(a=>{const key=a.day+':'+a.list;if(seen.has(key))return;seen.add(key);const h=A.memoFlow.deferred(a.day,a.list).find(x=>x.ref.kind==='queue'&&x.ref.id===task.id);if(h)rows.push({task:Object.assign({},h.task,{memoMovedTo:{kind:'queue',id:task.id}}),ref:h.ref,day:a.day,list:a.list});}); });
    return rows;
  }
  function historyRow(x) {
    const t = x.task, day = x.day || x.ref.day, list = x.list || x.ref.list;
    const historical=(A.memoFlow.deferred?.(day,list)||[]).find(h=>h.ref.kind===x.ref.kind&&h.ref.id===x.ref.id);if(historical)return deferredHTML(historical);
    const status = t.memoMovedTo ? '已重新安排' : t.memoDismissed ? '未完成 · 不再安排' : t.done || t.doneAt ? (t.backfillDay ? (t.backfillDay <= t.originalDay ? '补记按时完成' : '补记延期完成') : t.originalDay ? '延期完成' : '已完成') : '未完成';
    return '<article class="mw-history-row" '+refAttrs(x.ref)+'><strong>' + esc(t.text) + '</strong><p>' + esc(day + ' · ' + names[list] + ' · ' + status + (status === '未完成' ? (day < S().data().memoFlow?.startedDay ? ' · 旧任务，待安排' : list !== 'required' ? ' · 待重新安排' : '') : '')) + '</p>' + (!t.memoMovedTo && !t.memoDismissed ? (t.done || t.doneAt ? button('open-day', '查看当天', refAttrs(Object.assign({}, x.ref, {day}))) : button('assign', '重新安排', refAttrs(x.ref)) + '<details class="mw-row-more"><summary>更多</summary><div class="mw-secondary-actions">' + button('backfill','补记完成',refAttrs(x.ref))+button('edit','编辑',refAttrs(x.ref))+button('enqueue','暂不安排',refAttrs(x.ref))+button('dismiss','不再安排',refAttrs(x.ref))+'</div></details>') : t.memoDismissed ? button('restore-pending', '恢复待安排', refAttrs(x.ref)) : '') + '</article>';
  }
  function backlog() {
    const rows = datedTasks().filter(x => (x.day || x.ref.day) < M().userDay() && !x.task.done && !x.task.doneAt && !x.task.memoMovedTo && !x.task.memoDismissed && !x.task.memoOccurrenceId && !A.memoReview?.hidden(x.task,x.list||x.ref.list||x.task.assignment?.list));
    return '<details class="mw-backlog"><summary>往日未完成（' + rows.length + '）</summary>' + rows.sort((a,b) => (a.day || a.ref.day).localeCompare(b.day || b.ref.day)).map(historyRow).join('') + '</details>';
  }
  function pendingRows(){return datedTasks().filter(x=>(x.day||x.ref.day)<M().userDay()&&!x.task.done&&!x.task.doneAt&&!x.task.memoMovedTo&&!x.task.memoDismissed&&!x.task.memoOccurrenceId&&!A.memoReview?.hidden(x.task,x.list||x.ref.list||x.task.assignment?.list));}
  function pendingHTML(){
    const rows=pendingRows();
    if(!rows.length)return '<p class="hint">暂无需要重新安排的任务</p>';
    return ['required','ideal','extra'].map(list=>{
      const grouped=rows.filter(x=>(x.list||x.ref.list||x.task.assignment?.list||'extra')===list);
      return grouped.length?'<section class="mw-pending-group"><h3>'+names[list]+' · '+grouped.length+'</h3>'+grouped.map(historyRow).join('')+'</section>':'';
    }).join('');
  }
  function waitingRow(t){const ref={kind:'queue',id:t.id},attrs=refAttrs(ref);return '<article class="mw-history-row" data-bounty="'+!!A.memoOrganize?.bounty(score(t,ref))+'" '+attrs+'><strong>'+esc(t.text)+(A.memoOrganize?.badge(score(t,ref))||'')+'<small class="mw-score">+'+Math.max(0,Number(t.points??S().settings().queuePoints??5))+'分</small>'+'</strong><div class="mw-waiting-actions">'+button('assign','安排',attrs)+'</div><details><summary>更多</summary><div class="mw-secondary-actions">'+button('complete','直接完成',attrs)+A.memoSchedule.rowControls(ref)+(t.note?'<p>'+esc(t.note)+'</p>':'')+button('edit','编辑',attrs)+button('pin',t.pinned?'取消置顶':'置顶',attrs)+button('up','上移',attrs)+button('down','下移',attrs)+button('dismiss','不再安排',attrs)+'</div></details></article>';}
  function renderPending(){const nav=document.querySelector('[data-mw-pane="queue"]');if(nav)nav.textContent='待安排 '+(pendingRows().length+sortedQueue().filter(t=>!t.assignment&&!t.memoDismissed&&!A.memoReview?.hidden(t,t.assignment?.list)).length);}

  let historyFrom = '', historyTo = '', historyStatus = '', historyList = '';
  function renderHistory() {
    const root = $('mw-history'); if (!root) return;
    const rows = datedTasks().filter(x => { const day = x.day || x.ref.day, t = x.task, status = t.memoMovedTo ? 'moved' : t.memoDismissed ? 'dismissed' : t.done || t.doneAt ? 'done' : 'pending'; return (!historyFrom || day >= historyFrom) && (!historyTo || day <= historyTo) && (!historyStatus || historyStatus === status) && (!historyList || historyList === (x.list || x.ref.list)); });
    root.innerHTML = '<h2>任务历史</h2><div class="schedule-fields"><label>从<input type="date" id="mh-from" value="' + historyFrom + '"></label><label>至<input type="date" id="mh-to" value="' + historyTo + '"></label><label>栏目<select id="mh-list"><option value="">全部</option>' + Object.entries(names).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('') + '</select></label><label>状态<select id="mh-status"><option value="">全部</option><option value="pending">未完成</option><option value="done">已完成</option><option value="moved">已重新安排</option><option value="dismissed">不再安排</option></select></label></div>' + (rows.sort((a,b)=>(b.day || b.ref.day).localeCompare(a.day || a.ref.day)).map(historyRow).join('') || '<p>没有符合条件的任务</p>');
    $('mh-list').value=historyList; $('mh-status').value=historyStatus;
    ['from','to','list','status'].forEach(k => $('mh-'+k).onchange = e => { if(k==='from')historyFrom=e.target.value; if(k==='to')historyTo=e.target.value; if(k==='list')historyList=e.target.value; if(k==='status')historyStatus=e.target.value; renderHistory(); });
  }
  function assignmentEditor(ref, onReturn) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const t = A.memoSchedule.find(ref); if (!t) return;
    const active=A.memoSchedule.timing(ref).session;
    if(active?.status==='running'){return A.ui.confirm('调整日期前会暂停当前计时，已有时段保留。','暂停并调整安排',async()=>{if(await commit(()=>A.memoSchedule.pauseCore(active))){assignmentEditor(ref,onReturn);}});}
    const finish=()=>{A.ui.closeModal();render();A.memoSchedule.render();onReturn?.();};
    const review=A.memoReview?.locate(ref);if(review&&!onReturn)return A.memoReview.scheduleEditor(review.series.id,review.round.id);
    const m = A.ui.openModal('安排 · '+t.text, '<p id="ma-target">安排到今天 · '+M().userDay()+'</p><div class="mw-assign-choices">'+['required','ideal','extra'].map((list,i)=>'<button class="btn" data-act="pick" data-list="'+list+'">'+['必做','理想','长期'][i]+'</button>').join('')+'</div><details><summary>更多设置</summary><label>安排日期<input type="date" id="ma-day" value="'+M().userDay()+'"></label><p>具体时间与预计用时</p>'+'<button class="btn" data-act="time-settings">安排时间与预计用时</button><button class="btn" data-act="edit-task">编辑名称、备注与积分</button><button class="btn" data-act="queue">暂不安排</button>'+(t.overdueEventId?'<button class="btn" data-act="forgive">纠正错误扣分</button>':'')+'</details><p id="ma-error" role="alert"></p>', '<button class="btn" data-act="cancel">取消</button>', {lock:true});
    const date=m.querySelector('#ma-day'); m.querySelector('#ma-target').hidden=true;
    A.ui.dateContext(m,{getDay:()=>date.value,label:'安排到',sourceDay:ref.day||t.assignment?.day,choiceSelector:'[data-act=pick]'});
    async function save(b,target,list){if(A.memoActions.busy())return;const buttons=m.querySelectorAll('[data-act="pick"],[data-act="queue"]');buttons.forEach(x=>x.disabled=true);try{if(await A.memoActions.commit(()=>{if(review){if(target==='queue')throw Error('复习轮次请保留日期安排');const clock=M().clock(review.round.due);A.memoReview.rescheduleCore(review.round.id,Date.parse((clock<'04:00'?M().shiftDay(date.value,1):date.value)+'T'+clock+':00+08:00'),list||ref.list);}else A.memoFlow.moveCore(ref,date.value,list||t.assignment?.list||ref.list||'ideal',target);})){finish();A.ui.toast('已安排');}}catch(e){m.querySelector('#ma-error').textContent=e.message;}finally{buttons.forEach(x=>x.disabled=false);}}
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())finish();},pick:b=>save(b,'task',b.dataset.list),queue:b=>save(b,'queue'),'time-settings':()=>{if(!A.memoActions.busy()){A.ui.closeModal();A.memoSchedule.arrange(ref);}},'edit-task':()=>{if(!A.memoActions.busy()){A.ui.closeModal();editor(ref);}},forgive:()=>{if(A.memoActions.busy()||m.querySelector('#ma-reason'))return;const reason=document.createElement('input');reason.id='ma-reason';reason.placeholder='说明错误原因';m.querySelector('#ma-error').before(reason);const b=m.querySelector('[data-act="forgive"]');b.textContent='确认纠正';b.onclick=async()=>{try{if(await A.memoActions.commit(()=>A.memoFlow.forgiveCore(ref,reason.value))){A.ui.closeModal();render();A.app.refreshStats();}}catch(e){m.querySelector('#ma-error').textContent=e.message;}};}});
  }

  function renderReview(day) {
    const root = $('review-card'); root.innerHTML = '<label>今日复盘</label><textarea id="mw-review-text" rows="6"></textarea><button class="btn btn-primary" id="mw-review-save">保存复盘</button><p id="mw-review-status" role="status"></p>';
    $('mw-review-text').value = day.review?.text || '';
    $('mw-review-save').onclick = async () => { const text = $('mw-review-text').value; if (await commit(() => { day.review = { text, at: new Date().toISOString() }; })) $('mw-review-status').textContent = '已保存'; };
  }
  function init() {
    ready = true; taskDay = M().userDay(); lastDay = taskDay; lastCivilDay = M().naturalDay();
    const root = $('view-tasks');
    const axis = document.createElement('section'); axis.id = 'view-memo-timeaxis'; axis.className = 'view'; document.querySelector('main').appendChild(axis); axis.appendChild($('memo-schedule-panel'));
    const error = document.createElement('button'); error.id = 'flow-save-error'; error.className = 'btn btn-danger'; error.hidden = true; document.querySelector('main').before(error);
    root.insertAdjacentHTML('afterbegin', '<div class="mw-tabs" role="group" aria-label="任务子页面">' + [['today','当天任务'],['queue','待安排']].map(([id, label]) => '<button class="btn" data-mw-pane="' + id + '">' + label + '</button>').join('') + '</div><p id="mw-error" role="alert"></p><div id="mw-today"></div><div id="mw-queue" hidden></div><div id="mw-history" hidden></div><div id="mw-pending" hidden></div>');
    // Keep legacy review content reachable, with mutation entries retired in memo mode.
    const review = document.createElement('section'); review.id = 'view-memo-review'; review.className = 'view'; review.innerHTML = '<h2>今日复盘</h2><p class="hint">完成和补记请在任务中操作，统一关联笔记、积分与时间轴。</p>'; $('review-card').parentNode.removeChild($('review-card')); review.appendChild(document.createElement('div')).id = 'review-card'; document.querySelector('main').appendChild(review);
    document.querySelectorAll('.mn-grid, header nav').forEach(el => el.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" data-view="memo-review">今日复盘</button>'));
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend', '<button class="btn" id="mw-trash">删除记录</button>'); $('mw-trash').onclick = () => A.memoActions.trash(); document.querySelector('#main-nav')?.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" id="mw-trash-desktop">删除记录</button>'); if ($('mw-trash-desktop')) $('mw-trash-desktop').onclick = () => A.memoActions.trash();
    document.querySelectorAll('[data-view="memo-review"]').forEach(b => b.onclick = () => { A.app.switchView('memo-review'); const d = S().getDay(M().userDay()); renderReview(d); });
    $('schedule-active').before($('schedule-live')); const live = document.createElement('div'); live.id = 'mw-live'; live.append($('schedule-live'), $('schedule-active')); const controls = document.createElement('span'); controls.id = 'mw-live-controls'; live.appendChild(controls); document.querySelector('main').before(live);
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend','<button class="btn" id="mw-open-history">任务历史</button>');$('mw-open-history').onclick=()=>{$('mn-sheet')?.classList.add('hidden');A.app.switchView('tasks');showPane('history');};
    root.querySelectorAll('[data-mw-pane]').forEach(b => b.onclick = () => showPane(b.dataset.mwPane));
    root.addEventListener('click', e => {
      const deferred=e.target.closest('[data-deferred-open],[data-deferred-backfill]');if(deferred){e.preventDefault();e.stopImmediatePropagation();return deferred.hasAttribute('data-deferred-open')?openDeferred(JSON.parse(deferred.dataset.deferredOpen)):A.memoFlow.backfill(JSON.parse(deferred.dataset.deferredBackfill),deferred.dataset.deferredDay);}
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
        if (act === 'dismiss') return commit(() => { const t = A.memoSchedule.find(ref); if(t?.memoReviewRoundId){A.memoReview.cancelCore(t.memoReviewRoundId);return;} if (t) { A.memoSchedule.stopRef(ref); t.memoDismissed = new Date().toISOString(); } });
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
    function refreshDates(){const now=M().userDay(),civil=M().naturalDay();if(now!==lastDay){if(taskDay===lastDay)taskDay=now;lastDay=now;render();}else if(civil!==lastCivilDay)A.memoGoals?.refresh();lastCivilDay=civil;}
    setInterval(refreshDates,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDates();});window.addEventListener('focus',refreshDates);
    A.memoReview?.init();A.memoRecurrence?.init();
    render();
  }
  A.memoWorkspace = { assignmentEditor, complete, score, scoreBand, taskItems, pendingRows, waitingRow, overviewHTML, overviewClick, init, render, enter, leave, returnToday, showPane, editor, sortedQueue, orderQueue, moveQueue, saveTiming, projects, renderHistory };
})();
