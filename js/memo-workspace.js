/* Memo workspace: explicit task editing, stable queue order and daily project occurrences. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, $ = id => document.getElementById(id), esc = x => S().esc(String(x ?? ''));
  const names = { required: '必做任务', ideal: '理想任务', extra: '长期拓展' };
  let pane = 'today', taskDay, positions = {}, ready = false, lastDay;
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
  async function commit(fn) { try { if (await A.memoActions.commit(fn)) { $('mw-error').textContent = ''; render(); A.app.refreshStats(); A.memoSchedule.render(); return true; } }
    catch (e) { A.ui.toast(e.message); $('mw-error').textContent = e.message; const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重试保存'; retry.onclick = () => commit(() => {}); $('mw-error').appendChild(retry); } return false; }
  function refAttrs(ref) { return 'data-ref="' + esc(JSON.stringify(ref)) + '"'; }
  function card(t, ref, options = {}) {
    const done = ref.kind === 'project' ? !!t.days?.[ref.day] : ref.kind === 'daily' ? !!t.days?.[ref.day] : ref.kind === 'queue' ? !!t.doneAt : !!t.done;
    const attrs = refAttrs(ref), points = ref.kind === 'task' && ref.list === 'required' ? null : t.points ?? (ref.kind === 'project' ? 5 : ref.kind === 'daily' ? 2 : ref.kind === 'queue' ? S().settings().queuePoints ?? 5 : ref.list === 'ideal' ? S().settings().idealPoints ?? 10 : S().settings().extPoints ?? 5);
    return '<article class="mw-task' + (done ? ' mw-done' : '') + (options.first ? ' mw-first' : '') + '" data-mw-card ' + attrs + '><div class="mw-task-heading">' + button('complete', done ? '✓' : '○', attrs + ' aria-label="' + (done ? '取消完成：' : '完成：') + esc(t.text) + '" aria-pressed="' + done + '"') + '<strong>' + esc(t.text) + '</strong></div>' + (ref.kind === 'queue' ? '<small>' + (t.pinned ? '📌 置顶 · ' : '') + '队列第 ' + options.number + ' 项</small>' : ref.kind === 'project' ? '<small>每日推进 · ' + esc(ref.day) + ' · ' + (done ? '今日已完成' : '今日未完成') + '</small>' : '') +
      (t.note ? '<details class="mw-note"><summary>备注</summary><p>' + esc(t.note) + '</p></details>' : '') + '<div class="mw-task-actions">' + button('edit', '编辑', attrs) + (points != null ? '<small>完成 +' + esc(points) + ' 分</small>' : '<small>完成整组可领取保底奖励</small>') + (options.reorder ? button('pin', t.pinned ? '取消置顶' : '置顶', attrs) + '<details><summary>排序</summary>' + button('up', '上移', attrs) + button('down', '下移', attrs) + '</details>' : '') + '</div>' + A.memoSchedule.rowControls(ref) + '</article>';
  }
  function renderTasks() {
    taskDay = taskDay || M().naturalDay(); const day = S().getDay(taskDay), occurrenceDay = taskDay === M().naturalDay() ? M().userDay() : taskDay;
    const root = $('mw-today');
    root.innerHTML = '<div class="mw-toolbar"><input type="date" id="mw-day" aria-label="任务日期" value="' + esc(taskDay) + '">' + button('today', '今天') + button('tomorrow', '明天') + '</div>' + ['required', 'ideal', 'extra'].map(list => '<section class="mw-group"><div class="mw-group-head"><h2>' + names[list] + '</h2>' + button('add-' + list, '＋ 添加任务', '', true) + '</div>' + (day.tasks[list] || []).filter(t => !t.memoProjectId).map(t => card(t, { kind: 'task', id: t.id, day: taskDay, list })).join('') + (list === 'extra' ? '<p class="hint">一次性任务按日期保留；每日推进项目持续显示。已有任务可在编辑时手动转换。</p>' + projects().filter(p => !p.archived && (!p.createdDay || p.createdDay <= occurrenceDay)).map(p => card(p, { kind: 'project', id: p.id, day: occurrenceDay })).join('') + '<details><summary>已停用项目</summary>' + (S().data().daily || []).filter(p => p.archived).map(p => '<p>' + esc(p.text) + button('restore-daily', '恢复基础任务', refAttrs({ kind: 'daily', id: p.id })) + '</p>').join('') + projects().filter(p => p.archived).map(p => '<p>' + esc(p.text) + ' ' + button('restore-project', '恢复项目', refAttrs({ kind: 'project', id: p.id })) + '</p>').join('') + '</details>' : '') + '</section>').join('') + ((S().data().daily || []).some(t => !t.archived) ? '<section class="mw-group"><h2>原有基础任务</h2>' + S().data().daily.filter(t => !t.archived).map(t => card(t, { kind: 'daily', id: t.id, day: occurrenceDay })).join('') + '</section>' : '');
    $('mw-day').onchange = e => { if (M().validDate(e.target.value)) { taskDay = e.target.value; renderTasks(); } };
  }
  function renderQueue() {
    const q = sortedQueue(), done = S().data().queueDone || [];
    $('mw-queue').innerHTML = '<div class="mw-group-head"><h2>任务队列</h2>' + button('add-queue', '＋ 添加任务', '', true) + '</div><div class="mw-queue-grid">' + q.map((t, i) => card(t, { kind: 'queue', id: t.id }, { number: i + 1, first: i === 0, reorder: true })).join('') + '</div>' + (!q.length ? '<p class="hint">添加准备做的任务，再安排顺序。</p>' : '') + '<details><summary>已完成（' + done.length + '）</summary>' + done.slice(0, 100).map(t => card(t, { kind: 'queue', id: t.id }, { number: '已完成' })).join('') + '</details>';
  }
  function preserve(renderFn) {
    const root = $(pane === 'queue' ? 'mw-queue' : 'mw-today'), disclosures = new Set();
    const detailKey = el => (el.closest('[data-mw-card]')?.dataset.ref || root?.id) + ':' + el.querySelector('summary')?.textContent;
    root?.querySelectorAll('details[open]').forEach(el => disclosures.add(detailKey(el)));
    const anchor = [...(root?.querySelectorAll('[data-mw-card]') || [])].find(el => el.getBoundingClientRect().bottom > 0), ref = anchor?.dataset.ref, offset = anchor?.getBoundingClientRect().top;
    renderFn();
    root?.querySelectorAll('details').forEach(el => { if (disclosures.has(detailKey(el))) el.open = true; });
    if (ref && document.body.dataset.view === 'tasks' && pane !== 'timeline') requestAnimationFrame(() => { const next = [...root.querySelectorAll('[data-mw-card]')].find(el => el.dataset.ref === ref); if (next) window.scrollBy(0, next.getBoundingClientRect().top - offset); });
  }
  function render() { if (!ready) return; preserve(() => { renderTasks(); renderQueue(); applyPane(); }); A.memoSchedule.tick?.(); }
  function applyPane() { ['today', 'queue', 'timeline'].forEach(p => { const el = $(p === 'timeline' ? 'memo-schedule-panel' : 'mw-' + p); el.hidden = p !== pane; document.querySelector('[data-mw-pane="' + p + '"]').setAttribute('aria-pressed', String(p === pane)); }); }
  function showPane(next, save = true, options = {}) {
    if (save) positions[pane] = window.scrollY;
    pane = next; applyPane(); if (next === 'timeline') A.memoSchedule.open(Object.assign({}, options, { workspace: true }));
    requestAnimationFrame(() => { if (options.focusCard) $('schedule-card-' + options.focusCard)?.scrollIntoView({ block: 'center' }); else window.scrollTo({ top: positions[next] || 0 }); });
  }
  function enter(next) { if (next) showPane(next, false); else { applyPane(); requestAnimationFrame(() => window.scrollTo({ top: positions[pane] || 0 })); } }
  function leave() { positions[pane] = window.scrollY; }
  function timingFields() { return '<details open><summary>安排时间（选填）</summary><div class="schedule-fields"><label>开始／时间点<input type="time" id="mw-start"></label><label>结束（选填）<input type="time" id="mw-end"></label></div><label><input type="checkbox" id="mw-next">次日结束</label><p class="hint">只填开始即为时间点；都不填则暂不安排。</p></details>'; }
  function saveTiming(modal, ref, title, day) {
    const start = modal.querySelector('#mw-start').value, end = modal.querySelector('#mw-end').value;
    if (!start && !end) return;
    if (!start) throw new Error('请补充开始时间');
    A.memoSchedule.savePlan({ ref, title, day, type: end ? 'span' : 'point', start: Date.parse(day + 'T' + start + ':00+08:00'), end: end ? Date.parse((modal.querySelector('#mw-next').checked ? M().shiftDay(day, 1) : day) + 'T' + end + ':00+08:00') : null });
  }
  function editor(ref, list) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存当前操作');
    const existing = ref && A.memoSchedule.find(ref), day = ref?.day || taskDay || M().naturalDay(), kind = ref?.kind || (list === 'queue' ? 'queue' : 'task');
    const m = A.ui.openModal(existing ? '编辑任务' : '添加' + (names[list] || '队列任务'), '<label for="mw-title">任务名称</label><textarea id="mw-title" rows="2"></textarea><label for="mw-note-edit">备注（选填）</label><textarea id="mw-note-edit" rows="2"></textarea>' +
      (kind === 'task' && (ref?.list || list) === 'required' ? '' : '<label for="mw-points">完成积分</label><input type="number" id="mw-points" min="0">') + (!existing && list === 'extra' ? '<label>完成方式<select id="mw-repeat"><option value="daily">每日推进（04:00分日）</option><option value="once">一次性完成</option></select></label>' : '') +
      timingFields() + (existing ? '<p class="hint">这里可追加一段安排；修改已有时间请点卡片上的“修改／追加时间”。</p>' : '') + '<p id="mw-form-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button>' + (existing ? '<button class="btn btn-danger" data-act="delete">' + (kind === 'project' || kind === 'daily' ? '停用' : '删除') + '</button>' + (kind === 'task' && ref.list === 'extra' ? '<button class="btn" data-act="convert">转为每日推进</button>' : '') : '') + '<button class="btn btn-primary" data-act="save">保存</button>', { lock: true });
    const q = s => m.querySelector(s); q('#mw-title').value = existing?.text || ''; q('#mw-note-edit').value = existing?.note || ''; if (q('#mw-points')) q('#mw-points').value = existing?.points ?? (list === 'ideal' || ref?.list === 'ideal' ? S().settings().idealPoints ?? 10 : 5);
    q('#mw-title').focus();
    if (kind === 'project') { const hist = document.createElement('details'); hist.innerHTML = '<summary>每日完成记录</summary>' + Object.keys(existing.days || {}).sort().reverse().map(k => '<button type="button" class="btn" data-project-day="' + esc(k) + '">' + esc(k) + ' · 取消本日完成</button>').join(''); q('#mw-form-error').before(hist); hist.querySelectorAll('[data-project-day]').forEach(b => b.onclick = () => A.memoActions.project(ref.id, b.dataset.projectDay)); }
    async function save(b, convert = false) {
      b.disabled = true;
      try { if (await A.memoActions.commit(() => {
        const text = q('#mw-title').value.trim(); if (!text) throw new Error('请填写任务名称'); if (!existing && text.includes('\n')) throw new Error('一次添加一个任务，正文说明可写在备注中');
        const d = S().data(), isProject = kind === 'project' || convert || q('#mw-repeat')?.value === 'daily';
        let t = existing, targetRef = ref;
        if (isProject && kind !== 'project') {
          if (existing?.memoProjectId) throw new Error('此任务已转换，请编辑对应每日项目');
          if (!d.memoProjects) d.memoProjects = [];
          t = { id: S().uid(), text, days: {}, createdAt: new Date().toISOString(), createdDay: day, source: existing ? { id: existing.id, day, list: ref.list } : null };
          d.memoProjects.push(t); targetRef = { kind: 'project', id: t.id, day: ref?.day || (day === M().naturalDay() ? M().userDay() : day) }; t.createdDay = targetRef.day;
          if (existing) { if (existing.done) throw new Error('已完成的旧任务保留历史，请新建每日推进项目'); A.memoSchedule.stopRef(ref); existing.memoProjectId = t.id; }; // Preserve historical source and its ledger; never infer a merge by title.
        } else if (!t) {
          t = { id: S().uid(), createdAt: new Date().toISOString() };
          if (kind === 'queue') { (d.queue || (d.queue = [])).push(t); targetRef = { kind: 'queue', id: t.id }; }
          else { S().getDay(day).tasks[list].push(t); targetRef = { kind: 'task', id: t.id, list, day }; }
        }
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
  function complete(ref) { if (ref.kind === 'task') A.memoActions.task(ref.list, ref.id, ref.day); else if (ref.kind === 'queue') A.memoActions.queue(ref.id); else if (ref.kind === 'daily') A.memoActions.daily(ref.id, ref.day); else A.memoActions.project(ref.id, ref.day); }
  function renderReview(day) {
    const root = $('review-card'); root.innerHTML = '<label>今日复盘</label><textarea id="mw-review-text" rows="6"></textarea><button class="btn btn-primary" id="mw-review-save">保存复盘</button><p id="mw-review-status" role="status"></p>';
    $('mw-review-text').value = day.review?.text || '';
    $('mw-review-save').onclick = async () => { const text = $('mw-review-text').value; if (await commit(() => { day.review = { text, at: new Date().toISOString() }; })) $('mw-review-status').textContent = '已保存'; };
  }
  function init() {
    ready = true; taskDay = M().naturalDay(); lastDay = taskDay;
    const root = $('view-tasks');
    root.insertAdjacentHTML('afterbegin', '<div class="mw-tabs" role="group" aria-label="任务子页面">' + [['today','当天任务'],['queue','任务队列'],['timeline','时间轴']].map(([id, label]) => '<button class="btn" data-mw-pane="' + id + '">' + label + '</button>').join('') + '</div><p id="mw-error" role="alert"></p><div id="mw-today"></div><div id="mw-queue" hidden></div>');
    // Keep legacy review content reachable, with mutation entries retired in memo mode.
    const review = document.createElement('section'); review.id = 'view-memo-review'; review.className = 'view'; review.innerHTML = '<h2>今日复盘</h2><p class="hint">完成和补记请在任务中操作，统一关联笔记、积分与时间轴。</p>'; $('review-card').parentNode.removeChild($('review-card')); review.appendChild(document.createElement('div')).id = 'review-card'; document.querySelector('main').appendChild(review);
    document.querySelectorAll('.mn-grid, header nav').forEach(el => el.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" data-view="memo-review">今日复盘</button>'));
    document.querySelector('.mn-grid').insertAdjacentHTML('beforeend', '<button class="btn" id="mw-trash">删除记录</button>'); $('mw-trash').onclick = () => A.memoActions.trash(); document.querySelector('#main-nav')?.insertAdjacentHTML('beforeend', '<button class="nav-btn btn" id="mw-trash-desktop">删除记录</button>'); if ($('mw-trash-desktop')) $('mw-trash-desktop').onclick = () => A.memoActions.trash();
    document.querySelectorAll('[data-view="memo-review"]').forEach(b => b.onclick = () => { A.app.switchView('memo-review'); const d = S().getDay(M().naturalDay()); renderReview(d); });
    $('schedule-active').before($('schedule-live')); const live = document.createElement('div'); live.id = 'mw-live'; live.append($('schedule-live'), $('schedule-active')); const controls = document.createElement('span'); controls.id = 'mw-live-controls'; live.appendChild(controls); document.querySelector('main').before(live);
    root.querySelectorAll('[data-mw-pane]').forEach(b => b.onclick = () => showPane(b.dataset.mwPane));
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-mw]'), cardEl = e.target.closest('[data-mw-card]');
      if (b) { e.preventDefault(); e.stopImmediatePropagation(); const act = b.dataset.mw, ref = b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
        if (act.startsWith('add-')) return editor(null, act.slice(4));
        if (act === 'edit') return editor(ref);
        if (act === 'complete') return complete(ref);
        if (act === 'today' || act === 'tomorrow') { taskDay = act === 'today' ? M().naturalDay() : M().shiftDay(M().naturalDay(), 1); return renderTasks(); }
        if (act === 'restore-daily') return commit(() => { S().data().daily.find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'daily' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (act === 'restore-project') return commit(() => { projects().find(p => p.id === ref.id).archived = false; A.memoSchedule.state().items.filter(p => p.ref.kind === 'project' && p.ref.id === ref.id).forEach(p => delete p.suspendedByArchive); });
        if (['pin', 'up', 'down'].includes(act)) return commit(() => moveQueue(ref.id, act));
      }
      if (cardEl && !e.target.closest('button,input,textarea,select,a,summary,details,[data-schedule-command]') && !window.getSelection()?.toString()) { e.stopImmediatePropagation(); editor(JSON.parse(cardEl.dataset.ref)); }
    }, true);
    A.tasks.renderAll = render; A.queue.render = () => preserve(renderQueue);
    setInterval(() => { const now = M().naturalDay(); if (now !== lastDay) { if (taskDay === lastDay) taskDay = now; lastDay = now; render(); } }, 30000);
    render();
  }
  A.memoWorkspace = { init, render, enter, leave, showPane, editor, sortedQueue, orderQueue, moveQueue, saveTiming, projects };
})();
