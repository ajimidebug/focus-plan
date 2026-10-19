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
