# build/ — 40kdc data bundle source

Produces `../js/vendor/dc-bundle.js`, the embedded 40kdc 11th-edition dataset +
ability-text store exposed as `window.DC`. Consumed by `../js/data/dc-adapter.js`,
which maps it into yaab's parser shape and overrides `window.BSData`.

This is the ONE build step in an otherwise buildless app. The committed
`dc-bundle.js` is the artifact the site loads; rebuild it only when bumping the
40kdc dataset or editing `dc-entry.mjs`.

## When a new MFM (Munitorum Field Manual) drops

The daily `~/sites/base/refresh-40kdc.sh` cron (04:45) re-scrapes
mfm.warhammer-community.com every run and rebuilds the bundle, so a new MFM
picks itself up the next morning with zero manual work. To pull it
immediately:

```
FORCE_REFRESH=1 ~/sites/base/refresh-40kdc.sh
tail -25 ~/sites/base/refresh-40kdc.log
```

The last log lines print the scrape + validation summary. Sanity check them
against the previous run:

- `mfm wargear scrape rc=0` — non-zero rc means the scrape failed and the
  script kept the last-known-good overlay (`~/sites/base/mfm-wargear-costs.json`).
  MFM site down or page format drift — investigate `mfm-scrape-wargear.py`.
- `matchRate` near `1.0` and `pairs` roughly ≥60 — big drop = new unit names
  the alias map doesn't cover. Look for `UNMATCHED` rows in the scrape output
  (also in the emailed summary) and add entries to
  `~/sites/base/mfm-aliases.json`, then re-run.
- `pointsUnits` well above the `700` gate — a large drop means the ordinal /
  composition parsing missed something in the new MFM layout.
- `validation ok: {"ok":true,...,"shapeProblems":0}` — must be present. If
  absent, the script aborted before deploying and the previous bundle is still
  live.
- `deployed new bundle md5=...` followed by `pushed` — bundle changed and
  went live. `no change` means MFM produced the same data as last run.

The script auto-commits `js/vendor/dc-bundle.js` + `build/abilities-index.json`
and emails a summary via the mailer. Caddy's `no-cache` header makes the new
bundle reach users on the next page load — no changelog / stamp / version bump
needed (the bundle isn't stamped; it's revalidated).

## Files
- `dc-entry.mjs` — esbuild entry; imports the 40kdc collections + `abilities-index.json`.
- `abilities-index.json` — the `wn-mitch/40kdc-abilities` text store (`ability_id → raw_text`).
- `package.json` — pins `@alpaca-software/40kdc-data`.

## Source of truth: build from the 40kdc git repo, NOT npm

The published npm release lags `main` and ships mostly `pre-launch-provisional`
points. The committed `dc-bundle.js` is therefore built from the **40kdc-data git
`main`** (confirmed `launch` dataslate), which also carries far more stratagems /
enhancements than npm. Last built from `wn-mitch/40kdc-data` @ `c166929`.

### Rebuild from git main (no host node — use Docker)
```
# 1. clone + build the dataset package from source
gh repo clone wn-mitch/40kdc-data -- --depth 1
cd 40kdc-data
docker run --rm -v "$PWD":/work -w /work/tools -u "$(id -u):$(id -g)" \
  -e HOME=/work/tools node:22-alpine sh -c \
  'npm install --silent && npm run codegen:data && npx tsc -p .'
# → builds tools/dist with main's data embedded

# 2. bundle it (point the entry's dependency at file:../40kdc-data/tools)
#    package.json: { "dependencies": { "@alpaca-software/40kdc-data": "file:../40kdc-data/tools" } }
docker run --rm -v "$PWD/..":/work -w /work/build -u "$(id -u):$(id -g)" \
  -e HOME=/work/build node:22-alpine sh -c \
  'npm install --silent && npx --yes esbuild@0.24.0 dc-entry.mjs --bundle \
   --format=iife --platform=browser --outfile=/work/js/vendor/dc-bundle.js'
```

### Quick rebuild from npm (provisional points — fallback only)
```
cd app
docker run --rm -v "$PWD":/work -w /work/build -u "$(id -u):$(id -g)" \
  -e HOME=/work/build node:22-alpine sh -c \
  'npm install --silent && npx --yes esbuild@0.24.0 dc-entry.mjs --bundle \
   --format=iife --platform=browser --outfile=/work/js/vendor/dc-bundle.js'
```

## Refresh the ability-text store (when 40kdc-abilities updates)
```
gh api repos/wn-mitch/40kdc-abilities/contents/index.json \
  -H "Accept: application/vnd.github.raw" > build/abilities-index.json
# then rebuild
```
