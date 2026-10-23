/* Explicit assignments, prospective overdue rules and copy checkpoints. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  const clone = x => JSON.parse(JSON.stringify(x));
  function state() {
    const f = S().data().memoFlow;
    if (!f || f.version !== 1 || !M().validDate(f.startedDay) || !Array.isArray(f.settlements) || !f.copies || typeof f.copies !== 'object') throw new Error('新流程记录异常，请先下载备份');
    return f;
  }
  function enableCore(now = Date.now()) {
    if (S().data().memoFlow !== undefined) return state();
    return S().data().memoFlow = { version: 1, startedDay: M().userDay(now), enabledAt: new Date(now).toISOString(), penalty: 2, dailyCap: 10, rate: 2, settlements: [], copies: {} };
  }
  function queues() { const d = S().data(); return (d.queue || []).concat(d.queueDone || []); }
  function assignment(id) { return queues().find(t => t.id === id)?.assignment; }
  function assigned(day, list) { return queues().filter(t => t.assignment?.day === day && (!list || t.assignment.list === list)); }
  function moveCore(ref, day, list, target = 'task') {
    if (!M().validDate(day) || !['required', 'ideal', 'extra'].includes(list)) throw new Error('请选择有效日期和任务栏目');
    const found = A.memoSchedule.resolve(ref); if (!found) throw new Error('任务已移动或删除');
    const t = found.task, r = found.ref;
    if (t.done || t.doneAt || t.archived || t.memoDismissed) throw new Error('请先恢复未完成状态');
    if (r.kind === 'queue') {
      if (target === 'queue') { delete t.assignment; return; }
      if (t.assignment?.day === day && t.assignment.list === list) return;
      (t.assignmentHistory || (t.assignmentHistory = [])).push(clone(t.assignment || { at: new Date().toISOString(), state: '待安排' }));
      t.assignment = { day, list, at: new Date().toISOString() }; return;
    }
    if (r.kind !== 'task') throw new Error('每日推进项目不作为一次性任务移动');
    if (target === 'queue') {
      if (queues().some(q => q.id === t.id)) throw new Error('队列中已存在此任务');
      const q = Object.assign({}, t); delete q.done; delete q.memoMovedTo;
      (S().data().queue || (S().data().queue = [])).push(q);
      t.memoMovedTo = { kind: 'queue', id: q.id }; return;
    }
    if (r.day === day && r.list === list) return;
    const destination = S().getDay(day).tasks[list];
    if (Object.values(S().getDay(day).tasks).flat().some(x => x.id === t.id && !x.memoMovedTo)) throw new Error('此任务已在目标日，请刷新');
    const next = Object.assign({}, t, { originalDay: t.originalDay || r.day }); delete next.memoMovedTo;
    if (r.day === day) S().getDay(r.day).tasks[r.list] = S().getDay(r.day).tasks[r.list].filter(x => x.id !== t.id);
    else t.memoMovedTo = { kind: 'task', id: t.id, day, list };
    destination.push(next);
  }
  function overdue(now = Date.now()) {
    const today = M().userDay(now), f = state(), out = [];
    Object.entries(S().data().days).filter(([day]) => day >= f.startedDay && day < today).sort(([a], [b]) => a.localeCompare(b)).forEach(([day, d]) => {
      (d.tasks.required || []).filter(t => !t.done && !t.fromDaily && !t.fromQueue && !t.memoProjectId && !t.memoMovedTo && !t.memoDismissed).forEach(t => out.push({ task: t, ref: { kind: 'task', id: t.id, day, list: 'required' } }));
    });
    (S().data().queue || []).filter(t => t.assignment?.list === 'required' && t.assignment.day >= f.startedDay && t.assignment.day < today).forEach(task => out.push({ task, ref: { kind: 'queue', id: task.id }, day: task.assignment.day }));
    return out;
  }
  function settleCore(now = Date.now()) {
    const f = state(), today = M().userDay(now), at = new Date(now).toISOString();
    overdue(now).forEach(({ task: t, ref, day }) => {
      const dueDay = day || ref.day, origin = t.originalDay || dueDay;
      let event = f.settlements.find(e => e.taskId === t.id && e.origin === origin);
      if (!event) {
        const paid = f.settlements.filter(e => e.dueDay === dueDay).reduce((s, e) => s + e.points, 0);
        const points = Math.min(Math.max(0, Number(f.penalty) || 0), Math.max(0, (Number(f.dailyCap) || 0) - paid));
        event = { id: S().uid(), taskId: t.id, title: t.text, origin, dueDay, at, points }; f.settlements.push(event);
        if (points) S().data().ledger.push({ id: event.id, operationId: 'overdue:' + t.id + ':' + origin, date: dueDay, type: 'penalty-required', taskId: t.id, points: -points, leisure: 0, at, note: '必做逾期：' + t.text });
      }
      t.originalDay = origin; t.overdueEventId = event.id;
      moveCore(ref, today, 'required');
    });
  }
  function forgiveCore(ref, reason) {
    if (!String(reason || '').trim()) throw new Error('请说明补记或纠错原因');
    const t = A.memoSchedule.find(ref), f = state(), e = f.settlements.find(x => x.id === t?.overdueEventId);
    if (!e || e.forgivenAt) return;
    e.forgivenAt = new Date().toISOString(); e.reason = String(reason).trim();
    const original = S().data().ledger.find(x => x.id === e.id);
    if (original) S().data().ledger.push({ id: S().uid(), operationId: 'forgive:' + e.id, date: M().userDay(), type: 'refund-penalty', points: -original.points, leisure: 0, at: e.forgivenAt, note: '撤销错误扣分：' + e.title + '；' + e.reason });
  }
  function lateLabel(t) {
    if (!t.originalDay) return '';
    const e = S().data().memoFlow?.settlements.find(x => x.id === t.overdueEventId);
    const days = Math.max(0, Math.round((Date.parse(M().userDay() + 'T00:00Z') - Date.parse(t.originalDay + 'T00:00Z')) / 86400000));
    return (t.done || t.doneAt ? '延期完成' : '顺延') + '自' + t.originalDay + ' · ' + days + '天' + (e ? e.forgivenAt ? ' · 扣分已撤销' : ' · 已扣' + e.points + '分' : '');
  }
  function copyQuote(day) {
    const f = state(), snapshots = {}, lines = [];
    Object.keys(S().data().memoNotes || {}).filter(k => M().validDate(k) && k <= day && (k === day || k >= f.startedDay || f.copies[k])).sort().forEach(k => {
      const note = M().read(k), old = f.copies[k], rendered = M().exportBlocks(M().segments(note));
      if (k !== day && old?.rendered === rendered) return;
      if (k !== day && !old && !note.text.trim()) return;
      snapshots[k] = { text: note.text, rendered, revision: note.revision };
      if (k === day) lines.push(M().exportText([k]));
      else if (old && rendered.startsWith(old.rendered) && old.rendered) lines.push('===== 用户日 ' + k + ' · 上次复制后的补记 =====\n' + rendered.slice(old.rendered.length));
      else lines.push('===== 用户日 ' + k + (old ? ' · 修订后的全文（替换此前版本）' : ' · 此前未复制') + ' =====\n' + M().exportText([k]));
    });
    if (!snapshots[day]) lines.push(M().exportText([day]));
    return { id: S().uid(), day, text: lines.join('\n\n'), snapshots, at: new Date().toISOString() };
  }
  function markCopyCore(quote) {
    const f = state(); Object.entries(quote.snapshots).forEach(([day, snapshot]) => { f.copies[day] = Object.assign({}, snapshot, { at: quote.at }); });
    f.lastCopy = quote;
  }
  let settling = false;
  async function settle() {
    if (settling || A.memoActions.busy() || S().status().readOnly) return;
    if (S().data().memoFlow && !overdue().length) return;
    settling = true;
    try { if (await A.memoActions.commit(() => { enableCore(); settleCore(); })) { A.memoWorkspace?.render(); A.app?.refreshStats(); } }
    catch (e) { A.ui.toast(e.message); const el = document.getElementById('flow-save-error'); if (el) { el.hidden = false; el.textContent = '跨日处理尚未保存 · 点此重试'; el.onclick = async () => { try { if (await A.memoActions.commit(() => {})) { el.hidden = true; await settle(); A.memoWorkspace.render(); } } catch (err) { A.ui.toast(err.message); } }; } }
    finally { settling = false; }
  }
  async function init() { await settle(); setInterval(settle, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(); }); }
  A.memoFlow = { state, enableCore, queues, assignment, assigned, moveCore, overdue, settleCore, settle, forgiveCore, lateLabel, copyQuote, markCopyCore, init };
})();
