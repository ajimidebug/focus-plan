'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./helpers/harness.cjs');
for(const kind of ['task','queue'])test('planned next-day '+kind+' stays fresh and settles once after due day',async()=>{
 const b=H.browser();await b.S.load();const {F,P}=H.flowHarness(b,'2026-11-13'),d=b.S.data();
 const ref=kind==='task'?{kind,id:'cross',day:'2026-11-13',list:'required'}:{kind,id:'cross'};
 const task={id:'cross',text:'跨日必做',done:false};
 if(kind==='task')b.S.getDay(ref.day).tasks.required.push(task);else{task.assignment={day:'2026-11-13',list:'required'};d.queue.push(task);}
 P.savePlan({ref,day:'2026-11-13',type:'span',start:Date.parse('2026-11-13T23:00+08:00'),end:Date.parse('2026-11-14T08:00+08:00')});
 F.settleCore(Date.parse('2026-11-14T09:00+08:00'));
 const f=P.resolve(ref);assert.equal(f.ref.day||f.task.assignment.day,'2026-11-14');assert.equal(F.isCarried(f.task),false);assert.equal(F.lateLabel(f.task),'');assert.equal(d.memoFlow.settlements.length,0);
 F.settleCore(Date.parse('2026-11-15T04:00+08:00'));F.settleCore(Date.parse('2026-11-16T09:00+08:00'));
 assert.equal(d.memoFlow.settlements.length,1);assert.equal(d.memoFlow.settlements[0].dueDay,'2026-11-14');assert.equal(d.ledger.filter(x=>x.type==='penalty-required').length,1);
});
test('cancel preserves latest handwritten edits, input snapshots and exported cancellation state',async()=>{
 const b=H.browser();await b.S.load();const {A,M,E}=H.actionHarness(b);b.S.data().queue=[{id:'q',text:'数学',points:5}];M.write('2026-10-19','前文');
 const e=A.completeCore({kind:'queue',id:'q',title:'数学',remark:'备注A',noteInput:{version:1,mode:'custom',body:'说明B'}},'说明B',H.actionAt);
 let blocks=M.segments(M.read(e.noteDay)),pos=E.textOf(blocks).indexOf('说明B')+3;blocks=E.splice(blocks,pos,pos,'段内C');blocks.push({id:'tail',text:'后文'});M.write(e.noteDay,E.textOf(blocks),H.actionAt,blocks);const before=M.read(e.noteDay).text;
 const kept=before.replace(/本次实际获得积分：5分\n?/,'');
 A.undoCore(e.id,'',H.actionAt);assert.equal(M.read(e.noteDay).text,kept);assert(!M.exportBlocks(M.segments(M.read(e.noteDay))).includes('数学 · 已撤销完成'));assert.match(A.passage(e),/说明B段内C/);assert(before.includes('备注A'));assert(before.includes('段内C'));assert.equal(b.S.pointsTotal(),0);await b.S.save();const c=H.browser({shared:b});await c.S.load();assert.equal(H.memoHarness(c).read(e.noteDay).text,kept);
});
for(const [end,expected] of [['02:00','2026-11-13'],['04:00','2026-11-14'],['08:00','2026-11-14']])test('04:00 day boundary '+end,async()=>{
 const b=H.browser();await b.S.load();const {F,P}=H.flowHarness(b,'2026-11-13');const ref={kind:'task',id:'t',day:'2026-11-13',list:'required'};b.S.getDay(ref.day).tasks.required.push({id:'t',text:'边界'});
 const plan=P.savePlan({ref,day:ref.day,type:'span',start:Date.parse('2026-11-13T23:00+08:00'),end:Date.parse('2026-11-14T'+end+'+08:00')});assert.equal(F.scheduledDueDay(ref,ref.day),expected);plan.deleted=true;assert.equal(F.scheduledDueDay(ref,ref.day),ref.day);
});
test('required overdue items precede higher-priority fresh items, and deletion still removes only its previewed event',async()=>{
 const b=H.browser();await b.S.load();const {F,A,M}=H.flowHarness(b),day=M.userDay();
 const fs=require('node:fs'),vm=require('node:vm');vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/memo-workspace.js'),'utf8'),b.ctx);
 b.S.getDay(day).tasks.required=[{id:'fresh',text:'普通',priority:5},{id:'late',text:'延期',carried:true,priority:1}];
 assert.equal(b.ctx.App.memoWorkspace.taskItems(day,'required')[0].task.id,'late');
 b.S.data().queue=[{id:'q',text:'删除',points:1}];const event=A.completeCore({kind:'queue',id:'q',title:'删除'},'活动文段',H.actionAt);A.deleteCore({kind:'queue',id:'q'},'',H.actionAt);assert.equal(A.passage(event),'');
});
test('legacy rolled required tasks render above fresh high-priority tasks',async()=>{
 const b=H.browser();await b.S.load();const {F,M}=H.flowHarness(b),day=M.userDay();
 const fs=require('node:fs'),vm=require('node:vm');vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/memo-workspace.js'),'utf8'),b.ctx);
 b.S.getDay(day).tasks.required=[{id:'fresh-high',text:'普通高优先级',priorityWeight:5},{id:'legacy-low',text:'旧版延期低优先级',rolled:true,priorityWeight:1},{id:'fresh-planned',text:'跨日普通',memoPlannedDueDay:day,originalDay:day,priorityWeight:4},{id:'legacy-done',text:'延期已完成',rolled:true,done:true}];
 H.financeHarness(b);
 const W=b.ctx.App.memoWorkspace;
 assert.deepEqual(Array.from(W.taskItems(day,'required'),x=>x.task.id),['legacy-low','fresh-high','fresh-planned','legacy-done']);
 const html=W.overviewHTML(day);assert(html.indexOf('旧版延期低优先级')<html.indexOf('普通高优先级'));assert.equal(F.isCarried({rolled:true}),true);assert.equal(F.isCarried({rolled:true,originalDay:day,backfillDay:day}),false);assert.equal(F.isCarried({memoPlannedDueDay:day,originalDay:day}),false);
});

test('overdue ideal tasks and queue assignments advance without penalties and keep history',async()=>{
 const b=H.browser();await b.S.load();
 const {F,P,A}=H.flowHarness(b,'2026-11-13');
 const finance=H.financeHarness(b), d=b.S.data();
 const original='2026-11-13', due='2026-11-14', today='2026-11-15', next='2026-11-16';
 const at=(day,time='04:00')=>Date.parse(day+'T'+time+':00+08:00');
 const ref={kind:'task',id:'ideal-cross',day:original,list:'ideal'};
 const queueRef={kind:'queue',id:'ideal-overdue'};
 b.S.getDay(original).tasks.ideal.push(
   {id:ref.id,text:'跨日理想',points:3,note:'保留备注'},
   {id:'fixed',text:'周期实例',memoNoAutoCarry:true},
   {id:'review',text:'复习实例',memoReviewRoundId:'round'},
   {id:'finished',text:'已经完成',done:true}
 );
 b.S.getDay(original).tasks.required.push({id:'required-overdue',text:'必做'});
 d.queue.push({id:queueRef.id,text:'队列理想',points:1,assignment:{day:due,list:'ideal'}});
 P.savePlan({ref,day:original,type:'span',start:at(original,'23:00'),end:at(due,'08:00')});
 P.startRef(ref,at(original,'23:30'));
 P.stopRef(ref,at(original,'23:45'));

 F.settleCore(at(due,'03:59'));
 assert.equal(P.resolve(ref).ref.day,original);
 F.settleCore(at(due));
 assert.equal(P.resolve(ref).ref.day,due);
 assert.equal(F.isCarried(P.find(ref)),false);
 F.settleCore(at(today));
 assert.equal(P.resolve(ref).ref.day,today);
 assert.equal(P.find(ref).note,'保留备注');
 assert.equal(P.timing(ref,at(today)).totalMs,15*60000);
 assert.equal(P.find(queueRef).assignment.day,today);
 assert.equal(finance.column(today,'ideal').deferred,2);
 assert.equal(F.deferred(due,'ideal').filter(x=>x.automatic).length,2);
 assert.equal(F.deferred(original,'ideal').filter(x=>x.automatic).length,0);

 F.settleCore(at(today));
 F.settleCore(at(next));
 assert.equal(P.resolve(ref).ref.day,next);
 assert.equal(P.find(queueRef).assignment.day,next);
 assert.equal(P.find(ref).originalDay,due);
 assert.equal(P.find(queueRef).assignmentHistory.length,2);
 assert.equal(P.columnItems(next,'ideal').length,2);
 assert.deepEqual(Array.from(d.memoFlow.settlements,e=>e.taskId),['required-overdue']);
 assert.deepEqual(Array.from(d.ledger.filter(e=>e.type==='penalty-required'),e=>e.taskId),['required-overdue']);
 assert.equal(b.S.getDay(original).tasks.ideal.filter(t=>!t.memoMovedTo).length,3);

 A.completeCore({...P.resolve(ref).ref,title:'跨日理想'},'',next+'T12:00:00+08:00');
 assert.equal(finance.column(next,'ideal').lateDone,1);
 assert.equal(d.ledger.find(e=>e.taskId===ref.id).points,3);
 assert(b.S.validate(d));
});
