'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {browser,flowHarness}=require('./helpers/harness.cjs');
async function harness(){
 const b=browser();await b.S.load();const h=flowHarness(b,'2026-11-16');
 let now=Date.parse('2026-11-16T12:00:00+08:00');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 b.ctx.Date=Clock;vm.runInContext(fs.readFileSync('js/memo-three.js','utf8'),b.ctx);
 const T=b.ctx.App.memoThree,d=b.S.data();
 d.memoThree={version:1,anchor:'2026-11-16',tasks:[],history:[],settledRound:0};
 const add=id=>{const task={id,text:'任务'+id,note:'原始备注',points:5,estimatedMinutes:20,createdDay:h.M.userDay(),originRound:T.round().index,done:false};d.memoThree.tasks.push(task);return {kind:'three',id,list:'three'};};
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
 b.setTime('2026-12-01T12:00:00+08:00');T.settleCore();assert.equal(T.state().settledRound,5);assert.equal(T.state().tasks.length,2);assert.equal(T.projection().rows.length,1);
 assert.equal(await b.S.save(),true);const next=browser({shared:b});assert.equal(await next.S.load(),true);assert.equal(next.S.data().memoThree.history.length,5);
});
test('three-day deletion can restore notes and points, or just the unfinished task',async()=>{
 const b=await harness(),ref=b.add('delete');const event=b.A.completeCore({...ref,title:'删除测试'},'自定义完成说明',b.at());
 const entry=b.A.deleteCore(ref,'',b.at());assert.equal(b.T.find(ref.id),undefined);assert.equal(b.S.pointsTotal(),0);
 b.A.restoreCore(entry.id);assert.equal(b.T.find(ref.id).done,true);assert.equal(b.S.pointsTotal(),5);assert.match(b.M.read(b.M.userDay()).text,/自定义完成说明/);
 const second=b.A.deleteCore(ref,'',b.at());b.A.restoreCore(second.id,true);assert.equal(b.T.find(ref.id).done,false);assert.equal(b.S.pointsTotal(),0);assert.equal(event.active,false);
});
test('three-day full backup rejects unknown and damaged module data without changing existing data',async()=>{
 const b=await harness();b.add('backup');const valid=JSON.parse(JSON.stringify(b.S.data()));assert.equal(b.S.validate(valid),true);
 for(const mutate of [d=>d.memoThree.version=2,d=>d.memoThree.tasks.push(d.memoThree.tasks[0]),d=>d.memoThree.tasks[0].originRound=-1,d=>d.memoThree.history.push({index:0,rows:[null]})]){
  const bad=structuredClone(valid);mutate(bad);assert.equal(b.S.validate(bad),false);
 }
 assert.equal(b.S.validate(valid),true);assert.equal(await b.S.save(),true);
});

test('future rounds stay separate and retained task notes survive complete, undo and reload',async()=>{
 const b=await harness(),ref=b.add('now'),future=b.add('future');
 b.T.find(future.id).originRound=1;
 assert.equal(b.T.projection().rows.length,1);
 const next=b.T.projection('2026-11-19');assert.equal(next.future,true);assert.deepEqual(Array.from(next.rows,x=>x.id),['future']);assert.equal(b.T.items('2026-11-19').length,0);
 assert.throws(()=>b.P.startRef(future),/本轮/);
 const event=b.A.completeCore({...ref,title:'now'},'完成说明',b.at());b.A.undoCore(event.id,'',b.at());assert.equal(b.T.find(ref.id).note,'原始备注');
 await b.S.save();const c=browser({shared:b});await c.S.load();assert.equal(c.S.data().memoThree.tasks[0].note,'原始备注');
 b.setTime('2026-11-19T04:00:00+08:00');b.T.settleCore();assert.equal(b.T.projection().rows.length,2);assert.equal(b.T.projection().rows.filter(x=>x.delayed).length,1);
});

test('round view is safe before setup and survives remount within the same round',async()=>{
 const b=await harness(),state=b.S.data().memoThree;delete b.S.data().memoThree;
 assert.equal(b.T.viewOffset('2026-11-16'),0);
 b.S.data().memoThree=state;b.T.viewOffset('2026-11-16',1);
 assert.equal(b.T.viewOffset('2026-11-17'),1);assert.equal(b.T.viewOffset('2026-11-19'),0);
});

test('full report includes unfinished unscheduled Gantt tasks and their notes',async()=>{
 const b=browser();await b.S.load();const {R}=require('./helpers/harness.cjs').executionReportHarness(b);
 b.ctx.App.memoGantt={model:()=>({rows:[{key:'project:pending',title:'未排期项目',valid:false,start:null,end:null,achieved:false,task:{note:'项目备注'}}]}),deadlines:()=>[]};
 const text=R.report('2026-10-28').text;
 assert.match(text,/未排期项目〔未完成；未排期〕/);assert.match(text,/项目备注/);
});
