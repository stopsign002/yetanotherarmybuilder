# Architecture

## Data flow

The 40kdc 11e dataset is embedded in a committed browser bundle (`js/vendor/dc-bundle.js` → `window.DC`); `js/data/dc-adapter.js` builds faction objects from it on every load (no faction cache), indexes them by `App.state`, renders through `UI.*`, and writes user armies back to `localStorage` through the `Army` model.

```
js/vendor/dc-bundle.js  (window.DC — embedded 40kdc 11e data, generated offline)
   │  BSData.loadAllFactions  (OVERRIDDEN by js/data/dc-adapter.js)
   │    builds faction objects from window.DC, parsePoints → squadOptions/ordinal
   ▼
faction objects { factionName, units, armyRules, detachments, ... }  (parser output shape)
   │  GDC overlay (js/gdc.js) + reconcileStrats() → detachment.gdcStratagems
   │  fires per-faction callback → pushed into App.state.factions  (js/app/bsdata-load.js)
   ▼
App.rebuildAllUnits  (js/app/filters.js, bumps state.factionsVersion)
   │
   ▼
App.state.allUnits  (array of REFERENCES — no spread copies)
   │  UI.renderUnitRoster / UI.renderUnitDetail (js/ui/*)
   ▼
user interaction
   │  state.currentArmy.addUnit / setEnhancements / updateCount (js/army.js)
   │  ArmyManager.saveArmy
   ▼
localStorage `yaab_armies`
```

## Startup sequence

1. `DOMContentLoaded` fires in `js/app/index.js`.
2. `UI.init(state)` (`js/ui/index.js`) stashes the state reference and wires the global tooltip.
3. `state.armyManager = new ArmyManager()` reads `yaab_armies` from `localStorage`.
4. If saved armies exist, the most-recently-updated becomes `state.currentArmy`; otherwise `armyManager.newArmy()`.
5. `App.applyFactionColor(null)` resets CSS accent vars.
6. `App.renderAll()` renders the (empty) faction filter, empty unit grid, empty army list.
7. `App.setupResizablePanels()` attaches drag handles for the left/right panels.
8. `App.wireEvents()` attaches every direct/delegated listener in `js/app/events.js`.
9. `App.mountArmyToolbarActions()` renders all hook-registered toolbar/icon-shelf/menu buttons. Reads `App.hooks.armyToolbarActions` and routes by `region`/`category`.
10. `App.fireBootstrap(state)` runs every `App.hooks.bootstrap[]` entry.
11. `App.autoLoadFromBSData()` returns immediately and starts the background load via `BSData.loadAllFactions` (overridden by `dc-adapter.js`). The adapter builds each faction from `window.DC`, runs the GDC overlay + `reconcileStrats()`, then fires the same per-faction callback — so each faction, as it's built, is pushed into `state.factions`, triggering `rebuildAllUnits` + `buildChaptersMap` + `updateFactionFilter` + `renderUnitRosterWithContext`. No XML fetch or DOM parsing happens; the only live network call is the GDC fallback text.
12. `topbar.js` IIFE runs (loaded after `app/index.js`) and wires the top-bar brand (click returns to Build), the ⌘K search button, the Settings gear and the Help (?) button.
13. `sw-register.js` registers `/sw.js` after `window.load`, with `updateViaCache: 'none'` so the worker script is never served from the HTTP cache. Registration is fire-and-forget — without a worker the app behaves exactly as before, just with more round trips and no install prompt. (From 2026-04-27 to 2026-08-16 this file did the opposite and unregistered everything; see the "Service worker" section of `CLAUDE.md`.)

## Memory model

- **`window.DC`**: the embedded 40kdc dataset (plain JS objects in `js/vendor/dc-bundle.js`). `dc-adapter.js` reads it directly to build faction objects each load — no XML, no `DOMParser`, no IndexedDB faction cache. (The dormant XML parser's shared-index / `releaseSharedIndex` memory machinery — DOM `Map`s held alive via `ownerDocument` — no longer runs; see the dormant note in `docs/PARSER.md`.)
- **`App.state.factions`**: full faction objects (plain JSON, parser output shape). Single source of truth.
- **`App.state.allUnits`**: array of REFERENCES into `state.factions[].units` (not spread copies). `_factionName` is stamped in-place. Rebuilt on every faction-loaded event in `App.rebuildAllUnits`. `state.factionsVersion` bumps each rebuild and is used to invalidate `ui/detail.js`'s Led-By cache.
- **Unit grid**: capped-initial-render (120 cards) + scroll-append (80 more per scroll-to-bottom event, rAF-throttled). Keeps DOM under ~200 `.unit-card` nodes. See `INITIAL_PAGE`, `APPEND_PAGE`, `SCROLL_APPEND_PX` in `js/ui/roster.js`.

## Shared caches

| Key | Store | When to invalidate |
|---|---|---|
| `yaab` IDB / `factions` | IndexedDB | **No longer written by the active path** — `dc-adapter.js` rebuilds factions from `window.DC` each load. `DB_VERSION` is `37` (the 11e cutover bumped it once to drop the stale 10e cache). |
| `yaab` IDB / `gst` | IndexedDB | (Dormant) only the old `bsdata.js` wrote this. Dropped on a `DB_VERSION` bump. |
| `yaab_bsdata_filelist_10e_v2` | sessionStorage | **Unused** — dormant BattleScribe file listing. |
| `yaab_armies` | localStorage | User data — never invalidate silently |
| `yaab_factions` | localStorage | Legacy — kept only for back-compat; not on the active read path |
| `yaab-shell-<token>` | Cache API | The app shell, ~160 entries / ~14 MB, written by `sw.js`. The name carries the deployed `?v=` token and `activate()` deletes every other key, so exactly one generation exists at a time. **Excludes `/api/` and `/data/` entirely.** Do not add entries to `SHELL` — assets are cached on first use by stale-while-revalidate. |

`BSData.clearFactionCache()` wipes legacy session keys + the IndexedDB `factions` and `gst` stores in one call.

## Parser shared index lifecycle (DORMANT)

> This describes the dormant `js/parser/` path, kept for rollback. The live load seam is `dc-adapter.js`'s `loadAllFactions` building factions from `window.DC` — no phased XML parse runs.

```
Phase 1   — .gst files           → addToSharedIndex   (Maps fill)
Phase 1.5 — Library *.cat        → addToSharedIndex   (Maps fill more)
Phase 2   — faction catalogues   → parse()            (buildIndexes copies refs per catalogue; output is plain JSON)
Done      — releaseSharedIndex()                       (Maps cleared; XML Documents become GC-eligible)
```

`buildIndexes(root)` in `parser/catalogue.js` seeds its per-catalogue maps from the shared index (`new Map(I.sharedEntriesById)` etc.), then overlays any in-catalogue `sharedSelectionEntries` / `sharedProfiles` / `sharedRules` / `rules`. Parsed output is plain objects; releasing the shared Maps is safe once every catalogue has parsed.

## Hook system (`App.hooks.*`)

Defined in `js/app/hooks.js`. Every hook is an array of callbacks; failure in one is logged and swallowed so other modules keep firing.

| Hook | Fired | Callback signature | Notes |
|---|---|---|---|
| `bootstrap` | once after `wireEvents` + `mountArmyToolbarActions` | `(state) => void` | Late init: open modal handles, register lazy DOM elements, prefetch JSON, etc. |
| `armyChange` | `App.fireArmyChange(kind, army?)`. **Only four kinds are ever fired:** `'render'` (top of `UI.renderArmyList`, so it fires on every army-list re-render, which every mutation triggers), `'save'` and `'delete'` (`army.js`), `'rename'` (`events.js`). There is no `'add'`/`'remove'`/`'load'`/`'import'` kind: a consumer that needs to know *what* changed must diff the army itself (as `favorites.js` does). | `(army, kind) => void` | Used by history (snapshot), validation (re-check), autosave, save-pulse, celebrations, rehydrate/entry-rehydrate, hero-state, flavor, nickname, kotc, faction-fx, scanline, animated-crest, mobile-shell, pwa-install (badges), reserves, collection, favorites, and the mode pages (build/collect/cards/play). |
| `selectionChange` | after faction / chapter / detachment selection changes | `(state) => void` | Used by hero-state, scanline, animated-crest, flavor, nickname, kotc, faction-fx, faction-glyphs, mobile-shell, rehydrate, favorites, collection, reserves, requisitions, custom-names, and the mode pages. |
| `armyToolbarActions` | read at boot by `App.mountArmyToolbarActions` (and again by the Settings drawer's `clickToolbarBtn` fallback) | n/a (data) | Action shape: `{ id, region?, section?, label, title?, ariaLabel?, className?, onClick }`. Only the regions listed under "Toolbar region routing" render anywhere. |
| `detailActions` | read by `ui/detail.js` when rendering the unit detail header | n/a (data) | Action shape: `{ id, title, html, label?, onClick(unit) }`. Only the Star (favorites) button lives here today. |
| `rosterFilters` | called per-unit during `UI.renderUnitRoster` filtering | `(unit) => boolean` | Returning `false` hides the unit. Used by legends-toggle, allies, sm-chapter-filter, points-filter, favorites (filtered view), collection (status filter), reserves and requisitions (the Units-pane view). |
| `cardClassContributors` | called per-unit during card render | `(unit) => string \| null` | Adds extra class names to the `.unit-card`. Used by legends-toggle (`.unit-legends`), allies, collection (status badges), custom-names, role-icons, unit-card-themes (`faction-<slug>`). |
| `armyEntryActions` | read by `ui/army-list.js` for every army-entry card it renders | n/a (data) | Action shape: `{ id, className?, title, ariaLabel(entry)?, svg, visible(entry, index, army)?, onClick(entry, index, army, ev) }`. Icon buttons on an army-list row, left of the remove ×. The dispatcher resolves the entry by `entryId`, **not** by array index, so an action may splice `army.entries` safely. Used by `split-entry`. |
| `modeChange` | after `mode-shell.js` switches the visible top-level container (its local `fireHooks(mode)`; there is no `App.fireModeChange`). Also dispatches a `yaab:mode-change` DOM event with `detail.mode`. The array is created by `mode-shell.js`, not `hooks.js`, so modules push with `if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = []` first | `(mode) => void` — **one argument, the new mode; there is no previous-mode argument** | Modes are `'build'` / `'collect'` / `'cards'` / `'play'` / `'waha'`. Used by `build-mode`, `collect-mode`, `cards-mode`, `play-mode`, `waha-mode` (activate on entry), plus collection/reserves/requisitions/pwa-install. |
| `paletteCommands` | read by `command-palette.js` each time Cmd/Ctrl+K opens | n/a (data, or `() => command[]`) | Command shape: `{ id, label, hint?, run() }`. Push an object, or a function for state-dependent items. `id` dedupes (first wins). Commands join the Actions group. Used by `mode-shell` (mode switches), `waha-mode`, `play-mode`. |

## Toolbar region routing

`App.mountArmyToolbarActions` (`js/app/index.js`) routes each `armyToolbarActions` entry by `region`. The old Tools ▾ / More ▾ dropdowns and the slide-in "Action Center" were removed; only three surfaces render now:

| Region | DOM target | Rule |
|---|---|---|
| `icon` | `#toolbar-undo-redo` (bottom toolbar) | only ids in `BOTTOM_INLINE_ICON_IDS` (`yaab-btn-undo`, `yaab-btn-redo`) |
| `icon` | `#topbar-icons` (top-bar shelf) | only ids in `TOPBAR_SHELF_IDS`: `yaab-btn-auth`, `yaab-btn-bug-report`, `yaab-btn-changelog`, `btn-play-mode`, `btn-waha-mode` |
| `export-menu` | `#export-extras` (inside the bottom-toolbar Export ▾ menu) | every entry mounts |
| `primary`, `tools-menu`, `more-menu`, and any other `icon` id | nowhere | the action is registered but renders no button |

Actions that render nowhere are still reachable: the Settings drawer's `clickToolbarBtn` falls back to calling the registered hook's `onClick` directly, and the Cmd/Ctrl+K palette (`paletteCommands`) lists the modes and a few actions. `#tools-menu`, `#more-menu`, `#toolbar-extras` and `#toolbar-icons` still exist in `index.html` inside a hidden `.toolbar-compat-shelf`, empty, so a stray `getElementById` does not crash.

## Mode pages

`js/app/mode-shell.js` owns the five top-level modes (`build`, `collect`, `cards`, `play`, `waha`), the `body[data-mode]` attribute, and persistence in `yaab_mode` (only `build`/`collect`/`waha` are restored on launch). Each non-Build mode is a `<section id="<mode>-mode">` built lazily on first activation by its `js/ui/*-mode.js` module (`build-mode`, `collect-mode`, `cards-mode`, `play-mode`, `waha-mode`); see `docs/UI.md` for the module rows. `App.prefersReducedMotion()` (OS media query OR the in-app `body.reduce-motion` toggle) lives in `mode-shell.js` for every JS animation to share.

## Lazy-loading strategy

There is none. `js/app/lazy-modules.js` (a placeholder-loader idea) was never wired in and no longer exists; every feature module is a `<script defer>` in `index.html`, between `<!-- FEATURE-MODULES-START -->` and `<!-- FEATURE-MODULES-END -->`. The service worker needs no per-module registration: it is stale-while-revalidate, so any URL the page requests is cached on first use. The one genuinely deferred thing is the mode pages' DOM, built on first activation (see "Mode pages").

## Script load order rules

- `db.js` → `bsdata.js` first so `YaabDB` and `BSData` are defined before anything that imports them. Then `js/vendor/dc-bundle.js` (defines `window.DC`) → `js/data/dc-adapter.js`, which OVERRIDES `window.BSData.loadAllFactions` with the live 40kdc path. `gdc.js` must be loaded before the adapter's GDC overlay runs.
- In `js/parser/`: `shared-index.js` first (populates `WahapediaParser._internal` with the Maps and helpers). Leaf helpers (`classify`, `stats`, `weapons`, `abilities`, `wargear`, `costs`, `keywords`) load in any order — they reference each other via `P._internal` at call time. Then `entry.js`, `catalogue.js`, `index.js` LAST (exposes the public surface).
- `storage.js` → `army.js`.
- `ui/index.js` first to define `UI.init`. Feature `ui/*` modules attach methods after.
- `app/state.js` first (defines `App.state`, colors, `VIRTUAL_PARENTS`). `app/hooks.js` next (defines the hook arrays so feature modules can push). `app/index.js` LAST: it is the `DOMContentLoaded` bootstrap.
- `js/theme-boot.js` is the only non-`defer` script and sits last in `<head>`; `js/app/id-migration.js` is the first deferred script (it must rewrite stale ids before anything reads them).
- `topbar.js`, `mode-shell.js`, `settings-drawer.js`, `mobile-history.js` and `sw-register.js` come AFTER `app/index.js` because they don't need to be visible during boot rendering (and `mode-shell` creates `App.hooks.modeChange`, so modules that load earlier create the array defensively).
- The block between `<!-- FEATURE-MODULES-START -->` and `<!-- FEATURE-MODULES-END -->` in `index.html` is intentionally re-orderable; modules within it only communicate via `App.hooks` and `window.UI`/`window.App` namespaces.

## Things that look weird but are intentional

- **`VIRTUAL_PARENTS` in `app/state.js`** — single-entry list (currently just Adeptus Astartes) that synthesizes a parent faction in the top-level dropdown from chapter-named BSData catalogues. Chapter catalogues live in `state.chapterFactions` and are hidden from the dropdown; choosing the virtual parent reveals a Chapter sub-dropdown.
- **Four cost patterns in `parser/costs.js`** — A: group-level `min`/`max`. B: per-model constraints in a group. C: entry-level constraints. D: per-model constraints at the entry. Different BSData authors use different patterns; tried in order.
- **Crusade regex in `parser/classify.js`** — `CRUSADE_RE` filters Battle Honours / Scars / Traits / Psychic Tradition out of standard 10e output. Removing it surfaces a ton of garbage abilities/wargear.
- **Inline-rule vs `infoLink` rule detection in `parser/catalogue.js` detachment block** — Space Marines embed detachment rules inline under `<rules>`, Necrons use `<infoLinks type="rule" targetId>` into `sharedRules`. Both paths exist; do not collapse them.
- **`chapterFactions` hide-set in the faction dropdown** — chapter catalogues are still loaded and indexed so their units feed the roster under the parent, but they are hidden from the top-level filter `<select>` via `UI.updateFactionFilter`'s `hide` option.
- **Capped-render, not windowed virtualization** — the unit grid uses `auto-fill, minmax(...)` so per-row card count depends on viewport width. Fixed-row-height windowing would break responsive layout. Capped-render trades a small DOM overhead for simplicity.
- **Hook actions that render nowhere** — most `armyToolbarActions` entries (`primary`, `tools-menu`, `more-menu`, un-shelved `icon` ids) have no DOM surface since the Tools/More dropdowns and the Action Center went away. That is why the Settings drawer and the palette call hook `onClick`s directly. Do not "fix" it by re-adding a dropdown without a design decision.
- **`history.js` snapshots are debounced 500ms** and capped at 50; the redo stack clears on any non-undo mutation. That's a hard requirement of the `armyChange` hook contract.
- **Parser DB version (`db.js`) and parsed-shape changes are coupled** — bumping `DB_VERSION` drops both `factions` AND `gst` stores in `onupgradeneeded`. No partial migrations.
