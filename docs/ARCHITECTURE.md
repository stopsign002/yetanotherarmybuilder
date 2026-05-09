# Architecture

## Data flow

XML is fetched once per session (cached in IndexedDB across sessions), parsed to plain JSON faction objects, indexed by `App.state`, rendered through `UI.*`, and written back to `localStorage` through the `Army` model.

```
BSData repo
   │  fetchFileList + fetchFile (js/bsdata.js, 6-worker pool)
   ▼
raw XML strings (transient) + .gst / library .cat in IndexedDB `gst` store
   │  WahapediaParser.parse (js/parser/*)
   ▼
faction objects { factionName, units, armyRules, detachments, factionStratagems, ... }
   │  cached into IndexedDB `factions` store
   │  pushed into App.state.factions  (js/app/bsdata-load.js)
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
11. `App.autoLoadFromBSData()` returns immediately and starts the background load. Each faction, as it finishes parsing, is pushed into `state.factions`, triggering `rebuildAllUnits` + `buildChaptersMap` + `updateFactionFilter` + `renderUnitRosterWithContext`. First card appears a few hundred ms after the tree listing resolves.
12. `topbar.js` IIFE runs (loaded after `app/index.js`) and wires the top-bar chip mirror, ⌘K trigger, Action Center button, status row.
13. `sw-register.js` defensively unregisters any leftover service worker. New visits do NOT register a SW (the app-shell SW was retired; `/sw.js` is now a kill-switch that self-unregisters and clears legacy `yaab-shell-v*` caches).

## Memory model

- **XML text strings**: transient during fetch; parsed by `DOMParser` then discarded. Raw `.gst` and `Library *.cat` XML lives in IndexedDB (`gst` store), re-read once per cold load.
- **`WahapediaParser._internal.sharedProfilesById / sharedRulesById / sharedEntriesById`**: `Map`s of DOM element references seeded from `.gst` + library `.cat` files (Phase 1/1.5 of `BSData.loadAllFactions`), consulted during catalogue parsing. Each retained element keeps its entire XML `Document` alive through `ownerDocument`. Released by `WahapediaParser.releaseSharedIndex()` once `loadAllFactions` finishes — frees tens of MB.
- **`App.state.factions`**: full parsed faction objects (plain JSON). Single source of truth.
- **`App.state.allUnits`**: array of REFERENCES into `state.factions[].units` (not spread copies). `_factionName` is stamped in-place. Rebuilt on every faction-loaded event in `App.rebuildAllUnits`. `state.factionsVersion` bumps each rebuild and is used to invalidate `ui/detail.js`'s Led-By cache.
- **Unit grid**: capped-initial-render (120 cards) + scroll-append (80 more per scroll-to-bottom event, rAF-throttled). Keeps DOM under ~200 `.unit-card` nodes. See `INITIAL_PAGE`, `APPEND_PAGE`, `SCROLL_APPEND_PX` in `js/ui/roster.js`.

## Shared caches

| Key | Store | When to invalidate |
|---|---|---|
| `yaab` IDB / `factions` | IndexedDB | Bump `DB_VERSION` in `js/db.js` when parser output shape changes; existing stores get dropped in `onupgradeneeded` |
| `yaab` IDB / `gst` | IndexedDB | Same |
| `yaab_bsdata_filelist_10e_v2` | sessionStorage | Bump suffix on cache-shape changes (current shape: `{ source: 'mirror'\|'github', files: [...] }`) |
| `yaab_armies` | localStorage | User data — never invalidate silently |
| `yaab_factions` | localStorage | Legacy — kept only for back-compat; not on the active read path |
| `yaab-shell-v*` | Cache API | Retired — the kill-switch in `sw.js` deletes any leftover `yaab-shell-*` cache on next visit. Do not add new precached assets here. |

`BSData.clearFactionCache()` wipes legacy session keys + the IndexedDB `factions` and `gst` stores in one call.

## Parser shared index lifecycle

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
| `armyChange` | after every `Army` mutation (add/remove/qty/enhancement/new/load/import/save) | `(army, kind?) => void` | Used by history (snapshot), validation (re-check), analytics (re-render), save-pulse, sound-fx, deployment, opponent matchup, celebrations. |
| `selectionChange` | after faction / chapter / detachment dropdown changes | `(state) => void` | Used by hero-state, scanline, animated-crest, lore button, flavor, nickname, ork-math, activity-log, favorites. |
| `armyToolbarActions` | read once at boot by `App.mountArmyToolbarActions` | n/a (data) | Action shape: `{ id, region?, priority?, category?, label, title?, ariaLabel?, className?, onClick }`. |
| `detailActions` | read by `ui/detail.js` when rendering the unit detail header | n/a (data) | Action shape: `{ id, title, html, label?, onClick(unit) }`. Star (favorites), Print (datasheet), Σ (damage-calc) live here. |
| `rosterFilters` | called per-unit during `UI.renderUnitRoster` filtering | `(unit) => boolean` | Returning `false` hides the unit. Used by legends-toggle, kill-team, favorites (filtered view), collection (status filter). |
| `cardClassContributors` | called per-unit during card render | `(unit) => string \| null` | Adds extra class names to the `.unit-card`. Used by legends-toggle (`.unit-legends`), collection (status badges), role-icons, unit-card-themes (`faction-<slug>`). |
| `modeChange` | after `mode-shell.js` switches the visible top-level container | `(newMode, prevMode) => void` | Modes are `'build'` / `'collect'` / `'play'`. Used by `build-mode`, `collect-mode`, `play-mode` to lazy-build their panels on first activation. |

## Toolbar region routing

`App.mountArmyToolbarActions` (`js/app/index.js`) routes each hook action to a DOM container by `region`:

| Region | DOM target | Default if not in allowlist |
|---|---|---|
| `primary` | `#toolbar-extras` (left-panel toolbar inline row) | Funneled into `#tools-menu` (Tools ▾ dropdown), grouped by `category` |
| `icon` | `#toolbar-icons` (top-bar icon shelf) | Funneled into `#more-menu` (More ▾) |
| `tools-menu` | `#tools-menu` (always there) | n/a |
| `more-menu` | `#more-menu` (always there) | n/a |
| `export-menu` | `#export-extras` (Export ▾ dropdown) | n/a |

Two allowlists in `app/index.js` decide which `primary`/`icon` actions stay inline vs. fall into a dropdown:

- `PRIMARY_VISIBLE_IDS` — currently empty. All hook-registered `primary` actions go into Tools ▾ unless the action sets `priority: 'visible'`.
- `ICON_VISIBLE_IDS` — `yaab-btn-undo`, `yaab-btn-redo`, `yaab-btn-cmdp`. Everything else with `region: 'icon'` falls into More ▾.

Tools menu items are grouped by `category` (`analysis` / `game` / `data` / `export` / `other`) using `DEFAULT_CATEGORY_BY_ID` for actions that don't set one explicitly.

A parallel slide-in **Action Center** (`js/ui/action-center.js`, `UI.actionCenter`) is registered with sections (`game-day`, `analyze`, `export`, `browse`, `collection`, `settings`) and triggered from `#topbar-action-center`. It is an alternative surface to the Tools/More dropdowns — both currently coexist.

## Lazy-loading strategy

Implemented in `js/app/lazy-modules.js` (wired in `index.html` between `app/index.js` and the feature-modules block). When the placeholder fires, the module:

1. Registers placeholder toolbar/detail actions BEFORE `mountArmyToolbarActions` runs at boot, so menus include the buttons.
2. On first click, injects the real `<script>` (in dependency order, `async = false`), waits for `load`, then fires any newly-registered `bootstrap` hooks.
3. Rewires the in-DOM placeholder button to the real action's `onClick`. Splices the placeholder out of the hook array.
4. For modules without a button (e.g. `lore` triggered via `.detail-faction` clicks), uses capture-phase delegated listeners that pre-empt the real handler until the module loads.

Currently every feature module is also eager-loaded from `index.html` and from `sw.js` PRECACHE. Lazy-modules.js is an opt-in path waiting to replace the eager block.

## Script load order rules

- `db.js` → `bsdata.js` first so `YaabDB` and `BSData` are defined before anything that imports them.
- In `js/parser/`: `shared-index.js` first (populates `WahapediaParser._internal` with the Maps and helpers). Leaf helpers (`classify`, `stats`, `weapons`, `abilities`, `wargear`, `costs`, `keywords`) load in any order — they reference each other via `P._internal` at call time. Then `entry.js`, `catalogue.js`, `index.js` LAST (exposes the public surface).
- `storage.js` → `army.js`.
- `ui/index.js` first to define `UI.init`. Feature `ui/*` modules attach methods after.
- `app/state.js` first (defines `App.state`, colors, `VIRTUAL_PARENTS`). `app/hooks.js` next (defines the hook arrays so feature modules can push). `app/index.js` LAST: it is the `DOMContentLoaded` bootstrap.
- `topbar.js` and `sw-register.js` come AFTER `app/index.js` because they don't need to be visible during boot rendering.
- The block between `<!-- FEATURE-MODULES-START -->` and `<!-- FEATURE-MODULES-END -->` in `index.html` is intentionally re-orderable; modules within it only communicate via `App.hooks` and `window.UI`/`window.App` namespaces.

## Things that look weird but are intentional

- **`VIRTUAL_PARENTS` in `app/state.js`** — single-entry list (currently just Adeptus Astartes) that synthesizes a parent faction in the top-level dropdown from chapter-named BSData catalogues. Chapter catalogues live in `state.chapterFactions` and are hidden from the dropdown; choosing the virtual parent reveals a Chapter sub-dropdown.
- **Four cost patterns in `parser/costs.js`** — A: group-level `min`/`max`. B: per-model constraints in a group. C: entry-level constraints. D: per-model constraints at the entry. Different BSData authors use different patterns; tried in order.
- **Crusade regex in `parser/classify.js`** — `CRUSADE_RE` filters Battle Honours / Scars / Traits / Psychic Tradition out of standard 10e output. Removing it surfaces a ton of garbage abilities/wargear.
- **Inline-rule vs `infoLink` rule detection in `parser/catalogue.js` detachment block** — Space Marines embed detachment rules inline under `<rules>`, Necrons use `<infoLinks type="rule" targetId>` into `sharedRules`. Both paths exist; do not collapse them.
- **`chapterFactions` hide-set in the faction dropdown** — chapter catalogues are still loaded and indexed so their units feed the roster under the parent, but they are hidden from the top-level filter `<select>` via `UI.updateFactionFilter`'s `hide` option.
- **Capped-render, not windowed virtualization** — the unit grid uses `auto-fill, minmax(...)` so per-row card count depends on viewport width. Fixed-row-height windowing would break responsive layout. Capped-render trades a small DOM overhead for simplicity.
- **Both Action Center AND Tools/More dropdowns mount the same hook actions** — they coexist intentionally. Each routing strategy reads `App.hooks.armyToolbarActions` independently; future cleanup may collapse to one.
- **`activity-log` writes per-day buckets under one localStorage key**, prunes to 30 days, and degrades to dropping oldest day on quota errors. Don't change the bucket key shape (`YYYY-MM-DD`) without a migration.
- **`history.js` snapshots are debounced 500ms** and capped at 50; the redo stack clears on any non-undo mutation. That's a hard requirement of the `armyChange` hook contract.
- **Parser DB version (`db.js`) and parsed-shape changes are coupled** — bumping `DB_VERSION` drops both `factions` AND `gst` stores in `onupgradeneeded`. No partial migrations.
