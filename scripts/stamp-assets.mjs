#!/usr/bin/env node
// scripts/stamp-assets.mjs
//
// Cache-busting stamp. Appends `?v=<version>` to every local <script src="js/…">
// and <link rel="stylesheet" href="css/…"> in index.html so a new release
// changes those URLs and browsers fetch the fresh code instead of a cached
// copy. The version is read straight from js/data/changelog-data.js
// (App.CHANGELOG.version) — the same CalVer string we already bump on every
// release — so there is exactly one source of truth and nothing extra to keep
// in sync.
//
// This is belt-and-suspenders: the Caddy site config already serves
// index.html / *.js / *.css with `Cache-Control: no-cache`, which forces a
// revalidation (cheap 304 when unchanged) on every load, so freshness holds
// even if you forget to run this. Re-running it is still good hygiene and
// makes the live version visible in the page source.
//
// Idempotent: an existing `?v=…` is replaced, not duplicated. Font preloads
// (woff2) are intentionally skipped — their URLs must match the CSS
// @font-face requests or the preload is wasted.
//
// The nightly data refresh also redeploys js/vendor/dc-bundle.js WITHOUT a
// release, and that content needs a new URL too. It must not bump
// App.CHANGELOG.version to get one: changelog.js lights the "What's new" dot by
// comparing that version against yaab_changelog_seen, so bumping it daily would
// show every user a new-updates badge over an unchanged changelog. Instead the
// refresh passes --data <hash>, which suffixes the token as `<version>-d<hash>`.
// The release version stays visible in the URL, the cache key still changes,
// and the changelog is untouched.
//
// It also stamps the service worker's cache name (`const VERSION` in sw.js)
// from the same token. That coupling is load-bearing rather than tidy: the
// Cache API keys on the full URL including the query, so a release rotates all
// ~190 asset cache keys at once, and if VERSION did not move with them the
// worker's activate() would never drop the superseded generation and the cache
// would grow by ~14 MB per release. One token, one source of truth, stamped in
// the same pass, so the two cannot disagree.
//
// Usage (no deps):
//   node scripts/stamp-assets.mjs                # stamp using changelog version
//   node scripts/stamp-assets.mjs --data <hash>  # …plus a data-only suffix
//   node scripts/stamp-assets.mjs --check        # exit 1 if index.html or sw.js is stale

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = resolve(ROOT, 'index.html');
const CHANGELOG = resolve(ROOT, 'js/data/changelog-data.js');
// The build id printed on the boot splash. It exists so that "am I actually
// running the new code?" is answerable by LOOKING at the loading screen,
// without DevTools — the question that has cost hours every time a caching
// problem is suspected.
const BUILD_RE = /(<span id="boot-build"[^>]*>|<div class="boot-splash-build" id="boot-build">)([^<]*)(<)/;
const SW = resolve(ROOT, 'sw.js');
const SW_PREFIX = 'yaab-shell-';
const SW_VERSION_RE = /(const VERSION = ')([^']*)(';)/;

const checkOnly = process.argv.includes('--check');
const dataIx = process.argv.indexOf('--data');
const dataHash = dataIx > -1 ? (process.argv[dataIx + 1] || '').replace(/[^0-9a-f]/gi, '').slice(0, 8) : '';

const changelogSrc = await readFile(CHANGELOG, 'utf8');
const m = changelogSrc.match(/version:\s*'([^']+)'/);
if (!m) {
  console.error('FATAL: could not find App.CHANGELOG.version in changelog-data.js');
  process.exit(2);
}
const version = m[1];
const token = encodeURIComponent(dataHash ? `${version}-d${dataHash}` : version);

let html = await readFile(INDEX, 'utf8');

// Match the URL inside src="…" / href="…" when it points at a local js/ or
// css/ asset ending in .js or .css, with an optional existing ?v=… we strip.
const ASSET_RE = /(\b(?:src|href)=")((?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?(")/g;
// Same match, but capturing the existing ?v= value so --check can inspect it.
const ASSET_RE_CHECK = /(\b(?:src|href)=")((?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=([^"]*))?(")/g;

let count = 0;
let stamped = html.replace(ASSET_RE, (_full, pre, path, post) => {
  count++;
  return `${pre}${path}?v=${token}${post}`;
});
// …and the build id shown on the boot splash.
const buildText = `build ${dataHash ? `${version}-d${dataHash}` : version}`;
stamped = stamped.replace(BUILD_RE, (_f, pre, _old, post) => `${pre}${buildText}${post}`);

// --check accepts EITHER the bare release version or that version carrying a
// data suffix. Both are current: the second is what a nightly bundle refresh
// leaves behind, and failing CI on it would make every data-only deploy look
// like a stale stamp.
// The service worker's cache name carries the same token. Read it up front so
// both --check and the write path can see it: index.html and sw.js are stamped
// in ONE pass, and neither may early-exit before the other is handled. (An
// earlier version of this script returned as soon as index.html was already
// current, which would have silently left a stale VERSION behind on any run
// where only sw.js needed moving.)
const plainToken = decodeURIComponent(token);
const swSrc = await readFile(SW, 'utf8');
const swMatch = swSrc.match(SW_VERSION_RE);
if (!swMatch) {
  console.error(`FATAL: could not find \`const VERSION = '…';\` in sw.js`);
  process.exit(2);
}
const swHave = swMatch[2];
const swWant = SW_PREFIX + plainToken;

if (checkOnly) {
  const okRe = new RegExp(`^${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-d[0-9a-f]{1,8})?$`);
  const stale = [];
  for (const mm of html.matchAll(ASSET_RE_CHECK)) {
    const got = mm[3] ? decodeURIComponent(mm[3]) : '';
    if (!okRe.test(got)) stale.push(`${mm[2]} (v=${got || 'none'})`);
  }
  // sw.js is held to the same rule: bare release version, or that version
  // carrying a nightly data suffix.
  const swStale = !(swHave.startsWith(SW_PREFIX) && okRe.test(swHave.slice(SW_PREFIX.length)));
  const bm = html.match(BUILD_RE);
  const buildHave = bm ? bm[2].replace(/^build /, '') : null;
  const buildStale = !buildHave || !okRe.test(buildHave);
  if (stale.length || swStale || buildStale) {
    if (stale.length) {
      console.error(`[stamp] STALE: ${stale.length} asset(s) not stamped at v=${version}[-d…]. `
        + `First: ${stale[0]}.`);
    }
    if (swStale) console.error(`[stamp] STALE: sw.js VERSION is '${swHave}', expected '${SW_PREFIX}${version}[-d…]'.`);
    if (buildStale) console.error(`[stamp] STALE: boot-splash build id is '${buildHave || 'missing'}', expected '${version}[-d…]'.`);
    console.error('[stamp] Run: node scripts/stamp-assets.mjs');
    process.exit(1);
  }
  console.log(`[stamp] index.html (${count} assets) and sw.js are current at v=${version}[-d…].`);
  process.exit(0);
}

if (stamped === html) {
  console.log(`[stamp] index.html already at v=${plainToken} (${count} assets).`);
} else {
  await writeFile(INDEX, stamped, 'utf8');
  console.log(`[stamp] stamped ${count} js/css assets in index.html with ?v=${plainToken}.`);
}

if (swHave === swWant) {
  console.log(`[stamp] sw.js VERSION already ${swWant}.`);
} else {
  await writeFile(SW, swSrc.replace(SW_VERSION_RE, `$1${swWant}$3`), 'utf8');
  console.log(`[stamp] sw.js VERSION: ${swHave} -> ${swWant}`);
}
