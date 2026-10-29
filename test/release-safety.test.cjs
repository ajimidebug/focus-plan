'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const copy = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
function data(extra = {}) { return { version: 1, settings: {}, days: { '2026-10-18': { tasks: { required: [{ id: 'stable-task', text: 'test' }], ideal: [], extra: [] }, timeline: [{ id: 'stable-event', minutes: 35 }], sessions: [] } }, ledger: [], ...extra }; }
function browser({ initial = data(), localFails = false, idbFails = false, mirror = null, delay = 0, shared = null } = {}) {
  const mem = shared?.mem || new Map(initial === null ? [] : [['focusPlanData.v1', JSON.stringify(initial)]]);
  const databases = shared?.databases || new Map(mirror ? [['focus-plan', new Map([['data', copy(mirror)]])]] : []);
  const options = { localFails, idbFails };
  let writes = 0;
  const ctx = { console, Date, Math, JSON, Promise, Blob, URL, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.localStorage = { getItem: k => mem.get(k) ?? null, setItem(k, v) { if (options.localFails) throw new Error('quota'); writes++; mem.set(k, String(v)); }, removeItem(k) { mem.delete(k); } };
  ctx.indexedDB = { open(name) {
    const request = {};
    setTimeout(() => {
      if (options.idbFails) { request.error = new Error('idb unavailable'); request.onerror?.(); return; }
      if (!databases.has(name)) databases.set(name, new Map());
      const values = databases.get(name);
      const db = { objectStoreNames: { contains: () => true }, createObjectStore() {}, close() {}, transaction() {
        const tx = {};
        tx.objectStore = storeName => {
          let store = values;
          if (storeName === 'meta' || storeName === 'body') {
            const key = '__store:' + storeName; if (!values.has(key)) values.set(key, new Map()); store = values.get(key);
          }
          return ({
          get(k) { const rq = {}; setTimeout(() => { rq.result = copy(store.get(k)); rq.onsuccess?.(); tx.oncomplete?.(); }, delay); return rq; },
          put(v, k) { setTimeout(() => { if (options.idbFails) { tx.error = new Error('write failure'); tx.onerror?.(); } else { store.set(k === undefined ? v.id : k, copy(v)); tx.oncomplete?.(); } }, delay); },
          getAll() { const rq = {}; setTimeout(() => { rq.result = [...store.values()].map(copy); rq.onsuccess?.(); tx.oncomplete?.(); }, delay); return rq; },
          delete(k) { store.delete(k); setTimeout(() => tx.oncomplete?.(), delay); }
        }); }; return tx;
      } };
      request.result = db; request.onsuccess?.();
    }, 0); return request;
  } };
  vm.runInNewContext(source('js/store.js'), ctx);
  return { ctx, S: ctx.App.store, mem, databases, options, writes: () => writes };
}
test('existing v1 task/event identities survive load, save and a new program instance', async () => {
  const b = browser(); assert.equal(await b.S.load(), true);
  assert.equal(b.S.getDay('2026-10-18').tasks.required[0].id, 'stable-task');
  b.S.getDay('2026-10-18').timeline[0].minutes = 42;
  assert.equal(await b.S.save(), true);
  const next = browser({ shared: b }); await next.S.load();
  assert.equal(next.S.getDay('2026-10-18').timeline[0].id, 'stable-event');
  assert.equal(next.S.getDay('2026-10-18').timeline[0].minutes, 42);
});
test('unknown local or mirror schema never replaces old data with defaults', async () => {
  for (const mode of ['local', 'mirror']) {
    const b = browser(mode === 'local' ? { initial: data({ version: 2 }) } : { mirror: data({ version: 2 }) });
    const before = b.mem.get('focusPlanData.v1');
    assert.equal(await b.S.load(), false); assert.equal(b.S.status().readOnly, true);
    assert.equal(await b.S.save(), false); assert.equal(b.mem.get('focusPlanData.v1'), before); assert.equal(b.writes(), 0);
  }
});
test('delayed mirror hydration finishes before app data may be saved', async () => {
  const b = browser({ initial: null, mirror: data(), delay: 20 });
  const loading = b.S.load(); assert.equal(await b.S.save(), false); assert.equal(b.writes(), 0);
  assert.equal(await loading, true); assert.equal(b.S.getDay('2026-10-18').timeline[0].id, 'stable-event');
});
test('newer mirror is recovered when quota failure left an older primary', async () => {
  const b = browser(); await b.S.load(); b.options.localFails = true;
  b.S.data().queue.push({ id: 'new-only-in-mirror' }); assert.equal(await b.S.save(), true);
  assert.equal(b.S.status().phase, 'warning');
  const next = browser({ shared: b }); await next.S.load(); assert.equal(next.S.data().queue[0].id, 'new-only-in-mirror');
});
test('failure of both storage channels is visible and disallows safe refresh', async () => {
  const b = browser(); await b.S.load(); b.options.localFails = b.options.idbFails = true;
  assert.equal(await b.S.save(), false); assert.equal(await b.S.flush(), false); assert.equal(b.S.status().phase, 'error');
});
test('invalid imports preserve records; an older tab cannot overwrite a newer revision', async () => {
  const b = browser(); await b.S.load(); const before = JSON.stringify(b.S.data());
  assert.equal(b.S.importJSON('{"version":2,"days":{}}'), false); assert.equal(JSON.stringify(b.S.data()), before);
  b.mem.set('focusPlanData.v1', JSON.stringify(data({ _storageRevision: 50 })));
  assert.equal(await b.S.save(), false); assert.equal(b.S.status().readOnly, true);
});
test('corrupt primary and unavailable mirror do not initialise empty records', async () => {
  const b = browser({ idbFails: true }); b.mem.set('focusPlanData.v1', '{broken');
  assert.equal(await b.S.load(), false); assert.equal(b.mem.get('focusPlanData.v1'), '{broken');
});
test('fresh storage initialises normally only after both sources are checked', async () => {
  const b = browser({ initial: null }); assert.equal(await b.S.load(), true); assert.equal(b.S.status().phase, 'saved');
  assert.equal(JSON.parse(b.mem.get('focusPlanData.v1')).version, 1);
});
function backupHarness() {
  const messages = [], confirmations = [];
  const ctx = { window: null, console, crypto: webcrypto, TextEncoder, Date, JSON, setTimeout, clearTimeout, App: {
    store: { validate: d => d?.version === 1 && d.days && d.settings && Array.isArray(d.ledger) },
    memcards: { readyPhotos: async () => {}, allPhotos: () => ({}) },
    ui: { toast: msg => messages.push(msg), confirm: (...args) => confirmations.push(args) }
  } }; ctx.window = ctx; vm.runInNewContext(source('js/backup.js'), ctx);
  return { B: ctx.App.backup, messages, confirmations };
}
test('complete backup includes exact image bytes and digest; missing image stops export', async () => {
  const { B } = backupHarness(); const d = data({ memcards: [{ cards: [{ frontImgs: ['p1'] }] }] });
  const photos = { p1: 'data:image/jpeg;base64,VEVTVA==' };
  const text = await B.packText(d, photos), obj = JSON.parse(text);
  assert.equal(obj.photos.p1, photos.p1); assert.equal(obj.data.memcards[0].cards[0].frontImgs[0], 'p1');
  assert.equal(obj.sha256, createHash('sha256').update(JSON.stringify({ data: obj.data, photos: obj.photos })).digest('hex'));
  await assert.rejects(B.packText(d, {}), /缺失/);
});
test('tampered backup is rejected before offering to overwrite data', async () => {
  const { B, confirmations } = backupHarness(); const pack = JSON.parse(await B.packText(data(), {}));
  pack.data.queue = [{ id: 'tamper' }]; assert.equal(await B.importFromText(JSON.stringify(pack), 'tampered.json'), false);
  assert.equal(confirmations.length, 0);
});
function workerHarness({ bad = '', clients = 1 } = {}) {
  const listeners = {}, values = new Map(), deleted = [], network = [];
  let skipped = 0, claimed = 0;
  const ctx = { console, URL, Response, Request, Uint8Array, Map, Promise, crypto: webcrypto };
  const getCache = name => {
    if (!values.has(name)) values.set(name, new Map()); const m = values.get(name);
    return { put: async (u, r) => m.set(u, r.clone()), match: async u => m.get(u)?.clone() };
  };
  ctx.caches = { open: async n => getCache(n), keys: async () => [...values.keys()], delete: async n => { deleted.push(n); return values.delete(n); } };
  ctx.self = { registration: { scope: 'https://example.test/focus-plan/' }, addEventListener: (t, fn) => listeners[t] = fn,
    skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; }, matchAll: async () => Array.from({ length: clients }, () => ({ url: 'https://example.test/focus-plan/' })) } };
  ctx.fetch = async url => {
    network.push(url); const p = new URL(url).pathname.replace('/focus-plan/', '');
    if (p === bad) return new Response('missing', { status: 404 });
    return new Response(fs.readFileSync(path.join(root, p)));
  };
  vm.runInNewContext(source('sw.js'), ctx);
  const invoke = async (event, extras = {}) => { let pending; listeners[event]({ waitUntil: p => pending = p, ...extras }); await pending; };
  return { ctx, listeners, values, deleted, network, invoke, skipped: () => skipped, claimed: () => claimed };
}
test('worker installs the complete release without forcing activation', async () => {
  const w = workerHarness(); await w.invoke('install'); assert.equal(w.skipped(), 0);
  assert.equal([...w.values.values()][0].size, JSON.parse(source('version.json')).assets.length);
});
test('a missing core resource rejects the new release and leaves other caches intact', async () => {
  const w = workerHarness({ bad: 'js/store.js' }); w.values.set('other-app', new Map());
  await assert.rejects(w.invoke('install'), /Incomplete release/); assert.equal(w.skipped(), 0); assert(w.values.has('other-app'));
});
test('activation cleans only this app namespace, never records or unrelated caches', async () => {
  const w = workerHarness(); w.values.set('other-app', new Map()); w.values.set('focus-plan-app:/focus-plan/:old', new Map());
  await w.invoke('install'); await w.invoke('activate'); assert(w.values.has('other-app')); assert.equal(w.claimed(), 1);
  assert.deepEqual(w.deleted, ['focus-plan-app:/focus-plan/:old']);
});
test('multiple app tabs postpone activation', async () => {
  const w = workerHarness({ clients: 2 }); let message;
  await w.invoke('message', { data: { type: 'ACTIVATE_RELEASE' }, source: { postMessage: x => message = x } });
  assert.equal(w.skipped(), 0); assert.equal(message.type, 'UPDATE_BLOCKED');
});
test('offline navigation uses the current complete shell; version checks bypass caching', async () => {
  const w = workerHarness(); await w.invoke('install'); let response;
  w.listeners.fetch({ request: { url: 'https://example.test/focus-plan/', method: 'GET', mode: 'navigate' }, respondWith: p => response = p });
  assert((await (await response).text()).includes('window.__RELEASE'));
  let intercepted = false;
  w.listeners.fetch({ request: { url: 'https://example.test/focus-plan/version.json?check=1', method: 'GET', mode: 'cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});
test('published manifest hashes match actual source bytes and all app scripts use release URLs', () => {
  const release = JSON.parse(source('version.json'));
  for (const asset of release.assets) {
    const file = asset.url.slice(2).split('?')[0];
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), asset.sha256, file);
  }
  for (const m of source('index.html').matchAll(/<script src="([^"]+)"/g)) assert(m[1].endsWith('?v=' + release.id), m[1]);
  assert(!source('index.html').includes('controllerchange')); assert(!source('js/link.js').includes('api.siliconflow.cn'));
});
function updatesHarness(b) {
  const elements = new Map(), events = {}, posted = [];
  for (const id of ['storage-status', 'release-status', 'apply-update', 'check-update']) elements.set(id, { dataset: {} });
  const reg = { waiting: null, installing: null, update: async () => {}, addEventListener() {} };
  Object.assign(b.ctx, {
    __RELEASE: JSON.parse(source('version.json')).id,
    document: { hidden: false, getElementById: id => elements.get(id), querySelector: () => null, addEventListener: (t, f) => events[t] = f },
    navigator: { serviceWorker: { addEventListener() {}, register: async () => reg } },
    setInterval() {}, fetch: async () => ({ ok: true, json: async () => ({ id: b.ctx.__RELEASE }) }), addEventListener() {}
  });
  b.ctx.App.tasks = { getTimer: () => null, getCdTimer: () => null, saveTimerSnap() {} };
  b.ctx.App.memcards = { readyPhotos: async () => {}, flushPhotos: async () => true };
  b.ctx.App.backup = { snap: async () => ({ id: 'snapshot' }) };
  vm.runInNewContext(source('js/updates.js'), b.ctx);
  const U = b.ctx.App.updates;
  U.init(); U.appReady();
  return { U, reg, events, posted, elements, waiting: () => { reg.waiting = { postMessage: x => posted.push(x) }; } };
}
test('updater postpones running timers and edited input; no activation message is sent', async () => {
  const b = browser(); await b.S.load(); const u = updatesHarness(b); await new Promise(r => setImmediate(r)); u.waiting();
  b.ctx.App.tasks.getTimer = () => ({ startedAt: Date.now() });
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
  b.ctx.App.tasks.getTimer = () => null;
  u.events.input({ target: { matches: () => true, isConnected: true } });
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
});
test('updater refuses to activate when image persistence or snapshot fails', async () => {
  const b = browser(); await b.S.load(); const u = updatesHarness(b); await new Promise(r => setImmediate(r)); u.waiting();
  b.ctx.App.memcards.flushPhotos = async () => false;
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
  b.ctx.App.memcards.flushPhotos = async () => true; b.ctx.App.backup.snap = async () => null;
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
});
test('updater sends activation only after main data, images and snapshot finish', async () => {
  const b = browser(); await b.S.load(); const u = updatesHarness(b); await new Promise(r => setImmediate(r)); u.waiting();
  let photoDone = false, snapshotDone = false;
  b.ctx.App.memcards.flushPhotos = async () => { await new Promise(r => setTimeout(r, 10)); photoDone = true; return true; };
  b.ctx.App.backup.snap = async () => { assert(photoDone); snapshotDone = true; return { id: 'saved' }; };
  assert.equal(await u.U.apply(true), true); assert(snapshotDone); assert.equal(u.posted[0].type, 'ACTIVATE_RELEASE');
});
test('real photo store and complete backup restore task IDs and image bytes before reload', async () => {
  const b = browser(); await b.S.load(); const confirmations = [], messages = [];
  b.ctx.crypto = webcrypto; b.ctx.TextEncoder = TextEncoder;
  b.ctx.document = { getElementById: () => null };
  b.ctx.App.ui = { toast: m => messages.push(m), confirm: (...args) => confirmations.push(args) };
  b.ctx.location = { reload() {} }; b.ctx.setTimeout = (fn, ms) => ms === 700 ? 0 : setTimeout(fn, ms);
  vm.runInNewContext(source('js/memcards.js'), b.ctx);
  vm.runInNewContext(source('js/backup.js'), b.ctx);
  const C = b.ctx.App.memcards, B = b.ctx.App.backup;
  await C.readyPhotos();
  const image = 'data:image/jpeg;base64,VEVTVA==';
  await C.phPut('round-trip-image', image); assert.equal(await C.flushPhotos(), true);
  b.S.data().memcards = [{ cards: [{ id: 'round-trip-card', frontImgs: ['round-trip-image'] }] }];
  await b.S.save(); const packed = await B.exportCurrentText();
  b.S.reset(); await b.S.flush(); await C.phDel('round-trip-image'); await C.flushPhotos();
  assert.equal(await B.importFromText(packed, 'complete.json'), true);
  await confirmations[0][2]();
  assert.equal(b.S.data().memcards[0].cards[0].id, 'round-trip-card');
  assert.equal(b.S.getDay('2026-10-18').tasks.required[0].id, 'stable-task');
  assert.equal(C.phGet('round-trip-image'), image);
  assert(!messages.some(x => x.includes('未完成')));
});

function memoHarness(b) { vm.runInNewContext(source('js/memo.js'), b.ctx); return b.ctx.App.memoCore; }
test('memo user-day uses Shanghai 04:00 across midnight, month boundaries and device zones', async () => {
  const b = browser(); await b.S.load(); const M = memoHarness(b);
  for (const [at, expected] of [
    ['2026-10-19T19:59:00Z', '2026-10-19'],
    ['2026-10-19T20:00:00Z', '2026-10-20'],
    ['2026-10-18T16:01:00Z', '2026-10-18'],
    ['2026-02-28T19:59:00Z', '2026-02-28'],
    ['2026-12-31T20:00:00Z', '2027-01-01']
  ]) assert.equal(M.userDay(at), expected);
  assert.equal(M.clock('2026-10-19T08:55:00Z'), '16:55');
  assert.equal(M.validDate('2026-02-30'), false);
});
test('memo preserves exact multiline raw words and revisions without parsing plans or counting minutes', async () => {
  const b = browser(); await b.S.load(); const M = memoHarness(b);
  const raw = '1055坐下来\n1103打开线性代数，打算继续二次型\n大概半小时？\n次日0120还没睡\n<script>test</script>\n';
  const n = M.write('2026-10-19', raw, '2026-10-19T09:00:00Z');
  const id = n.id; assert.equal(n.text, raw); assert.equal(n.revision, 1);
  M.write('2026-10-19', raw); assert.equal(M.read('2026-10-19').revision, 1);
  M.write('2026-10-19', raw + '更正：时间待核', '2026-10-19T10:00:00Z');
  assert.equal(M.read('2026-10-19').id, id); assert.equal(M.read('2026-10-19').revision, 2);
  assert.equal(b.S.getDay('2026-10-18').timeline.length, 1);
  await b.S.save(); const next = browser({ shared: b }); await next.S.load();
  assert.equal(memoHarness(next).read('2026-10-19').text, raw + '更正：时间待核');
});
test('memo history filters by original text and exports all selected days with identity, revisions and raw text', async () => {
  const b = browser(); await b.S.load(); const M = memoHarness(b);
  M.write('2026-10-18', '英语 TEST\n原话'); M.write('2026-10-19', '数学\n计划明天看');
  assert.equal(M.entries('test').join(','), '2026-10-18');
  assert.equal(M.entries('', '2026-10-19', '2026-10-19').join(','), '2026-10-19');
  const text = M.exportText(M.entries());
  assert(text.indexOf('用户日 2026-10-18') < text.indexOf('用户日 2026-10-19'));
  assert(text.includes('英语 TEST\n原话')); assert(text.includes('计划明天看')); assert(text.includes('修订：1'));
  assert(text.includes('不等于事件时间')); assert(text.includes('不代表已发送'));
});
test('memo additive data and untouched legacy records survive complete backup and restore', async () => {
  const b = browser(); await b.S.load(); const M = memoHarness(b);
  M.write('2026-10-19', 'MEMO-BACKUP-TEST\n1055开始'); await b.S.save();
  const packed = JSON.parse(await backupHarness().B.packText(b.S.data(), {}));
  const oldId = M.read('2026-10-19').id;
  b.S.reset(); await b.S.flush(); assert.equal(b.S.restoreFrom(packed.data), true); await b.S.flush();
  assert.equal(M.read('2026-10-19').id, oldId); assert.equal(M.read('2026-10-19').text, 'MEMO-BACKUP-TEST\n1055开始');
  assert.equal(b.S.getDay('2026-10-18').tasks.required[0].id, 'stable-task');
  assert.equal(b.S.getDay('2026-10-18').timeline[0].id, 'stable-event');
  assert.equal(b.S.data().version, 1);
});
test('memo refuses malformed note data and storage protection without discarding unknown original fields', async () => {
  const b = browser({ initial: data({ memoNotes: 'future-format' }) });
  assert.equal(await b.S.load(), false, 'unknown note structure must block before first write');
  assert.equal(JSON.parse(b.mem.get('focusPlanData.v1')).memoNotes, 'future-format');
  const c = browser(); await c.S.load(); const C = memoHarness(c);
  c.mem.set('focusPlanData.v1', JSON.stringify(data({ _storageRevision: 100 })));
  await c.S.save(); assert.throws(() => C.write('2026-10-19', 'new'), /保护/);
  assert.equal(c.S.data().memoNotes, undefined);
});
test('memo updater blocks unflushed notes and awaits memo flush before activating', async () => {
  const b = browser(); await b.S.load(); const u = updatesHarness(b); await new Promise(r => setImmediate(r)); u.waiting();
  b.ctx.App.memo = { busy: () => true, flush: async () => false };
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
  b.ctx.App.memo.busy = () => false;
  assert.equal(await u.U.apply(true), false); assert.equal(u.posted.length, 0);
  b.ctx.App.memo.flush = async () => true;
  assert.equal(await u.U.apply(true), true); assert.equal(u.posted.length, 1);
});

function actionHarness(b) {
  memoHarness(b);
  vm.runInNewContext(source('js/memo-editor.js'), b.ctx);
  vm.runInNewContext(source('js/memo-actions.js'), b.ctx);
  b.ctx.App.memo.flush = async () => b.S.flush();
  b.ctx.App.checkin = { memoPoints: (it, day) => Math.max(0, Number(it.points) || 0) * (day === '2026-10-19' ? 2 : 1) };
  return { A: b.ctx.App.memoActions, M: b.ctx.App.memoCore, E: b.ctx.App.memoEditor };
}
const actionAt = '2026-10-19T09:52:00.000Z';
test('queue completion and exact undo survive reload, text editing, repricing and renaming', async () => {
  const b = browser(); await b.S.load(); const { A, M, E } = actionHarness(b);
  M.write('2026-10-19', '1055坐下来\n打算背英语');
  b.S.data().queue = [{ id: 'q1', text: '环工3-3初背', points: 7 }, { id: 'q2', text: '后面这条' }];
  const event = A.completeCore({ kind: 'queue', id: 'q1', title: '环工3-3初背' }, '1752【任务勾选】环工3-3初背', actionAt);
  assert.equal(b.S.pointsTotal(), 7); assert.equal(b.S.data().queue[0].id, 'q2');
  let blocks = M.segments(M.read('2026-10-19'));
  const pos = M.read('2026-10-19').text.indexOf('环工3-3初背');
  blocks = E.splice(blocks, pos, pos + 8, '改写任务\n另补一句');
  blocks.push({ id: 'handwritten', text: '\n1800这是独立手写说明' });
  M.write('2026-10-19', E.textOf(blocks), actionAt, blocks);
  b.S.data().queueDone[0].text = '后来改名'; b.S.data().queueDone[0].points = 99;
  b.S.data().ledger.push({ id: 'manual', points: 3, type: 'adjust' });
  await b.S.save();
  const c = browser({ shared: b }); await c.S.load(); const h = actionHarness(c);
  assert(h.A.passage(h.A.latest('queue', 'q1')).includes('另补一句'));
  h.A.undoCore(event.id);
  assert.equal(c.S.pointsTotal(), 3); assert.equal(c.S.data().queue[0].id, 'q1');
  assert.equal(h.M.read('2026-10-19').text, '1055坐下来\n打算背英语\n1800这是独立手写说明');
  assert(!c.S.data().ledger.some(l => l.memoEventId === event.id));
});
test('blank completion has points and state, but no passage; empty undo writes no cancellation', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  M.write('2026-10-19', '原话'); b.S.data().queue = [{ id: 'q1', text: '任务', points: 0 }];
  const e = A.completeCore({ kind: 'queue', id: 'q1', title: '任务' }, '', actionAt);
  assert.equal(A.passage(e), ''); assert.equal(b.S.data().queue.length, 0); assert.equal(b.S.pointsTotal(), 0);
  A.undoCore(e.id, '', actionAt); assert.equal(M.read('2026-10-19').text, '原话');
});
test('repeat habit punches retain individual amounts and cancel just the selected occurrence', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  b.S.data().checkins = [{ id: 'h1', text: '喝水', points: 5, target: 3, days: {} }];
  const one = A.completeCore({ kind: 'checkin', id: 'h1', day: '2026-10-19', title: '喝水' }, '第一笔', actionAt);
  b.S.data().checkins[0].points = 3;
  const two = A.completeCore({ kind: 'checkin', id: 'h1', day: '2026-10-19', title: '喝水' }, '第二笔', actionAt);
  assert.equal(b.S.pointsTotal(), 16);
  A.undoCore(one.id, '', actionAt);
  assert.equal(b.S.pointsTotal(), 6); assert.equal(b.S.data().checkins[0].days['2026-10-19'], 1);
  assert(!M.read('2026-10-19').text.includes('第一笔')); assert(M.read('2026-10-19').text.includes('第二笔'));
  A.undoCore(two.id, '刚才点错了', actionAt); assert.equal(b.S.pointsTotal(), 0);
  assert(M.read('2026-10-19').text.includes('【取消勾选】喝水：刚才点错了'));
});
test('backfill keeps the attributed day distinct from the operation-time note across 04:00', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  b.S.data().checkins = [{ id: 'h', text: '背英语', points: 5, target: 1, days: {} }];
  const e = A.completeCore({ kind: 'checkin', id: 'h', day: '2026-10-17', title: '背英语' }, '补记17日', '2026-10-18T19:59:00.000Z');
  assert.equal(e.noteDay, '2026-10-18'); assert.equal(b.S.data().ledger[0].date, '2026-10-17');
  assert.equal(b.S.data().checkins[0].days['2026-10-17'], 1);
  A.undoCore(e.id, '补错日子', '2026-10-18T20:01:00.000Z');
  assert.equal(M.read('2026-10-18').text, ''); assert(M.read('2026-10-19').text.includes('补错日子'));
});
test('cancelled task withdraws only newly linked dependent rewards and cannot farm bonuses', async () => {
  const b = browser(); await b.S.load(); const { A } = actionHarness(b), day = b.S.getDay('2026-10-19');
  day.tasks.required = [{ id: 'r', text: '必须' }]; day.tasks.ideal = [{ id: 'i', text: '理想',points:10 }]; day.tasks.extra = [{ id: 'x', text: '拓展' }];
  const r = A.completeCore({ kind: 'task', id: 'r', list: 'required', day: '2026-10-19', title: '必须' }, '必须', actionAt, [{ kind: 'base', points: 10 }]);
  A.completeCore({ kind: 'task', id: 'i', list: 'ideal', day: '2026-10-19', title: '理想' }, '理想', actionAt);
  A.completeCore({ kind: 'task', id: 'x', list: 'extra', day: '2026-10-19', title: '拓展' }, '拓展', actionAt, [{ kind: 'perfect', points: 20 }]);
  assert.equal(b.S.pointsTotal(), 45);
  b.S.data().ledger.push({ id: 'other-reward', points: 8, type: 'reward-base', date: '2026-10-18' });
  A.undoCore(r.id, '', actionAt); assert.equal(b.S.pointsTotal(), 23); assert.equal(day.rewards.length, 0);
  A.completeCore({ kind: 'task', id: 'r', list: 'required', day: '2026-10-19', title: '必须' }, '', actionAt, [{ kind: 'base', points: 10 }, { kind: 'perfect', points: 20 }]);
  assert.equal(b.S.pointsTotal(), 53);
});
test('one operation is not duplicated by double submit or persistence retry after total storage failure', async () => {
  const b = browser(); await b.S.load(); const { A } = actionHarness(b);
  b.S.data().queue = [{ id: 'q', text: 'task', points: 9 }]; let mutations = 0;
  b.options.localFails = b.options.idbFails = true;
  await assert.rejects(A.commit(() => { mutations++; A.completeCore({ kind: 'queue', id: 'q', title: 'task' }, 'text', actionAt); }), /尚未保存/);
  assert.equal(A.busy(), true); assert.equal(mutations, 1);
  b.options.localFails = b.options.idbFails = false;
  assert.equal(await A.commit(() => { mutations++; }), true); assert.equal(mutations, 1); assert.equal(b.S.pointsTotal(), 9); assert.equal(A.busy(), false);
  assert.throws(() => A.completeCore({ kind: 'queue', id: 'q', title: 'task' }, 'duplicate', actionAt), /已经/);
});
test('complete backup restores generated passages and exact ledger/event links', async () => {
  const b = browser(); await b.S.load(); const { A } = actionHarness(b);
  b.S.data().queue = [{ id: 'q', text: 'task', points: 5 }]; const e = A.completeCore({ kind: 'queue', id: 'q', title: 'task' }, 'saved text', actionAt);
  const pack = JSON.parse(await backupHarness().B.packText(b.S.data(), {}));
  b.S.reset(); await b.S.flush(); assert(b.S.restoreFrom(pack.data)); await b.S.flush();
  A.undoCore(e.id, '', actionAt); assert.equal(b.S.pointsTotal(), 0); assert.equal(b.S.data().queue[0].id, 'q');
});
test('cross-passage replacement preserves retained ownership and never captures surrounding prose', async () => {
  const b = browser(); await b.S.load(); const { E } = actionHarness(b);
  const input = [{ id: 'a', text: '普通' }, { id: 'b', eventId: 'e', text: '生成文字' }, { id: 'c', text: '手写' }];
  const output = E.splice(input, 1, 7, '替换');
  assert.equal(E.textOf(output), '普替换写'); assert(!output.some(x => x.eventId));
  const inside = E.splice(input, 3, 4, '新增说明');
  assert.equal(inside.filter(x => x.eventId === 'e').map(x => x.text).join(''), '生新增说明文字');
  const atEnd = E.splice(input, 8, 8, '正文'); assert(!atEnd[atEnd.length - 1].eventId);
});
test('repeated matching words use the actual selected range rather than guessing passage identity', async () => {
  const b = browser(); await b.S.load(); const { E } = actionHarness(b);
  const change = E.diff('aaaa', 'aaa', { start: 2, end: 2, type: 'deleteContentBackward' });
  assert.equal(change.start, 1); assert.equal(change.end, 2);
  const insertion = E.diff('aaaa', 'aaaaa', { start: 1, end: 1, type: 'insertText' }); assert.equal(insertion.start, 1);
});
test('removing a generated passage keeps separate handwritten lines separated', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  M.write('2026-10-19', '1055坐下来'); b.S.data().queue = [{ id: 'q', text: 'task', points: 5 }];
  const event = A.completeCore({ kind: 'queue', id: 'q', title: 'task' }, '1752【任务勾选】task', actionAt);
  const blocks = M.segments(M.read('2026-10-19')); blocks.push({ id: 'outside', text: '1800独立说明' });
  M.write('2026-10-19', blocks.map(b => b.text).join(''), actionAt, blocks);
  A.undoCore(event.id, '', actionAt); assert.equal(M.read('2026-10-19').text, '1055坐下来\n1800独立说明');
});
test('generated passage edges accept ordinary prose while edits inside remain owned', async () => {
  const b = browser(); await b.S.load(); const { E } = actionHarness(b);
  const list = [{ id: 'e', eventId: 'event', text: '任务\n说明\n' }];
  for (const offset of [0, E.textOf(list).length]) {
    const edited = E.splice(list, offset, offset, '独立文字');
    assert.equal(edited.filter(x => x.eventId).map(x => x.text).join(''), '任务\n说明\n');
    assert.equal(edited.filter(x => !x.eventId).map(x => x.text).join(''), '独立文字');
  }
  const inside = E.splice(list, 3, 3, '补充');
  assert.equal(inside.filter(x => x.eventId).map(x => x.text).join(''), '任务\n补充说明\n');
});
test('exports include reliable provenance without rewriting notes or guessing old text', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  M.write('2026-10-19', '原话\n【任务生成】旧文字');
  b.S.data().queue = [{ id: 'q', text: '任务', points: 5 }];
  const event = A.completeCore({ kind: 'queue', id: 'q', title: '任务' }, '1752【任务勾选】任务\n补充说明', actionAt);
  const original = JSON.stringify(M.read('2026-10-19'));
  const exported = M.exportText(['2026-10-19']);
  assert(exported.includes('旧文字\n【任务生成开始｜来源：任务队列】'));
  assert(exported.includes('1752【任务勾选】任务\n补充说明'));
  assert.equal(exported.split('【任务生成开始').length, 2);
  assert.equal(JSON.stringify(M.read('2026-10-19')), original);
  assert.equal(M.exportBlocks([{ id: 'unknown', eventId: 'missing', text: '未知来源' }]), '未知来源');
  A.undoCore(event.id, '', actionAt);
  assert(!M.exportText(['2026-10-19']).includes('【任务生成开始'));
  assert.equal(M.read('2026-10-19').text, '原话\n【任务生成】旧文字');
});
function scheduleHarness(b) {
  const h = actionHarness(b); vm.runInContext(source('js/memo-schedule.js'), b.ctx); return { ...h, P: b.ctx.App.memoSchedule };
}
test('over-target punches keep individual event amounts and exact undo', async () => {
  const b = browser(); await b.S.load(); const { A, M } = actionHarness(b);
  b.S.data().checkins = [{ id: 'h', text: '喝水', target: 1, points: 3, days: {} }];
  const events = Array.from({ length: 3 }, (_, i) => A.completeCore({ kind: 'checkin', id: 'h', title: '喝水', day: '2026-10-19' }, '记录' + i, actionAt));
  assert.equal(b.S.data().checkins[0].days['2026-10-19'], 3); assert.equal(b.S.pointsTotal(), 18);
  A.undoCore(events[1].id, '', actionAt);
  assert.equal(b.S.data().checkins[0].days['2026-10-19'], 2); assert.equal(b.S.pointsTotal(), 12);
  assert(!M.read('2026-10-19').text.includes('记录1')); assert(M.read('2026-10-19').text.includes('记录2'));
});
test('execution timestamps survive reload, exclude pauses, switch exclusively and end on completion', async () => {
  const b = browser(); await b.S.load(); const { A, P } = scheduleHarness(b), start = Date.parse(actionAt);
  b.S.data().queue = [{ id: 'q', text: '跨日任务', points: 5 }, { id: 'r', text: '另一任务', points: 0 }];
  const one = P.savePlan({ ref: { kind: 'queue', id: 'q' }, title: '跨日任务', day: '2026-10-19', type: 'span', start, end: start + 3600000 });
  const two = P.savePlan({ ref: { kind: 'queue', id: 'r' }, title: '另一任务', day: '2026-10-19', type: 'point', start: start + 3600000, end: null });
  const session = P.startCore(one.id, start); P.startCore(one.id, start + 500); assert.equal(P.state().sessions.length, 1);
  P.pause(one.id, start + 60000); P.startCore(one.id, start + 180000); assert.equal(P.elapsed(session, start + 240000), 120000);
  P.startCore(two.id, start + 240000); assert.equal(session.status, 'paused'); assert.equal(P.state().sessions.filter(s => s.status === 'running').length, 1);
  await b.S.save(); const c = browser({ shared: b }); await c.S.load(); const h = scheduleHarness(c);
  assert.equal(h.P.state().sessions.find(s => s.itemId === one.id).status, 'paused');
  assert.equal(h.P.elapsed(h.P.state().sessions.find(s => s.itemId === two.id), start + 300000), 60000);
  h.A.completeCore({ kind: 'queue', id: 'r', title: '另一任务' }, '完成', new Date(start + 300000).toISOString());
  assert.equal(h.P.state().sessions.find(s => s.itemId === two.id).status, 'ended');
  assert.equal(h.P.elapsed(h.P.state().sessions.find(s => s.itemId === two.id), start + 600000), 60000);
});
test('deleting a completed task withdraws its passage and points; exact restore protects later prose', async () => {
  const b = browser(); await b.S.load(); const { A, M, P } = scheduleHarness(b);
  b.S.data().queue = [{ id: 'q', text: '任务', points: 5 }]; M.write('2026-10-19', '独立原话');
  const p = P.savePlan({ ref: { kind: 'queue', id: 'q' }, title: '任务', day: '2026-10-19', type: 'point', start: Date.parse(actionAt), end: null });
  P.startCore(p.id, Date.parse(actionAt));
  A.completeCore({ kind: 'queue', id: 'q', title: '任务' }, '完成文段', actionAt);
  const entry = A.deleteCore({ kind: 'queue', id: 'q' }, '', actionAt);
  assert.equal(b.S.pointsTotal(), 0); assert.equal(M.read('2026-10-19').text, '独立原话'); assert.equal(b.S.data().queue.length + b.S.data().queueDone.length, 0);
  assert.equal(P.state().items[0].deleted, true); assert.equal(P.state().sessions[0].status, 'ended');
  A.restoreCore(entry.id); assert.equal(b.S.pointsTotal(), 5); assert(M.read('2026-10-19').text.includes('完成文段')); assert.equal(b.S.data().queueDone.length, 1);
  const another = A.deleteCore({ kind: 'queue', id: 'q' }, '', actionAt);
  M.write('2026-10-19', '删除后新写的内容');
  assert.throws(() => A.restoreCore(another.id), /已有新修改/);
  A.restoreCore(another.id, true); assert.equal(b.S.data().queue[0].id, 'q'); assert.equal(b.S.pointsTotal(), 0); assert.equal(M.read('2026-10-19').text, '删除后新写的内容');
});
test('failed delete persistence retries once without duplicating undo, and backup retains recovery snapshots', async () => {
  const b = browser(); await b.S.load(); const { A } = scheduleHarness(b);
  b.S.data().queue = [{ id: 'q', text: 'task', points: 5 }]; A.completeCore({ kind: 'queue', id: 'q', title: 'task' }, '记录', actionAt);
  b.options.localFails = b.options.idbFails = true;
  await assert.rejects(A.commit(() => A.deleteCore({ kind: 'queue', id: 'q' }, '', actionAt)), /尚未保存/);
  assert.equal(b.S.data().memoDeleted.length, 1); assert.equal(b.S.pointsTotal(), 0);
  b.options.localFails = b.options.idbFails = false; await A.commit(() => { throw new Error('must not repeat'); });
  const pack = JSON.parse(await backupHarness().B.packText(b.S.data(), {}));
  b.S.reset(); await b.S.flush(); assert(b.S.restoreFrom(pack.data)); A.restoreCore(b.S.data().memoDeleted[0].id); assert.equal(b.S.pointsTotal(), 5);
});
test('schedule rejects invalid intervals and assigns overlapping tasks separate columns', async () => {
  const b = browser(); await b.S.load(); const { P } = scheduleHarness(b); b.S.data().queue = [{ id: 'q', text: '任务' }];
  assert.throws(() => P.savePlan({ ref: { kind: 'queue', id: 'q' }, title: '任务', day: '2026-10-19', type: 'span', start: 2000, end: 1000 }), /有效/);
  const placed = P.columns([{ start: 0, end: 60, id: 'a' }, { start: 20, end: 80, id: 'b' }, { start: 80, end: 100, id: 'c' }]);
  assert.notEqual(placed[0].column, placed[1].column); assert.equal(placed[0].columns, 2); assert.equal(placed[2].columns, 1);
});
test('protected storage refuses schedule and deletion mutations before touching state', async () => {
  const b = browser(); await b.S.load(); const { A } = scheduleHarness(b);
  b.ctx.localStorage.setItem('focusPlanData.v1', JSON.stringify({ ...b.S.data(), _storageRevision: 999999 }));
  await b.S.save(); assert.equal(b.S.status().readOnly, true);
  let touched = false; await assert.rejects(A.commit(() => { touched = true; }), /保护/); assert.equal(touched, false);
});
test('task column moves keep plan identity, completion links and exact cancellation', async () => {
  const b = browser(); await b.S.load(); const { A, P } = scheduleHarness(b), day = b.S.getDay('2026-10-19');
  day.tasks.required = [{ id: 'stable', text: '任务' }];
  const ref = { kind: 'task', id: 'stable', day: '2026-10-19', list: 'required' };
  const plan = P.savePlan({ ref, title: '任务', day: '2026-10-19', type: 'point', start: Date.parse(actionAt), end: null });
  day.tasks.ideal.push(day.tasks.required.pop());
  assert.equal(P.find(ref).id, 'stable'); assert.equal(P.resolve(ref).ref.list, 'ideal');
  const session = P.startCore(plan.id, Date.parse(actionAt));
  const event = A.completeCore({ ...ref, title: '任务' }, '完成', actionAt);
  assert.equal(session.status, 'ended'); assert.equal(b.S.pointsTotal(), b.S.settings().idealPoints);
  day.tasks.extra.push(day.tasks.ideal.pop()); A.undoCore(event.id, '', actionAt);
  assert.equal(day.tasks.extra[0].done, false); assert.equal(b.S.pointsTotal(), 0);
});
test('unplanned execution adds no plan; multiple planned segments share one task', async () => {
  const b = browser(); await b.S.load(); const { P, A } = scheduleHarness(b), start = Date.parse(actionAt);
  b.S.data().queue = [{ id: 'q', text: '同一任务', points: 3 }]; const ref = { kind: 'queue', id: 'q' };
  P.startRef(ref, start); assert.equal(P.state().items.length, 0); assert.equal(P.state().sessions[0].itemId, null);
  P.stopRef(ref, start + 60000);
  P.savePlan({ ref, title: '同一任务', day: '2026-10-19', type: 'span', start, end: start + 1800000 });
  P.savePlan({ ref, title: '同一任务', day: '2026-10-19', type: 'span', start: start + 3600000, end: start + 5400000 });
  assert.equal(P.state().items.length, 2); assert.equal(b.S.data().queue.length, 1);
  A.completeCore({ ...ref, title: '同一任务' }, '', actionAt); assert.equal(b.S.pointsTotal(), 3);
});
test('daily aliases resolve to the original day occurrence and completion ends its execution', async () => {
  const b = browser(); await b.S.load(); const { P, A } = scheduleHarness(b);
  b.S.data().daily = [{ id: 'd', text: '基础', points: 2, days: {} }];
  b.S.getDay('2026-10-19').tasks.required = [{ id: 'copy', fromDaily: 'd', text: '基础' }];
  const ref = { kind: 'task', id: 'copy', day: '2026-10-19', list: 'required' };
  assert.equal(P.resolve(ref).ref.kind, 'daily');
  const s = P.startRef(ref, Date.parse(actionAt));
  A.completeCore({ kind: 'daily', id: 'd', day: '2026-10-19', title: '基础' }, '', actionAt);
  assert.equal(s.status, 'ended'); assert.equal(P.find(ref).id, 'd');
});
test('restore deleted completion preserves unrelated tasks, ledger rows and appended prose', async () => {
  const b = browser(); await b.S.load(); const { A, M } = scheduleHarness(b);
  b.S.data().queue = [{ id: 'q', text: '任务', points: 5 }]; M.write('2026-10-19', '原话');
  A.completeCore({ kind: 'queue', id: 'q', title: '任务' }, '生成文段', actionAt);
  const deletion = A.deleteCore({ kind: 'queue', id: 'q' }, '', actionAt);
  b.S.data().queue.push({ id: 'later', text: '后来新增的任务' }); b.S.data().ledger.push({ id: 'manual-later', type: 'adjust', points: 8 });
  const blocks = M.segments(M.read('2026-10-19')); blocks.push({ id: 'later-prose', text: '\n删除后续写' }); M.write('2026-10-19', blocks.map(x => x.text).join(''), actionAt, blocks);
  A.restoreCore(deletion.id);
  assert.equal(b.S.pointsTotal(), 13); assert.equal(b.S.data().queue[0].id, 'later');
  assert(M.read('2026-10-19').text.includes('生成文段')); assert(M.read('2026-10-19').text.endsWith('删除后续写'));
});
test('old timeline records remain in their original store and keep source identities', async () => {
  const b = browser(); await b.S.load(); const { P } = scheduleHarness(b);
  b.S.getDay('2026-10-19').timeline = [{ id: 'old', start: 60, end: 90, minutes: 20, content: '旧原话', auto: false, unknown: { retained: true } }, { id: 'aggregate', hourPlanId: 'hp', start: 60, end: 120, minutes: 60, content: '小时代汇总' }];
  const original = JSON.stringify(b.S.data()); const records = P.visibleRecords('2026-10-19', Date.parse(actionAt));
  assert.equal(records.legacy.length, 2); assert.equal(records.legacy[0].record.id, 'old'); assert.equal(records.legacy[1].record.hourPlanId, 'hp');
  const after = JSON.parse(JSON.stringify(b.S.data())); delete after.memoSchedule; assert.equal(JSON.stringify(after), original);
});
test('a year of sessions and hundreds of task plans preserve references without duplicating tasks', async t => {
  const b = browser(); await b.S.load(); const { P } = scheduleHarness(b), start = Date.parse('2026-10-19T00:00:00+08:00'), d = b.S.data(), n = 500;
  d.queue = Array.from({ length: n }, (_, i) => ({ id: 'large-' + i, text: '长期任务' + i, points: 1 }));
  const schedule = P.state();
  schedule.items = d.queue.map((task, i) => ({ id: 'plan-' + i, ref: { kind: 'queue', id: task.id }, title: task.text, day: '2026-10-19', type: 'point', start: start + i * 60000, end: null }));
  schedule.sessions = Array.from({ length: 1460 }, (_, i) => ({ id: 'session-' + i, ref: { kind: 'queue', id: 'large-' + i % n }, title: '历史执行', status: 'ended', chunks: [{ start: start - i * 6 * 3600000, end: start - i * 6 * 3600000 + 1800000 }] }));
  const from = Date.now(); const rows = d.queue.map(task => P.rowControls({ kind: 'queue', id: task.id })); const records = P.visibleRecords('2026-10-19', start);
  assert.equal(rows.length, n); assert(rows.every(row => row.includes('data-schedule-command="plan"'))); assert.equal(records.plans.length, n); assert.equal(d.queue.length, n);
  t.diagnostic('500 task rows plus selected-day lookup with 1460 stored sessions: ' + (Date.now() - from) + ' ms in the test runtime');
});

test('copy full ignores selected text and rescues unsaved editor text', async () => {
  const b = browser(); await b.S.load(); const M = memoHarness(b);
  const elements = new Map();
  b.ctx.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { dataset: {} }); return elements.get(id); } };
  b.ctx.requestAnimationFrame = () => {};
  let copied = '', blocks = [{ id: 'manual', text: '第一行\n完整末行' }];
  b.ctx.navigator = { clipboard: { writeText: async text => { copied = text; } } };
  b.ctx.App.ui = { toast() {} };
  b.ctx.App.memoEditor = { show() {}, selection: () => ({ start: 0, end: 3 }), text: () => '第一行\n完整末行', read: () => blocks };
  M.write('2026-10-19', '第一行\n完整末行');
  b.ctx.App.memo.show('2026-10-19');
  await b.ctx.App.memo.copyCurrent(); assert.equal(copied, '第一行');
  await b.ctx.App.memo.copyFull(); assert(copied.includes('第一行\n完整末行')); assert(copied.includes('2026-10-19'));
  b.ctx.App.store.flush = async () => false;
  blocks = [{ id: 'rescue', text: '尚未保存的新文字\n最后一行' }];
  await b.ctx.App.memo.copyFull(); assert(copied.includes('尚未保存的新文字\n最后一行'));
});

test('daily projects isolate occurrences, aliases and completion markers without fabricating execution', async () => {
  const b = browser(); await b.S.load(); const { A, P, M } = scheduleHarness(b);
  const d = b.S.data(); d.memoProjects = [{ id: 'project', text: '长期项目', points: 7, days: {} }];
  d.days['2026-10-18'].tasks.extra.push({ id: 'old', text: '长期项目', memoProjectId: 'project' });
  assert.equal(P.resolve({ kind: 'task', id: 'old', list: 'extra', day: '2026-10-18' }).ref.kind, 'project');
  const one = A.completeCore({ kind: 'project', id: 'project', title: '长期项目', day: '2026-10-18' }, '第一天', actionAt);
  const two = A.completeCore({ kind: 'project', id: 'project', title: '长期项目', day: '2026-10-19' }, '第二天', actionAt);
  assert.equal(b.S.pointsTotal(), 14); assert.equal(P.state().sessions.length, 0);
  assert.equal(P.visibleRecords('2026-10-19').completions.length, 2);
  assert.throws(() => A.completeCore({ kind: 'project', id: 'project', day: '2026-10-19' }, '', actionAt));
  A.undoCore(one.id, '', actionAt); assert.equal(b.S.pointsTotal(), 7); assert(d.memoProjects[0].days['2026-10-19']); assert(!d.memoProjects[0].days['2026-10-18']);
  assert.equal(P.visibleRecords('2026-10-19').completions.length, 1); assert(M.exportText(['2026-10-19']).includes('每日推进'));
  assert(two.active);
});
test('queue pin and group ordering survive completion, cancellation and unrelated edits', async () => {
  const b = browser(); await b.S.load(); const { A } = actionHarness(b);
  vm.runInContext(source('js/memo-workspace.js'), b.ctx); const W = b.ctx.App.memoWorkspace;
  b.S.data().queue = [{ id: 'a', text: 'A', points: 2 }, { id: 'b', text: 'B', points: 3 }, { id: 'c', text: 'C', points: 4 }];
  W.moveQueue('c', 'pin'); assert.equal(W.sortedQueue()[0].id, 'c');
  const event = A.completeCore({ kind: 'queue', id: 'c', title: 'C' }, '', actionAt);
  W.moveQueue('b', 'pin'); A.undoCore(event.id, '', actionAt);
  assert.equal(W.sortedQueue().filter(t => t.pinned).length, 2); assert.equal(b.S.data().queue.length, 3); assert.equal(b.S.pointsTotal(), 0);
});
function currencyHarness(b) {
  const h = scheduleHarness(b); vm.runInContext(source('js/memo-currency.js'), b.ctx);
  b.ctx.App.checkin.streakWithToday = () => 30;
  b.ctx.App.checkin.memoPoints = (it, day) => b.ctx.App.memoCurrency.quote(it, day)?.total || 0;
  return { ...h, C: b.ctx.App.memoCurrency };
}
test('new currency caps paid punches, retains exact awards and never reallocates cancelled bonus', async () => {
  const b = browser(); await b.S.load(); const { A, M, C } = currencyHarness(b), day = M.userDay();
  b.S.data().memoCurrency = { version: 2, claims: {}, extraPaidCount: 0 };
  const h = { id: 'h', text: '重复打卡', points: 5, target: 1, days: {} }; b.S.data().checkins = [h];
  const one = A.completeCore({ kind: 'checkin', id: 'h', title: h.text, day }, '', new Date().toISOString());
  const two = A.completeCore({ kind: 'checkin', id: 'h', title: h.text, day }, '', new Date().toISOString());
  assert.equal(one.points, 7); assert.equal(two.points, 0); assert.equal(C.quote(h, day).total, 0);
  h.points = 99; A.undoCore(one.id); assert.equal(b.S.pointsTotal(), 0); assert.equal(h.days[day], 1); assert.equal(C.quote(h, day).total, 0);
});
test('enabling currency after a legacy punch does not grant a second daily bonus', async () => {
  const b = browser(); await b.S.load(); const { C, M } = currencyHarness(b), day = M.userDay();
  const h = { id: 'h', points: 5, target: 1, days: { [day]: 1 } }; b.S.data().checkins = [h];
  C.enableCore(); assert(b.S.data().memoCurrency.claims[day]); assert.equal(C.quote(h, day).bonus, 0);
});
test('redemption revalidates price and balance, is idempotent, and keeps original prices', async () => {
  const b = browser(); await b.S.load(); const { C } = currencyHarness(b);
  b.S.settings().redeemTable = [{ item: '游戏', points: 30 }]; b.S.data().ledger = [{ id: 'income', points: 50 }];
  C.redeemCore('游戏', 30, 'operation'); C.redeemCore('游戏', 30, 'operation'); assert.equal(b.S.pointsTotal(), 20);
  assert.throws(()=>C.redeemCore('游戏',30,'second'),/积分不足/);assert.equal(b.S.pointsTotal(),20); b.S.settings().redeemTable[0].points = 10;
  assert.throws(() => C.redeemCore('游戏', 30, 'stale-price')); assert.equal(b.S.data().ledger[1].itemSnapshot.price, 30);
});
test('clearing a plan end switches to a named point and midnight execution is not counted twice', async () => {
  const b = browser(); await b.S.load(); const { P } = scheduleHarness(b); b.S.data().queue = [{ id: 'q', text: '时间点任务' }];
  const start = Date.parse('2026-10-19T23:50:00+08:00');
  const p = P.savePlan({ ref: { kind: 'queue', id: 'q' }, title: '时间点任务', day: '2026-10-19', type: 'span', start, end: start + 600000 });
  P.savePlan({ ref: p.ref, title: p.title, day: p.day, type: 'point', start, end: null }, p.id); assert.equal(p.end, null);
  const session = P.startRef(p.ref, start); P.stopRef(p.ref, start + 600000);
  assert.equal(session.status, 'ended'); assert.equal(P.visibleRecords('2026-10-20').sessions.length, 0);
});

test('optional habit zero is preserved, has independent reward limit and stays out of target totals', async () => {
  const b = browser(); await b.S.load(); memoHarness(b); b.ctx.__MEMO_MODE = true;
  vm.runInContext(source('js/checkin.js'), b.ctx);
  const h = b.S.habitRules;
  assert.deepEqual(copy(h({ target: 0, rewardLimit: 0 })), { target: 0, optional: true, rewardLimit: 0 });
  assert.deepEqual(copy(h({ target: 0 })), { target: 0, optional: true, rewardLimit: 1 });
  assert.equal(h({}).target, 1); assert.equal(h({ target: '' }).target, 1); assert.equal(h({ target: 3 }).rewardLimit, 3);
  const day = b.ctx.App.memoCore.userDay();
  b.S.data().checkins = [{ id: 'optional', target: 0, days: { [day]: 4 } }, { id: 'required', target: 2, days: { [day]: 1 } }, { id: 'old', archived: true, target: 1, days: { [day]: 1 } }];
  assert.equal(b.ctx.App.checkin.countAll(), 1); assert.equal(b.ctx.App.checkin.countDone(), 0);
  assert.equal(b.ctx.App.checkin.doneToday(b.S.data().checkins[0]), false);
  b.S.data().checkins[1].days[day] = 2; assert.equal(b.ctx.App.checkin.countDone(), 1);
  await b.S.save(); const again = browser({ shared: b }); await again.S.load(); assert.equal(again.S.data().checkins[0].target, 0);
});
test('fixed habit awards respect zero reward limit and exact undo after target or price changes', async () => {
  const b = browser(); await b.S.load(); const { A, M, C } = currencyHarness(b), day = M.userDay();
  const habit = { id: 'optional', text: '选做', target: 0, rewardLimit: 1, points: 3, days: {} }; b.S.data().checkins = [habit];
  C.enableFixedCore(); assert.equal(C.ruleLabel(), '固定基础分');
  const one = A.completeCore({ kind: 'checkin', id: habit.id, day, title: habit.text }, '一次', new Date().toISOString());
  const two = A.completeCore({ kind: 'checkin', id: habit.id, day, title: habit.text }, '超额', new Date().toISOString());
  assert.equal(one.points, 3); assert.equal(two.points, 0); assert.equal(one.award.version, 3); assert.equal(one.award.bonus, 0);
  habit.points = 100; habit.target = 4; habit.rewardLimit = 0;
  assert.equal(C.quote(habit, day).total, 0); A.undoCore(one.id); assert.equal(b.S.pointsTotal(), 0); assert.equal(habit.days[day], 1);
  assert(!M.read(day).text.includes('一次')); assert(M.read(day).text.includes('超额'));
});
test('switch to fixed habit rules retains ledger, task rules and original versioned awards', async () => {
  const b = browser(); await b.S.load(); const { A, M, C } = currencyHarness(b), day = M.userDay();
  b.S.data().memoCurrency = { version: 2, claims: {}, extraPaidCount: 0 };
  const habit = { id: 'h', text: '已有习惯', target: 1, rewardLimit: 2, points: 5, days: {} }; b.S.data().checkins = [habit];
  const old = A.completeCore({ kind: 'checkin', id: 'h', day, title: habit.text }, '', new Date().toISOString());
  assert.equal(old.points, 7); const ledgerBefore = JSON.stringify(b.S.data().ledger), settingsBefore = JSON.stringify(b.S.settings());
  C.enableFixedCore(); assert.equal(JSON.stringify(b.S.data().ledger), ledgerBefore); assert.equal(JSON.stringify(b.S.settings()), settingsBefore);
  assert.equal(C.quote(habit, day).bonus, 0); assert.equal(C.quote(habit, day).total, 5);
  A.completeCore({ kind: 'checkin', id: 'h', day, title: habit.text }, '', new Date().toISOString());
  A.undoCore(old.id); assert.equal(b.S.pointsTotal(), 5); assert.equal(b.S.data().memoCurrency.version, 3);
});
test('failed optional habit creation retries persistence without creating a second habit', async () => {
  const b = browser(); await b.S.load(); const { A } = actionHarness(b); b.ctx.App.memo.flush = async () => true; b.S.data().checkins = [];
  b.options.localFails = b.options.idbFails = true; let attempts = 0;
  const mutate = () => { attempts++; b.S.data().checkins.push({ id: 'new', text: '新增选做', target: 0, rewardLimit: 0, days: {} }); };
  await assert.rejects(A.commit(mutate)); assert.equal(A.busy(), true); assert.equal(attempts, 1);
  b.options.localFails = b.options.idbFails = false; assert.equal(await A.commit(mutate), true);
  assert.equal(attempts, 1); assert.equal(b.S.data().checkins.filter(h => h.id === 'new').length, 1); assert.equal(A.busy(), false);
});
test('time-axis details group completed task occurrences, retain graph records and separate habit punches', async () => {
  const b = browser(); await b.S.load(); const { P, A } = scheduleHarness(b), day = '2026-10-19', start = Date.parse(actionAt);
  const q = { id: 'q', text: '任务', points: 3 }; b.S.data().queue = [q, { id: 'live', text: '进行中' }, { id: 'todo', text: '待做' }];
  const ref = { kind: 'queue', id: q.id };
  for (let i = 0; i < 2; i++) P.savePlan({ ref, title: q.text, day, type: 'point', start: start + i * 60000, end: null });
  P.startRef(ref, start); P.stopRef(ref, start + 30000);
  const completion = A.completeCore({ ...ref, title: q.text }, '', actionAt);
  P.startRef({ kind: 'queue', id: 'live' }, start + 60000);
  P.savePlan({ ref: { kind: 'queue', id: 'todo' }, title: '待做', day, type: 'point', start, end: null });
  b.S.data().memoEvents.push({ id: 'punch', kind: 'checkin', sourceId: 'h', sourceDay: day, active: true, title: '打卡', at: actionAt });
  const records = P.visibleRecords(day, start + 120000), grouped = P.detailGroups(records);
  assert.equal(grouped.completed.length, 1); assert.equal(grouped.completed[0].ids.length, 4); assert.equal(grouped.checkins.length, 1);
  assert.equal(grouped.pending[0].ref.id, 'live'); assert.equal(records.plans.length, 3); assert.equal(records.sessions.length, 2);
  A.undoCore(completion.id, '', actionAt);
  assert.equal(P.detailGroups(P.visibleRecords(day, start + 120000)).completed.length, 0);
  assert.equal(P.visibleRecords(day, start + 120000).sessions.length, 2);
});

function flowHarness(b, day = '2026-10-20') {
  const h = currencyHarness(b); vm.runInContext(source('js/memo-flow.js'), b.ctx);
  const F=b.ctx.App.memoFlow; F.enableCore(Date.parse(day+'T08:00:00+08:00'));
  return {...h,F,C:b.ctx.App.memoCurrency};
}
test('prospective overdue settlement caps each due day, keeps one live identity and never compounds', async()=>{
  const b=browser();await b.S.load();const {F,P}=flowHarness(b),d=b.S.data();
  const tasks=b.S.getDay('2026-10-20').tasks.required;
  for(let i=0;i<7;i++)tasks.push({id:'late-'+i,text:'同名任务'});
  b.S.getDay('2026-10-19').tasks.required.push({id:'old',text:'启用前'});
  F.settleCore(Date.parse('2026-10-21T04:00:00+08:00'));
  assert.equal(d.ledger.filter(x=>x.type==='penalty-required').reduce((n,e)=>n-e.points,0),10);
  assert.equal(b.S.getDay('2026-10-21').tasks.required.length,7);
  assert.equal(b.S.getDay('2026-10-19').tasks.required[0].memoMovedTo,undefined);
  F.settleCore(Date.parse('2026-10-23T05:00:00+08:00'));
  assert.equal(d.memoFlow.settlements.length,7);assert.equal(b.S.getDay('2026-10-23').tasks.required.length,7);
  assert.equal(P.resolve({kind:'task',id:'late-0',day:'2026-10-20',list:'required'}).ref.day,'2026-10-23');
  F.settleCore(Date.parse('2026-10-23T06:00:00+08:00'));assert.equal(d.memoFlow.settlements.length,7);
  await b.S.save(); const next=browser({shared:b});await next.S.load();const n=flowHarness(next);n.F.settleCore(Date.parse('2026-10-23T06:00:00+08:00'));assert.equal(next.S.data().memoFlow.settlements.length,7);
});
test('overdue begins at 04:00, skips repeated habits and correction refunds the original amount once',async()=>{
  const b=browser();await b.S.load();const {F}=flowHarness(b),day=b.S.getDay('2026-10-20');
  day.tasks.required.push({id:'r',text:'必做'},{id:'repeat',text:'每日',fromDaily:'daily-id'});
  F.settleCore(Date.parse('2026-10-21T03:59:59+08:00'));assert.equal(b.S.data().memoFlow.settlements.length,0);
  F.settleCore(Date.parse('2026-10-21T04:00:00+08:00'));assert.equal(b.S.data().memoFlow.settlements.length,1);
  const ref={kind:'task',id:'r',day:'2026-10-21',list:'required'};
  assert.throws(()=>F.forgiveCore(ref,''),/原因/);F.forgiveCore(ref,'实际按时完成，忘记勾选');F.state().penalty=99;F.forgiveCore(ref,'重复');
  assert.equal(b.S.data().ledger.filter(e=>e.type==='refund-penalty').length,1);assert.equal(b.S.pointsTotal(),0);
});
test('queue assignment keeps running session and required completion uses one group reward only',async()=>{
  const b=browser();await b.S.load();const {F,P,A}=flowHarness(b),d=b.S.data();d.queue=[{id:'q',text:'提交材料',points:9}];
  const ref={kind:'queue',id:'q'},at=Date.parse('2026-10-20T12:00:00+08:00');const run=P.startRef(ref,at);
  F.moveCore(ref,'2026-10-20','required');F.moveCore(ref,'2026-10-20','required');assert.equal(d.queue.length,1);assert.equal(P.state().sessions.length,1);assert.equal(run.status,'running');
  const e=A.completeCore({kind:'queue',id:'q',title:'提交材料'},'',new Date(at+60000).toISOString(),[{kind:'base',points:10}]);
  assert.equal(e.points,0);assert.equal(e.sourceDay,'2026-10-20');assert.equal(d.ledger.filter(x=>x.type==='reward-base').length,1);assert.equal(run.status,'ended');
  assert.throws(()=>A.completeCore({kind:'queue',id:'q',title:'提交材料'},''),/移动或完成/);
  A.undoCore(e.id);assert.equal(d.queue[0].assignment.list,'required');assert.equal(b.S.pointsTotal(),0);
});
test('moving dated task preserves timing identity, records original date and can return to queue',async()=>{
  const b=browser();await b.S.load();const {F,P}=flowHarness(b),d=b.S.data();b.S.getDay('2026-10-20').tasks.ideal.push({id:'x',text:'错题',points:4});
  const ref={kind:'task',id:'x',day:'2026-10-20',list:'ideal'},session=P.startRef(ref,Date.parse('2026-10-20T11:00:00+08:00'));
  F.moveCore(ref,'2026-10-21','ideal');assert.equal(P.key(ref),P.key({kind:'task',id:'x',day:'2026-10-21',list:'ideal'}));assert.equal(session.status,'running');
  F.moveCore(ref,'2026-10-21','ideal','queue');assert.equal(P.resolve(ref).ref.kind,'queue');assert.equal(d.queue.filter(t=>t.id==='x').length,1);
});
test('copy checkpoints carry append, old edits, deletion and multiple missed days without mutating notes',async()=>{
  const b=browser();await b.S.load();const {F,M}=flowHarness(b);M.write('2026-10-20','原始笔记');
  let q=F.copyQuote('2026-10-20');assert.equal(F.state().lastCopy,undefined);F.markCopyCore(q);
  M.write('2026-10-20','原始笔记\n后来补写');M.write('2026-10-21','第二天');M.write('2026-10-22','第三天');
  q=F.copyQuote('2026-10-22');assert.match(q.text,/上次复制后的补记/);assert.match(q.text,/后来补写/);assert.match(q.text,/第二天/);F.markCopyCore(q);
  M.write('2026-10-20','修订原文');q=F.copyQuote('2026-10-23');assert.match(q.text,/修订后的全文/);assert.match(q.text,/修订原文/);assert.equal(M.read('2026-10-20').text,'修订原文');F.markCopyCore(q);
  M.write('2026-10-20','');q=F.copyQuote('2026-10-23');assert.match(q.text,/修订后的全文/);F.markCopyCore(q);
  assert.match(F.copyQuote('2026-10-23').text,/用户日 2026-10-20/); // Same-day repeated copies retain corrections.
});
test('custom money spending supports cents, debt and exact idempotent refunds',async()=>{
  const b=browser();await b.S.load();const {F,C}=flowHarness(b);b.S.data().ledger.push({id:'seed',points:1000});
  const quote=C.spendQuote('money','30.01','买小说');assert.equal(quote.points,60.02);C.spendCore(quote,'op-1');C.spendCore(quote,'op-1');assert.equal(b.S.pointsTotal(),939.98);
  const spend=b.S.data().ledger.find(e=>e.operationId==='op-1');F.state().rate=4;C.refundCore(spend.id);C.refundCore(spend.id);assert.equal(b.S.pointsTotal(),1000);assert.equal(spend.itemSnapshot.rate,2);
  assert.throws(()=>C.spendQuote('money','1.001','用途'));assert.equal(C.spendQuote('points','1.5','用途').points,1.5);assert.throws(()=>C.spendQuote('money','2',''));assert.throws(()=>C.spendCore(quote,'op-2'),/比例/);
  C.spendCore(C.spendQuote('points','1001','用途'),'op-3');assert.equal(b.S.pointsTotal(),-1);
});
test('workflow backup retains copy checkpoints, assignment, prospective rules and expenditure metadata',async()=>{
  const b=browser();await b.S.load();const {F,M,C}=flowHarness(b);M.write('2026-10-20','正文');F.markCopyCore(F.copyQuote('2026-10-20'));b.S.data().queue=[{id:'q',text:'任务'}];F.moveCore({kind:'queue',id:'q'},'2026-10-20','ideal');b.S.data().ledger.push({id:'seed',points:20});C.spendCore(C.spendQuote('money','2','目的'),'spend');await b.S.save();
  const next=browser({shared:b});await next.S.load();const n=flowHarness(next);assert.equal(n.F.state().copies['2026-10-20'].text,'正文');assert.equal(next.S.data().queue[0].assignment.list,'ideal');assert.equal(next.S.data().ledger.find(e=>e.operationId==='spend').itemSnapshot.amountCents,200);
});
test('moving back to a prior date replaces the inactive placeholder and retains one live identity',async()=>{
 const b=browser();await b.S.load();const {F,P}=flowHarness(b);b.S.getDay('2026-10-20').tasks.ideal.push({id:'return',text:'返回任务'});
 const ref={kind:'task',id:'return',day:'2026-10-20',list:'ideal'};F.moveCore(ref,'2026-10-21','ideal');F.moveCore(ref,'2026-10-20','required');
 assert.equal(P.resolve(ref).ref.list,'required');assert.equal(Object.values(b.S.getDay('2026-10-20').tasks).flat().filter(t=>t.id==='return').length,1);
 F.moveCore(ref,'2026-10-21','extra');assert.equal(P.resolve(ref).ref.list,'extra');
});
test('user-day timeline contains next-morning execution and does not shift old natural-day records',async()=>{
 const b=browser();await b.S.load();const {F,P}=flowHarness(b);const d=b.S.data();d.queue=[{id:'night',text:'夜间任务'}];
 const now=Date.parse('2026-10-21T02:00:00+08:00');P.startRef({kind:'queue',id:'night'},now);P.stopRef({kind:'queue',id:'night'},now+60000);
 b.S.getDay('2026-10-20').timeline=[{id:'daytime',start:720,end:750,content:'中午'}];b.S.getDay('2026-10-21').timeline=[{id:'early',start:60,end:90,content:'次日凌晨'},{id:'later',start:600,end:630,content:'下一用户日'}];
 const records=P.visibleRecords('2026-10-20',now+60000);assert.equal(records.sessions.length,1);
 assert.equal(records.legacy.length,2);assert.equal(records.legacy.find(x=>x.id==='early').startMs,Date.parse('2026-10-21T01:00:00+08:00'));
 assert.equal(records.legacy.find(x=>x.id==='daytime').startMs,Date.parse('2026-10-20T12:00:00+08:00'));
 assert.equal(P.frame('2026-10-20',now).dayMs,Date.parse('2026-10-20T04:00:00+08:00'));
});
test('failed custom debit and copy checkpoint retry persist original operation without executing twice',async()=>{
 const b=browser();await b.S.load();const {F,C,A,M}=flowHarness(b);b.S.data().ledger.push({id:'seed',points:100});M.write('2026-10-20','待复制正文');
 const quote=F.copyQuote('2026-10-20');let calls=0;b.options.localFails=b.options.idbFails=true;
 await assert.rejects(A.commit(()=>{calls++;C.spendCore(C.spendQuote('money','3','阅读奖励'),'once');F.markCopyCore(quote);}),/尚未保存/);
 assert.equal(A.busy(),true);b.options.localFails=b.options.idbFails=false;await A.commit(()=>{calls++;});
 assert.equal(calls,1);assert.equal(b.S.pointsTotal(),94);
 const next=browser({shared:b});await next.S.load();const n=flowHarness(next);assert.equal(next.S.data().ledger.filter(e=>e.operationId==='once').length,1);assert.equal(n.F.state().lastCopy.text,quote.text);
});
test('same-day full copies retain yesterday additions across repeat and reload',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),today=M.userDay(),yesterday=M.shiftDay(today,-1);
 M.write(yesterday,'原文');F.markCopyCore(F.copyQuote(yesterday));M.write(yesterday,'原文\n补记A');M.write(today,'今日正文');
 let q=F.copyQuote(today);assert.match(q.text,/补记A/);F.markCopyCore(q);M.write(today,'今日正文\n新增B');
 q=F.copyQuote(today);assert.match(q.text,/补记A/);assert.match(q.text,/新增B/);F.markCopyCore(q);await b.S.save();assert.match(F.copyQuote(today).text,/补记A/);
});
test('dismissed required queue assignments cannot block overdue processing',async()=>{
 const b=browser();await b.S.load();const {F}=flowHarness(b);b.S.data().queue=[{id:'dismissed',text:'取消安排',memoDismissed:'yes',assignment:{day:'2026-10-20',list:'required'}}];
 F.settleCore(Date.parse('2026-10-21T05:00:00+08:00'));assert.equal(F.state().settlements.length,0);
});
test('backfill completes canonical overdue task, refunds original penalty once and undo restores it',async()=>{
 const b=browser();await b.S.load();const {F,M,P,A}=flowHarness(b),d=b.S.data();
 b.S.getDay('2026-10-20').tasks.required.push({id:'bf',text:'已按时完成'});
 F.settleCore(Date.parse('2026-10-21T05:00:00+08:00'));
 const moved={kind:'task',id:'bf',day:'2026-10-21',list:'required'};assert.equal(b.S.pointsTotal(),-2);
 let handlers;const values={'#bf-day':{value:'2026-10-20'},'#bf-note':{value:'忘记勾选'},'#bf-preview':{},'[role="alert"]':{}};
 b.ctx.App.ui={openModal:()=>({querySelector:s=>values[s]}),bindActions:h=>{handlers=h;},closeModal:()=>{}};
 b.ctx.App.memoWorkspace={render:()=>{}};b.ctx.App.app={refreshStats:()=>{}};P.render=()=>{};
 F.backfill(moved);await handlers.save({disabled:false});assert.equal(values['[role="alert"]'].textContent,undefined);
 assert.equal(P.find(moved).done,true);assert.equal(b.S.pointsTotal(),0);const event=d.memoEvents.find(e=>e.sourceId==='bf');assert.equal(event.sourceDay,'2026-10-20');assert.equal(event.noteDay,M.userDay());assert.equal(event.backfillDay,'2026-10-20');
 A.undoCore(event.id);assert.equal(b.S.pointsTotal(),-2);assert.equal(P.find(moved).done,false);assert.equal(F.state().settlements[0].forgivenAt,undefined);
});
test('DDL counts Shanghai civil days independently of study user-day and preserves legacy records',async()=>{
 const b=browser();await b.S.load();flowHarness(b);b.S.data().milestones=[{id:'old',name:'旧节点',end:'2026-10-25',note:'保留'}];const before=JSON.stringify(b.S.data().milestones);
 vm.runInContext(source('js/milestones.js'),b.ctx);const ms=b.ctx.App.ms;
 assert.equal(ms.daysLeft(ms.list()[0],Date.parse('2026-10-25T00:30:00+08:00')),0);
 assert.equal(ms.daysLeft(ms.list()[0],Date.parse('2026-10-24T23:59:00+08:00')),1);
 assert.equal(JSON.stringify(b.S.data().milestones),before);
 assert.equal(ms.daysLeft({due:'2026-02-30'}),null);
 b.S.data().milestones={unknown:true};assert.throws(()=>ms.list(),/数据异常/);assert.equal(b.S.data().milestones.unknown,true);
});
test('task overview resolves queue identities and includes daily projects without duplicating assignment',async()=>{
 const b=browser();await b.S.load();const {F,M,A}=flowHarness(b),d=b.S.data(),day=M.userDay();
 d.queue=[{id:'ovq',text:'队列总览',assignment:{day,list:'ideal'},points:3}];
 b.S.getDay(day).tasks.required.push({id:'proxy',fromQueue:'ovq',text:'旧副本'});
 d.memoProjects=[{id:'ovp',text:'每日推进总览',days:{},points:2}];b.ctx.document={addEventListener(){}};vm.runInContext(source('js/memo-organize.js'),b.ctx);
 vm.runInContext(source('js/memo-workspace.js'),b.ctx);
 vm.runInContext(source('js/memo-finance.js'),b.ctx);let html=b.ctx.App.memoWorkspace.overviewHTML(day);assert.equal((html.match(/title="队列总览"/g)||[]).length,1);assert.match(html,/每日推进总览/);assert.doesNotMatch(html,/旧副本/);assert.doesNotMatch(html,/<button|data-mw=|mw-mini-title/);assert.match(html,/✅ 必须/);assert.match(html,/class="mw-column-count"/);
 A.completeCore({kind:'queue',id:'ovq',title:'队列总览'},'');html=b.ctx.App.memoWorkspace.overviewHTML(day);assert.match(html,/队列总览 ✓/);assert.equal(d.ledger.filter(e=>e.type==='earn-queue').length,1);
});
test('rest stamp leaves running task and legacy rest state unchanged across reload',async()=>{
 const b=browser();await b.S.load();const {P,M}=flowHarness(b);vm.runInContext(source('js/memo-rest.js'),b.ctx);const R=b.ctx.App.memoRest,now=Date.now();b.S.data().queue=[{id:'r',text:'任务'}];const run=P.startRef({kind:'queue',id:'r'},now);b.S.data().memoRest={version:1,intervals:[{id:'old',startedAt:now-1000}]};const old=JSON.stringify(b.S.data().memoRest);R.stampCore(now);R.stampCore(now+60000);assert.equal(run.status,'running');assert.equal(JSON.stringify(b.S.data().memoRest),old);assert.equal((M.read(M.userDay(now)).text.match(/休息/g)||[]).length,2);await b.S.save();
 const next=browser({shared:b});await next.S.load();assert.match(next.S.data().memoNotes[M.userDay(now)].text,/休息/);
});
test('copy report carries task-only changes and retains repeated-copy corrections without changing notes',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);vm.runInContext(source('js/memo-goals.js'),b.ctx);vm.runInContext(source('js/memo-report.js'),b.ctx);
 b.S.getDay(old).tasks.ideal=[{id:'rep',text:'旧日任务',done:false}];M.write(day,'手写原文');const original=M.read(day).text;
 F.markCopyCore(F.copyQuote(day));b.S.getDay(old).tasks.ideal[0].done=true;let q=F.copyQuote(day);assert.match(q.text,/任务汇总修订/);assert.match(q.text,/✓ 旧日任务/);F.markCopyCore(q);assert.match(F.copyQuote(day).text,/任务汇总修订/);assert.equal(M.read(day).text,original);
});
test('deadline reminders preserve legacy progress, historical visibility and ledger independence',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b);vm.runInContext(source('js/memo-goals.js'),b.ctx);const G=b.ctx.App.memoGoals,at=Date.parse('2026-10-25T00:30:00+08:00');
 const legacy={id:'oldgoal',history:[{name:'目录',due:'2026-10-30',current:2,total:10,unit:'章',day:'2026-10-24',at:new Date(at).toISOString()}]};b.S.data().memoGoals=[legacy];const old=JSON.stringify(legacy.history[0]);const ledger=JSON.stringify(b.S.data().ledger),tasks=JSON.stringify(b.S.data().days);
 G.saveCore('oldgoal',{name:'目录提醒',due:'2026-11-01',hidden:true},at+86400000);assert.equal(JSON.stringify(legacy.history[0]),old);assert.equal(G.at('2026-10-24')[0].current,2);assert.equal(G.at('2026-10-25').length,0);assert.equal(G.at('2026-10-25',true)[0].hidden,true);assert.equal(G.origin(legacy),'2026-10-25');
 G.saveCore('oldgoal',{name:'目录提醒',due:'2026-11-01',hidden:false},at+86400000+60000);assert.equal(G.at('2026-10-25').length,1);assert.equal(JSON.stringify(b.S.data().ledger),ledger);assert.equal(JSON.stringify(b.S.data().days),tasks);assert.throws(()=>G.saveCore(null,{name:'',due:'2026-10-30'}),/名称/);assert.throws(()=>G.saveCore(null,{name:'非法日期',due:'2026-02-30'}),/截止日期/);
 await b.S.save();const again=browser({shared:b});await again.S.load();assert.equal(JSON.stringify(again.S.data().memoGoals[0].history[0]),old);
});
test('countdown uses civil date ordinals across midnight, leap days and deadline edits',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b);vm.runInContext(source('js/memo-goals.js'),b.ctx);const G=b.ctx.App.memoGoals,g={createdCivilDay:'2026-10-25',due:'2026-10-30'};
 assert.equal(G.countdown(g,'2026-10-25').ratio,1);assert.equal(G.countdown(g,'2026-10-29').text,'剩余1天');assert.equal(G.countdown(g,'2026-10-30').text,'今天截止');assert.equal(G.countdown(g,'2026-10-31').text,'已过期1天');assert.equal(G.countdown(g,'2026-10-31').ratio,0);
 assert.equal(G.countdown({due:'2028-03-01',createdCivilDay:'2028-02-28'},'2028-02-29').remaining,1);assert.equal(G.countdown({due:'2027-01-01'},'2026-12-31').remaining,1);assert.equal(G.countdown({due:'2026-10-25',createdCivilDay:'2026-10-25'},'2026-10-25').ratio,0);
 const before=Date.parse('2026-10-25T23:59:59+08:00'),after=before+1000;assert.equal(M.userDay(before),M.userDay(after));assert.equal(G.countdown(g,M.naturalDay(before)).remaining-G.countdown(g,M.naturalDay(after)).remaining,1);
 assert.equal(G.countdown(g,M.naturalDay('2026-10-26T03:59:59+08:00')).remaining,G.countdown(g,M.naturalDay('2026-10-26T04:00:00+08:00')).remaining);
 const created=G.saveCore(null,{name:'提醒',due:'2026-10-30'},before);G.saveCore(created.id,{name:'改名',due:'2026-11-01'},after);assert.equal(G.origin(created),'2026-10-25');assert.equal(G.at('2026-10-25')[0].due,'2026-11-01');
 assert.equal(G.origin({history:[{day:'2026-10-20'}]}),'2026-10-20');assert.equal(G.countdown({due:'bad'},'2026-10-25').remaining,null);
});
test('long-term scores sort descending stably and release assigned queues with history',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay();vm.runInContext(source('js/memo-workspace.js'),b.ctx);const W=b.ctx.App.memoWorkspace;b.S.getDay(day).tasks.extra=[{id:'low',text:'低',points:1},{id:'high',text:'高',points:10},{id:'same',text:'同分',points:10}];assert.deepEqual(Array.from(W.taskItems(day,'extra'),x=>x.task.id),['high','same','low']);b.S.data().queue=[{id:'release',text:'原队列',assignment:{day,list:'ideal'}}];F.moveCore({kind:'queue',id:'release'},day,'ideal','queue');assert.equal(b.S.data().queue[0].assignmentHistory[0].day,day);assert.equal(b.S.data().queue[0].assignment,undefined);
});
test('new historical task date after a successful copy is carried repeatedly',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-2);vm.runInContext(source('js/memo-report.js'),b.ctx);F.markCopyCore(F.copyQuote(day));b.S.getDay(old).tasks.ideal=[{id:'new-history',text:'新增往日安排'}];const q=F.copyQuote(day);assert.match(q.text,/新增往日安排/);F.markCopyCore(q);assert.match(F.copyQuote(day).text,/新增往日安排/);
});

test('report format upgrade suppresses only proven formatting differences and preserves pending corrections',async()=>{
 const b=browser();await b.S.load();const {M,F}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);vm.runInContext(source('js/memo-goals.js'),b.ctx);vm.runInContext(source('js/memo-report.js'),b.ctx);const R=b.ctx.App.memoReport;
 b.S.data().memoGoals=[{id:'legacy',history:[{name:'截止测试',due:'2026-12-19',current:1,total:10,unit:'章',day:old,at:old+'T10:00:00+08:00'}]}];b.S.getDay(old).tasks.ideal=[{id:'task',text:'旧任务',done:false}];F.state().reportCopies=Object.fromEntries(Object.keys(b.S.data().days).map(k=>[k,R.report(k,true).text]));
 const prior=JSON.stringify(F.state().reportCopies),q=F.copyQuote(day);assert.doesNotMatch(q.text,/任务汇总修订/);assert.equal(JSON.stringify(F.state().reportCopies),prior);assert.match(q.text,/截止测试；截止 2026-12-19/);assert.doesNotMatch(q.text,/1\/10章/);
 b.S.getDay(old).tasks.ideal[0].done=true;const changed=F.copyQuote(day);assert.match(changed.text,/任务汇总修订/);assert.match(changed.text,/✓ 旧任务/);F.markCopyCore(changed);assert.match(F.copyQuote(day).text,/任务汇总修订/);
 const text=R.report(old).text;class Later extends Date{constructor(...args){super(...(args.length?args:[Date.now()+86400000]));}static now(){return Date.now()+86400000;}}b.ctx.Date=Later;assert.equal(R.report(old).text,text);
});
test('rest retry persists one stamp and focuses its actual day before the trailing newline',async()=>{
 const b=browser();await b.S.load();const {A,M}=flowHarness(b);let button,shown,caret,focus=false,composing=false;const editor={contentEditable:'true',focus(){focus=true;}};
 const buttons={};b.ctx.document={createElement(){return {after(){}};},getElementById(id){return id==='memo-time'?{after(el){button=el;buttons[el.id]=el;}}:id==='memo-rest'?button:editor;}};b.ctx.App.memo={flush:async()=>true,show(day){shown=day;}};b.ctx.App.memoEditor={busy:()=>composing,text:()=>M.read(shown)?.text||'',select(pos){caret=pos;}};b.ctx.App.ui={toast(){}};
 vm.runInContext(source('js/memo-rest.js'),b.ctx);b.ctx.App.memoRest.init();b.options.localFails=b.options.idbFails=true;await button.onclick();assert(A.busy());const recorded=Object.keys(b.S.data().memoNotes).find(k=>M.read(k).text.includes('休息')),text=M.read(recorded).text;assert.equal(shown,undefined);
 b.options.localFails=b.options.idbFails=false;await button.onclick();assert(!A.busy());assert.equal(shown,recorded);assert(focus);assert.equal(caret,text.length-1);assert.equal(M.read(recorded).text,text);
 composing=true;await button.onclick();assert.equal(M.read(recorded).text,text);
});
test('habit cards keep active items in a grid and native makeup buttons with habit labels',async()=>{
 const b=browser();await b.S.load();memoHarness(b);b.ctx.__MEMO_MODE=true;vm.runInContext(source('js/checkin.js'),b.ctx);b.S.data().checkins=[{id:'visible',text:'喝水测试',points:5,target:1,days:{}},{id:'second',text:'第二项目',points:1,target:1,days:{}},{id:'archived',text:'已停用测试',archived:true,days:{}}];
 const html=b.ctx.App.checkin.pageHTML();assert.match(html,/class="ck-grid"/);assert(!html.includes('class="ck-week"'));const details=b.ctx.App.checkin.detailHTML('visible');assert.match(details,/<button type="button" class="ck-day makeup"/);assert.match(details,/补卡/);assert.match(html,/data-act="ck-info"/);assert.match(html,/aria-label="喝水测试，打卡，本次积分\+5分"/);assert.match(html,/<div class="ck-secondary"><details>/);assert.equal((html.match(/class="ck-row/g)||[]).length,2);assert(!html.includes('<span class="ck-dot makeup"'));
});
test('overview point labels and category rails use actual score for both assigned and project tasks',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b),day=M.userDay();b.S.getDay(day).tasks.ideal=[{id:'zero',text:'零分',points:0}];b.S.data().queue=[{id:'queue',text:'队列分',points:10,assignment:{day,list:'ideal'}}];b.S.data().memoProjects=[{id:'project',text:'推进分',points:5,days:{}}];vm.runInContext(source('js/memo-workspace.js'),b.ctx);b.ctx.document={addEventListener(){}};vm.runInContext(source('js/memo-finance.js'),b.ctx);const html=b.ctx.App.memoWorkspace.overviewHTML(day);assert.match(html,/data-category="ideal" data-bounty="false" data-score="zero"/);assert.match(html,/data-category="ideal" data-bounty="false" data-score="high"/);assert.match(html,/data-category="extra" data-bounty="false" data-score="medium"/);assert.match(html,/class="mw-score">\+0分/);assert.match(html,/class="mw-score">\+10分/);
});

test('all overview columns place completed last and score-sort ideal while required stays stable',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b),day=M.userDay();vm.runInContext(source('js/memo-workspace.js'),b.ctx);const W=b.ctx.App.memoWorkspace,d=b.S.getDay(day);d.tasks.ideal=[{id:'done',text:'完成',points:50,done:true},{id:'low',text:'低',points:1},{id:'high',text:'高',points:10},{id:'same',text:'同分',points:10}];d.tasks.required=[{id:'done-r',text:'完成',done:true},{id:'a',text:'先'},{id:'b',text:'后'}];assert.deepEqual(Array.from(W.taskItems(day,'ideal'),x=>x.task.id),['high','same','low','done']);assert.deepEqual(Array.from(W.taskItems(day,'required'),x=>x.task.id),['a','b','done-r']);
});
test('waiting groups exclude moved and complete tasks and keep queue assignment identity',async()=>{
 const b=browser();await b.S.load();const {M,F}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);vm.runInContext(source('js/memo-workspace.js'),b.ctx);const W=b.ctx.App.memoWorkspace;b.S.data().days['2026-10-18'].tasks.required=[];b.S.getDay(old).tasks.ideal=[{id:'past',text:'旧任务'},{id:'done',text:'完成',done:true}];b.S.data().queue=[{id:'assigned',text:'旧队列',assignment:{day:old,list:'ideal'}},{id:'new',text:'尚未安排'}];assert.deepEqual(Array.from(W.pendingRows(),x=>x.task.id).sort(),['assigned','past']);F.moveCore({kind:'task',id:'past',day:old,list:'ideal'},day,'ideal','queue');assert.deepEqual(Array.from(W.pendingRows(),x=>x.task.id),['assigned']);assert.equal(b.S.data().queue.filter(t=>t.id==='past').length,1);const html=W.waitingRow(b.S.data().queue.find(t=>t.id==='past'));assert.match(html,/>安排</);assert.match(html,/直接完成/);assert.match(html,/<summary>更多<\/summary>/);
});

test('carry rails distinguish automatic overdue from manual moves and timely backfill',async()=>{
 const b=browser();await b.S.load();const {F}=flowHarness(b),d=b.S.data();F.enableCore();const t={id:'r',originalDay:'2026-10-20'};assert.equal(F.isCarried(t),false);d.memoFlow.settlements.push({id:'event',taskId:'r',points:0});t.overdueEventId='event';assert.equal(F.isCarried(t),true);t.backfillDay='2026-10-20';assert.equal(F.isCarried(t),false);t.backfillDay='2026-10-21';assert.equal(F.isCarried(t),true);assert.equal(F.isCarried({id:'legacy',carried:true}),true);
});

test('one-off long tasks carry without ledger writes and keep one live identity',async()=>{
 const b=browser();await b.S.load();const {M,F}=flowHarness(b),d=b.S.data(),day=M.userDay(),old=M.shiftDay(day,-3);d.days['2026-10-18'].tasks.required=[];b.S.getDay(old).tasks.extra=[{id:'long',text:'长期',points:10},{id:'done',done:true},{id:'dismissed',memoDismissed:'yes'},{id:'daily',memoProjectId:'p'}];d.queue=[{id:'q',assignment:{day:old,list:'extra'}},{id:'unassigned'}];const before=d.ledger.length;F.settleCore();assert.equal(d.ledger.length,before);assert.equal(b.S.getDay(day).tasks.extra.filter(t=>t.id==='long').length,1);assert.equal(d.queue[0].assignment.day,day);assert.equal(d.queue[1].assignment,undefined);assert.equal(F.isCarried(b.S.getDay(day).tasks.extra.find(t=>t.id==='long')),true);F.settleCore();assert.equal(F.longOverdue().length,0);assert.equal(b.S.getDay(day).tasks.extra.filter(t=>t.id==='long').length,1);assert.equal(d.ledger.length,before);
});

function financeHarness(b){b.ctx.document={addEventListener:()=>{}};vm.runInContext(source('js/memo-finance.js'),b.ctx);return b.ctx.App.memoFinance;}
test('173.5 ideal default migration preserves old implicit points, zeroes and future custom defaults',async()=>{
 for(const oldDefault of [10,3,0,undefined]){
  const initial=data({settings:oldDefault===undefined?{}:{idealPoints:oldDefault}});initial.days['2026-10-18'].tasks.ideal=[{id:'implicit',text:'旧任务'},{id:'zero',points:0},{id:'custom',points:7}];
  const original=JSON.stringify(initial),b=browser({initial});assert(await b.S.load());
  assert.equal(b.S.settings().idealPoints,oldDefault===10||oldDefault===undefined?1:oldDefault);
  assert.deepEqual(copy(b.S.getDay('2026-10-18').tasks.ideal.map(t=>t.points)),[oldDefault??10,0,7]);assert.equal(JSON.stringify(initial),original);
  b.S.settings().idealPoints=10;await b.S.save();const next=browser({shared:b});await next.S.load();assert.equal(next.S.settings().idealPoints,10);assert.equal(next.S.data().memoIdealDefaultVersion,1);
 }
 const fresh=browser({initial:null});await fresh.S.load();assert.equal(fresh.S.settings().idealPoints,1);
 const {A}=actionHarness(fresh),day=fresh.ctx.App.memoCore.userDay();fresh.S.getDay(day).tasks.ideal=[{id:'new',text:'新任务'}];A.completeCore({kind:'task',id:'new',day,list:'ideal',title:'新任务'},'');assert.equal(fresh.S.pointsTotal(),1);
});
test('173.5 importing legacy backups migrates once and rejects unsupported default metadata',async()=>{
 const b=browser({initial:null});await b.S.load();const old=data({settings:{idealPoints:10}});old.days['2026-10-18'].tasks.ideal=[{id:'legacy'}];assert(b.S.restoreFrom(old));assert.equal(b.S.settings().idealPoints,1);assert.equal(b.S.getDay('2026-10-18').tasks.ideal[0].points,10);
 const corrupt=copy(b.S.data());corrupt.memoIdealDefaultVersion=2;assert.equal(b.S.validate(corrupt),false);
});
test('173.5 dated deferrals preserve independent source snapshots and exactly one live continuation',async()=>{
 const b=browser();await b.S.load();const {F,A,P,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1),next=M.shiftDay(day,1);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);
 b.S.getDay(old).tasks.ideal=[{id:'copy',text:'原名称',points:10,note:'原备注',subs:[{text:'已做子项',done:true}],groups:[{name:'组',subs:[{text:'子项',done:false}]}]}];
 const ref={kind:'task',id:'copy',day:old,list:'ideal'};F.moveCore(ref,day,'ideal');F.moveCore(ref,day,'ideal');assert.equal(P.columnItems(day,'ideal').length,1);
 const current=P.find(ref);current.text='新名称';current.note='新备注';current.subs[0].text='改写';current.groups[0].subs[0].done=true;
 const historyCopy=F.deferred(old,'ideal')[0];assert.equal(historyCopy.task.text,'原名称');assert.equal(historyCopy.task.note,'原备注');assert.equal(historyCopy.task.subs[0].text,'已做子项');assert.equal(historyCopy.task.groups[0].subs[0].done,false);
 F.moveCore(ref,next,'ideal');assert.equal(F.deferred(day,'ideal')[0].task.text,'新名称');assert.equal(F.deferred(old,'ideal')[0].toDay,day);assert.equal(F.deferred(old,'ideal')[0].currentRef.day,next);
 A.completeCore({kind:'task',id:'copy',day:next,list:'ideal',title:'新名称'},'',next+'T12:00:00+08:00');assert.equal(b.S.pointsTotal(),10);assert.equal(historyCopy.task.done,undefined);
 const c=b.ctx.App.memoFinance.column(old,'ideal');assert.equal(c.done,0);assert.equal(c.total,1);assert.match(b.ctx.App.memoReport.report(old).text,/未完成；已延期至/);
 assert.throws(()=>A.completeCore({kind:'task',id:'copy',day:next,list:'ideal',title:'新名称'},''));
});
test('173.5 queue deferrals snapshot names and subitems without copying completion or rewards',async()=>{
 const b=browser();await b.S.load();const {F,M,A}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);b.S.data().queue=[{id:'q-copy',text:'旧队列名',points:7,subs:[{text:'完成子项',done:true}],assignment:{day:old,list:'ideal'}}];
 const ref={kind:'queue',id:'q-copy'};F.moveCore(ref,day,'ideal');F.moveCore(ref,day,'ideal');const q=b.S.data().queue[0];q.text='新队列名';q.subs[0].text='新子项';
 const history=F.deferred(old,'ideal');assert.equal(history.length,1);assert.equal(history[0].task.text,'旧队列名');assert.equal(history[0].task.subs[0].text,'完成子项');
 A.completeCore({kind:'queue',id:q.id,title:q.text},'',day+'T12:00:00+08:00');assert.equal(F.deferred(old,'ideal')[0].done,false);assert.equal(b.S.pointsTotal(),7);
});
test('173.5 running deferral preserves session identity, timer chunks and daily actual time',async()=>{
 const b=browser();await b.S.load();const {F,P,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1),edge=Date.parse(day+'T04:00:00+08:00');
 b.S.getDay(old).tasks.required=[{id:'clock-copy',text:'计时任务'}];const ref={kind:'task',id:'clock-copy',day:old,list:'required'},s=P.startRef(ref,edge-600000);
 assert.equal(P.timing(ref,edge).allMs,600000);const raw=JSON.stringify(P.state().sessions);F.moveCore(ref,day,'required');assert.equal(P.timing(ref,edge+600000).allMs,1200000);assert.equal(JSON.stringify(P.state().sessions),raw);assert.equal(P.dayExecutionMs(old,edge+600000),600000);assert.equal(P.dayExecutionMs(day,edge+600000),600000);assert.equal(P.state().sessions[0].id,s.id);
});
test('173.5 deferring a required task cannot turn its original day into full completion rewards',async()=>{
 const b=browser();await b.S.load();const {F,M,A}=flowHarness(b),day=M.userDay(),next=M.shiftDay(day,1);b.S.getDay(day).tasks.required=[{id:'delay',text:'延期必做'}];b.S.getDay(day).tasks.ideal=[{id:'finish',text:'其他任务',points:1}];
 F.moveCore({kind:'task',id:'delay',day,list:'required'},next,'required');A.completeCore({kind:'task',id:'finish',day,list:'ideal',title:'其他任务'},'',day+'T12:00:00+08:00',[{kind:'base',points:10},{kind:'perfect',points:20}]);
 assert.equal(b.S.pointsTotal(),1);assert.equal(b.S.getDay(day).rewards.length,0);
});
test('173.5 automatic carry is idempotent and backfill closes the continuation without duplicate reward',async()=>{
 const b=browser();await b.S.load();const {F,P,M,A}=flowHarness(b),old='2026-10-20',day='2026-10-21';financeHarness(b);
 b.S.getDay(old).tasks.required=[{id:'carry-copy',text:'必做任务'}];F.settleCore(Date.parse(day+'T05:00:00+08:00'));const count=b.S.data().ledger.length;F.settleCore(Date.parse(day+'T06:00:00+08:00'));assert.equal(F.deferred(old,'required').length,1);assert.equal(b.S.data().ledger.length,count);assert.equal(P.columnItems(day,'required').length,1);
 const ref={kind:'task',id:'carry-copy',day,list:'required'};F.moveCore(ref,old,'required');A.completeCore({kind:'task',id:ref.id,day:old,list:'required',title:'必做任务'},'',day+'T07:00:00+08:00');assert.equal(P.columnItems(day,'required').length,0);assert.equal(F.deferred(day,'required')[0].closed,true);assert.equal(b.ctx.App.memoFinance.column(day,'required').total,0);
 const raw=JSON.stringify(b.S.data().ledger);F.settleCore(Date.parse(day+'T08:00:00+08:00'));assert.equal(JSON.stringify(b.S.data().ledger),raw);assert(b.S.validate(b.S.data()));
});
test('173.5 shared meter switches after the exact threshold and preserves hourly overtime semantics',async()=>{
 const b=browser();await b.S.load();const {P}=flowHarness(b),meter=P.meterState;
 assert.equal(meter(59000,1).state,'expected');assert.equal(meter(60000,1).fill,100);assert.equal(meter(60000,1).over,false);
 const over=meter(61000,1);assert.equal(over.state,'overtime');assert.equal(over.bounded,false);assert.equal(over.fill,1/36);assert.match(over.detail,/超时 0分01秒/);
 assert.equal(meter(3660000,1).fill,100);assert.match(meter(3661000,1).detail,/1小时＋0分01秒/);assert.equal(meter(30000,0).state,'unbounded');
});
test('unified point detail nets canceled rewards without rewriting or hiding ledger events',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day=b.ctx.App.memoCore.userDay(),at=day+'T12:00:00+08:00';
 b.S.data().ledger=[
  {id:'reward',date:day,at,type:'earn-checkin',points:25,note:'打卡：合成习惯'},
  {id:'undo',date:day,at,type:'undo-earn-checkin',points:-25,note:'撤销原次积分：合成习惯',refundOf:'reward'},
  {id:'cost',date:day,at,type:'redeem',points:-60,note:'自定义支出：合成消费',itemSnapshot:{amountCents:3000,rate:2,note:'<img src=x onerror=alert(1)>'}},
  {id:'miss',date:'2026-10-28',at,type:'penalty-habit',points:-50,note:'习惯未达标扣分：合成习惯'},
  {id:'overdue1',date:'2026-10-28',at,type:'penalty-required',points:-5,note:'必做逾期：甲'},
  {id:'overdue2',date:'2026-10-28',at,type:'penalty-required',points:-5,note:'必做逾期：乙'},
  {id:'task',date:day,at,type:'earn-task',points:1,note:'任务完成'},
  {id:'habit',date:day,at,type:'earn-checkin',points:3,note:'打卡'},
  {id:'old',date:'2026-10-27',at:'2026-10-27T12:00:00+08:00',type:'redeem',points:-24,note:'历史消费'},
  {id:'unknown',date:day,type:'adjust',points:100,note:'无可靠入账时间'}
 ];
 const before=JSON.stringify(b.S.data()),html=F.accountHTML();
 assert.match(html,/有效收入 \+4 \/ 有效支出 −120 \/ 今日净变动 -116分/);
 assert.match(html,/消费 −60 \/ 扣分 −60 \/ 其他支出 −0分/);
 assert.match(html,/data-ledger-status="canceled"/);
 assert.equal((html.match(/data-ledger-id=/g)||[]).length,8);
 assert.match(html,/30.00元；比例：2分\/元/);assert.match(html,/对应原流水：reward/);
 assert.match(html,/行为日 2026-10-28/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.doesNotMatch(html,/data-ledger-id="old"|data-ledger-id="unknown"/);
 const all=F.accountHTML('all');assert.equal((all.match(/data-ledger-id=/g)||[]).length,10);
 assert.match(all,/入账时间缺失/);assert.match(all,/历史消费/);
 b.S.data().ledger.push({id:'refund',date:day,at,type:'refund-redeem',points:60,refundOf:'cost',note:'撤销支出'});
 const refunded=F.accountHTML();assert.match(refunded,/有退回记录，退款另列/);assert.doesNotMatch(refunded,/data-id="cost"/);
 b.S.data().ledger.pop();assert.equal(JSON.stringify(b.S.data()),before);
 let calls=0;b.ctx.App.memoCurrency={shop:()=>++calls};F.todayDialog();assert.equal(calls,1);
});
test('finance summary separates consumption refunds and penalties and computes historical closing',async()=>{const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b);b.S.data().ledger=[{date:'2026-10-20',type:'earn-checkin',points:10},{date:'2026-10-20',type:'redeem',points:-4},{date:'2026-10-20',type:'refund-redeem',points:4},{date:'2026-10-20',type:'penalty-required',points:-2},{date:'2026-10-21',type:'earn-ideal',points:8}];const r=F.summary('2026-10-20');assert(r.any);assert.match(r.text,/消费：-4/);assert.match(r.text,/退回：4/);assert.match(r.text,/该日结余：8分/);});
test('habit single date overrides daily plan without another reward source',async()=>{const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),d=b.S.data();d.checkins=[{id:'h',text:'喝水',days:{'2026-10-21':2}}];d.memoHabitPlans=[{habitId:'h',mode:'daily',from:'2026-10-20',list:'required',target:3},{habitId:'h',mode:'once',from:'2026-10-21',list:'extra',target:2}];assert.equal(F.plans('2026-10-21').length,1);assert.equal(F.plans('2026-10-21')[0].r.list,'extra');assert.match(F.planned('2026-10-21','extra'),/2\/2次 ✓/);assert(!F.planned('2026-10-21','extra').includes('data-mw="complete"'));d.memoHabitPlans.push({habitId:'h',mode:'once',from:'2026-10-21',hidden:true});assert.equal(F.plans('2026-10-21').length,0);assert.equal(F.plans('2026-10-22').length,1);});
test('finance note links one ledger row and preserves spending reason',async()=>{const b=browser();await b.S.load();const M=memoHarness(b),F=financeHarness(b),e={id:'expense',at:new Date().toISOString(),type:'redeem',points:-10,note:'小说',itemSnapshot:{amountCents:500,rate:2,note:'阅读'}};F.note(e);const text=M.read(M.userDay()).text;F.note(e);assert.equal(M.read(M.userDay()).text,text);assert.match(text,/小说/);assert.match(text,/5.00元/);assert.match(text,/阅读/);});

test('effective same-day totals handle redoing, spending refunds, bad habits and partial cents',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day='2026-10-29';
 const cases=[
  [[25,-25],0,0],[[25,-25,18],18,0],[[-60,60],0,0],[[-10,10],0,0],[[-60,20],0,40],[[0.3,-0.1],0.2,0],[[25,-25,25,-25],0,0]
 ];
 for(const [values,income,expense] of cases){
  b.S.data().ledger=values.map((points,i)=>({id:'x'+i,date:day,at:day+'T12:00:0'+i+'+08:00',points,
   type:i===0?(points>0?'earn-checkin':'redeem'):i===2&&values[i]===18?'earn-checkin':'reverse-entry',
   ...(i&&!(i===2&&values[i]===18)?{refundOf:'x'+(i-1)}:{})}));
  const before=JSON.stringify(b.S.data()),f=F.effectiveFlow(day);
  assert.equal(f.income,income);assert.equal(f.expense,expense);assert.equal(f.unverified,0);
  assert.equal(f.net,Number(values.reduce((n,v)=>n+v,0).toFixed(8)));
  assert.equal(Number((f.income-f.expense+f.crossDay+f.otherAdjustment).toFixed(8)),f.net);
  assert.equal(JSON.stringify(b.S.data()),before);
 }
});
test('effective totals clip 04:00 corrections by posting day without rewriting earlier earned income',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b);
 b.S.data().ledger=[
  {id:'early',date:'2026-10-20',at:'2026-10-29T03:59:59+08:00',type:'earn-checkin',points:25},
  {id:'after',date:'2026-10-20',at:'2026-10-29T04:00:00+08:00',type:'reverse-earn-checkin',points:-25,refundOf:'early'},
  {id:'cost',date:'2026-10-27',at:'2026-10-28T22:00:00+08:00',type:'redeem',points:-60},
  {id:'refund',date:'2026-10-27',at:'2026-10-29T04:01:00+08:00',type:'refund-redeem',points:60,refundOf:'cost'}
 ];
 const old=F.effectiveFlow('2026-10-28'),current=F.effectiveFlow('2026-10-29');
 assert.deepEqual([old.income,old.expense,old.net],[25,60,-35]);
 assert.deepEqual([current.income,current.expense,current.crossDay,current.net],[0,0,35,35]);
 assert.equal(F.effectiveProjection().meta.get(b.S.data().ledger[1]).status,'cross-day');
});
test('effective same-day delete restore delete chains retain their final business direction',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day='2026-10-29',at=day+'T12:00:00+08:00';
 const entries=[{id:'original',at,date:day,type:'earn-checkin',points:25},
  {id:'delete',at,date:day,type:'reverse-earn-checkin',points:-25,refundOf:'original'},
  {id:'restore',at,date:day,type:'reverse-restored-deletion',points:25,refundOf:'delete'},
  {id:'delete-again',at,date:day,type:'reverse-earn-checkin',points:-25,refundOf:'original'}];
 b.S.data().ledger=entries.slice(0,3);assert.equal(F.effectiveFlow(day).income,25);assert.equal(F.effectiveFlow(day).expense,0);
 b.S.data().ledger=entries;assert.equal(F.effectiveFlow(day).income,0);assert.equal(F.effectiveFlow(day).expense,0);assert.equal(F.effectiveFlow(day).unverified,0);
});
test('effective totals follow actual delete restore operations with append-only economic records',async()=>{
 const b=browser();await b.S.load();const {A}=actionHarness(b),F=financeHarness(b),d=b.S.data(),day='2026-10-29';
 let stamp=Date.parse(day+'T10:00:00+08:00');b.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};
 vm.runInContext(source('js/memo-economy.js'),b.ctx);b.ctx.App.memoEconomy.enableCore(stamp-3600000);
 b.S.getDay(day).tasks.ideal=[{id:'real-task',text:'合成项目',done:true}];
 d.ledger=[{id:'source',at:day+'T09:00:00+08:00',date:day,type:'earn-ideal',taskId:'real-task',points:12}];
 const deletion=A.deleteCore({kind:'task',id:'real-task',day,list:'ideal'},'',new b.ctx.Date().toISOString());
 assert.equal(F.effectiveFlow(day).income,0);assert.equal(F.effectiveFlow(day).expense,0);
 stamp+=3600000;A.restoreCore(deletion.id);assert.equal(F.effectiveFlow(day).income,12);assert.equal(F.effectiveFlow(day).expense,0);
 stamp+=3600000;A.deleteCore({kind:'task',id:'real-task',day,list:'ideal'},'',new b.ctx.Date().toISOString());
 assert.equal(F.effectiveFlow(day).income,0);assert.equal(F.effectiveFlow(day).expense,0);assert.equal(F.effectiveFlow(day).unverified,0);assert.equal(d.ledger.length,4);assert.equal(b.S.pointsTotal(),0);
});
test('old penalty settlement IDs establish exact corrections without memo text guesses',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),d=b.S.data(),day='2026-10-29',at=day+'T12:00:00+08:00';
 d.ledger=[{id:'miss',date:'2026-10-28',at,type:'penalty-habit-miss',points:-50,taskId:'h'},
  {id:'backfill',date:'2026-10-28',at,type:'refund-habit-miss',points:50,taskId:'h'},
  {id:'cancel-backfill',date:'2026-10-28',at,type:'penalty-habit-miss',points:-50,taskId:'h'},
  {id:'late',date:'2026-10-28',at,type:'penalty-required',points:-5},
  {id:'forgive',date:day,at,type:'refund-penalty',operationId:'forgive:late',points:5}];
 d.memoHabitPenalties=[{id:'settlement',habitId:'h',day:'2026-10-28',entries:['miss','backfill','cancel-backfill']}];
 d.memoFlow={settlements:[{id:'late'}]};
 const before=JSON.stringify(d),f=F.effectiveFlow(day);assert.equal(f.income,0);assert.equal(f.expense,50);assert.equal(f.penalties,50);assert.equal(f.unverified,0);assert.equal(f.net,-50);
 assert.equal(F.effectiveProjection().links.get(d.ledger[1]).id,'miss');assert.equal(JSON.stringify(d),before);
});
test('ambiguous corrections and duplicated refunds remain adjustments and preserve accounting identity',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day='2026-10-29',at=day+'T12:00:00+08:00';
 const examples=[
  [{id:'orphan',at,type:'reverse-checkin',points:-25,refundOf:'missing'}],
  [{id:'source',at,type:'redeem',points:-60},{id:'r1',at,type:'refund-redeem',points:60,refundOf:'source'},{id:'r2',at,type:'refund-redeem',points:60,refundOf:'source'}],
  [{id:'a',at,type:'reverse-checkin',points:25,refundOf:'b'},{id:'b',at,type:'reverse-checkin',points:-25,refundOf:'a'}],
  [{id:'dup',at,type:'earn-task',points:25},{id:'dup',at,type:'earn-task',points:25},{id:'r',at,type:'reverse-task',points:-25,refundOf:'dup'}],
  [{id:'source',type:'earn-task',points:25},{id:'r',at,type:'reverse-task',points:-25,refundOf:'source'}]
 ];
 for(const ledger of examples){b.S.data().ledger=ledger;const before=JSON.stringify(ledger),f=F.effectiveFlow(day);assert(f.unverified>0);assert.equal(Number((f.income-f.expense+f.crossDay+f.otherAdjustment).toFixed(8)),F.flow(day).net);assert.equal(JSON.stringify(ledger),before);}
});
test('new missed-habit and overdue refunds keep explicit links and survive import',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),d=b.S.data();vm.runInContext(source('js/memo-penalty.js'),b.ctx);
 const P=b.ctx.App.memoPenalty,day=M.userDay(),old=M.shiftDay(day,-1),now=Date.parse(day+'T12:00:00+08:00');
 d.checkins=[{id:'h',text:'合成习惯',target:1,days:{},memoPenaltyPolicies:[{from:old,mode:'miss',amount:50,target:1}]}];
 P.settleCore(now);const original=d.ledger.find(e=>e.type==='penalty-habit-miss');d.checkins[0].days[old]=1;P.settleCore(now+1000);
 assert.equal(d.ledger.find(e=>e.type==='refund-habit-miss').refundOf,original.id);
 const task={id:'late',text:'合成任务',overdueEventId:'debit'};b.S.getDay(day).tasks.required=[task];d.memoFlow.settlements=[{id:'debit',taskId:'late',title:'合成任务',points:5}];d.ledger.push({id:'debit',date:day,at:new Date(now).toISOString(),type:'penalty-required',points:-5});
 F.forgiveCore({kind:'task',id:'late',day,list:'required'},'合成纠正');assert.equal(d.ledger.find(e=>e.type==='refund-penalty').refundOf,'debit');
 const before=JSON.stringify(d.ledger);assert(b.S.validate(JSON.parse(JSON.stringify(d))));await b.S.save();const again=browser({shared:b});await again.S.load();assert.equal(JSON.stringify(again.S.data().ledger),before);
});
test('effective read-only projections preserve interest and randomized multi-day reversal totals',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b),F=financeHarness(b),d=b.S.data();vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy;E.enableCore(Date.parse('2026-10-20T12:00:00+08:00'));
 let seed=27;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 d.ledger=[];
 for(let i=0;i<80;i++){
  const points=(rand()%2?1:-1)*(rand()%200+1)/10;let day=0,previous='s'+i,sign=1;
  d.ledger.push({id:previous,date:'2026-10-25',at:'2026-10-25T12:00:00+08:00',type:points>0?'earn-task':'redeem',points});
  const count=rand()%6;for(let j=0;j<count;j++){day=Math.min(3,day+rand()%2);sign=-sign;const id='r'+i+'-'+j,date=M.shiftDay('2026-10-25',day);d.ledger.push({id,date,at:date+'T12:00:00+08:00',type:'reverse-entry',points:sign*points,refundOf:previous});previous=id;}
 }
 const before=JSON.stringify(d),balance=b.S.pointsTotal(),interest=E.balanceAt(Date.parse('2026-10-29T04:00:00+08:00'));
 for(let i=0;i<4;i++){const day=M.shiftDay('2026-10-25',i),f=F.effectiveFlow(day);assert.equal(f.unverified,0);assert(f.income>=0&&f.expense>=0);assert.equal(Number((f.income-f.expense+f.crossDay+f.otherAdjustment).toFixed(8)),F.flow(day).net);}
 assert.equal(b.S.pointsTotal(),balance);assert.equal(E.balanceAt(Date.parse('2026-10-29T04:00:00+08:00')),interest);assert.equal(JSON.stringify(d),before);
});

test('numeric increments preserve current values cents caps and reject invalid text',()=>{const ctx={App:{}};ctx.window=ctx;vm.runInNewContext(source('js/memo-controls.js'),ctx);const add=ctx.App.memoNumbers.add;assert.equal(add('',5),5);assert.equal(add(10,5),15);assert.equal(add('0.10',1),1.1);assert.equal(add(1430,60,1440),1440);assert.throws(()=>add('invalid',1));});
test('habit timing resolves original habit and separates day estimates',async()=>{const b=browser();await b.S.load();const {P,M}=flowHarness(b),day=M.userDay();b.S.data().checkins=[{id:'habit-clock',text:'计时习惯',days:{},memoEstimatedDays:{[day]:25}}];assert.equal(P.find({kind:'checkin',id:'habit-clock',day}).memoEstimatedDays[day],25);assert.notEqual(P.key({kind:'checkin',id:'habit-clock',day}),P.key({kind:'checkin',id:'habit-clock',day:M.shiftDay(day,-1)}));});
test('editor save-and-start retries each persistence stage without duplicate tasks or sessions',async()=>{
 for(const failAt of [1,2]){
  const b=browser();await b.S.load();const {A,P,M}=flowHarness(b);b.ctx.App.memo.flush=async()=>true;P.render=()=>{};let handlers,closed=false;const nodes={};const make=()=>({value:'',disabled:false,hidden:false,textContent:'',isConnected:true,focus(){},addEventListener(){}});['#mw-title','#mw-note-edit','#mw-points','#mw-estimate','#mw-start','#mw-end','#mw-form-error'].forEach(k=>nodes[k]=make());const buttons={};['cancel','save','save-start','convert','delete'].forEach(k=>buttons[k]=make());const modal={classList:{add(){}},querySelector:s=>nodes[s]||buttons[s.match(/^\[data-act="([^"]+)"\]$/)?.[1]]||null,querySelectorAll:s=>s==='.modal-actions button'?Object.values(buttons):Object.values(nodes)};
  b.ctx.App.ui={dateContext(){},openModal:()=>modal,bindActions:h=>handlers=h,closeModal:()=>{closed=true;},toast:()=>{}};vm.runInContext(source('js/memo-workspace.js'),b.ctx);b.ctx.App.memoWorkspace.editor(null,'ideal');nodes['#mw-title'].value='只创建一次';nodes['#mw-estimate'].value='25';const original=b.S.save;let calls=0;b.S.save=async()=>++calls===failAt?false:original();
  await handlers['save-start'](buttons['save-start']);assert.equal(closed,false);assert.equal(A.busy(),true);assert.equal(b.S.getDay(M.userDay()).tasks.ideal.filter(t=>t.text==='只创建一次').length,1);
  await handlers['save-start'](buttons['save-start']);assert.equal(closed,true);assert.equal(A.busy(),false);assert.equal(b.S.getDay(M.userDay()).tasks.ideal.filter(t=>t.text==='只创建一次').length,1);assert.equal(P.state().sessions.filter(s=>s.status==='running').length,1);
 }
});
test('editor validation rollback can retry changes to the current stored task',async()=>{
 const b=browser();await b.S.load();const {A,P,M}=flowHarness(b);b.ctx.App.memo.flush=async()=>true;P.render=()=>{};let handlers,closed=false;const nodes={};const make=()=>({value:'',disabled:false,hidden:false,textContent:'',isConnected:true,focus(){},addEventListener(){}});['#mw-title','#mw-note-edit','#mw-points','#mw-estimate','#mw-start','#mw-end','#mw-form-error'].forEach(k=>nodes[k]=make());const buttons={};['cancel','save','save-start','convert','delete'].forEach(k=>buttons[k]=make());const modal={classList:{add(){}},querySelector:s=>nodes[s]||buttons[s.match(/^\[data-act="([^"]+)"\]$/)?.[1]]||null,querySelectorAll:s=>s==='.modal-actions button'?Object.values(buttons):Object.values(nodes)};
 const day=M.userDay(),ref={kind:'task',id:'retry-edit',day,list:'ideal'};b.S.getDay(day).tasks.ideal.push({id:ref.id,text:'原名称',points:5});b.ctx.App.ui={dateContext(){},openModal:()=>modal,bindActions:h=>handlers=h,closeModal:()=>closed=true,toast:()=>{}};vm.runInContext(source('js/memo-workspace.js'),b.ctx);b.ctx.App.memoWorkspace.editor(ref);nodes['#mw-title'].value='第一次修改';nodes['#mw-end'].value='14:00';await handlers.save(buttons.save);assert.equal(closed,false);assert.equal(P.find(ref).text,'原名称');assert.equal(A.busy(),false);nodes['#mw-end'].value='';nodes['#mw-title'].value='修正后的名称';await handlers.save(buttons.save);assert.equal(closed,true);assert.equal(P.find(ref).text,'修正后的名称');
});

test('same-day category change preserves running timer, task identity and historical ledger',async()=>{
 const b=browser();await b.S.load();const {F,P}=flowHarness(b);const day='2026-10-20',t={id:'category',text:'分类',memoGroup:'reading',points:5};b.S.getDay(day).tasks.extra.push(t);b.S.data().ledger.push({id:'history',points:12});const ref={kind:'task',id:t.id,day,list:'extra'},session=P.startRef(ref);F.moveCore(ref,day,'required');assert.equal(P.find(ref).id,t.id);assert.equal(P.find(ref).memoGroup,'reading');assert.equal(P.canonical(ref).list,'required');assert.equal(P.state().sessions.find(s=>s.id===session.id).status,'running');assert.equal(b.S.data().ledger.length,1);assert.equal(b.S.pointsTotal(),12);
});
test('wishlist refund restores removed item and keeps original cents exactly once',async()=>{
 const b=browser();await b.S.load();const {C}=flowHarness(b);const w={id:'wish',name:'书',cents:3001};C.spendCore(C.spendQuote('money','30.01','书'),'wish-buy');const e=b.S.data().ledger.find(x=>x.operationId==='wish-buy');e.wishId=w.id;e.wishSnapshot=copy(w);b.S.data().memoWishes=[{...w,purchase:e.id,paid:60.02,hidden:true}];assert.equal(b.S.pointsTotal(),-60.02);C.refundCore(e.id);C.refundCore(e.id);assert.equal(b.S.pointsTotal(),0);assert.deepEqual(copy(b.S.data().memoWishes),[w]);assert.equal(b.S.data().ledger.filter(x=>x.refundOf===e.id).length,1);
});

test('bounty threshold is inclusive and grouping has independent stable regions',async()=>{
 const b=browser();await b.S.load();flowHarness(b);b.ctx.document={addEventListener(){}};vm.runInContext(source('js/memo-organize.js'),b.ctx);const O=b.ctx.App.memoOrganize;assert(!O.bounty(29.99));assert(O.bounty(30));assert(O.bounty(30.01));assert(!O.bounty(null));b.S.settings().memoBountyThreshold=50;assert(!O.bounty(30));assert(O.bounty(50));b.S.data().memoTaskGroups=[{id:'g',name:'组'}];const rows=[{task:{id:'a',memoGroup:'g'}}],render=rows=>rows.map(x=>x.task.id).join('');let full=O.grouped(rows,render),mini=O.grouped(rows,render,true);assert.match(full,/data-family="full:g"/);assert.match(mini,/data-family="overview:g"/);b.ctx.localStorage.setItem('task-group:overview:g','closed');mini=O.grouped(rows,render,true);assert.doesNotMatch(mini,/data-family-id="g" open/);assert.match(O.grouped(rows,render),/data-family-id="g" open/);assert.deepEqual(copy(rows),[{task:{id:'a',memoGroup:'g'}}]);
});
test('dense timeline groups collision details without mutating records or totals',async()=>{
 const b=browser();await b.S.load();const {P}=scheduleHarness(b);const rows=Array.from({length:8},(_,i)=>({id:String(i),card:'c-'+i,title:'任务'+i,start:10+i*.1,end:10+i*.1+.001,realEnd:10+i*.1,completed:true,type:'point'})),old=JSON.stringify(rows),out=P.denseLayout(rows,3,1,true);assert.equal(out.length,1);assert.equal(out[0].members.length,8);assert.equal(JSON.stringify(rows),old);assert.equal(out[0].title,'完成 8 项');const spans=[{id:'a',start:0,end:60,realEnd:60},{id:'b',start:1,end:50,realEnd:50},{id:'c',start:2,end:40,realEnd:40}];assert.equal(P.denseLayout(spans,1,2)[0].members.length,3);assert.equal(P.denseLayout([{id:'x',start:90,end:95,realEnd:95}],1,1)[0].realEnd,95);
});
test('unscheduled excludes stopped, completed and other-day tasks, uses whole-day plans',async()=>{
 const b=browser();await b.S.load();const {P,M}=flowHarness(b),day=M.userDay();b.S.data().queue=[{id:'free',text:'未分配'},{id:'other',text:'别日',assignment:{day:M.shiftDay(day,1),list:'ideal'}},{id:'today',text:'今日',assignment:{day,list:'ideal'}},{id:'stop',text:'停用',archived:true}];b.S.data().daily=[{id:'old',text:'停用基础',archived:true}];let rows=P.unscheduled(day);assert.deepEqual(Array.from(rows,x=>x.ref.id).sort(),['free','today']);P.savePlan({ref:{kind:'queue',id:'today'},day,title:'今日',type:'point',start:Date.parse(day+'T23:00:00+08:00')});assert.deepEqual(Array.from(P.unscheduled(day),x=>x.ref.id),['free']);assert.equal(b.S.data().ledger.length,0);
});
test('thought stamp preserves user day at midnight and leaves timers and copy wording alone',async()=>{
 const b=browser();await b.S.load();const {M,P}=flowHarness(b);vm.runInContext(source('js/memo-rest.js'),b.ctx);const now=Date.parse('2026-10-27T02:03:00+08:00');b.S.data().queue=[{id:'think',text:'任务'}];const session=P.startRef({kind:'queue',id:'think'},now-60000),r=b.ctx.App.memoRest.stampCore(now,'【思考/建设】');assert.equal(r.day,'2026-10-26');assert.match(M.read(r.day).text,/次日0203 【思考\/建设】\n$/);assert.equal(session.status,'running');assert.equal(b.S.data().ledger.length,0);
});

test('timer totals retain ended runs while pause resumes the current run across reload',async()=>{
 const b=browser();await b.S.load();const {P}=flowHarness(b);b.S.data().queue=[{id:'total',text:'累计'}];const ref={kind:'queue',id:'total'},base=Date.now()-3600000;let first=P.startRef(ref,base);P.stopRef(ref,base+1500000);let second=P.startRef(ref,base+1800000);assert.notEqual(first.id,second.id);P.pauseCore(second,base+2100000);let t=P.timing(ref,base+2400000);assert.equal(t.totalMs,1800000);assert.equal(t.currentMs,300000);assert.equal(P.startRef(ref,base+2400000).id,second.id);P.pauseCore(second,base+2580000);t=P.timing(ref,base+2700000);assert.equal(t.totalMs,1980000);assert.equal(t.currentMs,480000);P.stopRef(ref,base+2700000);assert.match(P.rowControls(ref),/累计 0:33:00/);assert.match(P.rowControls(ref),/上次 0:08:00/);await b.S.save();const next=browser({shared:b});await next.S.load();const h=flowHarness(next);assert.equal(h.P.timing(ref).totalMs,1980000);
});
test('timer aggregation prefers running session over a newer paused plan and clips daily boundaries',async()=>{
 const b=browser();await b.S.load();const {P}=flowHarness(b),day='2026-10-26',base=Date.parse(day+'T04:00:00+08:00');b.S.data().memoProjects=[{id:'daily-total',text:'推进',days:{}}];const ref={kind:'project',id:'daily-total',day},s=P.startRef(ref,base-60000);P.pauseCore(s,base+120000);const run=P.startRef(ref,base+180000,'plan-a');P.state().sessions.push({id:'later-paused',ref,itemId:'plan-b',status:'paused',title:'推进',chunks:[{start:base+240000,end:base+300000}]});await b.S.save();const t=P.timing(ref,base+360000);assert.equal(t.session.id,run.id);assert.equal(t.totalMs,300000);assert.equal(t.currentMs,180000);assert.equal(P.timing({...ref,day:'2026-10-27'},base+360000).totalMs,0);
});


test('user-day actual task timing unions overlaps and clips precisely at 04:00', async () => {
  const b = browser(); await b.S.load(); const { P } = flowHarness(b);
  const start = Date.parse('2026-10-27T04:00:00+08:00');
  P.state().sessions.push(
    { id: 'one', ref: { kind: 'queue', id: 'a' }, title: 'A', status: 'ended', chunks: [{ start: start - 600000, end: start + 1200000 }] },
    { id: 'two', ref: { kind: 'queue', id: 'b' }, title: 'B', status: 'ended', chunks: [{ start: start + 600000, end: start + 2400000 }] }
  );
  assert.equal(P.dayExecutionMs('2026-10-26', start + 3600000), 600000);
  assert.equal(P.dayExecutionMs('2026-10-27', start + 3600000), 2400000);
  assert.equal(P.dayExecutionMs('2026-10-27', start + 900000), 900000);
});

test('import validation rejects broken memo collections without replacing original records', async () => {
  const b = browser(); await b.S.load();
  const baseline = JSON.stringify(b.S.data());
  const invalid = copy(b.S.data());
  invalid.memoSchedule = { version: 1, items: [], sessions: [{ status: 'running', ref: null, chunks: [{ start: 123, end: null }] }] };
  assert.equal(b.S.validate(invalid), false);
  assert.equal(b.S.restoreFrom(invalid), false);
  assert.equal(JSON.stringify(b.S.data()), baseline);
  const invalidQueue = copy(b.S.data());
  invalidQueue.queue = { id: 'not-an-array' };
  assert.equal(b.S.validate(invalidQueue), false);
});


test('habit missed-day penalty is prospective, at most once, and refunds exactly on backfill', async () => {
  const b=browser(); await b.S.load();
  memoHarness(b);
  vm.runInContext(source('js/memo-penalty.js'), b.ctx);
  const P=b.ctx.App.memoPenalty, d=b.S.data(), h={id:'sleep',text:'早睡',target:1,points:0,days:{}};
  d.checkins=[h];
  P.configure(h,'miss',5,1,'2026-10-20');
  const before=Date.parse('2026-10-21T03:59:59+08:00'),after=Date.parse('2026-10-21T04:00:00+08:00');
  assert.equal(P.hasPending(before),false);
  assert.equal(P.hasPending(after),true);
  assert.equal(P.settleCore(after),1);
  assert.equal(b.S.pointsTotal(),-5);
  assert.equal(P.settleCore(after),0);
  assert.equal(d.ledger.filter(x=>x.type==='penalty-habit-miss').length,1);
  h.days['2026-10-20']=1;
  assert.equal(P.hasPending(after),true);
  assert.equal(P.settleCore(after),1);
  assert.equal(b.S.pointsTotal(),0);
  assert.equal(P.settleCore(after),0);
  delete h.days['2026-10-20'];
  assert.equal(P.settleCore(after),1);
  assert.equal(b.S.pointsTotal(),-5);
  await b.S.save();
  const reloaded=browser({shared:b}); await reloaded.S.load();
  assert.equal(reloaded.S.pointsTotal(),-5);
  assert.equal(reloaded.S.data().memoHabitPenalties.length,1);
});
test('bad habit negative punch uses the same event and can be undone without giving streak points', async () => {
  const b=browser(); await b.S.load(); const {A}=actionHarness(b);
  vm.runInContext(source('js/memo-penalty.js'), b.ctx);
  const P=b.ctx.App.memoPenalty, h={id:'bad',text:'刷短视频',points:0,target:0,days:{}};
  b.S.data().checkins=[h];
  P.configure(h,'punch',7,0,'2026-10-19');
  b.ctx.App.checkin.memoPoints=(item,day)=>P.policy(item,day).mode==='punch'?-P.policy(item,day).amount:0;
  const e=A.completeCore({kind:'checkin',id:'bad',day:'2026-10-19',title:h.text},'',actionAt);
  assert.equal(e.points,-7);
  assert.equal(b.S.pointsTotal(),-7);
  assert.equal(b.S.data().ledger.at(-1).type,'penalty-habit-punch');
  A.undoCore(e.id,'误点',actionAt);
  assert.equal(b.S.pointsTotal(),0);
  assert.equal(h.days['2026-10-19'],undefined);
});
test('malformed penalty rules are rejected before restoring an old backup', async () => {
  const b=browser(); await b.S.load();
  const bad=copy(b.S.data());
  bad.checkins=[{id:'h',text:'x',days:{},memoPenaltyPolicies:[{mode:'miss',amount:-5,target:1,from:'2026-10-20'}]}];
  assert.equal(b.S.validate(bad),false);
  assert.equal(b.S.restoreFrom(bad),false);
});

test('archiving a penalty habit pauses deductions and restoring never back-charges inactive days', async () => {
  const b=browser(); await b.S.load(); memoHarness(b);
  vm.runInContext(source('js/memo-penalty.js'),b.ctx);
  const P=b.ctx.App.memoPenalty, h={id:'s',text:'早睡',points:0,target:1,days:{},
    memoPenaltyStops:[{from:'2026-10-21',until:'2026-10-23'}]};
  b.S.data().checkins=[h]; P.configure(h,'miss',3,1,'2026-10-20');
  const now=Date.parse('2026-10-24T04:00:00+08:00');
  assert.equal(P.settleCore(now),2);
  assert.deepEqual(Array.from(b.S.data().ledger.map(e=>e.date)),['2026-10-20','2026-10-23']);
  assert.equal(b.S.pointsTotal(),-6);
  assert.equal(P.settleCore(now),0);
});


test('173 individual streak stays half, then three-quarter, then full, respecting 99 reward punches',async()=>{
 const b=browser();await b.S.load();memoHarness(b);
 vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy;E.enableCore(Date.parse('2026-10-27T10:00:00+08:00'));
 const h={id:'repeat',points:10,target:1,rewardLimit:99,days:{}};
 const M=b.ctx.App.memoCore,start='2026-10-28';
 assert.equal(E.quote(h,start).total,5);
 h.days[start]=1;
 assert.equal(E.quote(h,'2026-10-29').total,5);
 h.days['2026-10-29']=1;
 assert.equal(E.quote(h,'2026-10-30').total,7.5);
 for(let i=30;i<=31;i++)h.days['2026-10-'+i]=1;
 for(let i=1;i<=2;i++)h.days['2026-11-0'+i]=1;
 assert.equal(E.quote(h,'2026-11-03').total,10);
 h.days['2026-11-03']=1;
 assert.equal(E.quote(h,'2026-11-05').total,5,'a missed day resets the rate');
 h.days['2026-11-05']=1;
 assert.equal(E.quote(h,'2026-11-05').total,5);
 h.days['2026-11-05']=98;
 assert.equal(E.quote(h,'2026-11-05').total,5);
 h.days['2026-11-05']=99;
 assert.equal(E.quote(h,'2026-11-05').total,0);
});
test('173 monthly interest settles once, uses partial first month and does not rewrite after late backfill',async()=>{
 const b=browser();await b.S.load();memoHarness(b);
 vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy,d=b.S.data();
 d.ledger.push({id:'old',type:'adjust',points:100,at:'2026-10-25T04:00:00Z'});
 E.enableCore(Date.parse('2026-10-27T10:00:00+08:00'));
 assert.equal(E.state().startedDay,'2026-10-28');
 d.ledger.push({id:'spent',type:'redeem',points:-50,at:'2026-10-29T10:00:00+08:00'});
 const at=Date.parse('2026-11-01T04:00:00+08:00');
 assert.equal(E.hasPending(at),true);
 assert.equal(E.settleCore(at),1);
 assert.equal(E.state().settlements[0].positive,0.16);
 assert.equal(E.settleCore(at),0);
 assert.equal(E.state().settlements.length,1);
 assert.equal(b.S.pointsTotal(),50.16);
 d.ledger.push({id:'late',date:'2026-10-28',type:'earn-checkin',points:1000,at:'2026-11-03T10:00:00+08:00'});
 assert.equal(E.state().settlements[0].positive,0.16);
 assert.equal(E.balanceAt(Date.parse('2026-11-01T04:00:00+08:00')),50.16);
 await b.S.save();const recovered=browser({shared:b});await recovered.S.load();
 assert.equal(recovered.S.data().memoEconomy.settlements.length,1);
});
test('173 negative interest charges four percent per month with no amount cap',async()=>{
 const b=browser();await b.S.load();memoHarness(b);vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy;b.S.data().ledger.push({id:'debt',points:-1000,at:'2026-10-25T00:00:00Z'});
 E.enableCore(Date.parse('2026-10-27T10:00:00+08:00'));
 E.settleCore(Date.parse('2026-11-01T04:00:00+08:00'));
 assert.equal(E.state().settlements[0].negative,-5.16);
 assert.equal(b.S.pointsTotal(),-1005.16);
});
test('173 cancellation adds a compensating ledger entry and preserves the original after bank activation',async()=>{
 const b=browser();await b.S.load();const {A}=actionHarness(b);
 vm.runInContext(source('js/memo-economy.js'),b.ctx);
 b.ctx.App.memoEconomy.enableCore(Date.parse('2026-10-18T10:00:00+08:00'));
 b.S.data().checkins=[{id:'h',text:'check',target:1,points:7,days:{}}];
 const event=A.completeCore({kind:'checkin',id:'h',day:'2026-10-19',title:'check'},'记录',actionAt);
 assert.equal(b.S.pointsTotal(),14);
 A.undoCore(event.id,'误点','2026-10-20T09:00:00Z');
 assert.equal(b.S.pointsTotal(),0);
 assert.equal(b.S.data().ledger.length,2);
 assert.equal(b.S.data().ledger[0].points,14);
 assert.equal(b.S.data().ledger[1].points,-14);
 assert.match(b.S.data().ledger[1].operationId,/undo-event/);
});
test('173 malformed bank and duplicate settled month are rejected by backup validator',async()=>{
 const b=browser();await b.S.load();const d=copy(b.S.data());
 d.memoEconomy={version:1,startedDay:'2026-10-27',enabledAt:'2026-10-27T00:00:00Z',
  openingBalance:10,positiveRate:.02,negativeRate:.04,settlements:[
  {month:'2026-10',positive:1,negative:0,effectiveAt:'2026-11-01T00:00:00Z',postedAt:'2026-11-01T01:00:00Z'},
  {month:'2026-10',positive:1,negative:0,effectiveAt:'2026-11-01T00:00:00Z',postedAt:'2026-11-01T01:00:00Z'}]};
 assert.equal(b.S.validate(d),false);
});
test('173 supervised bad habit appears in a three-column plan but is never completed',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day=b.ctx.App.memoCore.userDay();
 b.ctx.App.memoPenalty={policy:()=>({mode:'punch',amount:7})};
 b.ctx.App.checkin={memoPoints:()=>-7};
 b.S.data().checkins=[{id:'b',text:'刷视频',target:0,points:0,days:{[day]:3}}];
 b.S.data().memoHabitPlans=[{id:'p',habitId:'b',mode:'daily',from:day,list:'required',target:1}];
 assert.match(F.planned(day,'required',false),/刷视频/);
 assert.match(F.planned(day,'required',false),/-7分/);
 assert.equal(F.planned(day,'required',true),'');
});


test('173 legacy ledger undo posts one current-date reversal after bank activation',async()=>{
 const b=browser();await b.S.load();memoHarness(b);vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy, d=b.S.data();
 d.ledger.push({id:'prior',date:'2026-10-20',at:'2026-10-20T05:00:00Z',type:'earn-ideal',points:70});
 E.enableCore(Date.parse('2026-10-27T10:00:00+08:00'));
 assert.equal(b.S.undoLastLedger('prior'),true);
 assert.equal(b.S.pointsTotal(),0);
 assert.equal(d.ledger.length,2);
 assert.equal(d.ledger[0].points,70);
 assert.equal(d.ledger[1].points,-70);
 assert.equal(b.S.undoLastLedger('prior'),false);
 assert.equal(d.ledger.length,2);
});


test('173 deleting, restoring and deleting a legacy task never erases historical ledger rows',async()=>{
 const b=browser();await b.S.load();const {A}=actionHarness(b);
 vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const d=b.S.data(),day='2026-10-19',at='2026-10-20T10:00:00+08:00';
 d.days[day]=b.S.getDay(day);
 d.days[day].tasks.ideal=[{id:'task-x',text:'项目',done:true}];
 d.ledger.push({id:'legacy-earn',date:day,type:'earn-ideal',taskId:'task-x',points:12,at:'2026-10-19T09:00:00+08:00'});
 b.ctx.App.memoEconomy.enableCore(Date.parse('2026-10-20T09:00:00+08:00'));
 const a=A.deleteCore({kind:'task',id:'task-x',day,list:'ideal'},'',at);
 assert.equal(b.S.pointsTotal(),0);
 assert.equal(d.ledger.length,2);
 A.restoreCore(a.id);
 assert.equal(b.S.pointsTotal(),12);
 assert.equal(d.ledger.length,3);
 A.deleteCore({kind:'task',id:'task-x',day,list:'ideal'},'','2026-10-22T10:00:00+08:00');
 assert.equal(b.S.pointsTotal(),0);
 assert.equal(d.ledger.length,4);
 assert.equal(d.ledger[0].points,12);
});
test('173 several closed months compound without repeating past interest on revisit',async()=>{
 const b=browser();await b.S.load();memoHarness(b);vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy;
 b.S.data().ledger.push({id:'base',type:'adjust',at:'2026-10-20T10:00:00Z',points:-1000});
 E.enableCore(Date.parse('2026-10-27T10:00:00+08:00'));
 assert.equal(E.settleCore(Date.parse('2027-01-01T04:00:00+08:00')),3);
 const months=E.state().settlements.map(x=>x.month);
 assert.deepEqual(Array.from(months),['2026-10','2026-11','2026-12']);
 assert(E.state().settlements[2].negative < E.state().settlements[1].negative);
 const count=b.S.data().ledger.length;
 assert.equal(E.settleCore(Date.parse('2027-01-01T04:00:00+08:00')),0);
 assert.equal(b.S.data().ledger.length,count);
});


test('173 a goal of one and 99 paid punches stays directly accessible in all three-column views',async()=>{
 const b=browser();await b.S.load();memoHarness(b);const F=financeHarness(b),day=b.ctx.App.memoCore.userDay();
 b.ctx.App.checkin={memoPoints:()=>2};
 b.S.data().checkins=[{id:'reset',text:'重置',points:2,target:1,rewardLimit:99,days:{[day]:1}}];
 b.S.data().memoHabitPlans=[{id:'daily',habitId:'reset',mode:'daily',from:day,list:'required',target:1}];
 assert.match(F.planned(day,'required',false),/可奖励 98次/);
 assert.equal(F.planned(day,'required',true),'');
 b.S.data().checkins[0].days[day]=99;
 assert.match(F.planned(day,'required',false),/habit-plan-goal-done/);
 assert.match(F.planned(day,'required',false),/仅记录/);
 assert.equal(F.planned(day,'required',true),'');
});


test('173 activation snapshot does not double count same-millisecond old entries but includes new entries',async()=>{
 const b=browser();await b.S.load();memoHarness(b);vm.runInContext(source('js/memo-economy.js'),b.ctx);
 const E=b.ctx.App.memoEconomy,at='2026-10-27T02:00:00.000Z',d=b.S.data();
 d.ledger.push({id:'already-there',at,points:100,type:'adjust'});
 E.enableCore(Date.parse(at));
 assert.equal(E.state().openingBalance,100);
 d.ledger.push({id:'after-init',at,points:20,type:'adjust'});
 assert.equal(E.balanceAt(Date.parse('2026-10-29T04:00:00+08:00')),120);
});

test('173.2 one session crossing 04:00 splits daily time and retains full current duration', async () => {
 const b=browser();await b.S.load();const {P,M}=flowHarness(b),day='2026-10-26',next=M.shiftDay(day,1),edge=Date.parse(next+'T04:00:00+08:00');
 b.S.data().queue=[{id:'cross-day',text:'分日执行'}];const ref={kind:'queue',id:'cross-day'};
 const run=P.startRef(ref,edge-20*60000);P.pauseCore(run,edge+20*60000);
 const before=JSON.stringify(b.S.data().ledger),t=P.timing(ref,edge+30*60000);
 assert.equal(t.todayMs,20*60000);assert.equal(t.allMs,40*60000);assert.equal(t.currentMs,40*60000);
 assert.equal(P.dayExecutionMs(day,edge+30*60000),20*60000);assert.equal(P.dayExecutionMs(next,edge+30*60000),20*60000);
 assert.equal(P.startRef(ref,edge+60*60000).id,run.id);P.pauseCore(run,edge+70*60000);
 assert.equal(P.timing(ref,edge+80*60000).currentMs,50*60000);assert.equal(JSON.stringify(b.S.data().ledger),before);
 await b.S.save();const again=browser({shared:b});await again.S.load();const h=flowHarness(again);
 assert.equal(h.P.timing(ref,edge+80*60000).allMs,50*60000);
});

test('173.2 dated repeat references share time statistics without moving completion or ledger dates', async () => {
 const b=browser();await b.S.load();const {P,M}=flowHarness(b),day='2026-10-26',next=M.shiftDay(day,1),edge=Date.parse(next+'T04:00:00+08:00');
 b.S.data().memoProjects=[{id:'daily-cross',text:'每日推进原规则',days:{}}];const old={kind:'project',id:'daily-cross',day},today={...old,day:next};
 const run=P.startRef(old,edge-20*60000);assert.equal(P.startRef(today,edge+10*60000).id,run.id);
 const before=JSON.stringify(b.S.data().memoProjects),t=P.timing(today,edge+20*60000);
 assert.equal(t.totalMs,20*60000);assert.equal(t.allMs,40*60000);assert.equal(t.currentMs,40*60000);
 assert.equal(P.timing(old,edge+20*60000).totalMs,20*60000);assert.notEqual(P.key(old),P.key(today));
 P.stopRef(today,edge+20*60000);assert.equal(run.status,'ended');assert.equal(run.ref.day,day);
 assert.equal(JSON.stringify(b.S.data().memoProjects),before);assert.equal(b.S.data().ledger.length,0);
});

test('173.2 explicit rescheduling retains timer totals while same-title copies remain independent', async () => {
 const b=browser();await b.S.load();const {P,M,F}=flowHarness(b),day=M.userDay(),next=M.shiftDay(day,1),base=Date.now()-3600000;
 b.S.getDay(day).tasks.ideal=[{id:'move-clock',text:'相同标题',points:3}];const ref={kind:'task',id:'move-clock',day,list:'ideal'};
 const run=P.startRef(ref,base);P.stopRef(ref,base+600000);assert.equal(P.timing(ref).allMs,600000);
 F.moveCore(ref,next,'ideal');b.S.getDay(next).tasks.ideal.push({id:'copy-clock',text:'相同标题',points:3});await b.S.save();
 assert.equal(P.timing({...ref,day:next}).allMs,600000);assert.equal(P.timing({kind:'task',id:'copy-clock',day:next,list:'ideal'}).allMs,0);
 assert.equal(P.timing(ref).allMs,600000);assert.equal(run.ref.day,day);assert.equal(b.S.data().ledger.length,0);
});

test('173.3 signed posting-day flows separate backfill and effective interest dates at 04:00',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b),F=financeHarness(b),day=M.userDay(),old=M.shiftDay(day,-1),base=Date.parse(day+'T04:00:00+08:00');
 b.S.data().ledger=[{id:'pre',date:day,at:new Date(base-1).toISOString(),points:99,type:'earn-task'},{id:'backfill',date:old,at:new Date(base).toISOString(),points:120,type:'earn-checkin'},{id:'expense',date:day,at:new Date(base+1).toISOString(),points:-50,type:'redeem'},{id:'reverse',date:old,at:new Date(base+2).toISOString(),points:10,type:'reverse-penalty'},{id:'interest',date:old,at:new Date(base+3).toISOString(),effectiveAt:old+'T04:00:00+08:00',points:-0.25,type:'interest-negative'},{id:'zero',date:day,at:new Date(base+4).toISOString(),points:0,type:'earn-checkin'},{id:'legacy',date:day,points:600,type:'earn-task'}];
 const before=JSON.stringify(b.S.data().ledger),f=F.flow(day);assert.equal(f.income,130);assert.equal(f.expense,50.25);assert.equal(f.net,79.75);assert.equal(f.unknown,1);assert.equal(f.rows.length,5);assert.equal(F.flow(old).income,99);assert.match(F.postingSummary(day).text,new RegExp('行为日 '+old));assert.equal(JSON.stringify(b.S.data().ledger),before);
});
test('173.3 completion freezes second-level intervals, excludes pauses and unions overlap',async()=>{
 const b=browser();await b.S.load();const {A,P,M}=flowHarness(b),day=M.userDay(),base=Date.parse(day+'T08:00:00+08:00'),ref={kind:'queue',id:'segments'};
 b.S.data().queue=[{id:'segments',text:'分段任务',estimatedMinutes:40}];const s=P.startRef(ref,base);P.pauseCore(s,base+600000);P.startRef(ref,base+900000);P.stopRef(ref,base+1200000);P.state().sessions.push({id:'overlap',ref,status:'ended',title:'重合',chunks:[{start:base+300000,end:base+660000}]});
 const raw=JSON.stringify(P.state().sessions),snap=A.timingSnapshot(ref,base+1800000);assert.equal(snap.actualMs,960000);assert.equal(snap.segments.length,3);assert.match(snap.executionText,/08:00:00 — .*08:10:00/);assert.match(snap.executionText,/重合/);assert.equal(JSON.stringify(P.state().sessions),raw);
 const e=A.completeCore({...ref,title:'分段任务'},snap.text,new Date(base+1800000).toISOString()),frozen=JSON.stringify(e.timing);b.S.data().queueDone[0].estimatedMinutes=200;b.S.data().queueDone[0].text='修改后的任务';assert.equal(JSON.stringify(e.timing),frozen);assert.match(M.exportText([day]),/片段/);
});
test('173.3 repeat snapshots contain new intervals and clip at 04:00 without rewriting chunks',async()=>{
 const b=browser();await b.S.load();const {A,P,M}=flowHarness(b),day=M.userDay(),base=Date.parse(day+'T04:00:00+08:00'),ref={kind:'checkin',id:'repeat',day};b.S.data().checkins=[{id:'repeat',text:'重复学习',points:2,target:20,days:{}}];const run=P.startRef(ref,base-300000);P.pauseCore(run,base+1500000);
 const first=A.completeCore({...ref,title:'重复学习'},'',new Date(base+1500000).toISOString());assert.equal(first.timing.actualMs,1500000);assert.equal(first.timing.newMs,1500000);assert.equal(first.timing.segments[0].start,base);
 P.startRef(ref,base+1800000);const second=A.completeCore({...ref,title:'重复学习'},'',new Date(base+2880000).toISOString());assert.equal(second.timing.actualMs,2580000);assert.equal(second.timing.newMs,1080000);assert.equal(second.timing.addedSegments.length,1);assert.match(second.timing.executionText,/本次新增计时：18分0秒.*累计：43分0秒/);assert.equal(P.state().sessions[0].chunks[0].start,base-300000);assert.equal(A.timingSnapshot(ref,base+3000000).newMs,0);
});
test('173.3 column and copy counts exclude supervision and use explicit day targets for optional habits',async()=>{
 const b=browser();await b.S.load();const {M}=flowHarness(b),day=M.userDay(),F=financeHarness(b);vm.runInContext(source('js/memo-penalty.js'),b.ctx);vm.runInContext(source('js/memo-report.js'),b.ctx);
 b.S.getDay(day).tasks.required=[{id:'done',text:'完成父任务',done:true,subs:[{done:true},{done:true}]},{id:'move',text:'移出',memoMovedTo:{kind:'queue',id:'missing'}},{id:'proxy',text:'别名',fromQueue:'assigned'}];b.S.data().queue=[{id:'assigned',text:'已安排队列',assignment:{day,list:'required'}}];
 b.S.data().checkins=[{id:'bad',text:'坏习惯监督',target:1,days:{[day]:10},memoPenaltyPolicies:[{from:day,mode:'punch',amount:2,target:1}]},{id:'optional',text:'选做安排目标',target:0,days:{[day]:2}},{id:'zero',text:'零目标',target:0,days:{[day]:99}}];b.S.data().memoHabitPlans=[{id:'bad-plan',habitId:'bad',mode:'once',from:day,list:'required',target:1},{id:'optional-plan',habitId:'optional',mode:'once',from:day,list:'required',target:2},{id:'zero-plan',habitId:'zero',mode:'once',from:day,list:'ideal',target:0}];
 const c=F.column(day,'required');assert.equal(c.done,2);assert.equal(c.total,3);assert.equal(c.supervision,1);assert.equal(F.column(day,'ideal').label,'无完成目标');assert.equal(F.column(day,'extra').label,'暂无任务');assert.match(b.ctx.App.memoReport.report(day).text,/【必做】完成 2\/3/);assert.match(b.ctx.App.memoReport.report(day).text,/监督记录 10次/);
});
test('173.3 ledger corrections do not cascade day reports and retain task and note corrections',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-3);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);
 for(let i=0;i<3;i++){const d=M.shiftDay(old,i);b.S.getDay(d).tasks.ideal=[{id:'t'+i,text:'历史任务'+i}];b.S.data().ledger.push({id:'l'+i,date:d,at:d+'T12:00:00+08:00',points:5,type:'earn-task',note:'旧流水'+i});}M.write(old,'旧笔记');F.markCopyCore(F.copyQuote(day));assert.doesNotMatch(F.copyQuote(day).text,/任务汇总修订|积分流水补记/);
 b.S.data().ledger[0].points=9;b.S.getDay(old).tasks.ideal[0].done=true;M.write(old,'旧笔记\n新增补记');const before=JSON.stringify(F.state()),q=F.copyQuote(day);assert.equal(JSON.stringify(F.state()),before);assert.equal((q.text.match(/任务汇总修订/g)||[]).length,1);assert.match(q.text,/修订前：.*5分/);assert.match(q.text,/修订后：.*9分/);assert.doesNotMatch(q.text,/流水 l1|流水 l2/);assert.match(q.text,/(此前未复制|上次复制后的补记)[\s\S]*新增补记/);
 F.markCopyCore(q);assert.match(F.copyQuote(day).text,/修订前：/);assert.match(F.copyQuote(day).text,/任务汇总修订/);b.S.data().ledger.splice(0,1);assert.match(F.copyQuote(day).text,/撤回已移除流水/);
});
test('173.3 legacy checkpoints ignore balance drift while preserving pending task changes repeatedly',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);const R=b.ctx.App.memoReport;b.S.getDay(old).tasks.ideal=[{id:'old-task',text:'升级前任务'}];b.S.data().ledger=[{id:'old-money',date:old,at:old+'T12:00:00+08:00',points:2,type:'earn-task'}];F.state().reportCopies=Object.fromEntries(Object.keys(b.S.data().days).map(d=>[d,R.legacyReport(d).text]));
 b.S.data().ledger[0].points=3;assert.doesNotMatch(F.copyQuote(day).text,/任务汇总修订|积分流水补记/);b.S.getDay(old).tasks.ideal[0].done=true;const q=F.copyQuote(day);assert.match(q.text,/任务汇总修订/);F.markCopyCore(q);const again=F.copyQuote(day);assert.match(again.text,/任务汇总修订/);assert.doesNotMatch(again.text,/积分流水补记/);
});
test('173.3 backfilled posting is copied once and missing edited-note timing is supplemented',async()=>{
 const b=browser();await b.S.load();const {F,M,A,P}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);F.markCopyCore(F.copyQuote(day));b.S.data().ledger.push({id:'makeup',date:old,at:day+'T08:00:00+08:00',points:7,type:'earn-checkin',note:'往日补卡入账'});const q=F.copyQuote(day);assert.match(q.text,/往日补卡入账/);assert.doesNotMatch(q.text,/积分流水补记|任务汇总修订/);
 b.S.data().queue=[{id:'supplement',text:'自定义完成说明'}];const ref={kind:'queue',id:'supplement'},base=Date.parse(day+'T10:00:00+08:00');P.startRef(ref,base);A.completeCore({...ref,title:'自定义完成说明'},'手写说明保留',new Date(base+60000).toISOString());const exported=F.copyQuote(day);assert.match(exported.text,/手写说明保留/);assert.match(exported.text,/已保存执行快照/);assert.match(exported.text,/10:00:00 — .*10:01:00/);
});
test('173.3 structured copy checkpoints persist, preserve future baselines and expire same-day carry',async()=>{
 const b=browser();await b.S.load();const {F,M}=flowHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);b.S.data().ledger=[{id:'old',at:old+'T12:00:00+08:00',date:old,points:2,type:'earn-task'},{id:'today',at:day+'T12:00:00+08:00',date:day,points:4,type:'earn-task'}];
 F.markCopyCore(F.copyQuote(day));F.markCopyCore(F.copyQuote(old));assert(F.state().reportFacts.ledger.today);b.S.data().ledger[0].points=3;const q=F.copyQuote(day);assert.match(q.text,/修订前：/);F.markCopyCore(q);await b.S.save();
 const next=browser({shared:b});await next.S.load();const h=flowHarness(next);financeHarness(next);vm.runInContext(source('js/memo-report.js'),next.ctx);assert.equal(h.F.state().reportFacts.ledger.old.points,3);assert.match(h.F.copyQuote(day).text,/修订前：/);
 const clock=Date.now();class Later extends Date{constructor(...args){super(...(args.length?args:[clock+86400000]));}static now(){return clock+86400000;}}next.ctx.Date=Later;assert.doesNotMatch(h.F.copyQuote(M.shiftDay(day,1)).text,/积分流水补记|任务汇总修订/);
 const malformed=copy(b.S.data());malformed.memoFlow.reportFacts.ledger.old.points='bad';const bad=browser({initial:malformed});assert.equal(await bad.S.load(),false);assert(bad.S.status().readOnly);
});

function executionReportHarness(b, at='2026-10-28T12:00:00+08:00') {
 const h=flowHarness(b);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);
 let time=Date.parse(at);class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 b.ctx.Date=Clock;return {...h,R:b.ctx.App.memoReport,setTime:at=>{time=Date.parse(at);}};
}
test('173.4 unfinished timers export every actual chunk without mutating notes or sessions',async()=>{
 const b=browser();await b.S.load();const {P,F,M}=executionReportHarness(b),day=M.userDay(),ref={kind:'queue',id:'open'};
 b.S.data().queue=[{id:'open',text:'未完成的复盘'}];const base=Date.parse(day+'T09:10:00+08:00');
 const s=P.startRef(ref,base);P.pauseCore(s,base+25*60000);P.startRef(ref,base+50*60000);P.pauseCore(s,base+68*60000);
 const raw=JSON.stringify(P.state().sessions),notes=JSON.stringify(b.S.data().memoNotes),q=F.copyQuote(day);
 assert.match(q.text,/未完成的复盘〔未完成/);assert.match(q.text,/09:10:00 — .*09:35:00/);assert.match(q.text,/10:00:00 — .*10:18:00/);
 assert.match(q.text,/有效合计：43分00秒/);assert.equal(q.factSnapshot.execution[day].segments.length,2);
 assert.equal(JSON.stringify(P.state().sessions),raw);assert.equal(JSON.stringify(b.S.data().memoNotes),notes);assert.equal(F.state().lastCopy,undefined);
});
test('173.4 running copies update a stable segment and never stop the live timer',async()=>{
 const b=browser();await b.S.load();const {P,F,M,setTime}=executionReportHarness(b,'2026-10-28T10:05:00+08:00'),day=M.userDay();
 b.S.data().queue=[{id:'live',text:'运行中任务'}];const s=P.startRef({kind:'queue',id:'live'},Date.parse(day+'T10:00:00+08:00'));
 const a=F.copyQuote(day);F.markCopyCore(a);setTime(day+'T10:10:00+08:00');const z=F.copyQuote(day);
 assert.equal(a.factSnapshot.execution[day].actualMs,300000);assert.equal(z.factSnapshot.execution[day].actualMs,600000);
 assert.equal(a.factSnapshot.execution[day].segments[0].id,z.factSnapshot.execution[day].segments[0].id);
 assert.match(z.text,/进行中；结束点为复制时刻/);assert.equal(s.status,'running');assert.equal(s.chunks[0].end,null);
 assert.equal(F.state().lastCopy.text,a.text);
});
test('173.4 all task kinds split at 04:00, keep midnight intact and union cross-task overlap',async()=>{
 const b=browser();await b.S.load();const {P,M}=executionReportHarness(b,'2026-10-29T05:00:00+08:00'),day='2026-10-28',ref={kind:'queue',id:'boundary'};
 b.S.data().queue=[{id:'boundary',text:'跨日任务'},{id:'same-name',text:'跨日任务'}];
 const edge=Date.parse('2026-10-29T04:00:00+08:00');const run=P.startRef(ref,edge-600000);P.stopRef(ref,edge+1200000);
 P.state().sessions.push({id:'overlap',ref:{kind:'queue',id:'same-name'},title:'跨日任务',status:'ended',chunks:[{start:edge+600000,end:edge+1800000}]});
 const raw=JSON.stringify(P.state().sessions),index=P.executionIndex(edge+3600000,'2026-10-29');
 assert.equal(index[day].actualMs,600000);assert.equal(index['2026-10-29'].actualMs,1800000);
 assert.equal(index[day].segments[0].id,index['2026-10-29'].segments[0].id);assert(index[day].segments[0].clipped);
 assert.notEqual(index['2026-10-29'].segments[0].taskKey,index['2026-10-29'].segments[1].taskKey);
 const midnight=Date.parse('2026-10-29T00:00:00+08:00');run.chunks.push({start:midnight-600000,end:midnight+600000});
 assert.equal(P.executionIndex(edge+3600000,'2026-10-29')[day].segments.length,2);run.chunks.pop();assert.equal(JSON.stringify(P.state().sessions),raw);
});
test('173.4 timer-only historical corrections repeat that day and persist without task or ledger dumps',async()=>{
 const b=browser();await b.S.load();const {P,F,M,setTime}=executionReportHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);
 b.S.data().queue=[{id:'old-timer',text:'往日计时'}];const ref={kind:'queue',id:'old-timer'},base=Date.parse(old+'T10:00:00+08:00');
 const s=P.startRef(ref,base);P.pauseCore(s,base+600000);F.markCopyCore(F.copyQuote(day));
 P.startRef(ref,base+1200000);P.pauseCore(s,base+1800000);const q=F.copyQuote(day);
 assert.match(q.text,/执行明细修订/);assert.doesNotMatch(q.text,/任务汇总修订|积分流水补记/);F.markCopyCore(q);
 assert.match(F.copyQuote(day).text,/执行明细修订/);assert.equal(await b.S.save(),true);
 const next=browser({shared:b});assert.equal(await next.S.load(),true);const h=executionReportHarness(next);
 assert.match(h.F.copyQuote(day).text,/执行明细修订/);
 h.F.markCopyCore(h.F.copyQuote(old));assert(h.F.state().reportFacts.execution[day]);
 setTime('2026-10-29T12:00:00+08:00');assert.doesNotMatch(F.copyQuote('2026-10-29').text,/执行明细修订/);
});
test('173.4 unavailable task links preserve raw history, duplicate references do not add elapsed time',async()=>{
 const b=browser();await b.S.load();const {P,F,M,A}=executionReportHarness(b),day=M.userDay(),ref={kind:'queue',id:'gone'},base=Date.parse(day+'T09:00:00+08:00');
 b.S.data().queue=[{id:'gone',text:'保留历史名字'}];const s=P.startRef(ref,base);P.stopRef(ref,base+600000);
 P.state().sessions.push(copy(s));b.S.data().queue=[];
 const q=F.copyQuote(day);assert.match(q.text,/保留历史名字〔历史记录，关联已不可用〕/);
 assert.equal(q.factSnapshot.execution[day].segments.length,1);assert.equal(q.factSnapshot.execution[day].actualMs,600000);
 F.markCopyCore(q);assert.equal(await b.S.save(),true);
 const bad=copy(b.S.data());bad.memoFlow.reportFacts.execution[day].segments[0].end='bad';
 const rejected=browser({initial:bad});assert.equal(await rejected.S.load(),false);assert(rejected.S.status().readOnly);
});
test('173.4 first execution checkpoint seeds unknown old history and exports only selected day',async()=>{
 const b=browser();await b.S.load();const {P,F,M}=executionReportHarness(b),day=M.userDay(),old=M.shiftDay(day,-1);
 b.S.data().queue=[{id:'old',text:'首次升级旧片段'}];const ref={kind:'queue',id:'old'},base=Date.parse(old+'T10:00:00+08:00');P.startRef(ref,base);P.stopRef(ref,base+600000);
 const q=F.copyQuote(day);assert.doesNotMatch(q.text,/首次升级旧片段|执行明细修订/);assert(q.factSnapshot.execution[old]);F.markCopyCore(q);
 assert.doesNotMatch(F.copyQuote(day).text,/执行明细修订/);assert.match(F.copyQuote(old).text,/首次升级旧片段/);
});
test('173.4 repeated tasks use each execution day for completion status across 04:00',async()=>{
 const b=browser();await b.S.load();const {P}=executionReportHarness(b,'2026-10-29T05:00:00+08:00');
 b.S.data().memoProjects=[{id:'project-boundary',text:'每日推进',days:{'2026-10-28':true}}];
 const edge=Date.parse('2026-10-29T04:00:00+08:00'),ref={kind:'project',id:'project-boundary',day:'2026-10-28'};
 P.state().sessions.push({id:'project-run',ref,title:'每日推进',status:'ended',chunks:[{start:edge-600000,end:edge+600000}]});
 const x=P.executionIndex(edge+3600000,'2026-10-29');
 assert.equal(x['2026-10-28'].segments[0].status,'已完成');assert.equal(x['2026-10-29'].segments[0].status,'未完成');
});

// Review integration exercises the same storage, ledger and timer code as tasks.
function reviewHarness(b){const h=flowHarness(b);vm.runInContext(source('js/memo-review.js'),b.ctx);return {...h,R:b.ctx.App.memoReview};}
const reviewAt=()=>Date.now()+120*60000;
test('reviews keep same-day rounds and same-name series independent',async()=>{const b=browser();await b.S.load();const {R,P}=reviewHarness(b);const due=reviewAt();const a=R.newSeriesCore({text:'环工',due}),c=R.newSeriesCore({text:'环工',due});R.scheduleCore(a.id,due+3600000);assert.equal(R.state().series.length,2);assert.equal(R.state().rounds.length,3);assert.equal(new Set(R.state().rounds.map(r=>r.taskRef.id)).size,3);assert.equal(P.columnItems(b.ctx.App.memoCore.userDay(due),'ideal').filter(x=>x.task.memoReviewRoundId).length,3);assert.notEqual(a.id,c.id);});
test('review completion schedules from actual confirmation and posts only ordinary task points',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'矩阵',points:1,due:reviewAt()}),r=R.rounds(s.id)[0],at=new Date().toISOString();const e=A.completeCore({...r.taskRef,title:'复习矩阵',review:{result:'partial',mode:'relative',minutes:240}},'原文',at);assert.equal(r.status,'done');assert.equal(e.review.result,'partial');assert.equal(R.round(e.review.nextRoundId).due,Date.parse(at)+240*60000);assert.equal(b.S.data().ledger.filter(x=>x.memoEventId===e.id).reduce((n,x)=>n+x.points,0),1);assert.equal(b.S.data().ledger.some(x=>x.type==='earn-review'),false);assert.throws(()=>A.completeCore({...r.taskRef,title:'重复'},'',at));assert.match(A.passage(e),/第1轮/);});
test('undo cancels pristine dependent next round and restores source completion exactly once',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'撤销',due:reviewAt()}),r=R.rounds(s.id)[0];const e=A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:30}},'生成文字');A.undoCore(e.id);assert.equal(r.status,'pending');assert.equal(R.round(e.review.nextRoundId).status,'cancelled');assert.equal(b.S.data().ledger.reduce((n,x)=>n+x.points,0),0);assert.throws(()=>A.undoCore(e.id));});
test('undo preserves a started next round and its actual timer chunks',async()=>{const b=browser();await b.S.load();const {R,A,P}=reviewHarness(b);const s=R.newSeriesCore({text:'后续执行',due:reviewAt()}),r=R.rounds(s.id)[0];const e=A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:30}},'');const next=R.round(e.review.nextRoundId),session=P.startRef(next.taskRef);A.undoCore(e.id);assert.equal(next.status,'pending');assert.equal(next.predecessorUndone,true);assert.equal(P.state().sessions[0].id,session.id);});
test('review rescheduling and timeline edits keep a stable round and one linked point',async()=>{const b=browser();await b.S.load();const {R,P}=reviewHarness(b);const s=R.newSeriesCore({text:'改期',due:reviewAt()}),r=R.rounds(s.id)[0],taskId=r.taskRef.id,orig=r.due;R.rescheduleCore(r.id,orig+2*86400000,'extra');assert.equal(r.taskRef.id,taskId);assert.equal(r.status,'pending');const p=P.state().items.find(x=>x.memoReviewRoundId===r.id);P.savePlan({...p,start:orig+3*86400000,day:b.ctx.App.memoCore.userDay(orig+3*86400000)},p.id);assert.equal(r.due,orig+3*86400000);assert.equal(P.state().items.filter(x=>x.memoReviewRoundId===r.id&&!x.deleted).length,1);assert.equal(r.originalDue,orig);});
test('pausing stops timers and hides optional occurrences without erasing required obligations',async()=>{const b=browser();await b.S.load();const {R,P}=reviewHarness(b);for(const list of ['ideal','required']){const s=R.newSeriesCore({text:list,list,due:reviewAt()}),r=R.rounds(s.id)[0];P.startRef(r.taskRef);R.pauseCore(s.id,true);assert.equal(P.state().sessions.find(x=>x.ref.id===r.taskRef.id).status,'ended');assert.equal(P.columnItems(r.taskRef.day,list).some(x=>x.ref.id===r.taskRef.id),list==='required');assert.throws(()=>P.startRef(r.taskRef));R.pauseCore(s.id,false);assert.equal(P.columnItems(r.taskRef.day,list).some(x=>x.ref.id===r.taskRef.id),true);}});
test('cancel one round does not clear completed history or other same-day rounds',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'独立取消',due:reviewAt()}),first=R.rounds(s.id)[0],other=R.scheduleCore(s.id,reviewAt()+60000);A.completeCore({...first.taskRef,title:s.text},'');R.cancelCore(other.id);assert.equal(first.status,'done');assert.equal(other.status,'cancelled');assert.equal(b.S.data().ledger.reduce((n,e)=>n+e.points,0),1);});
test('review deletion and recovery restore metadata, linked event and exact points',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'恢复',due:reviewAt()}),r=R.rounds(s.id)[0],ref=r.taskRef;A.completeCore({...ref,title:s.text},'保存');const entry=A.deleteCore(ref);assert.equal(r.status,'cancelled');A.restoreCore(entry.id);assert.equal(R.round(r.id).status,'done');assert.equal(b.S.data().ledger.reduce((n,e)=>n+e.points,0),1);});
test('review save failure retry persists one completion and one next round',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);b.ctx.App.memo.flush=async()=>true;const s=R.newSeriesCore({text:'保存失败',due:reviewAt()}),r=R.rounds(s.id)[0],original=b.S.save;let calls=0;b.S.save=async()=>++calls===1?false:original();await assert.rejects(A.commit(()=>A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:120}},'原文')));assert.equal(R.rounds(s.id).length,2);assert.equal(await A.commit(()=>{throw Error('must not repeat');}),true);assert.equal(R.rounds(s.id).length,2);assert.equal(b.S.data().ledger.filter(e=>e.type==='earn-ideal').length,1);});
test('legacy plans import without rewards, retain move provenance and remaining passes',async()=>{const b=browser();await b.S.load();const {R,P,M}=reviewHarness(b);const ref={kind:'task',id:'legacy-review',day:M.userDay(),list:'ideal'},due=reviewAt();b.S.getDay(ref.day).tasks.ideal.push({id:ref.id,text:'旧计划',sp:{planned:[{n:1,due,done:true,via:'move',at:new Date().toISOString()},{n:2,due:due+60000,done:null,need:3,hits:[due]}]}});const before=JSON.stringify(P.find(ref).sp);const s=R.importCore(ref,{text:'旧计划'});assert.equal(R.rounds(s.id).length,3);assert.equal(R.rounds(s.id)[0].legacy.via,'move');assert.equal(b.S.data().ledger.length,0);assert.equal(JSON.stringify(P.find(ref).sp),before);assert.throws(()=>R.importCore(ref,{text:'重导入'}));});
test('review absolute hours survive 04:00 and reloading preserves all IDs',async()=>{const b=browser();await b.S.load();const {R,M}=reviewHarness(b);const base=Date.parse('2026-11-01T01:00:00+08:00'),due=base+4*3600000;const s=R.newSeriesCore({text:'四小时',due});const r=R.rounds(s.id)[0];assert.equal(M.clock(r.due),'05:00');assert.equal(r.taskRef.day,'2026-11-01');assert.equal(await b.S.save(),true);const next=browser({shared:b});await next.S.load();const h=reviewHarness(next);assert.equal(h.R.round(r.id).taskRef.id,r.taskRef.id);});
test('unknown or corrupt review metadata is rejected without replacing data',async()=>{const b=browser();await b.S.load();const {R}=reviewHarness(b);R.newSeriesCore({text:'校验',due:reviewAt()});const snapshot=JSON.parse(JSON.stringify(b.S.data()));for(const mutate of [d=>d.memoReview.version=2,d=>d.memoReview.rounds[0].due='tomorrow',d=>d.memoReview.rounds.push(d.memoReview.rounds[0]),d=>d.memoReview.series=[]]){const bad=JSON.parse(JSON.stringify(snapshot));mutate(bad);assert.equal(b.S.validate(bad),false);}assert.equal(b.S.validate(snapshot),true);});
test('edited dependent next rounds survive undo with schedule history',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'独立改期',due:reviewAt()}),r=R.rounds(s.id)[0],e=A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:120}},'');const next=R.round(e.review.nextRoundId);R.rescheduleCore(next.id,reviewAt()+86400000);A.undoCore(e.id);assert.equal(next.status,'pending');assert.equal(next.predecessorUndone,true);assert.equal(next.history.length,1);});
test('automatic carry preserves original review due and a single executable identity',async()=>{const b=browser();await b.S.load();const {R,F,P,M}=reviewHarness(b),due=reviewAt(),s=R.newSeriesCore({text:'自动顺延',list:'extra',due}),r=R.rounds(s.id)[0],originalTaskId=r.taskRef.id;F.settleCore(due+3*86400000);assert.equal(r.due,due);assert.equal(R.state().rounds.length,1);const f=R.taskOf(r);assert.equal(f.task.id,originalTaskId);assert.equal(f.ref.day,M.userDay(due+3*86400000));assert.equal(P.state().items.filter(p=>p.memoReviewRoundId===r.id).length,1);});
test('missing result is distinct from mastery and zero-point reviews stay zero',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'零分',points:0,due:reviewAt()}),r=R.rounds(s.id)[0];const e=A.completeCore({...r.taskRef,title:s.text},'');assert.equal(e.review.result,'');assert.equal(e.points,0);assert.equal(b.S.data().ledger.length,0);assert.equal(A.passage(e),'');});
test('a failed next-time validation restores the entire completion transaction',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);b.ctx.App.memo.flush=async()=>true;const s=R.newSeriesCore({text:'校验事务',due:reviewAt()}),r=R.rounds(s.id)[0];await assert.rejects(A.commit(()=>A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:0}},'文本')));assert.equal(R.round(r.id).status,'pending');assert.equal(R.taskOf(R.round(r.id)).task.done,undefined);assert.equal(b.S.data().ledger.length,0);assert.equal(R.rounds(s.id).length,1);});
test('review task copying cannot complete a cancelled round and required cancellations retain obligations',async()=>{const b=browser();await b.S.load();const {R,A,P}=reviewHarness(b);const s=R.newSeriesCore({text:'必做取消',list:'required',due:reviewAt()}),r=R.rounds(s.id)[0];R.cancelCore(r.id);assert.equal(P.columnItems(r.taskRef.day,'required').some(x=>x.ref.id===r.taskRef.id&&!x.done),true);assert.throws(()=>A.completeCore({...r.taskRef,title:s.text},''),/取消|暂停/);assert.equal(b.S.data().ledger.length,0);});
test('173.6 store can round-trip new review metadata after create, complete and undo',async()=>{const b=browser();await b.S.load();const {R,A}=reviewHarness(b);const s=R.newSeriesCore({text:'回退兼容',due:reviewAt()}),r=R.rounds(s.id)[0],e=A.completeCore({...r.taskRef,title:s.text,review:{mode:'relative',minutes:30}},'');A.undoCore(e.id);await b.S.save();const oldSource=require('node:child_process').execFileSync('git',['show','9d009c6ecf6171a22368d6b497d46caf6e0da90d:js/store.js'],{cwd:root,encoding:'utf8'}),ctx=browser({shared:b}).ctx;vm.runInNewContext(oldSource,ctx);assert.equal(await ctx.App.store.load(),true);const expected=JSON.stringify(ctx.App.store.data().memoReview);assert.equal(await ctx.App.store.save(),true);assert.equal(JSON.stringify(ctx.App.store.data().memoReview),expected);const next=browser({shared:b});assert.equal(await next.S.load(),true);assert.equal(next.S.data().memoReview.rounds.length,2);});
test('review rounds moved through the queue keep cancellation and pause visibility consistent',async()=>{const b=browser();await b.S.load();const {R,A,F,P}=reviewHarness(b);const s=R.newSeriesCore({text:'队列复习',due:reviewAt()}),r=R.rounds(s.id)[0];F.moveCore(r.taskRef,r.taskRef.day,'ideal','queue');const qref=P.canonical(r.taskRef);assert.equal(qref.kind,'queue');F.moveCore(qref,r.taskRef.day,'ideal');R.pauseCore(s.id,true);assert.equal(P.columnItems(r.taskRef.day,'ideal').some(x=>x.ref.id===qref.id),false);R.pauseCore(s.id,false);const e=A.completeCore({...qref,title:s.text},'');assert.equal(r.status,'done');A.undoCore(e.id);assert.equal(r.status,'pending');});
test('review snapshots freeze scheduled titles and copy checkpoints track same-day time edits only',async()=>{const b=browser();await b.S.load();const {R,A,M}=reviewHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);const due=reviewAt(),s=R.newSeriesCore({text:'原复习内容',due}),r=R.rounds(s.id)[0],day=M.userDay(due),other=M.shiftDay(day,-1),report=b.ctx.App.memoReport,baseline=JSON.stringify(report.facts(day)),unrelated=JSON.stringify(report.facts(other));R.rescheduleCore(r.id,due+60000);assert.notEqual(JSON.stringify(report.facts(day)),baseline);assert.equal(JSON.stringify(report.facts(other)),unrelated);s.text='仅修改未来内容';const e=A.completeCore({...r.taskRef,title:R.taskOf(r).task.text},'记录');assert.equal(e.review.title,'原复习内容');assert.match(A.passage(e),/原复习内容/);assert.equal(report.facts(day).reviews[0].title,'原复习内容');});

function recurrenceHarness(b){const h=reviewHarness(b);vm.runInContext(source('js/memo-recurrence.js'),b.ctx);return {...h,Cycle:b.ctx.App.memoRecurrence};}
test('173.8 repeated backfill refund reversals target each individual refund and restore arrangement',async()=>{
 const b=browser();await b.S.load();const {F,P,A}=flowHarness(b),d=b.S.data();b.ctx.App.memoEconomy={state:()=>true};b.S.getDay('2026-10-20').tasks.required.push({id:'cycle-bf',text:'补记循环'});F.settleCore(Date.parse('2026-10-21T05:00:00+08:00'));
 let handlers;const values={'#bf-day':{value:'2026-10-20'},'#bf-note':{value:'隔离测试'},'#bf-preview':{},'[role="alert"]':{}};b.ctx.App.ui={openModal:()=>({querySelector:s=>values[s]}),bindActions:h=>handlers=h,closeModal:()=>{}};b.ctx.App.memoWorkspace={render:()=>{}};b.ctx.App.app={refreshStats:()=>{}};P.render=()=>{};
 const ref={kind:'task',id:'cycle-bf',day:'2026-10-21',list:'required'};
 for(let i=0;i<3;i++){F.backfill(ref);await handlers.save({disabled:false});assert.equal(values['[role="alert"]'].textContent,undefined);assert.equal(b.S.pointsTotal(),0);const event=d.memoEvents.filter(e=>e.active&&e.sourceId===ref.id).at(-1);assert(event.penaltyRefundId);A.undoCore(event.id);assert.equal(b.S.pointsTotal(),-2);assert.equal(P.canonical(ref).day,'2026-10-21');}
 assert.equal(new Set(d.ledger.filter(e=>e.type==='refund-penalty').map(e=>e.id)).size,3);assert(b.S.validate(d));
});
test('173.8 backfill suspends future plans and undo restores unchanged plans without deleting execution',async()=>{
 const b=browser();await b.S.load();const {F,P,A}=flowHarness(b),d=b.S.data();b.S.getDay('2026-10-20').tasks.ideal.push({id:'plan-bf',text:'已有安排',points:1});F.moveCore({kind:'task',id:'plan-bf',day:'2026-10-20',list:'ideal'},'2026-10-22','ideal');const ref={kind:'task',id:'plan-bf',day:'2026-10-22',list:'ideal'},start=Date.parse('2026-10-22T12:00:00+08:00'),plan=P.savePlan({ref,title:'保留',day:ref.day,type:'span',start,end:start+600000});
 let handlers;const values={'#bf-day':{value:'2026-10-20'},'#bf-note':{value:''},'#bf-preview':{},'[role="alert"]':{}};b.ctx.App.ui={openModal:()=>({querySelector:s=>values[s]}),bindActions:h=>handlers=h,closeModal:()=>{}};b.ctx.App.memoWorkspace={render:()=>{}};b.ctx.App.app={refreshStats:()=>{}};P.render=()=>{};F.backfill(ref,'2026-10-20');await handlers.save({disabled:false});const event=d.memoEvents.find(e=>e.sourceId==='plan-bf');assert.equal(plan.suspendedByBackfill,event.id);A.undoCore(event.id);assert.equal(plan.suspendedByBackfill,undefined);assert.equal(P.canonical(ref).day,'2026-10-22');
});
test('173.8 completion remarks remain separate from task notes and survive empty passages and undo',async()=>{
 const b=browser();await b.S.load();const {A,M}=actionHarness(b),d=b.S.data(),day=M.userDay();d.queue=[{id:'remark',text:'任务',note:'长期说明',points:1}];const e=A.completeCore({kind:'queue',id:'remark',day,title:'任务',remark:'本次说明 <test>'},'');assert.equal(e.remark,'本次说明 <test>');assert.equal(d.queueDone[0].note,'长期说明');assert.equal(A.passage(e),'');A.undoCore(e.id);assert.equal(d.queue[0].note,'长期说明');assert.equal(e.remark,'本次说明 <test>');
});
test('173.8 review templates advance by actual completion and stop after their final step',async()=>{
 const b=browser();await b.S.load();const {R,A}=reviewHarness(b),now=Date.now(),s=R.newSeriesCore({text:'模板',points:1,due:now+60000,intervals:[30,120]});const r=R.rounds(s.id)[0];assert.equal(R.suggestion(r).minutes,30);const e=A.completeCore({...r.taskRef,title:'模板',review:{mode:'relative',minutes:R.suggestion(r).minutes}},'',new Date(now).toISOString());const next=R.round(e.review.nextRoundId);assert.equal(next.due,now+1800000);assert.equal(next.templateStep,1);assert.equal(R.suggestion(next).minutes,120);assert(b.S.validate(b.S.data()));
});
test('173.8 an existing independent next review is exposed and invalid templates fail validation',async()=>{
 const b=browser();await b.S.load();const {R}=reviewHarness(b),s=R.newSeriesCore({text:'已有后续',due:Date.now()+60000,intervals:[30]});const first=R.rounds(s.id)[0],second=R.scheduleCore(s.id,Date.now()+120000);assert.equal(R.suggestion(first).existing.id,second.id);assert.throws(()=>R.intervals('0,30'),/间隔/);s.intervals=[NaN];assert.equal(b.S.validate(b.S.data()),false);
});
test('173.8 fixed recurrence has one stable occurrence per due user-day and retains cadence after postponement',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M,F,P}=recurrenceHarness(b),day=M.userDay(),s=C.newSeriesCore({text:'隔日',list:'ideal',points:1,rule:{kind:'days',every:2,anchor:day}});C.ensureCore(day);C.ensureCore(day);let os=C.state().occurrences.filter(o=>o.seriesId===s.id);assert.equal(os.length,2);const o=os.find(o=>o.day===day),next=os.find(o=>o.day!==day);assert.equal(next.day,M.shiftDay(day,2));F.moveCore(o.taskRef,M.shiftDay(day,1),'ideal');assert.equal(C.taskOf(o).ref.day,M.shiftDay(day,1));assert.equal(next.day,M.shiftDay(day,2));assert.equal(C.due(s,M.shiftDay(day,3)),false);assert.equal(P.find(next.taskRef).memoNoAutoCarry,true);assert(b.S.validate(b.S.data()));
});
test('173.8 month-end clamp does not drift and skip policy handles leap years',async()=>{
 const b=browser();await b.S.load();const {Cycle:C}=recurrenceHarness(b),s={enabledDay:'2024-01-01',revisions:[{from:'2024-01-01',rule:{kind:'month',monthDay:31,missing:'last',anchor:'2024-01-01'}}]};assert(C.due(s,'2024-02-29'));assert(C.due(s,'2024-03-31'));assert(!C.due(s,'2024-03-29'));s.revisions[0].rule.missing='skip';assert(!C.due(s,'2024-02-29'));assert(C.due(s,'2024-03-31'));s.revisions[0].rule.monthDay=29;assert(C.due(s,'2024-02-29'));assert(!C.due(s,'2025-02-28'));
});
test('173.8 recurrence skips create no points, optional skips restore and required skips retain obligations',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M,P}=recurrenceHarness(b),day=M.userDay();financeHarness(b);for(const list of ['ideal','required']){const s=C.newSeriesCore({text:list,list,points:1,rule:{kind:'days',every:2,anchor:day}}),o=C.state().occurrences.find(o=>o.seriesId===s.id&&o.day===day);C.skipCore(o.id,'本期调整');assert.equal(b.S.pointsTotal(),0);if(list==='required'){assert(P.columnItems(day,list).some(x=>x.task.memoOccurrenceId===o.id));assert.equal(b.ctx.App.memoFinance.column(day,list).done,0);}else assert(!P.columnItems(day,list).some(x=>x.task.memoOccurrenceId===o.id));C.restoreCore(o.id);assert.equal(o.status,'pending');assert(P.find(o.taskRef));}assert(b.S.validate(b.S.data()));
});
test('173.8 fixed recurrence does not enter automatic carry or duplicate penalties after days away',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M,F}=recurrenceHarness(b),day=M.userDay(),s=C.newSeriesCore({text:'例行',list:'required',points:1,rule:{kind:'days',every:2,anchor:day}});const now=Date.parse(M.shiftDay(day,7)+'T05:00:00+08:00');F.settleCore(now);F.settleCore(now);assert.equal(b.S.data().ledger.filter(x=>x.taskId?.startsWith('period:')).length,0);const os=C.state().occurrences.filter(o=>o.seriesId===s.id);assert.equal(new Set(os.map(o=>o.id)).size,os.length);assert(os.some(o=>o.day===day));assert(!C.taskOf(os.find(o=>o.day===day)).task.memoMovedTo);
});
test('173.8 recurring completion is awarded once and undo reopens only that occurrence',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M,A}=recurrenceHarness(b),day=M.userDay(),s=C.newSeriesCore({text:'期次',list:'ideal',points:1,rule:{kind:'days',every:2,anchor:day}}),o=C.state().occurrences.find(o=>o.seriesId===s.id&&o.day===day),next=C.state().occurrences.find(o=>o.seriesId===s.id&&o.day!==day);const e=A.completeCore({...o.taskRef,title:'期次'},'');assert.equal(o.status,'done');assert.equal(next.status,'pending');assert.equal(b.S.pointsTotal(),1);assert.throws(()=>A.completeCore({...o.taskRef,title:'期次'},''),/状态/);A.undoCore(e.id);assert.equal(o.status,'pending');assert.equal(next.status,'pending');assert.equal(b.S.pointsTotal(),0);
});
test('173.8 recurrence backup round-trip protects unknown versions and malformed references',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M}=recurrenceHarness(b);C.newSeriesCore({text:'保存',list:'ideal',points:1,rule:{kind:'days',every:2,anchor:M.userDay()}});assert.equal(await b.S.save(),true);const next=browser({shared:b});await next.S.load();assert.equal(next.S.data().memoRecurrence.series.length,1);const d=copy(next.S.data());d.memoRecurrence.version=99;assert.equal(next.S.validate(d),false);d.memoRecurrence.version=1;d.memoRecurrence.occurrences[0].seriesId='missing';assert.equal(next.S.validate(d),false);
});
test('173.8 recurrence future edits preserve completed snapshots and fixed anchor',async()=>{
 const b=browser();await b.S.load();const {Cycle:C,M,A}=recurrenceHarness(b),day=M.userDay(),s=C.newSeriesCore({text:'原内容',list:'ideal',points:1,rule:{kind:'days',every:2,anchor:day}}),o=C.state().occurrences.find(o=>o.seriesId===s.id&&o.day===day);A.completeCore({...o.taskRef,title:'原内容'},'');C.editFutureCore(s.id,M.shiftDay(day,1),{text:'新内容',note:'新说明',points:2,list:'ideal',estimatedMinutes:5,rule:{kind:'days',every:3,anchor:day}});assert.equal(C.taskOf(o).task.text,'原内容');assert.equal(C.taskOf(o).task.points,1);assert(C.due(s,M.shiftDay(day,3)));assert(!C.due(s,M.shiftDay(day,2)));assert.equal(C.taskOf(C.state().occurrences.find(o=>o.day===M.shiftDay(day,3))).task.text,'新内容');assert(b.S.validate(b.S.data()));
});
