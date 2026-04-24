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
- `css/{style,theme,datasheet,validation}.css` — base styling, light-theme overrides, print layout, validation banner
- `js/db.js` — IndexedDB wrapper (`YaabDB`) for cached factions + `.gst` XML
- `js/bsdata.js` — GitHub fetch + bulk loader with 6-worker pool, caches via `YaabDB`
- `js/parser/` — BattleScribe XML → plain-object units (see `docs/PARSER.md`)
- `js/storage.js` — localStorage armies + compact `YAAB1:` export/import
- `js/army.js` — `Army` + `ArmyManager` classes
- `js/ui/` — all DOM rendering, split by concern (see `docs/UI.md`)
- `js/app/` — bootstrap, state, events, filters, feature modules (see `docs/UI.md`)
- `sw.js` — service worker app-shell cache at repo root (offline support)
- `docs/` — architecture/parser/ui docs (read these before non-trivial changes)

## Module conventions

- No build step. No `import`/`export`. Scripts are plain `<script src>` tags in `index.html`. Each file is an IIFE that attaches to `window.WahapediaParser`, `window.UI`, `window.App`, or `window.YaabDB`.
- Public namespaces: `WahapediaParser` (`parse` / `addToSharedIndex` / `releaseSharedIndex` / `lastReport`), `UI` (see `docs/UI.md`), `App` (see `docs/UI.md`), `YaabDB` (IndexedDB wrapper), plus globals `Storage`, `Army`, `ArmyManager`, `BSData`.
- **Feature modules register via `App.hooks`** — do NOT edit shared files (`events.js`, `detail.js`, etc.) to add a new feature. Push onto `App.hooks.detailActions`, `App.hooks.armyToolbarActions`, `App.hooks.bootstrap`, `App.hooks.armyChange`, `App.hooks.selectionChange`, `App.hooks.rosterFilters`, or `App.hooks.cardClassContributors` from your new module's IIFE. See `js/app/hooks.js`.
- Script order in `index.html`:
  - `bsdata.js`
  - `parser/*` — `shared-index.js` first (seeds internals), leaf helpers next, `entry.js` → `catalogue.js`, `index.js` LAST (exposes public API)
  - `storage.js` → `army.js`
  - `ui/*` — `index.js` first (defines `UI.init`), feature modules after
  - `app/*` — `state.js` first, `index.js` LAST (it's the DOMContentLoaded handler)
- IIFEs register onto shared globals; none do DOM work at load time. Load-order within a folder is defensive — functions are resolved lazily by name.

## Features beyond the core builder

| Feature | Module | Notes |
|---|---|---|
| Datasheet print (single unit + whole army) | `js/ui/datasheet.js` + `css/datasheet.css` | `UI.printUnitDatasheet` / `UI.printArmyDatasheets`; registers detail-panel + toolbar buttons |
| Undo / redo | `js/app/history.js` | Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z; 50-snapshot cap; toolbar buttons |
| URL-shareable armies | `js/app/url-share.js` | `?a=YAAB1:...` loads on boot; "Share Link" toolbar button |
| Keyboard nav | `js/app/keyboard.js` | `/` focus search, arrows / Enter / `a` for roster |
| Composition validation | `js/app/validation.js` + `css/validation.css` | Advisory warnings (Rule of Three, no warlord) |
| Parse coverage dev report | `js/parser/report.js` | `localStorage.yaab_parse_debug=1` to enable console logs |
| IndexedDB faction cache | `js/db.js` | Persists factions across tabs/reloads; boots instantly on repeat visits |
| Service worker offline | `sw.js` + `js/app/sw-register.js` | Caches app shell; BSData fetches pass through |
| Fuzzy search + role chips | `js/ui/roster.js` | AND-tokenized substring + subsequence match on name |
| Weapon keyword color coding | `js/ui/detail.js` (`weaponKwClass`) | Red/orange/blue/purple for Anti-, Sustained, Assault, etc. |

## Editing guidance for Claude

- Files are small on purpose. Find the right one in the file map first; don't grep the whole repo.
- Don't introduce a bundler, framework, or TypeScript. Keep vanilla JS.
- Don't change the output shape of `WahapediaParser.parse()` — `storage.js`, `app/*`, and `ui/*` all consume it.
- When adding a new feature, prefer a NEW module under `js/app/` or `js/ui/` that registers via `App.hooks`. Avoid editing `js/app/events.js` or `js/ui/detail.js` unless the feature fundamentally can't be expressed via hooks.
- When bumping the parsed-unit shape, also bump the IndexedDB schema version in `js/db.js` and wipe stores in `onupgradeneeded`.
- When adding precached assets, update both the PRECACHE list AND `SHELL` version in `sw.js`.
- "How to add X" recipes live in `docs/UI.md` — read it before implementing a new feature.

## Known caches

| Key pattern | Store | What | When to invalidate |
|---|---|---|---|
| `yaab` DB / `factions` store | IndexedDB | Parsed faction objects (keyed by factionName) | Bump DB version in `js/db.js` + wipe in onupgradeneeded when parsed-unit shape changes |
| `yaab` DB / `gst` store | IndexedDB | Raw XML for `.gst` + `Library *.cat` | Same as above |
| `yaab_bsdata_filelist_10e_v1` | sessionStorage | GitHub tree listing | Bump `v1` → `v2` in `bsdata.js` on repo/tree shape changes |
| `yaab_armies` | localStorage | Saved armies (array of `Army.toJSON()`) | User-facing; don't break compatibility without a migration |
| `yaab-shell-v4` | Cache API | Service worker app shell | Bump `SHELL` in `sw.js` when any precached asset changes |
