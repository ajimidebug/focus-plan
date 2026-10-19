import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || new Date().toISOString().replace(/[-:TZ.]/g, '');
if (!/^[a-zA-Z0-9.-]+$/.test(id)) throw new Error('Invalid release id');
const read = f => readFileSync(path.join(root, f), 'utf8');
const write = (f, text) => {
  const old = readFileSync(path.join(root, f), 'utf8');
  const endings = [...old.matchAll(/\r\n|\n/g)].map(m => m[0]);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result = lines.map((line, i) => line + (i < lines.length - 1 ? (endings[i] || '\n') : '')).join('');
  writeFileSync(path.join(root, f), result);
};
const scripts = readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
for (const f of ['index.html', ...scripts]) write(f, read(f).replace(/\?v=[a-zA-Z0-9.-]+/g, '?v=' + id));
write('index.html', read('index.html').replace(/window\.__RELEASE\s*=\s*'[^']*'/, "window.__RELEASE = '" + id + "'"));
const files = ['index.html', 'version.html', 'css/style.css', 'css/katex.css', ...scripts, 'manifest.webmanifest', 'icon.svg'];
// 头像属于非核心装饰资源，不把其下载成败作为应用升级条件。
const assets = files.map(file => ({ url: './' + file + '?v=' + id, sha256: createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex') }));
const worker = read('scripts/sw.template.js').replace('__RELEASE__', id).replace('__ASSETS__', JSON.stringify(assets, null, 2));
write('sw.js', worker);
writeFileSync(path.join(root, 'version.json'), JSON.stringify({ id, dataVersion: 1, releasedAt: new Date().toISOString(), assets }, null, 2) + '\n');
console.log('Prepared release ' + id + ' (' + assets.length + ' checked resources)');
