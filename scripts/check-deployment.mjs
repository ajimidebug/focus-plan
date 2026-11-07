import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkBundle} from './release-bundle.mjs';

export function checkLive({live,record,mode,currentSHA}) {
  assert(['publish','rollback'].includes(mode),'Unknown deployment mode');
  assert(/^[a-f0-9]{40}$/.test(live.sourceCommit),'Online source identity is missing');
  assert.equal(live.dataVersion,1,'Data compatibility needs a separate migration review');
  if(live.id===record.version)assert.equal(live.sourceCommit,record.sourceCommit,'A version number cannot identify different commits');
  if(mode==='rollback'){
    assert(/^[a-f0-9]{40}$/.test(currentSHA||''),'Rollback requires the approved current online SHA');
    assert.equal(live.sourceCommit,currentSHA,'Online version changed since rollback was approved');
  }
}
async function main(){
  const {SITE_URL:site,DEPLOY_MODE:mode,CURRENT_LIVE_SHA:currentSHA,GITHUB_REPOSITORY:repo,GITHUB_TOKEN:token}=process.env;
  const record=checkBundle('.release/candidate',{sha:process.env.EXPECTED_SHA,repo});
  const url=new URL('version.json',site.replace(/\/?$/,'/'));assert.equal(url.protocol,'https:');url.searchParams.set('verify',Date.now());
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  assert(response.ok,'Cannot confirm current online identity');checkLive({live:await response.json(),record,mode,currentSHA});
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
  const release=await fetch('https://api.github.com/repos/'+repo+'/releases/tags/app-v'+record.version,{headers,signal:AbortSignal.timeout(20000)});
  if(release.status!==404){
    assert(release.ok,'Cannot check archived version');const json=await release.json(),proof=json.assets.find(a=>a.name==='record.json');
    assert(proof,'Existing release has no verifiable record');
    const asset=await fetch('https://api.github.com/repos/'+repo+'/releases/assets/'+proof.id,{headers:{...headers,Accept:'application/octet-stream'},signal:AbortSignal.timeout(20000)});
    assert(asset.ok);const saved=await asset.json();assert.equal(saved.sourceCommit,record.sourceCommit);assert.equal(saved.treeDigest,record.treeDigest,'Version already archived with different bytes');
  }
  console.log('Online identity and version reuse checks passed.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
