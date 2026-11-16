'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const H=require('./helpers/harness.cjs');
function workspace(b){vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/memo-workspace.js'),'utf8'),b.ctx);return b.ctx.App.memoWorkspace;}
async function setup(){const b=H.browser();await b.S.load();const h=H.flowHarness(b),W=workspace(b),day=h.M.userDay();const refs=['a','b','c'].map(id=>({kind:'task',id,day,list:'ideal'}));b.S.getDay(day).tasks.ideal=refs.map(r=>({id:r.id,text:r.id,points:3}));b.S.data().memoExecutionQueue=refs.map(ref=>({ref}));W.selectQueueCore(refs[0]);return {b,...h,W,refs,day};}
test('completion selects next queue item without creating time, including paused and unstarted items',async()=>{
 for(const status of ['running','paused','unstarted']){
  const {b,A,P,W,refs}=await setup();const now=Date.now();if(status!=='unstarted'){const session=P.startRef(refs[0],now-10000);if(status==='paused')P.pauseCore(session,now-5000);}
  A.completeCore({...refs[0],title:'a'},'',new Date(now).toISOString());W.pruneExec();
  assert.equal(W.waitingQueue().ref.id,'b');assert.equal(P.state().sessions.some(s=>s.ref.id==='b'),false);assert.equal(P.state().sessions.some(s=>s.status==='running'),false);
  await b.S.save();const c=H.browser({shared:b});await c.S.load();H.flowHarness(c);const next=workspace(c);assert.equal(next.waitingQueue().ref.id,'b');
  const before=c.S.data().memoSchedule?.sessions?.length||0;c.ctx.App.memoSchedule.startRef(refs[1],now+1000);assert.equal(next.waitingQueue(),null);assert.equal(c.S.data().memoSchedule.sessions.length,before+1);
 }
});
test('clearing references pauses running queue time and preserves tasks, rewards and history',async()=>{
 const {b,P,W,refs,day}=await setup(),now=Date.now();const run=P.startRef(refs[0],now-10000),tasks=JSON.stringify(b.S.getDay(day).tasks),ledger=JSON.stringify(b.S.data().ledger);
 W.clearExecCore(now);assert.equal(run.status,'paused');assert.equal(run.chunks[0].end,now);assert.equal(b.S.data().memoExecutionQueue.length,0);assert.equal(W.currentQueueItem(),null);assert.equal(JSON.stringify(b.S.getDay(day).tasks),tasks);assert.equal(JSON.stringify(b.S.data().ledger),ledger);assert.equal(P.elapsed(run,now+60000),10000);
 W.clearExecCore(now+1000);assert.equal(P.state().sessions.length,1);
});
test('failed clear save retries persistence without replaying the pause operation',async()=>{
 const {b,A,P,W,refs}=await setup(),now=Date.now();P.startRef(refs[0],now-10000);await b.S.save();b.options.idbFails=true;
 await assert.rejects(A.commit(()=>W.clearExecCore(now)),/尚未保存/);b.options.idbFails=false;
 await A.commit(()=>{throw Error('must not replay');});assert.equal(b.S.data().memoExecutionQueue.length,0);assert.equal(P.state().sessions[0].chunks.length,1);assert.equal(P.state().sessions[0].chunks[0].end,now);
});
for(const paused of [false,true])test('manual update preserves '+(paused?'paused':'running')+' execution and same cross-day chunks',async()=>{
 const {b,P,refs}=await setup(),start=Date.parse('2026-11-16T03:59:00+08:00');const run=P.startRef(refs[0],start);if(paused)P.pauseCore(run,start+120000);await b.S.save();
 const u=H.updatesHarness(b);await new Promise(r=>setImmediate(r));u.waiting();assert.equal(await u.U.apply(false),false);assert.equal(u.posted.length,0);
 const before=JSON.stringify(b.S.data().memoSchedule.sessions);assert.equal(await u.U.apply(true),true);assert.equal(JSON.stringify(b.S.data().memoSchedule.sessions),before);assert.equal(u.posted.length,1);
 const c=H.browser({shared:b});await c.S.load();const h=H.scheduleHarness(c),restored=h.P.state().sessions.find(s=>s.id===run.id);assert.equal(restored.status,paused?'paused':'running');assert.equal(restored.chunks.length,1);assert.equal(h.P.elapsed(restored,start+180000),paused?120000:180000);
});
test('update save failure and concurrent timer changes block activation without ending time',async()=>{
 const {b,P,refs}=await setup(),now=Date.now();const run=P.startRef(refs[0],now-1000);await b.S.save();const u=H.updatesHarness(b);await new Promise(r=>setImmediate(r));u.waiting();b.options.idbFails=true;assert.equal(await u.U.apply(true),false);assert.equal(u.posted.length,0);assert.equal(run.status,'running');
 b.options.idbFails=false;await b.S.save();b.ctx.App.backup.snap=async()=>{P.pauseCore(run,now);return {id:'snap'};};assert.equal(await u.U.apply(true),false);assert.equal(u.posted.length,0);assert.equal(run.status,'paused');
});
