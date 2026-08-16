// app/sw-register.js — register the app-shell service worker.
//
// Loaded LAST in index.html and wrapped in window 'load' on purpose: boot
// already has ~190 asset requests in flight, and the worker's install issues
// its own. Registration is fire-and-forget — a failure here must never break
// the app, so the catch is deliberately silent. Without a worker the app
// behaves exactly as it did before, just with more round trips and no install
// prompt.
//
// From 2026-04-27 to 2026-08-16 this file did the opposite: it unregistered
// every registration on every load, as the cleanup half of the service-worker
// retirement (commit ad3fca7). That cleanup has had 3.5 months to run, so the
// worker being registered here is not fighting anything. Read app/sw.js's four
// rules before changing any of this.
//
// updateViaCache:'none' is not optional. It tells the browser to bypass its
// HTTP cache when checking /sw.js for updates, which is what keeps the kill
// switch in app/sw-kill.js reachable. Caddy already sends no-cache for *.js;
// this is the belt to that pair of braces.
//
// NEVER version this URL (/sw.js?v=…). A changed script URL creates a SECOND
// registration rather than updating the existing one, and you end up with two
// workers fighting over the same scope. scripts/stamp-assets.mjs only rewrites
// src=/href= attributes in index.html, so the string below is out of its reach
// — keep it that way if you ever widen that regex.
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    try {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(function () { /* http, private mode, storage disabled — non-fatal */ });
    } catch (_) { /* non-fatal */ }
  });
})();
