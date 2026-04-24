# UI + App

## UI modules (`js/ui/`)

Each attaches methods onto `window.UI`.

| File | Attaches | Role |
|---|---|---|
| `index.js` | `UI.init(state)`, `UI._state` | Stash state reference, call `UI._initTooltip`. Loads first so `UI` namespace exists. |
| `helpers.js` | `UI.escapeHtml`, `UI._STAT_ALIASES`, `UI._CARD_STAT_PREF` | HTML escape, stat key aliases (`SV`/`Sv`/`sv`), card-stat display order. |
| `tooltip.js` | `UI._initTooltip` | Document-level `mouseover` delegation for `[data-tooltip]`. Positions `#global-tooltip`. |
| `toast.js` | `UI.toast(msg, type, duration)` | Appends to `#toast-container`, fades out. |
| `progress.js` | `UI.setLoadProgress(done, total)` | Top-of-page slim bar + "Loading factions N / M" badge. Auto-hides 10s after completion. |
| `faction-filter.js` | `UI.updateFactionFilter(factions, { hide, extras })` | Rewrites `#army-faction-select`, hiding `chapterFactions` and adding virtual parents. |
| `faction-rules.js` | `UI.updateFactionRules(faction, detachment?)` | Renders Army Rules + Detachment Rule + Enhancements in the left panel. |
| `roster.js` | `UI.renderUnitRoster`, `UI.createUnitCard`, `UI.renderStatCell` | Center-panel unit grid. Capped render + scroll-append. |
| `detail.js` | `UI.renderUnitDetail`, `UI.renderRuleDetail`, `UI.clearUnitDetail` | Right-panel. Holds the Led-By reverse-index cache (invalidated by `state.factionsVersion`). |
| `army-list.js` | `UI.renderArmyList`, `UI.createArmyEntryEl` | Left-panel army entry list + points bar. |
| `modals.js` | `UI.showLoadModal` / `hide*`, `UI.showImportModal` / `hide*`, `UI.showExportModal` / `hide*` | Modal toggle pairs. |

## App modules (`js/app/`)

Each attaches methods onto `window.App`.

| File | Attaches | Role |
|---|---|---|
| `state.js` | `App.state`, `App.VIRTUAL_PARENTS`, `App.FACTION_COLORS`, `App.DEFAULT_ACCENT`, `App.applyFactionColor` | Central state object + faction color palette + theme-swap. |
| `filters.js` | `App.rebuildAllUnits`, `App.buildChaptersMap`, `App.getVirtualParentOf`, `App.getEffectiveFilter`, `App.findUnit`, `App.getCurrentFaction`, `App.getDetachmentFaction` | Faction/chapter resolution and unit-reference array rebuild. |
| `render.js` | `App.renderAll`, `App.renderUnitRosterWithContext` | Top-level pipelines that combine filter + UI calls. |
| `bsdata-load.js` | `App.autoLoadFromBSData` | Kicks off `BSData.loadAllFactions`; per-faction push + re-render. |
| `resize.js` | `App.setupResizablePanels` | Mousedown-drag handles on `#resize-left` / `#resize-right`, clamps widths, writes CSS vars. |
| `selections.js` | `App.updateChapterDropdown`, `App.updateDetachmentOptions`, `App.applyImportedSelections` | Dependent-dropdown wiring; dispatches synthetic `change` events on import. |
| `events.js` | `App.wireEvents` | Every DOM event listener (faction select, chapter select, detachment select, search input, unit grid click, rules section click, detail panel change/click, army-name/points-limit input, army entry list change/click, New/Save/Load/Export/Copy/CSV buttons, modal buttons, Escape). |
| `index.js` | `DOMContentLoaded` handler (no exports) | Loads LAST. Boots the app. |

## State shape (`App.state`)

```
{
  factions:               Faction[],              // parsed faction objects, pushed per load
  allUnits:               Unit[],                 // REFERENCES into factions[].units
  factionsVersion:        number,                 // bumped every rebuildAllUnits — invalidates UI caches
  currentArmy:            Army | null,
  armyManager:            ArmyManager | null,
  selectedUnit:           Unit | null,            // highlighted unit in the roster
  factionFilter:          string,                 // 'all' or a faction/virtual-parent name
  selectedChapter:        string | null,          // a chapter faction name when the sub-dropdown is in use
  chaptersMap:            { [virtualParent]: string[] },
  chapterFactions:        Set<string>,            // faction names to hide from the top-level dropdown
  virtualBase:            { [virtualParent]: string }, // base chapter used as default for the virtual parent
  selectedDetachment:     Detachment | null,
  detachmentFaction:      Faction | null,         // the faction whose detachments apply (may be the base chapter)
  selectedArmyEntryIndex: number | null,          // currently-focused army list row, for enhancement checkboxes
}
```

`factionsVersion` is a cache-invalidation counter. `ui/detail.js` uses it to rebuild the Led-By reverse-index only when a new faction has been added to `state.factions`.

## Event flow

All listeners are attached once in `app/events.js::wireEvents()` after `DOMContentLoaded`. Where possible they use event delegation on stable container elements:

- `#unit-grid` (delegated to `.unit-card` click)
- `#army-entry-list` (delegated to `.army-qty-input` change and `.army-entry` / `.army-entry-remove` clicks)
- `#unit-detail-panel` (delegated to `.enhancement-cb` change and `#btn-detail-add` click)
- `#army-rules-section` (delegated to `.army-rule-item` click for rule detail)
- `#saved-army-list` (delegated to `.btn-load-saved` / `.btn-delete-saved` click)

Non-delegated listeners are on inputs, the top-level dropdowns, and toolbar buttons by id. Modals have matching open/close/backdrop handlers plus a shared `document.keydown` Escape handler that calls all three `hide*Modal` functions.

## How to add X

### Add a new faction color
Edit `App.FACTION_COLORS` in `js/app/state.js`. Key is either the full faction name or the last segment after `" - "` (Space Marines chapters use short keys). Value is `[accent, hover, dark, rgb-triplet-string]`. Luminance-based auto-contrast for `--accent-on` is handled in `applyFactionColor`.

### Add a new field to the unit detail panel
Edit `UI.renderUnitDetail` in `js/ui/detail.js`. If the field is parser-derived, add it to the returned object in `js/parser/entry.js` (see `docs/PARSER.md` for the shape contract) and bump `FACTION_CACHE_PREFIX` in `js/bsdata.js` so stale sessionStorage is busted.

### Add a new button to the army toolbar
Add `<button>` markup to `index.html` under `.panel-footer.army-toolbar`. Wire the click listener in `js/app/events.js`. If it touches import/export, the serialization belongs in `js/storage.js` alongside `exportArmyToString` / `exportArmyToText` / `exportArmyToCSV`.

### Add a new modal
Add `.modal-backdrop > .modal` markup under the `<!-- MODALS -->` section in `index.html` with a unique id. Add a show/hide pair to `js/ui/modals.js` (follow the pattern: `removeAttribute('hidden')` / `setAttribute('hidden','')`). Wire the open button + close button + backdrop-click in `js/app/events.js`. Escape is already wired — include a `UI.hide<Foo>Modal()` call in the existing keydown handler.

### Add a new virtual-parent faction grouping
Edit `App.VIRTUAL_PARENTS` in `js/app/state.js`. Shape: `{ name, baseChapter }`. No other changes needed — `buildChaptersMap` auto-populates `chaptersMap` / `chapterFactions` / `virtualBase` for any loaded catalogues whose name starts with `name + ' - '`.

### Bump unit-grid page size
Edit `INITIAL_PAGE` and/or `APPEND_PAGE` in `js/ui/roster.js`. Keep the combined DOM size sane; the grid is not windowed.

### Bump the faction cache after changing parser output shape
Increment `FACTION_CACHE_PREFIX` in `js/bsdata.js` (`yaab_bsf_10e_v7_` → `v8_`). Skipping this leaves users reading stale cached JSON that does not have the new field, and the mismatch will silently misrender.

## Testing manually

1. `python3 -m http.server 8000` from the repo root.
2. Open `http://localhost:8000/`. Do not use `file://`.
3. Wait for the top progress bar to reach 100% (~30 seconds; faster on second tab-load because of `sessionStorage` caches).
4. Pick a faction from the dropdown. Accent color should switch. Chapter sub-dropdown should appear for Imperium - Adeptus Astartes.
5. Pick a detachment. Detachment Rule and Enhancements sections should appear under Army Rules.
6. Click a unit card. Right panel should show stats, ranged/melee weapon tables with Keywords tooltips, Core Abilities, Leader (if applicable), Led By (if applicable), Abilities, Wargear Options, Keywords, Enhancements checkboxes.
7. Set a quantity + squad option, click Add to Army. Toast confirms.
8. Check an enhancement checkbox for the newly added entry. Points should update in the left panel.
9. Save. Re-open Load modal — army is listed with correct points.
10. Export → copy the `YAAB1:` code. New, then Import — paste the code. Verify name, points, units, enhancements, and faction/chapter/detachment dropdowns all restore.
