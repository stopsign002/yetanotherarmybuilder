# Architecture

## Data flow

XML is fetched once per session, parsed to plain JSON faction objects, indexed by `App.state`, rendered through `UI.*`, and written back to `localStorage` through the `Army` model.

```
BSData repo
   ↓ fetchFileList + fetchFile (js/bsdata.js)
raw XML strings (transient) + .gst / library .cat sessionStorage cache
   ↓ WahapediaParser.parse (js/parser/*)
faction objects { factionName, units, armyRules, detachments, ... }
   ↓ App.state.factions (push per faction loaded, js/app/bsdata-load.js)
   ↓ App.rebuildAllUnits (js/app/filters.js)
App.state.allUnits  (array of REFERENCES — no spread copies)
   ↓ UI.renderUnitRoster / UI.renderUnitDetail (js/ui/*)
user interaction
   ↓ state.currentArmy.addUnit / setEnhancements / updateCount (js/army.js)
   ↓ ArmyManager.saveArmy
localStorage (`yaab_armies`)
```

## Startup sequence

1. `DOMContentLoaded` fires in `js/app/index.js`.
2. `UI.init(state)` (`js/ui/index.js`) stashes the state reference and wires `UI._initTooltip`.
3. `state.armyManager = new ArmyManager()` reads `yaab_armies` from `localStorage` (`js/army.js`).
4. If saved armies exist, the most-recently-updated one becomes `state.currentArmy`; else `armyManager.newArmy()`.
5. `App.applyFactionColor(null)` resets CSS accent vars.
6. `App.renderAll()` renders the (empty) faction filter and empty unit grid + army list.
7. `App.setupResizablePanels()` attaches left/right drag handles.
8. `App.wireEvents()` attaches every listener in `js/app/events.js`.
9. `App.autoLoadFromBSData()` returns immediately and starts the background load. Each faction, as it finishes parsing, is pushed into `state.factions`, triggering `rebuildAllUnits` + `buildChaptersMap` + `updateFactionFilter` + `renderUnitRosterWithContext`. The first faction card appears a few hundred ms after the tree listing resolves.

## Memory model

- **XML text strings**: transient during fetch, parsed by `DOMParser` then discarded. Raw `.gst` and `Library *.cat` XML is cached in `sessionStorage` under `yaab_gst_10e_v3_<name>` and re-parsed on each tab load.
- **`WahapediaParser._internal.sharedProfilesById / sharedRulesById / sharedEntriesById`**: `Map`s of DOM element references seeded from `.gst` + library `.cat` files (Phase 1/1.5 of `BSData.loadAllFactions`), consulted during catalogue parsing. These hold entire XML `Document`s alive via `ownerDocument`. Released explicitly via `WahapediaParser.releaseSharedIndex()` after `loadAllFactions` finishes — this frees tens of MB that used to leak for the tab's lifetime.
- **`App.state.factions`**: full parsed faction objects (plain JSON). Single source of truth for unit data.
- **`App.state.allUnits`**: array of REFERENCES to the same unit objects (not spread copies). `_factionName` is stamped directly on each unit in-place. Rebuilt on every faction-loaded event in `App.rebuildAllUnits`. `state.factionsVersion` is bumped each rebuild and is used to invalidate the Led-By cache in `ui/detail.js`.
- **Unit grid**: capped-initial-render (120 cards) + scroll-append (80 more per scroll-to-bottom event, rAF-throttled). Keeps DOM under ~200 `.unit-card` nodes even with thousands of filtered units. See `js/ui/roster.js` for `INITIAL_PAGE`, `APPEND_PAGE`, `SCROLL_APPEND_PX`.

## Shared caches

| Key | Store | When to invalidate |
|---|---|---|
| `yaab_bsf_10e_v7_<faction>` | sessionStorage | Bump prefix in `bsdata.js` when parsed-unit shape changes (any addition to `entry.js` output, wargear, costs, abilities) |
| `yaab_gst_10e_v3_<name>` | sessionStorage | Bump when you want to force re-download of `.gst` / library `.cat` XML |
| `yaab_bsdata_filelist_10e_v1` | sessionStorage | Bump on GitHub tree-format shifts |
| `yaab_armies` | localStorage | User data — never invalidate silently |
| `yaab_factions` | localStorage | Unused by active path; kept for backward compat |

`BSData.clearFactionCache()` nukes all three session keys in one call.

## Parser shared index lifecycle

```
Phase 1   — .gst files         → addToSharedIndex  (Maps fill)
Phase 1.5 — Library *.cat      → addToSharedIndex  (Maps fill more)
Phase 2   — faction catalogues → parse()           (buildIndexes copies refs per catalogue; output is plain JSON)
Done      — releaseSharedIndex()                   (Maps cleared; XML Documents become GC-eligible)
```

`buildIndexes(root)` in `parser/catalogue.js` seeds its per-catalogue maps from the shared index via `new Map(I.sharedEntriesById)` etc., then overlays any in-catalogue `sharedSelectionEntries` / `sharedProfiles` / `sharedRules` / `rules`. Parsing produces plain objects that carry no DOM refs, so releasing the shared Maps is safe once every catalogue has been parsed.

## Virtualization approach

The unit grid uses capped-render + scroll-append, not windowed virtualization.

- `renderUnitRoster` filters, then `appendBatch` renders the first `INITIAL_PAGE` cards (120) into a `DocumentFragment`.
- On scroll within the center panel's overflow container, an rAF-throttled handler appends `APPEND_PAGE` (80) more when we're within `SCROLL_APPEND_PX` (400) of the bottom.
- State is held in a module-local `R` object (`filtered`, `rendered`, `selectedId`, `scrollContainer`, `scrollHandler`), not on the DOM.

True windowed virtualization was rejected because the grid uses CSS `grid-template-columns: repeat(auto-fill, minmax(...))`, so per-row card count depends on viewport width. A fixed row-height / fixed-per-row assumption breaks. Capped-render trades a small DOM overhead for simplicity and responsive layout.

## Script load order rules

- `bsdata.js` first so `window.BSData` is defined before anyone imports it.
- In `js/parser/`: `shared-index.js` first (populates `WahapediaParser._internal` with the Maps and their helpers). Leaf helpers (`classify`, `stats`, `weapons`, `abilities`, `wargear`, `costs`, `keywords`) can load in any order because they only reference other helpers via `P._internal` at call time. `entry.js` then `catalogue.js` (catalogue calls `entry`). `index.js` LAST: it exposes the public surface (`P.parse`, `P.addToSharedIndex`, `P.releaseSharedIndex`) by reading from the now-populated `P._internal`.
- `ui/index.js` first to define `UI.init`. Feature modules then attach methods onto `UI`.
- `app/state.js` first (defines `App.state`, colors, `VIRTUAL_PARENTS`). `app/index.js` LAST: it is the `DOMContentLoaded` bootstrap and assumes every other `App.*` function is already attached.

## Things that look weird but are intentional

- **`VIRTUAL_PARENTS` in `app/state.js`** — a single-entry list (currently just Adeptus Astartes) that synthesizes a parent faction in the top-level dropdown from chapter-named BSData catalogues. Chapter catalogues live in `state.chapterFactions` and are hidden from the dropdown; choosing the virtual parent reveals a Chapter/Supplement sub-dropdown. Add supplements here, nowhere else.
- **Four cost patterns in `parser/costs.js`** — Pattern A: group-level `min`/`max` constraints. Pattern B: per-model constraints inside a group. Pattern C: entry-level constraints. Pattern D: per-model constraints at the entry. Different BSData authors use different patterns; the parser tries them in order.
- **Crusade regex in `parser/classify.js`** — `CRUSADE_RE` filters Crusade content (Battle Honours / Scars / Traits / Psychic Tradition) out of standard 10e output. Removing it surfaces a ton of garbage abilities/wargear.
- **Inline-rule vs `infoLink` rule detection in `parser/catalogue.js` detachment block** — Space Marines embed detachment rules inline under `<rules>`, Necrons use `<infoLinks type="rule" targetId>` into `sharedRules`. Both paths exist for a reason; do not collapse them.
- **`chapterFactions` hide-set in the faction dropdown** — chapter catalogues are still loaded and indexed so their units feed the roster under the parent, but they are removed from the top-level filter `<select>` via `UI.updateFactionFilter`'s `hide` option; otherwise the user sees both "Imperium - Adeptus Astartes" (virtual) AND every individual chapter name at the top level.
