/* Prospective point rules; historical entries retain their exact amounts. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, esc = x => S().esc(String(x ?? ''));
  function rules() { return S().data().memoCurrency; }
  function fixedBonus(streak) { return streak >= 90 ? 5 : streak >= 60 ? 3 : streak >= 30 ? 2 : streak >= 7 ? 1 : 0; }
  function quote(it, day) {
    const r = rules(); if (!r || r.version !== 2) return null;
    const count = Number(it.days?.[day]) || 0, target = Math.max(1, Number(it.target) || 1), extra = Math.max(0, Number(r.extraPaidCount) || 0);
    const base = count < target + extra ? Math.max(0, Number(it.points) || 0) : 0;
    const bonus = day === M().userDay() && !r.claims?.[day] ? fixedBonus(A.checkin.streakWithToday()) : 0;
    return { version: 2, base, bonus, total: base + bonus, target, extraPaidCount: extra };
  }
  function claim(event, award) { event.award = award; if (award?.bonus) (rules().claims || (rules().claims = {}))[event.sourceDay] = event.id; }
  function estimate() {
    const today = M().userDay(), from = M().shiftDay(today, -14), d = S().data(), days = new Set();
    Object.keys(d.memoNotes || {}).filter(k => k >= from && k < today).forEach(k => days.add(k));
    Object.entries(d.days).filter(([k]) => k >= from && k < today).forEach(([k, v]) => { if (v.review?.text || Object.values(v.tasks || {}).some(a => a.length)) days.add(k); });
    const incomes = d.ledger.filter(e => e.date >= from && e.date < today && e.points > 0 && /^(earn-|reward-)/.test(e.type)); incomes.forEach(e => days.add(e.date));
    const total = incomes.reduce((n, e) => n + e.points, 0);
    const newDays = [...days].filter(day => rules()?.enabledAt && day >= M().shiftDay(M().userDay(rules().enabledAt), 1));
    return { coverage: days.size, total, mean: days.size ? total / days.size : null, newCoverage: newDays.length };
  }
  function panel() {
    let root = document.getElementById('memo-currency-panel'); if (!root) { root = document.createElement('div'); root.id = 'memo-currency-panel'; root.className = 'card'; document.getElementById('view-settings').prepend(root); }
    const r = rules(), e = estimate();
    root.innerHTML = '<h2>积分规则与兑换试算</h2><p>' + (r?.version === 2 ? '新规则已启用：目标内按基础分，超额默认不加分；连续7／30／60／90天每天一次固定加1／2／3／5分。旧账不重算；取消连续奖励后，当日奖励机会不重新发放。' : '当前沿用旧规则。可启用新规则，减少倍率和超额打卡增发。') + '</p>' + (!r || r.version !== 2 ? '<button class="btn btn-primary" id="currency-enable">启用新积分规则</button>' : '<label>达到每日目标后，额外可得分次数<input id="currency-extra" type="number" min="0" max="100" value="' + (r.extraPaidCount || 0) + '"></label><button class="btn" id="currency-save">保存规则</button>') + '<p>近14个完整用户日，已知有记录 ' + e.coverage + ' 天（未知日期不当成0）；有效任务奖励 ' + e.total + ' 分。' + (e.mean == null ? '记录不足。' : '历史日均约 ' + e.mean.toFixed(1) + ' 分。') + '</p><label>兑换目标<select id="currency-days"><option value="1">1个记录日</option><option value="3" selected>3个记录日</option><option value="7">7个记录日</option></select></label><p id="currency-estimate"></p><p class="hint">价格由你在兑换表修改。旧倍率可能抬高历史收入；新规则不足7个完整记录日时仅供试算，不自动调价。</p><p id="currency-error" role="alert"></p>';
    const update = () => { const n = Number(root.querySelector('#currency-days').value); root.querySelector('#currency-estimate').textContent = e.mean == null ? '暂无足够记录估算。' : '按历史收入试算：约 ' + Math.ceil(e.mean * n) + ' 分；不代表新规则下的稳定购买力。'; }; root.querySelector('#currency-days').onchange = update; update();
    async function save(enable) { try { if (await A.memoActions.commit(() => { if (enable) enableCore(); else rules().extraPaidCount = Math.min(100, Math.max(0, Number(root.querySelector('#currency-extra').value) || 0)); })) { panel(); A.checkin.render(); } } catch (err) { root.querySelector('#currency-error').textContent = err.message; } }
    root.querySelector('#currency-enable')?.addEventListener('click', () => save(true)); root.querySelector('#currency-save')?.addEventListener('click', () => save(false));
  }
  function redeemCore(item, price, operationId) {
    const d = S().data(); if (d.ledger.some(e => e.operationId === operationId)) return;
    const current = S().settings().redeemTable.find(x => x.item === item && Number(x.points) === price);
    if (!current || !Number.isFinite(price) || price <= 0) throw new Error('兑换项或价格已改变，请重新打开商店');
    if (S().pointsTotal() < price) throw new Error('当前积分不足，未兑换');
    d.ledger.push({ id: S().uid(), operationId, date: M().userDay(), type: 'redeem', points: -price, leisure: 0, note: '兑换：' + item, at: new Date().toISOString(), ruleVersion: rules()?.version || 1, itemSnapshot: { item, price } });
  }
  function enableCore() {
    const day = M().userDay(), hadPunch = (S().data().checkins || []).some(it => Number(it.days?.[day]) > 0);
    S().data().memoCurrency = { version: 2, enabledAt: new Date().toISOString(), extraPaidCount: 0, claims: hadPunch ? { [day]: 'legacy-punch-before-enabling' } : {} };
  }
  function init() {
    const old = A.settings.render; A.settings.render = function () { old(); panel(); }; panel();
  }
  A.memoCurrency = { quote, claim, estimate, fixedBonus, redeemCore, enableCore, init, panel };
})();
