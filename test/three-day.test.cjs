'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {browser,flowHarness}=require('./helpers/harness.cjs');
async function harness(){
 const b=browser();await b.S.load();const h=flowHarness(b,'2026-11-16');
 let now=Date.parse('2026-11-16T12:00:00+08:00');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 b.ctx.Date=Clock;vm.runInContext(fs.readFileSync('js/memo-three.js','utf8'),b.ctx);
 const T=b.ctx.App.memoThree,d=b.S.data();
 d.memoThree={version:2,anchor:'2026-11-16',rounds:[{index:0,start:'2026-11-16',end:'2026-11-18'},{index:1,start:'2026-11-19',end:'2026-11-23'},{index:2,start:'2026-11-25',end:'2026-11-27'}],tasks:[],history:[],settledRound:0};
 const add=id=>{const task={id,text:'任务'+id,note:'原始备注',points:5,estimatedMinutes:20,createdDay:h.M.userDay(),originRound:T.round().index,roundIndex:T.round().index,done:false};d.memoThree.tasks.push(task);return {kind:'three',id,list:'three'};};
 return {...b,...h,T,add,setTime:value=>now=Date.parse(value),at:()=>new Clock().toISOString()};
}
test('three-day boundary carries one identity and preserves active chunks and closed-round results',async()=>{
 const b=await harness(),{T,P,A,M}=b,r=b.add('pending'),done=b.add('done');
 const s=P.startRef(r);A.completeCore({...done,title:'已完成'},'记录',b.at());
 b.setTime('2026-11-19T03:59:59+08:00');assert.equal(T.round().index,0);assert.equal(T.needsSettlement(),false);
 b.setTime('2026-11-19T04:00:00+08:00');T.settleCore();T.settleCore();
 assert.equal(T.state().history.length,1);assert.equal(T.state().tasks.length,2);assert.equal(s.status,'running');assert.equal(s.chunks.length,1);
 assert.equal(T.projection().rows.length,1);assert.equal(T.projection().rows[0].delayed,true);
 assert.equal(T.projection('2026-11-17').done,1);assert.equal(T.projection('2026-11-17').total,2);
 const event=A.completeCore({...r,title:'延期完成'},'跨轮备注',b.at());assert.equal(event.sourceDay,M.userDay());assert.equal(event.threeRound,1);assert.equal(s.status,'ended');
 assert.equal(T.projection('2026-11-17').done,1);assert.equal(T.projection().done,1);
 assert.throws(()=>A.completeCore({...r,title:'重复'},'',b.at()));assert.equal(b.S.pointsTotal(),10);
 A.undoCore(event.id,'',b.at());assert.equal(T.find(r.id).done,false);assert.equal(b.S.pointsTotal(),5);assert.match(M.read(M.userDay()).text,/跨轮备注/);
 b.setTime('2026-12-01T12:00:00+08:00');T.settleCore();assert.equal(T.state().settledRound,3);assert.equal(T.state().tasks.length,2);assert.equal(T.pending().length,1);
 assert.equal(await b.S.save(),true);const next=browser({shared:b});assert.equal(await next.S.load(),true);assert.equal(next.S.data().memoThree.history.length,3);
});
test('three-day deletion can restore notes and points, or just the unfinished task',async()=>{
 const b=await harness(),ref=b.add('delete');const event=b.A.completeCore({...ref,title:'删除测试'},'自定义完成说明',b.at());
 const entry=b.A.deleteCore(ref,'',b.at());assert.equal(b.T.find(ref.id),undefined);assert.equal(b.S.pointsTotal(),0);
 b.A.restoreCore(entry.id);assert.equal(b.T.find(ref.id).done,true);assert.equal(b.S.pointsTotal(),5);assert.match(b.M.read(b.M.userDay()).text,/自定义完成说明/);
 const second=b.A.deleteCore(ref,'',b.at());b.A.restoreCore(second.id,true);assert.equal(b.T.find(ref.id).done,false);assert.equal(b.S.pointsTotal(),0);assert.equal(event.active,false);
});
test('three-day full backup rejects unknown and damaged module data without changing existing data',async()=>{
 const b=await harness();b.add('backup');const valid=JSON.parse(JSON.stringify(b.S.data()));assert.equal(b.S.validate(valid),true);
 for(const mutate of [d=>d.memoThree.version=3,d=>d.memoThree.tasks.push(d.memoThree.tasks[0]),d=>d.memoThree.tasks[0].originRound=-1,d=>d.memoThree.history.push({index:0,rows:[null]})]){
  const bad=structuredClone(valid);mutate(bad);assert.equal(b.S.validate(bad),false);
 }
 assert.equal(b.S.validate(valid),true);assert.equal(await b.S.save(),true);
});

test('future rounds stay separate and retained task notes survive complete, undo and reload',async()=>{
 const b=await harness(),ref=b.add('now'),future=b.add('future');
 b.T.find(future.id).originRound=1;b.T.find(future.id).roundIndex=1;
 assert.equal(b.T.projection().rows.length,1);
 const next=b.T.projection('2026-11-19');assert.equal(next.future,true);assert.deepEqual(Array.from(next.rows,x=>x.id),['future']);assert.equal(b.T.items('2026-11-19').length,0);
 assert.throws(()=>b.P.startRef(future),/本轮/);
 const event=b.A.completeCore({...ref,title:'now'},'完成说明',b.at());b.A.undoCore(event.id,'',b.at());assert.equal(b.T.find(ref.id).note,'原始备注');
 await b.S.save();const c=browser({shared:b});await c.S.load();assert.equal(c.S.data().memoThree.tasks[0].note,'原始备注');
 b.setTime('2026-11-19T04:00:00+08:00');b.T.settleCore();assert.equal(b.T.projection().rows.length,2);assert.equal(b.T.projection().rows.filter(x=>x.delayed).length,1);
});

test('selected day resolves saved, preview and distant rounds without persisting empty rounds',async()=>{
 const b=await harness(),state=b.S.data().memoThree;delete b.S.data().memoThree;
 assert.equal(b.T.plannedRound('2026-11-20').start,'2026-11-19');
 assert.equal(b.T.calendarRounds().length,11);assert.equal(b.T.state(),null);
 b.S.data().memoThree=state;
 assert.equal(b.T.plannedRound('2026-11-20').index,1);
 assert.equal(b.T.plannedRound('2027-02-01').index,null);
});

test('full report includes unfinished unscheduled Gantt tasks and their notes',async()=>{
 const b=browser();await b.S.load();const {R}=require('./helpers/harness.cjs').executionReportHarness(b);
 b.ctx.App.memoGantt={model:()=>({rows:[{key:'project:pending',title:'未排期项目',valid:false,start:null,end:null,achieved:false,task:{note:'项目备注'}}]}),deadlines:()=>[]};
 const text=R.report('2026-10-28').text;
 assert.match(text,/未排期项目〔未完成；未排期〕/);assert.match(text,/项目备注/);
});
test('legacy migration preserves identities, notes, closed snapshots and future assignments',async()=>{
 const b=await harness(),ref=b.add('legacy'),task=b.T.find(ref.id);
 b.S.data().memoThree={version:1,anchor:'2026-11-16',tasks:[task],history:[],settledRound:0};delete task.roundIndex;
 const session=b.P.startRef(ref);b.T.migrateCore();b.T.migrateCore();
 assert.equal(b.T.state().version,2);assert.equal(task.roundIndex,0);assert.equal(task.note,'原始备注');assert.equal(b.P.state().sessions[0].id,session.id);
 assert.equal(b.T.rounds().length,3);assert.equal(b.S.validate(b.S.data()),true);
 await b.S.save();const c=browser({shared:b});await c.S.load();assert.equal(c.S.data().memoThree.version,2);
 const bad=structuredClone(b.S.data());bad.memoThree.rounds[1].start='2026-11-18';assert.equal(b.S.validate(bad),false);
});
test('round ranges cannot overlap and early close releases dates while freezing the result',async()=>{
 const b=await harness(),ref=b.add('carry');
 assert.throws(()=>b.T.saveRoundCore('2026-11-18','2026-11-20'),/重叠/);
 const ledger=JSON.stringify(b.S.data().ledger);b.T.closeCore(0,true);
 assert.equal(b.T.byIndex(0).end,'2026-11-16');assert.equal(b.T.byIndex(0).originalEnd,'2026-11-18');
 assert.equal(b.T.find(ref.id).roundIndex,1);assert.equal(JSON.stringify(b.S.data().ledger),ledger);
 assert.equal(b.T.byIndex(1).start,'2026-11-17');
 assert.equal(b.T.byIndex(1).end,'2026-11-21');
 assert.equal(b.T.byIndex(2).start,'2026-11-23');
 b.setTime('2026-11-17T04:00:00+08:00');const e=b.A.completeCore({...ref,title:'跨轮完成'},'保留记录',b.at());b.A.undoCore(e.id,'',b.at());
 assert.equal(b.T.projection('2026-11-16').done,0);assert.equal(b.T.projection('2026-11-16').rows[0].note,'原始备注');assert.equal(b.S.validate(b.S.data()),true);
});
test('Gantt tasks share sources, follow deadlines, allow manual override and retain closed results',async()=>{
 const b=await harness();b.ctx.document={addEventListener(){}};vm.runInContext(fs.readFileSync('js/memo-gantt.js','utf8'),b.ctx);
 const day=b.M.userDay(),task={id:'linked',text:'甘特任务',note:'共享备注',points:4,memoGanttEnd:'2026-11-20'};
 b.S.getDay(day).tasks.ideal.push(task);const ref={kind:'task',id:task.id,day,list:'ideal'};
 assert.equal(b.T.projection('2026-11-19').rows[0].task,task);assert.equal(b.T.state().tasks.length,0);
 task.memoGanttEnd='2026-11-17';assert.equal(b.T.projection().rows[0].task,task);
 b.T.assignCore(ref,1);assert.equal(b.T.projection().total,0);assert.equal(b.T.projection('2026-11-19').rows[0].conflict,true);
 task.memoGanttEnd='2026-11-18';assert.equal(b.T.projection('2026-11-19').total,1);
 b.T.assignCore(ref,'auto');assert.equal(b.T.projection().total,1);
 const e=b.A.completeCore({...ref,title:task.text},'来自轮次的完成',b.at());assert.equal(b.T.projection().done,1);assert.equal(b.S.pointsTotal(),4);
 b.T.closeCore(0,true);b.A.undoCore(e.id,'',b.at());assert.equal(b.T.projection('2026-11-16').done,1);assert.equal(b.S.pointsTotal(),0);assert.equal(task.note,'共享备注');
 assert.equal(b.S.validate(b.S.data()),true);
});
test('round gaps keep pending tasks and creating a later round can receive them without changing timers',async()=>{
 const b=await harness(),ref=b.add('gap'),run=b.P.startRef(ref);b.T.state().rounds=b.T.state().rounds.slice(0,1);
 b.setTime('2026-11-19T04:00:00+08:00');b.T.settleCore();assert.equal(b.T.round(),null);assert.equal(b.T.pending().length,1);assert.equal(run.status,'running');
 const next=b.T.saveRoundCore('2026-11-21','2026-11-28');assert.equal(b.T.find(ref.id).roundIndex,next.index);assert.equal(b.T.pending().length,0);assert.equal(b.S.validate(b.S.data()),true);
});

test('early end pauses actual time and failed round saves retry without duplicating rounds',async()=>{
 const b=await harness(),ref=b.add('pause');const now=Date.parse(b.at()),session=b.P.startRef(ref,now-10000);
 b.T.closeCore(0,true,now);assert.equal(session.status,'paused');assert.equal(b.P.elapsed(session,now+60000),10000);
 await b.S.save();b.options.idbFails=true;
 await assert.rejects(b.A.commit(()=>b.T.saveRoundCore('2026-11-28','2026-11-30')),/尚未保存/);
 const count=b.T.rounds().length;b.options.idbFails=false;await b.A.commit(()=>{throw Error('must not replay');});
 assert.equal(b.T.rounds().length,count);assert.equal(b.S.validate(b.S.data()),true);
});

test('moving between a daily list and a round preserves one task and its execution', async () => {
 const b=await harness(),{P,A,M,T}=b,day=M.userDay(),d=b.S.data();
 const ref={kind:'task',id:'round-trip',day,list:'ideal'};
 b.S.getDay(day).tasks.ideal.push({id:ref.id,text:'移入再移出',note:'蓝字',points:4,estimatedMinutes:25,memoGanttEnd:'2026-11-20'});
 const now=Date.parse(b.at());
 const session=P.startRef(ref,now-60000);
 const moved=b.ctx.App.memoFlow.moveCore(ref,'2026-11-20','three');
 assert.equal(P.canonical(ref).kind,'three');
 assert.equal(T.nativeTarget(P.find(moved)),1);
 assert.deepEqual([...T.projection('2026-11-20').rows.map(r=>r.id)],['round-trip']);
 assert.equal(b.S.getDay(day).tasks.ideal.length,0);
 assert.equal(session.status,'ended');
 assert.equal(P.elapsed(session,now),60000);
 assert.equal(P.find(moved).note,'蓝字');
 const back=b.ctx.App.memoFlow.moveCore(moved,day,'required');
 assert.equal(P.canonical(ref).list,'required');
 assert.equal(P.canonical(moved).list,'required');
 assert.equal(P.find(back).memoGanttEnd,'2026-11-20');
 assert.equal(P.execution(back,now).actualMs,60000);
 assert.equal(T.state().tasks.length,0);
 const event=A.completeCore({...back,title:'移入再移出'},'备注',b.at());
 A.undoCore(event.id,'撤销',b.at());
 assert.equal(P.find(ref).done,false);
 assert.equal(P.execution(ref,now).actualMs,60000);
 assert.equal(b.S.validate(JSON.parse(JSON.stringify(d))),true);
});

test('a deleted or finished session with an open chunk contributes no invented time', async () => {
 const b=await harness(),{P,A,M}=b,day=M.userDay(),ref=b.add('ended-open'),now=Date.parse(b.at());
 const session=P.startRef(ref,now-120000);
 P.pauseCore(session,now-60000);
 P.startRef(ref,now-30000);
 A.deleteCore(ref,'删除后核对',b.at());
 session.chunks.at(-1).end=null;
 assert.equal(session.status,'ended');
 assert.equal(P.elapsed(session,now+60000),60000);
 assert.equal(P.dayExecutionMs(day,now+60000),60000);
 assert.equal(P.executionIndex(now+60000)[day].actualMs,60000);
 assert.equal(P.visibleRecords(day,now+60000).sessions[0].id,session.id);
 assert.equal(session.chunks.at(-1).end,null);
});
