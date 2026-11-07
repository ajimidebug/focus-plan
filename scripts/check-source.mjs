import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
import { validateGroups } from './test-browser.mjs';
const root = path.resolve(import.meta.dirname, '..');
for (const dir of ['js', 'scripts', 'public']) {
  for (const f of readdirSync(path.join(root, dir)).filter(f => /\.(js|mjs)$/.test(f) && f !== 'legacy-core.js' && f !== 'sw.template.js'))
    execFileSync(process.execPath, ['--check', path.join(root, dir, f)], { stdio: 'pipe' });
}
const p = JSON.parse(readFileSync(path.join(root, 'package.json'))), lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json')));
assert.equal(lock.version, p.version); assert.equal(lock.packages[''].version, p.version);
validateGroups();
for (const file of readdirSync(path.join(root,'.github/workflows')).filter(f=>/\.ya?ml$/.test(f))) {
 const document=parseDocument(readFileSync(path.join(root,'.github/workflows',file),'utf8'));
 assert.equal(document.errors.length,0,file+': invalid YAML');
}
console.log('Source syntax, version and browser groups verified (no files changed).');
