# build/ — 40kdc data bundle source

Produces `../js/vendor/dc-bundle.js`, the embedded 40kdc 11th-edition dataset +
ability-text store exposed as `window.DC`. Consumed by `../js/data/dc-adapter.js`,
which maps it into yaab's parser shape and overrides `window.BSData`.

This is the ONE build step in an otherwise buildless app. The committed
`dc-bundle.js` is the artifact the site loads; rebuild it only when bumping the
40kdc dataset or editing `dc-entry.mjs`.

## When a new MFM (Munitorum Field Manual) drops

`~/sites/base/refresh-40kdc.sh` re-scrapes mfm.warhammer-community.com every
run and rebuilds the bundle. It runs as **stage 1 of
`~/sites/base/yaab-pipeline.sh`, cron `35 4 * * 1` — weekly, Mondays 04:35 UTC**
(it was a nightly 04:45 cron until 2026-09-10), so a new MFM is picked up on the
next Monday run *unless the refresh is frozen*.

**It is frozen right now.** `~/sites/base/DATA-FREEZE` has existed since
2026-09-17 (owner decision: unit-datasheet data is applied by hand as codexes
come out). While that file exists stage 1 — the whole refresh, MFM points and
wargear costs included — logs `refresh skipped (DATA FREEZE)` and exits 0, and
the pipeline reports "frozen" instead of "no-change". Nothing picks a new MFM up
automatically until the file is removed (or you override for one run). To pull it
now, deliberately:

```
DATA_FREEZE_OVERRIDE=1 ~/sites/base/refresh-40kdc.sh
tail -25 ~/sites/base/refresh-40kdc.log
```

(`FORCE_REFRESH=1`, which older notes show here, was removed — it gated nothing.
Under the freeze the script exits before doing anything without
`DATA_FREEZE_OVERRIDE=1`.)

The last log lines print the scrape + validation summary. Sanity check them
against the previous run:

- `mfm wargear scrape rc=0` — non-zero rc means the scrape failed and the
  script kept the last-known-good overlay (`~/sites/base/mfm-wargear-costs.json`).
  MFM site down or page format drift — investigate `mfm-scrape-wargear.py`.
- `matchRate` near `1.0` and `pairs` roughly ≥60 — big drop = new unit names
  the alias map doesn't cover. Look for `UNMATCHED` rows in the scrape output
  (also in the emailed summary) and add entries to
  `~/sites/base/mfm-aliases.json`, then re-run.
- `pointsUnits` well above the `700` gate — a large drop means the ordinal /
  composition parsing missed something in the new MFM layout.
- `validation ok: {"ok":true,...,"shapeProblems":0}` — must be present. If
  absent, the script aborted before deploying and the previous bundle is still
  live.
- `armyRuleFactions` equal to `factions`, with `armyRuleNo40kdc` and
  `armyRuleNoText` both `[]`. The first lists factions whose 40kdc-sourced
  army rule came out empty BEFORE the GDC merge; the second lists factions that
  would render an empty Army Rules panel after it. Either non-empty fails the
  gate (homewebhost#40) — on 2026-10-05 upstream renamed `faction_rule_id` to
  `faction_rule_ids`, every faction's rule became `[]`, GDC back-filled all but
  Orks, and the old validator let it deploy. A faction named here means an
  upstream field rename or shape change — fix `buildArmyRules()` in
  `js/data/dc-adapter.js`, not the data.
- `deployed new bundle md5=...` followed by `pushed` — bundle changed and
  went live. `no change` means MFM produced the same data as last run.

The script auto-commits `js/vendor/dc-bundle.js` + `build/abilities-index.json`
and emails a summary via the mailer. Caddy's `no-cache` header makes the new
bundle reach users on the next page load — no changelog entry or version bump
is needed. The deploy does re-stamp `index.html` with a **data-only** stamp
(`stamp-assets.mjs --data <bundle-md5>`, a `-d<md5-8>` suffix on `?v=`; see
`CLAUDE.md` "HTTP caching") so proxy caches pick the new bundle up; the
pipeline stamps once at the end of the run.

## Files
- `dc-entry.mjs` — esbuild entry; imports the 40kdc collections + `abilities-index.json`.
- `abilities-index.json` — the `wn-mitch/40kdc-abilities` text store (`ability_id → raw_text`).
- `package.json` — pins `@alpaca-software/40kdc-data`.

## Source of truth: build from the 40kdc git repo, NOT npm

The published npm release lags `main` and ships mostly `pre-launch-provisional`
points. The committed `dc-bundle.js` is therefore built from the **40kdc-data git
`main`** (confirmed `launch` dataslate), which also carries far more stratagems /
enhancements than npm. Last built from `wn-mitch/40kdc-data` @ `c166929`.

### Rebuild from git main (no host node — use Docker)
```
# 1. clone + build the dataset package from source
gh repo clone wn-mitch/40kdc-data -- --depth 1
cd 40kdc-data
docker run --rm -v "$PWD":/work -w /work/tools -u "$(id -u):$(id -g)" \
  -e HOME=/work/tools node:22-alpine sh -c \
  'npm install --silent && npm run codegen:data && npx tsc -p .'
# → builds tools/dist with main's data embedded

# 2. bundle it (point the entry's dependency at file:../40kdc-data/tools)
#    package.json: { "dependencies": { "@alpaca-software/40kdc-data": "file:../40kdc-data/tools" } }
docker run --rm -v "$PWD/..":/work -w /work/build -u "$(id -u):$(id -g)" \
  -e HOME=/work/build node:22-alpine sh -c \
  'npm install --silent && npx --yes esbuild@0.24.0 dc-entry.mjs --bundle \
   --format=iife --platform=browser --outfile=/work/js/vendor/dc-bundle.js'
```

### Quick rebuild from npm (provisional points — fallback only)
```
cd app
docker run --rm -v "$PWD":/work -w /work/build -u "$(id -u):$(id -g)" \
  -e HOME=/work/build node:22-alpine sh -c \
  'npm install --silent && npx --yes esbuild@0.24.0 dc-entry.mjs --bundle \
   --format=iife --platform=browser --outfile=/work/js/vendor/dc-bundle.js'
```

## Refresh the ability-text store (when 40kdc-abilities updates)
```
gh api repos/wn-mitch/40kdc-abilities/contents/index.json \
  -H "Accept: application/vnd.github.raw" > build/abilities-index.json
# then rebuild
```

## Faction-scoped ability text (contract, 2026-09-14)

**The bug.** `wn-mitch/40kdc-abilities` publishes a flat `index.json`
(`ability_id → { faction, raw_text }`) and a full `<faction>.json` per faction.
Ability ids are bare slugs, and **203 ids exist under more than one faction**.
Where the text differs the flat index keeps whichever faction wrote last:
`spiritual-leader` is the Space Marine Chaplain's ability AND the Genestealer
Cults Magus's, and the index held the GSC text, so the Chaplain's card read
"select one friendly GENESTEALER CULTS unit…". The per-faction files are correct.

**The fix.** `abilities-index.json` is now built by `refresh-40kdc.sh` from the
per-faction files, not fetched, and the adapter looks text up faction-first.

### Index shape (`build/abilities-index.json`, embedded in the bundle as `DC.abilityText`)

```
{
  "<ability_id>":               { faction, raw_text?, when?, target?, effect?, restrictions? },   // flat, as before
  "<faction_id>/<ability_id>":  { faction, raw_text?, when?, target?, effect?, restrictions? }    // scoped, ONLY for ids present in >1 faction
}
```

- Source of truth: every `<faction>.json` in the store's repo root (42 files;
  `README.md` and `index.json` are not factions). Each is a JSON array of
  records with `ability_id`, `faction_id`, and any of `raw_text`, `when`,
  `target`, `effect`, `restrictions`. Copy exactly those text fields (only the
  ones present) plus `faction` = `faction_id`. Nothing else — the flat entries
  must keep the shape the adapter already reads.
- **Flat winner for a shared id:** the `core` faction's record if there is
  one, else the alphabetically-first `faction_id`. Deterministic, so the index
  only changes when upstream does (md5 change-detection stays meaningful).
- **Scoped entries** are emitted for every faction's record of every id that
  appears in more than one faction — including the winner's — and for nothing
  else. Expected: ~240 ids, a few hundred scoped keys, well under 200 KB extra.
- **EXCEPT ids present in the upstream abilities repo's `core.json`** (17 of them: deep-strike, the
  deadly-demise-* and feel-no-pain-* family, stealth, scouts-6, infiltrators,
  lone-operative, fights-first, hover, firing-deck-*, super-heavy-walker):
  those get NO scoped entries at all. The core text IS the rule; the faction
  copies are restatements at best and stubs at worst — death-guard's
  `deep-strike` is literally the string `CORE: Deep Strike`. Faction-first
  lookup on those would be a regression, so the flat (core) entry stays the
  only one.
- **Two dedupes, measured 2026-09-14** (1820 scoped keys / +680 KB without
  them; 126 keys / +36 KB with them):
  - a scoped entry whose text fields are identical to the flat winner's is
    NOT emitted — the lookup falls through to the flat entry and gets the same
    text, so the copy is dead weight;
  - the 11 SM chapter factions (`black-templars`, `blood-angels`, `dark-angels`,
    `deathwatch`, `imperial-fists`, `iron-hands`, `raven-guard`, `salamanders`,
    `space-wolves`, `ultramarines`, `white-scars`) get NO
    scoped entries. Their files are `**bold**`-marked copies of the Space
    Marine stratagems; the adapter's chapter step resolves them through
    `adeptus-astartes/<id>` (or the flat entry), which is what the live site
    served them before this change. `ui/helpers.js` renders `**` fine, so
    this is purely a size decision.
- A faction file that fails to download or parse **fails the run** (`fail`),
  same as the old single fetch did. No partial index.
- Store the fetched faction files under `$WORK/abilities/` for the run only.

### Adapter lookup (`js/data/dc-adapter.js`)

`textFor(id, factionId)` and `stratTextFor(id, factionId)` take an optional
faction and try, in order:

1. `DC.abilityText[factionId + '/' + id]`
2. if `factionId` is a chapter (`App.CHAPTER_PARENTS[factionId]` is set, or the
   faction is one of the SM chapter ids in the adapter's own faction-name map),
   `DC.abilityText['adeptus-astartes/' + id]`
3. `DC.abilityText[id]` — the flat entry, exactly today's behaviour

Every call site that has a unit/enhancement/stratagem/detachment with a
`faction_id` in scope passes it. Call sites with no faction in scope (weapon
keyword text, hand-injected core abilities by bare id) pass nothing and get the
flat entry. No call site changes its output unless the scoped key exists.

### Done means

- `python3`/`node` check in the scratch dir: the built index has
  `adeptus-astartes/spiritual-leader` containing "ADEPTUS ASTARTES",
  `genestealer-cults/spiritual-leader` containing "GENESTEALER CULTS", flat
  `spiritual-leader` = the alphabetically-first faction (adeptus-astartes),
  flat `deep-strike`.faction = `core`, and every flat key from the old
  `index.json` is still present.
- Live site after the refresh deploys: Space Marines → Chaplain card shows the
  ADEPTUS ASTARTES text; GSC → Magus still shows the GENESTEALER CULTS text;
  a non-colliding ability (Chaplain's "Leader"/core text) unchanged.
- `refresh-40kdc.sh` mirrored to `~/server-cron/scripts/base/` and pushed.
- Changelog entry in `js/data/changelog-data.js`; assets re-stamped.
