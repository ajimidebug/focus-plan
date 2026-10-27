/* 此文件由 prepare-release.mjs 生成；代码缓存与学习记录分开管理。 */
const RELEASE = '171.0.0';
const ASSETS = [
  {
    "url": "./index.html?v=171.0.0",
    "sha256": "2033d592f3fe92032f505ff69d773a17b02efad6e066c9cb6e9096ceb546b7f0"
  },
  {
    "url": "./version.html?v=171.0.0",
    "sha256": "7a82aef2612c437f0d584e526bf1d11947d0620fc3de4fec1170342308f83b57"
  },
  {
    "url": "./css/style.css?v=171.0.0",
    "sha256": "d6361c4b75c28137961ffbd59a8d32283866d8e1114cb9f8b431a8eac584fcb4"
  },
  {
    "url": "./css/katex.css?v=171.0.0",
    "sha256": "c596bf225b14e4e817fb4f1b801f6f85682e8b92fa457d12af2c0b891eb96bcc"
  },
  {
    "url": "./js/app.js?v=171.0.0",
    "sha256": "bf702d3392a3c52325e53e1d182bf674cc0beb2f541e6d6d1d9b56e2e7596b82"
  },
  {
    "url": "./js/backup.js?v=171.0.0",
    "sha256": "979264c92e4434fd175cc420aff0ab06de623a11f175f8fbaf673855601c48a3"
  },
  {
    "url": "./js/badges.js?v=171.0.0",
    "sha256": "8a5cb3be5508cbd504040b26ffed48b236d4d16c1f05a709e52a809611fc2929"
  },
  {
    "url": "./js/calendar.js?v=171.0.0",
    "sha256": "640ab9d44d79bdf203c964c0deda5a1fe4a1499feebc1f9280c70023c34c6d27"
  },
  {
    "url": "./js/checkin.js?v=171.0.0",
    "sha256": "67e1f4e5b827b6bb75ea96a18eba69c798e55d663e92dabe9c2793a3139201d1"
  },
  {
    "url": "./js/demo.js?v=171.0.0",
    "sha256": "a2a5f017e3ac0ebd8cbfd508c7bb95d361dafd4946a744fd0e4b025f93b28bb9"
  },
  {
    "url": "./js/exams.js?v=171.0.0",
    "sha256": "99da6d693304cd5483f71894978693f8b7cdd11bb2e7c9698b78ac722be36f20"
  },
  {
    "url": "./js/katex.min.js?v=171.0.0",
    "sha256": "2ec26e326d3b141856db1c4d46c07ac3618923c7032d4fcf65f66718ea5cda00"
  },
  {
    "url": "./js/lecture.js?v=171.0.0",
    "sha256": "b25bacaee1d24924b3d4ac6ecb967a1ae2e732d853a7532ced268bf18235efee"
  },
  {
    "url": "./js/link.js?v=171.0.0",
    "sha256": "bdbe316d78091867df2f186e8d190092e0bfca1934ac9062a4f897d915e87914"
  },
  {
    "url": "./js/marked.min.js?v=171.0.0",
    "sha256": "2b5f392ea73cf6f79ab6529e8e0d3bdce7f36c320aa29153a0d4949775344baf"
  },
  {
    "url": "./js/memcards.js?v=171.0.0",
    "sha256": "1f7de91402b242be4602800ff6004cbd957c8b285944f4a28170a01ca98f5162"
  },
  {
    "url": "./js/memo-actions.js?v=171.0.0",
    "sha256": "9175fc2817ce0fc59c4270563aefe7da9be9eec3d9962aad3da0aa2df0ae1c91"
  },
  {
    "url": "./js/memo-controls.js?v=171.0.0",
    "sha256": "9036f52d4cbe1a54f03cefd0c8332007ded67cfdd25844b0b2797d04ae006e24"
  },
  {
    "url": "./js/memo-currency.js?v=171.0.0",
    "sha256": "dced576289cf0e61bb3e19672d111335fe804b014a1a3759da6a8a351543c180"
  },
  {
    "url": "./js/memo-editor.js?v=171.0.0",
    "sha256": "2819e8d52fdf102ec70c0feb9e4ae77142f09626ae256562708326b3ad18009c"
  },
  {
    "url": "./js/memo-finance.js?v=171.0.0",
    "sha256": "6ed1fa83ae8dfba5ab5b54487c586b52e148d2cd81c83f165aa579761e15c7c3"
  },
  {
    "url": "./js/memo-float.js?v=171.0.0",
    "sha256": "e6bb2cc6ba3157b0dfaf64a2d43e91fc8fbb74cf7e3b513e5cefd7f8c091e2f0"
  },
  {
    "url": "./js/memo-flow.js?v=171.0.0",
    "sha256": "0c1e68039767e147bc50035811708259290c76175abb0d402d140b6e0d2e39fa"
  },
  {
    "url": "./js/memo-goals.js?v=171.0.0",
    "sha256": "a2954ec0b9520c3c83b55988e3531cf57a7486c8c72f908097436b2d847c1b7d"
  },
  {
    "url": "./js/memo-organize.js?v=171.0.0",
    "sha256": "37bea653f5d32a15fa2f5a227376baddd2eafa6347e8ecd0a817b83f9d0dced5"
  },
  {
    "url": "./js/memo-refinements.js?v=171.0.0",
    "sha256": "a6d2477143c834ebe4dd40fe8033159df53a11dccc02651b08a267ec75495c93"
  },
  {
    "url": "./js/memo-report.js?v=171.0.0",
    "sha256": "9fe08bbdb721aee0833343f728daeca193c78331f6319cae5262512111e6f175"
  },
  {
    "url": "./js/memo-rest.js?v=171.0.0",
    "sha256": "fb95c6f6f94e8b67e1537347e2b1650cdc21e9388607b14c60747bf6767a24d1"
  },
  {
    "url": "./js/memo-schedule.js?v=171.0.0",
    "sha256": "b5e74a4f84a803df67b94b982ba75c8833451c3d9483d38141191c393909a5fe"
  },
  {
    "url": "./js/memo-wishlist.js?v=171.0.0",
    "sha256": "0c5c1b9364258aa85a7756fbbbfb2ffb0df787b3ca0430ff4c895188488dd51d"
  },
  {
    "url": "./js/memo-workspace.js?v=171.0.0",
    "sha256": "da9b0063c668ef2d05e67a6de4e8fb03ab25734bc7a7655f18f493577cec6392"
  },
  {
    "url": "./js/memo.js?v=171.0.0",
    "sha256": "6d7fdb40faa847b5b74fcb03f33bcc8bf7ddfceaf3023d6bc23e849b328c3fba"
  },
  {
    "url": "./js/mhchem.min.js?v=171.0.0",
    "sha256": "cdf8174ee9a8113fcecc79cf24209754554e080efe19b767940c9aec5864a834"
  },
  {
    "url": "./js/milestones.js?v=171.0.0",
    "sha256": "9c0521d6f006d4075d8f35d4d36d3b4195226804a97aa31c1d591e816cd3f125"
  },
  {
    "url": "./js/mistakes.js?v=171.0.0",
    "sha256": "a0df83f6fc839461703366364c2487c88adc2932e6fb671edba11fa5b587be90"
  },
  {
    "url": "./js/queue.js?v=171.0.0",
    "sha256": "afead75511ab2371e265273f7350613c20291bee40ecc271d79f4ed92cf373e8"
  },
  {
    "url": "./js/settings.js?v=171.0.0",
    "sha256": "90873bbd9f9a86e895f13b29a7dc2e21ae38fd532c85ab1c1048ac5b215a01af"
  },
  {
    "url": "./js/sport.js?v=171.0.0",
    "sha256": "fbd6e64d9c02a42dfd1f606dd399451a1a9eb885fbe1c666b3318004c124bc54"
  },
  {
    "url": "./js/stats.js?v=171.0.0",
    "sha256": "5849ec142ff8aff4796bdb907d5e34c65fe56fc99506fa0c96efe8440ee62c9c"
  },
  {
    "url": "./js/store.js?v=171.0.0",
    "sha256": "faeeb55461b93c2524188a18408a52ec372dd525214f2de5075615e6bef8ab31"
  },
  {
    "url": "./js/tasks.js?v=171.0.0",
    "sha256": "3726515a2061d7c74f86f21c4929f3ce3a15fc93cfd15b30af3b45a78564f1ce"
  },
  {
    "url": "./js/timeline.js?v=171.0.0",
    "sha256": "01a162b92306b5e4e70a15e47c093a2d1c4dd43d444b001195dc385763e57b3b"
  },
  {
    "url": "./js/ui.js?v=171.0.0",
    "sha256": "7a554cf775a1920622df08e70c5094abafe28fb8fa3733779acbd6c2de5e4501"
  },
  {
    "url": "./js/updates.js?v=171.0.0",
    "sha256": "7f91e6e7db9a34d5d8b08282decde753a2576058cef7e4e764b130b92906bcc5"
  },
  {
    "url": "./manifest.webmanifest?v=171.0.0",
    "sha256": "6db6c99f8f9693b54fa0066ae609bf824216e47094fd01b28487a9bd059a9402"
  },
  {
    "url": "./icon.svg?v=171.0.0",
    "sha256": "57cc2f36576a189060fe6d592a51bdf7c7f4adea9d489418e44f2d79afa6f74a"
  }
];
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
