// Explicit version edit only. Checks/builds never rewrite tracked source.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),version=process.argv[2];
assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version||''),'Usage: npm run release:version -- 175.7.0');
for(const file of ['package.json','package-lock.json']){
  const p=path.join(root,file),obj=JSON.parse(readFileSync(p));obj.version=version;
  if(obj.packages)obj.packages[''].version=version;
  writeFileSync(p,JSON.stringify(obj,null,2)+'\n');
}
console.log('Version set to '+version+'. Build generates manifest and worker in dist/spa only.');
