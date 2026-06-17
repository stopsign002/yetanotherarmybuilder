# build/ — 40kdc data bundle source

Produces `../js/vendor/dc-bundle.js`, the embedded 40kdc 11th-edition dataset +
ability-text store exposed as `window.DC`. Consumed by `../js/data/dc-adapter.js`,
which maps it into yaab's parser shape and overrides `window.BSData`.

This is the ONE build step in an otherwise buildless app. The committed
`dc-bundle.js` is the artifact the site loads; rebuild it only when bumping the
40kdc dataset or editing `dc-entry.mjs`.

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
