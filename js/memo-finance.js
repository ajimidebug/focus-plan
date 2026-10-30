/* Ledger projections and habit arrangements share original records. */
(function(){'use strict';const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));
const category=e=>/^interest-/.test(e.type)?'利息':/^(earn-|reward-)/.test(e.type)?'收入':e.type==='redeem'?'消费':/refund/.test(e.type)?'退回':/penalty/.test(e.type)?'扣分':'调整';
function summary(day){const rows=S().data().ledger.filter(e=>e.date===day),tot={收入:0,消费:0,退回:0,扣分:0,利息:0,调整:0};rows.forEach(e=>tot[category(e)]+=Number(e.points)||0);const balance=S().data().ledger.filter(e=>e.date<=day).reduce((n,e)=>n+(Number(e.points)||0),0);return {any:!!rows.length,text:'【积分汇总】\n'+Object.entries(tot).map(([k,v])=>k+'：'+v+'分').join('\n')+'\n当日净变动：'+rows.reduce((n,e)=>n+(Number(e.points)||0),0)+'分\n'+(day===M().userDay()?'当前可用余额：'+S().pointsTotal():'按当前有效账本重算的该日结余：'+balance)+'分'};}
const round=n=>Math.round((n+Number.EPSILON)*1e8)/1e8;
const amount=n=>String(round(n));
function postingDay(e){if(typeof e.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(e.at))return null;const at=Date.parse(e.at);return Number.isFinite(at)?new Date(at+4*3600000).toISOString().slice(0,10):null;}
function flow(day){
 const rows=S().data().ledger.filter(e=>postingDay(e)===day),unknown=S().data().ledger.filter(e=>!postingDay(e));
 const income=round(rows.reduce((n,e)=>n+Math.max(0,Number(e.points)||0),0)),expense=round(rows.reduce((n,e)=>n+Math.max(0,-(Number(e.points)||0)),0));
 return {day,rows,income,expense,net:round(income-expense),unknown:unknown.length};
}
// A read-only view: preserve posting-time balances while netting related corrections
// within their posting user-day. Cross-day reversals remain explicit adjustments.
function effectiveProjection(){
 const d=S().data(),ledger=d.ledger,byId=new Map(),inferred=new Map(),meta=new Map(),days=new Map();
 const correction=e=>!!e.refundOf||/^(reverse-|refund-|undo-)/.test(e.type||'')||/^(forgive:|restore-delete:|undo-event:|economic-reverse:|legacy-undo:)/.test(e.operationId||'');
 const nodes=ledger.map((entry,index)=>({entry,index,day:postingDay(entry),points:Number(entry.points)||0,parent:null,issues:[],group:index}));
 const daily=day=>{if(!days.has(day))days.set(day,{day,rows:[],income:0,expense:0,crossDay:0,otherAdjustment:0,net:0,consumption:0,penalties:0,otherExpense:0,canceledGroups:0,unverified:0});return days.get(day);};
 nodes.forEach(n=>{
  const id=n.entry.id;if(typeof id==='string'&&id){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(n);}
  if(n.day){const f=daily(n.day);f.rows.push(n.entry);f.net=round(f.net+n.points);}
 });
 const infer=(id,target)=>{if(!id||!target)return;if(!inferred.has(id))inferred.set(id,new Set());inferred.get(id).add(target);};
 // Older missed-habit settlements have an exact ordered list of ledger IDs.
 (d.memoHabitPenalties||[]).forEach(r=>(r.entries||[]).forEach((id,i,ids)=>{
  if(!i)return;const found=byId.get(id),previous=byId.get(ids[i-1]);
  if(found?.length===1&&previous?.length===1&&found[0].entry.taskId===r.habitId&&previous[0].entry.taskId===r.habitId&&
   found[0].entry.date===r.day&&previous[0].entry.date===r.day&&
   /^(penalty|refund)-habit-miss$/.test(found[0].entry.type)&&/^(penalty|refund)-habit-miss$/.test(previous[0].entry.type))infer(id,ids[i-1]);
 }));
 // Old overdue corrections name the exact settlement whose ID is the debit ID.
 const settlementIds=new Set((d.memoFlow?.settlements||[]).map(r=>r.id));
 nodes.forEach(n=>{const op=typeof n.entry.operationId==='string'?n.entry.operationId:'';if(n.entry.type==='refund-penalty'&&op.startsWith('forgive:')&&settlementIds.has(op.slice(8)))infer(n.entry.id,op.slice(8));});
 const find=n=>{let root=n;while(nodes[root.group]!==root)root=nodes[root.group];while(n!==root){const next=nodes[n.group];n.group=root.index;n=next;}return root;};
 const union=(a,b)=>{const x=find(a),y=find(b);if(x!==y)y.group=x.index;};
 nodes.forEach(n=>{
  const targets=inferred.get(n.entry.id),explicit=n.entry.refundOf;
  if(byId.get(n.entry.id)?.length>1)n.issues.push('流水编号重复');
  if(explicit&&targets&&(!targets.has(explicit)||targets.size!==1))n.issues.push('撤销关联冲突');
  const target=explicit||(targets?.size===1?[...targets][0]:null);
  if(!explicit&&targets?.size>1)n.issues.push('撤销关联不唯一');
  if(target){
   const candidates=byId.get(target);
   if(candidates?.length!==1)n.issues.push('原流水缺失或编号不唯一');
   else {n.parent=candidates[0];union(n,n.parent);
    if(n===n.parent)n.issues.push('流水关联自身');
    if(n.points&&n.parent.points&&(Math.sign(n.points)===Math.sign(n.parent.points)||Math.abs(n.points)>Math.abs(n.parent.points)+1e-8))n.issues.push('抵消方向或金额异常');
    if(n.day&&n.parent.day&&Date.parse(n.entry.at)<Date.parse(n.parent.entry.at))n.issues.push('撤销早于原流水');
   }
  }else if(correction(n.entry))n.issues.push('缺少可核验的原流水关联');
 });
 const groups=new Map();nodes.forEach(n=>{const key=find(n).index;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);});
 groups.forEach(group=>{
  const roots=group.filter(n=>!n.parent),root=roots.length===1?roots[0]:null;
  let issue=group.flatMap(n=>n.issues)[0]||(!root?'关联链没有唯一原流水':group.some(n=>!n.day)?'关联流水缺少可靠入账时间':'');
  const groupedDays=new Map();group.forEach(n=>{if(!n.day){meta.set(n.entry,{status:'unknown',label:'入账时间缺失，不归入每日统计'});return;}if(!groupedDays.has(n.day))groupedDays.set(n.day,[]);groupedDays.get(n.day).push(n);});
  let running=0;
  [...groupedDays.keys()].sort().forEach(day=>{
   const current=groupedDays.get(day),f=daily(day),delta=round(current.reduce((sum,n)=>sum+n.points,0));
   running=round(running+delta);
   if(!issue&&root&&(running*root.points<0||Math.abs(running)>Math.abs(root.points)+1e-8))issue='累计抵消超过原次金额';
   if(issue){
    f.otherAdjustment=round(f.otherAdjustment+delta);f.unverified+=current.length;
    current.forEach(n=>meta.set(n.entry,{status:'unverified',label:'关联待核验：'+issue+'；计入其他调整'}));return;
   }
   if(/^adjust(?:-|$)/.test(root.entry.type||'')){
    f.otherAdjustment=round(f.otherAdjustment+delta);current.forEach(n=>meta.set(n.entry,{status:'adjustment',label:'积分调整，单独列示'}));return;
   }
   if(day!==root.day){
    f.crossDay=round(f.crossDay+delta);current.forEach(n=>meta.set(n.entry,{status:'cross-day',label:'跨日调整，不计入今日收入／支出'}));return;
   }
   if(delta>=0)f.income=round(f.income+delta);
   else {
    f.expense=round(f.expense-delta);
    const kind=root.entry.type==='redeem'?'consumption':/penalty/.test(root.entry.type||'')?'penalties':'otherExpense';
    f[kind]=round(f[kind]-delta);
   }
   if(group.length>1&&delta===0)f.canceledGroups++;
   current.forEach(n=>{
    const label=delta===0&&group.length>1?'已全额抵消，不计入有效收支':n!==root?'撤销／恢复记录，已合并统计':Math.abs(delta)<Math.abs(root.points)?'已部分抵消，剩余有效 '+amount(delta)+'分':'有效';
    meta.set(n.entry,{status:delta===0&&group.length>1?'canceled':n!==root?'merged':Math.abs(delta)<Math.abs(root.points)?'partial':'effective',label,effectivePoints:n===root?delta:0});
   });
  });
 });
 return {days,meta,links:new Map(nodes.filter(n=>n.parent).map(n=>[n.entry,n.parent.entry])),unknown:nodes.filter(n=>!n.day).length};
}
function effectiveFlow(day,projection=effectiveProjection()){
 return {...(projection.days.get(day)||{day,rows:[],income:0,expense:0,crossDay:0,otherAdjustment:0,net:0,consumption:0,penalties:0,otherExpense:0,canceledGroups:0,unverified:0}),unknown:projection.unknown};
}
function ledgerText(e){return (e.at||'入账时间缺失')+' · '+(Number(e.points)>0?'+':'')+amount(Number(e.points)||0)+'分 · '+(e.note||e.type||'积分调整')+'〔流水 '+(e.id||'旧记录无编号')+(e.date?'；行为日 '+e.date:'')+(e.effectiveAt?'；经济生效 '+e.effectiveAt:'')+'〕';}
function postingSummary(day){const f=flow(day);return {...f,any:!!f.rows.length,text:'【积分收支 · 实际入账用户日 '+day+'】\n原始流水统计（含撤销）：收入：+'+amount(f.income)+'分；支出：−'+amount(f.expense)+'分；净变动：'+(f.net>0?'+':'')+amount(f.net)+'分\n'+(f.rows.length?f.rows.map(ledgerText).join('\n'):'本用户日无入账流水')+(f.unknown?'\n另有 '+f.unknown+' 条旧流水缺少可靠入账时间，未归入本日。':'')};}
function refreshToday(){const b=document.getElementById('stat-points-today');if(!b)return;const f=effectiveFlow(M().userDay());b.textContent='今日 +'+amount(f.income)+' / −'+amount(f.expense);b.setAttribute('aria-label','今日有效收入 '+amount(f.income)+'分，有效支出 '+amount(f.expense)+'分，查看积分明细与调整');b.onclick=()=>todayDialog();}
function sizeHeader(){const stat=document.getElementById('stat-bar'),header=document.querySelector('.header-top');if(!stat||!header)return;header.style.setProperty('--points-header-height',getComputedStyle(stat).position==='absolute'?Math.ceil(stat.offsetTop+stat.offsetHeight+6)+'px':'0px');}
if(typeof ResizeObserver!=='undefined'){const stat=document.getElementById('stat-bar');if(stat)new ResizeObserver(sizeHeader).observe(stat);window.addEventListener('resize',sizeHeader);}
let shownDay;
function dayTick(){const day=M().userDay();if(day!==shownDay){shownDay=day;refreshToday();}}
function todayDialog(){return A.memoCurrency.shop();}
function accountHTML(scope='today'){
 const projection=effectiveProjection(),f=effectiveFlow(M().userDay(),projection),all=scope==='all',d=S().data();
 const rows=(all?d.ledger:f.rows).slice().sort((a,b)=>{
  const ta=postingDay(a)?Date.parse(a.at):-Infinity,tb=postingDay(b)?Date.parse(b.at):-Infinity;
  return ta===tb?0:ta>tb?-1:1;
 });
 const refunded=new Set(d.ledger.filter(e=>e.refundOf).map(e=>e.refundOf)),byId=new Map(d.ledger.map(e=>[e.id,e]));
 return '<section class="points-account-summary"><p>可用积分：<strong>'+amount(S().pointsTotal())+'</strong>分</p><h4>今日有效收支 · '+f.day+'</h4><p>有效收入 +'+amount(f.income)+' / 有效支出 −'+amount(f.expense)+' / 今日净变动 '+(f.net>0?'+':'')+amount(f.net)+'分</p><p class="hint">有效支出组成：消费 −'+amount(f.consumption)+' / 扣分 −'+amount(f.penalties)+' / 其他支出 −'+amount(f.otherExpense)+'分</p>'+
 (f.crossDay?'<p>跨日调整：'+(f.crossDay>0?'+':'')+amount(f.crossDay)+'分</p>':'')+(f.otherAdjustment?'<p>其他调整：'+(f.otherAdjustment>0?'+':'')+amount(f.otherAdjustment)+'分</p>':'')+
 (f.canceledGroups?'<p class="hint">当日已全额抵消 '+f.canceledGroups+'组，原始记录保留。</p>':'')+(f.unverified?'<p class="hint">'+f.unverified+'条关联待核验记录，其余额影响单列其他调整。</p>':'')+
 '<p class="hint">北京时间04:00分日，按实际入账时间统计。当天原操作与撤销合并计算；跨日撤销单列调整。净变动＝有效收入－有效支出＋调整。</p></section>'+
 '<div class="points-ledger-scope" role="group" aria-label="积分流水范围"><button class="btn" data-act="today" aria-pressed="'+!all+'">今日全部流水</button><button class="btn" data-act="all" aria-pressed="'+all+'">全部历史流水</button></div><h4>'+(all?'全部历史流水':'今日全部流水')+' · '+rows.length+'条</h4><div class="points-day-rows">'+rows.map(e=>{
  const q=e.itemSnapshot||{},relatedId=e.refundOf||projection.links.get(e)?.id,refund=byId.get(relatedId),status=projection.meta.get(e),canRefund=e.type==='redeem'&&!refunded.has(e.id)&&!!e.id&&status?.status!=='unverified';
  return '<p data-ledger-id="'+E(e.id||'')+'" data-ledger-status="'+E(status?.status||'unknown')+'">'+E(ledgerText(e))+
   (status?'<br><small class="points-entry-status">'+E(status.label)+'</small>':'')+
   (q.amountCents!=null?'<br>金额：'+E((q.amountCents/100).toFixed(2))+'元；比例：'+E(q.rate)+'分/元':'')+
   (q.note?'<br>备注：'+E(q.note):'')+
   (e.type==='redeem'&&refunded.has(e.id)?'<br><small>有退回记录，退款另列</small>':'')+
   (relatedId?'<br><small>对应原流水：'+E(relatedId)+(refund?' · '+E(refund.note||refund.type):'')+'</small>':'')+
   (canRefund?' <button class="btn btn-small" data-act="refund" data-id="'+E(e.id)+'">撤销支出</button>':'')+'</p>';
 }).join('')+'</div>'+(!rows.length?'<p>'+(all?'暂无积分流水。':'今日暂无积分流水。')+'</p>':'')+
 (f.unknown?'<p class="hint">'+f.unknown+'条旧流水缺少可靠入账时间，仍保留在总积分及完整账本中，可在全部历史流水查看。</p>':'');
}
function deferredTarget(task,ref,day){
 if(!['task','queue'].includes(ref.kind))return false;
 // The first dated assignment is the original plan, not the creation day or
 // an undated queue entry. Same-day category changes never imply deferral.
 const origin=M().validDate(task.originalDay)?task.originalDay:ref.kind==='queue'?(task.assignmentHistory||[]).concat(task.assignment?[task.assignment]:[]).find(x=>M().validDate(x.day))?.day:null;
 if(origin&&M().validDate(task.backfillDay))return task.backfillDay>origin;
 return !!A.memoFlow?.isCarried(task)||!!(origin&&origin<day);
}
function column(day,list){
 const tasks=A.memoSchedule.columnItems(day,list).map(x=>({id:A.memoSchedule.key(x.ref),title:x.task.text,done:x.done,target:true,kind:x.ref.kind,deferred:deferredTarget(x.task,x.ref,day),backfillDay:x.task.backfillDay||'',originalDay:x.task.originalDay||''}));
 (A.memoFlow?.deferred?.(day,list)||[]).forEach(x=>tasks.push({id:'deferred:'+x.ref.kind+':'+day+':'+x.ref.id,title:x.task.text,done:false,target:!x.closed,kind:x.ref.kind,deferredTo:x.toDay,deferredClosed:x.closed,deferred:true,backfillDay:'',originalDay:x.task.originalDay||''}));
 const habits=plans(day).filter(x=>!x.r.hidden&&x.r.list===list).map(x=>{const mode=A.memoPenalty?.policy(x.it,day).mode||'reward';return {id:'habit:'+x.it.id,title:x.it.text,kind:'checkin',mode,count:x.n,goal:x.r.target,target:mode!=='punch'&&x.r.target>0,done:mode!=='punch'&&x.r.target>0&&x.n>=x.r.target};});
 const items=tasks.concat(habits),targets=items.filter(x=>x.target),done=targets.filter(x=>x.done).length,total=targets.length,supervision=habits.filter(x=>x.mode==='punch').length;
 const deferred=targets.filter(x=>!x.done&&x.deferred).length,lateDone=targets.filter(x=>x.done&&x.deferred).length;
 const segments=[{state:'late-done',label:'延期完成',count:lateDone},{state:'done',label:'当日完成',count:done-lateDone},{state:'pending',label:'普通未完成',count:total-done-deferred},{state:'deferred',label:'延期未完成',count:deferred}].map(x=>({...x,percent:total?x.count/total*100:0}));
 return {items,done,total,supervision,deferred,lateDone,segments,deferredPercent:total?deferred/total*100:0,percent:total?Math.min(100,done/total*100):0,label:total?done+'/'+total:items.length?'无完成目标':'暂无任务'};
}
function note(entry){if(entry.memoPassage)return;const day=M().userDay(),at=entry.at||new Date().toISOString(),q=entry.itemSnapshot||{},text=M().clock(at)+'【积分'+(entry.type==='redeem'?'支出':'退回')+'】'+entry.note+'\n积分变动：'+entry.points+'分'+(q.amountCents!=null?'；金额：'+(q.amountCents/100).toFixed(2)+'元；比例：'+q.rate+'分/元':'')+'\n操作后余额：'+S().pointsTotal()+'分'+(q.note?'\n备注：'+q.note:'')+'\n',blocks=M().segments(M().read(day));blocks.push({id:S().uid(),text:(blocks.length?'\n':'')+text,financeId:entry.id});M().write(day,blocks.map(b=>b.text).join(''),at,blocks);entry.memoPassage=true;}
function rules(){return S().data().memoHabitPlans||[];}
function plans(day){return (S().data().checkins||[]).flatMap(it=>{const all=rules().filter(r=>r.habitId===it.id&&r.from<=day&&(!r.until||day<r.until)&&(r.mode==='daily'||r.from===day));const once=all.filter(r=>r.mode==='once').at(-1),r=once||all.filter(r=>r.mode==='daily').sort((a,b)=>a.from.localeCompare(b.from)).at(-1);return r&&(!it.archived||day<(it.memoArchivedDay||M().userDay())||Number(it.days?.[day])>0)?[{it,r,n:Number(it.days?.[day])||0}]:[];});}
function planned(day,list,completed=null){
 if(completed===true)return '';
 return plans(day).filter(x=>!x.r.hidden&&x.r.list===list)
 .map(({it,r,n})=>{
   const mode=A.memoPenalty?.policy(it,day).mode||'reward',bad=mode==='punch';
   const done=!bad&&(r.target>0?n>=r.target:n>0);
   const remaining=Math.max(0,S().habitRules(it).rewardLimit-n);
   const quote=A.checkin?.memoPoints?.(it,day)??0;
   const label=bad?'发生 '+n+'次':n+'/'+r.target+'次'+(done?' ✓已达标':'')+
     (remaining?' · 可奖励 '+remaining+'次':' · 仅记录');
   return '<button type="button" class="habit-plan-row '+(done?'habit-plan-goal-done':'')+
     '" data-habit-kind="'+mode+'" data-bounty="'+!!A.memoOrganize?.bounty(Number(it.points)||0)+
     '" data-category="'+list+'" data-habit-punch="'+E(it.id)+'" data-habit-day="'+day+
     '"><span class="habit-plan-title">'+E(it.text)+' <small>'+(bad?'坏习惯':mode==='miss'?'漏打卡':'打卡')+
     '</small>'+(A.memoOrganize?.badge(Number(it.points)||0)||'')+
     '</span><span class="habit-plan-meta"><small>'+label+'</small><strong>'+(quote>0?'+':'')+quote+'分</strong></span></button>';
 }).join('');
}
function panel(day){
 const arranged=new Set(plans(day).filter(x=>!x.r.hidden).map(x=>x.it.id));
 const remaining=(S().data().checkins||[]).filter(it=>!it.archived&&!arranged.has(it.id));
 if(!remaining.length)return '';
 return '<details class="task-habit-panel" '+(localStorage.getItem('focusPlanHabitFold')==='1'?'':'open')+'><summary>未安排的积分习惯（'+remaining.length+'）</summary><div class="task-habit-grid">'+
 remaining.map(it=>{
 const habitDay=M().userDay();
 const mode=A.memoPenalty?.policy(it,habitDay).mode||'reward', n=Number(it.days?.[habitDay])||0, target=S().habitRules(it).target,done=mode!=='punch'&&target>0&&n>=target,
   points=A.checkin.memoPoints(it,habitDay);
 return '<article class="'+(done?'habit-plan-goal-done':'')+'" data-habit-kind="'+mode+'"><button class="habit-info" data-habit-info="'+E(it.id)+'">'+E(it.text)+' ›</button><small>'+ '今日'+' '+
 n+' 次'+(done?' · 已达标':'')+'</small><button class="btn '+(mode==='punch'?'btn-danger':'btn-primary')+
 '" data-habit-punch="'+E(it.id)+'" data-habit-day="'+habitDay+'">'+(mode==='punch'?'记录':'打卡')+' '+(points>0?'+':'')+
 points+'分</button><button class="btn" data-habit-arrange="'+E(it.id)+'">安排到任务</button></article>';
 }).join('')+'</div></details>';
}
function arrange(id){const it=(S().data().checkins||[]).find(x=>x.id===id);if(!it)return;const today=M().userDay(),m=A.ui.openModal('安排打卡 · '+it.text,'<input type="hidden" id="hp-mode" value="once"><div class="habit-mode"><button class="btn" data-mode="once" aria-pressed="true">单日安排</button><button class="btn" data-mode="daily" aria-pressed="false">每日固定</button></div><label>日期／生效日期<input type="date" id="hp-day" value="'+today+'"></label><p>每日固定安排从所选日期起覆盖旧规则；单日安排只覆盖指定日期。</p><input type="hidden" id="hp-list" value="required"><div class="mw-assign-choices"><button class="btn" data-act="save" data-list="required">必做</button><button class="btn" data-act="save" data-list="ideal">理想</button><button class="btn" data-act="save" data-list="extra">长期拓展</button></div><label>计划次数<input type="number" min="1" max="10000" id="hp-target" value="'+Math.max(1,S().habitRules(it).target)+'"></label><p>只改变安排，不改变奖励上限或整组奖励。</p><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn" data-act="remove">取消所选日安排</button><button class="btn" data-act="stop">停止每日安排</button>',{lock:true});const q=x=>m.querySelector('#hp-'+x);A.ui.dateContext(m,{getDay:()=>q('day').value,label:'安排／生效日期',choiceSelector:'[data-act=save]'});m.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{q('mode').value=b.dataset.mode;m.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));q('mode').dispatchEvent(new Event('change'));});q('mode').onchange=()=>{};async function save(b,remove){if(A.memoActions.busy())return;if(b.dataset.list)q('list').value=b.dataset.list;b.disabled=true;try{await A.memoActions.commit(()=>{let day=q('day').value,mode=q('mode').value,target=Number(q('target').value);if(!M().validDate(day)||day<today||!Number.isInteger(target)||target<1||target>10000)throw Error('请选择今天或未来日期和有效次数');const d=S().data();d.memoHabitPlans=d.memoHabitPlans||[];if(mode==='daily'){// The latest fixed rule wins from its effective day; no conflict prompt.
  for(let i=rules().length-1;i>=0;i--){
    const old=rules()[i];if(old.habitId!==id)continue;
    if(old.mode==='daily'){
      if(old.from>=day){rules().splice(i,1);continue;}
      if(!old.until||old.until>day)old.until=day;
    }else if(old.mode==='once'&&old.from===day&&day===today){rules().splice(i,1);}
  }rules().filter(r=>r.habitId===id&&r.mode==='daily'&&r.from<day&&(!r.until||r.until>day)).forEach(r=>r.until=day);}else{for(let i=rules().length-1;i>=0;i--){
  if(rules()[i].habitId===id && rules()[i].mode==='once' && rules()[i].from===day)rules().splice(i,1);
 }}d.memoHabitPlans.push({id:S().uid(),habitId:id,mode,from:day,list:q('list').value,target,hidden:remove,at:new Date().toISOString()});});A.ui.closeModal();A.memoWorkspace.render();}catch(e){m.querySelector('[role="alert"]').textContent=e.message;}finally{b.disabled=false;}}A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:b=>save(b,false),stop:b=>{q('mode').value='daily';q('day').value=M().shiftDay(today,1);save(b,true);},remove:b=>{q('mode').value='once';save(b,true);}});}
function auditPayload(){
 const d=S().data(),bank=A.memoEconomy?.state();
 return {
   schema:'focus-plan-points-audit/v1',exportedAt:new Date().toISOString(),
   balances:{points:S().pointsTotal(),ledgerSum:d.ledger.reduce((n,e)=>n+(Number(e.points)||0),0)},
   economy:bank?JSON.parse(JSON.stringify(bank)):null,
   currency:d.memoCurrency||null,
   checkins:(d.checkins||[]).map(it=>({
     id:it.id,text:it.text,points:it.points,target:it.target,rewardLimit:it.rewardLimit,
     days:it.days||{},archived:!!it.archived,memoArchivedDay:it.memoArchivedDay||null,
     memoPenaltyPolicies:it.memoPenaltyPolicies||[],memoPenaltyStops:it.memoPenaltyStops||[]
   })),
   habitPlans:d.memoHabitPlans||[],habitPenalties:d.memoHabitPenalties||[],
   ledger:d.ledger.map(e=>({
     id:e.id,operationId:e.operationId||null,taskId:e.taskId||null,
     eventId:e.eventId||null,sourceDay:e.sourceDay||null,
     date:e.date,at:e.at||null,effectiveAt:e.effectiveAt||null,
     type:e.type,points:e.points,leisure:e.leisure||0,
     ruleVersion:e.ruleVersion||null,refundOf:e.refundOf||null,
     note:e.note||'',itemSnapshot:e.itemSnapshot||null
   })),
   audit:d.memoFinanceAudit||[],
   redemptionRules:S().settings().redeemTable||[]
 };
}
function downloadAudit(){
 const a=document.createElement('a'),
   url=URL.createObjectURL(new Blob([JSON.stringify(auditPayload(),null,2)],{type:'application/json;charset=utf-8'}));
 a.href=url;a.download='积分审计-'+M().userDay()+'.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportDialog(){const today=M().userDay(),m=A.ui.openModal('导出积分记录','<label>从<input id="fe-from" type="date" value="'+M().shiftDay(today,-29)+'"></label><label>至<input id="fe-to" type="date" value="'+today+'"></label><p>当前有效账本；旧版已移除的流水无法完整恢复。金额和比例缺失时留空。</p><textarea id="fe-text" aria-label="积分导出预览"></textarea>','<button class="btn" data-act="all">全部日期</button><button class="btn" data-act="copy">复制文字</button><button class="btn" data-act="csv">下载CSV</button><button class="btn" data-act="close">关闭</button>');const q=id=>m.querySelector('#fe-'+id);function rows(){return S().data().ledger.filter(e=>(!q('from').value||e.date>=q('from').value)&&(!q('to').value||e.date<=q('to').value));}const values=e=>{const i=e.itemSnapshot||{};return[e.date,e.at,category(e),e.points,e.note,i.note,i.amountCents==null?'':i.amountCents/100,i.rate,e.id,e.taskId,e.refundOf||'',e.type==='redeem'&&S().data().ledger.some(r=>r.refundOf===e.id)?'已退款':'有效',e.operationId||'',e.effectiveAt||'',e.sourceDay||'',e.eventId||'',e.ruleVersion??'',e.type||''];};const header=['用户日','记录时间','类型','积分变动','原因','备注','金额元','分每元','流水编号','项目编号','原支出编号','状态','操作编号','经济生效时间','原行为用户日','打卡事件编号','计分规则版本','原始流水类型'];function update(){q('text').value=rows().map(e=>values(e).filter(v=>v!==undefined&&v!=='').join(' · ')).join('\n')+'\n撤销操作历史（不计余额）：\n'+(S().data().memoFinanceAudit||[]).filter(e=>(!q('from').value||e.day>=q('from').value)&&(!q('to').value||e.day<=q('to').value)).map(e=>e.at+' · '+e.title+' · 原积分 '+e.points+' · '+e.reason).join('\n');}q('from').onchange=q('to').onchange=update;update();A.ui.bindActions({all:()=>{q('from').value='';q('to').value='';update();},copy:async()=>{try{await navigator.clipboard.writeText(q('text').value);A.ui.toast('已复制');}catch{A.ui.toast('复制失败，可选择预览文本复制');}},csv:()=>{const cell=v=>'"'+(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')+'"',data=[header,...rows().map(values),...(S().data().memoFinanceAudit||[]).filter(e=>(!q('from').value||e.day>=q('from').value)&&(!q('to').value||e.day<=q('to').value)).map(e=>[e.day,e.at,'撤销历史',0,e.title+'；原积分 '+e.points,e.reason,'','',e.id,e.eventId,'','不计余额','','','','','',''])].map(r=>r.map(cell).join(',')).join('\r\n'),a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='积分账本-'+today+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},close:A.ui.closeModal});}
document.addEventListener('toggle',e=>{if(e.target.matches?.('.task-habit-panel'))try{localStorage.setItem('focusPlanHabitFold',e.target.open?'0':'1');}catch{}},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-habit-punch],[data-habit-info],[data-habit-arrange],[data-finance-export],[data-finance-audit-export]');if(!b)return;e.stopImmediatePropagation();if(b.hasAttribute('data-finance-audit-export'))return downloadAudit();if(b.hasAttribute('data-finance-export'))return exportDialog();if(b.dataset.habitArrange)return arrange(b.dataset.habitArrange);if(b.dataset.habitInfo){const id=b.dataset.habitInfo,m=A.ui.openModal('打卡详情',A.checkin.detailHTML(id),'<button class="btn" data-act="habit-plan">安排到任务</button><button class="btn" data-act="close">关闭</button>');m.addEventListener('click',A.checkin.onClick);A.ui.bindActions({'habit-plan':()=>{A.ui.closeModal();arrange(id);},close:A.ui.closeModal});return;}if(b.dataset.habitPunch)return A.memoActions.checkin(b.dataset.habitPunch,b.dataset.habitDay);},true);
A.memoFinance={summary,postingDay,flow,effectiveProjection,effectiveFlow,ledgerText,postingSummary,refreshToday,dayTick,todayDialog,accountHTML,column,note,plans:day=>plans(day).filter(x=>!x.r.hidden),planned:(day,list,completed=null)=>planned(day,list,completed),panel,arrange,exportDialog,auditPayload,downloadAudit};
})();
