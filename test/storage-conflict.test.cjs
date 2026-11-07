'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {browser}=require('./helpers/harness.cjs');
test('database-only writes reject a stale second tab and preserve its unsaved content',async()=>{
  const a=browser();await a.S.load();const b=browser({shared:a});await b.S.load();
  a.options.localFails=b.options.localFails=true;
  a.S.data().queue.push({id:'a'});b.S.data().queue.push({id:'b'});
  assert.equal(await a.S.save(),true);assert.equal(await b.S.save(),false);
  assert.equal(b.S.status().readOnly,true);assert.equal(b.S.data().queue[0].id,'b');
  const c=browser({shared:a});await c.S.load();assert.deepEqual(JSON.parse(JSON.stringify(c.S.data().queue)),[{id:'a'}]);
});
test('simultaneous database-only commits accept exactly one writer',async()=>{
  const a=browser();await a.S.load();const b=browser({shared:a});await b.S.load();
  a.options.localFails=b.options.localFails=true;
  a.S.data().queue.push({id:'a'});b.S.data().queue.push({id:'b'});
  const results=await Promise.all([a.S.save(),b.S.save()]);assert.equal(results.filter(Boolean).length,1);
  const c=browser({shared:a});await c.S.load();assert.equal(c.S.data().queue.length,1);
});
test('same-tab queued snapshots preserve the last operation after reload',async()=>{
  const a=browser();await a.S.load();a.options.localFails=true;
  const pending=[];for(let i=0;i<8;i++){a.S.data().queue.push({id:String(i)});pending.push(a.S.save());}
  assert((await Promise.all(pending)).every(Boolean));assert(await a.S.flush());
  const b=browser({shared:a});await b.S.load();assert.equal(b.S.data().queue.length,8);
});
test('unreadable database never permits an unverified local-only overwrite; retry saves once',async()=>{
  const a=browser();await a.S.load();const before=a.mem.get('focusPlanData.v1');
  a.S.data().queue.push({id:'pending'});a.options.idbFails=true;
  assert.equal(await a.S.save(),false);assert.equal(await a.S.flush(),false);assert.equal(a.mem.get('focusPlanData.v1'),before);
  a.options.idbFails=false;assert(await a.S.save());const b=browser({shared:a});await b.S.load();assert.equal(b.S.data().queue.length,1);
});
test('both channels failing preserve the operation and do not advance committed revision',async()=>{
  const a=browser();await a.S.load();const revision=a.S.data()._storageRevision;
  a.options.localFails=a.options.idbFails=true;a.S.data().ledger.push({id:'event',points:3});
  assert.equal(await a.S.save(),false);assert.equal(a.S.data()._storageRevision,revision);
  a.options.localFails=a.options.idbFails=false;assert(await a.S.save());const b=browser({shared:a});await b.S.load();assert.equal(b.S.pointsTotal(),3);
});
test('closing a tab warns while a commit is pending or failed, then clears after retry',async()=>{
  const a=browser();await a.S.load();let prevented=0;
  const close=()=>a.events.beforeunload({preventDefault(){prevented++;}});
  close();assert.equal(prevented,0);
  a.S.data().queue.push({id:'unsaved'});a.options.idbFails=true;
  const pending=a.S.save();close();assert.equal(prevented,1);
  assert.equal(await pending,false);close();assert.equal(prevented,2);
  a.options.idbFails=false;assert(await a.S.save());close();assert.equal(prevented,2);
});
