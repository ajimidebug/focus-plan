/* Keep the document bounded and the app navigation inside the visible viewport.
 * No touch interception, zoom restriction or replacement scrolling container. */
(function () {
  'use strict';
  if (!window.__MEMO_MODE) return;
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;
  let frame = 0;
  const viewport = window.visualViewport;
  function layout() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // At zoom > 1 the browser owns panning; don't counteract accessibility zoom.
      const normalScale = !viewport || Math.abs(viewport.scale - 1) < .01;
      const inset = normalScale && viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      nav.style.setProperty('--nav-inset', inset + 'px');
      const height = nav.getBoundingClientRect().height;
      document.body.style.setProperty('--app-nav-room', height + inset + 16 + 'px');
      // Repair stale horizontal offsets after a resize / an old version update.
      // Local component scrollers are intentionally unaffected.
      if (normalScale && window.scrollX !== 0) window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
    });
  }
  viewport?.addEventListener('resize', layout, { passive: true });
  viewport?.addEventListener('scroll', layout, { passive: true });
  window.addEventListener('resize', layout, { passive: true });
  window.addEventListener('pageshow', layout, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(layout).observe(nav);
  layout();
})();
