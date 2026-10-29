/* Copy-only task summaries. No report is inserted in handwritten notes. */
(function(){'use strict';const A=window.App,S=()=>A.store,M=()=>A.memoCore;
function legacyReport(day,legacyGoals=false,finance=true){const d=S().data(),lines=['===== 用户日 '+day+' · 任务汇总 =====','以下为当前保存记录，不是完整操作日志；复制不代表已发送或归档。'];let any=false;
for(const [list,name] of [['required','必做'],['ideal','理想'],['extra','长期拓展']]){const rows=[];
(d.days[day]?.tasks[list]||[]).filter(t=>!t.fromQueue&&!t.fromDaily&&!t.memoProjectId).forEach(t=>rows.push({t,done:!!t.done,status:t.memoMovedTo?'已重新安排':t.memoDismissed?'不再安排':t.done?'已完成':'未完成'}));
A.memoFlow.queues().forEach(t=>{if(t.assignment?.day===day&&t.assignment.list===list&&!t.memoDismissed)rows.push({t,done:!!t.doneAt,status:t.doneAt?'已完成':'未完成'});(t.assignmentHistory||[]).filter(h=>h.day===day&&h.list===list).forEach(()=>rows.push({t,done:false,status:'已重新安排'}));});
(d.memoProjects||[]).filter(p=>(p.memoCategoryDays?.[day]||'extra')===list&&(p.createdDay?p.createdDay<=day:!!p.days?.[day]||day===M().userDay())&&(!p.archived||p.days?.[day])).forEach(t=>rows.push({t,done:!!t.days?.[day],status:t.days?.[day]?'本日推进已完成':'本日推进未完成'}));
if(finance&&A.memoFinance)A.memoFinance.plans(day).filter(x=>x.r.list===list && x.r.target>0).forEach(x=>rows.push({t:{id:'habit:'+x.it.id,text:x.it.text+'（打卡 '+x.n+'/'+x.r.target+'次）'},done:x.n>=x.r.target,status:x.n>=x.r.target?'打卡达标':'打卡未达标'}));
const active=rows.filter(x=>!['已重新安排','不再安排'].includes(x.status));lines.push('【'+name+'】'+(rows.length?'完成 '+active.filter(x=>x.done).length+'/'+active.length:'无任务记录'));if(rows.length)any=true;
const seen=new Set();rows.forEach(({t,done,status})=>{const key=t.id+status;if(seen.has(key))return;seen.add(key);const rr=A.memoReview?.round(t.memoReviewRoundId);lines.push((done?'✓ ':'○ ')+t.text+(rr?'（第'+rr.n+'轮，原定 '+M().naturalDay(rr.due)+' '+M().clock(rr.due)+'）':'')+'〔'+status+(t.backfillDay?'；补记实际完成日 '+t.backfillDay:'')+(t.originalDay?'；原安排 '+t.originalDay:'')+'〕');});}
if(finance&&A.memoFinance){const f=A.memoFinance.summary(day);lines.push(f.text);if(f.any)any=true;const p=A.memoFinance.plans(day);if(p.length)lines.push('【打卡安排】',...p.map(x=>x.it.text+'：'+x.n+'/'+x.r.target+'次 · '+({required:'必做',ideal:'理想',extra:'长期'}[x.r.list])));}
const habits=(d.checkins||[]).filter(t=>t.days?.[day]);if(habits.length){any=true;lines.push('【习惯打卡】');habits.forEach(t=>lines.push(t.text+'：'+t.days[day]+'次'));}
const goals=A.memoGoals?.at(day)||[];if(goals.length){any=true;lines.push('【截止目标】');goals.forEach(g=>lines.push(legacyGoals?g.name+'：'+g.current+'/'+g.total+g.unit+'；截止 '+g.due:g.name+'；截止 '+g.due));}return {text:lines.join('\n'),any};}
function days(){const d=S().data(),keys=new Set([...Object.keys(d.days),...Object.keys(d.memoNotes||{}),...d.ledger.map(e=>e.date),...(d.memoHabitPlans||[]).map(p=>p.from)]);A.memoFlow.queues().forEach(t=>{if(t.assignment?.day)keys.add(t.assignment.day);(t.assignmentHistory||[]).forEach(h=>{if(h.day)keys.add(h.day);});});(d.memoGoals||[]).forEach(g=>(g.history||[]).forEach(h=>keys.add(h.day)));return [...keys].filter(M().validDate).sort();}
// Facts and ledger checkpoints deliberately exclude derived closing balances and presentation.
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>JSON.stringify(x);
function column(day,list){
 if(A.memoFinance?.column)return A.memoFinance.column(day,list);
 const items=A.memoSchedule.columnItems(day,list).map(x=>({id:A.memoSchedule.key(x.ref),title:x.task.text,done:x.done,target:true,kind:x.ref.kind,backfillDay:x.task.backfillDay||'',originalDay:x.task.originalDay||''}));
 return {items,done:items.filter(x=>x.done).length,total:items.length,label:items.length?items.filter(x=>x.done).length+'/'+items.length:'暂无任务'};
}
function reviewFacts(day){return (S().data().memoReview?.rounds||[]).filter(r=>M().userDay(r.due)===day||r.at&&M().userDay(r.at)===day).map(r=>({id:r.id,n:r.n,title:A.memoReview?.series(r.seriesId)?.text||'',due:r.due,status:r.status,result:r.result,at:r.at||null})).sort((a,b)=>a.id.localeCompare(b.id));}
function facts(day){return {columns:['required','ideal','extra'].map(k=>({list:k,items:column(day,k).items.slice().sort((a,b)=>a.id.localeCompare(b.id))})),habits:(S().data().checkins||[]).filter(t=>t.days?.[day]).map(t=>({id:t.id,title:t.text,count:t.days[day]})).sort((a,b)=>a.id.localeCompare(b.id)),goals:(A.memoGoals?.at(day)||[]).map(g=>({id:g.id,name:g.name,due:g.due})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};}
function report(day,legacyGoals=false,finance=true){
 if(legacyGoals)return legacyReport(day,true,finance);
 const lines=['===== 用户日 '+day+' · 任务汇总 =====','以下为当前保存记录；执行时段按片段编号及起止区间去重，复制不代表已发送或归档。'];let any=false;
 for(const [list,name] of [['required','必做'],['ideal','理想'],['extra','长期拓展']]){
  const c=column(day,list);lines.push('【'+name+'】'+(c.total?'完成 '+c.label:c.label));
  if(c.items.length)any=true;
  c.items.forEach(x=>lines.push((x.done?'✓ ':'○ ')+x.title+'〔'+(x.deferredTo?(x.deferredClosed?'已补记至':'未完成；已延期至')+x.deferredTo:x.kind==='checkin'?(x.mode==='punch'?'监督记录 '+x.count+'次':x.count+'/'+x.goal+'次 · '+(x.target?(x.done?'打卡达标':'打卡未达标'):'选做，无完成目标')):x.done?'已完成':'未完成')+(x.backfillDay?'；补记实际完成日 '+x.backfillDay:'')+(x.originalDay?'；原安排 '+x.originalDay:'')+'〕'));
 }
 const review=reviewFacts(day);if(review.length){any=true;lines.push('【间隔复习 · 轮次说明，不另计时长】',...review.map(r=>r.title+' · 第'+r.n+'轮 · 原定 '+M().naturalDay(r.due)+' '+M().clock(r.due)+' · '+({pending:'待复习',done:'已完成',cancelled:'已取消'}[r.status])+(r.at?' · 实际 '+M().naturalDay(r.at)+' '+M().clock(r.at):'')+(r.result?' · '+({no:'未掌握',partial:'部分掌握',yes:'已掌握'}[r.result]):'')));}
 if(finance&&A.memoFinance){const f=A.memoFinance.postingSummary(day);lines.push(f.text);if(f.any)any=true;}
 const snapshot=facts(day);if(snapshot.habits.length){any=true;lines.push('【习惯打卡】',...snapshot.habits.map(t=>t.title+'：'+t.count+'次'));}
 if(snapshot.goals.length){any=true;lines.push('【截止目标】',...snapshot.goals.map(g=>g.name+'；截止 '+g.due));}
 return {text:lines.join('\n'),any};
}
function stripFinance(text){return String(text).replace(/【积分汇总】[\s\S]*?(?=【打卡安排】|【习惯打卡】|【截止目标】|$)/,'');}
function ledgerSnapshot(e){return {id:e.id,at:e.at||null,date:e.date||null,type:e.type||'',points:Number(e.points)||0,note:e.note||'',effectiveAt:e.effectiveAt||null,refundOf:e.refundOf||null,itemSnapshot:e.itemSnapshot||null};}
function ledgerDay(e){return A.memoFinance?.postingDay(e)||e.date;}
const emptyExecution=()=>({segments:[],actualMs:0});
function executionText(day,x,now,revision=false){
 const clock=at=>M().naturalDay(at)+' '+new Date(at+8*3600000).toISOString().slice(11,19);
 const span=ms=>Math.floor(ms/60000)+'分'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'秒';
 const lines=['===== 用户日 '+day+' · '+(revision?'执行明细修订（替换此前该日执行明细）':'执行明细')+' =====',
  '北京时间04:00分日；快照截至 '+clock(now)+'。同编号及重合区间不重复累计；运行中片段以后续快照替换。'];
 const groups=new Map();
 x.segments.forEach(c=>{if(!groups.has(c.taskKey))groups.set(c.taskKey,[]);groups.get(c.taskKey).push(c);});
 groups.forEach(cs=>{
  lines.push(cs[0].title+'〔'+(cs.some(c=>c.ongoing)?'进行中':cs[0].status)+'〕');
  cs.forEach((c,i)=>lines.push((i+1)+'. '+clock(c.start)+' — '+clock(c.end)+'｜'+span(c.end-c.start)+'〔片段 '+c.id+'〕'+
   (c.ongoing?'〔进行中；结束点为复制时刻〕':'')+(c.clipped?'〔按用户日截取；原始起点 '+clock(c.rawStart)+(c.rawEnd!==null?'，终点 '+clock(c.rawEnd):'')+'〕':'')+(c.overlap?'〔与其他片段重合，合计已去重〕':'')));
  lines.push('该任务当日有效合计：'+span(A.memoSchedule.unionMs(cs)));
 });
 if(!x.segments.length)lines.push('本用户日无可列出的有效计时片段；旧快照另列，不推测缺失起止点。');
 lines.push('本用户日有效合计（跨任务重合已去重）：'+span(x.actualMs));
 return lines.join('\n');
}
function attach(q){
 const now=Date.parse(q.at),executions=A.memoSchedule.executionIndex(now,q.day);
 const f=A.memoFlow.state(),same=f.factCarry?.day===M().userDay()&&f.factCarry.selected===q.day;
 const base=clone(same?f.factCarry.base:f.reportFacts||{version:1,days:{},ledger:{}}),current={version:1,days:{...base.days},ledger:{...base.ledger}};
 // First use seeds unknown historical copy state, without dumping all old timers.
 const tracked=base.execution!==undefined;
 if(!tracked)base.execution=clone(executions);
 current.execution={...base.execution};
 const prior=f.reportCarry?.day===M().userDay()&&f.reportCarry.selected===q.day?f.reportCarry.base:(f.reportCopies||{});
 const reportSnapshots={},reportBase=clone(prior),lines=[report(q.day,false,false).text,executionText(q.day,executions[q.day]||emptyExecution(),now)];
 if(A.memoFinance)lines.push(A.memoFinance.postingSummary(q.day).text);
 for(const day of [...new Set([...Object.keys(base.execution),...Object.keys(executions),q.day])].filter(k=>M().validDate(k)&&k<=q.day).sort()){
  const next=executions[day]||emptyExecution(),old=base.execution[day]||emptyExecution();
  current.execution[day]=next;
  if(tracked&&day!==q.day&&stable(old)!==stable(next))lines.push(executionText(day,next,now,true));
 }
 const dates=new Set([...days(),...['daily','memoProjects','checkins'].flatMap(k=>(S().data()[k]||[]).flatMap(t=>Object.keys(t.days||{}))),q.day,...Object.keys(f.reportFacts?.days||{}),...Object.keys(f.reportCopies||{})]);
 for(const day of [...dates].filter(k=>M().validDate(k)&&k<=q.day).sort()){
  const fact=facts(day);current.days[day]=fact;reportSnapshots[day]=report(day).text;
  if(day===q.day)continue;
  let changed;
  if(base.days[day]!==undefined)changed=stable(base.days[day])!==stable(fact);
  else if(f.reportFacts||same)changed=report(day,false,false).any;
  else {
   const old=prior[day];
   changed=old!==undefined?![legacyReport(day).text,legacyReport(day,true).text,legacyReport(day,false,false).text,legacyReport(day,true,false).text,report(day).text].some(t=>stripFinance(t)===stripFinance(old)):!!f.reportCopies&&report(day,false,false).any;
   // Preserve the actual old baseline through repeated copies on this user day.
   if(old===undefined)reportBase[day]=changed?'':reportSnapshots[day];
  }
  if(changed)lines.push(report(day,false,false).text.replace('· 任务汇总','· 任务汇总修订（替换此前汇总）'));
  if(!f.reportFacts&&!same)base.days[day]=changed?{legacyPending:day}:clone(fact);
 }
 const ledger=Object.fromEntries(Object.values(base.ledger).filter(e=>ledgerDay(e)>q.day).map(e=>[e.id,e]));
 S().data().ledger.filter(e=>typeof e.id==='string'&&e.id&&(ledgerDay(e)<=q.day||base.ledger[e.id]&&ledgerDay(base.ledger[e.id])<=q.day)).forEach(e=>ledger[e.id]=ledgerSnapshot(e));
 if(!f.reportFacts&&!same)base.ledger=clone(ledger);
 current.ledger=ledger;
 const financial=[];
 if(f.reportFacts||same){
  for(const id of new Set([...Object.keys(base.ledger),...Object.keys(ledger)])){
   const old=base.ledger[id],next=ledger[id];if(stable(old)===stable(next))continue;
   if(next&&ledgerDay(next)===q.day&&!old)continue; // Already listed in the selected day's flow.
   const describe=e=>A.memoFinance?A.memoFinance.ledgerText(e):stable(e);
   financial.push(!old?'新增：'+describe(next):!next?'撤回已移除流水：'+describe(old):'修订前：'+describe(old)+'\n修订后：'+describe(next));
  }
 }
 if(financial.length)lines.push('【积分流水补记／修订 · 仅以下受影响记录】\n'+financial.join('\n'));
 const supplements=(S().data().memoEvents||[]).filter(e=>e.active&&e.kind!=='cancellation'&&(e.sourceDay===q.day||e.noteDay===q.day||q.snapshots[e.noteDay])&&e.timing?.executionText&&!q.text.includes(e.timing.executionText));
 if(supplements.length)lines.push('【已保存执行快照 · 历史引用；与上述执行明细同编号或区间不重复累计】\n'+supplements.map(e=>e.title+'〔完成记录 '+e.id+'〕\n'+e.timing.executionText).join('\n'));
 return Object.assign(q,{text:lines.join('\n\n')+'\n\n'+q.text,reportSnapshots,reportBase,factSnapshot:current,factBase:base});
}
function mark(q){
 if(!q.reportSnapshots)return;const f=A.memoFlow.state();
 f.reportCopies=Object.assign({},f.reportCopies,q.reportSnapshots);f.reportCarry={day:M().userDay(),selected:q.day,base:q.reportBase};
 if(q.factSnapshot){f.reportFacts=clone(q.factSnapshot);f.factCarry={day:M().userDay(),selected:q.day,base:clone(q.factBase)};}
}
A.memoReport={report,legacyReport,facts,executionText,attach,mark};})();
