/* Habit discipline: opt-in missed-day and bad-habit penalties, one durable ledger. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore;
  const modes = ['reward', 'miss', 'punch'];
  const validPolicy = p => p && modes.includes(p.mode) &&
    Number.isSafeInteger(p.amount) && p.amount >= 0 && p.amount <= 10000 &&
    Number.isSafeInteger(p.target) && p.target >= 0 && p.target <= 10000 &&
    M().validDate(p.from) && (!p.until || M().validDate(p.until));
  function policies(it) {
    const arr = it.memoPenaltyPolicies || [];
    if (!Array.isArray(arr) || arr.some(p => !validPolicy(p)))
      throw new Error('习惯奖惩规则结构异常，请先导出完整备份');
    return arr;
  }
  function policy(it, day) {
    const p = policies(it).filter(p => p.from <= day && (!p.until || day < p.until))
      .sort((a,b)=>a.from.localeCompare(b.from)).at(-1);
    return p || { mode: 'reward', amount: 0, target: S().habitRules(it).target };
  }
  function configure(it, mode, amount, target, from) {
    if (!modes.includes(mode) || !Number.isSafeInteger(amount) || amount < 0 || amount > 10000 ||
        !Number.isSafeInteger(target) || target < 0 || target > 10000 || !M().validDate(from) ||
        (mode === 'miss' && target === 0)) throw new Error('奖惩设置不符合要求');
    const arr = policies(it), current = policy(it, from);
    if (current.mode === mode && (mode === 'reward' || (current.amount === amount && current.target === target))) return;
    arr.forEach(p => { if (p.from < from && (!p.until || p.until > from)) p.until = from; });
    const old = arr.findIndex(p => p.from === from);
    if (old >= 0) arr.splice(old, 1);
    arr.push({ mode, amount, target, from });
    it.memoPenaltyPolicies = arr;
  }
  function settlements() {
    const d = S().data();
    if (d.memoHabitPenalties === undefined) d.memoHabitPenalties = [];
    if (!Array.isArray(d.memoHabitPenalties)) throw new Error('习惯扣分结算结构异常');
    return d.memoHabitPenalties;
  }
  function eachClosed(now, callback) {
    const today = M().userDay(now), yesterday = M().shiftDay(today, -1);
    (S().data().checkins || []).forEach(it => {
      const all = policies(it);
      all.filter(p => p.mode === 'miss').forEach(p => {
        let day = p.from, count = 0;
        while (day <= yesterday && (!p.until || day < p.until)) {
          if (++count > 5000) throw new Error('习惯结算日期异常，请检查备份');
          if (!it.archived || !it.memoArchivedDay || day < it.memoArchivedDay) callback(it, p, day);
          day = M().shiftDay(day, 1);
        }
      });
    });
  }
  function hasPending(now = Date.now()) {
    const records = settlements();
    let missing = false;
    eachClosed(now, (it,p,day) => {
      const n = Number(it.days?.[day]) || 0, needPenalty = n < p.target;
      const record = records.find(x => x.habitId === it.id && x.day === day && x.from === p.from);
      if (!record ? needPenalty : ((record.status === 'penalized') !== needPenalty)) missing = true;
    });
    return missing;
  }
  function settleCore(now = Date.now()) {
    const records = settlements(), ledger = S().data().ledger, at = new Date(now).toISOString();
    let count = 0;
    eachClosed(now, (it,p,day) => {
      const missed = (Number(it.days?.[day]) || 0) < p.target;
      let r = records.find(x => x.habitId === it.id && x.day === day && x.from === p.from);
      if (!r && !missed) return;
      if (!r) { r = { id:S().uid(), habitId:it.id, day, from:p.from, title:it.text,
        amount:p.amount, status:'refunded', entries:[] }; records.push(r); }
      if ((r.status === 'penalized') === missed) return;
      if (r.amount) {
        const points = missed ? -r.amount : r.amount;
        const entry = { id:S().uid(), operationId:'habit-miss:'+r.id+':'+r.entries.length,
          date:day, type: missed?'penalty-habit-miss':'refund-habit-miss',
          taskId:it.id, points, leisure:0, at,
          note:(missed?'习惯未达标扣分：':'补记达标退还扣分：')+r.title };
        ledger.push(entry); r.entries.push(entry.id);
      }
      r.status = missed ? 'penalized' : 'refunded';
      r.updatedAt = at;
      count++;
    });
    return count;
  }
  A.memoPenalty = { policy, configure, policies, hasPending, settleCore, settlements };
})();
