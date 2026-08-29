# CLAUDE.md

## What this is

A client-only static site that sources Warhammer 40k **11th-edition** data from the community **40kdc dataset** (`wn-mitch/40kdc-data`) and lets a user build, share, and play 40k armies. The dataset is built offline into a single committed browser bundle, `js/vendor/dc-bundle.js`, which exposes a global `window.DC` (collections: units, factions, weapons, detachments, stratagems, enhancements, abilities, plus an embedded `abilityText` store). `js/data/dc-adapter.js` maps `window.DC` into the exact parser output shape the old BattleScribe parser emitted (see `docs/PARSER.md`) and **overrides `window.BSData`** at load — so every downstream renderer keeps working unchanged. 40kdc ships no rules prose, so `js/gdc.js` runs as a hybrid fallback for stratagem/unit text, served from the committed `data/gdc/` snapshot (a bundled ability-text store covers ~98% of unit abilities; the server-only `js/vendor/dc-prose.js` overlay takes it to 100%). Persists user data in `localStorage`. Optional username/password account with offline-first cloud sync of armies + a small KV bag (favorites, collection, crusade rosters, etc.) via the sibling `api/` backend.

The **app's own JavaScript is still buildless** (plain `<script src>`, IIFEs, namespace globals, no framework/bundler/TS). The single exception is the offline data-bundle build under `build/` (esbuild → `js/vendor/dc-bundle.js`); its output is just a static `.js` asset loaded like any other. See `build/README.md`. The bundle is auto-refreshed + frozen, not live-fetched: `window.DC` data is embedded (no runtime network calls for game data at all — the GDC prose/weapon source is a committed snapshot under `data/gdc/`, refreshed by the same cron; it was fetched live from GitHub until 2026-07-28), and a server cron (`~/sites/base/refresh-40kdc.sh`) rebuilds + redeploys it daily at 04:45 (it was weekly on Fridays between the 2026-07-01 cutover and 2026-07-28), validating against the live adapter before deploying. Do NOT hand-edit `js/vendor/dc-bundle.js` or `build/abilities-index.json` — they're generated.

## Running it

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Cannot be opened via `file://` — the GDC fallback fetch requires http(s).

**No automated test suite.** Verify changes by exercising the running site. The
only Node tooling is: `node scripts/stamp-assets.mjs` (cache-bust stamper; `--check`
in CI fails on a stale stamp — see "HTTP caching" below), and the analysis reports
`scripts/parser-coverage.mjs` + `scripts/gap-report.mjs` (data-coverage diagnostics,
not tests). The app itself needs no `npm install` — vendored deps are committed.

## File map

| Path | Purpose |
|---|---|
| `index.html` | Single-page shell. Hardcoded `<script>` order matters. Holds the topbar + 3-pane layout + modal mounts. |
| `css/*.css` | One file per feature surface. `style.css` is the base; everything else is additive. |
| `css/themes/*.css` | **Interchangeable themes.** Never linked from `index.html` — `js/theme-boot.js` appends the chosen one at parse time, so the default theme loads none of it. See "Themes" below. |
| `js/theme-boot.js` | **The only non-`defer` script.** Sits last in `<head>`; reads `yaab_theme` and applies the theme before first paint. Owns the theme registry (`window.YAAB_THEMES`). |
| `css/auth.css` | Auth UI styling (sign-in button, dropdown, auth modal). |
| `sw.js` | **App-shell service worker.** Network-first navigations, stale-while-revalidate assets, `/api` + `/data` never touched. Its four rules and the rollback are in the "Service worker" section below. `sw-kill.js` is the emergency kill switch. |
| `manifest.json` | PWA manifest (installable). |
| `js/db.js` | `YaabDB` IndexedDB wrapper: `factions` + `gst` + `gdc` + `cardBackImages` stores. (The adapter does NOT cache factions here — they're rebuilt from `window.DC` each load.) |
| `js/vendor/dc-bundle.js` | **Generated.** Embedded 40kdc 11e dataset + ability-text store, exposed as `window.DC`. Built offline by `build/`. Do not hand-edit. |
| `js/data/dc-adapter.js` | **Live data source.** Maps `window.DC` into the parser output shape, overrides `window.BSData.loadAllFactions`, runs the GDC overlay + `reconcileStrats()`, and adds 11e two-dimensional points (`parsePoints` → `squadOptions` / `pointsOptions` / `unit.ordinal`). Stubs `WahapediaParser._internal.foldKey`. |
| `build/` | The ONE build step: esbuild (`dc-entry.mjs` + `abilities-index.json`) → `js/vendor/dc-bundle.js`. See `build/README.md`. |
| `js/bsdata.js` | **DORMANT — kept for rollback, overridden at runtime by `dc-adapter.js`.** Old BattleScribe XML fetcher (mirror-first, GitHub-raw fallback, 6-worker loader). Loads but never runs. |
| `data/bsdata/` | **DORMANT — kept for rollback.** Server-side mirror of `BSData/wh40k-10e`. Still updated by the mirror Action but unread at runtime. |
| `scripts/mirror-bsdata.mjs` | **DORMANT — kept for rollback.** Cron-driven Node 20 script that diffs `BSData/wh40k-10e` by blob SHA into `data/bsdata/`. No deps. |
| `.github/workflows/mirror-bsdata.yml` | **DORMANT — kept for rollback.** Runs `scripts/mirror-bsdata.mjs` every 6h; updates an unread mirror. |
| `js/parser/` | **DORMANT — kept for rollback, overridden at runtime by `dc-adapter.js`.** BattleScribe XML → plain-object units. Its `WahapediaParser.parse()` output shape is now the contract `dc-adapter.js` emits. See `docs/PARSER.md`. |
| `js/storage.js` | `localStorage` armies + compact `YAAB1:` deflate-base64url export/import. |
| `js/army.js` | `Army` + `ArmyManager` data model. |
| `js/app/auth.js` | `App.Auth`: session state + auth API client. (See `docs/AUTH.md`.) |
| `js/app/sync.js` | `App.Sync`: offline-first cloud sync. (See `docs/SYNC.md`.) |
| `js/ui/auth-modal.js` | `UI.showAuthModal(mode)` for login/register/recover/change-password. |
| `js/ui/auth-button.js` | Top-bar Sign-in / username button + dropdown menu (Sync now, Change password, Sign out). |
| `js/ui/cards-mode.js` | Cards: full-page printable data-card designer (owns `#cards-mode` + `css/cards-mode.css`). Settings rail, named presets (cloud-synced), per-card page-split. |
| `js/app/admin.js` | Site-operator admin panel (admins only). Approve/revoke users, browse+resolve bug reports, moderate card-back images. Client for `/api/admin/*`; contract in `docs/ADMIN_API.md`. |
| `js/app/id-migration.js` | One-time per-device shim: migrates stale reserve/requisition unit-ids from dormant BSData GUIDs to 40kdc slug ids. |
| `js/app/entry-rehydrate.js` | Refreshes army entries' embedded `unitData` snapshots against current `window.DC` (add-time copies go stale across data refreshes). |
| `js/data/` | Static JSON-ish data: lore, stratagems, community feed. |
| `js/ui/` | DOM-rendering modules. Each attaches to `window.UI`. See `docs/UI.md`. |
| `js/app/` | Bootstrap, state, events, and feature modules. Each attaches to `window.App`. See `docs/UI.md` and `docs/MODULE-REFERENCE.md`. |
| `fonts/` | Faces a THEME needs, as opposed to the app's own. Today just `Archivo-100-900.woff2` (variable 100-900, latin subset, 34KB), loaded by an `@font-face` inside `css/themes/brutalist.css` and therefore fetched only by users on a brutalist theme. Same file ledger and Tandem use for the same look. `font-src` is `'self'`, so it is served from here rather than Google. |
| `js/vendor/` | `html2pdf.bundle.min.js`, `qrcode.min.js`, `fonts/cinzel-{400,600}.woff2`, `fonts/ebgaramond{,-italic}.woff2` (EB Garamond — variable roman + italic, latin subset; body serif for the cards-mode "Industrial Stencil" template). |
| `docs/` | Architecture / parser / UI reference + per-module deep dive. Read `docs/MODULE-REFERENCE.md` first for an exhaustive per-file index. |

## Major features

Grouped by user intent. One module per row; module path is the search target.

| Group | Feature | Module |
|---|---|---|
| Build | Faction → chapter → detachment selection | `js/app/selections.js`, `js/ui/faction-filter.js` |
| Build | Capped-render unit roster (search, role chips, fuzzy match) | `js/ui/roster.js` |
| Build | Unit detail panel (stats, weapons, abilities, Led By, enhancements) | `js/ui/detail.js` |
| Build | Detachment multi-select picker (replaced the single-select dropdown) | `js/app/detachment-picker.js` |
| Build | Wargear picker (structured 11e options, under Add-to-Army) | `js/app/wargear-picker.js` |
| Build | Leader/bodyguard attachment ("Led By") logic | `js/app/attachments.js` |
| Build | Space Marine chapter roster delineation (11e generic-vs-chapter split) | `js/app/sm-chapter-filter.js` |
| Build | Army Rules + Detachment Rule + Enhancements + Stratagems panel | `js/ui/faction-rules.js` |
| Build | Composition validation (Rule of Three, no warlord) | `js/app/validation.js` |
| Build | King of the Coliseum format box (600pt rules + live list checks) | `js/app/kotc.js` |
| Build | Split a stacked army entry (`count > 1`) into separate units, so each can take its own Leader | `js/app/split-entry.js`, `js/ui/army-list.js` |
| Build | Undo / redo (50-snapshot stack, Cmd/Ctrl+Z) | `js/app/history.js` |
| Build | Favorites (star units) + Recents chip row | `js/app/favorites.js` |
| Build | Auto-suggest army nickname from faction | `js/app/nickname.js` |
| Build | Cmd/Ctrl+K command palette + `?` keyboard help | `js/app/command-palette.js` |
| Build | Comparator points filter in search bar (`<=200`, `>=100`, `=150`) | `js/app/points-filter.js` |
| Build | Auto-save current army on every mutation (debounced) | `js/app/autosave.js` |
| Build | Persist `<details>` open/closed state across reloads | `js/app/details-persist.js` |
| Modes | Build / Collect / Play container switcher (top-level mode shell) | `js/app/mode-shell.js` |
| Modes | Build mode page (hero + rules pinboard tab + roster polish) | `js/ui/build-mode.js` |
| Modes | Collect mode page (Painting) | `js/ui/collect-mode.js` |
| Account & sync | Username/password auth | `js/app/auth.js`, `js/ui/auth-modal.js` |
| Account & sync | Top-bar account button | `js/ui/auth-button.js` |
| Account & sync | Cloud sync of armies + KV bag | `js/app/sync.js` |
| Account & sync | Admin panel (approve/revoke users, bug reports, image moderation) | `js/app/admin.js` |
| Account & sync | Admin-only pending-approval banner | `js/app/pending-approval-banner.js` |
| Print & Export | Cards mode — printable data-card designer (templates, presets, page-split) | `js/ui/cards-mode.js`, `css/cards-mode.css` |
| Print & Export | URL-shareable armies (`?a=YAAB1:...`) | `js/app/url-share.js` |
| Print & Export | QR share (mobile-to-mobile) | `js/app/qr-share.js` |
| Print & Export | YAAB1 string export/import (compact deflate) | `js/storage.js` |
| Collection | Owned/painted tracker (per unit) | `js/app/collection.js` |
| Collection | Reserves: owned-units stockpile w/ quantity, default unit-pane view | `js/app/reserves.js` |
| Collection | Requisition Requests: wishlist of units w/ quantity | `js/app/requisitions.js` |
| Collection | Custom character/unit names (Reserves instances + per-army-entry names) | `js/app/custom-names.js` |
| Polish | Confetti / save pulse / scanline / animated crest | `js/ui/celebrations.js`, `js/ui/save-pulse.js`, `js/ui/scanline.js`, `js/ui/animated-crest.js` |
| Polish | Faction flavor quotes on empty army | `js/app/flavor.js` |
| Polish | Hero CTA + Cmd+K hint + recent factions chip | `js/app/hero-state.js` |
| Polish | Legends-units toggle | `js/app/legends-toggle.js` |
| Build | Allied units on the host faction's roster (Daemonic Pact, Imperial Agents, …) | `js/data/dc-adapter.js` (`attachAlliedUnits`), `js/app/allies.js` |
| Polish | PWA install prompt + mobile tab bar | `js/app/pwa-install.js` |
| Polish | App-shell service worker (installable + offline) | `sw.js`, `js/app/sw-register.js` |
| Polish | Bug-report modal (server-backed, signed-in users post to `/api/bugs`; admin Reports tab marks fixed) | `js/app/bug-report.js` |
| Polish | "What's new" updates modal — versioned, dated, user-facing changelog. **All shippable changes must add an entry to `js/data/changelog-data.js`.** | `js/app/changelog.js`, `js/data/changelog-data.js` |
| Polish | Top-bar Export dropdown (mirrors panel-footer Export menu) | `js/ui/topbar-export.js` |
| Polish | Settings drawer (sound, motion, badges, replay tour, sign-out) | `js/app/settings-drawer.js` |
| Polish | Interchangeable themes (Appearance picker in the Settings drawer) | `js/theme-boot.js`, `js/app/themes.js`, `css/themes/` |
| Polish | Mobile chrome (sticky points pill, dynamic title, back arrow) | `js/app/mobile-shell.js` |
| Polish | Faction-themed audio stingers + particle bursts | `js/app/faction-fx.js` |
| Polish | FLIP-style add-to-army flight ghost + drag-to-reorder | `js/ui/flip-animations.js` |
| Polish | Original geometric faction glyphs (inline SVG) | `js/ui/faction-glyphs.js` |
| Polish | Role icon prefix on unit cards (Character / Vehicle / Monster …) | `js/ui/role-icons.js` |
| Polish | Per-faction unit-card gradients (`faction-<slug>` class contributor) | `js/ui/unit-card-themes.js` |
| Polish | Click pane header to expand it full-width (Army / Units / Details) — animated, with per-pane layout pass | `js/app/expand-pane.js`, `css/expand-pane.css` |

> **Keeping the docs honest:** `docs/MODULE-REFERENCE.md` has a `###` entry per JS
> module (data files under `js/data/` and vendored `*.min.js` are intentionally
> excluded). When you add a new module, add its entry there too — and if you delete
> or rename one, remove/rename the entry (a heading pointing at a nonexistent file
> is the drift to avoid).

## Module conventions

- No build step for APP code. No `import`/`export`. Plain `<script src>` in `index.html`. Each file is an IIFE that attaches to `window.WahapediaParser`, `window.UI`, `window.App`, `window.YaabDB`, or one of the legacy globals (`Storage`, `Army`, `ArmyManager`, `BSData`). The ONE exception is the offline data-bundle build under `build/` (esbuild → `js/vendor/dc-bundle.js`); its output is a static `.js` loaded like any other asset. Don't introduce a bundler/framework/TypeScript for the app itself.
- **Hook-first architecture**. Feature modules MUST register via `App.hooks` — do NOT edit shared files (`events.js`, `detail.js`, `index.html` toolbar, etc.) to add a new feature. Push onto `App.hooks.armyToolbarActions`, `App.hooks.detailActions`, `App.hooks.bootstrap`, `App.hooks.armyChange`, `App.hooks.selectionChange`, `App.hooks.rosterFilters`, `App.hooks.cardClassContributors`, `App.hooks.armyEntryActions` (icon buttons on an army-list row), or `App.hooks.modeChange` from your new module's IIFE. See `js/app/hooks.js`.
- **Toolbar regions**: `primary` (Tools menu by default), `icon` (top-bar icon shelf or More menu), `tools-menu`, `more-menu`, `export-menu`. See `js/app/index.js` for the routing rules.
- **Lazy loading**: heavy feature modules can be deferred via `js/app/lazy-modules.js` placeholders. The placeholder registers a stub action; on first click it injects the real script(s) and rewires the in-DOM button. Currently ALL feature modules are also eager-loaded from `index.html`, so lazy-modules.js is an opt-in path that is not yet wired into the page.
- Script load order in `index.html` — see `docs/ARCHITECTURE.md`. Within a folder, hooks resolve lazily by name so leaf order is mostly defensive.

## Storage

Every persistence key in the app. Wipe carefully — most contain user data.

| Key | Store | Module | Purpose | Invalidation |
|---|---|---|---|---|
| `yaab` DB / `factions` | IndexedDB | `js/db.js` | Parsed faction objects | **No longer written by the active path** — `dc-adapter.js` rebuilds factions from `window.DC` every load (no faction cache to invalidate). `DB_VERSION` is `37` (the 11e cutover bumped it once to drop the stale 10e cache). |
| `yaab` DB / `gst` | IndexedDB | `js/db.js` | (Dormant) raw `.gst` + `Library *.cat` XML — only `bsdata.js` wrote this | Dropped on a `DB_VERSION` bump |
| `yaab_bsdata_filelist_10e_v2` | sessionStorage | `bsdata.js` (dormant) | **Unused** — dormant BattleScribe file listing | n/a |
| `yaab_armies` | localStorage | `army.js` | Saved armies (Array of `Army.toJSON()`) | User data — never invalidate silently |
| `yaab_current_army_id` | localStorage | `state.js` | Id of the army the user last had open on this device. Written by the `App.state.currentArmy` setter (an accessor, so every assignment site is covered); read at boot by `app/index.js` and by sync's placeholder-promote. Device-local, NOT cloud-synced | Falls back to newest-`updatedAt` if the id is gone |
| `yaab_factions` | localStorage | `storage.js` | Legacy; unused by active path | Kept for back-compat |
| `yaab_recent_factions` | localStorage | `hero-state.js` | Recently-selected factions chip | User data |
| `yaab_favorites` | localStorage | `favorites.js` | Starred unit ids | User data |
| `yaab_recents` | localStorage | `favorites.js` | Recently-viewed unit ids | User data |
| `yaab_collection` | localStorage | `collection.js` | Per-unit owned/painted status | User data |
| `yaab_reserves` | localStorage | `reserves.js` | Per-unit owned quantity (`{unitId: qty}`); cloud-synced | User data |
| `yaab_requisitions` | localStorage | `requisitions.js` | Per-unit wishlist quantity (`{unitId: qty}`); cloud-synced | User data |
| `yaab_custom_names` | localStorage | `custom-names.js` | Named Reserves instances (`{instanceId: {u: unitId, n: name, t: createdAt}}`) — each one is a unique unit split off the `yaab_reserves` stack; cloud-synced. Custom names on ARMY entries are NOT here: they live on `entry.customName` inside `yaab_armies` | User data |
| `yaab_units_view` | localStorage | `reserves.js` | Active unit-pane view (`'reserves'` / `'requisitions'` / `'all'`) | User pref |
| `yaab_opponent` | localStorage | `opponent.js` | Last-pasted opponent army | User data |
| `yaab_army_snapshots` | localStorage | `army-diff.js` | Labeled save snapshots (max 20/army) | User data |
| `yaab_deployments` | localStorage | `deployment-planner.js` | Per-army deployment maps | User data |
| `yaab_tournament_cfg` | localStorage | `tournament-export.js` | Tournament PDF preferences | User data |
| `yaab_kotc_enabled` | localStorage | `kotc.js` | King of the Coliseum checks on/off (`'1'`/`'0'`) — device pref, deliberately NOT army data so it stays out of the YAAB1 export and cloud sync | User pref |
| `yaab_show_legends` | localStorage | `legends-toggle.js` | Show [Legends] units | User pref |
| `yaab_show_allies` | localStorage | `allies.js` | Show allied units on a host faction's roster (**defaults on**) | User pref |
| `yaab_pwa_dismissed` | localStorage | `pwa-install.js` | Install banner dismissal | User pref |
| `yaab-shell-<token>` | Cache API | `sw.js` | The app shell (~200 entries, ~14 MB). Name carries the deployed `?v=` token; `activate()` deletes every other key | Rotated wholesale on each release/data deploy |
| `yaab_mobile_panel` | localStorage | `pwa-install.js` | Last-active mobile tab | User pref |
| `yaab_tour_seen` | localStorage | `first-time-tour.js` | First-run tour completed | One-shot |
| `yaab_parse_debug` | localStorage | `parser/report.js` | Parse-coverage console logging | Dev flag |
| `yaab_auth_session_hint` | localStorage | `auth.js` | Cosmetic `{username}` hint so the topbar can render "signed in" instantly on reload (cookie is source of truth) | Cleared on sign-out |
| `yaab_sync_queue` | localStorage | `sync.js` | FIFO of pending `{op, id?, ts, mutationId}` sync operations; coalesced on enqueue | Drained as ops succeed |
| `yaab_sync_known` | localStorage | `sync.js` | `{ armyId -> updated_at }` last seen on the server; drives LWW push/pull decisions | Cleared on sign-out |
| `yaab_sync_state_at` | localStorage | `sync.js` | Last successful state-bag (KV) push timestamp | Cleared on sign-out |
| `yaab_mode` | localStorage | `mode-shell.js` | Active top-level mode (`'build'` / `'collect'`) | User pref |
| `yaab_details_state` | localStorage | `details-persist.js` | Open/closed state of `<details>` boxes (army setup, detachments, KOTC, army rules) | User pref |
| `yaab_theme` | localStorage | `theme-boot.js`, `themes.js` | Chosen visual theme id (`grimdark` \| `brutalist` \| `brutalist-dark`); cloud-synced, so the choice follows the account | User pref |
| `yaab_reduced_motion` | localStorage | `settings-drawer.js` | App-level reduced-motion override (in addition to OS pref) | User pref |
| `yaab_show_collection_badges` | localStorage | `collection.js`, `settings-drawer.js` | Toggle for the painted-status badges on unit cards | User pref |
| `yaab_collect_debug` | localStorage | `collect-mode.js` | Dev flag for verbose Collect-mode logging | Dev flag |
| `yaab_changelog_seen` | localStorage | `changelog.js` | Last `App.CHANGELOG.version` the user has opened — drives the "unseen" red dot on the Updates icon | User pref |
| `yaab_cards_presets` | localStorage | `cards-mode.js` | Named snapshots of every card-render setting (colours, typography, layout, back-image id, …); cloud-synced | User data |
| `yaab_cards_selection` | localStorage | `cards-mode.js` | Card-exporter deselections (excluded card ids per category: units/rules/strats); device-local, NOT cloud-synced | User selection |
| `yaab_cards_spill` | localStorage | `cards-mode.js` | Per-unit-card manual page-split overrides (`{cardId: [sectionKey,…]}` of whole sections sent to the continuation card); device-local, NOT cloud-synced. Absent card → automatic whole-section split | User selection |

The app-shell service worker maintains exactly one Cache API entry, `yaab-shell-<version-token>` — see the section below.

## Themes

Three interchangeable themes, chosen under **Appearance** in the Settings
drawer. Added 2026-08-19.

| id | Name | Stylesheet |
|---|---|---|
| `grimdark` | Grimdark — the original look | none |
| `brutalist` | Neo-Brutalist | `css/themes/brutalist.css` |
| `brutalist-dark` | Neo-Brutalist Dark | same file, `:root[data-yaab-theme="brutalist-dark"]` |

**The default theme loads nothing.** That is the design constraint, not a
side effect: `grimdark` has no stylesheet and sets no root attribute, so on a
default install the whole feature costs one `localStorage` read. It was
verified by pixel-diffing a full-page screenshot of the live site, desktop and
phone, against the same shot taken before any of this existed — 0 of 1,296,000
and 0 of 329,160 pixels differ. Re-run that diff before changing anything here.

Three pieces:

- **`js/theme-boot.js`** — the registry (`window.YAAB_THEMES`) plus `apply()`.
  It is the **only script on the page that is not `defer`**, and it must stay
  last in `<head>`: it appends the theme's `<link>`, which has to land after
  every other stylesheet to win on cascade order and has to be in the document
  before first paint or the user watches the theme get applied. The CSP
  (`script-src 'self'`) is why it is a file rather than an inline block.
  It borrows the `?v=` stamp off `css/style.css` — `scripts/stamp-assets.mjs`
  only rewrites URLs literally present in `index.html`, and this one never is.
- **`js/app/themes.js`** — `App.Themes.{list,get,set,remapAccent}`. Switching
  is a live swap of that one `<link>` with no reload; because every theme is
  override-only, removing it restores the default completely. It also listens
  for `storage` on `yaab_theme`, which is what makes a cloud pull (sync.js
  fires a synthetic `storage` event per key it overwrites) repaint the app on a
  second device.
- **`css/themes/brutalist.css`** — token overrides + component overrides,
  plus its own `@font-face`. Two things in it are worth copying rather than
  re-deriving. **A theme needs a GROUND and a PAPER that differ**: the first
  version of this one painted `--bg`, `--panel-bg` and `--card-bg` all
  `#ffffff`, so nothing had anything to stand out against and no offset
  shadow had a surface to fall on — the app rendered as a wireframe. It is
  now a cream page with white sheets on it. And **a theme that asks for a
  weight the system fonts do not have must ship the face**: every
  `font-weight: 900` in here was being synthesised off Helvetica until
  Archivo was self-hosted.

### The accent is the faction colour

`App.FACTION_COLORS` is a palette of pastels at HSL L ≈ 78%, chosen against the
default theme's near-black panels. On a white ground they vanish — and the 4px
hard offset shadow under a selected unit card, which is the loudest place the
faction colour appears in that style, becomes a pale smudge.

So a theme declares an `accentMode` and `App.Themes.remapAccent` **re-lights
the same faction hue** for that theme's ground: same hue, different
lightness/saturation, never a different colour. `App.applyFactionColor`
(`js/app/state.js`) calls it and takes the palette back unchanged when the
active theme declares `accentMode: null` — which the default theme does, so its
behaviour is byte-identical to before. Faction colours are written **inline** on
`<html>`, so they beat the `:root` values in any theme stylesheet; the values in
a theme's `:root` block are only what shows before a faction is picked, and they
are kept in step with the `MODES` table in `themes.js` so there is no flash.

### Writing another theme

Add an entry to `THEMES` in `js/theme-boot.js` and a stylesheet under
`css/themes/`. Two things will bite:

1. **Specificity, not order.** The theme link loads last, so an equal-specificity
   rule wins — but `css/detail-redesign.css` qualifies almost everything with
   `.unit-detail-content`, `css/unit-card-themes.css` uses
   `.unit-card.faction-x:hover`, and `css/mobile.css` hides its phone chrome
   inside a media query. Mirror those selectors rather than reaching for
   `!important`. `browse.sh run` + a rule-tracing probe answers "why did my
   override lose" in one shot; guessing does not.
2. **Hardcoded pastels.** ~175 rules across `css/` set a text colour above 62%
   luminance for the dark default. Five surfaces (`cards-mode`, `admin`, the
   stratagems modal, `cold-start`) paint their own dark ground
   and are fine; everything else needs re-pointing. `brutalist.css` does it via
   six `--nb-*` semantic tokens rather than 175 literals — copy that shape.

## Service worker

`sw.js` is a real app-shell worker again as of 2026-08-16. It was a **kill switch** from 2026-04-27 (commit `ad3fca7`) until then, because the version before it precached the shell and served it **cache-first**, so every fix needed a `SHELL` bump and two reloads to appear and the bug report was always "works in a private window but not my normal browser, and a hard refresh doesn't help."

It is back because Chrome will not offer "Install app" without a registered worker that has a fetch handler — that was the only missing installability criterion. Offline support comes with it, and matters more than it sounds: the whole dataset is in `js/vendor/dc-bundle.js` and all user data is in localStorage, so the only thing yaab was still fetching to boot was its own code.

**The four rules** (the full text lives at the top of `sw.js`; the same block, naming yaab as the cautionary tale, is in `sites/boop`, `sites/fuel` and `sites/meds`):

1. **`sw.js` is never cached by itself** — Caddy `no-cache` on `*.js`, `updateViaCache:'none'` on the registration, and `ours()` refuses to intercept `/sw.js`. A cached worker can't be replaced by a fixed one, and this is what keeps `sw-kill.js` reachable.
2. **Navigations are network-first** with a 1500 ms timeout, falling back to the cached shell. A deploy can never be invisible.
3. **Static assets are stale-while-revalidate, never cache-first.** The cache self-heals within one extra load even if `VERSION` never moves. This is the precise line the old one got wrong.
4. **`/api/` and `/data/` are never touched.** `/api` is user data behind an auth cookie. `/data` is 48 MB — 11 MB of GDC prose that `js/gdc.js` already read-throughs into IndexedDB (so those requests never recur), plus 37 MB of dormant BSData XML. Mind the near-collision: `js/data/community-feed.json` is under `/js/`, so it IS cached.

**`SHELL` is deliberately tiny** — `/`, `/index.html`, `/manifest.json` and the icons. It is the *offline navigation fallback*, not a precache list. All 192 files index.html references are requested on every load anyway, so rule 3 caches them on load #1 for free; precaching them would download ~14 MB twice on the install visit for no extra coverage. **Do not add files to `SHELL` when you add a module.**

**`VERSION` is the cache name and carries the `?v=` token**, stamped by `scripts/stamp-assets.mjs` in the same pass as `index.html`. This coupling is load-bearing: the Cache API keys on the full URL including the query, so a release rotates ~190 cache keys at once, and if `VERSION` didn't move with them `activate()` would never drop the superseded generation and the cache would grow ~14 MB per release. Never hand-edit it. Measured rotation lag after a deploy: ~3.3 s from the reload settling.

**Rollback, three levels:**

- **L1 — stop new installs.** Revert `js/app/sw-register.js` to a no-op. Existing installs keep working correctly (rules 2 + 3 mean they still see every deploy). Cleans nothing up.
- **L2 — the real one.** `cp sw-kill.js sw.js`, revert `sw-register.js`, `node scripts/stamp-assets.mjs`, commit, push. Every client drops the worker and all caches on its **next navigation**, guaranteed by the three mechanisms in rule 1. **Leave it in place ≥30 days** before restoring `sw.js` from git — the previous retirement sat for 3.5 months, which is why returning to a real worker needed no migration.
- **L3 — one device.** The console one-liner at the bottom of `sw.js`.

**Verify with** `~/sites/base/browser/browse.sh run ./scripts/pwa-check.mjs <outdir>` — 25 assertions covering installability, cache hygiene (one cache, name equal to the live `?v=` stamp, nothing under `/api` or `/data`) and an offline reload.

**The regression test that matters** is not in that script, because it needs a real deploy between two page loads: bump `version` in `js/data/changelog-data.js`, run `stamp-assets.mjs`, then do an **ordinary reload** (F5 — not Ctrl+Shift+R, DevTools closed) and confirm the change is visible on *that* load. Do it twice; historically the failure showed on the second deploy.

## HTTP caching / cache-busting

Three layers now keep a parser/datasheet fix from getting stuck behind a cached copy of the old code (the failure mode behind the kind of "I already fixed this but a user still reports it" bug). They compose rather than compete: layer 1 decides freshness, layer 2 changes the URL so a stale copy can't be matched at all, and layer 3 (the service worker) only ever *adds* an offline fallback — it is network-first for navigations and never cache-first for anything, so it cannot override either of the other two.

1. **Revalidation headers (the guarantee).** The host Caddy config (`~/sites/base/conf.d/yetanotherarmybuilder.caddy`) serves `/`, `*.html`, `*.js`, and `*.css` with `Cache-Control: no-cache`. The browser keeps its copy but must revalidate with an `If-None-Match` on every load; Caddy answers `304` when the file is unchanged (one tiny round-trip) and `200` with fresh bytes when it changed. So a fix goes live on the next *ordinary* reload — no hard-refresh. Deliberately **not** applied to `data/bsdata/**` (multi-MB XML the app caches itself via IndexedDB + `index.json` SHAs) or the woff2 fonts (immutable).
2. **Version stamp (belt-and-suspenders).** `scripts/stamp-assets.mjs` appends `?v=<App.CHANGELOG.version>` to every local `js/`+`css/` reference in `index.html`, so the URLs themselves change each release — covering heuristic/proxy caches that ignore `no-cache`. The version is read from `js/data/changelog-data.js`, so there is one source of truth. **After bumping the changelog version, run `node scripts/stamp-assets.mjs`** (or `--check` in CI to fail on a stale stamp). Re-running is idempotent; font preloads are intentionally skipped so they keep matching the CSS `@font-face` URLs.

   **Data-only deploys stamp too.** The nightly refresh redeploys `js/vendor/dc-bundle.js` without a release, so it runs `stamp-assets.mjs --data <bundle-md5>`, which stamps `?v=<version>-d<md5-8>`. Do **not** "fix" this by bumping the changelog version instead: `changelog.js` lights the "What's new" dot by comparing `App.CHANGELOG.version` against `yaab_changelog_seen`, so a daily bump would badge every user over an unchanged changelog. `--check` accepts the bare version *or* the version with a `-d…` suffix, so a data-only deploy never reads as a stale stamp.

3. **Service worker (offline, not freshness).** `sw.js` caches the shell so the app boots with no network. It is stale-while-revalidate for assets and network-first for navigations, and `stamp-assets.mjs` moves its cache name in lockstep with layer 2 — so a new `?v=` URL is a guaranteed cache miss and goes to the network. See the "Service worker" section above for the four rules and the rollback.

Because layer 1 guarantees freshness on its own, forgetting layer 2 degrades gracefully (you just lose the proxy-cache coverage) — it never reintroduces the stale-fix bug. Layer 3 is designed so that forgetting *it* is equally harmless: the cache self-heals within one extra load.

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
| "Why is my data/field change not visible?" | The BattleScribe parser (`js/parser/`) is DORMANT — live data comes from `js/vendor/dc-bundle.js` (`window.DC`) via `js/data/dc-adapter.js`, which rebuilds factions on every load (no IndexedDB faction cache, no `DB_VERSION` bump needed). If a unit/field is wrong, fix `dc-adapter.js`. The bundle itself is generated — do NOT hand-edit it; the cron rebuilds it from 40kdc git `main`. |
| "How do I make my module aware of mode (Build / Collect / Play)?" | `App.hooks.modeChange.push((newMode, prevMode) => { ... })`. Mode is also reflected as `body[data-mode]` for CSS. |
| "Where do I add a changelog entry?" | `js/data/changelog-data.js`. Bump `version` + `lastUpdated`. EVERY user-visible change must add one (see editing guidance #6 below). |

## Editing guidance

1. **Find the right file FIRST. Don't grep blindly.** The file map above is intentionally exhaustive. If you can't tell where a feature lives from the table, scan `js/app/` and `js/ui/` filenames first — every module is named after what it does.
2. **Hook-first.** Adding a new feature should never require touching `events.js`, `detail.js`, `index.html` toolbar markup, or any other shared file. Create a new file under `js/app/` or `js/ui/`, register via `App.hooks.*`, and append the script tag to `index.html`. See `docs/UI.md` "How to add X".
3. **Don't introduce a bundler, framework, or TypeScript for APP code.** Vanilla JS, IIFE, namespace globals. That's the deal. (The offline `build/` data-bundle step is the one sanctioned exception — it produces a static `js/vendor/dc-bundle.js`.)
4. **The parser output shape is now a contract `dc-adapter.js` emits** (documented in `docs/PARSER.md`). Don't break it — every renderer reads it. There is no faction IndexedDB cache anymore (the adapter rebuilds from `window.DC` each load), so a data/field change does NOT require a `DB_VERSION` bump. Don't hand-edit `js/vendor/dc-bundle.js` or `build/abilities-index.json` — they're generated and auto-refreshed by `~/sites/base/refresh-40kdc.sh`.
5. **Don't break the namespaces** (`window.App`, `window.UI`, `window.Storage`, `window.Army`, `window.ArmyManager`, `window.BSData`, `window.WahapediaParser`, `window.YaabDB`, `App.hooks`). External tabs reload through them.
6. **Update the user-facing changelog on every shippable change.** This is a HARD requirement. Any new feature, visible bug fix, or data correction the user can notice MUST add an entry to `js/data/changelog-data.js` (and bump `version` + `lastUpdated`) **in the same commit as the code change** — not a follow-up. The "What's new" button in the topbar (`js/app/changelog.js`) is the only place users see release notes; if your fix isn't there, the user thinks you forgot. Skip entries only for pure refactors, internal-only behaviour, doc edits, and CI plumbing. See the comment at the top of `changelog-data.js` for the entry shape and the `feature` / `fix` / `change` `kind` values.

   Before every `git commit` of a user-visible change, run through this checklist:
   - [ ] Opened `js/data/changelog-data.js`.
   - [ ] Added a `{ date, kind, title, description }` entry at the TOP of `entries:` (newest first).
   - [ ] Bumped the top-of-file `version` and `lastUpdated` fields.
   - [ ] Ran `node scripts/stamp-assets.mjs` so the cache-bust `?v=` in `index.html` matches the new version (see "HTTP caching / cache-busting" above). Staged the updated `index.html` **and `sw.js`** — one run rewrites both, and the service worker's cache name must not lag the asset URLs.
   - [ ] Staged `js/data/changelog-data.js` alongside the code change so they ship together.

   If you don't do this, the change does not exist as far as the user is concerned. Treat a missing changelog entry the same as a broken build.

## Don't break

- `WahapediaParser.parse()` output shape (see `docs/PARSER.md`) — now the contract `dc-adapter.js` emits and every renderer consumes.
- `App.hooks.*` action shapes. New feature modules consume them.
- `Army.toJSON()` / `Army.fromJSON()`. Saved armies must keep deserializing.
- `Army.toJSON()` keys must include `createdAt` and `updatedAt`, and the constructor must accept them. Every `fromJSON` path that drops the timestamps breaks cross-device sync (every load looks "newer" than cloud → uploads stale → clobbers other devices).
- API endpoint paths under `/api/*` and their request/response shapes are contract — see `../api/CLAUDE.md`.
- `YAAB1:` v2 export format (`storage.js`). Bookmarked share URLs depend on it.
- The hook iteration in `App.fireBootstrap` / `fireArmyChange` / `fireSelectionChange` — they wrap each call in try/catch, so one broken module shouldn't break others. Keep that pattern.
- `releaseSharedIndex()` was called once in `bsdata.js` after Phase 2 (now dormant). If you ever revive the XML parser path, don't hold DOM refs alive past that point — it leaks tens of MB.
- The changelog-entry rule (editing guidance #6). Shipping a user-visible change without an entry is a regression — the user can't find out about the fix, can't tell whether their report was addressed, and will reasonably assume nothing happened. Every commit that touches user-facing behaviour stages `js/data/changelog-data.js` too.
