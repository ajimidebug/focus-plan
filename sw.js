/* 此文件由 prepare-release.mjs 生成；代码缓存与学习记录分开管理。 */
const RELEASE = '175.10.2';
const ASSETS = [
  {
    "url": "./.nojekyll?v=175.10.2",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  {
    "url": "./THIRD-PARTY-NOTICES.txt?v=175.10.2",
    "sha256": "de00cb0aa6780dab9e79bd58472abcf8e923ea87fc09b37764337f2a2b7d7dba"
  },
  {
    "url": "./assets/honor/aisi.jpg?v=175.10.2",
    "sha256": "34c94da65b64e6ff34df64cb316ebe81871f6474a1d192980bd88c8f8fe3ec77"
  },
  {
    "url": "./assets/honor/sumneu.jpg?v=175.10.2",
    "sha256": "96fd0100224b0171e89575bc9f8b057a845e09df8b1d8cba5cda0352d390b0bb"
  },
  {
    "url": "./assets/honor/xinxin.jpg?v=175.10.2",
    "sha256": "097c9a0bc210bfdeb3799f5c7fb4f1f6b43ea02458bbde65992d03dc8deef5a8"
  },
  {
    "url": "./assets/honor/zhi.png?v=175.10.2",
    "sha256": "ce3fac9619f200132c52e812fec3e2d10fa37179ccae3bbbc5f17fec6010da54"
  },
  {
    "url": "./assets/index-BJ4qZMZf.js?v=175.10.2",
    "sha256": "a15da37f366767312cdf6926bbe55a533ce10df3f1f3af1251bced09cf9c1c20"
  },
  {
    "url": "./assets/index-Bz53ZH9A.css?v=175.10.2",
    "sha256": "b2645d2431b94cec13fed6e0ff990990bbf7b879dabf45c206ffe1786ffb9b51"
  },
  {
    "url": "./assets/manifest-B8EusM5t.webmanifest?v=175.10.2",
    "sha256": "6db6c99f8f9693b54fa0066ae609bf824216e47094fd01b28487a9bd059a9402"
  },
  {
    "url": "./css/katex.css?v=175.10.2",
    "sha256": "c596bf225b14e4e817fb4f1b801f6f85682e8b92fa457d12af2c0b891eb96bcc"
  },
  {
    "url": "./html-safety.js?v=175.10.2",
    "sha256": "83c29361d0245cafc6e61b12971f8deb2c29cbbc01d8aae665b2fc737c8a80c3"
  },
  {
    "url": "./icon.svg?v=175.10.2",
    "sha256": "57cc2f36576a189060fe6d592a51bdf7c7f4adea9d489418e44f2d79afa6f74a"
  },
  {
    "url": "./index.html?v=175.10.2",
    "sha256": "f147b98b4a82c8789a7c46462b226911b33208d264bf972d28b28f4e67964113"
  },
  {
    "url": "./js/katex.min.js?v=175.10.2",
    "sha256": "2ec26e326d3b141856db1c4d46c07ac3618923c7032d4fcf65f66718ea5cda00"
  },
  {
    "url": "./js/marked.min.js?v=175.10.2",
    "sha256": "2b5f392ea73cf6f79ab6529e8e0d3bdce7f36c320aa29153a0d4949775344baf"
  },
  {
    "url": "./js/mhchem.min.js?v=175.10.2",
    "sha256": "cdf8174ee9a8113fcecc79cf24209754554e080efe19b767940c9aec5864a834"
  },
  {
    "url": "./legacy-core.js?v=175.10.2",
    "sha256": "07255b64db36b1ef89cf34f8340f357735c8ce7272eac9c7d4564dbb6b1de039"
  },
  {
    "url": "./manifest.webmanifest?v=175.10.2",
    "sha256": "6db6c99f8f9693b54fa0066ae609bf824216e47094fd01b28487a9bd059a9402"
  },
  {
    "url": "./recovery.html?v=175.10.2",
    "sha256": "76a07596f10aafa3cbf97f0c6cbaf9123ad599d561bed7241e37aa82451498b7"
  },
  {
    "url": "./recovery.js?v=175.10.2",
    "sha256": "ac53ff3988b80ff9ce57c8521b0b7e19b2320ae912777973ac002f3f6f852fc2"
  },
  {
    "url": "./rollback/173.9.1/css/katex.css?v=175.10.2",
    "sha256": "c596bf225b14e4e817fb4f1b801f6f85682e8b92fa457d12af2c0b891eb96bcc"
  },
  {
    "url": "./rollback/173.9.1/css/style.css?v=175.10.2",
    "sha256": "a18106cf5d25e285af3d20141fa05ed12368c9ce0376c895fb10a45b292d0a6b"
  },
  {
    "url": "./rollback/173.9.1/icon.svg?v=175.10.2",
    "sha256": "57cc2f36576a189060fe6d592a51bdf7c7f4adea9d489418e44f2d79afa6f74a"
  },
  {
    "url": "./rollback/173.9.1/index.html?v=175.10.2",
    "sha256": "faea9a5d9a084f513986a79b82f334cb3c8b2d210373dfebe7015adb104c43ff"
  },
  {
    "url": "./rollback/173.9.1/js/app.js?v=175.10.2",
    "sha256": "ded08745b2b43fde6fe3aa0c4f07a8363df2f2f2cdd030ff1cd8ccc7e8480b3a"
  },
  {
    "url": "./rollback/173.9.1/js/backup.js?v=175.10.2",
    "sha256": "979264c92e4434fd175cc420aff0ab06de623a11f175f8fbaf673855601c48a3"
  },
  {
    "url": "./rollback/173.9.1/js/badges.js?v=175.10.2",
    "sha256": "8a5cb3be5508cbd504040b26ffed48b236d4d16c1f05a709e52a809611fc2929"
  },
  {
    "url": "./rollback/173.9.1/js/calendar.js?v=175.10.2",
    "sha256": "640ab9d44d79bdf203c964c0deda5a1fe4a1499feebc1f9280c70023c34c6d27"
  },
  {
    "url": "./rollback/173.9.1/js/checkin.js?v=175.10.2",
    "sha256": "456183a7b7965f7c461b6e0d8b18aebeb1fe48b3e0453f485f4a0167138db926"
  },
  {
    "url": "./rollback/173.9.1/js/demo.js?v=175.10.2",
    "sha256": "a2a5f017e3ac0ebd8cbfd508c7bb95d361dafd4946a744fd0e4b025f93b28bb9"
  },
  {
    "url": "./rollback/173.9.1/js/exams.js?v=175.10.2",
    "sha256": "99da6d693304cd5483f71894978693f8b7cdd11bb2e7c9698b78ac722be36f20"
  },
  {
    "url": "./rollback/173.9.1/js/katex.min.js?v=175.10.2",
    "sha256": "2ec26e326d3b141856db1c4d46c07ac3618923c7032d4fcf65f66718ea5cda00"
  },
  {
    "url": "./rollback/173.9.1/js/lecture.js?v=175.10.2",
    "sha256": "b25bacaee1d24924b3d4ac6ecb967a1ae2e732d853a7532ced268bf18235efee"
  },
  {
    "url": "./rollback/173.9.1/js/link.js?v=175.10.2",
    "sha256": "bdbe316d78091867df2f186e8d190092e0bfca1934ac9062a4f897d915e87914"
  },
  {
    "url": "./rollback/173.9.1/js/marked.min.js?v=175.10.2",
    "sha256": "2b5f392ea73cf6f79ab6529e8e0d3bdce7f36c320aa29153a0d4949775344baf"
  },
  {
    "url": "./rollback/173.9.1/js/memcards.js?v=175.10.2",
    "sha256": "1203e01830e0d5c3719c8a6d99f3d7480bb928ae629f5aac8310fa81436023d8"
  },
  {
    "url": "./rollback/173.9.1/js/memo-actions.js?v=175.10.2",
    "sha256": "b89d4549add31400fda267a88a11ef0d3c659d5463ae3dbc3b8eb195fdfb12c9"
  },
  {
    "url": "./rollback/173.9.1/js/memo-controls.js?v=175.10.2",
    "sha256": "9036f52d4cbe1a54f03cefd0c8332007ded67cfdd25844b0b2797d04ae006e24"
  },
  {
    "url": "./rollback/173.9.1/js/memo-currency.js?v=175.10.2",
    "sha256": "cb9cd947fcaff9920e04cbb868226eeb5c3c4ab73f4751ad65d7f72926bb5dc6"
  },
  {
    "url": "./rollback/173.9.1/js/memo-economy.js?v=175.10.2",
    "sha256": "4daf618875d7b77c6c1b9f65e42523deadf24fd9bc9259ca66a762253f2affb6"
  },
  {
    "url": "./rollback/173.9.1/js/memo-editor.js?v=175.10.2",
    "sha256": "ff742800fbf30bb84ee2de6aecbc9858f184592b6945e41e9d951235452aff91"
  },
  {
    "url": "./rollback/173.9.1/js/memo-finance.js?v=175.10.2",
    "sha256": "94583742af88b0fd009befa831df10a6f8619ae63dcbcd65d71fb43c78bd8b6b"
  },
  {
    "url": "./rollback/173.9.1/js/memo-float.js?v=175.10.2",
    "sha256": "d0ec483bebe9f396a805d92dfc6d4e16bbed9283375a18a1b1b1c1fe38d169ad"
  },
  {
    "url": "./rollback/173.9.1/js/memo-flow.js?v=175.10.2",
    "sha256": "7e28c3103ceb7f7abe2976764d1ab74dd2ed7025c895e9fd41ef334b09b3c48f"
  },
  {
    "url": "./rollback/173.9.1/js/memo-goals.js?v=175.10.2",
    "sha256": "a2954ec0b9520c3c83b55988e3531cf57a7486c8c72f908097436b2d847c1b7d"
  },
  {
    "url": "./rollback/173.9.1/js/memo-organize.js?v=175.10.2",
    "sha256": "dcb46ec5c2775e26cbee7f5a917843b3da045b58a6424027ecdaaaccfd136f76"
  },
  {
    "url": "./rollback/173.9.1/js/memo-penalty.js?v=175.10.2",
    "sha256": "c1f1ca64cdd191b4022d101ef3f616adf8de10971df0d4f762fe55c0b54ed27b"
  },
  {
    "url": "./rollback/173.9.1/js/memo-recurrence.js?v=175.10.2",
    "sha256": "dca99edb94fb0be0eb691857f75d7d69efec44ce43d9a3b2a67040191852d7b6"
  },
  {
    "url": "./rollback/173.9.1/js/memo-refinements.js?v=175.10.2",
    "sha256": "a6d2477143c834ebe4dd40fe8033159df53a11dccc02651b08a267ec75495c93"
  },
  {
    "url": "./rollback/173.9.1/js/memo-report.js?v=175.10.2",
    "sha256": "9bf59c1aca7d79511c28b3a5143fc28a4e68ab42075af7544963596081ce3e97"
  },
  {
    "url": "./rollback/173.9.1/js/memo-rest.js?v=175.10.2",
    "sha256": "fb95c6f6f94e8b67e1537347e2b1650cdc21e9388607b14c60747bf6767a24d1"
  },
  {
    "url": "./rollback/173.9.1/js/memo-review.js?v=175.10.2",
    "sha256": "c28fdf41019a1bad94fce3d680cd552d0478e63a01849aaf8132675fd9a2981a"
  },
  {
    "url": "./rollback/173.9.1/js/memo-schedule.js?v=175.10.2",
    "sha256": "424fc0c0e9f6505bc0cdeb11e06f0a57138ff4b752114022e376cabe1cf09ed2"
  },
  {
    "url": "./rollback/173.9.1/js/memo-viewport.js?v=175.10.2",
    "sha256": "fda68f33ddc0638dcee5af46b9c538935d10661f6238a17b0b8b03add7279f79"
  },
  {
    "url": "./rollback/173.9.1/js/memo-wishlist.js?v=175.10.2",
    "sha256": "0c5c1b9364258aa85a7756fbbbfb2ffb0df787b3ca0430ff4c895188488dd51d"
  },
  {
    "url": "./rollback/173.9.1/js/memo-workspace.js?v=175.10.2",
    "sha256": "2fd3d03a9d009a4344ffb9b4dba27316ccea37022bcff12eb23084a2442d38ce"
  },
  {
    "url": "./rollback/173.9.1/js/memo.js?v=175.10.2",
    "sha256": "8a090e4ff712062060e7701712c4c8a1fba0864634663e80bdb67561f8a4afff"
  },
  {
    "url": "./rollback/173.9.1/js/mhchem.min.js?v=175.10.2",
    "sha256": "cdf8174ee9a8113fcecc79cf24209754554e080efe19b767940c9aec5864a834"
  },
  {
    "url": "./rollback/173.9.1/js/milestones.js?v=175.10.2",
    "sha256": "9c0521d6f006d4075d8f35d4d36d3b4195226804a97aa31c1d591e816cd3f125"
  },
  {
    "url": "./rollback/173.9.1/js/mistakes.js?v=175.10.2",
    "sha256": "a0df83f6fc839461703366364c2487c88adc2932e6fb671edba11fa5b587be90"
  },
  {
    "url": "./rollback/173.9.1/js/queue.js?v=175.10.2",
    "sha256": "afead75511ab2371e265273f7350613c20291bee40ecc271d79f4ed92cf373e8"
  },
  {
    "url": "./rollback/173.9.1/js/settings.js?v=175.10.2",
    "sha256": "90873bbd9f9a86e895f13b29a7dc2e21ae38fd532c85ab1c1048ac5b215a01af"
  },
  {
    "url": "./rollback/173.9.1/js/sport.js?v=175.10.2",
    "sha256": "fbd6e64d9c02a42dfd1f606dd399451a1a9eb885fbe1c666b3318004c124bc54"
  },
  {
    "url": "./rollback/173.9.1/js/stats.js?v=175.10.2",
    "sha256": "5849ec142ff8aff4796bdb907d5e34c65fe56fc99506fa0c96efe8440ee62c9c"
  },
  {
    "url": "./rollback/173.9.1/js/store.js?v=175.10.2",
    "sha256": "9806692067d3ded5aa96e93935d87d93d3bac1995155fe1c519c966f54704d54"
  },
  {
    "url": "./rollback/173.9.1/js/tasks.js?v=175.10.2",
    "sha256": "b5eea9db4cd08265a67744d776efd1a7fb091b235ea337c2be6005a63f812f46"
  },
  {
    "url": "./rollback/173.9.1/js/timeline.js?v=175.10.2",
    "sha256": "01a162b92306b5e4e70a15e47c093a2d1c4dd43d444b001195dc385763e57b3b"
  },
  {
    "url": "./rollback/173.9.1/js/ui.js?v=175.10.2",
    "sha256": "68c1c1b454f46be3c26b5d9f5ba20556a73e1ea436358f04a5b77364a9527c54"
  },
  {
    "url": "./rollback/173.9.1/js/updates.js?v=175.10.2",
    "sha256": "7f91e6e7db9a34d5d8b08282decde753a2576058cef7e4e764b130b92906bcc5"
  },
  {
    "url": "./rollback/173.9.1/manifest.webmanifest?v=175.10.2",
    "sha256": "6db6c99f8f9693b54fa0066ae609bf824216e47094fd01b28487a9bd059a9402"
  },
  {
    "url": "./rollback/173.9.1/version.html?v=175.10.2",
    "sha256": "7a82aef2612c437f0d584e526bf1d11947d0620fc3de4fec1170342308f83b57"
  },
  {
    "url": "./version.html?v=175.10.2",
    "sha256": "7a82aef2612c437f0d584e526bf1d11947d0620fc3de4fec1170342308f83b57"
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
