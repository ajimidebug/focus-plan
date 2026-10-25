/* 此文件由 prepare-release.mjs 生成；代码缓存与学习记录分开管理。 */
const RELEASE = '170.9.0';
const ASSETS = [
  {
    "url": "./index.html?v=170.9.0",
    "sha256": "fee0345f63f8d4f0cfd8d8a19117c48770a1e1903918311ea3097f20379fbe3e"
  },
  {
    "url": "./version.html?v=170.9.0",
    "sha256": "7a82aef2612c437f0d584e526bf1d11947d0620fc3de4fec1170342308f83b57"
  },
  {
    "url": "./css/style.css?v=170.9.0",
    "sha256": "cf5bccf68a4e1112da94c813d2c11d3ed52c9ef31297170615db0c807b98c115"
  },
  {
    "url": "./css/katex.css?v=170.9.0",
    "sha256": "c596bf225b14e4e817fb4f1b801f6f85682e8b92fa457d12af2c0b891eb96bcc"
  },
  {
    "url": "./js/app.js?v=170.9.0",
    "sha256": "ed308b138e3e459bc71f5f00bdb0476df38cde09651d1dbb45c978967fc6ee41"
  },
  {
    "url": "./js/backup.js?v=170.9.0",
    "sha256": "979264c92e4434fd175cc420aff0ab06de623a11f175f8fbaf673855601c48a3"
  },
  {
    "url": "./js/badges.js?v=170.9.0",
    "sha256": "8a5cb3be5508cbd504040b26ffed48b236d4d16c1f05a709e52a809611fc2929"
  },
  {
    "url": "./js/calendar.js?v=170.9.0",
    "sha256": "640ab9d44d79bdf203c964c0deda5a1fe4a1499feebc1f9280c70023c34c6d27"
  },
  {
    "url": "./js/checkin.js?v=170.9.0",
    "sha256": "a037b65131dfe7f0e9b6ba826309d235356ee75856c59832663b8e4a85aed4a8"
  },
  {
    "url": "./js/demo.js?v=170.9.0",
    "sha256": "a2a5f017e3ac0ebd8cbfd508c7bb95d361dafd4946a744fd0e4b025f93b28bb9"
  },
  {
    "url": "./js/exams.js?v=170.9.0",
    "sha256": "99da6d693304cd5483f71894978693f8b7cdd11bb2e7c9698b78ac722be36f20"
  },
  {
    "url": "./js/katex.min.js?v=170.9.0",
    "sha256": "2ec26e326d3b141856db1c4d46c07ac3618923c7032d4fcf65f66718ea5cda00"
  },
  {
    "url": "./js/lecture.js?v=170.9.0",
    "sha256": "b25bacaee1d24924b3d4ac6ecb967a1ae2e732d853a7532ced268bf18235efee"
  },
  {
    "url": "./js/link.js?v=170.9.0",
    "sha256": "bdbe316d78091867df2f186e8d190092e0bfca1934ac9062a4f897d915e87914"
  },
  {
    "url": "./js/marked.min.js?v=170.9.0",
    "sha256": "2b5f392ea73cf6f79ab6529e8e0d3bdce7f36c320aa29153a0d4949775344baf"
  },
  {
    "url": "./js/memcards.js?v=170.9.0",
    "sha256": "73a47c17012bc5d91653c0725f3aaf8b1903c9248c6d77b5a77a79ac7a4b5ed6"
  },
  {
    "url": "./js/memo-actions.js?v=170.9.0",
    "sha256": "1b06836cbe2b027385ae8fce51815864bbecafafbf5eac89e4a51b51552905ef"
  },
  {
    "url": "./js/memo-currency.js?v=170.9.0",
    "sha256": "f42db37aa1eb6c391d766a8f6c7c8188fc213ab4e4a634719667c7841c0af748"
  },
  {
    "url": "./js/memo-editor.js?v=170.9.0",
    "sha256": "2819e8d52fdf102ec70c0feb9e4ae77142f09626ae256562708326b3ad18009c"
  },
  {
    "url": "./js/memo-flow.js?v=170.9.0",
    "sha256": "afa8d7e84b024440e09be03a2a985fd9b5c93780892d9271336624232e2a1e3c"
  },
  {
    "url": "./js/memo-goals.js?v=170.9.0",
    "sha256": "a2954ec0b9520c3c83b55988e3531cf57a7486c8c72f908097436b2d847c1b7d"
  },
  {
    "url": "./js/memo-refinements.js?v=170.9.0",
    "sha256": "e0695d7ec8417195b50c4cd70e9b0d35c647f590bc6b86118e1e0d89f1d3229c"
  },
  {
    "url": "./js/memo-report.js?v=170.9.0",
    "sha256": "033a65e710eb12151aa224ef66d42c582ec9f1dfb5e71a34109cf3b8319ce610"
  },
  {
    "url": "./js/memo-rest.js?v=170.9.0",
    "sha256": "98f1e03828bd3b088685f8ecae7e523cfa3af6c324a479b0bb137d430ab70de8"
  },
  {
    "url": "./js/memo-schedule.js?v=170.9.0",
    "sha256": "a030f8c9b83e28ea5446d8c82514e6040f1a18aabd71d3ca6fb4998f395a5c81"
  },
  {
    "url": "./js/memo-workspace.js?v=170.9.0",
    "sha256": "5dca970e99a1fdb4753173b71f419f7ba7f6d96a276b79c158af903b50c99677"
  },
  {
    "url": "./js/memo.js?v=170.9.0",
    "sha256": "6d7fdb40faa847b5b74fcb03f33bcc8bf7ddfceaf3023d6bc23e849b328c3fba"
  },
  {
    "url": "./js/mhchem.min.js?v=170.9.0",
    "sha256": "cdf8174ee9a8113fcecc79cf24209754554e080efe19b767940c9aec5864a834"
  },
  {
    "url": "./js/milestones.js?v=170.9.0",
    "sha256": "9c0521d6f006d4075d8f35d4d36d3b4195226804a97aa31c1d591e816cd3f125"
  },
  {
    "url": "./js/mistakes.js?v=170.9.0",
    "sha256": "a0df83f6fc839461703366364c2487c88adc2932e6fb671edba11fa5b587be90"
  },
  {
    "url": "./js/queue.js?v=170.9.0",
    "sha256": "afead75511ab2371e265273f7350613c20291bee40ecc271d79f4ed92cf373e8"
  },
  {
    "url": "./js/settings.js?v=170.9.0",
    "sha256": "90873bbd9f9a86e895f13b29a7dc2e21ae38fd532c85ab1c1048ac5b215a01af"
  },
  {
    "url": "./js/sport.js?v=170.9.0",
    "sha256": "fbd6e64d9c02a42dfd1f606dd399451a1a9eb885fbe1c666b3318004c124bc54"
  },
  {
    "url": "./js/stats.js?v=170.9.0",
    "sha256": "5849ec142ff8aff4796bdb907d5e34c65fe56fc99506fa0c96efe8440ee62c9c"
  },
  {
    "url": "./js/store.js?v=170.9.0",
    "sha256": "384c389e68d9cba4572cb84c8f34c3452eab660164eee3d01bb115d5c1ac7fa0"
  },
  {
    "url": "./js/tasks.js?v=170.9.0",
    "sha256": "3726515a2061d7c74f86f21c4929f3ce3a15fc93cfd15b30af3b45a78564f1ce"
  },
  {
    "url": "./js/timeline.js?v=170.9.0",
    "sha256": "01a162b92306b5e4e70a15e47c093a2d1c4dd43d444b001195dc385763e57b3b"
  },
  {
    "url": "./js/ui.js?v=170.9.0",
    "sha256": "5cb04996920cc9ecf939af319306389c5cc28be22c4b67294af480ec42aebe8a"
  },
  {
    "url": "./js/updates.js?v=170.9.0",
    "sha256": "7f91e6e7db9a34d5d8b08282decde753a2576058cef7e4e764b130b92906bcc5"
  },
  {
    "url": "./manifest.webmanifest?v=170.9.0",
    "sha256": "6db6c99f8f9693b54fa0066ae609bf824216e47094fd01b28487a9bd059a9402"
  },
  {
    "url": "./icon.svg?v=170.9.0",
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
