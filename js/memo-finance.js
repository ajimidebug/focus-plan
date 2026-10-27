/* Ledger projections and habit arrangements share original records. */
(function(){'use strict';const A=window.App,S=()=>A.store,M=()=>A.memoCore,E=x=>S().esc(String(x??''));
const category=e=>/^interest-/.test(e.type)?'利息':/^(earn-|reward-)/.test(e.type)?'收入':e.type==='redeem'?'消费':/refund/.test(e.type)?'退回':/penalty/.test(e.type)?'扣分':'调整';
function summary(day){const rows=S().data().ledger.filter(e=>e.date===day),tot={收入:0,消费:0,退回:0,扣分:0,利息:0,调整:0};rows.forEach(e=>tot[category(e)]+=Number(e.points)||0);const balance=S().data().ledger.filter(e=>e.date<=day).reduce((n,e)=>n+(Number(e.points)||0),0);return {any:!!rows.length,text:'【积分汇总】\n'+Object.entries(tot).map(([k,v])=>k+'：'+v+'分').join('\n')+'\n当日净变动：'+rows.reduce((n,e)=>n+(Number(e.points)||0),0)+'分\n'+(day===M().userDay()?'当前可用余额：'+S().pointsTotal():'按当前有效账本重算的该日结余：'+balance)+'分'};}
function note(entry){if(entry.memoPassage)return;const day=M().userDay(),at=entry.at||new Date().toISOString(),q=entry.itemSnapshot||{},text=M().clock(at)+'【积分'+(entry.type==='redeem'?'支出':'退回')+'】'+entry.note+'\n积分变动：'+entry.points+'分'+(q.amountCents!=null?'；金额：'+(q.amountCents/100).toFixed(2)+'元；比例：'+q.rate+'分/元':'')+'\n操作后余额：'+S().pointsTotal()+'分'+(q.note?'\n备注：'+q.note:'')+'\n',blocks=M().segments(M().read(day));blocks.push({id:S().uid(),text:(blocks.length?'\n':'')+text,financeId:entry.id});M().write(day,blocks.map(b=>b.text).join(''),at,blocks);entry.memoPassage=true;}
function rules(){return S().data().memoHabitPlans||[];}
function plans(day){return (S().data().checkins||[]).flatMap(it=>{const all=rules().filter(r=>r.habitId===it.id&&r.from<=day&&(!r.until||day<r.until)&&(r.mode==='daily'||r.from===day));const once=all.filter(r=>r.mode==='once').at(-1),r=once||all.filter(r=>r.mode==='daily').sort((a,b)=>a.from.localeCompare(b.from)).at(-1);return r&&(!it.archived||day<(it.memoArchivedDay||M().userDay())||Number(it.days?.[day])>0)?[{it,r,n:Number(it.days?.[day])||0}]:[];});}
function planned(day,list,completed=null){
 const goalDone=({it,r,n})=>A.memoPenalty?.policy(it,day).mode!=='punch'&&(r.target>0?n>=r.target:n>0);
 const folded=x=>goalDone(x)&&x.n>=S().habitRules(x.it).rewardLimit;
 return plans(day).filter(x=>!x.r.hidden&&x.r.list===list&&(completed===null||folded(x)===completed))
 .sort((a,b)=>Number(folded(a))-Number(folded(b)))
 .map(({it,r,n})=>{
   const mode=A.memoPenalty?.policy(it,day).mode||'reward',bad=mode==='punch';
   const done=!bad&&(r.target>0?n>=r.target:n>0);
   const remaining=Math.max(0,S().habitRules(it).rewardLimit-n);
   const quote=A.checkin?.memoPoints?.(it,day)??0;
   const label=bad?'发生 '+n+'次':n+'/'+r.target+'次'+(done?' ✓已达标':'')+
     (remaining?' · 可奖励 '+remaining+'次':' · 仅记录');
   return '<button type="button" class="habit-plan-row '+(folded({it,r,n})?'habit-plan-done':done?'habit-plan-goal-done':'')+
     '" data-habit-kind="'+mode+'" data-bounty="'+!!A.memoOrganize?.bounty(Number(it.points)||0)+
     '" data-category="'+list+'" data-habit-punch="'+E(it.id)+'" data-habit-day="'+day+
     '"><span>'+E(it.text)+' <small>'+(bad?'坏习惯':mode==='miss'?'漏打卡':'打卡')+
     '</small>'+(A.memoOrganize?.badge(Number(it.points)||0)||'')+
     '</span><span>'+label+' · '+(quote>0?'+':'')+quote+'分</span></button>';
 }).join('');
}
function panel(day){
 return '<details class="task-habit-panel" '+(localStorage.getItem('focusPlanHabitFold')==='1'?'':'open')+'><summary>积分打卡</summary><div class="task-habit-grid">'+
 (S().data().checkins||[]).filter(it=>!it.archived).map(it=>{
 const mode=A.memoPenalty?.policy(it,M().userDay()).mode||'reward',
   points=A.checkin.memoPoints(it,M().userDay());
 return '<article data-habit-kind="'+mode+'"><button class="habit-info" data-habit-info="'+E(it.id)+'">'+E(it.text)+' ›</button><small>今日 '+
 (Number(it.days?.[M().userDay()])||0)+' 次</small><button class="btn '+(mode==='punch'?'btn-danger':'btn-primary')+
 '" data-habit-punch="'+E(it.id)+'" data-habit-day="'+M().userDay()+'">'+(mode==='punch'?'记录':'打卡')+' '+(points>0?'+':'')+
 points+'分</button><button class="btn" data-habit-arrange="'+E(it.id)+'">安排到任务</button></article>';
 }).join('')+'</div></details>';
}
function arrange(id){const it=(S().data().checkins||[]).find(x=>x.id===id);if(!it)return;const today=M().userDay(),m=A.ui.openModal('安排打卡 · '+it.text,'<input type="hidden" id="hp-mode" value="once"><div class="habit-mode"><button class="btn" data-mode="once" aria-pressed="true">单日安排</button><button class="btn" data-mode="daily" aria-pressed="false">每日固定</button></div><label>日期／生效日期<input type="date" id="hp-day" value="'+today+'"></label><p>修改固定安排默认从下一用户日生效；今天可单独安排。</p><input type="hidden" id="hp-list" value="required"><div class="mw-assign-choices"><button class="btn" data-act="save" data-list="required">必做</button><button class="btn" data-act="save" data-list="ideal">理想</button><button class="btn" data-act="save" data-list="extra">长期</button></div><label>计划次数<input type="number" min="1" max="10000" id="hp-target" value="'+Math.max(1,S().habitRules(it).target)+'"></label><p>只改变安排，不改变奖励上限或整组奖励。</p><p role="alert"></p>','<button class="btn" data-act="cancel">取消</button><button class="btn" data-act="remove">取消所选日安排</button><button class="btn" data-act="stop">停止每日安排</button>',{lock:true});const q=x=>m.querySelector('#hp-'+x);m.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{q('mode').value=b.dataset.mode;m.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));q('mode').dispatchEvent(new Event('change'));});q('mode').onchange=()=>{};async function save(b,remove){if(A.memoActions.busy())return;if(b.dataset.list)q('list').value=b.dataset.list;b.disabled=true;try{await A.memoActions.commit(()=>{let day=q('day').value,mode=q('mode').value,target=Number(q('target').value);if(!M().validDate(day)||day<today||!Number.isInteger(target)||target<1||target>10000)throw Error('请选择今天或未来日期和有效次数');const d=S().data();d.memoHabitPlans=d.memoHabitPlans||[];if(mode==='daily'){// The latest fixed rule wins from its effective day; no conflict prompt.
  for(let i=rules().length-1;i>=0;i--){
    const old=rules()[i];if(old.habitId!==id)continue;
    if(old.mode==='daily'){
      if(old.from>=day){rules().splice(i,1);continue;}
      if(!old.until||old.until>day)old.until=day;
    }else if(old.mode==='once'&&old.from===day&&day===today){rules().splice(i,1);}
  }rules().filter(r=>r.habitId===id&&r.mode==='daily'&&r.from<day&&(!r.until||r.until>day)).forEach(r=>r.until=day);}else{for(let i=rules().length-1;i>=0;i--){
  if(rules()[i].habitId===id && rules()[i].mode==='once' && rules()[i].from===day)rules().splice(i,1);
 }}d.memoHabitPlans.push({id:S().uid(),habitId:id,mode,from:day,list:q('list').value,target,hidden:remove,at:new Date().toISOString()});});A.ui.closeModal();A.memoWorkspace.render();}catch(e){m.querySelector('[role="alert"]').textContent=e.message;}finally{b.disabled=false;}}A.ui.bindActions({cancel:()=>{if(!A.memoActions.busy())A.ui.closeModal();},save:b=>save(b,false),stop:b=>{q('mode').value='daily';q('day').value=M().shiftDay(today,1);save(b,true);},remove:b=>{q('mode').value='once';save(b,true);}});}
function exportDialog(){const today=M().userDay(),m=A.ui.openModal('导出积分记录','<label>从<input id="fe-from" type="date" value="'+M().shiftDay(today,-29)+'"></label><label>至<input id="fe-to" type="date" value="'+today+'"></label><p>当前有效账本；旧版已移除的流水无法完整恢复。金额和比例缺失时留空。</p><textarea id="fe-text" aria-label="积分导出预览"></textarea>','<button class="btn" data-act="all">全部日期</button><button class="btn" data-act="copy">复制文字</button><button class="btn" data-act="csv">下载CSV</button><button class="btn" data-act="close">关闭</button>');const q=id=>m.querySelector('#fe-'+id);function rows(){return S().data().ledger.filter(e=>(!q('from').value||e.date>=q('from').value)&&(!q('to').value||e.date<=q('to').value));}const values=e=>{const i=e.itemSnapshot||{};return[e.date,e.at,category(e),e.points,e.note,i.note,i.amountCents==null?'':i.amountCents/100,i.rate,e.id,e.taskId,e.refundOf||'',e.type==='redeem'&&S().data().ledger.some(r=>r.refundOf===e.id)?'已退款':'有效'];};const header=['用户日','记录时间','类型','积分变动','原因','备注','金额元','分每元','流水编号','项目编号','原支出编号','状态'];function update(){q('text').value=rows().map(e=>values(e).filter(v=>v!==undefined&&v!=='').join(' · ')).join('\n')+'\n撤销操作历史（不计余额）：\n'+(S().data().memoFinanceAudit||[]).filter(e=>(!q('from').value||e.day>=q('from').value)&&(!q('to').value||e.day<=q('to').value)).map(e=>e.at+' · '+e.title+' · 原积分 '+e.points+' · '+e.reason).join('\n');}q('from').onchange=q('to').onchange=update;update();A.ui.bindActions({all:()=>{q('from').value='';q('to').value='';update();},copy:async()=>{try{await navigator.clipboard.writeText(q('text').value);A.ui.toast('已复制');}catch{A.ui.toast('复制失败，可选择预览文本复制');}},csv:()=>{const cell=v=>'"'+(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')+'"',data=[header,...rows().map(values),...(S().data().memoFinanceAudit||[]).filter(e=>(!q('from').value||e.day>=q('from').value)&&(!q('to').value||e.day<=q('to').value)).map(e=>[e.day,e.at,'撤销历史',0,e.title+'；原积分 '+e.points,e.reason,'','',e.id,e.eventId,'','不计余额'])].map(r=>r.map(cell).join(',')).join('\r\n'),a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='积分账本-'+today+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},close:A.ui.closeModal});}
document.addEventListener('toggle',e=>{if(e.target.matches?.('.task-habit-panel'))try{localStorage.setItem('focusPlanHabitFold',e.target.open?'0':'1');}catch{}},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-habit-punch],[data-habit-info],[data-habit-arrange],[data-finance-export]');if(!b)return;e.stopImmediatePropagation();if(b.hasAttribute('data-finance-export'))return exportDialog();if(b.dataset.habitArrange)return arrange(b.dataset.habitArrange);if(b.dataset.habitInfo){const id=b.dataset.habitInfo,m=A.ui.openModal('打卡详情',A.checkin.detailHTML(id),'<button class="btn" data-act="habit-plan">安排到任务</button><button class="btn" data-act="close">关闭</button>');m.addEventListener('click',A.checkin.onClick);A.ui.bindActions({'habit-plan':()=>{A.ui.closeModal();arrange(id);},close:A.ui.closeModal});return;}if(b.dataset.habitPunch)return A.memoActions.checkin(b.dataset.habitPunch,b.dataset.habitDay);},true);
A.memoFinance={summary,note,plans:day=>plans(day).filter(x=>!x.r.hidden),planned:(day,list,completed=null)=>planned(day,list,completed),panel,arrange,exportDialog};
})();
