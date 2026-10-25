# Waha mode — contract

"Waha" (after Wahapedia) is a top-level mode for looking things up: any
datasheet, detachment, stratagem, army rule or enhancement, any faction, with
no army involved. It exists because the builder's faction select WRITES the
faction into the open army and clears its detachments, and because the
owner's real lookup habit is cross-faction and random ("what does my
opponent's detachment do"). Built 2026-10-25 from the plan in
`~/.claude/plans/yaab-needs-an-explorer-refactored-diffie.md` (rev 2).

Workers build exactly this; the session reviews each diff against it, does
the browser pass, writes the changelog entry, stamps, commits and pushes.
**Workers do not commit and do not touch `js/data/changelog-data.js` or
`sw.js`.**

## Invariants (what "done" means)

1. **Zero writes to the builder.** Entering, using and leaving Waha changes
   nothing in `App.state` (`currentArmy`, `factionFilter`, `selectedChapter`,
   `selectedDetachment(s)`, `selectedUnit`), fires no `armyChange` /
   `selectionChange`, and touches no localStorage key other than its own
   `yaab_waha_recent` (and `yaab_mode`, which mode-shell writes).
2. **No building affordances anywhere in Waha.** No Add to Army, squad
   stepper, wargear picker, enhancement eligibility/taken state, detachment
   checkboxes, `detailActions` hook buttons, or double-click-to-add.
3. **Opens on everything, every time.** Faction filter = All factions, query
   empty, focus in the search box. No seeding from the builder, no remembered
   query. It remembers the last 10 things opened (`yaab_waha_recent`).
4. **One search box, always visible, searches every kind** across all
   factions (or one when the filter is set). Results group by kind. Kind tabs
   only narrow; the box never moves.
5. **Everything the data has is reachable**: every faction, every detachment
   as one sheet (rule + enhancements + stratagems), every datasheet (Legends
   only when `localStorage.yaab_show_legends === '1'`, shown with their
   existing badge), army rules, faction stratagems, core stratagems.
6. **Reachable from Build on desktop and phone, in all three themes, and the
   way back is obvious.**

## Data (read-only, from `App.state.factions` once `BSData` has loaded)

Faction: `{ factionName, _factionId, units[], armyRules[{name, description}],
detachments[], factionStratagems?[], gdcFactionStratagems?[] }`.
Detachment: `{ id, name, rules[{name, description}], enhancements[{name, pts,
description, keywords?}], stratagems?[], gdcStratagems?[] }` — union the two
stratagem lists deduped by name (`js/ui/cards-mode.js:912` shows the pattern).
Stratagem: `{ name, description, cp, phase, type }`. Core stratagems:
`App.CORE_STRATAGEMS`. Unit (datasheet): `{ id, name, role, stats, weapons[],
keywords[], abilities?, points, pointsOptions?, isLegends, attachmentRole,
gdcLeadBy[], _factionName }`. `App.factionGlyph(factionName)` returns the
inline-SVG glyph markup; `App.classifyUnitRole(unit)` the role class.
`UI.createUnitCard(unit, isSelected, opts)` (`js/ui/roster.js:78`) builds a
roster card with no add button. `UI.renderUnitDetail`, `UI.renderRuleDetail`,
`UI.renderDetachmentDetail` are in `js/ui/detail.js` (see Item A for the two
options this needs). Factions load async: wait for
`App.state.factions.length >= 30` (poll, or hook `App.hooks.bootstrap` +
re-check on activation); until then the page shows "Loading the data…".

## Item A — shared renderer options (owner: worker A)

Files owned: `js/ui/detail.js` only.

1. `UI.renderUnitDetail(unit, detachmentEnhancements, selectedEnhancements,
   opts)` gains **`opts.browseView`**. With it set the sheet keeps the name
   banner + points stack (every `pointsOptions` row), Led By, abilities,
   weapons, wargear text, keywords; and **skips** the Add to Army button and
   squad stepper (~307-329), the `detailActions` hook buttons (~284-286), the
   wargear-picker placeholder and mount (~740, ~996-998), and the enhancement
   eligibility/taken logic (~918-964) — when `detachmentEnhancements` is
   non-empty the enhancements render as a plain list (name, pts,
   description), no checkboxes, no "taken by" state. Nothing in browseView
   may read `App.state.currentArmy`. `gameView` behaviour is byte-identical
   to today (Play depends on it dropping the banner). `opts.host` already
   exists; browseView is always used with a host.
   In browseView, each Led By / Leads name that is rendered gets
   `data-waha-unit="<unit name>"` on its element so Waha can delegate clicks
   to open that datasheet (skip if the names are not rendered as discrete
   elements today — say so in the report).
2. `UI.renderDetachmentDetail(det, opts)` accepts **`opts.host`** exactly as
   `renderRuleDetail` does (~1077): render into the host instead of
   `#unit-detail-panel`, do not touch `#unit-detail-empty` when a host is
   given. Default behaviour unchanged.
3. Self-check: `docker run --rm -v "$PWD":/app -w /app -u "$(id -u):$(id -g)"
   node:22-alpine node --check js/ui/detail.js`; then a `browse.sh run` script
   that boots the live site, waits for factions, picks any unit and calls
   `UI.renderUnitDetail(u, det.enhancements, [], {host, browseView:true})`
   into a scratch `<div>` appended to `<body>`, and asserts: `.detail-name`
   present, no `.btn-add-to-army` / `#btn-add-to-army` / squad stepper / wargear
   picker / `.detail-action-btn` inside the host, the enhancements list has
   no inputs; and `UI.renderDetachmentDetail(det, {host})` renders its rule
   name into the host and leaves `#unit-detail-panel` untouched. Also confirm
   Build's own Details pane still renders a selected unit with its Add button
   (regression). No screenshots for the record.

## Item B — the mode (owner: worker B)

Files owned: new `js/ui/waha-mode.js`, new `css/waha-mode.css`,
`js/app/mode-shell.js` (add `'waha'` to `VALID` and `RESUMABLE`),
`js/app/index.js` (add `'btn-waha-mode'` to `TOPBAR_SHELF_IDS`),
`js/app/settings-drawer.js` (a `go-waha` GO row, not mobile-gated, between
Collect and Play, label `'Waha'` / `'Waha ✓'`), `css/mobile.css` (add
`#waha-mode` to the height rule at ~105-107), `index.html` (the section, the
hidden tab button, the `<link>` for the CSS next to `play-mode.css`, and the
`<script defer>` for the module placed **immediately before**
`js/ui/play-mode.js` — copy the `?v=` string the neighbours use),
`docs/MODULE-REFERENCE.md` (entry), `docs/UI.md` (mode list), `CLAUDE.md`
(features table row under Modes, storage-table row for `yaab_waha_recent`,
and fix two drifts: the `modeChange` hook signature is `fn(mode)` not
`(newMode, prevMode)`, and `ICON_VISIBLE_IDS` is now `TOPBAR_SHELF_IDS`).
Nothing else.

### Entry points (presentation to a Build user)

- Shelf button: `App.hooks.armyToolbarActions.push({ id:'btn-waha-mode',
  region:'icon', glyph:'⌕', label:'Waha', title:'Waha — look anything up: any
  datasheet, detachment, stratagem or rule, any faction, without touching your
  army', onClick(){ App.setMode('waha'); } })` — exactly the Play pattern
  (`js/ui/play-mode.js:721-728`). It lands left of Play because the script
  loads first; confirm in the shot.
- Settings drawer GO row as above (phones have no topbar).
- Build Details-pane hint: on `App.hooks.bootstrap`, append to
  `#unit-detail-empty` a `<button type="button" class="waha-hint-btn">Just
  looking something up? Open Waha →</button>` that calls `App.setMode('waha')`.
  A real button with the house button styling (border, padding, hover) in
  `css/waha-mode.css`, never a bare link.
- Hidden tab: `<button class="topbar-mode-tab" id="topbar-mode-waha"
  type="button" role="tab" data-mode="waha" aria-selected="false"
  aria-controls="waha-mode">Waha</button>` inside `nav.topbar-modes` after
  Build (the nav is `display:none` today; this is for when #84 un-hides it).
- Ways back: an **Exit** button in the Waha header ("Back to Build", same
  box/height as `.play-exit`), the YAAB brand, hardware Back (mode-shell's
  back-trap), the drawer's Build row.

### Page

`<section id="waha-mode" class="mode-page" data-mode="waha" hidden>` with a
`.mode-placeholder` like the others; `waha-mode.js` strips it and mounts its
root on the first `modeChange('waha')` (pattern: `play-mode.js:204-253`).
Every activation: clear the query, reset faction filter to All and tab to
All, focus the search box, re-render.

**Header (sticky, full width):** `WAHA` wordmark · the search box
(`<input type="search" id="waha-q">`, placeholder "Search any datasheet,
detachment, stratagem, rule or enhancement…") · faction `<select
id="waha-faction">` ("All factions" + every `factionName` sorted) · Exit.

**Kind tabs (under the header, `role="tablist"`):** `All · Datasheets ·
Detachments · Stratagems · Army rules · Enhancements`, each with a live count
for the current query + faction. "Army rules" includes detachment rules.

**Desktop (>820px): two columns** below the tabs, same chassis idea as
`.play-layout`: results left (~45%), reader right.

- Results, with a query: groups in fixed order Datasheets, Detachments,
  Stratagems, Army rules, Enhancements. On *All* each group shows its top 8
  and a "Show all n" button that switches to that kind's tab; on a kind tab
  the full list, rendered in pages of 60 with a "Show more" button. Rows:
  datasheets use `UI.createUnitCard(unit, isSelected)` (compact via CSS —
  smaller padding, stat strip hidden below 1100px); other kinds are
  `<button class="waha-row" data-kind data-key>` with name, a kind glyph, the
  faction (and detachment for strats / enhancements / det rules), and one
  line that matters (CP + phase; pts; the rule's name for a detachment).
- Results, empty query, *All*: a **Recently opened** strip (≤10, from
  `yaab_waha_recent`, same row markup) then a **faction directory** —
  one tile per faction with `App.factionGlyph` + name + unit count; clicking
  sets the faction select and lists that faction by kind (army rules first,
  then detachments, then datasheets grouped by role).
- Results, empty query, kind tab: that kind for the current faction filter
  (All factions → grouped by faction with a heading per faction, paged).
- Reader: a `.waha-reader` host. datasheet → `UI.renderUnitDetail(unit, enh,
  [], {host, browseView:true})` where `enh` is the enhancements of the
  detachment chosen in a small "Enhancements for:" chip row above the sheet
  (the faction's detachments; default none → no enhancements section).
  detachment → `UI.renderDetachmentDetail(det, {host})`. stratagem / army
  rule / det rule / enhancement → `UI.renderRuleDetail({type, name,
  description, cp, phase}, {host, gameView:true})` preceded by a
  `.waha-reader-from` line "from <detachment> · <faction>" whose detachment
  part is a button opening that detachment's sheet. Nothing selected →
  "Search above, or pick a faction." Opening anything pushes it onto
  Recently opened. Clicks on `[data-waha-unit]` inside the reader open that
  datasheet (same faction first, else first name match).

**Phone (≤820px): single column.** Header sticky; kind tabs scroll
horizontally; results fill the screen; opening an item slides to a reader
screen with `‹ Back` and the breadcrumb (`Space Marines › Gladius Task
Force`). `body[data-mode="waha"] .mobile-tabbar { display:none }` and
`body[data-mode="waha"] #waha-mode { height:100% }` in `css/waha-mode.css`
(mirror `play-mode.css:456-457`). The reader screen registers with
`App.backTrap.opened('waha:reader', fn)` / `closed(...)` so hardware Back
goes reader → results → Build rather than leaving the site (see how
`mode-shell.js:105-112` uses `App.backTrap`).

### Search index and ranking

Built once, lazily, on first activation after factions are loaded; rebuilt if
`App.state.factionsVersion` changes. Record: `{ kind, key, name, factionName,
factionId, detName?, line, hay, ref }` — `hay` is lower-cased `name +
keywords + ability names + weapon names` for datasheets, `name + description`
for everything else. Kinds: `unit`, `det`, `strat` (det + faction + core;
core carries factionName `'Core'`), `rule` (army + detachment rules), `enh`.
Query lower-cased, split on whitespace, every token must match `hay`. Rank:
name starts-with any token > name contains > hay-only, then alphabetical.
Input debounced 80 ms. Keys: `/` focuses the box while in Waha (not when
typing in another input), `Enter` opens the first visible result, `↑/↓`
move a highlight through visible rows, `Esc` clears the query. Legends units
indexed only when the pref is on (re-read on each activation).

### State

`yaab_waha_recent` (localStorage, device-local, never synced):
`[{kind, key, factionId, detName?}]`, newest first, max 10, deduped on
`kind+key`. Nothing else persists.

### Theming

Tokens only (`--accent`, `--accent-rgb`, `--border`, `--text`,
`--text-muted`, `--panel-bg`, `--card-bg`, `--font-display`). The brutalist
file is NOT yours; if a rule looks wrong there, note it in the report and
the session decides. Check all three themes (`localStorage.yaab_theme`).

### Self-check (worker B)

`node --check` (docker, as Item A) on `waha-mode.js`, `mode-shell.js`,
`index.js`, `settings-drawer.js`. Then a `browse.sh run` script against the
live site, 1440 and 390, no screenshots for the record: snapshot
`localStorage`; set a faction + detachment in Build through the app's own
select (`#army-faction-select`) and `App.state`; click `#btn-waha-mode`
(desktop) / call `App.setMode('waha')` (phone); assert `body[data-mode=waha]`,
`#waha-faction` value is All, `#waha-q` empty and focused; type `gladius` →
a Detachments group containing "Gladius Task Force"; open it → rule + ≥1
enhancement + ≥1 stratagem in `.waha-reader`; type `intercessor` → a
Datasheets group with "Intercessor Squad"; open it → `.detail-name` present
and NO add button / stepper / wargear picker / `.detail-action-btn`; type
`fire overwatch` → Stratagems group with a Core item; open it → CP visible;
type `oath of moment` → Army rules group; switch to the Stratagems tab with
the query set → `#waha-q` unchanged, only stratagems listed; set
`#waha-faction` to Tyranids, type `gladius` → "No results"; clear → Tyranids
listed by kind; press `/`, `Enter`, `Esc` and assert each; click Exit →
`body[data-mode=build]`, the builder's faction select still shows the faction
you set, `App.state.selectedDetachments` unchanged, and `localStorage` equals
the snapshot except `yaab_waha_recent` and `yaab_mode`; re-enter →
Recently opened lists the four items and `#waha-q` is empty. Phone: entry
through `App.setMode('waha')`, open a result → reader screen → `‹ Back` →
results → `history.back()` → Build. Reload while in Waha → lands in Waha.

## Reports

≤150 words each: files changed, function names, what the self-check printed,
anything in this contract that turned out wrong. No narration.
