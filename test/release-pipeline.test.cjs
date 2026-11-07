'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse}=require('yaml');
const root=path.resolve(__dirname,'..'),sha='a'.repeat(40),repo='owner/project';
test('publish gate rejects wrong origin, failed, incomplete, PR and stale candidates',async()=>{
 const {validateCandidate}=await import('../scripts/publish-guard.mjs');
 const input={sha,repo,currentMain:sha,run:{repository:{full_name:repo},head_repository:{full_name:repo},head_sha:sha,head_branch:'main',path:'.github/workflows/validate.yml',event:'push',status:'completed',conclusion:'success'},jobs:[{name:'Release verification',conclusion:'success'},...['A','B','C'].map(x=>({name:'browser ('+x+')',conclusion:'success'}))]};
 assert.doesNotThrow(()=>validateCandidate(input));
 for(const patch of [{event:'pull_request'},{conclusion:'failure'},{head_repository:{full_name:'fork/project'}},{head_branch:'feature'},{head_sha:'b'.repeat(40)}])assert.throws(()=>validateCandidate({...input,run:{...input.run,...patch}}));
 assert.throws(()=>validateCandidate({...input,currentMain:'b'.repeat(40)}));
 assert.throws(()=>validateCandidate({...input,jobs:input.jobs.slice(1)}));
 assert.throws(()=>validateCandidate({...input,jobs:input.jobs.slice(0,3)}));
});
test('live checks reject reused versions and rollback approvals for an older live SHA',async()=>{
 const {checkLive}=await import('../scripts/check-deployment.mjs');
 const input={live:{id:'1.0.0',sourceCommit:sha,dataVersion:1},record:{version:'2.0.0',sourceCommit:'b'.repeat(40)},mode:'publish'};
 assert.doesNotThrow(()=>checkLive(input));
 assert.throws(()=>checkLive({...input,record:{...input.record,version:'1.0.0'}}));
 assert.throws(()=>checkLive({...input,mode:'rollback'}));
 assert.throws(()=>checkLive({...input,mode:'rollback',currentSHA:'c'.repeat(40)}));
 assert.doesNotThrow(()=>checkLive({...input,mode:'rollback',currentSHA:sha}));
 assert.throws(()=>checkLive({...input,live:{...input.live,dataVersion:2}}));
});
test('candidate detects changed assets, extra files and wrong source without modifying original',async()=>{
 const {createBundle,checkBundle}=await import('../scripts/release-bundle.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'focus-release-'));
 try{
  const record=createBundle(path.join(root,'dist/spa'),dir);assert.equal(checkBundle(dir).treeDigest,record.treeDigest);
  assert.throws(()=>checkBundle(dir,{sha:'b'.repeat(40)}));
  fs.writeFileSync(path.join(dir,'site/extra.txt'),'unexpected');assert.throws(()=>checkBundle(dir));fs.unlinkSync(path.join(dir,'site/extra.txt'));
  fs.appendFileSync(path.join(dir,'site/index.html'),'tampered');assert.throws(()=>checkBundle(dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manifest rejects duplicate entries and mismatched worker independently of bundle digest',async()=>{
 const {verifyRelease}=await import('../scripts/check-release.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'focus-manifest-'));
 try{
  fs.cpSync(path.join(root,'dist/spa'),dir,{recursive:true});const name=path.join(dir,'version.json'),raw=fs.readFileSync(name),manifest=JSON.parse(raw);
  manifest.assets.push(manifest.assets[0]);fs.writeFileSync(name,JSON.stringify(manifest));assert.throws(()=>verifyRelease(dir));fs.writeFileSync(name,raw);
  fs.writeFileSync(path.join(dir,'sw.js'),'wrong worker');assert.throws(()=>verifyRelease(dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('workflow configuration keeps one build, three browser jobs and explicit publication',()=>{
 const validate=parse(fs.readFileSync(path.join(root,'.github/workflows/validate.yml'),'utf8'));
 const publish=parse(fs.readFileSync(path.join(root,'.github/workflows/publish.yml'),'utf8'));
 assert.deepEqual(validate.jobs.browser.strategy.matrix.group,['A','B','C']);assert.equal(validate.jobs.browser.container,'mcr.microsoft.com/playwright:v1.57.0-noble');
 assert.equal(validate.jobs.verified.name,'Release verification');assert.deepEqual(Object.keys(publish.on),['workflow_dispatch']);
 assert.equal(publish.concurrency['cancel-in-progress'],false);assert.deepEqual(publish.jobs.archive.needs,['deploy','online-browser']);
});
test('browser runner preserves nonzero exits and bounds a hanging child',async()=>{
 const {runChild}=await import('../scripts/test-browser.mjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'focus-runner-'));
 try{
  const failed=await runChild('fixtures/runner-fail.cjs',path.join(dir,'fail.log'));assert.equal(failed.passed,false);assert.equal(failed.code,7);assert.match(fs.readFileSync(path.join(dir,'fail.log'),'utf8'),/intentional failure/);
  const hung=await runChild('fixtures/runner-hang.cjs',path.join(dir,'hang.log'),300);assert(hung.timedOut);assert(!hung.passed);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
