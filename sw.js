// sw.js - App-shell service worker; precaches HTML/CSS/JS, passes BSData fetches through.
const SHELL = 'yaab-shell-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/theme.css',
  '/css/validation.css',
  '/css/datasheet.css',
  '/js/db.js',
  '/js/bsdata.js',
  '/js/storage.js',
  '/js/army.js',
  '/js/parser/shared-index.js',
  '/js/parser/classify.js',
  '/js/parser/stats.js',
  '/js/parser/weapons.js',
  '/js/parser/abilities.js',
  '/js/parser/wargear.js',
  '/js/parser/costs.js',
  '/js/parser/keywords.js',
  '/js/parser/entry.js',
  '/js/parser/catalogue.js',
  '/js/parser/index.js',
  '/js/parser/report.js',
  '/js/ui/index.js',
  '/js/ui/helpers.js',
  '/js/ui/tooltip.js',
  '/js/ui/toast.js',
  '/js/ui/progress.js',
  '/js/ui/modals.js',
  '/js/ui/roster.js',
  '/js/ui/detail.js',
  '/js/ui/army-list.js',
  '/js/ui/faction-filter.js',
  '/js/ui/faction-rules.js',
  '/js/ui/datasheet.js',
  '/js/app/state.js',
  '/js/app/hooks.js',
  '/js/app/filters.js',
  '/js/app/render.js',
  '/js/app/selections.js',
  '/js/app/resize.js',
  '/js/app/events.js',
  '/js/app/bsdata-load.js',
  '/js/app/theme.js',
  '/js/app/history.js',
  '/js/app/url-share.js',
  '/js/app/validation.js',
  '/js/app/keyboard.js',
  '/js/app/sw-register.js',
  '/js/app/index.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n.startsWith('yaab-shell-v') && n !== SHELL)
           .map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Cross-origin (BSData, GitHub API, anything else): pass through, never cache here.
  if (url.origin !== self.location.origin) return;

  // Same-origin: cache-first with network fallback; opportunistically refresh cache.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(SHELL).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
