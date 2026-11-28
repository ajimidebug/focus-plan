/* Explicit, non-overlapping user-day rounds. Task and timer identities stay stable. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  const E = value => S().esc(String(value ?? ''));
  const clone = value => JSON.parse(JSON.stringify(value));
  const boundary = day => Date.parse(day + 'T04:00:00+08:00');
  function state() { return S().data().memoThree || null; }
  function find(id) { return state()?.tasks.find(t => t.id === id); }
  function legacyRound(day) {
    const anchor = state()?.anchor;
    if (!anchor || day < anchor) return null;
    const index = Math.floor((Date.parse(day) - Date.parse(anchor)) / 259200000);
    const start = M().shiftDay(anchor, index * 3);
    return { index, start, end: M().shiftDay(start, 2) };
  }
  function rounds() {
    const x = state();
    if (!x) return [];
    if (x.version === 2) return x.rounds.slice().sort((a, b) => a.start.localeCompare(b.start));
    const last = Math.max((legacyRound(M().userDay())?.index || 0) + 2, ...x.tasks.map(t => t.originRound), x.settledRound);
    return Array.from({ length: last + 1 }, (_, index) => legacyRound(M().shiftDay(x.anchor, index * 3)));
  }
  function round(day = M().userDay()) {
    const r = state()?.version === 1 ? legacyRound(day) : rounds().find(r => r.start <= day && day <= r.end);
    return r ? { ...r, day: Math.floor((Date.parse(day) - Date.parse(r.start)) / 86400000) + 1 } : null;
  }
  function plannedRound(day) {
    const saved = round(day);
    if (saved || !M().validDate(day) || day < M().userDay()) return saved;
    const list = rounds();
    const previous = list.filter(r => r.end < day).at(-1);
    const following = list.find(r => r.start > day);
    const anchor = previous ? M().shiftDay(previous.end, 1) : M().userDay();
    const offset = Math.floor((Date.parse(day) - Date.parse(anchor)) / 259200000) * 3;
    const start = M().shiftDay(anchor, offset);
    const normalEnd = M().shiftDay(start, 2);
    const end = following && following.start <= normalEnd ? M().shiftDay(following.start, -1) : normalEnd;
    return { index: null, start, end };
  }
  function calendarRounds() {
    const result = [];
    let day = M().userDay();
    for (let i = 0; i < 11; i++) {
      let r = plannedRound(day);
      if (r?.closedAt) {
        day = M().shiftDay(r.end, 1);
        r = plannedRound(day);
      }
      if (!r || r.closedAt) break;
      result.push(r);
      day = M().shiftDay(r.end, 1);
    }
    return result;
  }
  function ensureRound(day) {
    const r = plannedRound(day);
    if (!r || r.closedAt || r.end < M().userDay()) throw Error('请选择今天或未来的开放轮次');
    return r.index === null ? saveRoundCore(r.start, r.end, null, r.start <= M().userDay()) : r;
  }
  function byIndex(index) { if(index===null||index===undefined)return null;return rounds().find(r => r.index === Number(index)) || null; }
  function current() { const r = round(); return r && !r.closedAt ? r : null; }
  function legacyRows(r) {
    const start = boundary(r.start), end = boundary(M().shiftDay(r.end, 1));
    return state().tasks.filter(t => t.originRound <= r.index && t.createdDay <= r.end).flatMap(t => {
      const events = (S().data().memoEvents || []).filter(e => e.kind === 'three' && e.sourceId === t.id);
      const validAtEnd = e => !e.undoneAt || Date.parse(e.undoneAt) >= end;
      if (events.some(e => Date.parse(e.at) < start && validAtEnd(e))) return [];
      return [{ id: t.id, text: t.text, done: events.some(e => Date.parse(e.at) < end && validAtEnd(e)), delayed: t.originRound < r.index }];
    });
  }
  function migrateCore() {
    const x = state();
    if (!x || x.version === 2) return;
    const list = rounds(), today = M().userDay(), active = legacyRound(today);
    for (const r of list.filter(r => r.end < today)) {
      const existing = x.history.find(h => h.index === r.index);
      if (!existing) x.history.push({ index: r.index, rows: legacyRows(r) });
      r.closedAt = new Date(boundary(M().shiftDay(r.end, 1))).toISOString();
    }
    for (const t of x.tasks) t.roundIndex = t.done ? legacyRound(M().userDay(t.doneAt))?.index ?? t.originRound : Math.max(t.originRound, active?.index || 0);
    x.version = 2; x.rounds = list; x.settledRound = x.history.length;
  }
  function nativeTarget(task) {
    if (state()?.version === 1) return task.originRound;
    return task.roundIndex ?? null;
  }
  function executable(ref) {
    if (ref.kind !== 'three') return true;
    const t = find(ref.id), r = current();
    if (!t) return false;
    if (!r) return !t.done && nativeTarget(t) === null;
    return state().version === 1 ? t.originRound <= r.index : t.roundIndex === r.index;
  }
  function nativeRow(t) {
    return { id: t.id, key: 'three:' + t.id, text: t.text, task: t, ref: { kind: 'three', id: t.id, list: 'three' }, done: !!t.done, delayed: t.carriedFrom != null, note: t.note || '', due:t.memoGanttEnd || '', kind: 'three' };
  }
  function linkedNodes() { return A.memoGantt?.nodes?.().filter(n => n.ref.kind !== 'three' && (M().validDate(n.task.memoGanttEnd) || n.task.memoRoundAssignment)) || []; }
  function targetOf(node) {
    const a = node.task.memoRoundAssignment;
    if (a?.mode === 'manual') return a.roundIndex;
    if (a?.mode === 'carry' && a.due === (node.task.memoGanttEnd || '')) return a.roundIndex;
    const r=rounds().find(r => r.start <= node.task.memoGanttEnd && node.task.memoGanttEnd <= r.end);
    return r && !r.closedAt ? r.index : null;
  }
  function linkedRow(n, r) {
    const overallDone = n.kind === 'project' ? !!n.task.memoGanttCompletedAt : !!(n.task.done || n.task.doneAt || n.task.doneDay);
    const progressed = n.kind === 'project' && r && Object.entries(n.task.days || {}).some(([d, value]) => value && d >= r.start && d <= r.end);
    return { id: n.id, key: n.key, text: n.title, task: n.task, ref: n.ref, kind: n.kind, done: overallDone || !!progressed, overallDone, delayed: n.task.memoRoundAssignment?.carriedFrom != null, note: n.task.note || '', due: n.task.memoGanttEnd || '', manual: n.task.memoRoundAssignment?.mode === 'manual', conflict: !!r && !!n.task.memoGanttEnd && (n.task.memoGanttEnd < r.start || n.task.memoGanttEnd > r.end) };
  }
  function habitRows(round) {
    if (!A.memoFinance?.plans) return [];
    // Each habit stays associated with its own user day inside the round.
    const rows = [];
    for (let day = round.start; day <= round.end; day = M().shiftDay(day, 1)) {
      for (const {it,r,n} of A.memoFinance.plans(day)) {
        if (r.hidden || r.list !== 'three') continue;
        const punch = A.memoPenalty?.policy(it,day).mode === 'punch';
        const done = !punch && n >= Math.max(1,r.target);
        rows.push({id:it.id, key:'checkin:'+it.id+':'+day, text:it.text, task:it,
          ref:{kind:'checkin',id:it.id,day}, done, note:it.note || '', due:day, delayed:false, kind:'checkin'});
      }
    }
    return rows;
  }
  function liveRows(r) {
    const native = state()?.tasks.filter(t => !t.memoDismissed && !A.memoReview?.hidden(t, 'three') && nativeTarget(t) === r.index).map(nativeRow) || [];
    const linked = linkedNodes().filter(n => targetOf(n) === r.index).map(n => linkedRow(n, r));
    return native.concat(linked,habitRows(r));
  }
  function score(row) {
    if (!row.task) return row.points || 0;
    return A.memoWorkspace ? A.memoWorkspace.score(row.task,row.ref) || 0 : Number(row.task.points) || 0;
  }
  function snapshotRow(row) {
    return { id: row.id, key: row.key, text: row.text, ref: clone(row.ref), kind: row.kind, points: score(row), done: row.done, delayed: row.delayed, note: row.note || '', due: row.due || '', manual: !!row.manual, overallDone: !!row.overallDone };
  }
  function pending() {
    if (!state()) return [];
    const native = state().tasks.filter(t => !t.done && !t.memoDismissed && !A.memoReview?.hidden(t, 'three') && nativeTarget(t) === null).map(nativeRow);
    return native.concat(linkedNodes().filter(n => targetOf(n) === null).map(n => linkedRow(n, null)).filter(r => !r.overallDone));
  }
  function closeCore(index, early = false, now = Date.now()) {
    migrateCore();
    const x = state(), r = x.rounds.find(r => r.index === index);
    if (!r || r.closedAt) throw Error('轮次已结束或不存在');
    const day = M().userDay(now);
    if(!early && day<=r.end)throw Error('轮次尚未到结束日期');
    if (early && (day < r.start || day > r.end)) throw Error('只能提前结束正在进行的轮次');
    const rows = liveRows(r);
    if(early)for(const row of rows){const session=A.memoSchedule.timing(row.ref,now).session;if(session?.status==='running')A.memoSchedule.pauseCore(session,now);}
    x.history.push({ index: r.index, rows: rows.map(snapshotRow) });
    const at = early ? now : boundary(M().shiftDay(r.end, 1));
    r.closedAt = new Date(at).toISOString();
    if (early) { r.originalEnd = r.originalEnd || r.end; r.end = day; }
    let next = rounds().find(next => !next.closedAt && next.start > r.end);
    if (early) {
      const start = M().shiftDay(day, 1);
      if (next) {
        const offset = (Date.parse(start) - Date.parse(next.start)) / 86400000;
        for (const later of x.rounds.filter(other => !other.closedAt && other.start >= next.start)) {
          later.start = M().shiftDay(later.start, offset);
          later.end = M().shiftDay(later.end, offset);
        }
      } else {
        next = saveRoundCore(start, M().shiftDay(start, 2), null, false);
      }
    }
    for (const row of rows.filter(row => !row.done && row.kind !== 'checkin')) {
      if (row.kind === 'three') { row.task.roundIndex = next?.index ?? null; row.task.carriedFrom = row.task.carriedFrom ?? r.index; }
      else row.task.memoRoundAssignment = { mode: 'carry', roundIndex: next?.index ?? null, carriedFrom: row.task.memoRoundAssignment?.carriedFrom ?? r.index, due: row.due };
    }
    x.settledRound = x.history.length;
  }
  function needsSettlement() {
    const x = state();
    return !!x && (x.version === 1 || x.rounds.some(r => !r.closedAt && r.end < M().userDay()));
  }
  function settleCore() {
    migrateCore();
    for (const r of rounds().filter(r => !r.closedAt && r.end < M().userDay())) closeCore(r.index);
  }
  function projection(day = M().userDay()) {
    const r = plannedRound(day);
    if (!r) return { round: null, rows: [], done: 0, total: 0, historical: false, future: false };
    const history = state()?.history.find(h => h.index === r.index);
    const historical = !!r.closedAt || !!history;
    let rows;
    if (historical) rows = (history?.rows || legacyRows(r)).map(row => ({ ...row, key: row.key || 'three:' + row.id, kind: row.kind || 'three', ref: row.ref || { kind: 'three', id: row.id, list: 'three' } }));
    else if (r.index === null) rows = linkedNodes().filter(n => !n.task.memoRoundAssignment && n.task.memoGanttEnd >= r.start && n.task.memoGanttEnd <= r.end).map(n => linkedRow(n,r));
    else if (state().version === 1) rows = state().tasks.filter(t => t.originRound <= r.index && !t.done).map(nativeRow);
    else rows = liveRows(r);
    return { round: r, rows: rows.sort((a,b) => score(b) - score(a)), done: rows.filter(x => x.done).length, total: rows.length, historical, future: r.start > M().userDay() };
  }
  function items(day = M().userDay()) {
    const p = projection(day);
    return p.historical || p.future ? [] : p.rows.filter(x => x.kind === 'three' && x.task).map(x => ({ task: x.task, ref: x.ref, done: x.done }));
  }
  function validateRange(start, end, exclude = null) {
    if (!M().validDate(start) || !M().validDate(end) || end < start) throw Error('请选择有效的开始和结束日期');
    const conflict = rounds().find(r => r.index !== exclude && start <= r.end && end >= r.start);
    if (conflict) throw Error('与轮次 ' + conflict.start + ' — ' + conflict.end + ' 重叠');
  }
  function rangePreview(start, end, index) {
    validateRange(start, end, index);
    const linked=linkedNodes().filter(n => n.task.memoRoundAssignment?.mode !== 'manual' && M().validDate(n.task.memoGanttEnd) && ((start <= n.task.memoGanttEnd && n.task.memoGanttEnd <= end) || targetOf(n) === index)).map(n => n.title + ' · 截止 ' + n.task.memoGanttEnd);
    const native=index===null?[]:(state()?.tasks||[]).filter(t=>nativeTarget(t)===index).map(t=>t.text);
    const deadlines=(A.ms?.list?.()||[]).filter(d=>{const due=d.due||d.end||d.start;return due>=start&&due<=end;}).map(d=>d.name+' · 截止 '+(d.due||d.end||d.start));
    return native.concat(linked,deadlines);
  }
  function saveRoundCore(start, end, index = null, includePending = true) {
    migrateCore(); validateRange(start, end, index);
    if (!state()) S().data().memoThree = { version: 2, anchor: start, rounds: [], tasks: [], history: [], settledRound: 0 };
    const x = state(), existing = x.rounds.find(r => r.index === index);
    if (existing?.closedAt) throw Error('已关闭轮次保留原日期');
    if (start < M().userDay() && !existing) throw Error('新轮次请选择今天或未来日期');
    if (existing && existing.start <= M().userDay() && start !== existing.start) throw Error('进行中的轮次保留开始日期');
    const r = existing || { index: Math.max(-1, ...x.rounds.map(r => r.index)) + 1 };
    Object.assign(r, { start, end });
    if (!existing) x.rounds.push(r);
    if (includePending && !existing) for (const row of pending()) {
      if (row.kind === 'three') row.task.roundIndex = r.index;
      else if (row.task.memoRoundAssignment?.mode === 'carry') row.task.memoRoundAssignment.roundIndex = r.index;
    }
    return r;
  }
  function assignCore(ref, index) {
    migrateCore();
    const task = A.memoSchedule.find(ref); if (!task) throw Error('任务已不存在');
    const r = index === null || index === 'auto' ? null : byIndex(index);
    if (index !== null && index !== 'auto' && (!r || r.closedAt || r.end < M().userDay())) throw Error('请选择开放的轮次');
    if (ref.kind === 'three') {
      if (task.done) throw Error('已完成任务保留原轮次');
      if (index === 'auto') throw Error('请选择具体轮次');
      if (r && r.start > M().userDay() && A.memoSchedule.timing(ref).session?.status !== 'ended' && A.memoSchedule.timing(ref).session) throw Error('请先结束计时，再移到未来轮次');
      task.roundIndex = r?.index ?? null; task.originRound = r?.index ?? task.originRound; delete task.carriedFrom;
    } else if (index === 'auto') delete task.memoRoundAssignment;
    else task.memoRoundAssignment = { mode: 'manual', roundIndex: r?.index ?? null };
  }
  async function run(mutate, after) {
    try { if (await A.memoActions.commit(mutate)) { A.ui.closeModal(); after?.(); A.memoWorkspace.render(); } }
    catch (e) { const error = document.querySelector('#round-error'); if (error) error.textContent = e.message; else A.ui.toast(e.message);
      if(A.memoActions.busy()){const button=document.querySelector('[data-act=save],[data-act=close-round]');if(button)button.textContent='重试保存';} }
  }
  function rangeEditor(index = null, day = M().userDay()) {
    if (A.memoActions.busy()) return A.ui.toast('请先重试保存');
    const r = index === null ? null : byIndex(index);
    if (r?.closedAt) return A.ui.toast('已关闭轮次保留原日期');
    const proposed = r || plannedRound(day);
    if (!proposed || proposed.closedAt) return A.ui.toast('请选择今天或未来日期');
    const { start, end } = proposed;
    const canEndEarly = r && current()?.index === r.index;
    const modal = A.ui.openModal(r ? '调整轮次日期' : '新建轮次', A.memoGantt.dateFields('round', start, end) + '<label><input type="checkbox" id="round-pending" checked>接入尚未安排的轮次任务</label><p id="round-preview" role="status"></p><p id="round-error" role="alert"></p>' + (canEndEarly ? '<button type="button" class="btn" data-act="early-end">提前结束本轮</button>' : ''), '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认保存</button>', { lock: true });
    A.memoGantt.bindDates(modal, 'round');
    modal.querySelector('[data-range-deadline]').hidden = true;
    const preview = () => { try { const rows = rangePreview(modal.querySelector('#round-start').value, modal.querySelector('#round-end').value, index); modal.querySelector('#round-preview').textContent = rows.length ? '关联任务及截止事项：' + rows.join('、') : '此范围暂无关联任务或截止事项'; modal.querySelector('#round-error').textContent = ''; } catch (e) { modal.querySelector('#round-error').textContent = e.message; } };
    modal.addEventListener('change', preview); modal.addEventListener('click', () => requestAnimationFrame(preview)); preview();
    A.ui.bindActions({ cancel: A.ui.closeModal, 'early-end': () => {
      if (A.memoActions.busy() || current()?.index !== r?.index) return;
      A.ui.closeModal(); earlyEnd(r.index);
    }, save: () => run(() => {
      saveRoundCore(modal.querySelector('#round-start').value, modal.querySelector('#round-end').value, index, modal.querySelector('#round-pending').checked);
    }) });
  }
  function earlyEnd(index) {
    const r = byIndex(index); if (!r || r.closedAt) return;
    const p = projection(r.start), rows = p.rows.filter(x => !x.done);
    const tomorrow = M().shiftDay(M().userDay(), 1);
    const modal = A.ui.openModal('提前结束本轮',
      '<p>本轮结束后的下一轮将从 '+E(tomorrow)+' 开始。后续轮次随之移动，已排任务保留。</p>'+
      '<p>已完成 '+p.done+' 项，未完成 '+rows.length+' 项将结转至下一轮。</p>'+
      '<p id="round-error" role="alert"></p>',
      '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="close-round">确认提前结束</button>', { lock: true });
    A.ui.bindActions({ cancel: A.ui.closeModal,
      'close-round': () => run(() => closeCore(index, true), () => A.memoWorkspace.setDay(tomorrow)) });
  }
  function editor(ref, day) { return A.memoWorkspace.editor(ref, 'three', false, ref ? null : day); }

  A.memoThree = { state, find, rounds, round, byIndex, current, nativeTarget, executable, targetOf, linkedNodes, pending, projection, items, needsSettlement, settleCore, migrateCore, closeCore, saveRoundCore, assignCore, rangeEditor, earlyEnd, plannedRound, calendarRounds, ensureRound, editor };
})();
