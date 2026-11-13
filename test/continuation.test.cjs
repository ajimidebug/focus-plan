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
 A.undoCore(e.id,'',H.actionAt);assert.equal(M.read(e.noteDay).text,before);assert(M.exportBlocks(M.segments(M.read(e.noteDay))).includes('数学 · 已撤销完成'));assert(before.includes('备注A'));assert(before.includes('段内C'));assert.equal(b.S.pointsTotal(),0);await b.S.save();const c=H.browser({shared:b});await c.S.load();assert.equal(H.memoHarness(c).read(e.noteDay).text,before);
});
