/* Three-user-day plans keep one task identity across rounds and timers. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  function state() { return S().data().memoThree || null; }
  function find(id) { return state()?.tasks.find(t => t.id === id); }
  function round(day = M().userDay()) {
    const anchor = state()?.anchor;
    if (!anchor || day < anchor) return null;
    const index = Math.floor((Date.parse(day) - Date.parse(anchor)) / 259200000);
    const start = M().shiftDay(anchor, index * 3);
    return { index, start, end: M().shiftDay(start, 2), day: Math.floor((Date.parse(day) - Date.parse(start)) / 86400000) + 1 };
  }
  function rowsAt(index, throughDay) {
    const x = state();
    if (!x) return [];
    const end = Date.parse(M().shiftDay(x.anchor, (index + 1) * 3) + 'T04:00:00+08:00');
    return x.tasks.filter(t => t.originRound <= index && t.createdDay <= throughDay).flatMap(t => {
      const events = (S().data().memoEvents || []).filter(e => e.kind === 'three' && e.sourceId === t.id);
      const completedBefore = events.some(e => Date.parse(e.at) < Date.parse(M().shiftDay(x.anchor, index * 3) + 'T04:00:00+08:00') && (!e.undoneAt || Date.parse(e.undoneAt) >= end));
      if (completedBefore) return [];
      const done = events.some(e => Date.parse(e.at) < end && (!e.undoneAt || Date.parse(e.undoneAt) >= end));
      return [{ id: t.id, text: t.text, done, delayed: t.originRound < index }];
    });
  }
  function needsSettlement() { const r = round(); return !!r && state().settledRound < r.index; }
  function settleCore() {
    const x = state(), r = round();
    if (!x || !r) return;
    while (x.settledRound < r.index) {
      const index = x.settledRound;
      x.history.push({ index, rows: rowsAt(index, M().shiftDay(x.anchor, index * 3 + 2)) });
      x.settledRound++;
    }
  }
  function projection(day = M().userDay()) {
    const r = round(day);
    if (!r) return { round: null, rows: [], done: 0, total: 0, historical: false };
    const closed = state().history.find(h => h.index === r.index);
    const current = round();
    const historical = !!closed || r.index < current.index;
    const future = r.index > current.index;
    const snapshots = closed?.rows || (historical ? rowsAt(r.index, r.end) : null);
    const rows = snapshots ? snapshots.map(row => ({ ...row, task: find(row.id), ref: { kind: 'three', id: row.id, list: 'three' } })) :
      state().tasks.filter(t => (future ? t.originRound === r.index : t.originRound <= r.index) && (!t.done || round(M().userDay(t.doneAt))?.index === r.index)).map(task => ({
        id: task.id, text: task.text, task, ref: { kind: 'three', id: task.id, list: 'three' }, done: !!task.done, delayed: task.originRound < r.index
      }));
    return { round: r, rows, done: rows.filter(t => t.done).length, total: rows.length, historical, future };
  }
  function items(day = M().userDay()) {
    const p = projection(day);
    return p.historical || p.future ? [] : p.rows.filter(x => x.task).map(x => ({ task: x.task, ref: x.ref, done: x.done }));
  }
  function setup() {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存');
    const modal = A.ui.openModal('开始三天计划', '<label>第一轮开始日期<input type="date" id="three-anchor" value="' + M().userDay() + '"></label><p id="three-error" role="alert"></p>', '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">开始</button>');
    A.ui.bindActions({ cancel: A.ui.closeModal, save: async () => {
      try {
        const anchor = modal.querySelector('#three-anchor').value;
        if (!M().validDate(anchor) || anchor > M().userDay()) throw Error('请选择今天或更早的开始日期');
        if (await A.memoActions.commit(() => {
          if (state()) throw Error('三天计划已经启用');
          S().data().memoThree = { version: 1, anchor, tasks: [], history: [], settledRound: 0 };
          settleCore();
        })) { A.ui.closeModal(); A.memoWorkspace.render(); }
      } catch (e) { modal.querySelector('#three-error').textContent = e.message; }
    } });
  }
  let viewedRound = null;
  function viewOffset(day, value) {
    const base = round(day)?.start;
    if (value !== undefined) viewedRound = { base, offset: value };
    return viewedRound?.base === base ? viewedRound.offset : 0;
  }
  function editor(ref, day) { return A.memoWorkspace.editor(ref, 'three', false, day); }
  A.memoThree = { state, find, round, projection, items, needsSettlement, settleCore, setup, editor, viewOffset };
})();

