// sw.js - App-shell service worker; precaches HTML/CSS/JS, passes BSData fetches through.
const SHELL = 'yaab-shell-v15';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/img/icon-192.svg',
  '/img/icon-512.svg',
  '/css/style.css',
  '/css/validation.css',
  '/css/datasheet.css',
  '/css/mobile.css',
  '/css/celebrations.css',
  '/css/command-palette.css',
  '/css/analytics.css',
  '/css/starter-lists.css',
  '/css/quirky.css',
  '/css/legends-toggle.css',
  '/css/match-mode.css',
  '/css/damage-calc.css',
  '/css/opponent.css',
  '/css/army-diff.css',
  '/css/favorites.css',
  '/css/tournament-export.css',
  '/css/deployment-planner.css',
  '/css/lore.css',
  '/css/utilities.css',
  '/css/collection.css',
  '/css/synergy.css',
  '/css/stratagems.css',
  '/css/crusade.css',
  '/css/kill-team.css',
  '/css/activity-log.css',
  '/css/community-feed.css',
  '/css/design-pass.css',
  '/js/vendor/html2pdf.bundle.min.js',
  '/js/vendor/qrcode.min.js',
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
  '/js/ui/dropdown.js',
  '/js/app/state.js',
  '/js/app/hooks.js',
  '/js/app/filters.js',
  '/js/app/render.js',
  '/js/app/selections.js',
  '/js/app/resize.js',
  '/js/app/events.js',
  '/js/app/bsdata-load.js',
  '/js/app/history.js',
  '/js/app/url-share.js',
  '/js/app/validation.js',
  '/js/app/keyboard.js',
  '/js/app/pwa-install.js',
  '/js/app/command-palette.js',
  '/js/app/starter-lists.js',
  '/js/app/flavor.js',
  '/js/app/ork-math.js',
  '/js/app/nickname.js',
  '/js/ui/celebrations.js',
  '/js/ui/analytics.js',
  '/js/ui/dice-roller.js',
  '/js/app/legends-toggle.js',
  '/js/app/match-mode.js',
  '/js/ui/damage-calc.js',
  '/js/app/opponent.js',
  '/js/ui/matchup.js',
  '/js/app/army-diff.js',
  '/js/app/favorites.js',
  '/js/ui/tournament-export.js',
  '/js/ui/deployment-planner.js',
  '/js/data/lore-data.js',
  '/js/app/lore.js',
  '/js/app/points-override.js',
  '/js/app/bug-report.js',
  '/js/app/qr-share.js',
  '/js/app/collection.js',
  '/js/ui/synergy.js',
  '/js/app/stratagems.js',
  '/js/app/crusade.js',
  '/js/app/kill-team.js',
  '/js/app/activity-log.js',
  '/js/app/community-feed.js',
  '/js/data/community-feed.json',
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
