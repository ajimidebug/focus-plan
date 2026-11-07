import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { verifyRelease } from './check-release.mjs';
export function treeDigest(dir) {
  const root=path.resolve(dir),walk=p=>readdirSync(p).sort().flatMap(n=>{const f=path.join(p,n),s=lstatSync(f);assert(!s.isSymbolicLink());return s.isDirectory()?walk(f):[[path.relative(root,f).split(path.sep).join('/'),createHash('sha256').update(readFileSync(f)).digest('hex')]];});
  return createHash('sha256').update(JSON.stringify(walk(root))).digest('hex');
}
export function checkBundle(dir,expected={}){
  const record=JSON.parse(readFileSync(path.join(dir,'record.json')));
  assert.equal(record.format,1);assert(/^[a-f0-9]{64}$/.test(record.treeDigest));
  if(expected.sha)assert.equal(record.sourceCommit,expected.sha);
  if(expected.run)assert.equal(String(record.runId),String(expected.run));
  if(expected.repo)assert.equal(record.repository,expected.repo);
  assert.equal(treeDigest(path.join(dir,'site')),record.treeDigest,'Candidate contents changed');
  verifyRelease(path.join(dir,'site'),{sha:record.sourceCommit,version:record.version});return record;
}
export function createBundle(source,dest){
  const release=verifyRelease(source),sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(release.sourceCommit,sha,'Build must belong to checked out commit');
  const version=JSON.parse(readFileSync('package.json')).version;assert.equal(release.id,version);
  rmSync(dest,{recursive:true,force:true});mkdirSync(dest,{recursive:true});cpSync(source,path.join(dest,'site'),{recursive:true});
  const record={format:1,version,sourceCommit:sha,repository:process.env.GITHUB_REPOSITORY||'local',runId:process.env.GITHUB_RUN_ID||null,runAttempt:process.env.GITHUB_RUN_ATTEMPT||null,treeDigest:treeDigest(path.join(dest,'site'))};
  writeFileSync(path.join(dest,'record.json'),JSON.stringify(record,null,2)+'\n');return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,dir='.release/candidate']=process.argv.slice(2);
 assert(['create','check'].includes(mode),'Expected create or check');
 const r=mode==='create'?createBundle('dist/spa',dir):checkBundle(dir,{sha:process.env.EXPECTED_SHA,run:process.env.EXPECTED_RUN,repo:process.env.GITHUB_REPOSITORY});
 console.log(JSON.stringify(r));
}
