/* 手机端：检查新版，完整缓存后在保存完成的空闲时段切换。 */
(function () {
  'use strict';
  const App = window.App = window.App || {};
  let registration = null, ready = false, applying = false, interacted = false, checkedAt = 0;
  let lastMessage = '正在检查版本', inputEpoch = 0;
  const dirty = new Set();
  const byId = function (id) { return document.getElementById(id); };
  function render() {
    const status = App.store.status();
    if (byId('storage-status')) byId('storage-status').textContent = status.message;
    if (byId('release-status')) byId('release-status').textContent = '版本 ' + (window.__RELEASE || '169') + ' · ' + lastMessage;
    if (byId('apply-update')) byId('apply-update').hidden = !(registration && registration.waiting) || applying;
    if (byId('storage-status')) byId('storage-status').dataset.state = status.phase;
  }
  function busyReason() {
    if (!ready) return '正在读取记录';
    if (App.store.status().readOnly) return '记录处于保护状态';
    if (App.memo && App.memo.busy()) return '笔记尚未安全保存';
    if (App.memoSchedule && App.memoSchedule.busy()) return '执行计时尚未结束，请结束后更新';
    const T = App.tasks;
    if (T && ((T.getTimer && T.getTimer()) || (T.getCdTimer && T.getCdTimer()))) return '正在计时，请结束本段后更新';
    const day = App.store.getDay(App.store.todayKey());
    if (day.activeHourPlan || day.activeRest || (App.lecture && App.lecture.current()) || (App.link && App.link.isPausing())) return '本段活动尚未结束，请结束后更新';
    if (document.querySelector('#modal-root .modal') || (T && T.isPip && T.isPip())) return '请先保存并关闭正在操作的窗口';
    for (const field of dirty) { if (!field.isConnected) dirty.delete(field); }
    if (dirty.size) return '请先保存正在编辑的内容';
    return '';
  }
  function showBlocked(message) {
    const box = document.createElement('section');
    box.className = 'storage-blocker';
    const title = document.createElement('h2'); title.textContent = '记录保护：暂未进入应用'; box.appendChild(title);
    const p = document.createElement('p'); p.textContent = message || App.store.status().message; box.appendChild(p);
    const raw = document.createElement('button'); raw.className = 'btn'; raw.textContent = '导出原始数据'; raw.onclick = App.store.exportRecovery; box.appendChild(raw);
    if (App.store.data()) {
      const current = document.createElement('button'); current.className = 'btn'; current.textContent = '导出本页主记录'; current.onclick = App.store.exportJSON; box.appendChild(current);
    }
    const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重新打开'; retry.onclick = function () { location.reload(); }; box.appendChild(retry);
    document.body.appendChild(box);
  }
  async function applyUpdate(manual) {
    if (applying || !registration || !registration.waiting) return false;
    const why = busyReason();
    if (why) { lastMessage = '新版已下载；' + why; render(); return false; }
    if (!manual && interacted) { lastMessage = '新版已下载，可在空闲时保存并更新'; render(); return false; }
    applying = true;
    lastMessage = '正在保存并准备更新'; render();
    const epoch = inputEpoch;
    try {
      if (App.memo && !await App.memo.flush()) throw new Error('笔记保存未完成，暂未更新');
      const saved = await App.store.save();
      const flushed = await App.store.flush();
      await App.memcards.readyPhotos();
      const photosSaved = await App.memcards.flushPhotos();
      if (!saved || !flushed || !photosSaved) throw new Error('保存未完成，暂未切换版本；请先备份');
      const snapshot = await App.backup.snap('manual');
      if (!snapshot) throw new Error('更新前快照未保存，暂未切换版本');
      if (epoch !== inputEpoch || busyReason()) throw new Error('检测到新的操作，稍后再更新');
      if (App.tasks && App.tasks.saveTimerSnap) App.tasks.saveTimerSnap();
      registration.waiting.postMessage({ type: 'ACTIVATE_RELEASE' });
      return true;
    } catch (e) { applying = false; lastMessage = e.message; render(); return false; }
  }
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed') {
        lastMessage = registration.waiting ? '新版已下载' : '离线资源已准备'; render();
        if (registration.waiting) setTimeout(function () { applyUpdate(false); }, 400);
      }
      if (worker.state === 'redundant') { lastMessage = '新版未能完整下载，继续使用当前版本'; render(); }
    });
  }
  async function check(force) {
    if (!ready || (!force && Date.now() - checkedAt < 15 * 60000)) return;
    checkedAt = Date.now();
    try {
      const response = await fetch('version.json?check=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('version unavailable');
      const latest = await response.json();
      if (latest.id === window.__RELEASE) lastMessage = '已是当前发布版本';
      else {
        lastMessage = '发现新版，正在下载';
        if (registration) await registration.update();
      }
      if (registration && registration.waiting) { lastMessage = '新版已下载'; applyUpdate(false); }
    } catch (e) { lastMessage = '暂未连到更新服务，继续使用当前版本'; }
    render();
  }
  function init() {
    window.addEventListener('focus-storage', function () {
      render();
      if (ready && App.store.status().readOnly && !document.querySelector('.storage-blocker')) showBlocked();
    });
    byId('check-update').onclick = function () { interacted = true; check(true); };
    byId('apply-update').onclick = function () { interacted = true; applyUpdate(true); };
    document.addEventListener('pointerdown', function () { interacted = true; }, { passive: true });
    document.addEventListener('input', function (e) {
      interacted = true; inputEpoch++;
      if (e.target.id !== 'memo-editor' && !(e.target.dataset && e.target.dataset.transient) && e.target.matches('input, textarea, select')) dirty.add(e.target);
    });
    // 自动保存的常驻设置项在 change 处理完成且存储确认后解除编辑标记；弹窗内仍等待关闭。
    document.addEventListener('change', function (e) {
      const field = e.target;
      if (field.closest('#modal-root')) return;
      App.store.flush().then(function (ok) { if (ok) dirty.delete(field); });
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (applying) location.reload(); });
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'UPDATE_BLOCKED') { applying = false; lastMessage = e.data.message; render(); }
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        registration = reg;
        reg.addEventListener('updatefound', function () { watch(reg.installing); });
        watch(reg.installing);
        if (ready) check(true);
      }).catch(function () { lastMessage = '离线资源未准备，联网时仍可使用'; render(); });
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });
    setInterval(function () { if (!document.hidden) check(false); }, 30 * 60000);
    render();
  }
  function appReady() {
    ready = true; render(); check(true);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }
  App.updates = { init: init, appReady: appReady, check: check, apply: applyUpdate, busyReason: busyReason, showBlocked: showBlocked };
})();
