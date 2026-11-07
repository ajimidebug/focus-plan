import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {checkBundle} from './release-bundle.mjs';
const {GITHUB_TOKEN:token,GITHUB_REPOSITORY:repo,EXPECTED_SHA:sha}=process.env;
assert(/^[\w.-]+\/[\w.-]+$/.test(repo));assert(/^[a-f0-9]{40}$/.test(sha));
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
const api='https://api.github.com/repos/'+repo+'/';
async function request(url,options={}){const r=await fetch(url,{...options,headers:{...headers,...options.headers}});assert(r.ok,'GitHub archive request failed: '+r.status);return r;}
const [mode,tagInput]=process.argv.slice(2);
mkdirSync('.release',{recursive:true});
if(mode==='restore'){
 assert(/^app-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tagInput||''));
 assert.equal(process.env.DATA_COMPATIBLE,'true','Rollback requires explicit data compatibility confirmation');
 const release=await (await request(api+'releases/tags/'+tagInput)).json();assert(!release.draft&&!release.prerelease,'Only successful archived releases can be restored');
 const asset=release.assets.find(a=>a.name==='site.tar.gz'),proof=release.assets.find(a=>a.name==='site.sha256');assert(asset&&proof);
 const download=async a=>Buffer.from(await (await request(api+'releases/assets/'+a.id,{headers:{Accept:'application/octet-stream'}})).arrayBuffer());
 const [bytes,digest]=await Promise.all([download(asset),download(proof)]);assert.equal(createHash('sha256').update(bytes).digest('hex'),digest.toString().trim());
 writeFileSync('.release/site.tar.gz',bytes);
 const entries=execFileSync('tar',['-tzf','.release/site.tar.gz'],{encoding:'utf8'}).trim().split('\n');
 assert(entries.every(p=>!p.startsWith('/')&&!p.split('/').includes('..')&&(p==='record.json'||p==='site/'||p.startsWith('site/'))),'Unsafe archive paths');
 const listing=execFileSync('tar',['-tvzf','.release/site.tar.gz'],{encoding:'utf8'}).trim().split('\n');assert(listing.every(l=>l[0]==='-'||l[0]==='d'),'Archive links are forbidden');
 mkdirSync('.release/candidate',{recursive:true});execFileSync('tar',['-xzf','.release/site.tar.gz','-C','.release/candidate']);
 const record=checkBundle('.release/candidate',{sha,repo});assert.equal(tagInput,'app-v'+record.version);
 console.log('Restored previously published archive; personal browser data is not modified.');
}else{
 assert.equal(mode,'save');const record=checkBundle('.release/candidate',{sha,repo}),tag='app-v'+record.version;
 execFileSync('tar',['--sort=name','--mtime=1970-01-01','--owner=0','--group=0','--numeric-owner','-czf','.release/site.tar.gz','-C','.release/candidate','record.json','site']);
 const bytes=readFileSync('.release/site.tar.gz'),digest=createHash('sha256').update(bytes).digest('hex');
 let release;const existing=await fetch(api+'releases/tags/'+tag,{headers});
 if(existing.ok){release=await existing.json();const proof=release.assets.find(a=>a.name==='record.json');assert(proof,'Existing archive incomplete; inspect instead of overwriting');const saved=JSON.parse(await (await request(api+'releases/assets/'+proof.id,{headers:{Accept:'application/octet-stream'}})).text());assert.equal(saved.sourceCommit,sha);assert.equal(saved.treeDigest,record.treeDigest);
  if(!release.draft){
   const archive=release.assets.find(a=>a.name==='site.tar.gz'),checksum=release.assets.find(a=>a.name==='site.sha256');assert(archive&&checksum,'Published archive incomplete');
   const download=async a=>Buffer.from(await (await request(api+'releases/assets/'+a.id,{headers:{Accept:'application/octet-stream'}})).arrayBuffer());
   const [archived,expected]=await Promise.all([download(archive),download(checksum)]);
   assert.equal(createHash('sha256').update(archived).digest('hex'),expected.toString().trim(),'Existing archive checksum failed');
   console.log('Matching successful release already archived; original provenance retained.');process.exit(0);
  }
 }
 else {assert.equal(existing.status,404);release=await (await request(api+'releases',{method:'POST',body:JSON.stringify({tag_name:tag,target_commitish:sha,name:record.version,body:'Verified source: '+sha+'\nValidation run: '+record.runId+'\nSite digest: '+record.treeDigest,draft:true}),headers:{'Content-Type':'application/json'}})).json();}
 const uploads=[['record.json',Buffer.from(JSON.stringify(record,null,2)+'\n'),'application/json'],['site.tar.gz',bytes,'application/gzip'],['site.sha256',Buffer.from(digest+'\n'),'text/plain']];
 for(const [name,body,type] of uploads){
  const old=release.assets?.find(a=>a.name===name);
  if(old){const previous=Buffer.from(await (await request(api+'releases/assets/'+old.id,{headers:{Accept:'application/octet-stream'}})).arrayBuffer());assert(previous.equals(body),'Existing archive differs: '+name);continue;}
  await request(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(name),{method:'POST',body,headers:{'Content-Type':type}});
 }
 await request(api+'releases/'+release.id,{method:'PATCH',body:JSON.stringify({draft:false}),headers:{'Content-Type':'application/json'}});
 console.log('Archived verified site: '+tag);
}
