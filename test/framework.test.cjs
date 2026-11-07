'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),fc=require('fast-check');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const harness=()=>require('./helpers/harness.cjs');
test('random completion and exact undo keep one active occurrence and preserve handwritten text',async()=>{
  const H=harness();
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(),{minLength:1,maxLength:60}),async actions=>{
    const b=H.browser();await b.S.load();const {A,M}=H.actionHarness(b);b.S.data().queue=[{id:'q',text:'学习',points:7}];M.write('2026-10-19','独立手写原文');
    let active=null;
    for(const complete of actions){
      if(complete&&!active)active=A.completeCore({kind:'queue',id:'q',title:'学习'},'生成学习记录',H.actionAt);
      else if(!complete&&active){A.undoCore(active.id,'',H.actionAt);assert.throws(()=>A.undoCore(active.id,'',H.actionAt),/已经取消/);active=null;}
      assert.equal(b.S.pointsTotal(),active?7:0);
      assert.equal((b.S.data().memoEvents||[]).filter(e=>e.active&&e.sourceId==='q').length,active?1:0);
      assert(M.read('2026-10-19').text.startsWith('独立手写原文'));
    }
    await b.S.save();const after=H.browser({shared:b});await after.S.load();assert.equal(after.S.pointsTotal(),active?7:0);
  }),{numRuns:45,seed:174000});
});
test('random overlapping execution intervals equal an independent second-resolution union',async()=>{
  const H=harness(),b=H.browser();await b.S.load();const {P}=H.scheduleHarness(b);
  fc.assert(fc.property(fc.array(fc.tuple(fc.integer({min:0,max:3600}),fc.integer({min:0,max:120})),{maxLength:40}),pairs=>{
    const base=Date.parse(H.actionAt),intervals=pairs.map(([a,d])=>({start:base+a*1000,end:base+(a+d)*1000})),seconds=new Set();
    for(const [a,d]of pairs)for(let n=a;n<a+d;n++)seconds.add(n);
    assert.equal(P.unionMs(intervals),seconds.size*1000);
  }),{numRuns:200,seed:174001});
});
test('the complete built release, recovery page and compatibility UI match their manifest',()=>{
  const out=path.join(root,'dist/spa'),release=JSON.parse(fs.readFileSync(path.join(out,'version.json')));
  assert.equal(release.dataVersion,1);
  for(const a of release.assets){const file=path.join(out,a.url.slice(2).split('?')[0]);assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),a.sha256,a.url);}
  assert(release.assets.some(a=>a.url.includes('recovery.html')));
  assert(release.assets.some(a=>a.url.includes('rollback/173.9.1/index.html')));
  const fallback=fs.readFileSync(path.join(out,release.rollback),'utf8');
  assert(!/<script src="js\/updates\.js/.test(fallback));
  assert(!fallback.includes('__FRAMEWORK_BOOT=true'));
  assert(fs.readFileSync(path.join(out,'legacy-core.js'),'utf8').includes('focusPlanData.v1'));
});
