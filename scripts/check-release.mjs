import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
export function verifyRelease(directory, expected = {}) {
  const root = path.resolve(directory), read = f => readFileSync(path.join(root, f));
  const metadata = JSON.parse(read('version.json'));
  assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.id), 'Invalid version');
  assert(/^[0-9a-f]{40}$/.test(metadata.sourceCommit), 'Missing source commit');
  assert.equal(metadata.dataVersion, 1);
  if (expected.version) assert.equal(metadata.id, expected.version);
  if (expected.sha) assert.equal(metadata.sourceCommit, expected.sha);
  const seen = new Set();
  for (const { url, sha256 } of metadata.assets) {
    assert(typeof url === 'string' && url.startsWith('./') && url.endsWith('?v=' + metadata.id), 'Invalid asset URL');
    const file = url.slice(2).split('?')[0];
    assert(!file.includes('..') && !file.includes('\\') && !file.startsWith('/') && !seen.has(file), 'Unsafe/duplicate asset');
    assert(!['sw.js', 'version.json'].includes(file)); seen.add(file);
    assert.equal(createHash('sha256').update(read(file)).digest('hex'), sha256, file);
  }
  const walk = dir => readdirSync(dir).flatMap(name => { const f = path.join(dir, name), stat = lstatSync(f); assert(!stat.isSymbolicLink(), 'No symlinks in release'); return stat.isDirectory() ? walk(f) : [path.relative(root, f).split(path.sep).join('/')]; });
  assert.deepEqual([...seen].sort(), walk(root).filter(f => !['sw.js', 'version.json'].includes(f)).sort(), 'Manifest must cover every deployed file');
  for (const f of ['index.html', 'legacy-core.js', 'recovery.html', 'recovery.js', metadata.rollback]) assert(seen.has(f), 'Missing ' + f);
  assert(read('index.html').toString().includes("window.__RELEASE = '" + metadata.id + "'"), 'HTML version mismatch');
  const worker = read('sw.js').toString();
  assert(worker.includes("const RELEASE = '" + metadata.id + "'"));
  const embedded = worker.match(/const ASSETS = ([\s\S]*?);\s*const PREFIX/);
  assert(embedded); assert.deepEqual(JSON.parse(embedded[1]), metadata.assets, 'Worker manifest mismatch');
  return metadata;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = verifyRelease(process.argv[2] || 'dist/spa', { sha: process.env.EXPECTED_SHA, version: process.env.EXPECTED_VERSION });
  console.log(`Verified ${metadata.id} (${metadata.sourceCommit.slice(0, 7)}): ${metadata.assets.length} assets.`);
}
