/* 此文件由 prepare-release.mjs 生成；代码缓存与学习记录分开管理。 */
const RELEASE = '__RELEASE__';
const ASSETS = __ASSETS__;
const PREFIX = 'focus-plan-app:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + RELEASE;
const absolute = u => new URL(u, self.registration.scope).href;
const indexURL = absolute('./index.html?v=' + RELEASE);
const routes = new Map(ASSETS.map(a => [new URL(a.url, self.registration.scope).pathname, absolute(a.url)]));
async function sha256(buffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map(n => n.toString(16).padStart(2, '0')).join('');
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await Promise.all(ASSETS.map(async asset => {
        const url = absolute(asset.url);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok || await sha256(await response.clone().arrayBuffer()) !== asset.sha256) throw new Error('Incomplete release: ' + asset.url);
        await cache.put(url, response);
      }));
    } catch (error) { await caches.delete(CACHE); throw error; }
    // 等页面确认记录已保存，再收到 ACTIVATE_RELEASE 消息后启用。
  })());
});
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'ACTIVATE_RELEASE') return;
  event.waitUntil((async () => {
    const pages = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(c => c.url.startsWith(self.registration.scope));
    if (pages.length > 1) {
      if (event.source) event.source.postMessage({ type: 'UPDATE_BLOCKED', message: '请先关闭其他打开此网站的标签页，再保存并更新' });
      return;
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname === scope.pathname + 'version.json' || url.pathname === scope.pathname + 'sw.js') return;
  const isIndex = event.request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  const target = isIndex ? indexURL : routes.get(url.pathname);
  if (!target) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(target)).then(hit => hit || Response.error()));
});
