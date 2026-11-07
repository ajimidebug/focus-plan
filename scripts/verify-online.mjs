import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL(process.argv[2]),dir=process.argv[3]||'.release/candidate/site';
assert.equal(base.protocol,'https:');
const release=JSON.parse(readFileSync(dir+'/version.json'));
async function get(file){const u=new URL(file,base);u.searchParams.set('verify',release.sourceCommit);const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(20000)});assert(r.ok,file+': HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}
// A bounded retry allows Pages propagation; errors are still a failed verification.
let error;
for(let attempt=0;attempt<4;attempt++){
 try{
  const actual=JSON.parse(await get('version.json'));assert.equal(actual.id,release.id);assert.equal(actual.sourceCommit,release.sourceCommit);assert.deepEqual(actual.assets,release.assets);
  const required=release.assets.filter(a=>['./index.html','./legacy-core.js','./recovery.html','./recovery.js'].includes(a.url.split('?')[0]));
  for(const asset of required)assert.equal(createHash('sha256').update(await get(asset.url)).digest('hex'),asset.sha256,asset.url);
  assert.equal(createHash('sha256').update(await get('sw.js')).digest('hex'),createHash('sha256').update(readFileSync(dir+'/sw.js')).digest('hex'));
  console.log('Online release and critical resource hashes verified: '+release.id);process.exit(0);
 }catch(e){error=e;if(attempt<3)await new Promise(r=>setTimeout(r,5000));}
}
throw error;
