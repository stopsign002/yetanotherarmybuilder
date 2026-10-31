# DATASET.md — yaab game-data pipeline v2 (contract)

Status: build contract for the 2026-10-31 rewrite. Branch `data-v2`, worktree
`~/sites/sites/yaab-test/app`, test vhost `https://yaab-test.thewheeliebois.com`
(same Caddy, no API, served from the worktree). Retiring the v1 scripts after cutover: `pipeline/retire-v1.md`. Decisions behind it:
`~/sites/base/reviews/yaab-2026-10-30/DATA-PIPELINE-V2-PLAN.md`.

## 1. The one output: faction files in the renderer shape

The browser consumes **exactly the objects `BSData.loadAllFactions()` returns
today**. The dataset is that array serialised, one JSON file per faction. The
reference is a dump of today's live output, the **golden set**:
`~/sites/base/yaab-data/golden/<factionId>.json` (34 files, `_index.json` lists
ids, names and counts). Builders target it; the parity harness diffs against it;
the loader does nothing but fetch it.

Key sets (from the golden dump; keep every key, even when empty):

- faction: `factionName, _factionId, filename, unitCount, units, armyRules,
  detachments, linkedCatalogues, _source, alliedRules, allyUnitCount`
- unit: `id, name, type, chapterBadge, role, transportCapacity, stats,
  modelStats, invulnSave, invulnNote, weapons, abilities, wargearAbilities,
  wargearProfile, keywords, wargearOptions, points, pointsOptions, squadOptions,
  ordinal, description, isLegends, _unpriced, attachmentRole, gdcLeadBy,
  _mfmPoints, _provisional, gdcLoadout, gdcWargear, gdcComposition,
  gdcMeleeWeapons, gdcRangedWeapons` (allied rows add `_factionId`,
  `_allyOf`, `_allyNoEnhancements`; copy whatever the golden rows carry)
- detachment: `name, rules, enhancements, _factionId, id, points, dispositions,
  stratagemIds, gdcStratagems`
- weapon: `name, _typeName, Range, A, S, AP, D, WS|BS` plus `_keywordDefs`
  where present; ability: `name, description, isCore, id`;
  wargearProfile: `options, budgets, modelsBySize, defaultsBySize, itemCosts,
  defaultCostBySize, alwaysCost`; stratagem: `name, cp, phase, phases, turn,
  timing, type, description, source`; enhancement: `name, pts, description,
  keywords` (+ `id`).

Semantics of the non-obvious fields are in `docs/PARSER.md` ("Adapter
additions"). When the golden set and this document disagree, the golden set
wins; note the discrepancy in your report.

## 2. Layout

```
app/pipeline/                      (in git, hidden by Caddy under /pipeline/*)
  sources.json                     pinned inputs: gdc repo+ref, 40kdc sha, MFM base URL
  aliases.json                     the only hand file: name joins (see §5)
  extract/gdc.mjs                  28 GDC files → work/gdc.json
  extract/mfm.py                   MFM site → work/mfm.json (name-keyed, no 40kdc)
  extract/dc.mjs                   pinned 40kdc checkout → work/dc.json
  build.mjs                        work/*.json + aliases → candidate
  validate.mjs                     schema + invariants + parity → report.json
  report.mjs                       human diff vs current → report.md (+ mail body)
  yaab-data                        bash CLI: build | validate | report | approve | rollback | list | preview
  schema/faction.schema.json       JSON Schema for one faction file
app/data/dataset/                  gitignored, served, backed up by the media leg
  current/<factionId>.json         what the live app loads
  current/manifest.json
  candidate/<id>/...               same layout; `?data=candidate:<id>` previews it
  previous/<n>/                    last 5 approved, for rollback
~/sites/base/yaab-data/
  work/                            extractor outputs, scratch
  golden/                          the reference dump (above)
  checkouts/40kdc-data             the pinned 40kdc checkout (reuse ~/sites/base/40kdc-build/40kdc-data at 709ecd9f)
```

Candidate id: `YYYYMMDD-HHMM-<gdcDataVersion>-<md5 of the dataset, 8>`.
`manifest.json`: `{ id, builtAt, sources: { gdc: {version, updated, files},
mfm: {fetched, unitsPriced, wargearPriced}, dc: {sha} }, factions: [{id, name,
units, detachments}], md5 }`.

Host has no node: every `.mjs` runs as
`docker run --rm -v <app>:/app -v ~/sites/base/yaab-data:/work -w /app/pipeline node:22-slim node <script>`.
`mfm.py` runs with the host `python3` (stdlib only, like today's scraper).

## 3. Source ownership (the builder's only rule)

| Field group | Owner | Fallback / cross-check |
|---|---|---|
| datasheet set, names, keywords, `isLegends`, `role`, `type`, `transportCapacity`, `attachmentRole` | GDC `datasheets` (`imperialArmour` → legends-style flag as today; `role` from keywords as the adapter derives it) | — |
| `stats`, `modelStats`, `invulnSave`, `invulnNote` | GDC `stats`, `abilities.invul`, `abilities.damaged` | — |
| `weapons`, `gdcRangedWeapons`, `gdcMeleeWeapons` | GDC `rangedWeapons`/`meleeWeapons` | — |
| `abilities`, `wargearAbilities` (text included) | GDC `abilities.*` (core/faction/other/wargear/special/primarch) | — |
| `gdcLeadBy` | GDC `attachesTo` | `leader` prose |
| `gdcLoadout`, `gdcWargear`, `gdcComposition` | GDC prose fields | — |
| `points`, `pointsOptions`, `squadOptions`, `ordinal`, `_mfmPoints`, `_unpriced`, `wargearProfile.itemCosts/defaultCostBySize/alwaysCost` | **MFM** (`work/mfm.json`) | GDC `points` only when MFM has no row; then `_provisional: true` |
| `detachments[].name/id/points/dispositions`, `rules`, `enhancements`, `gdcStratagems`, `armyRules` | GDC `detachments`, `rules`, `enhancements`, `stratagems` | — |
| `wargearProfile.options/budgets/modelsBySize/defaultsBySize`, `wargearOptions` | 40kdc pinned (`work/dc.json`) joined by alias | GDC `wargearOptions` text (kept in `gdcWargear`) |
| `alliedRules`, allied unit rows, `dispositions` text, game-mode filtering | 40kdc pinned | — |
| `stratagemIds` | 40kdc ids when a join exists, else synthesised `gdc:<slug>` | — |
| `chapterBadge`, SM chapter factions | as today: chapter factions are separate GDC files; the builder emits the same 34 faction ids as the golden set | — |

No overlays, no hand text, no stat fixes. `aliases.json` may only map names.

## 4. Intermediate formats

`work/gdc.json`: `{ version, updated, factions: { "<factionId>": { file, name,
datasheets: [raw GDC datasheet with `_slug`], stratagems, enhancements,
detachments, rules } } }` — raw GDC records, plus a `_slug` (lower-kebab of the
English name) on every record. No reshaping beyond that.

`work/mfm.json`: `{ fetched, pages: n, units: { "<mfm faction slug>|<mfm unit
name>": { points: [{cost, models, unit_count_min, unit_count_max}], items:
{ "<item name as printed>": pts } } }, meta: { unitsPriced, wargearPriced,
unmatchedRows } }`. Keyed by what MFM prints; no 40kdc ids anywhere.

`work/dc.json`: `{ sha, factions: { "<40kdc faction id>": { units: { "<unit id>":
{ name, wargearProfile-inputs (options, budgets, compositions, defaults),
weapon/wargear names the options reference } }, alliedRules, forceDispositions,
detachments: { "<id>": { name, stratagem_ids, enhancement_ids, game_modes } } } } }`.

## 5. aliases.json

```json
{ "factions": { "<gdc file id>": { "factionId": "<golden _factionId>", "mfm": "<mfm faction slug>", "dc": "<40kdc faction id>" } },
  "units":    { "<factionId>/<gdc _slug>": { "mfm": "<mfm unit name>", "dc": "<40kdc unit id>" } },
  "items":    { "<factionId>/<gdc _slug>/<item slug>": "<mfm item name>" } }
```
Default join is the normalised name (lowercase, strip punctuation and
articles); an alias is needed only where that fails. Seed it from today's
`~/sites/base/mfm-aliases.json`, `dump-aliases.json`, `gdc.js` GDC_NAME_ALIASES
and the adapter's rename maps, then from whatever the first build leaves
unresolved.

## 6. Validator (`validate.mjs`, exit 1 on any failure)

1. Schema: every faction file validates against `schema/faction.schema.json`.
2. Coverage: every unit has ≥1 `modelStats` row with M/T/SV/W/LD/OC; every
   non-Legends unit has ≥1 weapon or ≥1 ability; every detachment has ≥1 rule
   with text and ≥1 stratagem; every enhancement has text.
3. Pricing: `points` and `squadOptions` equal the MFM row for every priced
   unit; every MFM row joins a unit or is listed in `report.unpricedMfmRows`;
   `_unpriced` units are listed; `alwaysCost > 0` only for ids in
   `ALWAYS_COST_ALLOWLIST` (today: Victrix Honour Guard banner).
4. Joins: every alias resolves; every `gdcLeadBy` target names a unit in the
   faction (or an ally); every wargearProfile option id refers to a weapon or
   item the unit carries.
5. Parity vs golden (or vs `current/` once one exists): per-faction unit
   counts, per-unit `points`/`squadOptions`/`ordinal`, `modelStats` rows,
   weapon names, ability names, keyword sets, detachment names, stratagem and
   enhancement counts. Every difference goes in `report.parity[]` with a
   category; the build FAILS on `unit-missing`, `points-differs-from-mfm`,
   `stat-rows-lost`, `weapons-lost`, `text-lost` (had text, now empty); it
   PASSES but LISTS `points-changed` (MFM says so), `text-changed`,
   `ability-renamed`, `extra-*`.
6. Freshness: GDC `compatibleDataVersion` and MFM `unitsPriced` not lower
   than the current manifest's.

## 7. Loader (browser)

`js/data/dataset-loader.js` replaces `js/data/dc-adapter.js` and the merging
half of `js/gdc.js`: it reads `?data=candidate:<id>` (else `current`), fetches
`data/dataset/<which>/manifest.json`, then the faction files (all 34 today, in
parallel; later per-selection), and installs them as `window.BSData.loadAllFactions()`
resolving to the array, byte-for-byte the same objects. Keep the functions of
`gdc.js` that renderers call directly (grep `App.GDC.` outside gdc.js) as a thin
module; delete fetching/merging. `index.html` drops `js/vendor/dc-bundle.js`,
`dc-prose.js` and the adapter; nothing else in `index.html` changes.
`sw.js` rule 4 already leaves `/data/` alone; Caddy serves `/data/dataset/*`
with `no-cache`, so an approve is visible on the next load.

## 8. CLI (`app/pipeline/yaab-data`)

`build` (extract all → build → candidate dir, prints id) · `validate <id>` ·
`report <id>` (writes report.md; `--mail` sends via the mailer when the
candidate differs from current) · `approve <id> [--app <path>]` (copies
current → previous/, candidate → current atomically, prunes previous to 5) ·
`rollback [<n>]` · `list` · `preview <id>` (prints the URL). `--app` defaults
to `~/sites/sites/yetanotherarmybuilder/app`; the test site uses
`--app ~/sites/sites/yaab-test/app`.

## 9. Parity acceptance (the cutover rule)

The first candidate is compared with the golden set. "Nothing regressed" means
zero items in the FAIL categories of §6.5 and every PASS-but-LISTED item
reviewed and attributed to GDC or MFM being the owner (a dropped hand
correction, a GDC wording). Then it is loaded on yaab-test, the browser suites
pass there, and the session compares live vs test in the browser on a fixed
set of armies before approving into the live tree.

## 10. Ownership for the build night

- W1 (pipeline core): `pipeline/extract/gdc.mjs`, `pipeline/build.mjs`,
  `pipeline/validate.mjs`, `pipeline/schema/`, `pipeline/sources.json`.
- W2 (other extractors + CLI): `pipeline/extract/mfm.py`, `pipeline/extract/dc.mjs`,
  `pipeline/aliases.json`, `pipeline/report.mjs`, `pipeline/yaab-data`.
- W3 (browser): `js/data/dataset-loader.js`, `js/gdc.js`, `index.html` script
  tags, deletions listed in §7, `.gitignore` (`data/dataset/`).
- W4 (parity): `pipeline/parity.mjs` (shared by validate.mjs §6.5 — W1 imports
  it) and `scripts/verify/dataset-parity.mjs` (live vs test in the browser).
- W5 (docs + retirement): this file's final form, `CLAUDE.md`, `docs/PARSER.md`
  banner, `docs/ARCHITECTURE.md`, `build/README.md` → retired note,
  `pipeline/retire-v1.md` (the exact host commands to remove the old scripts,
  cron lines and files, mirrored to server-cron).
