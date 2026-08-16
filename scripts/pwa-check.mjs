// pwa-check.mjs — prove yaab is installable and that its service worker cannot
// serve a stale build. Run against the LIVE site in a real headless Chrome:
//
//   ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yetanotherarmybuilder/app/scripts/pwa-check.mjs \
//     ~/sites/base/browser/out/yaab-pwa
//
// READ-ONLY. It loads pages, reads the cache, and toggles the browser's own
// offline flag. It writes nothing to the site and nothing to any database.
//
// WHY: curl proves the routes answer. It cannot prove Chrome will offer
// "Install app", and it certainly cannot prove the thing that actually matters
// here — that a deploy is still visible on an ordinary reload. yaab shipped a
// cache-first service worker in April that made fixes invisible in normal
// browsing, and app/sw.js is the redesign. The CACHE HYGIENE block below is the
// regression test for that failure; everything else is table stakes.
//
// It does NOT assert on `beforeinstallprompt`. That event does not fire
// reliably in headless Chrome (it is gated on an engagement heuristic), so a
// check built on it fails for reasons unrelated to the site. Assert the
// criteria Chrome actually evaluates instead — which is what
// meds/scripts/push-check.mjs does, and for the same reason.
//
// This needs neither channel:'chromium' nor launchPersistentContext. Those are
// Notifications/Push requirements; installability is visible from plain
// headless with an ordinary context.
import { chromium } from 'playwright';

const OUT = process.env.OUT || '/out';
const BASE = 'https://yaab.thewheeliebois.com';

let pass = 0, fail = 0;
const fails = [];
function check(label, ok, detail) {
  const line = `${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`;
  console.log(line);
  if (ok) pass++; else { fail++; fails.push(label); }
}

/**
 * Poll a page.evaluate until it returns something truthy.
 *
 * DO NOT use page.waitForFunction here. It injects a polling script into the
 * page, and yaab's CSP is script-src 'self' with no 'unsafe-eval', so the
 * injection is blocked and the wait rejects instantly rather than waiting.
 * Wrapped in the usual silent catch, that reads as "the thing never happened"
 * and every assertion after it races the page. page.evaluate itself is fine —
 * it goes over CDP and is not subject to the page's CSP.
 */
async function until(page, fn, { timeout = 20000, step = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(step);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [], pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));

// ── 1. The page itself ───────────────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90000 });

// Two console messages are expected on a clean load and are filtered out:
//   * a 401 from auth.js probing /api/auth/me — this is a signed-out visit.
//   * Chrome's notice that `frame-ancestors` is ignored in a <meta> CSP. That
//     is true and long-standing (see homewebhost#11); yaab keeps its CSP in a
//     meta tag deliberately, so the policy stays in git rather than in an
//     unversioned Caddy fragment. Nothing to do with the service worker.
const EXPECTED = [/status of 401/, /'frame-ancestors' is ignored/];
const realConsole = consoleErrors.filter(t => !EXPECTED.some(re => re.test(t)));
check('no page exceptions', pageErrors.length === 0, pageErrors[0]);
check('no unexpected console errors', realConsole.length === 0, realConsole[0]);
// Specifically the directives added for the worker. A blocked worker fails
// silently everywhere else, which is exactly why they are spelled out in the
// meta CSP rather than left to the browser's fallback chain.
const cspBlocked = consoleErrors.filter(t =>
  /Content Security Policy/i.test(t) && /(worker-src|manifest-src|script-src)/.test(t));
check('CSP did not block the worker or manifest', cspBlocked.length === 0, cspBlocked[0]);

// ── 2. Service worker ────────────────────────────────────────────────────────
const sw = await until(page, async () => {
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg && reg.active ? { scope: reg.scope, state: reg.active.state } : null;
});
check('service worker registered and active', !!sw, sw ? `${sw.scope} (${sw.state})` : 'never became active');

// A worker only controls pages that loaded after it took over. clients.claim()
// should make that the very next navigation, not a later one.
await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
const controller = await until(page, () => !!navigator.serviceWorker.controller);
check('page is controlled after one reload', !!controller);

// ── 3. Manifest / installability criteria ────────────────────────────────────
const man = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href;
  if (!href) return null;
  try { return await (await fetch(href)).json(); } catch (_) { return null; }
});
check('manifest linked and parses', !!man);
check('display is standalone', man?.display === 'standalone', man?.display);
check('has start_url, scope and id', !!(man?.start_url && man?.scope && man?.id));

const icons = man?.icons || [];
const png = (sz) => icons.some(i => i.type === 'image/png' && String(i.sizes).includes(sz));
check('PNG icon at 192', png('192'));
check('PNG icon at 512', png('512'));
check('has a maskable icon', icons.some(i => String(i.purpose || '').includes('maskable')));
// The bug this replaced: one file declared "any maskable" gets used unmasked
// AND masked, so the same art is clipped in the masked context.
check('no icon is both any and maskable',
  !icons.some(i => /any/.test(i.purpose || '') && /maskable/.test(i.purpose || '')),
  icons.map(i => i.purpose).join(' | '));

const iconStatus = await page.evaluate(async (list) => {
  const out = [];
  for (const i of list) {
    try {
      const r = await fetch(i.src);
      out.push({ src: i.src, status: r.status, type: r.headers.get('content-type') || '' });
    } catch (_) { out.push({ src: i.src, status: 0, type: '' }); }
  }
  return out;
}, icons);
const badIcon = iconStatus.find(i => i.status !== 200 || !i.type.startsWith('image/'));
check('every manifest icon 200s with an image type', !badIcon, badIcon && `${badIcon.src} → ${badIcon.status} ${badIcon.type}`);

const apple = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
check('apple-touch-icon is a PNG', /\.png$/.test(apple || ''), apple || 'missing');

// ── 4. Cache hygiene — the regression test ───────────────────────────────────
const swSrc = await page.evaluate(async () => (await fetch('/sw.js', { cache: 'no-store' })).text());
const wantVersion = swSrc.match(/const VERSION = '([^']+)'/)?.[1];
check('sw.js declares a VERSION', !!wantVersion, wantVersion);

// Poll for the CURRENT generation rather than just "some cache exists". On a
// fresh context there is only ever one, but against a warm profile that already
// holds a previous generation, the new worker needs to install its shell and
// activate before the old key is evicted — measured at ~3.3s after a reload
// settles. Asserting immediately reads mid-rotation and fails for a reason that
// has nothing to do with the site.
const keys = await until(page, async () => {
  const k = await caches.keys();
  return k.length ? k : null;
}, { timeout: 30000 }) || [];
const rotated = await until(page, async () => {
  const k = await caches.keys();
  return (k.length === 1 && k[0].startsWith('yaab-shell-')) ? k : null;
}, { timeout: 30000 }) || keys;
check('exactly one cache exists (old generations evicted)', rotated.length === 1,
  rotated.join(', ') || 'none');
check('cache name equals sw.js VERSION', rotated[0] === wantVersion, `${rotated[0]} vs ${wantVersion}`);
keys.length = 0; keys.push(...rotated);

// THE deploy-freshness assertion. The cache name carries the same ?v= token the
// page stamps onto its assets; if they diverge, the worker's activate() never
// drops the old generation and a deploy could go unseen.
const domToken = await page.evaluate(() => {
  const s = document.querySelector('script[src*="?v="]');
  return s ? new URL(s.src).searchParams.get('v') : null;
});
check('cache token matches the live asset ?v= stamp',
  !!domToken && wantVersion === `yaab-shell-${domToken}`, `${wantVersion} vs ?v=${domToken}`);

const cached = await page.evaluate(async (name) => {
  const c = await caches.open(name);
  return (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
}, keys[0]);
check('nothing under /api/ is cached', !cached.some(u => u.startsWith('/api/')),
  cached.filter(u => u.startsWith('/api/'))[0]);
check('nothing under /data/ is cached', !cached.some(u => u.startsWith('/data/')),
  cached.filter(u => u.startsWith('/data/'))[0]);
check('sw.js itself is not cached', !cached.some(u => u === '/sw.js'));
check('cache entry count is sane (50-400)', cached.length >= 50 && cached.length <= 400, String(cached.length));
const unstamped = cached.filter(u => /\.(js|css)$/.test(u.split('?')[0]) && !u.includes('?v='));
check('every cached js/css carries a ?v= stamp', unstamped.length === 0, unstamped[0]);

// ── 5. Offline ───────────────────────────────────────────────────────────────
await ctx.setOffline(true);
let offlineOk = true, offlineErr = '';
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#panel-left', { timeout: 20000 });
} catch (e) { offlineOk = false; offlineErr = e.message.split('\n')[0]; }
check('app shell paints with the network off', offlineOk, offlineErr);

const feedOffline = await page.evaluate(async () => {
  try { const r = await fetch('js/data/community-feed.json'); return r.ok; } catch (_) { return false; }
});
check('community feed is served from cache offline', feedOffline);

await page.screenshot({ path: `${OUT}/pwa-offline-desktop.png`, fullPage: false });
await ctx.setOffline(false);

// ── 6. Screenshots ───────────────────────────────────────────────────────────
await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
await page.screenshot({ path: `${OUT}/pwa-desktop.png`, fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/pwa-phone.png`, fullPage: false });

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failed: ' + fails.join('; ')); process.exit(1); }
