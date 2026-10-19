import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(readFileSync(path.join(root, 'version.json')));
for (const { url, sha256 } of metadata.assets) {
  assert.equal(createHash('sha256').update(readFileSync(path.join(root, url.slice(2).split('?')[0]))).digest('hex'), sha256, '资源未准备发布：' + url);
}
for (const f of readdirSync(path.join(root, 'js')).filter(x => x.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(root, 'js', f)], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', path.join(root, 'sw.js')], { stdio: 'pipe' });
execFileSync(process.execPath, ['--test', 'test/release-safety.test.cjs'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['test/test-store.js'], { cwd: root, stdio: 'inherit' });
console.log('发布 ' + metadata.id + ' 的资源、脚本、数据和更新检查通过。');
