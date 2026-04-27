// sw.js — kill-switch for the legacy app-shell service worker.
//
// Earlier versions precached HTML/CSS/JS via a "yaab-shell-v*" cache and
// served them cache-first. That meant every code update required bumping
// SHELL and waiting for the new SW to activate before users got the fix —
// exactly the loop we don't want for active development. This version
// exists solely to unregister itself and clear the old cache, so existing
// installs migrate cleanly to the no-SW world.
//
// New visits don't install a SW at all (sw-register.js no longer calls
// register). Going forward the browser fetches each asset from the
// network with normal HTTP caching only.

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('yaab-shell-v'))
            .map((k) => caches.delete(k))
      );
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const all = await self.clients.matchAll({ includeUncontrolled: true });
      for (const c of all) {
        try { c.navigate(c.url); } catch (_) {}
      }
    } catch (_) {}
  })());
});

// Pass every fetch through to the network — no caching, no app-shell
// fallback. The activate handler above also unregisters us, so this
// listener is only relevant for the brief window between install and
// activate.
self.addEventListener('fetch', () => {});
