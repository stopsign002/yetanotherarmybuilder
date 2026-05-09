# CLAUDE.md

## What this is

A client-only static site (no build step) that fetches BattleScribe 10th-edition XML from a same-origin mirror at `data/bsdata/` (kept fresh by a 6-hourly GitHub Actions cron that pulls `BSData/wh40k-10e`), falls back to `raw.githubusercontent.com` if the mirror is missing, parses the XML in-browser with `DOMParser`, and lets a user build, share, and play 40k armies. Persists user data in `localStorage` and parsed faction data in IndexedDB. Optional username/password account with offline-first cloud sync of armies + a small KV bag (favorites, collection, crusade rosters, etc.) via the sibling `api/` backend.

## Running it

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Cannot be opened via `file://` — the BSData fetch requires http(s).

## File map

| Path | Purpose |
|---|---|
| `index.html` | Single-page shell. Hardcoded `<script>` order matters. Holds the topbar + 3-pane layout + modal mounts. |
| `css/*.css` | One file per feature surface. `style.css` is the base; everything else is additive. |
| `css/auth.css` | Auth UI styling (sign-in button, dropdown, auth modal). |
| `sw.js` | Kill-switch for the retired app-shell service worker. Self-unregisters and clears legacy `yaab-shell-v*` caches. New visits don't register a SW. |
| `manifest.json` | PWA manifest (installable). |
| `js/db.js` | `YaabDB` IndexedDB wrapper: `factions` + `gst` stores. |
| `js/bsdata.js` | Fetches BattleScribe XML — prefers the same-origin mirror at `data/bsdata/`, falls back to `raw.githubusercontent.com` if the mirror is missing. 6-worker bulk loader. Caches parsed factions in `YaabDB`. |
| `data/bsdata/` | Server-side mirror of `BSData/wh40k-10e`. `index.json` lists the files (with source commit + per-blob SHA); `files/<original/path>.xml` holds each `.cat` / `.gst` payload. Generated; do not hand-edit. |
| `scripts/mirror-bsdata.mjs` | Cron-driven Node 20 script that diffs against `BSData/wh40k-10e` by blob SHA and downloads only changed files into `data/bsdata/`. No deps. |
| `.github/workflows/mirror-bsdata.yml` | Runs `scripts/mirror-bsdata.mjs` every 6h (and on manual dispatch); commits any changes back to the branch. |
| `js/parser/` | BattleScribe XML → plain-object units. See `docs/PARSER.md`. |
| `js/storage.js` | `localStorage` armies + compact `YAAB1:` deflate-base64url export/import. |
| `js/army.js` | `Army` + `ArmyManager` data model. |
| `js/app/auth.js` | `App.Auth`: session state + auth API client. (See `docs/AUTH.md`.) |
| `js/app/sync.js` | `App.Sync`: offline-first cloud sync. (See `docs/SYNC.md`.) |
| `js/ui/auth-modal.js` | `UI.showAuthModal(mode)` for login/register/recover/change-password. |
| `js/ui/auth-button.js` | Top-bar Sign-in / username button + dropdown menu (Sync now, Change password, Sign out). |
| `js/data/` | Static JSON-ish data: lore, stratagems, community feed. |
| `js/ui/` | DOM-rendering modules. Each attaches to `window.UI`. See `docs/UI.md`. |
| `js/app/` | Bootstrap, state, events, and feature modules. Each attaches to `window.App`. See `docs/UI.md` and `docs/MODULE-REFERENCE.md`. |
| `js/vendor/` | `html2pdf.bundle.min.js`, `qrcode.min.js`, `fonts/cinzel-{400,600}.woff2`. |
| `docs/` | Architecture / parser / UI reference + per-module deep dive. Read `docs/MODULE-REFERENCE.md` first for an exhaustive per-file index. |

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
| Build | Comparator points filter in search bar (`<=200`, `>=100`, `=150`) | `js/app/points-filter.js` |
| Build | Auto-save current army on every mutation (debounced) | `js/app/autosave.js` |
| Build | Persist `<details>` open/closed state across reloads | `js/app/details-persist.js` |
| Modes | Build / Collect / Play container switcher (top-level mode shell) | `js/app/mode-shell.js` |
| Modes | Build mode page (hero + rules pinboard tab + roster polish) | `js/ui/build-mode.js` |
| Modes | Collect mode page (Painting / Crusade / Kill Team sub-tabs) | `js/ui/collect-mode.js` |
| Modes | Play mode cockpit (5 sub-tabs + quick stratagems drawer) | `js/ui/play-mode.js` |
| Account & sync | Username/password auth | `js/app/auth.js`, `js/ui/auth-modal.js` |
| Account & sync | Top-bar account button | `js/ui/auth-button.js` |
| Account & sync | Cloud sync of armies + KV bag | `js/app/sync.js` |
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
| Browse | First-time guided tour (retired; `js/app/first-time-tour.js` is a no-op stub — `App.replayTour` and `App.startTour` are empty so callers in `settings-drawer.js` don't crash. The Settings drawer "Replay onboarding tour" entry is still present but does nothing.) | `js/app/first-time-tour.js` |
| Collection | Owned/painted tracker (per unit) | `js/app/collection.js` |
| Polish | Confetti / save pulse / scanline / animated crest | `js/ui/celebrations.js`, `js/ui/save-pulse.js`, `js/ui/scanline.js`, `js/ui/animated-crest.js` |
| Polish | Faction flavor quotes on empty army | `js/app/flavor.js` |
| Polish | Hero CTA + Cmd+K hint + recent factions chip | `js/app/hero-state.js` |
| Polish | Ork "teef" math (faction-themed point display) | `js/app/ork-math.js` |
| Polish | Legends-units toggle | `js/app/legends-toggle.js` |
| Polish | PWA install prompt + mobile tab bar | `js/app/pwa-install.js` |
| Polish | Bug-report modal (server-backed, signed-in users post to `/api/bugs`; admin Reports tab marks fixed) | `js/app/bug-report.js` |
| Polish | "What's new" updates modal — versioned, dated, user-facing changelog. **All shippable changes must add an entry to `js/data/changelog-data.js`.** | `js/app/changelog.js`, `js/data/changelog-data.js` |
| Polish | Top app bar (chip mirror, ⌘K, Action Center) | `js/app/topbar.js`, `js/ui/action-center.js` |
| Polish | Top-bar Export dropdown (mirrors panel-footer Export menu) | `js/ui/topbar-export.js` |
| Polish | Settings drawer (sound, motion, badges, replay tour, sign-out) | `js/app/settings-drawer.js` |
| Polish | Mobile chrome (sticky points pill, dynamic title, back arrow) | `js/app/mobile-shell.js` |
| Polish | Faction-themed audio stingers + particle bursts | `js/app/faction-fx.js` |
| Polish | FLIP-style add-to-army flight ghost + drag-to-reorder | `js/ui/flip-animations.js` |
| Polish | Original geometric faction glyphs (inline SVG) | `js/ui/faction-glyphs.js` |
| Polish | Role icon prefix on unit cards (Character / Vehicle / Monster …) | `js/ui/role-icons.js` |
| Polish | Per-faction unit-card gradients (`faction-<slug>` class contributor) | `js/ui/unit-card-themes.js` |
| Polish | Click pane header to expand it full-width (Army / Units / Details) — animated, with per-pane layout pass | `js/app/expand-pane.js`, `css/expand-pane.css` |

## Module conventions

- No build step. No `import`/`export`. Plain `<script src>` in `index.html`. Each file is an IIFE that attaches to `window.WahapediaParser`, `window.UI`, `window.App`, `window.YaabDB`, or one of the legacy globals (`Storage`, `Army`, `ArmyManager`, `BSData`).
- **Hook-first architecture**. Feature modules MUST register via `App.hooks` — do NOT edit shared files (`events.js`, `detail.js`, `index.html` toolbar, etc.) to add a new feature. Push onto `App.hooks.armyToolbarActions`, `App.hooks.detailActions`, `App.hooks.bootstrap`, `App.hooks.armyChange`, `App.hooks.selectionChange`, `App.hooks.rosterFilters`, `App.hooks.cardClassContributors`, or `App.hooks.modeChange` from your new module's IIFE. See `js/app/hooks.js`.
- **Toolbar regions**: `primary` (Tools menu by default), `icon` (top-bar icon shelf or More menu), `tools-menu`, `more-menu`, `export-menu`. See `js/app/index.js` for the routing rules.
- **Lazy loading**: heavy feature modules can be deferred via `js/app/lazy-modules.js` placeholders. The placeholder registers a stub action; on first click it injects the real script(s) and rewires the in-DOM button. Currently ALL feature modules are also eager-loaded from `index.html`, so lazy-modules.js is an opt-in path that is not yet wired into the page.
- Script load order in `index.html` — see `docs/ARCHITECTURE.md`. Within a folder, hooks resolve lazily by name so leaf order is mostly defensive.

## Storage

Every persistence key in the app. Wipe carefully — most contain user data.

| Key | Store | Module | Purpose | Invalidation |
|---|---|---|---|---|
| `yaab` DB / `factions` | IndexedDB | `js/db.js` | Parsed faction objects | Bump `DB_VERSION` in `db.js` (drops all stores in `onupgradeneeded`) |
| `yaab` DB / `gst` | IndexedDB | `js/db.js` | Raw `.gst` + `Library *.cat` XML | Same |
| `yaab_bsdata_filelist_10e_v2` | sessionStorage | `bsdata.js` | File listing (source: `'mirror'` or `'github'` + array of files) | Bump suffix on cache-shape changes |
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
| `yaab_auth_session_hint` | localStorage | `auth.js` | Cosmetic `{username}` hint so the topbar can render "signed in" instantly on reload (cookie is source of truth) | Cleared on sign-out |
| `yaab_sync_queue` | localStorage | `sync.js` | FIFO of pending `{op, id?, ts, mutationId}` sync operations; coalesced on enqueue | Drained as ops succeed |
| `yaab_sync_known` | localStorage | `sync.js` | `{ armyId -> updated_at }` last seen on the server; drives LWW push/pull decisions | Cleared on sign-out |
| `yaab_sync_state_at` | localStorage | `sync.js` | Last successful state-bag (KV) push timestamp | Cleared on sign-out |
| `yaab_mode` | localStorage | `mode-shell.js` | Active top-level mode (`'build'` / `'collect'` / `'play'`) | User pref |
| `yaab_play_tab` | localStorage | `play-mode.js` | Active Play-mode sub-tab (`match` / `stratagems` / `calc` / `opponent` / `deploy`) | User pref |
| `yaab_details_state` | localStorage | `details-persist.js` | Open/closed state of `<details>` boxes (army setup, army rules) | User pref |
| `yaab_reduced_motion` | localStorage | `settings-drawer.js` | App-level reduced-motion override (in addition to OS pref) | User pref |
| `yaab_show_collection_badges` | localStorage | `collection.js`, `settings-drawer.js` | Toggle for the painted-status badges on unit cards | User pref |
| `yaab_collect_debug` | localStorage | `collect-mode.js` | Dev flag for verbose Collect-mode logging | Dev flag |
| `yaab_changelog_seen` | localStorage | `changelog.js` | Last `App.CHANGELOG.version` the user has opened — drives the "unseen" red dot on the Updates icon | User pref |

The kill-switch in `sw.js` self-unregisters and clears any legacy `yaab-shell-v*` caches; no Cache API entries are maintained anymore.

## Service worker (retired)

The app-shell service worker has been retired. Existing installs are migrated by the kill-switch in `sw.js`: it deletes legacy `yaab-shell-v*` caches, unregisters itself, and navigates open clients so the next page load is SW-free. New visits don't register a SW. `js/app/sw-register.js` is a defensive helper that proactively unregisters anything still registered. Code updates ship live with the next reload — no SHELL bumping required.

## Quick-reference for navigation

Common questions and where to look first.

| Question | Look here first |
|---|---|
| "Where is feature X?" | This file's "Major features" table — every feature row has the module path. If still unclear, `docs/MODULE-REFERENCE.md` has per-module exports + dependencies. |
| "What hook should my new feature use?" | `docs/ARCHITECTURE.md` "Hook system" table. Cheat: `armyToolbarActions` for buttons, `armyChange` for "react when army mutates", `bootstrap` for late init, `rosterFilters` for "hide some units", `cardClassContributors` for "tag units with a CSS class". |
| "What localStorage / IDB key does X own?" | The Storage table further down in this file (every key is listed). |
| "Where do I add a top-bar icon?" | `docs/UI.md` "How to add X" → "Add a new toolbar action (inline)" or `App.hooks.armyToolbarActions.push({ region: 'icon', ... })`. The whitelist for which icons stay inline (vs. fall into More ▾) is `ICON_VISIBLE_IDS` in `js/app/index.js`. |
| "How do I expose a new API route?" | `../api/CLAUDE.md` (sibling repo). Endpoints under `/api/*` are contract — paths and shapes are versioned. |
| "Why isn't my new feature showing up?" | (1) Did you add the `<script>` tag to `index.html`? (2) Did the IIFE bail early (look for early returns guarding `App.hooks` or DOM nodes)? (3) Hard-refresh: Ctrl+Shift+R / ⌘⇧R — static-site caches stick. |
| "Why does X re-render twice?" | `armyChange` fires on every mutation. If your renderer is also called by a button handler, the hook will refire it. Either gate the renderer with a "kind" check or use `selectionChange` instead. |
| "Why is my parser change not visible?" | You forgot to bump `DB_VERSION` in `js/db.js`. Cached factions are served from IndexedDB; the new field is parsed correctly but never makes it into the DOM until the cache is dropped (which `onupgradeneeded` does on a version bump). |
| "How do I make my module aware of mode (Build / Collect / Play)?" | `App.hooks.modeChange.push((newMode, prevMode) => { ... })`. Mode is also reflected as `body[data-mode]` for CSS. |
| "Where do I add a changelog entry?" | `js/data/changelog-data.js`. Bump `version` + `lastUpdated`. EVERY user-visible change must add one (see editing guidance #6 below). |

## Editing guidance

1. **Find the right file FIRST. Don't grep blindly.** The file map above is intentionally exhaustive. If you can't tell where a feature lives from the table, scan `js/app/` and `js/ui/` filenames first — every module is named after what it does.
2. **Hook-first.** Adding a new feature should never require touching `events.js`, `detail.js`, `index.html` toolbar markup, or any other shared file. Create a new file under `js/app/` or `js/ui/`, register via `App.hooks.*`, and append the script tag to `index.html`. See `docs/UI.md` "How to add X".
3. **Don't introduce a bundler, framework, or TypeScript.** Vanilla JS, IIFE, namespace globals. That's the deal.
4. **Don't change `WahapediaParser.parse()` output shape** without bumping `DB_VERSION` in `js/db.js` AND clearing the IndexedDB stores in `onupgradeneeded`. Stale cached JSON will silently misrender.
5. **Don't break the namespaces** (`window.App`, `window.UI`, `window.Storage`, `window.Army`, `window.ArmyManager`, `window.BSData`, `window.WahapediaParser`, `window.YaabDB`, `App.hooks`). External tabs reload through them.
6. **Update the user-facing changelog on every shippable change.** Any new feature, visible bug fix, or data correction the user can notice MUST add an entry to `js/data/changelog-data.js` (and bump `version` + `lastUpdated`). The "What's new" button in the topbar (`js/app/changelog.js`) is the only place users see release notes — if it's missing from there, it didn't happen as far as they know. Skip entries only for pure refactors, internal-only behaviour, doc edits, and CI plumbing. See the comment at the top of `changelog-data.js` for the entry shape and the `feature` / `fix` / `change` `kind` values.

## Don't break

- `WahapediaParser.parse()` output shape (see `docs/PARSER.md`). Bump `DB_VERSION` if you must.
- `App.hooks.*` action shapes. New feature modules consume them.
- `Army.toJSON()` / `Army.fromJSON()`. Saved armies must keep deserializing.
- `Army.toJSON()` keys must include `createdAt` and `updatedAt`, and the constructor must accept them. Every `fromJSON` path that drops the timestamps breaks cross-device sync (every load looks "newer" than cloud → uploads stale → clobbers other devices).
- API endpoint paths under `/api/*` and their request/response shapes are contract — see `../api/CLAUDE.md`.
- `YAAB1:` v2 export format (`storage.js`). Bookmarked share URLs depend on it.
- The hook iteration in `App.fireBootstrap` / `fireArmyChange` / `fireSelectionChange` — they wrap each call in try/catch, so one broken module shouldn't break others. Keep that pattern.
- `releaseSharedIndex()` is called once in `bsdata.js` after Phase 2. Don't hold DOM refs alive past that point — it leaks tens of MB.
