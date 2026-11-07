import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, createWriteStream, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
export const groups = JSON.parse(readFileSync(path.join(root, 'test/browser-groups.json')));
export function validateGroups(config = groups) {
  const files = Object.values(config).flat();
  assert.equal(new Set(files).size, files.length, 'Duplicate browser script');
  const expected = readdirSync(path.join(root, 'test')).filter(f => f === 'browser-smoke.mjs' || f.endsWith('.browser.cjs') && f !== 'task-workspace.browser.cjs').sort();
  assert.deepEqual([...files].sort(), expected, 'Every active browser script must be assigned exactly once');
  for (const f of files) assert(/^[\w.-]+\.(cjs|mjs)$/.test(f) && existsSync(path.join(root, 'test', f)));
  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'))).devDependencies.playwright, '1.57.0', 'Update pinned CI container with Playwright');
  assert.equal(require('playwright/package.json').version, '1.57.0', 'Installed Playwright does not match the pinned browser environment');
}
export function runChild(script, logPath, timeout = 120000) {
  return new Promise(resolve => {
    const started = Date.now(), output = createWriteStream(logPath);
    const child = spawn(process.execPath, [path.join(root, 'test', script)], {
      cwd: root, detached: process.platform !== 'win32', env: { ...process.env, FOCUS_TEST_ROOT: path.join(root, 'dist/spa') }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    let timedOut = false, cancelled = false;
    const kill = signal => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
    const onStop = () => { cancelled = true; kill('SIGKILL'); };
    process.once('SIGTERM', onStop); process.once('SIGINT', onStop);
    const timer = setTimeout(() => { timedOut = true; kill('SIGKILL'); }, timeout);
    child.on('error', error => output.write(String(error)));
    child.on('close', code => {
      clearTimeout(timer); kill('SIGKILL'); process.removeListener('SIGTERM', onStop); process.removeListener('SIGINT', onStop);
      output.end(() => resolve({ script, code, timedOut, cancelled, ms: Date.now() - started, passed: code === 0 && !timedOut && !cancelled }));
    });
  });
}
async function main() {
  validateGroups();
  const group = process.argv[2] || 'all';
  if (group === '--check') { console.log('Browser groups cover all active scripts exactly once.'); return; }
  const scripts = group === 'all' ? Object.values(groups).flat() : groups[group];
  assert(scripts, 'Unknown browser group');
  const resultDir = path.join(root, 'test-results'), reports = path.join(root, 'browser-results', group);
  mkdirSync(reports, { recursive: true });
  const results = [];
  for (const script of scripts) {
    rmSync(resultDir, { recursive: true, force: true }); mkdirSync(resultDir, { recursive: true });
    const dest = path.join(reports, script); rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true });
    const result = await runChild(script, path.join(dest, 'output.log'));
    if (existsSync(resultDir)) renameSync(resultDir, path.join(dest, 'artifacts'));
    results.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${script} ${(result.ms / 1000).toFixed(1)}s${result.timedOut ? ' (timeout)' : ''}`);
    if (!result.passed) console.error(readFileSync(path.join(dest, 'output.log'), 'utf8').slice(-6000));
    if (result.cancelled) break;
  }
  writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({ group, results }, null, 2) + '\n');
  if (results.some(r => !r.passed)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
