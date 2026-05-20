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
// Usage (no deps):
//   node scripts/stamp-assets.mjs            # stamp using changelog version
//   node scripts/stamp-assets.mjs --check    # exit 1 if index.html is stale

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = resolve(ROOT, 'index.html');
const CHANGELOG = resolve(ROOT, 'js/data/changelog-data.js');

const checkOnly = process.argv.includes('--check');

const changelogSrc = await readFile(CHANGELOG, 'utf8');
const m = changelogSrc.match(/version:\s*'([^']+)'/);
if (!m) {
  console.error('FATAL: could not find App.CHANGELOG.version in changelog-data.js');
  process.exit(2);
}
const version = m[1];
const token = encodeURIComponent(version);

let html = await readFile(INDEX, 'utf8');

// Match the URL inside src="…" / href="…" when it points at a local js/ or
// css/ asset ending in .js or .css, with an optional existing ?v=… we strip.
const ASSET_RE = /(\b(?:src|href)=")((?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?(")/g;

let count = 0;
const stamped = html.replace(ASSET_RE, (_full, pre, path, post) => {
  count++;
  return `${pre}${path}?v=${token}${post}`;
});

if (stamped === html) {
  console.log(`[stamp] index.html already at v=${version} (${count} assets).`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`[stamp] STALE: index.html is not stamped at v=${version}. Run: node scripts/stamp-assets.mjs`);
  process.exit(1);
}

await writeFile(INDEX, stamped, 'utf8');
console.log(`[stamp] stamped ${count} js/css assets in index.html with ?v=${version}.`);
