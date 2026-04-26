# CLAUDE.md

## What this is

A client-only static site (no build step) that fetches BattleScribe 10th-edition XML from `BSData/wh40k-10e` over GitHub's raw.githubusercontent.com and the raw tree API, parses it in-browser with `DOMParser`, and lets a user build, share, and play 40k armies. Persists user data in `localStorage` and parsed faction data in IndexedDB. Installable PWA with offline app-shell.

## Running it

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Cannot be opened via `file://` — the BSData fetch requires http(s).

## File map

| Path | Purpose |
|---|---|
| `index.html` | Single-page shell. Hardcoded `<script>` order matters. Holds the topbar + 3-pane layout + modal mounts. |
| `css/*.css` | One file per feature surface (see `sw.js` PRECACHE for the canonical list). `style.css` is the base; everything else is additive. |
| `sw.js` | App-shell service worker. Same-origin cache-first, BSData passes through. |
| `manifest.json` | PWA manifest (installable). |
| `js/db.js` | `YaabDB` IndexedDB wrapper: `factions` + `gst` stores. |
| `js/bsdata.js` | GitHub fetch + 6-worker bulk loader. Caches via `YaabDB`. |
| `js/parser/` | BattleScribe XML → plain-object units. See `docs/PARSER.md`. |
| `js/storage.js` | `localStorage` armies + compact `YAAB1:` deflate-base64url export/import. |
| `js/army.js` | `Army` + `ArmyManager` data model. |
| `js/data/` | Static JSON-ish data: lore, stratagems, community feed. |
| `js/ui/` | DOM-rendering modules. Each attaches to `window.UI`. See `docs/UI.md`. |
| `js/app/` | Bootstrap, state, events, and feature modules. Each attaches to `window.App`. See `docs/UI.md`. |
| `js/vendor/` | `html2pdf.bundle.min.js`, `qrcode.min.js`, `fonts/cinzel-{400,600}.woff2`. |
| `docs/` | Architecture / parser / UI reference. Read these before non-trivial changes. |

## Major features

Grouped by user intent. One module per row; module path is the search target.

| Group | Feature | Module |
|---|---|---|
| Build | Faction → chapter → detachment selection | `js/app/selections.js`, `js/ui/faction-filter.js` |
| Build | Capped-render unit roster (search, role chips, fuzzy match) | `js/ui/roster.js` |
| Build | Unit detail panel (stats, weapons, abilities, Led By, enhancements) | `js/ui/detail.js` |
| Build | Composition validation (Rule of Three, no warlord) | `js/app/validation.js` |
| Build | Undo / redo (50-snapshot stack, Cmd/Ctrl+Z) | `js/app/history.js` |
| Build | Starter lists + "Surprise me" generator | `js/app/starter-lists.js` |
| Build | Favorites (star units) + Recents chip row | `js/app/favorites.js` |
| Build | Points overrides (dataslate edits, per-unit) | `js/app/points-override.js` |
| Build | Auto-suggest army nickname from faction | `js/app/nickname.js` |
| Build | Cmd/Ctrl+K command palette + `?` keyboard help | `js/app/command-palette.js` |
| Game Day | Match-mode overlay (CP, turns, phases, wounds, VP) | `js/app/match-mode.js` |
| Game Day | Stratagem browser (detachment + faction + core) | `js/app/stratagems.js` |
| Game Day | Crusade campaign tracker (rosters, XP, ranks, scars) | `js/app/crusade.js` |
| Game Day | Kill Team mode (cap points, filter roster, mission roller) | `js/app/kill-team.js` |
| Game Day | Opponent paste-in + side-by-side matchup viewer | `js/app/opponent.js`, `js/ui/matchup.js` |
| Game Day | Deployment planner (drag/drop battlefield, per-army) | `js/ui/deployment-planner.js` |
| Game Day | Dice roller (click stat cell to roll d6) | `js/ui/dice-roller.js` |
| Analyze | Analytics dashboard (live via `armyChange` hook) | `js/ui/analytics.js` |
| Analyze | Damage calculator (10e attack simulator) | `js/ui/damage-calc.js` |
| Analyze | Synergy detector (leaders, keyword combos) | `js/ui/synergy.js` |
| Analyze | Army-diff history (labeled snapshots, two-version compare) | `js/app/army-diff.js` |
| Analyze | Activity log (passive session history, 30-day persistence) | `js/app/activity-log.js` |
| Print & Export | GW-style datasheet print (single + whole army) | `js/ui/datasheet.js`, `css/datasheet.css` |
| Print & Export | Tournament-prep PDF bundle | `js/ui/tournament-export.js` |
| Print & Export | URL-shareable armies (`?a=YAAB1:...`) | `js/app/url-share.js` |
| Print & Export | QR share (mobile-to-mobile) | `js/app/qr-share.js` |
| Print & Export | YAAB1 string export/import (compact deflate) | `js/storage.js` |
| Browse | Faction lore browser modal | `js/app/lore.js`, `js/data/lore-data.js` |
| Browse | Community feed (curated army lists) | `js/app/community-feed.js`, `js/data/community-feed.json` |
| Browse | First-time guided tour | `js/app/first-time-tour.js` |
| Collection | Owned/painted tracker (per unit) | `js/app/collection.js` |
| Polish | Confetti / save pulse / scanline / animated crest | `js/ui/celebrations.js`, `js/ui/save-pulse.js`, `js/ui/scanline.js`, `js/ui/animated-crest.js` |
| Polish | Faction flavor quotes on empty army | `js/app/flavor.js` |
| Polish | Hero CTA + Cmd+K hint + recent factions chip | `js/app/hero-state.js` |
| Polish | Ork "teef" math (faction-themed point display) | `js/app/ork-math.js` |
| Polish | Legends-units toggle | `js/app/legends-toggle.js` |
| Polish | PWA install prompt + mobile tab bar | `js/app/pwa-install.js` |
| Polish | Bug-report modal (prefilled GitHub issue) | `js/app/bug-report.js` |
| Polish | Top app bar (chip mirror, ⌘K, Action Center) | `js/app/topbar.js`, `js/ui/action-center.js` |

## Module conventions

- No build step. No `import`/`export`. Plain `<script src>` in `index.html`. Each file is an IIFE that attaches to `window.WahapediaParser`, `window.UI`, `window.App`, `window.YaabDB`, or one of the legacy globals (`Storage`, `Army`, `ArmyManager`, `BSData`).
- **Hook-first architecture**. Feature modules MUST register via `App.hooks` — do NOT edit shared files (`events.js`, `detail.js`, `index.html` toolbar, etc.) to add a new feature. Push onto `App.hooks.armyToolbarActions`, `App.hooks.detailActions`, `App.hooks.bootstrap`, `App.hooks.armyChange`, `App.hooks.selectionChange`, `App.hooks.rosterFilters`, or `App.hooks.cardClassContributors` from your new module's IIFE. See `js/app/hooks.js`.
- **Toolbar regions**: `primary` (Tools menu by default), `icon` (top-bar icon shelf or More menu), `tools-menu`, `more-menu`, `export-menu`. See `js/app/index.js` for the routing rules.
- **Lazy loading**: heavy feature modules can be deferred via `js/app/lazy-modules.js` placeholders. The placeholder registers a stub action; on first click it injects the real script(s) and rewires the in-DOM button. Currently ALL feature modules are also eager-loaded from `index.html`, so lazy-modules.js is an opt-in path that is not yet wired into the page.
- Script load order in `index.html` — see `docs/ARCHITECTURE.md`. Within a folder, hooks resolve lazily by name so leaf order is mostly defensive.

## Storage

Every persistence key in the app. Wipe carefully — most contain user data.

| Key | Store | Module | Purpose | Invalidation |
|---|---|---|---|---|
| `yaab` DB / `factions` | IndexedDB | `js/db.js` | Parsed faction objects | Bump `DB_VERSION` in `db.js` (drops all stores in `onupgradeneeded`) |
| `yaab` DB / `gst` | IndexedDB | `js/db.js` | Raw `.gst` + `Library *.cat` XML | Same |
| `yaab_bsdata_filelist_10e_v1` | sessionStorage | `bsdata.js` | GitHub tree listing | Bump suffix on tree-format changes |
| `yaab_armies` | localStorage | `army.js` | Saved armies (Array of `Army.toJSON()`) | User data — never invalidate silently |
| `yaab_factions` | localStorage | `storage.js` | Legacy; unused by active path | Kept for back-compat |
| `yaab_recent_factions` | localStorage | `hero-state.js` | Recently-selected factions chip | User data |
| `yaab_favorites` | localStorage | `favorites.js` | Starred unit ids | User data |
| `yaab_recents` | localStorage | `favorites.js` | Recently-viewed unit ids | User data |
| `yaab_collection` | localStorage | `collection.js` | Per-unit owned/painted status | User data |
| `yaab_crusade_rosters` | localStorage | `crusade.js` | Crusade rosters + XP + battle log | User data |
| `yaab_match_state` | localStorage | `match-mode.js`, `stratagems.js` | Active match (CP, turn, VP) | Game-day state |
| `yaab_opponent` | localStorage | `opponent.js` | Last-pasted opponent army | User data |
| `yaab_army_snapshots` | localStorage | `army-diff.js` | Labeled save snapshots (max 20/army) | User data |
| `yaab_activity_log` | localStorage | `activity-log.js` | Per-day event log (30-day retention) | Auto-prunes |
| `yaab_deployments` | localStorage | `deployment-planner.js` | Per-army deployment maps | User data |
| `yaab_tournament_cfg` | localStorage | `tournament-export.js` | Tournament PDF preferences | User data |
| `yaab_points_overrides` | localStorage | `points-override.js` | Dataslate-style point edits | User data |
| `yaab_kt_mode` | localStorage | `kill-team.js` | Kill Team mode flag | User pref |
| `yaab_show_legends` | localStorage | `legends-toggle.js` | Show [Legends] units | User pref |
| `yaab_ork_math` | localStorage | `ork-math.js` | Teef-math toggle | User pref |
| `yaab_pwa_dismissed` | localStorage | `pwa-install.js` | Install banner dismissal | User pref |
| `yaab_mobile_panel` | localStorage | `pwa-install.js` | Last-active mobile tab | User pref |
| `yaab_tour_seen` | localStorage | `first-time-tour.js` | First-run tour completed | One-shot |
| `yaab_sound_enabled` | localStorage | `sound-fx.js` (orphan) | Opt-in WebAudio toggle | User pref |
| `yaab_voice_enabled` | localStorage | `voice-commands.js` (orphan) | Opt-in voice-control toggle | User pref |
| `yaab_parse_debug` | localStorage | `parser/report.js` | Parse-coverage console logging | Dev flag |
| `yaab-shell-v17` | Cache API | `sw.js` | Service worker app shell | Bump `SHELL` in `sw.js` when any precached asset changes |

## SW versioning

- Current shell version: `yaab-shell-v17` (`sw.js` line 2).
- **Bump `SHELL` whenever**: you add/remove a file in `PRECACHE`, change a file's URL, or ship breaking parser/storage changes that would mismatch with stale-cached JS.
- The activate handler clears any `yaab-shell-v*` cache that doesn't match the current `SHELL`, so old versions self-evict.

## Editing guidance

1. **Find the right file FIRST. Don't grep blindly.** The file map above is intentionally exhaustive. If you can't tell where a feature lives from the table, scan `js/app/` and `js/ui/` filenames first — every module is named after what it does.
2. **Hook-first.** Adding a new feature should never require touching `events.js`, `detail.js`, `index.html` toolbar markup, or any other shared file. Create a new file under `js/app/` or `js/ui/`, register via `App.hooks.*`, append the script tag to `index.html`, and add it to `sw.js` PRECACHE. See `docs/UI.md` "How to add X".
3. **Don't introduce a bundler, framework, or TypeScript.** Vanilla JS, IIFE, namespace globals. That's the deal.
4. **Don't change `WahapediaParser.parse()` output shape** without bumping `DB_VERSION` in `js/db.js` AND clearing the IndexedDB stores in `onupgradeneeded`. Stale cached JSON will silently misrender.
5. **When adding precached assets**, add to `sw.js` PRECACHE AND bump `SHELL`.
6. **Don't break the namespaces** (`window.App`, `window.UI`, `window.Storage`, `window.Army`, `window.ArmyManager`, `window.BSData`, `window.WahapediaParser`, `window.YaabDB`, `App.hooks`). External tabs reload through them.

## Don't break

- `WahapediaParser.parse()` output shape (see `docs/PARSER.md`). Bump `DB_VERSION` if you must.
- `App.hooks.*` action shapes. New feature modules consume them.
- `Army.toJSON()` / `Army.fromJSON()`. Saved armies must keep deserializing.
- `YAAB1:` v2 export format (`storage.js`). Bookmarked share URLs depend on it.
- The hook iteration in `App.fireBootstrap` / `fireArmyChange` / `fireSelectionChange` — they wrap each call in try/catch, so one broken module shouldn't break others. Keep that pattern.
- `releaseSharedIndex()` is called once in `bsdata.js` after Phase 2. Don't hold DOM refs alive past that point — it leaks tens of MB.
