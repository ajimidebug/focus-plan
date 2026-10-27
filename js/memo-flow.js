/* Explicit assignments, prospective overdue rules and copy checkpoints. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  const clone = x => JSON.parse(JSON.stringify(x));
  function state() {
    const f = S().data().memoFlow;
    if (!f || f.version !== 1 || !M().validDate(f.startedDay) || !Array.isArray(f.settlements) || !f.copies || typeof f.copies !== 'object' || Array.isArray(f.copies) || !Number.isFinite(f.rate) || f.rate<=0 || !Number.isFinite(f.penalty) || f.penalty<0 || !Number.isFinite(f.dailyCap) || f.dailyCap<0) throw new Error('新流程记录异常，请先下载备份');
    return f;
  }
  function enableCore(now = Date.now()) {
    if (S().data().memoFlow !== undefined) return state();
    return S().data().memoFlow = { version: 1, startedDay: M().userDay(now), enabledAt: new Date(now).toISOString(), penalty: 2, dailyCap: 10, rate: 2, settlements: [], copies: {} };
  }
  function queues() { const d = S().data(); return (d.queue || []).concat(d.queueDone || []); }
  function assignment(id) { return queues().find(t => t.id === id)?.assignment; }
  function assigned(day, list) { return queues().filter(t => !t.memoDismissed && t.assignment?.day === day && (!list || t.assignment.list === list)); }
  function moveCore(ref, day, list, target = 'task') {
    if (!M().validDate(day) || !['required', 'ideal', 'extra'].includes(list)) throw new Error('请选择有效日期和任务栏目');
    const found = A.memoSchedule.resolve(ref); if (!found) throw new Error('任务已移动或删除');
    const t = found.task, r = found.ref;
    if (t.done || t.doneAt || t.archived || t.memoDismissed) throw new Error('请先恢复未完成状态');
    if (r.kind === 'queue') {
      if (target === 'queue') { if(t.assignment)(t.assignmentHistory||(t.assignmentHistory=[])).push(clone(t.assignment));delete t.assignment; return; }
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
    if (r.day!==day && Object.values(S().getDay(day).tasks).flat().some(x => x.id === t.id && !x.memoMovedTo)) throw new Error('此任务已在目标日，请刷新');
    const next = Object.assign({}, t, { originalDay: t.originalDay || r.day }); delete next.memoMovedTo;
    if (r.day === day) S().getDay(r.day).tasks[r.list] = S().getDay(r.day).tasks[r.list].filter(x => x.id !== t.id);
    else t.memoMovedTo = { kind: 'task', id: t.id, day, list };
    Object.values(S().getDay(day).tasks).forEach(items => { for(let i=items.length-1;i>=0;i--)if(items[i].id===t.id && items[i].memoMovedTo)items.splice(i,1); });
    destination.push(next);
  }
  function overdue(now = Date.now()) {
    const today = M().userDay(now), f = state(), out = [];
    Object.entries(S().data().days).filter(([day]) => day >= f.startedDay && day < today).sort(([a], [b]) => a.localeCompare(b)).forEach(([day, d]) => {
      (d.tasks.required || []).filter(t => !t.done && !t.fromDaily && !t.fromQueue && !t.memoProjectId && !t.memoMovedTo && !t.memoDismissed).forEach(t => out.push({ task: t, ref: { kind: 'task', id: t.id, day, list: 'required' } }));
    });
    (S().data().queue || []).filter(t => !t.memoDismissed && !t.archived && !t.doneAt && t.assignment?.list === 'required' && t.assignment.day >= f.startedDay && t.assignment.day < today).forEach(task => out.push({ task, ref: { kind: 'queue', id: task.id }, day: task.assignment.day }));
    return out;
  }
  function longOverdue(now = Date.now()) {
    const today=M().userDay(now),out=[];
    Object.entries(S().data().days).filter(([day])=>day<today).sort(([a],[b])=>a.localeCompare(b)).forEach(([day,d])=>{
      (d.tasks.extra||[]).filter(t=>!t.done&&!t.doneAt&&!t.archived&&!t.fromDaily&&!t.fromQueue&&!t.memoProjectId&&!t.memoMovedTo&&!t.memoDismissed).forEach(task=>out.push({task,ref:{kind:'task',id:task.id,day,list:'extra'},day}));
    });
    (S().data().queue||[]).filter(t=>!t.doneAt&&!t.done&&!t.archived&&!t.memoDismissed&&t.assignment?.list==='extra'&&t.assignment.day<today).forEach(task=>out.push({task,ref:{kind:'queue',id:task.id},day:task.assignment.day}));
    return out;
  }
  function settleCore(now = Date.now()) {
    const f = state(), today = M().userDay(now), at = new Date(now).toISOString();
    longOverdue(now).forEach(({task:t,ref,day})=>{t.originalDay=t.originalDay||day;t.memoAutoCarry={kind:'extra',at,origin:t.memoAutoCarry?.origin||day};moveCore(ref,today,'extra');});
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
  function isCarried(t) {
    if (t.backfillDay && t.originalDay && t.backfillDay <= t.originalDay) return false;
    return !!t.memoAutoCarry || !!(t.overdueEventId && S().data().memoFlow?.settlements.some(e => e.id === t.overdueEventId && e.taskId === t.id)) || !!t.carried;
  }
  function lateLabel(t) {
    if (t.backfillDay) return (t.backfillDay <= t.originalDay ? '已补记按时完成 · ' : '已补记延期完成 · ') + t.backfillDay;
    if (!t.originalDay) return '';
    const e = S().data().memoFlow?.settlements.find(x => x.id === t.overdueEventId);
    const days = Math.max(0, Math.round((Date.parse(M().userDay() + 'T00:00Z') - Date.parse(t.originalDay + 'T00:00Z')) / 86400000));
    return (t.done || t.doneAt ? '延期完成' : '顺延') + '自' + t.originalDay + ' · ' + days + '天' + (e ? e.forgivenAt ? ' · 扣分已撤销' : ' · 已扣' + e.points + '分' : '');
  }
  function noteCopyQuote(day) {
    const f = state(), snapshots = {}, lines = [];
    const carryDay = M().userDay();
    const baseline = f.copyCarry?.day === carryDay && f.copyCarry.selectedDay === day ? f.copyCarry.baseline : clone(f.copies);
    const prior = f.copies; f.copies = baseline;
    try {
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
    return { id: S().uid(), day, text: lines.join('\n\n'), snapshots, carryDay, baseline, at: new Date().toISOString() };
    } finally { f.copies = prior; }
  }
  function copyQuote(day){const quote=noteCopyQuote(day);return A.memoReport?A.memoReport.attach(quote):quote;}
  function markCopyCore(quote) {
    A.memoReport?.mark(quote);
    const f = state(); if(quote.baseline)f.copyCarry={day:quote.carryDay,selectedDay:quote.day,baseline:quote.baseline}; Object.entries(quote.snapshots).forEach(([day, snapshot]) => { f.copies[day] = Object.assign({}, snapshot, { at: quote.at }); });
    f.lastCopy = quote;
  }
  function backfill(ref) {
    ref=A.memoSchedule.canonical(ref); const t=A.memoSchedule.find(ref); if(!t)return;
    const due=t.originalDay || t.assignment?.day || ref.day, today=M().userDay();
    const m=A.ui.openModal('补记完成', '<label>实际完成用户日<input id="bf-day" type="date" value="'+due+'" max="'+today+'"></label><label>完成说明<textarea id="bf-note"></textarea></label><p>按时完成会退回本任务实际逾期扣分；延期完成保留扣分。不追补历史整组奖励。记录写入今天笔记。</p><p id="bf-preview"></p><p role="alert"></p>', '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认补记</button>', {lock:true});
    const q=x=>m.querySelector(x), e=state().settlements.find(x=>x.id===t.overdueEventId);
    const preview=()=>q('#bf-preview').textContent='完成日期：'+q('#bf-day').value+'；退回 '+(q('#bf-day').value<=due && !e?.forgivenAt ? e?.points||0:0)+' 分'; preview();q('#bf-day').oninput=preview;
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:async b=>{b.disabled=true;try{if(await A.memoActions.commit(()=>{
      const day=q('#bf-day').value; if(!M().validDate(day)||day>today)throw new Error('请选择有效的过去或今日用户日');
      if(day < (t.createdDay || '0000-00-00'))throw new Error('完成日不能早于任务创建日');
      const current=A.memoSchedule.find(ref); if(!current || current.done || current.doneAt)throw new Error('任务状态已改变');
      const refund=day<=due && e && !e.forgivenAt;
      if(refund)forgiveCore(ref,'补记实际完成日：'+day);
      if(ref.kind==='task')moveCore(ref,day,ref.list); else if(current.assignment)moveCore(ref,day,current.assignment.list);
      const target=ref.kind==='task'?{kind:'task',id:ref.id,day,list:ref.list}:ref;
      const task=A.memoSchedule.find(target);task.originalDay=task.originalDay||due;task.backfillDay=day;
      const event=A.memoActions.completeCore({kind:target.kind,id:target.id,day,list:target.list,title:task.text}, M().clock()+'【补记完成】'+task.text+'\n实际完成用户日：'+day+'\n'+q('#bf-note').value);
      event.backfillDay=day;event.penaltyCorrection=refund?e.id:null;
    })){A.ui.closeModal();A.memoWorkspace.render();A.memoSchedule.render();A.app.refreshStats();}}catch(err){q('[role="alert"]').textContent=err.message;}finally{b.disabled=false;}}});
  }
  let settling = false;
  async function settle() {
    if (settling || A.memoEditor?.busy() || A.memoActions.busy() || S().status().readOnly) return;
    if (S().data().memoFlow && A.memoEconomy?.state() && !overdue().length && !longOverdue().length && !A.memoPenalty?.hasPending() && !A.memoEconomy?.hasPending()) return;
    settling = true;
    try { if (await A.memoActions.commit(() => { enableCore(); settleCore(); A.memoPenalty?.settleCore(); A.memoEconomy?.enableCore(); A.memoEconomy?.settleCore(); })) { A.memoWorkspace?.render(); A.app?.refreshStats(); } }
    catch (e) { A.ui.toast(e.message); const el = document.getElementById('flow-save-error'); if (el) { el.hidden = false; el.textContent = '跨日处理尚未保存 · 点此重试'; el.onclick = async () => { try { if (await A.memoActions.commit(() => {})) { el.hidden = true; await settle(); A.memoWorkspace.render(); } } catch (err) { A.ui.toast(err.message); } }; } }
    finally { settling = false; }
  }
  async function init() { await settle(); setInterval(settle, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(); }); }
  A.memoFlow = { backfill, state, enableCore, queues, assignment, assigned, moveCore, longOverdue, overdue, settleCore, settle, forgiveCore, isCarried, lateLabel, copyQuote, markCopyCore, init };
})();
