# build/ — RETIRED

This directory used to produce `js/vendor/dc-bundle.js` (the embedded 40kdc
dataset exposed as `window.DC`) via esbuild. That bundle, `dc-adapter.js`, the
overlay machinery and the weekly `refresh-40kdc.sh` cron are replaced by the v2
dataset pipeline.

- Current data path and contract: `../docs/DATASET.md`
- Pipeline code and CLI: `../pipeline/` (`yaab-data build | validate | report | approve | rollback`)
- Removing the v1 scripts, cron lines and this directory: `../pipeline/retire-v1.md`

Nothing in `build/` runs any more; it is kept only until retire-v1 deletes it.
