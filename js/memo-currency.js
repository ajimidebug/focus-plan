/* Prospective point rules; historical entries retain their exact amounts. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, esc = x => S().esc(String(x ?? ''));
  function rules() { return S().data().memoCurrency; }
  function fixedBonus(streak) { return streak >= 90 ? 5 : streak >= 60 ? 3 : streak >= 30 ? 2 : streak >= 7 ? 1 : 0; }
  function ruleLabel() { return rules()?.version === 3 ? '固定基础分' : rules()?.version === 2 ? '基础分＋固定连续奖励' : '旧连续倍率'; }
  function quote(it, day) {
    const r = rules(); if (!r || ![2, 3].includes(r.version)) return null;
    const h = S().habitRules(it), count = Math.max(0, Number(it.days?.[day]) || 0);
    const limit = r.version === 3 || h.optional ? h.rewardLimit : h.target + Math.max(0, Number(r.extraPaidCount) || 0);
    const base = count < limit ? Math.max(0, Number(it.points) || 0) : 0;
    const bonus = r.version === 2 && day === M().userDay() && !r.claims?.[day] ? fixedBonus(A.checkin.streakWithToday()) : 0;
    return { version: r.version, base, bonus, total: base + bonus, target: h.target, optional: h.optional, rewardLimit: limit, extraPaidCount: r.extraPaidCount || 0 };
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
    const r = rules(), e = estimate(), fixed = r?.version === 3, settings = S().settings();
    const sources = [['理想任务默认分', settings.idealPoints ?? 10], ['队列任务默认分', settings.queuePoints ?? 5], ['长期拓展默认分', settings.extPoints ?? 5], ['必做整组奖励', settings.baseRewardPoints ?? 0], ['全部任务完成奖励', settings.perfectRewardPoints ?? 0]];
    root.innerHTML = '<h2>积分规则与兑换试算</h2><p><strong>当前习惯规则：' + ruleLabel() + '</strong></p><p>' + (fixed ? '按每项基础分及每日奖励次数上限计分；没有倍率或连续加分。达到奖励上限仍可记录。' : r?.version === 2 ? '基础分及超额次数限制，另有每天一次固定连续奖励。' : '沿用旧连续倍率；升级程序不会自动替换你的配置。') + '</p><p>生效时间：' + esc(r?.enabledAt ? new Date(r.enabledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '原有规则') + '</p>' + (!fixed ? '<p>拟切换：固定基础分，关闭倍率和连续加分；从保存后下一次操作生效。已有积分与记录不重算，其他任务及整组奖励不改变。</p><button class="btn btn-primary" id="currency-fixed">切换为固定基础分</button>' : '') + (r?.version === 2 ? '<label>旧模式超额可奖励次数<input id="currency-extra" type="number" min="0" max="100" value="' + (r.extraPaidCount || 0) + '"></label><button class="btn" id="currency-save">保存旧模式设置</button>' : '') + '<details><summary>查看收入来源与兑换价格</summary><ul>' + sources.map(([label, value]) => '<li>' + label + '：' + esc(value) + ' 分</li>').join('') + '</ul><p class="hint">单项任务自定义分值优先；每日推进与习惯使用各自编辑框中的基础分。</p>' + (S().data().checkins || []).filter(it => !it.archived).map(it => '<p>' + esc(it.text) + '：每次 ' + esc(it.points ?? 0) + ' 分；固定模式每日最多奖励 ' + S().habitRules(it).rewardLimit + ' 次</p>').join('') + '<p>兑换价格：</p>' + (settings.redeemTable || []).map(it => '<p>' + esc(it.item) + '：' + esc(it.points) + ' 分</p>').join('') + '</details><p>近14个完整用户日，已知有记录 ' + e.coverage + ' 天；当前账本中保留的任务与打卡奖励共 ' + e.total + ' 分。</p><label>兑换目标<select id="currency-days"><option value="1">1个记录日</option><option value="3" selected>3个记录日</option><option value="7">7个记录日</option></select></label><p id="currency-estimate"></p><p class="hint">仅作历史试算，未知日期不当作0；未包含手工调整，也不代表新规则购买力。不自动修改兑换价格。递减启动奖励暂未提供。</p><p id="currency-error" role="alert"></p>';
    const update = () => { const n = Number(root.querySelector('#currency-days').value); root.querySelector('#currency-estimate').textContent = e.mean == null ? '暂无足够记录估算。' : '按上述记录日平均奖励试算：约 ' + Math.ceil(e.mean * n) + ' 分。'; }; root.querySelector('#currency-days').onchange = update; update();
    let retryPending = false;
    async function save(button, toFixed) {
      if (A.memoActions.busy() && !retryPending) { root.querySelector('#currency-error').textContent = '请先重试保存当前操作'; return; }
      button.disabled = true;
      try { if (await A.memoActions.commit(() => { if (toFixed) enableFixedCore(); else rules().extraPaidCount = Math.min(100, Math.max(0, Number(root.querySelector('#currency-extra').value) || 0)); })) { panel(); A.checkin.render(); } }
      catch (err) { retryPending = A.memoActions.busy(); root.querySelector('#currency-error').textContent = err.message; button.textContent = A.memoActions.busy() ? '重试保存' : '重新保存'; }
      finally { button.disabled = false; }
    }
    root.querySelector('#currency-fixed')?.addEventListener('click', e => save(e.currentTarget, true)); root.querySelector('#currency-save')?.addEventListener('click', e => save(e.currentTarget, false));
  }
  function enableFixedCore() {
    S().data().memoCurrency = { version: 3, enabledAt: new Date().toISOString(), mode: 'fixed' };
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
  A.memoCurrency = { ruleLabel, enableFixedCore, quote, claim, estimate, fixedBonus, redeemCore, enableCore, init, panel };
})();
