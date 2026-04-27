// app/sw-register.js — service worker disabled.
//
// The site previously installed an app-shell service worker that precached
// every HTML/CSS/JS file and served them cache-first. That made shipping
// fixes painful (had to bump SHELL and reload twice). We now load every
// asset over the network on each visit, with normal HTTP caching only.
//
// Browsers that have a stale SW installed from before this change will
// auto-fetch /sw.js, find the new "kill-switch" version (which unregisters
// itself and wipes the cache on activate), and clean up. After that the
// browser is in the same state as a fresh visit.
(function () {
  if (!('serviceWorker' in navigator)) return;
  // Belt-and-suspenders: if the kill-switch SW hasn't run yet (e.g. an
  // older SW is intercepting before /sw.js is even fetched), proactively
  // unregister all SWs we own. This is idempotent and safe.
  try {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => { try { r.unregister(); } catch (_) {} });
    }).catch(() => {});
  } catch (_) {}
})();
