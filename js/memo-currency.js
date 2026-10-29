/* Prospective point rules; historical entries retain their exact amounts. */
(function () {
  'use strict';
  const A = window.App, S = () => A.store, M = () => A.memoCore, esc = x => S().esc(String(x ?? ''));
  function rules() { return S().data().memoCurrency; }
  function fixedBonus(streak) { return streak >= 90 ? 5 : streak >= 60 ? 3 : streak >= 30 ? 2 : streak >= 7 ? 1 : 0; }
  function ruleLabel() { if(A.memoEconomy?.state())return '独立习惯连胜：50% → 75% → 100%'; return rules()?.version === 3 ? '固定基础分' : rules()?.version === 2 ? '基础分＋固定连续奖励' : '旧连续倍率'; }
  function quote(it, day) {
    const fresh=A.memoEconomy?.quote(it,day); if(fresh)return fresh;
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
    const r = rules(), e = estimate(), economy = !!A.memoEconomy?.state(), fixed = economy || r?.version === 3, settings = S().settings();
    const sources = [['理想任务默认分', settings.idealPoints ?? 10], ['队列任务默认分', settings.queuePoints ?? 5], ['长期拓展默认分', settings.extPoints ?? 5], ['必做整组奖励', settings.baseRewardPoints ?? 0], ['全部任务完成奖励', settings.perfectRewardPoints ?? 0]];
    root.innerHTML = '<h2>积分规则与兑换试算</h2><p><strong>当前习惯规则：' + ruleLabel() + '</strong></p><p>' + (economy ? '新习惯规则：独立连续达标第1–2天50%、第3–6天75%、第7天起100%；按每日奖励次数上限逐次计分。旧积分不重新定价。' : fixed ? '按每项基础分及每日奖励次数上限计分；没有倍率或连续加分。达到奖励上限仍可记录。' : r?.version === 2 ? '基础分及超额次数限制，另有每天一次固定连续奖励。' : '沿用旧连续倍率；升级程序不会自动替换你的配置。') + '</p><p>生效时间：' + esc(r?.enabledAt ? new Date(r.enabledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '原有规则') + '</p>' + (!fixed ? '<p>拟切换：固定基础分，关闭倍率和连续加分；从保存后下一次操作生效。已有积分与记录不重算，其他任务及整组奖励不改变。</p><button class="btn btn-primary" id="currency-fixed">切换为固定基础分</button>' : '') + (!economy && r?.version === 2 ? '<label>旧模式超额可奖励次数<input id="currency-extra" type="number" min="0" max="100" value="' + (r.extraPaidCount || 0) + '"></label><button class="btn" id="currency-save">保存旧模式设置</button>' : '') + '<details><summary>查看收入来源与兑换价格</summary><ul>' + sources.map(([label, value]) => '<li>' + label + '：' + esc(value) + ' 分</li>').join('') + '</ul><p class="hint">单项任务自定义分值优先；每日推进与习惯使用各自编辑框中的基础分。</p>' + (S().data().checkins || []).filter(it => !it.archived).map(it => '<p>' + esc(it.text) + '：每次 ' + esc(it.points ?? 0) + ' 分；固定模式每日最多奖励 ' + S().habitRules(it).rewardLimit + ' 次</p>').join('') + '<p>兑换价格：</p>' + (settings.redeemTable || []).map(it => '<p>' + esc(it.item) + '：' + esc(it.points) + ' 分</p>').join('') + '</details><p>近14个完整用户日，已知有记录 ' + e.coverage + ' 天；当前账本中保留的任务与打卡奖励共 ' + e.total + ' 分。</p><label>兑换目标<select id="currency-days"><option value="1">1个记录日</option><option value="3" selected>3个记录日</option><option value="7">7个记录日</option></select></label><p id="currency-estimate"></p><p class="hint">仅作历史试算，未知日期不当作0；未包含手工调整，也不代表新规则购买力。不自动修改兑换价格。新习惯连胜奖励从规则启用后的下一用户日开始计算。</p><p id="currency-error" role="alert"></p>';
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
  function redeemCore(item, price, operationId, purpose = '') {
    const d = S().data(); if (d.ledger.some(e => e.operationId === operationId)) return;
    const current = S().settings().redeemTable.find(x => x.item === item && Number(x.points) === price);
    if (!current || !Number.isFinite(price) || price <= 0) throw new Error('兑换项或价格已改变，请重新打开商店');
    if (S().pointsTotal() < price) throw new Error('积分不足，奖励兑换暂不允许透支；实际支出可另行记录');

    d.ledger.push({ id: S().uid(), operationId, date: M().userDay(), type: 'redeem', points: -price, leisure: 0, note: '兑换：' + item, at: new Date().toISOString(), ruleVersion: rules()?.version || 1, itemSnapshot: { item, price, note:purpose } });A.memoFinance?.note(d.ledger.at(-1));
  }
  function enableCore() {
    const day = M().userDay(), hadPunch = (S().data().checkins || []).some(it => Number(it.days?.[day]) > 0);
    S().data().memoCurrency = { version: 2, enabledAt: new Date().toISOString(), extraPaidCount: 0, claims: hadPunch ? { [day]: 'legacy-punch-before-enabling' } : {} };
  }

  function spendQuote(mode, value, purpose) {
    if(!['money','points'].includes(mode))throw new Error('请选择支出方式');
    const rate = A.memoFlow.state().rate;
    if (!String(purpose || '').trim()) throw new Error('请填写支出用途');
    if (!/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) <= 0 || Number(value)>1000000) throw new Error('请输入大于0、不超过100万的数值（最多两位小数）');
    const cents = Math.round(Number(value)*100), points = mode === 'money' ? Math.round(cents*Math.round(rate*100)/100)/100 : Number(value);
    if(!Number.isSafeInteger(Math.round(points*100)) || points<=0)throw new Error('积分应大于0，最多两位小数');
    return { purpose:String(purpose).trim(), points, mode, amountCents:mode==='money'?cents:null, rate:mode==='money'?rate:null };
  }
  function spendCore(quote, operationId) {
    const d=S().data(); if(d.ledger.some(e=>e.operationId===operationId))return;
    if(!quote || !String(quote.purpose || '').trim() || !Number.isFinite(quote.points) || !Number.isSafeInteger(Math.round(quote.points*100)) || quote.points<=0 || quote.points>10000000000)throw new Error('支出内容无效');
    if(quote.mode==='money' && (quote.rate!==A.memoFlow.state().rate || quote.points!==Math.round(quote.amountCents*Math.round(quote.rate*100)/100)/100))throw new Error('换算比例已改变，请重新填写');

    d.ledger.push({id:S().uid(),operationId,date:M().userDay(),type:'redeem',points:-quote.points,leisure:0,at:new Date().toISOString(),note:'自定义支出：'+quote.purpose,itemSnapshot:cloneQuote(quote)});A.memoFinance?.note(d.ledger.at(-1));
  }
  function cloneQuote(q){return JSON.parse(JSON.stringify(q));}
  function refundCore(id) {
    const d=S().data(), e=d.ledger.find(e=>e.id===id && e.type==='redeem'); if(!e)throw new Error('找不到原支出');
    if(d.ledger.some(x=>x.operationId==='refund:'+id))return;
    if(e.wishSnapshot){const a=d.memoWishes||(d.memoWishes=[]),i=a.findIndex(w=>w.id===e.wishId),w=JSON.parse(JSON.stringify(e.wishSnapshot));if(i<0)a.push(w);else a[i]=w;}
    d.ledger.push({id:S().uid(),operationId:'refund:'+id,date:M().userDay(),type:'refund-redeem',points:-e.points,leisure:0,at:new Date().toISOString(),note:'撤销支出：'+e.note,refundOf:id});A.memoFinance?.note(d.ledger.at(-1));
  }
  function modalCommit(m, fn, success) {
    return async b=>{b.disabled=true;try{if(await A.memoActions.commit(fn)){A.ui.closeModal();A.app.refreshStats();if(success)success();}}catch(e){m.querySelector('[role="alert"]').textContent=e.message;if(A.memoActions.busy()){b.textContent='重试保存';m.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);}}finally{b.disabled=false;}};
  }
  function customSpend() {
    if(A.memoActions.busy())return A.ui.toast('请先重试保存当前操作');
    const rate=A.memoFlow.state().rate, operationId=S().uid();
    const m=A.ui.openModal('自定义支出','<label>用途<input id="spend-purpose" maxlength="500" placeholder="例如：购买小说"></label><label>方式<select id="spend-mode"><option value="money">按金额换算</option><option value="points">直接扣积分</option></select></label><label>金额／积分<input id="spend-value" type="number" min="0.01" step="0.01"></label><label>备注（选填）<textarea id="spend-note"></textarea></label><p id="spend-preview">当前 '+rate+' 分＝1元；确认后记账</p><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">确认支出</button>',{lock:true});
    const q=id=>m.querySelector('#spend-'+id);
    const update=()=>{try{const quote=spendQuote(q('mode').value,q('value').value,q('purpose').value);q('preview').textContent='本次扣除 '+quote.points+' 分'+(quote.mode==='money'?'（'+(quote.amountCents/100).toFixed(2)+'元；'+rate+'分＝1元，积分保留两位小数）':'')+'；操作后余额 '+A.memoMoney.fmt(S().pointsTotal()-quote.points)+' 分（负数为欠债）';}catch(e){q('preview').textContent=e.message;}};
    ['mode','value','purpose'].forEach(id=>q(id).oninput=update);
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:modalCommit(m,()=>{const quote=spendQuote(q('mode').value,q('value').value,q('purpose').value);quote.note=q('note').value;spendCore(quote,operationId);},shop)});
    q('purpose').focus();
  }
  function shop(scope = 'today') {
    if(!S().data().memoFlow)return A.ui.toast('请先重试保存跨日流程初始化');
    if(A.memoActions.busy())return A.ui.toast('请先重试保存当前操作');
    const table=S().settings().redeemTable || [],back=()=>shop(scope);
    const m=A.ui.openModal('积分明细与兑换','<div class="points-account-actions"><button class="btn btn-primary" data-act="custom">＋ 自定义支出</button><button class="btn" data-act="preset-list">固定兑换</button></div>'+A.memoFinance.accountHTML(scope)+'<details id="points-presets"><summary>固定兑换</summary>'+table.filter(t=>t.points>0).map((t,i)=>'<p>'+esc(t.item)+' · '+t.points+'分 <button class="btn" data-act="preset" data-index="'+i+'">兑换</button></p>').join('')+'</details><p role="alert"></p>','<button class="btn" data-act="cancel">关闭</button>',{lock:true});
    m.classList.add('points-account-modal');
    const items=table.filter(t=>t.points>0);
    A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},today:()=>shop('today'),all:()=>shop('all'),'preset-list':()=>{const presets=m.querySelector('#points-presets');presets.open=true;presets.scrollIntoView({block:'nearest'});presets.querySelector('summary').focus();},custom:customSpend,preset:b=>{const t=items[Number(b.dataset.index)],id=S().uid();const confirm=A.ui.openModal('确认兑换','<p>用 '+t.points+' 分兑换“'+esc(t.item)+'”；操作后余额 '+A.memoMoney.fmt(S().pointsTotal()-t.points)+' 分（负数为欠债）</p><label>用途／备注<input id="redeem-purpose" value="'+esc(t.item)+'"></label><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">兑换</button>',{lock:true});A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())back();},save:modalCommit(confirm,()=>redeemCore(t.item,Number(t.points),id,confirm.querySelector('#redeem-purpose')?.value||t.item),back)});},refund:b=>{const id=b.dataset.id;const confirm=A.ui.openModal('撤销支出','<p>将按原次实际扣分退回，保留原支出及撤销流水。</p><p role="alert"></p>','<button class="btn" data-act="cancel">保留</button><button class="btn btn-primary" data-act="save">确认撤销</button>',{lock:true});A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())back();},save:modalCommit(confirm,()=>refundCore(id),back)});}});
  }
  function flowPanel() {
    let root=document.getElementById('flow-settings');if(!root){root=document.createElement('section');root.id='flow-settings';root.className='card';document.getElementById('view-settings').prepend(root);}
    const f=S().data().memoFlow || {penalty:2,dailyCap:10,rate:2};
    root.innerHTML='<h2>支出与必做顺延</h2><label>悬赏积分阈值（含）<input id="flow-bounty" type="number" min="0.01" step="0.01" value="'+Number(S().settings().memoBountyThreshold??30)+'"></label><label>每1元扣除积分<input id="flow-rate" type="number" min="0.01" max="10000" step="0.01" value="'+f.rate+'"></label><label>必做首次逾期扣分<input id="flow-penalty" type="number" min="0" max="10000" step="1" value="'+f.penalty+'"></label><label>每个到期日扣分上限<input id="flow-cap" type="number" min="0" max="100000" step="1" value="'+f.dailyCap+'"></label><p class="hint">从启用日开始；一次性必做顺延，同一任务首次逾期扣一次，0表示只顺延。每日习惯与每日推进不累积欠账。网页关闭时，下次打开补处理。旧设置中的自动结算、拓展严格模式不适用于当前流程。理想任务与全部完成额外奖励不代表全勤。</p><button class="btn btn-primary" id="flow-save">保存规则</button><p role="alert"></p>';
    root.querySelector('#flow-save').onclick=async b=>{const button=b.currentTarget;button.disabled=true;try{if(await A.memoActions.commit(()=>{const threshold=Number(root.querySelector('#flow-bounty').value);if(!Number.isFinite(threshold)||threshold<=0||threshold>1000000)throw Error('请填写有效悬赏阈值');S().settings().memoBountyThreshold=threshold;const rate=Number(root.querySelector('#flow-rate').value),penalty=Number(root.querySelector('#flow-penalty').value),cap=Number(root.querySelector('#flow-cap').value);if(!Number.isFinite(rate)||rate<0.01||rate>10000||!Number.isInteger(penalty)||penalty<0||penalty>10000||!Number.isInteger(cap)||cap<0||cap>100000)throw new Error('请填写有效规则');Object.assign(A.memoFlow.enableCore(),{rate:Math.round(rate*100)/100,penalty,dailyCap:cap});})){root.querySelector('[role="alert"]').textContent='已保存；之后的操作生效';root.querySelectorAll('input').forEach(el=>el.disabled=false);button.textContent='保存规则';}}catch(e){root.querySelector('[role="alert"]').textContent=e.message;button.textContent=A.memoActions.busy()?'重试保存':'保存规则';if(A.memoActions.busy())root.querySelectorAll('input').forEach(el=>el.disabled=true);}finally{button.disabled=false;}};
  }

  function init() {
    const old = A.settings.render; A.settings.render = function () { old(); panel(); flowPanel(); }; panel(); flowPanel();
    const button=document.createElement('button');button.className='btn btn-primary';button.id='flow-shop';button.textContent='积分明细与兑换';button.onclick=()=>shop();(document.getElementById('point-summary')||document.getElementById('view-checkin')).append(button);
  }
  A.memoCurrency = { ruleLabel, enableFixedCore, quote, claim, estimate, fixedBonus, redeemCore, enableCore, init, panel, spendQuote, spendCore, refundCore, shop, customSpend, flowPanel };
})();
