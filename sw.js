// sw.js — yaab's app shell, cached.
//
// This file was a KILL SWITCH from 2026-04-27 (commit ad3fca7) until now. Read
// why before you touch anything below, because the reason it was killed is a
// real bug and this design exists specifically to prevent it recurring.
//
// WHY IT IS BACK. Chrome will not offer "Install app" unless a service worker
// with a fetch handler is registered. HTTPS, the manifest, display:standalone
// and the icons were all already in place, so this was the single missing
// criterion — js/app/pwa-install.js has been listening for a
// `beforeinstallprompt` that could never fire. Offline support comes along for
// free, and matters more here than it looks: the entire 40k dataset is embedded
// in js/vendor/dc-bundle.js and every army lives in localStorage, so the ONLY
// reason yaab dies without a network today is that the browser cannot fetch the
// page's own JavaScript. That is an artificial dependency, and this removes it.
//
// WHY THE OLD ONE WAS KILLED. It precached the whole shell and served it
// CACHE-FIRST. Every fix then needed a SHELL bump and two reloads to become
// visible, and the bug report was always "works in a private window but not my
// normal browser, and a hard refresh doesn't help."
//
// FOUR RULES, each of which is a failure already suffered on this box. Do not
// relax one to save a round trip.
//   1. THIS FILE IS NEVER CACHED BY ITSELF. Caddy's @code matcher covers *.js,
//      the registration passes updateViaCache:'none', and ours() below refuses
//      to intercept /sw.js. A cached service worker cannot be replaced by a
//      fixed one — and that is also what makes app/sw-kill.js reachable.
//   2. NAVIGATIONS ARE NETWORK-FIRST, falling back to the cached shell ONLY
//      when the network genuinely fails. Explicitly NOT on a timer: "slow" and
//      "offline" are different, a timer cannot tell them apart, and any device
//      routinely slower than the timer would be pinned to a stale shell — the
//      same invisible-deploy bug, wearing a different hat.
//   3. STATIC ASSETS ARE STALE-WHILE-REVALIDATE, NEVER CACHE-FIRST. Even if
//      VERSION never moves, every cached file is re-fetched in the background
//      on use and the cache self-heals within one extra load. This is the
//      precise difference from the failure above.
//   4. /api/ AND /data/ ARE NEVER TOUCHED. /api is user data behind an auth
//      cookie. /data is 48 MB — 11 MB of GDC prose that js/gdc.js already
//      read-throughs into IndexedDB (so those requests never recur after the
//      first load), plus 37 MB of dormant BSData XML. Caching either would
//      store a second copy of something the app already owns.
//      Mind the near-collision: js/data/community-feed.json lives under /js/,
//      NOT /data/, and IS cached. That is deliberate — it is what finally makes
//      community-feed.js's "load this page once online to cache it" true.
//
// If you find yourself wanting cache-first for JS to shave another round trip:
// don't. The round trip is already off the critical path, and the failure mode
// you would be reintroducing costs hours of confusion to save milliseconds.

// VERSION is both the cache name and the ?v= token the page stamps onto all 190
// of its js/css URLs. scripts/stamp-assets.mjs writes both from
// App.CHANGELOG.version (plus the nightly -d<md5> data suffix), so they cannot
// drift — do not hand-edit it.
//
// The coupling is load-bearing, not tidiness. The Cache API keys on the FULL
// URL including the query string, so a release rotates all 190 cache keys at
// once. If VERSION did not move with them, activate() would never fire and the
// cache would accumulate a fresh ~14 MB generation on every single release.
// Nothing in SHELL below is a js/css file, and stamp-assets.mjs only stamps
// those — so no SHELL entry needs a ?v= suffix appended here to match what the
// page will request.
const VERSION = 'yaab-shell-2026.08.19-1-d589e9240';

// Precached on install: ONLY what a cold OFFLINE navigation needs before the
// page can start asking for things itself.
//
// Deliberately NOT the 192 files index.html references (~14 MB, of which
// js/vendor/dc-bundle.js alone is 9.5 MB). Every one of those is requested by
// index.html on EVERY load, so rule 3 caches the whole set on load #1 for free.
// Precaching them would mean downloading 14 MB TWICE on the install visit —
// once for the page, once for cache.add() — for zero extra offline coverage.
//
// If you are about to add a file here because you added a feature module:
// don't. Rule 3 already covers it. See docs/UI.md.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/icon-192-maskable.png',
  '/img/icon-512-maskable.png',
  '/img/icon-180.png',
  '/img/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // Individually, not addAll: addAll is all-or-nothing, so one 404 on a
    // renamed icon would leave the install failed and the app with no offline
    // shell at all, silently.
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    // Take over immediately rather than waiting for every tab to close. A new
    // worker sitting in "waiting" for days is precisely how a stale shell
    // outlives its fix.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Wipe every previous generation wholesale. Do NOT get clever here and try
    // to migrate entries whose URLs differ only in ?v= to save the nightly
    // re-download — that is exactly the class of cleverness that produces "the
    // fix isn't showing up" bugs.
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// A request this worker is allowed to touch at all. Returning false means no
// respondWith is called, so the request goes to the network exactly as it would
// with no service worker installed.
function ours(url, req) {
  if (req.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;    // rule 4
  if (url.pathname.startsWith('/data/')) return false;   // rule 4
  if (url.pathname === '/sw.js') return false;           // rule 1, belt + braces
  return true;
}

self.addEventListener('fetch', (e) => {
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (!ours(url, e.request)) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(navigateWith(e.request));
    return;
  }
  e.respondWith(staleWhileRevalidate(e.request));
});

async function navigateWith(req) {
  const cache = await caches.open(VERSION);

  // NO TIMEOUT. The cached shell is served ONLY when the network genuinely
  // fails (offline, DNS failure, connection refused) — never merely because it
  // was slow.
  //
  // There used to be a 1500ms race here, copied from the fuel/meds pattern.
  // It is wrong for this site and it is wrong in a way that keeps costing
  // hours: "slow" and "offline" are not the same thing, and a timer cannot
  // tell them apart. Any device that is routinely slower than the timer gets
  // the stale shell on every load, which is indistinguishable from the
  // cache-first bug this whole file exists to prevent — and it is invisible to
  // whoever shipped the deploy, because their connection is fast.
  //
  // A hanging network now hangs the navigation, exactly as it would with no
  // service worker installed. That is the honest baseline: this worker is here
  // to make yaab work OFFLINE, not to paper over a bad connection at the cost
  // of correctness. Offline still works, because fetch rejects immediately
  // rather than hanging.
  try {
    const net = await fetch(req);
    // Cache under a FIXED key, never under req. Shared armies arrive as
    // /?a=YAAB1:<blob>, so keying on the request would mint a separate cache
    // entry per shared link and the cache would grow without bound.
    //
    // Only a real 200 is worth storing: a cached 5xx error page would be
    // indistinguishable from the app until the next deploy.
    if (net && net.ok) cache.put('/index.html', net.clone()).catch(() => {});
    if (net) return net;
  } catch (_) { /* genuinely unreachable — fall through to the cached shell */ }

  return (await cache.match('/index.html')) || (await cache.match('/'))
      || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  // EXACT match. Never pass { ignoreSearch: true } — that would serve the old
  // ?v= file for a new ?v= URL, which is the exact regression this whole design
  // is built to avoid. Exact matching means a version bump is a guaranteed
  // cache miss, so the correct new code lands on that same load.
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (!res || !res.ok) return res;
    // Deviation from the fuel/meds pattern, which cache.put()s unconditionally.
    // That is fine for ~20 files; yaab revalidates 190 URLs per load and one of
    // them is 9.5 MB, so an unconditional put rewrites ~14 MB to disk on EVERY
    // page load — real battery and flash wear on a phone. Caddy's file_server
    // ETags everything under app/, so an unchanged file costs a string compare
    // and a skipped write.
    //
    // This does NOT reintroduce staleness: any difference, or a missing ETag on
    // either side, still writes. The response itself is always returned from
    // the network regardless.
    const a = hit && hit.headers.get('ETag');
    const b = res.headers.get('ETag');
    if (!a || !b || a !== b) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  // The cached copy answers immediately; the network updates the cache for next
  // time. A file changed on the server is live on the LOAD AFTER NEXT at worst,
  // and immediately when VERSION moved — which stamp-assets.mjs guarantees for
  // every release and every nightly data deploy.
  return hit || (await net) || new Response('', { status: 504 });
}


// ── Kill switch ──────────────────────────────────────────────────────────────
// Per device, from a console on the page:
//   navigator.serviceWorker.getRegistrations()
//     .then(r => r.forEach(x => x.unregister()))
//     .then(() => caches.keys().then(k => k.forEach(c => caches.delete(c))));
//
// For everyone, if a device cannot be reached: `cp app/sw-kill.js app/sw.js`,
// revert js/app/sw-register.js to a no-op so new visits stop re-registering,
// re-stamp and deploy. Every client drops the worker and every cache on its
// NEXT navigation, because sw.js itself is never cached (rule 1). Leave the
// kill switch in place for at least 30 days before restoring this file from
// git, so long-tail clients pick it up. Full procedure in app/CLAUDE.md.
