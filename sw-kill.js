// sw-kill.js — emergency kill switch for the app-shell service worker.
//
// TO USE (both steps, in one deploy):
//   1. cp app/sw-kill.js app/sw.js
//   2. revert app/js/app/sw-register.js to a no-op, or every new visit
//      immediately re-registers the worker you are trying to remove
//   3. node scripts/stamp-assets.mjs && commit && push
//
// Every client drops the worker and every cache on its NEXT navigation. That is
// reliable for three independent reasons, all of which must stay true: Caddy
// serves *.js with Cache-Control: no-cache, the registration passes
// updateViaCache:'none', and sw.js refuses to intercept itself. See rule 1 in
// app/sw.js.
//
// LEAVE IT IN PLACE FOR AT LEAST 30 DAYS before restoring with
// `git checkout app/sw.js`, so clients that visit rarely still get cleaned up.
// The previous retirement sat here for 3.5 months, which is why the return to a
// real worker needed no migration at all.

self.addEventListener('install', () => self.skipWaiting());

// waitUntil is NOT optional. Without it the browser is free to terminate this
// worker the moment the handler returns — which, for an `async` handler, is at
// the first await. The cache deletion and the unregister would then be killed
// mid-flight and the kill switch would silently fail to kill anything. This
// file shipped with that bug from 2026-04-27 until 2026-08-16.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    try { await self.registration.unregister(); } catch (_) {}
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => { try { c.navigate(c.url); } catch (_) {} });
  })());
});
