/* Explicit plans and execution timestamps; never infer activity from memo text. */
(function () {
  'use strict';
  const App = window.App = window.App || {}, S = () => App.store, M = () => App.memoCore;
  const $ = id => document.getElementById(id), esc = value => S().esc(String(value ?? ''));
  let selectedDay, mode = false, interval;
  const clone = x => JSON.parse(JSON.stringify(x));
  function state() {
    const d = S().data();
    if (d.memoSchedule === undefined) d.memoSchedule = { version: 1, items: [], sessions: [] };
    const x = d.memoSchedule;
    if (!x || x.version !== 1 || !Array.isArray(x.items) || !Array.isArray(x.sessions)) throw new Error('时间线格式异常，请先下载完整备份');
    if (x.items.some(p => !p || typeof p.id !== 'string' || !M().validDate(p.day) || !Number.isFinite(p.start) || (p.type !== 'point' && p.type !== 'span') || (p.type === 'span' && (!Number.isFinite(p.end) || p.end <= p.start))) || x.sessions.some(s => !s || !Array.isArray(s.chunks) || !['running', 'paused', 'ended'].includes(s.status) || s.chunks.some(c => !Number.isFinite(c.start) || (c.end != null && (!Number.isFinite(c.end) || c.end < c.start))))) throw new Error('时间线记录异常，请先下载完整备份');
    return x;
  }
  function find(ref) {
    const d = S().data();
    if (ref.kind === 'queue') return (d.queue || []).concat(d.queueDone || []).find(t => t.id === ref.id);
    return d.days[ref.day]?.tasks?.[ref.list]?.find(t => t.id === ref.id);
  }
  function key(ref) { return JSON.stringify([ref.kind, ref.id, ref.day || '', ref.list || '']); }
  function sources() {
    const d = S().data(), out = [];
    (d.queue || []).forEach(t => out.push({ ref: { kind: 'queue', id: t.id }, title: t.text, label: '队列 · ' + t.text }));
    const day = S().getDay(selectedDay || M().naturalDay());
    ['required', 'ideal', 'extra'].forEach(list => (day.tasks[list] || []).filter(t => !t.fromQueue && !t.fromDaily).forEach(t => out.push({ ref: { kind: 'task', id: t.id, day: selectedDay, list }, title: t.text, label: '当天 · ' + t.text })));
    return out;
  }
  function elapsed(session, now = Date.now()) {
    return session.chunks.reduce((sum, c) => sum + Math.max(0, (c.end == null ? now : c.end) - c.start), 0);
  }
  function duration(ms) { const sec = Math.floor(Math.max(0, ms) / 1000); return Math.floor(sec / 3600) + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  function active() { return state().sessions.find(s => s.status === 'running'); }
  function pauseCore(session, now) { if (session.status !== 'running') return; const chunk = session.chunks[session.chunks.length - 1]; chunk.end = Math.max(chunk.start, now); session.status = 'paused'; }
  function startCore(id, now = Date.now()) {
    const d = state(), item = d.items.find(p => p.id === id && !p.deleted);
    if (!item || !find(item.ref)) throw new Error('任务已删除或移动，请重新选择');
    if (isDone(item)) throw new Error('任务已完成；取消完成或添加新任务后再计时');
    const running = active(); if (running?.itemId === id) return running;
    if (running) pauseCore(running, now);
    let session = d.sessions.find(s => s.itemId === id && s.status === 'paused');
    if (session) { session.status = 'running'; session.chunks.push({ start: now, end: null }); }
    else { session = { id: S().uid(), itemId: id, ref: clone(item.ref), title: item.title, status: 'running', chunks: [{ start: now, end: null }] }; d.sessions.push(session); }
    return session;
  }
  function stopCore(id, now = Date.now()) { state().sessions.filter(s => s.itemId === id && s.status !== 'ended').forEach(s => { pauseCore(s, now); s.status = 'ended'; }); }
  function pause(id, now = Date.now()) { const s = state().sessions.find(s => s.itemId === id && s.status === 'running'); if (s) pauseCore(s, now); }
  function stopRef(ref, now = Date.now(), deleted = false) {
    const d = state(); d.items.filter(p => key(p.ref) === key(ref)).forEach(p => { stopCore(p.id, now); if (deleted) p.deleted = true; });
  }
  function isDone(item) { const t = find(item.ref); return !!(t && (item.ref.kind === 'queue' ? t.doneAt || t.doneDay : t.done)); }
  function savePlan(input, id) {
    const d = state();
    if (!M().validDate(input.day) || !Number.isFinite(input.start) || !['point', 'span'].includes(input.type) || (input.type === 'span' && (!Number.isFinite(input.end) || input.end <= input.start || input.end - input.start > 86400000))) throw new Error('请填写有效的日期和时间，时间段最长24小时');
    if (!find(input.ref)) throw new Error('关联任务已移动，请重新选择');
    const old = id && d.items.find(p => p.id === id && !p.deleted);
    if (id && !old) throw new Error('计划已删除');
    if (!id && d.items.some(p => !p.deleted && p.day === input.day && key(p.ref) === key(input.ref))) throw new Error('这条任务当天已有计划，请修改原计划');
    const next = Object.assign(old || { id: S().uid(), createdAt: new Date().toISOString() }, input, { updatedAt: new Date().toISOString() });
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
    if (old && !all.some(x => key(x.ref) === key(old.ref))) all.unshift({ ref: old.ref, title: old.title, label: old.title });
    const m = App.ui.openModal(old ? '修改时间计划' : '安排任务时间',
      '<label for="sp-source">关联任务</label><select id="sp-source"><option value="new">＋ 新建队列任务</option>' + all.map((x, i) => '<option value="' + i + '">' + esc(x.label) + '</option>').join('') + '</select>' +
      '<div id="sp-new-wrap"><label for="sp-title">新任务名称</label><input id="sp-title" maxlength="500"></div>' +
      '<label for="sp-day">日期（北京时间）</label><input type="date" id="sp-day"><label for="sp-type">时间类型</label><select id="sp-type"><option value="span">时间段任务</option><option value="point">时间点任务</option></select>' +
      '<div class="schedule-fields"><label>开始／时间点<input type="time" id="sp-start" aria-label="计划开始时间"></label><label id="sp-end-wrap">结束<input type="time" id="sp-end" aria-label="计划结束时间"><span><input type="checkbox" id="sp-next">次日结束</span></label></div>' +
      '<p class="hint">只修改计划，不改写已经发生的执行计时。重叠任务不会自动顺延。</p><p id="sp-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存计划</button>', { lock: true });
    const q = s => m.querySelector(s), ref = old?.ref || preset;
    q('#sp-source').value = ref ? String(all.findIndex(x => key(x.ref) === key(ref))) : 'new';
    q('#sp-day').value = old?.day || selectedDay;
    q('#sp-start').value = old ? time(old.start) : M().clock();
    q('#sp-end').value = old?.end ? time(old.end) : time(Date.now() + 30 * 60000);
    q('#sp-next').checked = old?.end ? M().naturalDay(old.end) !== old.day : M().naturalDay(Date.now() + 30 * 60000) !== selectedDay;
    q('#sp-type').value = old?.type || 'span';
    if (old) q('#sp-source').disabled = true;
    function visibility() { q('#sp-new-wrap').hidden = q('#sp-source').value !== 'new'; q('#sp-end-wrap').hidden = q('#sp-type').value === 'point'; }
    q('#sp-source').onchange = visibility; q('#sp-type').onchange = visibility; visibility();
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
          const day = q('#sp-day').value, type = q('#sp-type').value;
          savePlan({ ref: source.ref, title: source.title, day, type, start: at(day, q('#sp-start').value), end: type === 'span' ? at(day, q('#sp-end').value, q('#sp-next').checked) : null }, old?.id);
          selectedDay = day;
        });
        if (saved) { App.ui.closeModal(); render(); App.queue?.render(); }
      } catch (e) { q('#sp-error').textContent = e.message; if (App.memoActions.busy()) button.textContent = '重试保存'; }
      finally { button.disabled = false; }
    } });
  }
  function tick() {
    try {
      const d = state(), now = Date.now(), current = d.sessions.find(s => s.status === 'running');
      const paused = d.sessions.filter(s => s.status === 'paused');
      const live = $('schedule-live'); if (live) live.textContent = current ? '执行中 · ' + current.title + ' ' + duration(elapsed(current, now)) : paused.length ? '有 ' + paused.length + ' 项执行计时已暂停' : '';
      const back = $('schedule-active'); if (back) back.hidden = !current && !paused.length;
      if (!mode || document.hidden) return;
      document.querySelectorAll('[data-schedule-elapsed]').forEach(el => { const s = d.sessions.find(s => s.id === el.dataset.scheduleElapsed); if (s) el.textContent = duration(elapsed(s, now)); });
      const start = dayStart(selectedDay), pos = (now - start) / 60000;
      const line = $('schedule-now'); if (line) { line.hidden = pos < 0 || pos >= 1440; line.style.top = pos * .8 + 'px'; line.textContent = '现在 ' + M().clock(now); }
      document.querySelectorAll('[data-plan-clock]').forEach(el => { const p = d.items.find(x => x.id === el.dataset.planClock); if (!p) return;
        if (isDone(p)) el.textContent = '已完成';
        else if (p.type === 'point') el.textContent = now < p.start ? '距时间点 ' + duration(p.start - now) : '时间已到 · 已过 ' + duration(now - p.start);
        else el.textContent = now < p.start ? '距计划开始 ' + duration(p.start - now) : now <= p.end ? '距计划结束 ' + duration(p.end - now) : '计划区间已结束';
      });
      document.querySelectorAll('[data-live-block]').forEach(el => { const s = d.sessions.find(s => s.id === el.dataset.liveBlock), c = s?.chunks[s.chunks.length - 1]; if (c && c.end == null) el.style.height = Math.max(28, (offset(now, start) - offset(c.start, start)) * .8) + 'px'; });
    } catch (e) { const live = $('schedule-live'); if (live) live.textContent = e.message; }
  }
  function render() {
    const root = $('memo-schedule-panel'); if (!root) return;
    try {
      const d = state(), day = selectedDay || M().naturalDay(), start = dayStart(day), end = start + 86400000, now = Date.now(); selectedDay = day;
      const scroll = root.querySelector('.schedule-scroll')?.scrollTop;
      const plans = d.items.filter(p => !p.deleted && p.start < end && (p.type === 'point' ? p.start >= start : p.end > start)).sort((a, b) => a.start - b.start);
      const chunks = [];
      d.sessions.forEach(s => s.chunks.forEach((c, i) => { const stop = c.end ?? now; if (c.start < end && stop >= start) chunks.push({ id: s.id + '-' + i, session: s, start: offset(c.start, start), end: Math.max(offset(c.start, start) + 35, offset(stop, start)), realEnd: offset(stop, start), running: c.end == null }); }));
      function box(e, actual) {
        const p = actual ? e.session : e.item, top = e.start * .8, height = Math.max(28, ((actual ? e.realEnd : e.end) - e.start) * .8);
        return '<div class="schedule-block ' + (actual ? 'schedule-actual' : 'schedule-plan') + (p.type === 'point' ? ' schedule-point' : '') + '" style="top:' + top + 'px;height:' + height + 'px;left:' + (e.column * 100 / e.columns) + '%;width:calc(' + (100 / e.columns) + '% - 4px)"' + (actual && e.running ? ' data-live-block="' + esc(p.id) + '"' : '') + '><strong>' + esc((actual ? p.title : find(p.ref)?.text || p.title)) + '</strong><small>' + (actual ? '执行计时' : time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + '</small></div>';
      }
      const planEvents = plans.map(p => ({ item: p, start: offset(p.start, start), end: p.type === 'point' ? offset(p.start, start) + 35 : Math.max(offset(p.start, start) + 35, offset(p.end, start)) }));
      const plannedKeys = new Set(plans.map(p => key(p.ref))), waiting = sources().filter(x => !plannedKeys.has(key(x.ref)) && !isDone({ ref: x.ref }));
      root.innerHTML = '<div class="schedule-header"><div><h2>计划／执行时间线</h2><p class="hint">北京时间自然日 · 计划与执行分开；到点不会自动完成任务。</p></div><button class="btn btn-primary" data-sc="add">＋ 安排任务</button></div><div class="memo-date-row"><input type="date" id="schedule-date" aria-label="时间线日期" data-transient="true" value="' + day + '"><button class="btn btn-small" data-sc="today">今天</button><button class="btn btn-small" data-sc="now">定位当前时间</button><button class="btn btn-small" id="schedule-retry" data-sc="retry" hidden>重试保存</button></div>' +
        '<div class="schedule-legend"><span>时间</span><strong>计划</strong><strong>实际执行</strong></div><div class="schedule-scroll"><div class="schedule-axis"><div class="schedule-hours">' + Array.from({ length: 24 }, (_, i) => '<span style="top:' + i * 48 + 'px">' + String(i).padStart(2, '0') + ':00</span>').join('') + '</div><div class="schedule-lane">' + columns(planEvents).map(e => box(e, false)).join('') + '</div><div class="schedule-lane">' + columns(chunks).map(e => box(e, true)).join('') + '</div><div id="schedule-now"></div></div></div><div class="schedule-cards">' + plans.map(p => {
          const sessions = d.sessions.filter(s => s.itemId === p.id), session = sessions.find(s => s.status !== 'ended'), task = find(p.ref), missing = !task;
          return '<article class="schedule-card"><strong>' + esc(task?.text || p.title) + '</strong><p>' + esc(time(p.start) + (p.end ? '—' + (M().naturalDay(p.end) !== p.day ? '次日' : '') + time(p.end) : ' · 时间点')) + ' · <span data-plan-clock="' + esc(p.id) + '"></span></p>' + sessions.map(s => '<p class="hint">' + ({ running: '执行中', paused: '已暂停', ended: '已结束' }[s.status]) + ' <span data-schedule-elapsed="' + esc(s.id) + '">' + duration(elapsed(s)) + '</span></p>').join('') + '<div class="memo-queue-actions">' + (missing ? '<span>原任务已移动</span>' : '<button class="btn btn-small" data-sc="' + (session?.status === 'running' ? 'pause' : 'start') + '" data-id="' + esc(p.id) + '"' + (isDone(p) ? ' disabled' : '') + '>' + (session?.status === 'running' ? '暂停' : session ? '继续计时' : '开始计时') + '</button>' + (session ? '<button class="btn btn-small" data-sc="stop" data-id="' + esc(p.id) + '">结束计时</button>' : '') + '<button class="btn btn-small btn-primary" data-sc="complete" data-id="' + esc(p.id) + '">' + (isDone(p) ? '取消完成' : '勾选完成') + '</button>') + '<button class="btn btn-small" data-sc="edit" data-id="' + esc(p.id) + '">改计划</button><button class="btn btn-small" data-sc="unschedule" data-id="' + esc(p.id) + '">移除计划</button></div></article>';
        }).join('') + '</div><details class="card"><summary>待安排任务（' + waiting.length + '）</summary>' + waiting.map((x, i) => '<div class="memo-queue-row"><strong>' + esc(x.title) + '</strong> <button class="btn btn-small" data-sc="arrange" data-index="' + i + '">安排时间</button><button class="btn btn-small" data-sc="start-now" data-index="' + i + '">现在开始</button></div>').join('') + '</details><details class="card"><summary>当天执行记录（包括已移除计划）</summary>' + d.sessions.filter(s => s.chunks.some(c => c.start < end && (c.end ?? now) >= start)).map(s => '<p>' + esc(s.title) + ' · ' + duration(elapsed(s)) + ' · ' + ({ running: '执行中', paused: '已暂停', ended: '已结束' }[s.status]) + '</p>').join('') + '</details>';
      root.querySelector('#schedule-date').onchange = e => { if (M().validDate(e.target.value)) { selectedDay = e.target.value; render(); } };
      root.onclick = async e => {
        const button = e.target.closest('[data-sc]'); if (!button) return;
        const act = button.dataset.sc, id = button.dataset.id, item = d.items.find(p => p.id === id);
        if (act === 'add' || act === 'edit') return choosePlan(id);
        if (act === 'arrange') return choosePlan(null, waiting[Number(button.dataset.index)]?.ref);
        if (act === 'start-now') {
          const source = waiting[Number(button.dataset.index)]; if (!source) return;
          const start = () => perform(() => { const now = Date.now(); selectedDay = M().naturalDay(now); const item = savePlan({ ref: source.ref, title: source.title, day: selectedDay, type: 'point', start: now, end: null }); startCore(item.id, now); });
          return active() ? App.ui.confirm('暂停当前执行任务，并从现在开始计时这项任务？', '切换计时', start) : start();
        }
        if (act === 'today') { selectedDay = M().naturalDay(); render(); return; }
        if (act === 'now') { if (selectedDay !== M().naturalDay()) { selectedDay = M().naturalDay(); render(); } locate(); return; }
        if (act === 'retry') return perform(() => {});
        if (!item) return;
        if (act === 'complete') { const ref = item.ref; return ref.kind === 'queue' ? App.memoActions.queue(ref.id) : App.memoActions.task(ref.list, ref.id, ref.day); }
        if (act === 'start') { const running = active(); if (running && running.itemId !== id) return App.ui.confirm('暂停“' + esc(running.title) + '”，开始这条任务？', '切换计时', () => perform(() => startCore(id))); return perform(() => startCore(id)); }
        if (act === 'pause') return perform(() => pause(id));
        if (act === 'stop') return perform(() => stopCore(id));
        if (act === 'unschedule') return App.ui.confirm('移除这项计划并结束它的活动计时？任务、积分和历史执行记录保留。', '移除计划', () => perform(() => { stopCore(id); item.deleted = true; }));
      };
      const scroller = root.querySelector('.schedule-scroll'); scroller.scrollTop = scroll === undefined ? Math.max(0, (day === M().naturalDay() ? (Date.now() - start) / 60000 : offset(plans[0]?.start || start, start)) * .8 - 130) : scroll;
      tick();
    } catch (e) { root.textContent = e.message; }
  }
  function locate(value = Date.now()) { const el = document.querySelector('#memo-schedule-panel .schedule-scroll'); if (el) el.scrollTop = Math.max(0, (value - dayStart(selectedDay)) / 60000 * .8 - 130); }
  function setMode(value) { mode = value; $('view-tasks').classList.toggle('task-schedule-mode', value); $('memo-schedule-panel').hidden = !value; $('task-list-switch').classList.toggle('btn-primary', !value); $('task-schedule-switch').classList.toggle('btn-primary', value); if (value) { render(); locate(selectedDay === M().naturalDay() ? Date.now() : dayStart(selectedDay) + 12 * 3600000); } }
  function init() {
    selectedDay = M().naturalDay(); $('task-list-switch').onclick = () => setMode(false); $('task-schedule-switch').onclick = () => setMode(true);
    $('memo-trash-open').onclick = () => App.memoActions.trash();
    $('schedule-active').onclick = () => { const d = state(), session = d.sessions.find(s => s.status === 'running') || d.sessions.find(s => s.status === 'paused'); const item = session && d.items.find(p => p.id === session.itemId); if (item) { selectedDay = item.day; setMode(true); locate(item.start); } };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (mode) render(); tick(); } });
    window.addEventListener('focus-storage', tick);
    if (interval) clearInterval(interval); interval = setInterval(tick, 1000); tick();
  }
  App.memoSchedule = { init, render, state, startCore, stopCore, stopRef, pause, savePlan, elapsed, columns, find, busy: () => { try { return state().sessions.some(s => s.status !== 'ended'); } catch (_) { return true; } } };
})();
