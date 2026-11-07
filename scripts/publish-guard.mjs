import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function validateCandidate({run,jobs,sha,repo,currentMain,rollback=false}) {
  assert(/^[a-f0-9]{40}$/.test(sha),'Full commit SHA required');
  assert.equal(run.repository?.full_name,repo);assert.equal(run.head_repository?.full_name,repo);
  assert.equal(run.head_sha,sha);assert.equal(run.head_branch,'main');
  assert.equal(run.path,'.github/workflows/validate.yml');assert.equal(run.event,'push');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert(jobs.some(j=>j.name==='Release verification'&&j.conclusion==='success'),'Missing verification gate');
  assert.deepEqual(jobs.filter(j=>j.name.startsWith('browser (')).map(j=>j.name).sort(),['browser (A)','browser (B)','browser (C)'],'Missing browser group');
  assert(jobs.every(j=>j.conclusion==='success'),'Incomplete checks');
  if(!rollback)assert.equal(sha,currentMain,'Stale candidate: main has advanced');
}
async function main(){
  const {GITHUB_TOKEN:token,GITHUB_REPOSITORY:repo,EXPECTED_SHA:sha,EXPECTED_RUN:runId}=process.env;
  assert(/^\d+$/.test(runId||''));assert(/^[\w.-]+\/[\w.-]+$/.test(repo||''));
  const get=async endpoint=>{const r=await fetch('https://api.github.com/repos/'+repo+'/'+endpoint,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});assert(r.ok,'GitHub read failed: '+r.status);return r.json();};
  const [run,jobPage,branch,artifacts]=await Promise.all([get('actions/runs/'+runId),get('actions/runs/'+runId+'/jobs?per_page=100'),get('branches/main'),get('actions/runs/'+runId+'/artifacts?per_page=100')]);
  assert.equal(jobPage.total_count,jobPage.jobs.length,'Jobs truncated');
  validateCandidate({run,jobs:jobPage.jobs,sha,repo,currentMain:branch.commit.sha});
  const candidates=artifacts.artifacts.filter(x=>x.name==='candidate-spa'&&!x.expired);assert.equal(candidates.length,1,'Missing/ambiguous candidate');
  const artifact=candidates[0];assert.equal(artifact.workflow_run?.head_sha,sha);
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'artifact_id='+artifact.id+'\n');
  writeFileSync('.release/provenance.json',JSON.stringify({sha,runId,artifactId:artifact.id},null,2));
  console.log('Verified successful main run and exact candidate artifact.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
