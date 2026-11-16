/* Three-user-day plans keep one task identity across rounds and timers. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  const esc = value => S().esc(String(value ?? ''));
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
    const snapshots = closed?.rows || (historical ? rowsAt(r.index, r.end) : null);
    const rows = snapshots ? snapshots.map(row => ({ ...row, task: find(row.id), ref: { kind: 'three', id: row.id, list: 'three' } })) :
      state().tasks.filter(t => t.originRound <= r.index && (!t.done || round(M().userDay(t.doneAt))?.index === r.index)).map(task => ({
        id: task.id, text: task.text, task, ref: { kind: 'three', id: task.id, list: 'three' }, done: !!task.done, delayed: task.originRound < r.index
      }));
    return { round: r, rows, done: rows.filter(t => t.done).length, total: rows.length, historical };
  }
  function items(day = M().userDay()) {
    const p = projection(day);
    return p.historical ? [] : p.rows.filter(x => x.task).map(x => ({ task: x.task, ref: x.ref, done: x.done }));
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
  function editor(ref) {
    if (!state()) return setup();
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存');
    const task = ref && find(ref.id);
    if (ref && !task) return A.ui.toast('任务已移动或删除');
    const modal = A.ui.openModal(task ? '编辑三天任务' : '添加三天任务',
      '<label>任务名称<textarea id="three-title" rows="2"></textarea></label><label>备注<textarea id="three-note" rows="2"></textarea></label><label>完成积分<input id="three-points" type="number" min="0" max="1000000" step="0.01"></label><label>预计用时（分钟）<input id="three-estimate" type="number" min="0" max="1440"></label><p id="three-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">关闭</button>' + (task ? '<button class="btn btn-danger" data-act="delete">删除</button><button class="btn" data-act="complete">' + (task.done ? '取消完成' : '完成任务') + '</button><button class="btn" data-act="enqueue">加入队列</button>' : '') + '<button class="btn btn-primary" data-act="save">保存</button>');
    const q = id => modal.querySelector('#three-' + id);
    q('title').value = task?.text || ''; q('note').value = task?.note || '';
    q('points').value = task?.points ?? S().settings().extPoints ?? 5; q('estimate').value = task?.estimatedMinutes || '';
    const history = task && (S().data().memoEvents || []).filter(e => e.kind === 'three' && e.sourceId === task.id && !e.active);
    if (history?.length) {
      const detail = document.createElement('details');
      detail.innerHTML = '<summary>已撤销记录（' + history.length + '）</summary>' + history.map(e => '<article><p>' + esc(e.at) + '</p><pre>' + esc([e.remark, e.noteInput?.body].filter(Boolean).join('\n')) + '</pre></article>').join('');
      q('error').before(detail);
    }
    let saving = false;
    A.ui.bindActions({ cancel: () => { if (!saving && !A.memoActions.busy()) A.ui.closeModal(); },
      delete: () => { if (!saving && !A.memoActions.busy()) A.memoActions.deleteTask({ kind: 'three', id: task.id, list: 'three' }); },
      complete: () => { if (!saving && !A.memoActions.busy()) A.memoActions.three(task.id); },
      enqueue: async () => { if (!saving && !A.memoActions.busy() && await A.memoWorkspace.execAdd({ kind: 'three', id: task.id, list: 'three' })) A.ui.closeModal(); },
      save: async button => {
        if (saving) return; saving = true; button.disabled = true;
        try {
          const text = q('title').value.trim(), points = Number(q('points').value), estimate = Number(q('estimate').value);
          if (!text) throw Error('请填写任务名称');
          if (!Number.isFinite(points) || points < 0 || points > 1000000 || Math.abs(Math.round(points * 100) - points * 100) > 1e-7) throw Error('积分须为0—1000000之间的两位小数');
          if (!Number.isFinite(estimate) || estimate < 0 || estimate > 1440) throw Error('预计用时须为0—1440分钟');
          if (await A.memoActions.commit(() => {
            let current = task && find(task.id);
            if (task && !current) throw Error('任务已删除');
            if (!current) { current = { id: S().uid(), createdDay: M().userDay(), originRound: round().index, done: false }; state().tasks.push(current); }
            Object.assign(current, { text, note: q('note').value, points, estimatedMinutes: estimate });
          })) { A.ui.closeModal(); A.memoWorkspace.render(); A.memoSchedule.render(); }
        } catch (e) { q('error').textContent = e.message; button.textContent = A.memoActions.busy() ? '重试保存' : '保存'; }
        finally { saving = false; button.disabled = false; }
      }
    });
  }
  A.memoThree = { state, find, round, projection, items, needsSettlement, settleCore, setup, editor };
})();
