# UI + App

## UI modules (`js/ui/`)

Each attaches methods onto `window.UI`.

| File | Role |
|---|---|
| `index.js` | Defines `UI.init(state)`. Stashes state ref, calls `UI._initTooltip`. Loads first. |
| `helpers.js` | `UI.escapeHtml`, `UI._STAT_ALIASES`, `UI._CARD_STAT_PREF`. |
| `tooltip.js` | Document-level `[data-tooltip]` delegation. Positions `#global-tooltip`. |
| `toast.js` | `UI.toast(msg, type, duration)`. |
| `progress.js` | `UI.setLoadProgress(done, total)` — top-of-page slim bar + "Loading factions N / M" badge. |
| `modals.js` | `UI.show*Modal` / `UI.hide*Modal` for Load / Import / Export. |
| `faction-filter.js` | `UI.updateFactionFilter(factions, { hide, extras })`. Hides `chapterFactions`, adds virtual parents. |
| `faction-rules.js` | `UI.updateFactionRules(faction, detachment?)`. Renders Army Rules + Detachment + Enhancements. |
| `roster.js` | `UI.renderUnitRoster`, `UI.createUnitCard`, `UI.renderStatCell`. Capped render + scroll-append. |
| `detail.js` | `UI.renderUnitDetail`, `UI.renderRuleDetail`, `UI.clearUnitDetail`. Owns the Led-By cache (invalidated by `state.factionsVersion`). |
| `army-list.js` | `UI.renderArmyList`, `UI.createArmyEntryEl`. Left-panel entries + points bar. |
| `datasheet.js` | `UI.renderDatasheet`, `UI.renderArmyDatasheets`, `UI.printUnitDatasheet`, `UI.printArmyDatasheets`, `UI.printCurrentArmy`. Registers a detail-action button. |
| `dropdown.js` | `UI.initDropdowns()` — click-to-toggle + keyboard for Tools/More/Export menus. |
| `action-center.js` | `UI.actionCenter` — slide-in sheet with 6 sections (Game Day / Analyze / Print & Export / Browse / Collection / Settings). |
| `analytics.js` | `UI.openAnalytics` / `UI.closeAnalytics` / `UI.toggleAnalytics` — dashboard modal, live via `armyChange`. |
| `damage-calc.js` | `UI.openDamageCalc` — 10e attack simulator. Detail-action `Σ` button + toolbar. |
| `matchup.js` | `UI.openOpponentPaste`, `UI.openMatchup` — opponent paste + side-by-side. |
| `deployment-planner.js` | `UI.deploymentPlanner.open/close` — drag-drop battlefield, per-army. |
| `synergy.js` | Detects leader attachments + keyword combos in current army. Toolbar-icon button. |
| `tournament-export.js` | "Tournament Prep" multi-page PDF bundle. |
| `dice-roller.js` | Click any stat cell to roll d6, shown as a floating badge. |
| `celebrations.js` | Confetti, rolling-points tween, landing pulse, shimmer. `armyChange` hook. |
| `save-pulse.js` | Pulses Save while the current army has unsaved mutations. |
| `scanline.js` | Tactical-display sweep on faction switch + body classes for active-panel accent stripes. |
| `animated-crest.js` | Rotating hex crest in the empty unit-detail panel when a faction is selected. |
| `cold-start.js` | First-visit splash overlay + cold/warm-start detection during BSData load. **Orphan: not in index.html.** |
| `list-coach.js` | Heuristic list-coach modal (composition / threats / synergy). **Orphan: not in index.html.** |
| `auth-button.js` | Top-bar Sign-in / username button + dropdown menu. See `docs/AUTH.md`. |
| `auth-modal.js` | `UI.showAuthModal(mode)` for login/register/recover/change-password. See `docs/AUTH.md`. |
| `build-mode.js` | Orchestrator for the BUILD mode page: hero header, rules pinboard tab, roster polish. Mounted by `mode-shell.js`. |
| `collect-mode.js` | Orchestrator for the COLLECT mode page (Painting / Crusade / Kill Team sub-tabs). Mounted by `mode-shell.js`. |
| `play-mode.js` | Game-day cockpit: 5 sub-tabs (match / stratagems / calc / opponent / deploy) + quick stratagems drawer. Mounted by `mode-shell.js`. Persists active sub-tab in `yaab_play_tab`. |
| `topbar-export.js` | Export button + dropdown in the topbar (next to the account button). Each item programmatically clicks the original (now-hidden) panel-footer Export button so existing event wiring keeps firing. |
| `faction-glyphs.js` | Inline-SVG geometric faction glyphs (24×24 viewBox, `currentColor`) + DOM injection helpers. Original abstract geometry — no GW iconography. |
| `role-icons.js` | Small role icon prefix on unit cards (Character / Psyker / Vehicle / Monster / Battleline / Infantry). Registered as `cardClassContributor`; also exposes `App.classifyUnitRole(unit)`. |
| `unit-card-themes.js` | `cardClassContributor` that adds a `faction-<slug>` class to each unit card so `unit-card-themes.css` can paint per-faction gradients. Slug is the last segment of `_factionName` after `" - "`. |
| `flip-animations.js` | FLIP-style add-to-army flight ghost + drag-to-reorder + micro-interactions on the unit roster. Reduced-motion aware. Single-flight gate so concurrent clicks don't compound. |

## App modules (`js/app/`)

Each attaches methods onto `window.App` or registers via `App.hooks`.

| File | Role |
|---|---|
| `state.js` | `App.state`, `App.VIRTUAL_PARENTS`, `App.FACTION_COLORS`, `App.DEFAULT_ACCENT`, `App.applyFactionColor`. |
| `hooks.js` | `App.hooks` arrays + `fireBootstrap` / `fireArmyChange` / `fireSelectionChange`. |
| `filters.js` | `App.rebuildAllUnits`, `App.buildChaptersMap`, `App.getVirtualParentOf`, `App.getEffectiveFilter`, `App.findUnit`, `App.getCurrentFaction`, `App.getDetachmentFaction`. |
| `render.js` | `App.renderAll`, `App.renderUnitRosterWithContext`. |
| `bsdata-load.js` | `App.autoLoadFromBSData` — kicks off `BSData.loadAllFactions`. |
| `selections.js` | `App.updateChapterDropdown`, `App.updateDetachmentOptions`, `App.applyImportedSelections`. |
| `resize.js` | `App.setupResizablePanels`. |
| `events.js` | `App.wireEvents` — every direct + delegated DOM listener. |
| `index.js` | `DOMContentLoaded` bootstrap + `App.mountArmyToolbarActions` (toolbar region routing). |
| `topbar.js` | Wires top app bar (faction chip mirror, ⌘K, Action Center, status row). |
| `sw-register.js` | Registers `/sw.js` after `window.load`. |
| `keyboard.js` | `/` to focus search, arrows + Enter + `a` for roster nav. |
| `command-palette.js` | Cmd/Ctrl+K fuzzy command palette + `?` keyboard help overlay. |
| `validation.js` | Advisory 10e composition checks (Rule of Three, no warlord). |
| `history.js` | Undo/redo snapshot stack, debounced 500ms, max 50. |
| `url-share.js` | `?a=YAAB1:...` encode/decode + Share Link button. |
| `qr-share.js` | QR code modal for the current share URL. |
| `pwa-install.js` | `beforeinstallprompt` handler + mobile tab-bar wiring. |
| `validation.js` | Advisory composition checks. |
| `flavor.js` | Per-faction quote on empty army + save toast. |
| `nickname.js` | Auto-suggested army nickname placeholder. |
| `hero-state.js` | Empty-army CTA, Cmd+K hint badge, recent-faction chip row. |
| `legends-toggle.js` | Show/hide `[Legends]` units. |
| `ork-math.js` | Convert points → "teef" when Orks selected. |
| `points-override.js` | `App.applyPointsOverrides` + per-unit cost edits (dataslate). |
| `favorites.js` | Star/unstar units, Recents chip, filter view. |
| `collection.js` | Owned/painted tracker. |
| `starter-lists.js` | Curated starter armies + "Surprise me". |
| `match-mode.js` | Game-day overlay (CP, turns, phases, wounds, VP). |
| `kill-team.js` | Small-format mode. `App.toggleKillTeamMode`. |
| `stratagems.js` | Stratagem browser modal. |
| `crusade.js` | Campaign tracker (XP, ranks, scars, battle log). |
| `opponent.js` | Opponent army state + paste-in parser (YAAB1 + plain text). |
| `army-diff.js` | Labeled snapshots on save + two-version diff modal. |
| `activity-log.js` | Passive session change history, in-memory + per-day localStorage. |
| `community-feed.js` | Read-only browsable feed of curated lists. |
| `lore.js` | `App.openFactionLore` — faction lore browser modal. |
| `bug-report.js` | Diagnostics modal + prefilled GitHub issue URL. |
| `first-time-tour.js` | One-shot 3-step guided tour. |
| `lazy-modules.js` | Defer-on-first-click loader. **Orphan: not in index.html.** |
| `sound-fx.js` | Opt-in synthesized WebAudio sfx. **Orphan: not in index.html.** |
| `voice-commands.js` | Opt-in WebSpeech voice control. **Orphan: not in index.html.** |
| `auth.js` | `App.Auth`: session state + auth API client. See `docs/AUTH.md`. |
| `sync.js` | `App.Sync`: offline-first cloud sync. See `docs/SYNC.md`. |
| `autosave.js` | `armyChange` listener that debounces (500ms) and calls `ArmyManager.saveArmy()` on any mutation. Skips `'save'` / `'delete'` kinds (recursion guard) and the default `'New Army'` placeholder name. |
| `details-persist.js` | Remembers which `<details>` boxes are open across reloads. Targets `army-setup-section` + `army-rules-collapsible`. Persists to `yaab_details_state`. |
| `faction-fx.js` | Faction-themed add stingers (synthesized WebAudio, no samples) + accent-colored particle bursts at the FLIP landing site + body class for hero-banner SVG. Reduced-motion + sound-enabled gated. |
| `mobile-shell.js` | Mobile-only chrome (`max-width: 820px`): sticky points pill at top of Army panel, dynamic page-title in topbar, back-arrow in Detail panel header. Pure additive — desktop is untouched. Re-evaluates on resize. |
| `mode-shell.js` | Build / Collect / Play mode container switching + persistence. Owns `yaab_mode` and the `App.hooks.modeChange` bus. Loads first among the mode modules so `build-mode` / `collect-mode` / `play-mode` can register their panels. |
| `points-filter.js` | Comparator tokens in the unit search bar (`<=200`, `>=100`, `=150`, `<100`, `>50`, plus `≤`/`≥`). Multiple tokens AND together. A unit passes if ANY of its squad/variant costs satisfies the constraint. `roster.js` strips the same tokens before name/keyword matching. |
| `settings-drawer.js` | Slide-in Settings drawer (triggered from `#topbar-settings`). Routes to existing toggles (sound, voice, ork-math, legends, kill-team, collection badges, reduced motion) + utility actions (replay tour, clear caches, sign out). Owns `yaab_reduced_motion`. |

## Public namespaces

### `window.App` (functions)
`renderAll`, `renderUnitRosterWithContext`, `applyFactionColor`, `rebuildAllUnits`, `buildChaptersMap`, `getVirtualParentOf`, `getEffectiveFilter`, `findUnit`, `getCurrentFaction`, `getDetachmentFaction`, `setupResizablePanels`, `wireEvents`, `autoLoadFromBSData`, `updateChapterDropdown`, `updateDetachmentOptions`, `applyImportedSelections`, `mountArmyToolbarActions`, `fireBootstrap`, `fireArmyChange`, `fireSelectionChange`, `applyPointsOverrides`, `openFactionLore`, `toggleKillTeamMode`, `isSoundEnabled`, `lazyModules.{load,isLoaded,list}`.

### `window.App.hooks` (arrays)
`bootstrap`, `armyChange`, `selectionChange`, `armyToolbarActions`, `detailActions`, `rosterFilters`, `cardClassContributors`, `modeChange`. See `docs/ARCHITECTURE.md` for callback signatures.

### `window.UI` (functions)
`init`, `escapeHtml`, `toast`, `setLoadProgress`, `updateFactionFilter`, `updateFactionRules`, `renderUnitRoster`, `createUnitCard`, `renderStatCell`, `renderUnitDetail`, `renderRuleDetail`, `clearUnitDetail`, `renderArmyList`, `createArmyEntryEl`, `showLoadModal`/`hideLoadModal`, `showImportModal`/`hideImportModal`, `showExportModal`/`hideExportModal`, `renderDatasheet`, `renderArmyDatasheets`, `printUnitDatasheet`, `printArmyDatasheets`, `printCurrentArmy`, `initDropdowns`, `actionCenter.{open,close,toggle,isOpen,registerAction,clearActions,render}`, `openAnalytics`/`closeAnalytics`/`toggleAnalytics`, `openDamageCalc`, `openOpponentPaste`/`openMatchup`, `deploymentPlanner.{open,close}`, `openListCoach`.

### Other globals
- `window.Storage` — `saveFactionData`, `loadFactionData`, `addFaction`, `removeFaction`, `exportArmyToString`, `importArmyFromString`, `exportArmyToText`, `exportArmyToCSV`.
- `window.Army`, `window.ArmyManager` — data model classes.
- `window.BSData` — `fetchFileList`, `fetchFile`, `loadAllFactions`, `clearCache`, `clearFactionCache`.
- `window.WahapediaParser` — `parse`, `addToSharedIndex`, `releaseSharedIndex`, `lastReport`.
- `window.YaabDB` — `getFaction`, `putFaction`, `getAllFactions`, `clearFactions`, `getGst`, `putGst`, `clearGst`.

## State shape (`App.state`)

```
{
  factions:               Faction[],          // parsed faction objects, pushed per load
  allUnits:               Unit[],             // REFERENCES into factions[].units
  factionsVersion:        number,             // bumped on every rebuildAllUnits — invalidates UI caches
  currentArmy:            Army | null,
  armyManager:            ArmyManager | null,
  selectedUnit:           Unit | null,
  factionFilter:          string,             // 'all' or a faction/virtual-parent name
  selectedChapter:        string | null,
  chaptersMap:            { [virtualParent]: string[] },
  chapterFactions:        Set<string>,
  virtualBase:            { [virtualParent]: string },
  selectedDetachment:     Detachment | null,
  detachmentFaction:      Faction | null,
  selectedArmyEntryIndex: number | null,
}
```

`factionsVersion` is a cache-invalidation counter. `ui/detail.js` uses it to rebuild the Led-By reverse-index only when a new faction has been added.

## Event flow

All listeners attached once in `app/events.js::wireEvents()` after `DOMContentLoaded`. Delegated where possible:

- `#unit-grid` → `.unit-card` click
- `#army-entry-list` → `.army-qty-input` change, `.army-entry` / `.army-entry-remove` clicks
- `#unit-detail-panel` → `.enhancement-cb` change, `#btn-detail-add` click
- `#army-rules-section` → `.army-rule-item` click
- `#saved-army-list` → `.btn-load-saved` / `.btn-delete-saved`

Direct listeners: dropdowns, search input, name/points inputs, toolbar buttons by id. Modals share a `document.keydown` Escape handler that calls all three `hide*Modal` functions.

Hook-driven cross-module communication: when an army mutates, `App.fireArmyChange(kind)` runs every `armyChange` callback. When the user changes faction/chapter/detachment, `App.fireSelectionChange()` runs every `selectionChange` callback. See ARCHITECTURE.md for the full contract.

## How to add X

### Add a new feature module (the canonical pattern)
Create `js/app/<feature>.js` (or `js/ui/<feature>.js` if it owns DOM). IIFE that:
1. Bails early if `App.hooks` is missing.
2. Pushes a button onto `App.hooks.armyToolbarActions` with `{ id, region: 'primary'|'icon', category, label, title, onClick }`.
3. Optionally pushes onto `armyChange` / `selectionChange` / `bootstrap` / `rosterFilters` / `cardClassContributors`.
4. Owns its own modal markup (created on first open) — do NOT add markup to `index.html`.
5. Owns its own localStorage key (`yaab_<feature>`). Document it in `CLAUDE.md` Storage table.

Then: add the `<script>` to `index.html` between the `FEATURE-MODULES-START`/`END` markers, add the path to `sw.js` PRECACHE, and bump `SHELL` in `sw.js`.

### Add a stat / field to the unit detail
Edit `UI.renderUnitDetail` in `js/ui/detail.js`. If the field is parser-derived, add it to the returned object in `js/parser/entry.js` (see `docs/PARSER.md`) AND bump `DB_VERSION` in `js/db.js` so stale IndexedDB caches are dropped.

### Add a new modal
Create the markup in JS (your feature module's IIFE, on first open). Don't add to `index.html`. Wire `Escape` either via the existing global handler in `events.js` or your own. Show/hide pattern: `removeAttribute('hidden')` / `setAttribute('hidden','')`.

### Add a new dropdown menu item
Push an action onto `App.hooks.armyToolbarActions` with `region: 'tools-menu'`, `region: 'more-menu'`, or `region: 'export-menu'`, `category` for tools-menu grouping. The mount routine builds `.menu-item` buttons automatically.

### Add a new toolbar action (inline)
Push onto `App.hooks.armyToolbarActions` with `region: 'primary'` AND `priority: 'visible'` (or add the action's id to `PRIMARY_VISIBLE_IDS` in `js/app/index.js`). For an icon-shelf button: `region: 'icon'` + add id to `ICON_VISIBLE_IDS`.

### Add a CSS-only design tweak
Create `css/<feature>.css`, link it from `index.html` `<head>`, and add to `sw.js` PRECACHE. Bump `SHELL`.

### Add a service-worker-cached asset
Add the URL to `PRECACHE` in `sw.js`. Bump `SHELL`. The activate handler will evict the prior cache.

### Bump the parser cache
Bump `DB_VERSION` in `js/db.js` whenever you change the parser output shape (anything in `entry.js`, `wargear.js`, `costs.js`, `keywords.js`, `abilities.js`, `weapons.js`). The `onupgradeneeded` handler drops both stores. NOT bumping leaves users reading stale cached JSON missing the new field.

### Add a new virtual-parent faction grouping
Edit `App.VIRTUAL_PARENTS` in `js/app/state.js`. Shape: `{ name, baseChapter }`. `buildChaptersMap` auto-populates `chaptersMap` / `chapterFactions` / `virtualBase` for any catalogue named `<name> - ...`.

### Add a new faction color
Edit `App.FACTION_COLORS` in `js/app/state.js`. Key is the full faction name OR the last segment after `" - "`. Value: `[accent, hover, dark, rgb-triplet-string]`. Auto-contrast for `--accent-on` is computed in `applyFactionColor`.

## Top-level modes (Build / Collect / Play)

`js/app/mode-shell.js` is the container switcher. The page renders three sibling panels (`#build-mode`, `#collect-mode`, `#play-mode`); mode-shell shows exactly one and stamps `<body data-mode="...">` for CSS. Mode is persisted to `yaab_mode` (`'build'` default). Mode switching also fires the `App.hooks.modeChange` bus — callback signature `(newMode, prevMode) => void`.

| Mode | Module | Persists |
|---|---|---|
| `build` | `js/ui/build-mode.js` | — (default mode; uses standard 3-pane layout + hero) |
| `collect` | `js/ui/collect-mode.js` | reads `yaab_collection`, `yaab_crusade_rosters`, `yaab_kt_mode` |
| `play` | `js/ui/play-mode.js` | sub-tab in `yaab_play_tab`; match state in `yaab_match_state` |

The build mode is the historical 3-pane app; collect and play modes are alternative top-level surfaces that reuse the same data (current army, factions, collection, etc.) but render their own DOM trees. To add a fourth mode: add the panel id to `VALID` in `mode-shell.js`, create the module, and listen on `modeChange` to lazy-build content on first activation.

## Testing checklist

1. `python3 -m http.server 8000` from repo root. NOT `file://`.
2. First load (cold): wait for top progress bar to reach 100%. Should be ~30s.
3. Second tab/load (warm): IndexedDB cache should boot the roster in <1s.
4. Pick a faction → accent color switches; chapter sub-dropdown appears for Imperium - Adeptus Astartes.
5. Pick a detachment → Detachment Rule + Enhancements appear.
6. Click a unit card → right panel shows stats, weapons (with keyword tooltips), abilities, Led By, Wargear, Keywords, Enhancements.
7. Quantity + squad option → Add to Army → toast confirms; left-panel points update.
8. Check enhancement → points update; save-pulse animates; analytics modal (if open) refreshes.
9. Save → reopen Load modal → army listed with correct points.
10. Export → copy `YAAB1:` → New → Import → paste → all selections restore.
11. Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo) → state mutates correctly.
12. Cmd/Ctrl+K → command palette; type `analytics` → Enter → modal opens.
13. Disable network in DevTools → reload → service worker serves the shell; BSData fetch fails gracefully (cached factions still present).
14. Resize browser → left/right panel drag handles still work; unit grid reflows.
