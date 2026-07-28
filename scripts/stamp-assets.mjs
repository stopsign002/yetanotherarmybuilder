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
// Usage (no deps):
//   node scripts/stamp-assets.mjs                # stamp using changelog version
//   node scripts/stamp-assets.mjs --data <hash>  # …plus a data-only suffix
//   node scripts/stamp-assets.mjs --check        # exit 1 if index.html is stale

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = resolve(ROOT, 'index.html');
const CHANGELOG = resolve(ROOT, 'js/data/changelog-data.js');

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
const stamped = html.replace(ASSET_RE, (_full, pre, path, post) => {
  count++;
  return `${pre}${path}?v=${token}${post}`;
});

// --check accepts EITHER the bare release version or that version carrying a
// data suffix. Both are current: the second is what a nightly bundle refresh
// leaves behind, and failing CI on it would make every data-only deploy look
// like a stale stamp.
if (checkOnly) {
  const okRe = new RegExp(`^${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-d[0-9a-f]{1,8})?$`);
  const stale = [];
  for (const mm of html.matchAll(ASSET_RE_CHECK)) {
    const got = mm[3] ? decodeURIComponent(mm[3]) : '';
    if (!okRe.test(got)) stale.push(`${mm[2]} (v=${got || 'none'})`);
  }
  if (stale.length) {
    console.error(`[stamp] STALE: ${stale.length} asset(s) not stamped at v=${version}[-d…]. `
      + `First: ${stale[0]}. Run: node scripts/stamp-assets.mjs`);
    process.exit(1);
  }
  console.log(`[stamp] index.html is current at v=${version}[-d…] (${count} assets).`);
  process.exit(0);
}

if (stamped === html) {
  console.log(`[stamp] index.html already at v=${decodeURIComponent(token)} (${count} assets).`);
  process.exit(0);
}

await writeFile(INDEX, stamped, 'utf8');
console.log(`[stamp] stamped ${count} js/css assets in index.html with ?v=${decodeURIComponent(token)}.`);
