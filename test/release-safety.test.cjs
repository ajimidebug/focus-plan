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
  const b = browser({ initial: data({ memoNotes: 'future-format' }) }); await b.S.load(); const M = memoHarness(b);
  assert.throws(() => M.write('2026-10-19', 'new'), /格式/); assert.equal(b.S.data().memoNotes, 'future-format');
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
  day.tasks.required = [{ id: 'r', text: '必须' }]; day.tasks.ideal = [{ id: 'i', text: '理想' }]; day.tasks.extra = [{ id: 'x', text: '拓展' }];
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
  assert.equal(session.status, 'ended'); assert.equal(b.S.pointsTotal(), 10);
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
  assert.equal(rows.length, n); assert(rows.every(row => row.includes('修改／追加时间'))); assert.equal(records.plans.length, n); assert.equal(d.queue.length, n);
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
