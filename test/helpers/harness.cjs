'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const source=f=>fs.readFileSync(path.join(root,f),'utf8');
const built=f=>fs.readFileSync(path.join(root,'dist/spa',f),'utf8');
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function data(extra = {}) { return { version: 1, settings: {}, days: { '2026-10-18': { tasks: { required: [{ id: 'stable-task', text: 'test' }], ideal: [], extra: [] }, timeline: [{ id: 'stable-event', minutes: 35 }], sessions: [] } }, ledger: [], ...extra }; }
function browser({ initial = data(), localFails = false, idbFails = false, mirror = null, delay = 0, shared = null } = {}) {
  const { IDBFactory } = require('fake-indexeddb');
  const factory = shared?.factory || new IDBFactory();
  const mem = shared?.mem || new Map(initial === null ? [] : [['focusPlanData.v1', JSON.stringify(initial)]]);
  const options = { localFails, idbFails };
  let writes = 0;
  const seeded = shared?.seeded || new Promise((resolve, reject) => {
    if (!mirror) { resolve(); return; }
    const request=factory.open('focus-plan',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('backup');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('backup','readwrite');tx.objectStore('backup').put(copy(mirror),'data');tx.oncomplete=()=>{db.close();resolve();};};
  });
  const events={};
  const ctx={console,Date,Math,JSON,Promise,Blob,URL,setTimeout,clearTimeout,structuredClone,addEventListener:(type,fn)=>{events[type]=fn;}};ctx.window=ctx;
  ctx.localStorage={getItem:k=>mem.get(k)??null,setItem(k,v){if(options.localFails)throw Error('quota');writes++;mem.set(k,String(v));},removeItem:k=>mem.delete(k)};
  ctx.indexedDB={open(...args){
    const proxy={};
    seeded.then(()=>setTimeout(()=>{
      if(options.idbFails){proxy.error=Error('idb unavailable');proxy.onerror?.();return;}
      const request=factory.open(...args);
      for(const event of ['success','error','upgradeneeded','blocked'])request.addEventListener(event,e=>{
        try{proxy.result=request.result;}catch{}try{proxy.error=request.error;}catch{}
        proxy['on'+event]?.(e);
      });
    },delay));return proxy;
  }};
  vm.runInNewContext(source('js/store.js'),ctx);
  return {ctx,S:ctx.App.store,mem,factory,seeded,options,events,writes:()=>writes};
}
function backupHarness() {
  const messages = [], confirmations = [];
  const ctx = { window: null, console, crypto: webcrypto, TextEncoder, Date, JSON, setTimeout, clearTimeout, App: {
    store: { validate: d => d?.version === 1 && d.days && d.settings && Array.isArray(d.ledger) },
    memcards: { readyPhotos: async () => {}, allPhotos: () => ({}) },
    ui: { toast: msg => messages.push(msg), confirm: (...args) => confirmations.push(args) }
  } }; ctx.window = ctx; vm.runInNewContext(source('js/backup.js'), ctx);
  return { B: ctx.App.backup, messages, confirmations };
}
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
    return new Response(fs.readFileSync(path.join(root, 'dist/spa', p)));
  };
  vm.runInNewContext(built('sw.js'), ctx);
  const invoke = async (event, extras = {}) => { let pending; listeners[event]({ waitUntil: p => pending = p, ...extras }); await pending; };
  return { ctx, listeners, values, deleted, network, invoke, skipped: () => skipped, claimed: () => claimed };
}
function updatesHarness(b) {
  const elements = new Map(), events = {}, posted = [];
  for (const id of ['storage-status', 'release-status', 'apply-update', 'check-update']) elements.set(id, { dataset: {} });
  const reg = { waiting: null, installing: null, update: async () => {}, addEventListener() {} };
  Object.assign(b.ctx, {
    __RELEASE: JSON.parse(built('version.json')).id,
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
function memoHarness(b) { vm.runInNewContext(source('js/memo.js'), b.ctx); return b.ctx.App.memoCore; }
function actionHarness(b) {
  memoHarness(b);
  vm.runInNewContext(source('js/memo-editor.js'), b.ctx);
  vm.runInNewContext(source('js/memo-actions.js'), b.ctx);
  b.ctx.App.memo.flush = async () => b.S.flush();
  b.ctx.App.checkin = { memoPoints: (it, day) => Math.max(0, Number(it.points) || 0) * (day === '2026-10-19' ? 2 : 1) };
  return { A: b.ctx.App.memoActions, M: b.ctx.App.memoCore, E: b.ctx.App.memoEditor };
}
const actionAt = '2026-10-19T09:52:00.000Z';
function scheduleHarness(b) {
  const h = actionHarness(b); vm.runInContext(source('js/memo-schedule.js'), b.ctx); return { ...h, P: b.ctx.App.memoSchedule };
}
function currencyHarness(b) {
  const h = scheduleHarness(b); vm.runInContext(source('js/memo-currency.js'), b.ctx);
  b.ctx.App.checkin.streakWithToday = () => 30;
  b.ctx.App.checkin.memoPoints = (it, day) => b.ctx.App.memoCurrency.quote(it, day)?.total || 0;
  return { ...h, C: b.ctx.App.memoCurrency };
}
function flowHarness(b, day = '2026-10-20') {
  const h = currencyHarness(b); vm.runInContext(source('js/memo-flow.js'), b.ctx);
  const F=b.ctx.App.memoFlow; F.enableCore(Date.parse(day+'T08:00:00+08:00'));
  return {...h,F,C:b.ctx.App.memoCurrency};
}
function financeHarness(b){b.ctx.document={addEventListener:()=>{}};vm.runInContext(source('js/memo-finance.js'),b.ctx);return b.ctx.App.memoFinance;}
function executionReportHarness(b, at='2026-10-28T12:00:00+08:00') {
 const h=flowHarness(b);financeHarness(b);vm.runInContext(source('js/memo-report.js'),b.ctx);
 let time=Date.parse(at);class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 b.ctx.Date=Clock;return {...h,R:b.ctx.App.memoReport,setTime:at=>{time=Date.parse(at);}};
}
function reviewHarness(b){const h=flowHarness(b);vm.runInContext(source('js/memo-review.js'),b.ctx);return {...h,R:b.ctx.App.memoReview};}
const reviewAt=()=>Date.now()+120*60000;
function recurrenceHarness(b){const h=reviewHarness(b);vm.runInContext(source('js/memo-recurrence.js'),b.ctx);return {...h,Cycle:b.ctx.App.memoRecurrence};}
module.exports={data,browser,backupHarness,workerHarness,updatesHarness,memoHarness,actionHarness,actionAt,scheduleHarness,currencyHarness,flowHarness,financeHarness,executionReportHarness,reviewHarness,reviewAt,recurrenceHarness,built};
