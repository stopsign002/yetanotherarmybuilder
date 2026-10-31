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
| `dropdown.js` | `UI.initDropdowns()` — click-to-toggle + keyboard for the `.dropdown` menus that still exist (the bottom-toolbar Export ▾). Printing is done by Cards mode (`window.print()`); there is no datasheet module. |
| `glossary.js` | `UI.glossary.lookup`, `UI.linkGlossary(html)` (wraps `UI.mdBold`): every core-ability / weapon-keyword chip and bolded rules term becomes a button opening one `#glossary-pop` popover (bottom sheet on phones). Contract `docs/GLOSSARY.md`. |
| `celebrations.js` | Confetti, rolling-points tween, landing pulse, shimmer. `armyChange` hook. |
| `save-pulse.js` | Pulses Save while the current army has unsaved mutations (an `armyChange` kind of `render` marks dirty, `save` marks clean). |
| `scanline.js` | Tactical-display sweep on faction switch + body classes for active-panel accent stripes. |
| `animated-crest.js` | Rotating hex crest in the empty unit-detail panel when a faction is selected. |
| `cold-start.js` | Loaded (`<script defer>` in `index.html`). Hands off from the static `#boot-splash`, then runs the cold-start overlay + progress/retry UI while factions are built. Its "warm start" detection is dead — nothing writes the IndexedDB faction cache, so the cold path runs every load; the Retry button clears a `sessionStorage` key (`yaab_bsdata_filelist_10e_v1`) nothing writes. |
| `auth-button.js` | Top-bar Sign-in / username button + dropdown menu. See `docs/AUTH.md`. |
| `auth-modal.js` | `UI.showAuthModal(mode)` for login/register/recover/change-password. See `docs/AUTH.md`. |
| `build-mode.js` | Orchestrator for the BUILD mode page: hero header, rules pinboard tab, roster polish. Mounted by `mode-shell.js`. |
| `collect-mode.js` | Orchestrator for the COLLECT mode page. One sub-tab remains (Painting); the Crusade and Kill Team tabs were deleted. Reads `yaab_collection`. Mounted by `mode-shell.js`. |
| `waha-mode.js` | WAHA mode: look anything up (datasheet, detachment, stratagem, rule, enhancement; any faction) with no army and no builder writes. One search box, kind tabs, reader. Owns `yaab_waha_recent`; contract `docs/WAHA-MODE.md`. |
| `play-mode.js` | PLAY mode: fast-switching game-day reference (unit switcher; stratagems / rules / enhancements tabs; CP counter and destroyed toggle). Owns `yaab_play_view` and `yaab_play_game`; layout notes `docs/PLAY-MODE-ROW-LAYOUT.md`. Not resumable on launch. Removes the legacy `yaab_play_tab` / `yaab_match_state` keys at bootstrap. |
| `cards-mode.js` | CARDS mode: printable data-card designer (settings rail + physical-size preview, templates, named presets, per-card page-split). Print / Save PDF is `window.print()` with a body class and an injected `@page` rule. Owns `yaab_cards_prefs`, `yaab_cards_presets`, `yaab_cards_selection`, `yaab_cards_spill`. Card-back images live in the server library (`/api/images`, `docs/CARDS_IMAGES_API.md`) when signed in and in the browser-local IDB `cardBackImages` store (`YaabDB.images`) when not. Not resumable on launch. |
| `offline-pip.js` | Topbar "Offline" chip and pending-sync-queue count (`#topbar-offline`), inserted at bootstrap next to the auth button. The topbar is hidden at ≤820px, so phones have no offline indicator unless a later change adds one (#85). |
| `topbar-export.js` | Export button + dropdown in the topbar (`#topbar-export-btn`, `#topbar-export-menu`), next to the account button. Each item programmatically clicks the matching panel-footer Export button so existing event wiring keeps firing. |
| `faction-glyphs.js` | Inline-SVG geometric faction glyphs (24×24 viewBox, `currentColor`) + DOM injection helpers. Original abstract geometry — no GW iconography. |
| `datasheet-parts.js` | `UI.ds.{statsTable,weaponRows,abilityList,keywordChips}` — the shared datasheet renderer used by detail, cards, Waha and Play (added 2026-10-31). |
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
| `bsdata-load.js` | `App.autoLoadFromBSData` — kicks off `BSData.loadAllFactions` (installed by `js/data/dataset-loader.js`). |
| `selections.js` | `App.updateChapterDropdown`, `App.applyImportedSelections` (detachment choice lives in `detachment-picker.js`). |
| `resize.js` | `App.setupResizablePanels`. |
| `events.js` | `App.wireEvents` — every direct + delegated DOM listener. |
| `index.js` | `DOMContentLoaded` bootstrap + `App.mountArmyToolbarActions` (toolbar region routing). |
| `topbar.js` | Wires the top app bar: brand (click returns to Build), the ⌘K search button, the Settings gear, the Help (?) button. |
| `theme-boot.js` (`js/`, not `js/app/`) | The only non-`defer` script; last in `<head>`. Owns `window.YAAB_THEMES` and applies the saved theme before first paint. See "Themes" in `CLAUDE.md`. |
| `themes.js` | `App.Themes.{list,get,set,remapAccent}`: live theme switching, cloud-synced `yaab_theme`, faction-accent retint per theme. |
| `mobile-history.js` | Makes the phone Back button close exactly one layer (More drawer, Details panel, modes, modals) via `App.backTrap`; trap keys are namespaced per load. |
| `sw-register.js` | Registers `/sw.js` after `window.load` (`updateViaCache: 'none'`). See the "Service worker" section of `CLAUDE.md`. |
| `keyboard.js` | `/` to focus search, arrows + Enter + `a` for roster nav (Build mode only). |
| `command-palette.js` | Cmd/Ctrl+K fuzzy command palette + `?` keyboard help overlay. |
| `validation.js` | Advisory 10e composition checks (Rule of Three, no warlord). |
| `history.js` | Undo/redo snapshot stack, debounced 500ms, max 50. |
| `url-share.js` | `?a=YAAB1:...` encode/decode + Share Link button. |
| `qr-share.js` | QR code modal for the current share URL. |
| `pwa-install.js` | `beforeinstallprompt` handler + mobile tab-bar wiring. |
| `flavor.js` | Per-faction quote on empty army + save toast. |
| `nickname.js` | Auto-suggested army nickname placeholder. |
| `hero-state.js` | Empty-army CTA, Cmd+K hint badge, recent-faction chip row. |
| `legends-toggle.js` | Show/hide `[Legends]` units. |
| `favorites.js` | Star/unstar units, Recents chip, filter view. |
| `collection.js` | Owned/painted tracker. |
| `bug-report.js` | Server-backed bug report modal with auto-attached diagnostics (UA, viewport, SW status, faction count, current-army YAAB1 code). `App.BugReport = { open }`. Auth-gated; reports posted to `/api/bugs`. |
| `auth.js` | `App.Auth`: session state + auth API client. See `docs/AUTH.md`. |
| `sync.js` | `App.Sync`: offline-first cloud sync. See `docs/SYNC.md`. |
| `autosave.js` | `armyChange` listener that debounces (500ms) and calls `ArmyManager.saveArmy()` on any mutation. Skips `'save'` / `'delete'` kinds (recursion guard). See `autosave.js` for how an army still named `'New Army'` is treated (changed by fix batch 2026-10-30, #113). |
| `details-persist.js` | Remembers which `<details>` boxes are open across reloads. Targets `army-setup-section` + `army-rules-collapsible`. Persists to `yaab_details_state`. |
| `faction-fx.js` | Faction-themed add stingers (synthesized WebAudio, no samples) + accent-colored particle bursts at the FLIP landing site + body class for hero-banner SVG. Reduced-motion + sound-enabled gated. |
| `mobile-shell.js` | Mobile-only chrome (`max-width: 820px`): sticky points pill at top of Army panel, dynamic page-title in topbar, back-arrow in Detail panel header. Pure additive — desktop is untouched. Re-evaluates on resize. |
| `mode-shell.js` | Container switching for the five modes (build / collect / cards / play / waha) + persistence. Owns `yaab_mode`, the `App.hooks.modeChange` bus (callbacks get `(mode)`) and `App.prefersReducedMotion()`. Loads after `app/index.js`; mode modules create the `modeChange` array defensively. |
| `points-filter.js` | Comparator tokens in the unit search bar (`<=200`, `>=100`, `=150`, `<100`, `>50`, plus `≤`/`≥`). Multiple tokens AND together. A unit passes if ANY of its squad/variant costs satisfies the constraint. `roster.js` strips the same tokens before name/keyword matching. |
| `settings-drawer.js` | Slide-in Settings / More drawer (`#topbar-settings` on desktop, the tab bar's More on phones). Sections: Go (Build, Collect, Waha, Play, What's new — on desktop the Go rows currently list only Waha and Play), Army (new/save/load/import/undo/redo), Account (sign in/out, sync now, change password), Appearance (theme radiogroup), toggles (Legends, allied units, painting badges, reduced animations) and utilities (clear cached game data, About). Owns `yaab_reduced_motion`. |
| `admin.js` | Server-backed admin panel (account approvals, image moderation, bug-report review). `App.Admin = { open, close, isAdmin }`. Visible only when `App.Auth.isAdmin()`. |
| `pending-approval-banner.js` | **Admin-only** banner shown when one or more accounts await approval; polls `/api/admin/users/pending-count` and opens the admin panel on click. (It is not shown to the pending user — that user sees the pending message in the auth modal.) |
| `changelog.js` | "What's new" modal driven by `App.CHANGELOG` (data lives in `js/data/changelog-data.js`). `App.Changelog = { open, close }`. Owns `yaab_changelog_seen` LS key + the unseen-version dot. Renders a hard-refresh tip banner (Ctrl+Shift+R / ⌘⇧R) above entries. |
| `expand-pane.js` | Click any panel header (Army / Units / Details) or its expand icon to grow the pane to full width with a `grid-template-columns` transition; click again or press Escape to restore. Auto-opens the army-rules collapsible while the army pane is expanded. `App.PaneExpand = { expand, collapse, toggle, isExpanded }`. Classes on `#app-main`: `pane-expanded-center` (Units alone, fullscreen) or `pane-expanded-build` (Army and Details share the area and the Units pane is hidden — expanding either Army or Details enters it); `panel-expanded` / `panel-build-focus` go on the panels. There is no `pane-expanded-left` / `-right`. The toggle button is hidden at ≤820px by CSS. |

## Public namespaces

### `window.App` (functions)
`renderAll`, `renderUnitRosterWithContext`, `applyFactionColor`, `rebuildAllUnits`, `buildChaptersMap`, `getVirtualParentOf`, `getEffectiveFilter`, `findUnit`, `getCurrentFaction`, `getDetachmentFaction`, `setupResizablePanels`, `wireEvents`, `autoLoadFromBSData`, `updateChapterDropdown`, `applyImportedSelections`, `mountArmyToolbarActions`, `fireBootstrap`, `fireArmyChange`, `fireSelectionChange`, `prefersReducedMotion`, plus the sub-namespaces `Auth`, `Sync`, `Admin`, `Themes`, `BugReport`, `Changelog`, `PaneExpand`, `settingsDrawer`. (`updateDetachmentOptions`, `applyPointsOverrides`, `openFactionLore`, `toggleKillTeamMode`, `isSoundEnabled` and `lazyModules` do not exist; `faction-fx.js` still feature-tests `App.isSoundEnabled`, which is never defined, so its sound is permanently off.)

### `window.App.hooks` (arrays)
`bootstrap`, `armyChange`, `selectionChange`, `armyToolbarActions`, `detailActions`, `rosterFilters`, `cardClassContributors`, `armyEntryActions`, `paletteCommands` (all created in `hooks.js`), `modeChange` (created by `mode-shell.js`), and the lazily created `chipClearers` / `chipActive` (below). See `docs/ARCHITECTURE.md` for callback signatures.

### `window.UI` (functions)
`init`, `escapeHtml`, `toast`, `setLoadProgress`, `updateFactionFilter`, `updateFactionRules`, `renderUnitRoster`, `createUnitCard`, `renderStatCell`, `renderUnitDetail`, `renderRuleDetail`, `clearUnitDetail`, `renderArmyList`, `createArmyEntryEl`, `showLoadModal`/`hideLoadModal`, `showImportModal`/`hideImportModal`, `showExportModal`/`hideExportModal`, `renderDetachmentDetail`, `initDropdowns`, `showAuthModal`, `glossary.lookup`, `linkGlossary`, `mdBold`, `mdPlain`, `stratPhaseLabel`, `stratPhases`, `syncChipClearVisibility`, `loadingComplete`. (There is no `renderDatasheet`, `printUnitDatasheet`, `actionCenter` or `deploymentPlanner`.)

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
2. If it needs a button: pushes onto `App.hooks.armyToolbarActions` with `{ id, region, label, title, onClick }`. **Only some regions render a button** (see "Add a new toolbar action" below); a `primary` / `tools-menu` / `more-menu` action registers but shows nowhere, so for anything user-facing also add a palette command (`App.hooks.paletteCommands`) or a Settings-drawer row.
3. Optionally pushes onto `armyChange` / `selectionChange` / `bootstrap` / `rosterFilters` / `cardClassContributors`.
4. Owns its own modal markup (created on first open) — do NOT add markup to `index.html`.
5. Owns its own localStorage key (`yaab_<feature>`). Document it in `CLAUDE.md` Storage table.

Then: add the `<script>` to `index.html` between the `FEATURE-MODULES-START`/`END` markers. **Nothing to do for the service worker** — see below.

### Add a stat / field to the unit detail
Edit `UI.renderUnitDetail` in `js/ui/detail.js`. If the field is data-derived, add it to the unit object built in `pipeline/build.mjs` (the live data source — the `js/parser/` tree is dormant; see `docs/PARSER.md`). No `DB_VERSION` bump is needed: the adapter rebuilds factions from `window.DC` each load, so there's no faction cache to invalidate.

### Add a new modal
Create the markup in JS (your feature module's IIFE, on first open). Don't add to `index.html`. Wire `Escape` either via the existing global handler in `events.js` or your own. Show/hide pattern: `removeAttribute('hidden')` / `setAttribute('hidden','')`.

### Add a new dropdown menu item
The Tools ▾ / More ▾ menus are gone. The one dropdown that still takes hook items is the bottom-toolbar **Export ▾**: push onto `App.hooks.armyToolbarActions` with `region: 'export-menu'` and the mount routine builds a `role="menuitem"` button into `#export-extras`. Every other region (`tools-menu`, `more-menu`, `primary`) renders nothing.

### Add a new toolbar action (inline)
Only two inline surfaces exist, both allow-listed in `js/app/index.js`: push with `region: 'icon'` and add the id to `TOPBAR_SHELF_IDS` for the top-bar shelf (today: auth, bug-report, changelog, Play, Waha), or to `BOTTOM_INLINE_ICON_IDS` for the bottom toolbar's icon row (undo/redo). An `icon` action whose id is in neither set is dropped. Remember the top bar is hidden at ≤820px, so anything phone users need must also be in the tab bar (`pwa-install.js`) or the More drawer (`settings-drawer.js`).

### Add a CSS-only design tweak
Create `css/<feature>.css` and link it from `index.html` `<head>`. **Nothing to do for the service worker** — see below.

### Add a service-worker-cached asset
**There is nothing to do.** `sw.js` is stale-while-revalidate, so any same-origin GET the page makes is cached on first use and revalidated on every use afterwards. The old `PRECACHE` / `SHELL` recipe described here no longer exists — that design served the shell cache-first and is exactly why the worker was killed in April 2026.

Do **not** add paths to `SHELL` in `sw.js`. It is deliberately limited to the offline *navigation fallback* (`/`, `/index.html`, the manifest and the icons); everything index.html references is requested on every load anyway, so precaching it would download ~14 MB twice on the install visit for no extra coverage.

Two things are never cached: anything under `/api/` and anything under `/data/`. If your feature needs offline data, put it in IndexedDB (`js/db.js`) like `js/gdc.js` does, not in the service worker. Full reasoning in the "Service worker" section of `CLAUDE.md`.

### Change faction data / unit fields
Edit `pipeline/build.mjs` (the dataset build that emits the parser-output shape). No `DB_VERSION` bump is needed — the adapter rebuilds factions on every load (no faction IndexedDB cache). Don't hand-edit `js/vendor/dc-bundle.js`; it's generated and auto-refreshed. The `js/parser/` tree is dormant. See `docs/PARSER.md`.

### Add a new virtual-parent faction grouping
Edit `App.VIRTUAL_PARENTS` in `js/app/state.js`. Shape: `{ name, baseChapter }`. `buildChaptersMap` auto-populates `chaptersMap` / `chapterFactions` / `virtualBase` for any catalogue named `<name> - ...`.

### Add a new faction color
Edit `App.FACTION_COLORS` in `js/app/state.js`. Key is the full faction name OR the last segment after `" - "`. Value: `[accent, hover, dark, rgb-triplet-string]`. Auto-contrast for `--accent-on` is computed in `applyFactionColor`.

## Top-level modes (Build / Collect / Cards / Play / Waha)

`js/app/mode-shell.js` is the container switcher. `index.html` holds one sibling `<section class="mode-page">` per mode (`#build-mode`, `#collect-mode`, `#cards-mode`, `#waha-mode`, `#play-mode`); mode-shell shows exactly one and stamps `<body data-mode="...">` for CSS. Mode is persisted to `yaab_mode` (`'build'` default) but only the `RESUMABLE` modes are restored on launch. Mode switching fires the `App.hooks.modeChange` bus — callback signature `(mode) => void` (one argument) — and dispatches a `yaab:mode-change` DOM event.

| Mode | Module | Persists |
|---|---|---|
| `build` | `js/ui/build-mode.js` | — (default mode; uses standard 3-pane layout + hero + Rules pinboard tab) |
| `collect` | `js/ui/collect-mode.js` | reads/writes `yaab_collection` (in `RESUMABLE`) |
| `cards` | `js/ui/cards-mode.js` | `yaab_cards_*` keys, see its MODULE-REFERENCE entry (not in `RESUMABLE` — reopening lands in Build) |
| `waha` | `js/ui/waha-mode.js` | `yaab_waha_recent` (in `RESUMABLE` — reload lands back in Waha; contract `docs/WAHA-MODE.md`) |
| `play` | `js/ui/play-mode.js` | `yaab_play_view`, `yaab_play_game` (not in `RESUMABLE` — game state survives independently, but reopening lands in Build) |

The build mode is the historical 3-pane app; the others are alternative top-level surfaces that reuse the same data (current army, factions, collection, etc.) but render their own DOM trees. **Reachability:** on desktop the topbar shows PLAY and WAHA buttons; Collect is reachable only through Cmd/Ctrl+K and the drawer on phones; Cards through Export ▾ → Data cards… (and the drawer/palette). To add another mode: add the panel id to `VALID` in `mode-shell.js` (and to `RESUMABLE` if it should be restored), add its `<section>` to `index.html`, create the module, and listen on `modeChange` to build content on first activation.

## Roster filter chips — and the Ally chip (contract, 2026-09-17)

`#roster-filter-chips` is created once by `js/ui/roster.js` (`ensureChipBar`),
which owns the six keyword chips (Battleline … Psyker) and the trailing `×`
clear button. **Feature modules add their own chips by injecting into that bar**
rather than by extending the `UI.roles` table — `favorites.js` (★ Favorites, ⟲ Recents)
and `collection.js` (Owned / Needs paint / Painted) are the two precedents:

- wait for the bar with a `MutationObserver` on `#panel-center`, disconnect once
  injected, and re-check on `modeChange` (roster.js builds the bar on first
  render, so it does not exist at bootstrap);
- insert **before** `.filter-chips-clear` so `×` stays last;
- class `filter-chip <your-own-class>`, so the base styling is inherited;
- register ONE predicate on `App.hooks.rosterFilters`, tagged with a marker
  property and deduped (`filter(fn => !fn._isYours)`) before pushing;
- call `App.renderUnitRosterWithContext()` after any state change.

**The shared `×` clear button via `chipClearers` / `chipActive` (#95).**
roster.js's clear handler does `bar.querySelectorAll('.filter-chip')` and
strips `.active` / `.excluded` off *every* chip in the bar (every feature
chip included, since they all share that class), but on its own it only
knows about its own `R.chipState` — a feature module's chip used to go back
to looking off while its filter stayed on. Two hooks fix that, created lazily
(not pre-created in `js/app/hooks.js`, so whichever module loads first wins —
mirror collection.js's `modeChange` array):

```js
if (!Array.isArray(App.hooks.chipClearers)) App.hooks.chipClearers = [];
if (!Array.isArray(App.hooks.chipActive))   App.hooks.chipActive   = [];
```

- `App.hooks.chipClearers` — `Array<() => void>`. roster.js's `×` handler
  clears `R.chipState` + its own DOM classes, calls every entry here
  (try/catch each, like the other hook loops in `js/app/hooks.js`), then
  re-renders the roster **once**, then calls `syncClearVisibility()`. A
  clearer resets its module's own flag(s) the way its own toggle does —
  it should NOT call `App.renderUnitRosterWithContext()` itself (roster.js's
  single re-render after the loop covers it).
- `App.hooks.chipActive` — `Array<() => boolean>`. `syncClearVisibility()`
  shows `×` when `R.chipState` is non-empty **or** any predicate here returns
  true, so `×` stays visible when a feature chip is the only active filter.
- Export is `UI.syncChipClearVisibility()` (roster.js has no `UI.Roster`
  sub-namespace — flat `UI.*`, same idiom as `UI.renderUnitRoster` etc.).
  **Your own chip's click handler must call it** right after toggling, so
  `×` appears/disappears immediately rather than waiting for the next
  roster.js-driven chip change.

A future chip: push a clearer that zeroes your flag(s), push a predicate that
reports whether your chip is active, and call `UI.syncChipClearVisibility()`
at the end of your chip's own click handler. See `favorites.js`
(`clearFavRecentChip` / `registerChipHooks`), `collection.js`
(`clearCollectionChips`), or `allies.js` (`clearAllyChip`) for the pattern.

### The Ally chip

Owned by **`js/app/allies.js`**, not roster.js — it filters on `unit._allyOf`
(stamped per host-faction clone by `attachAlliedUnits()` in `pipeline/build.mjs`),
not on `unit.keywords`, and it has to co-operate with that module's existing
`yaab_show_allies` toolbar toggle.

**Three states, cycling on click, exactly like the keyword chips:**

| state | class | meaning |
|---|---|---|
| off (**default**) | — | no ally filtering; the toolbar toggle decides (and that toggle itself defaults OFF since 2026-09-24, so a fresh load shows no allies) |
| include | `.active` | show **only** allied units |
| exclude | `.excluded` | hide allied units |

**It starts off on every load and is deliberately NOT persisted** (no
localStorage key) — the owner asked for a filter that defaults to off, and the
persistent "is this hidden?" control is already the toolbar toggle.

**One predicate, so the two controls cannot contradict each other.** Replace
allies.js's existing `rosterFilters` push with a single function:

```
isAlly = !!(unit && unit._allyOf)
chip === 'include'  ->  return isAlly          // chip wins over the toggle
chip === 'exclude'  ->  return !isAlly
otherwise           ->  return showAllies || !isAlly     // today's behaviour
```

The include branch **must** override `showAllies`: asking to see only allies
while the toolbar toggle hides them would otherwise render an empty roster,
which reads as a bug. Toggling the toolbar button while the chip is active must
not change the result, and the button's own title text stays as it is.

**Label/title:** chip text `Ally`; `title` follows the keyword chips' wording —
`'Click to show only allied units; click again to hide them'`. Give it its own
class (`ally-chip`) and an `aria-pressed` that is `'true'` only in the include
state, matching `ensureChipBar`'s handling.

**Styling:** `.filter-chip` base covers it; add a rule only if the chip needs a
glyph, and derive any colour from existing tokens so every theme is covered by
construction (see `css/themes/` and the `--accent` family). Never hard-code a
hex.

### Done means

- Chip is present in the bar after the roster first renders, in **Build** mode,
  and it is the state's default (off) on a fresh load with cleared storage.
- With a faction selected that actually has allies — Genestealer Cults has
  **64 allied units of 88**, Chaos Space Marines 77 of 131, Astra Militarum
  50 of 122, Space Marines 48 of 222 (measured live 2026-09-17) — include shows
  only cards carrying `.unit-card-ally`, exclude shows none of them, off shows
  both.
- Ally units are attached **lazily, on faction select**: at "All Factions" on a
  cold load `App.state.allUnits` contains **zero** `_allyOf` units, so any test
  must select a faction first.
- The `×` clear button resets the ally chip along with the others, through the
  two hooks below rather than a direct binding (#95, fixed).
- The toolbar toggle still works when the chip is off, and cannot empty the
  roster when the chip is on include.
- No new page errors; both themes, both widths.

## Testing checklist

1. `python3 -m http.server 8000` from repo root. NOT `file://`.
2. First load (cold): wait for the boot splash / top progress bar to finish (a few seconds; factions are built from the embedded bundle, not fetched).
3. Second load (warm): the service worker serves the shell and assets from the Cache API, so there is no network cost, but boot is CPU-bound (factions are rebuilt from `window.DC` every load; there is no IndexedDB faction cache), so expect a few seconds, not <1s.
4. Pick a faction → accent color switches; chapter sub-dropdown appears for Imperium - Adeptus Astartes.
5. Pick a detachment → Detachment Rule + Enhancements appear.
6. Click a unit card → right panel shows stats, weapons (with keyword tooltips), abilities, Led By, Wargear, Keywords, Enhancements.
7. Quantity + squad option → Add to Army → toast confirms; left-panel points update.
8. Check enhancement → points update; save-pulse animates.
9. Save → reopen Load modal → army listed with correct points.
10. Export → copy `YAAB1:` → New → Import → paste → all selections restore.
11. Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo) → state mutates correctly.
12. Cmd/Ctrl+K → command palette; type `collect` → Enter → Collect mode opens (the YAAB logo returns to Build).
13. Disable network in DevTools → reload → faction data still loads (it's embedded in `js/vendor/dc-bundle.js`, no fetch); only the live GDC fallback text degrades gracefully.
14. Resize browser → left/right panel drag handles still work; unit grid reflows.
