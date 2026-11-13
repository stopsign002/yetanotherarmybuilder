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
  wargearProfile: `rules, unparsed, modelsBySize, defaultsBySize,
  defaultsByModel, itemCosts, defaultCostBySize, alwaysCost` (see
  §wargearProfile below; `options`/`budgets` are gone since 2026-11-03); stratagem: `name, cp, phase, phases, turn,
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
| `wargearProfile.rules/unparsed` | GDC datasheet `wargearOptions` groups, parsed by `pipeline/wargear-rules.mjs` | GDC `wargear` prose (`gdcWargear`) only for a sheet with no groups |
| `wargearProfile.defaultsByModel/defaultsBySize` | GDC "equipped with" lines (`gdcComposition`, then `gdcLoadout`) | GDC "Default Wargear" groups, then 40kdc defaults |
| `wargearProfile.modelsBySize`, `wargearOptions` | 40kdc pinned (`work/dc.json`) joined by alias | — |
| `alliedRules`, allied unit rows, `dispositions` text, game-mode filtering | 40kdc pinned | — |
| `stratagemIds` | 40kdc ids when a join exists, else synthesised `gdc:<slug>` | — |
| `chapterBadge`, SM chapter factions | as today: chapter factions are separate GDC files; the builder emits the same 34 faction ids as the golden set | — |

No overlays, no hand text, no stat fixes. `aliases.json` may only map names.

### wargearProfile

Contract: `docs/WARGEAR-RULES.md` (§1 rule shape). Built in `build.mjs`
`wargearProfile()`:

- **rules[]** come from the raw GDC datasheet's `wargearOptions` (carried
  untouched in `work/gdc.json`): ordered groups `{instruction: {en}, options:
  [{name: {en}, cost}]}`. A "Default Wargear" group is a model type's default
  loadout; every other group's instruction is parsed into one rule (several for
  "■" clauses, a second "If this unit contains…" paragraph, or a compound bullet
  header, ids `-wr-<g>.<k>`). Rule id `<unit>-wr-<g>`, g = 1-based index of the
  non-default group after dropping exact duplicate instructions. Choices come
  from the instruction's own list when it prints one (that is the only place
  bundles like "1 autopistol and 1 chainfist" and counts like "2 heavy
  bolters" exist); otherwise from the group's options. Item names are
  canonicalised against the group's option names, then the sheet's weapons and
  wargear abilities. **The rule's model comes from its prose, not from the
  Default Wargear block it sits under** — GDC files Nob, Gun Servitor and
  Troupe options under another model's block. `unit.gdcWargear` (GDC's
  flattened `wargear` field) is the fallback for a sheet with no groups
  (`log.wargearFromProse`) and a cross-check (`log.wargearProseOnly`: a prose
  line no group carries); a footnote only the prose carries (Inquisitorial
  Agents, Catachan Command Squad) is still applied.
- Optional rule fields beyond §1, emitted only when set: `forbids` (model must
  NOT carry any of these; also linked into `exclusiveWith` when another rule
  hands that item out), `nModel` (per_n counts only this model type: "For every
  5 Inquisitorial Agents"), `picks` (choices each taking model may make: "up to
  two of the following"; cap × picks), `distinct` (no duplicate choice on one
  model), `choiceMax` (+ `choiceMaxN`): unit-wide limit per choice, ×
  floor(size / choiceMaxN) when set ("once per unit unless it contains 20
  models, in which case twice" = `choiceMax 1, choiceMaxN 10`). `condition` may
  carry `maxModels` as well as `minModels` ("9 or fewer", "contains 10
  models" = both). An item may carry `count` (> 1) for "2 heavy bolters".
- **unparsed[]**: instructions the grammar cannot represent (an OR between
  replaced items, "three of the following", "For each Helbrute fist", "You can
  select one of the following options" with whole sentences as options).
  Listed per unit in `log.wargearUnparsed`; never dropped.
- **defaultsByModel** `{ "<model>": [{id, name, count}] }` (per one model) and
  **defaultsBySize** (summed over `modelsBySize`) come from the GDC "equipped
  with" lines so defaults and rules share names; Default Wargear groups (when
  there is one per composition entry) and 40kdc defaults are fallbacks.
- **itemCosts**: MFM; a GDC option `cost > 0` fills an item MFM does not price
  (`log.wargearCostFromGdc`), MFM wins where both do (`log.wargearCostDisagree`).
- Item ids: the id MFM's cost sits under, else the 40kdc id for that printed
  name, else `kebab(name)`. Names matching no weapon or wargear ability are
  still emitted and logged (`log.wargearItemUnmatched`).
- Tests: `node --test 'pipeline/tests/*.test.mjs'` (fixtures frozen from real
  sheets). Coverage report: `node pipeline/tests/wargear-coverage.mjs [--list]`
  (groups turned into rules, needs `/work/work/gdc.json`; `--prose` measures
  the fallback). Both run in `node:22-slim` with the app at `/w` and
  `~/sites/base/yaab-data` at `/work`.

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
   faction (or an ally). Wargear prose the rule parser could not read is
   LISTED as `wargear-unparsed` (shown as text in the picker, not enforced),
   never a FAIL; so are `wargear-prose-not-in-gdc-groups`,
   `wargear-rules-from-prose-fallback` and `wargear-cost-mfm-vs-gdc`.
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

## 11. App extraction — our own source for the GDC-shaped records (2026-11-13)

BSData is gone (the whole GitHub org 404s since 2026-11) and GDC is one
maintainer's unpublished converter. Since this section the pipeline reads GW's
app data itself. **Phase 1 is a drop-in:** nothing downstream of
`work/gdc.json` changes, and the proof is that the dataset built from our
extraction equals the dataset built from the GDC snapshot of the same data
version.

### 11.1 What the app ships

The release package of `com.gamesworkshop.w40k` (an `.xapk`: a zip of split
APKs; the base APK is `<package>.apk`) carries `assets/dump.json` in plain
JSON, ~36 MB: `{ metadata: { data_version }, data: { <table>: [rows] } }`, a
relational dump of 131 tables (datasheet, miniature, wargear_item_profile,
datasheet_ability, detachment, stratagem, enhancement, unit_composition,
wargear_option_group, loadout_choice_set, datasheet_bodyguard_group,
allied_faction, …). Text sits in each row's `localisations: { en: {...}, de:
… }`. No decompiling: two nested unzips. App releases map 1:1 to data versions
(2.6.0=946, 2.7.0=963, 2.7.1=972, 2.8.0=981, 2.8.1=995); the pinned GDC
snapshot `app/data/gdc/11th/gdc/` says `compatibleDataVersion` 995.

The package is **untrusted input**: it is never installed, never executed,
never unpacked to disk beyond `dump.json`, and the downloaded file is deleted
after extraction.

### 11.2 Layout added

```
app/pipeline/
  extract/app-fetch.py             host python3 (stdlib, run with -I): download + store the dump   [W2]
  extract/app.mjs                  stored dump → work/gdc.json, GDC record shape                   [W1]
  tests/app-parity.mjs             the parity harness (11.6)                                        [W1]
  app-parity-accepted.json         reviewed, reasoned differences (11.6)                            [W1]
~/sites/base/yaab-data/
  bin/apkeep                       pinned binary (sources.json app.apkeep: url + sha256)
  app-dumps/index.json             { package, dumps: [entry] }
  app-dumps/dump-<dataVersion>-<sha256[:8]>.json.gz
  app-dumps/last-check.json        { checkedAt, ok, newestListed, error, failingSince }
```

Index entry: `{ appVersion, versionCode, dataVersion, file, sha256, bytes,
fetchedAt, source }` — `sha256`/`bytes` are of the **uncompressed** dump;
`source` is `apk-pure` or `import`. Dumps are kept forever (10 MB each; the
history is our change feed). Identical content under two app versions is one
file and two entries.

### 11.3 `extract/app-fetch.py`  (W2)

```
app-fetch.py --store DIR [--bin DIR] [--check] [--version X.Y.Z] [--import PATH [--app-version V]]
```

1. Ensure `<bin>/apkeep` (default bin: `<store>/../bin`): download
   `sources.json app.apkeep.url` when missing, verify `sha256`, chmod. A
   mismatch is fatal and leaves nothing behind.
2. `apkeep -l -a <package> -d apk-pure` → newest version (numeric sort on the
   dotted parts). `--version` overrides.
3. Newest already in the index → `app: up to date (app V, data N)`, exit 0.
   `--check` stops here either way and prints what it would fetch.
4. Otherwise download into a fresh temp dir (`-o acknowledge_dangers=true`;
   the danger is a tampered package, which is why nothing in it is ever run),
   read the outer zip → base APK → `assets/dump.json` **in memory** (also
   accept a plain `.apk`). Reject unless: it parses, `metadata.data_version` is
   an int, `data` has ≥ 100 tables, `data.datasheet` ≥ 900 rows, size ≥ 20 MB.
   A rejected dump is never stored (exit 4).
5. Write the `.json.gz` (gzip mtime 0) and `index.json` atomically (tmp +
   rename), delete the package, print one line:
   `app: stored data N (app V, sha XXXXXXXX)`.
6. `--import PATH` takes an `.xapk`, `.apk` or bare `dump.json` from disk
   (the hand route when the download source is down: `adb pull` from a phone)
   through the same validation; `source: "import"`.
7. Every run rewrites `last-check.json`. `failingSince` is the time of the
   first failure of the current streak, `null` when `ok`. Network or
   download-source failure: exit 3. Stdout carries the one summary line;
   everything else goes to stderr.

### 11.4 `extract/app.mjs`  (W1)

```
node extract/app.mjs [--dump PATH(.json|.json.gz)] [--store /work/app-dumps] [--out /work/work/gdc.json]
```

Default dump: the index entry with the highest `dataVersion` (ties: newest
`fetchedAt`). Output is **exactly** the `work/gdc.json` of §4 as `gdc.mjs`
writes it: same top-level keys, the same 28 file ids from
`sources.json gdc.files`, each faction `{ file, id, name, parent_name,
compatibleDataVersion, updated, datasheets, stratagems, enhancements,
detachments, rules: { army, detachment } }`, every record in the GDC record
shape with `_slug`. Differences allowed at the top level only:
`from: "app"`, `ref: null`, `version` = the dump's `data_version`, `updated`
= the index entry's `fetchedAt`, and one new key

```
app: { package, appVersion, dataVersion, sha256, fetchedAt, source, lastCheck }
```

(`lastCheck` = the contents of `last-check.json`, or null.)

- English only is required (`{ en: … }`); other locales may be emitted when
  free, never at the cost of time.
- The dump has more datasheets than GDC publishes (1174 vs 1031 at 995).
  Every dump datasheet that is not emitted is counted under a **named rule**
  in `files.<file>.excluded` / top-level `excluded: { <rule>: n }`. No silent
  drops; no rule of the form "not in the GDC snapshot".
- The transform reads only the dump. It must not read `data/gdc/`, the golden
  set or a previous dataset — those are the oracle, and a transform that
  consults its oracle proves nothing. Name aliases go in `aliases.json` as
  today; there is no new hand file other than the accepted list in 11.6.
- GDC's converter is not published; the mapping is recovered from the pairs
  (dump N → GDC N). Where GDC evidently hand-edited or mis-converted, follow
  the **dump** and record the difference in the accepted list with the reason.

`build.mjs` gains only: `GDC_JSON=<path>` (env) to read a `gdc.json` from
somewhere other than `WORK/gdc.json`, and `manifest.sources.app` = the `app`
object above when present. `manifest.sources.gdc` keeps its shape (the
validator's freshness rule §6.6 reads `sources.gdc.version`).

### 11.5 Hard invariant: ids do not move

Saved armies, cloud sync and the cards site key on the dataset's ids. For the
same data version the app-derived dataset must carry **byte-identical**
`unit.id`, `detachment.id`, enhancement `id`, `stratagemIds` and
`_factionId` values, and the same 34 faction files. An id that cannot be
reproduced is a blocker to report, never something to put on the accepted
list.

### 11.6 Parity (the acceptance test)  (W1)

```
node tests/app-parity.mjs [--dump PATH] [--snapshot /app/data/gdc/11th/gdc] [--out DIR]
```

- **Level 1, records:** `work/gdc.json` from `gdc.mjs --from snapshot` vs from
  `app.mjs` for the same data version: per file, the datasheet / stratagem /
  enhancement / detachment / rule name sets, then every field `build.mjs`
  reads, deep-equal on the English value. Reports counts per field path.
- **Level 2, dataset:** `build.mjs` run twice with identical `mfm.json`,
  `dc.json`, `core-rules.json` and aliases, once per `gdc.json`; the 34 faction
  files compared deep. This is the level that decides.
- Writes `parity-report.json` + `parity-report.md` (per category: count, 10
  examples with faction/unit/path/baseline/ours). Exit 0 only when Level 2 has
  no difference outside `pipeline/app-parity-accepted.json`.
- Accepted list: `[{ match: { faction, unit?, path }, reason, verdict:
  "gdc-hand-edit" | "gdc-converter-bug" | "dump-newer" }]`. Each entry is one
  concrete difference (or one path pattern with a stated count), with evidence
  in `reason` a reader can check against the dump. It is reviewed line by
  line at sign-off; a broad pattern that swallows unexplained differences is
  a defect.

### 11.7 CLI and cron  (W2)

- `yaab-data fetch-app [--check] [--import PATH [--app-version V]]` runs
  11.3 against `$YAAB_DATA_DIR/app-dumps`.
- `yaab-data build [--source app|gdc]`, default `sources.json primary`.
  `app`: `== fetch app` (a failed fetch is a WARN and the build continues from
  the newest stored dump; fatal only when no dump is stored), then
  `== extract app` (`extract/app.mjs`), then mfm / 40kdc / build as today.
  `gdc`: today's path, untouched.
- `report.mjs` prints one source line from `manifest.sources.app` when
  present: `App source: app V, data N, fetched <date>; last check <date> ok`
  (or `FAILED: <error>`), and a first line `**APP SOURCE UNREACHABLE since
  <date>**` when `lastCheck.failingSince` is more than 3 days before
  `builtAt`.
- `~/sites/base/yaab-data-daily.sh`: a candidate identical to current is
  discarded without mail, so a download source that dies would be silent.
  After the build, read `app-dumps/last-check.json`; when `failingSince` is
  ≥ 3 days old, mail `[yaab data] APP SOURCE UNREACHABLE since <date>` on day
  3 and every 7th day after (never daily), honouring `YAAB_DATA_NO_MAIL`.
  Missing file → nothing.

### 11.8 Not in phase 1

Building natively from the relational tables (structured wargear choices,
unit compositions, attachments, allies and dispositions, which would retire
the prose parser and the 40kdc pin), core-rule text from the dump's
`rule_container` tables, package signature verification and a second
download source. Each has an issue in `stopsign002/yetanotherarmybuilder`.
