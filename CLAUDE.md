# CLAUDE.md

## What this is

A client-only static site (no build step) that fetches BattleScribe 10th-edition XML from `BSData/wh40k-10e` over GitHub's raw.githubusercontent.com and the raw tree API, parses it in-browser with `DOMParser`, and lets a user build an army list. Persists armies and cached faction data in `localStorage` / `sessionStorage`.

## Running it

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Cannot be opened via `file://` — the BSData fetch requires http(s).

## File map

- `index.html` — single-page shell, hand-wired `<script>` tag order matters
- `css/style.css` — all styling, one file
- `js/bsdata.js` — GitHub tree + raw.githubusercontent.com fetch, session-cache, bulk loader with 6-worker pool
- `js/parser/` — BattleScribe XML → plain-object units (see `docs/PARSER.md`)
- `js/storage.js` — localStorage armies + compact `YAAB1:` export/import (deflate-raw + base64url)
- `js/army.js` — `Army` + `ArmyManager` classes
- `js/ui/` — all DOM rendering, split by concern (see `docs/UI.md`)
- `js/app/` — bootstrap, state, event wiring, filters (see `docs/UI.md`)
- `docs/` — architecture/parser/ui docs (read these before non-trivial changes)

## Module conventions

- No build step. No `import`/`export`. Scripts are plain `<script src>` tags in `index.html`. Each file is an IIFE that attaches to `window.WahapediaParser`, `window.UI`, or `window.App`.
- Public namespaces: `WahapediaParser` (`parse` / `addToSharedIndex` / `releaseSharedIndex`), `UI` (see `docs/UI.md`), `App` (see `docs/UI.md`), plus globals `Storage`, `Army`, `ArmyManager`, `BSData`.
- Script order in `index.html`:
  - `bsdata.js`
  - `parser/*` — `shared-index.js` first (seeds internals), leaf helpers next, `entry.js` → `catalogue.js`, `index.js` LAST (exposes public API)
  - `storage.js` → `army.js`
  - `ui/*` — `index.js` first (defines `UI.init`), feature modules after
  - `app/*` — `state.js` first, `index.js` LAST (it's the DOMContentLoaded handler)
- IIFEs register onto shared globals; none do DOM work at load time. Load-order within a folder is defensive — functions are resolved lazily by name.

## Editing guidance for Claude

- Files are small on purpose. Find the right one in the file map first; don't grep the whole repo.
- Don't introduce a bundler, framework, or TypeScript. Keep vanilla JS.
- Don't change the output shape of `WahapediaParser.parse()` — `storage.js`, `app/*`, and `ui/*` all consume it.
- When bumping the parsed-unit shape, also bump `FACTION_CACHE_PREFIX` in `js/bsdata.js` (`yaab_bsf_10e_vN_` → `vN+1_`) to invalidate stale session cache.
- "How to add X" recipes live in `docs/UI.md` — read it before implementing a new feature that spans parser/UI/state.

## Known caches

| Key pattern | Store | What | When to invalidate |
|---|---|---|---|
| `yaab_bsf_10e_v7_<faction>` | sessionStorage | Parsed faction objects | Bump `v7` → `v8` in `bsdata.js` when parsed-unit shape changes |
| `yaab_gst_10e_v3_<file>` | sessionStorage | Raw XML for `.gst` + `Library *.cat` | Bump `v3` → `v4` in `bsdata.js` when BSData tree-level format changes |
| `yaab_bsdata_filelist_10e_v1` | sessionStorage | GitHub tree listing | Bump `v1` → `v2` on repo/tree shape changes |
| `yaab_armies` | localStorage | Saved armies (array of `Army.toJSON()`) | User-facing; don't break compatibility without a migration |
| `yaab_factions` | localStorage | Unused by active path, retained for compat | Leave alone |
