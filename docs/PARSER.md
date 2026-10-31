# Parser (`js/parser/`)

> **DORMANT — kept for rollback.** The BattleScribe XML parser in `js/parser/` no longer runs at runtime (scheduled for removal in `pipeline/retire-v1.md`; blocked until the loader keeps the `WahapediaParser._internal.foldKey` stub). Live data is the v2 dataset: the pipeline in `pipeline/` builds one JSON file per faction under `data/dataset/current/` from GDC + MFM (plus a pinned 40kdc snapshot for wargear structure, allies and dispositions), and `js/data/dataset-loader.js` installs them as `window.BSData.loadAllFactions()`. See `docs/DATASET.md`.
>
> **The output shape documented in this file is still the authoritative contract.** The dataset builder (`pipeline/build.mjs`) emits exactly this Unit / faction object shape (plus the 11e fields under "Adapter additions" below — the heading is historical; the builder now produces them), so the reference here stays valid for every renderer. Source ownership per field is in `docs/DATASET.md` §3, not here.

The (dormant) parser was the riskiest part of the codebase to modify — every UI path and export format depends on its output shape, which the dataset builder now reproduces.

## Input and output shape

**Input**: BattleScribe XML string + filename (e.g. `"Necrons.cat"`).

**Output** (from `WahapediaParser.parse(xml, filename)`):

```
{
  factionName:      string,
  filename:         string,
  unitCount:        number,
  units:            Unit[],
  armyRules:        [{ name, description }, ...],
  detachments:      [{ name, rules:[{name, description}], enhancements:[{name, pts, description}] }, ...],
  linkedCatalogues: string[]
}
```

Each `Unit`:

```
{
  id:             string,
  name:           string,
  type:           string,                    // "unit" | "model"
  stats:          { [name]: string },        // M, T, SV, W, LD, OC, INV, ...
                                             //   from the FIRST stats profile (matches modelStats[0])
  modelStats:     [{ name, M, T, SV, W, LD, OC, ... }, ...],
                                             //   one entry per distinct statline; multi-profile
                                             //   units (Marneus Calgar + Victrix Honour Guard,
                                             //   Terminator Assault Squad TH/SS vs LC) carry 2+
  invulnSave:     string | null,             // e.g. "4+"
  weapons:        Weapon[],                  // plain objects; `_typeName`, `_keywordDefs` present
  abilities:      Ability[],                 // { name, description, isCore? }
  keywords:       string[],
  wargearOptions: WargearOption[],           // { type: 'model' | 'choice', ... }
  points:         number,                    // lowest pts option
  pointsOptions:  number[],                  // all costs (e.g. [90, 170] for 5/10-model squads)
  squadOptions:   [{ pts, models }, ...],    // sorted ascending by pts
  description:    string
}
```

This shape is a contract every renderer consumes — the dataset files emit it. Don't break it. (There is no faction IndexedDB cache: factions are fetched from `data/dataset/` on every load, so changing a field does NOT require a `DB_VERSION` bump.)

## Adapter additions (11th edition)

The dataset builder emits the shape above plus these fields (originally added by the v1 adapter; now computed in `pipeline/build.mjs` from MFM and GDC, v1 notes kept for history), all driven by 11e's two-dimensional points (squad size AND per-army-ordinal pricing):

- **`unit.ordinal = { fromCount, surcharge } | null`** — 11e per-army scaling. About 40% of units (397 of 1,006 own units on 2026-10-30) cost a flat `surcharge` more per copy starting at the `fromCount`-th in your army (always 2 tiers: "your 1st–Nth cost base, (N+1)th+ cost base+surcharge"). `null` when the unit doesn't scale. Derived by the builder from MFM's `unit_count_min`/`unit_count_max` bands (v1 computed it in `parsePoints()` from 40kdc `points[]`).
- **`unit.squadOptions`** — now one BASE cost per distinct squad size (`{ pts, models }`), with the ordinal surcharge factored OUT into `unit.ordinal`. Sorted ascending.
- **`unit.pointsOptions`** — sorted unique BASE costs (de-duped from `squadOptions`).
- **`detachment.gdcStratagems`** — the stratagem list (GDC `stratagems`; `stratagemIds` come from 40kdc ids when a join exists, else `gdc:<slug>`). **v1 history, not current behaviour:** it was the product of `reconcileStrats()`, which ran after a browser-side GDC overlay. For a **GDC-authoritative** faction (`GDC_AUTHORITATIVE`) GW's list simply replaces 40kdc's. Otherwise 40kdc decides which stratagems exist: each 40kdc row is matched to GDC by folded name (a textless row with no exact match may borrow the nearest unique, close GDC name in the same detachment — "Soul-tally Offering" ↔ "Soul-Tally Offerings"), takes 40kdc text when it is a complete WHEN/EFFECT card and GDC's otherwise, and GDC-only strats are **dropped** — except when GW's set is a strict superset of 40kdc's, in which case GW's extras are appended. `js/ui/faction-rules.js` renders this into `#army-strats-list`.
- **`unit.wargearProfile.alwaysCost`** — flat per-squad wargear points, charged on every copy. Only ids in the validator's `ALWAYS_COST_ALLOWLIST` (v1: `ALWAYS_COST_ITEMS`) (today: Victrix Honour Guard's banner) can land here; any other priced item that no option or default reaches stays in `itemCosts` but is billed nowhere and warned once per unit in the console. A generic upstream id shadowed by a reachable per-unit overlay id (`meltagun` vs `meltagun-dominion-squad`) is dropped from `itemCosts`.
- **`unit._unpriced`** — `true` when no source prices the unit (no MFM entry, no upstream points). Such a unit is also `isLegends: true`, so it is hidden by default rather than offered at 0 pts.
- **`unit._allyNoEnhancements`** (allied rows only) — `true` when every allied rule granting the row says it cannot take Enhancements; `js/ui/detail.js` offers it none.
- **Stat fixes** (`UNIT_STAT_FIXES`, `DC.statFixes`) patch profiles: a fix row with a `name` patches the profile of that name, otherwise the profile at the same index, and profiles the fix does not mention are kept. Only `replaceProfiles: true` replaces the whole list.

The army model consumes `unit.ordinal`: `js/army.js` `getEntryPoints`/`getEntryOrdinalSurcharge` charge the surcharge on copies past the threshold (counted across all entries of a datasheet), and `js/ui/detail.js` shows an explicit two-band note for scaling units.

## Module map

| File | Role |
|---|---|
| `shared-index.js` | Three `Map`s (`sharedProfilesById`, `sharedRulesById`, `sharedEntriesById`) + `addToSharedIndex(xml)` / `releaseSharedIndex()`. Attaches to `P._internal`. |
| `classify.js` | `cleanText` (strips `**`, `^^`, `__`, `~~`), `isCrusadeSection`, `getAttr`, `classifyProfile` (→ `'stats'` / `'weapon'` / `'ability'` / `'other'`). |
| `stats.js` | `parseCharacteristics`, `parseDirectProfiles`, `statsFromInfoLinks`, `findStats` (recurses into child `model`/`unit` entries and through `entryLinks`, depth-capped at 4). Plus `parseDirectStatProfiles` / `statProfilesFromInfoLinks` / `findStatProfiles` which return the array of all stat profiles instead of merging — feeds `unit.modelStats` for multi-statline units. `findStats` is now a thin wrapper around `findStatProfiles[0]`, so the FIRST profile wins instead of the last (the previous Object.assign-merge silently corrupted Marneus Calgar's stats with Victrix Honour Guard's). |
| `weapons.js` | `collectWeapons` (recurses children/entryLinks, depth-capped at 6, visited-set breaks cycles). `findWeaponKeywordDesc` handles parameterized keywords like `"Sustained Hits 2"`, `"Anti-Titanic 4+"` (strip trailing digits/+), and `"Melta "` trailing-dash prefixes. |
| `abilities.js` | `collectAbilities` (depth-capped at 3). Pulls direct profile abilities, `infoLink type="profile"` into shared profiles, and `infoLink type="rule"` into shared rules (flagged `isCore: true` — this is how Deep Strike / Deadly Demise surface). Supports `modifier field="name" type="append"` on rule infoLinks. |
| `wargear.js` | Two categories: **Category A** model-variant groups (squad-sizing constraint + contained model entries) walked to surface per-model `subOptions`. **Category B** direct `selectionEntryGroup` choice groups at unit level. Filters hidden, Crusade, and `New ...` placeholders. |
| `costs.js` | Four-pattern cost + model-count detection. See below. |
| `keywords.js` | `parseKeywords` reads `categoryLinks > categoryLink` (skips `New category` placeholders). Also exports generic `dedup(arr, key)`. |
| `entry.js` | `parseEntry` assembles one `Unit` object. Extracts `invulnSave` from either stats `INV` / `Invulnerable Save` or from an ability with `/invulnerable\s+save/i`. Filters out ability objects whose name matches a weapon-keyword the unit already carries (avoids duplicating Deep Strike etc. when weapons reference the same rule by name). |
| `catalogue.js` | `buildIndexes` copies the shared Maps and overlays catalogue-local `sharedSelectionEntries` / `sharedProfiles` / `sharedRules` / `rules`. `parse` walks Pattern A (`selectionEntries`) and Pattern B (root `entryLinks` → sharedSelectionEntries) unit sources, extracts detachments, enhancements-by-detachment, and army rules (with detachment-rule de-duplication by both id and lowercased name). |
| `index.js` | Loads LAST. Copies `P._internal.parse`, `P._internal.addToSharedIndex`, `P._internal.releaseSharedIndex` onto the public `P`. |

## Cost patterns (A/B/C/D/F + recursion)

All in `parser/costs.js::findCosts`. Groups are processed by the `processGroup` inner function which runs Patterns F → A → B in order; if all yield nothing it **recurses into child `selectionEntryGroup`s**. This recursion is what makes units like Skorpekh Destroyers work — they wrap their "3-6 Bodies" sub-group inside an outer "Unit Composition" group that carries no constraints itself.

- **Pattern F**: group contains `selectionEntry[type="upgrade"]` entries that each represent a composition choice (Squighog Boyz / Gretchin). Follows each upgrade's `entryLinks > entryLink` to a model/unit target and reads the link-level constraints. Takes the min of all option-mins and max of all option-maxes.
- **Pattern A**: per-group `constraints > constraint[type="min"|"max"]` directly on a `selectionEntryGroup`. This is the standard BSData squad-size pattern (`min: 3, max: 6`).
- **Pattern B**: if a group has no direct constraint but contains per-model `selectionEntry[type="model"]` each with its own `constraint`, sum them. Used when a squad has multiple distinct model entries (leader + bodies) each size-capped individually.
- **Recursion**: if F/A/B all yield nothing for a group, walk `:scope > selectionEntryGroups > selectionEntryGroup` children and accumulate their results.
- **Pattern C**: entry-level `constraints > constraint[field="selections"]` on the unit entry itself. Restricted to `field="selections"` to avoid treating Crusade-specific constraints (Battle Honours `max=3`, Weapon Modifications, etc.) as model counts. Used for single-model units and some characters.
- **Pattern D**: if the entry has no constraints but its direct `selectionEntry[type="model"]` children do, sum those.

Then `basePts` comes from the entry's own `costs > cost[name="pts"|"points"]`. Squad-variant prices come from `modifier[type="set"][field=<ptsTypeId>]` children under the entry — this is how "5 for 90 / 10 for 170" surfaces. Sorted ascending into `squadOptions`.

Finally, if `basePts === 0` and nothing was extracted, the code walks `selectionEntryGroup > entryLinks > entryLink` looking for `cost` on the link or on the target.

## The shared index

Catalogue `entryLink`s routinely resolve into `sharedSelectionEntries` defined in the game-system file (e.g. `Warhammer 40,000 10th Edition.gst`) or in library catalogues (`Library - Tyranids.cat`). The shared index exists so a per-catalogue parse can resolve those refs.

- **Seeded** by `BSData.loadAllFactions` in two phases:
  - **Phase 1**: every `.gst` file.
  - **Phase 1.5**: every catalogue whose filename contains the word `library` (case-insensitive, `\blibrary\b`). This catches both "Library - X" and "X - Library" naming conventions.
- Each call to `addToSharedIndex(xml)` stuffs `root > sharedProfiles > profile`, `root > sharedRules > rule` / `root > rules > rule`, and `root > sharedSelectionEntries > selectionEntry` / `sharedSelectionEntryGroups > selectionEntryGroup` into their respective `Map<id, Element>`.
- **Consumed** during Phase 2 by `catalogue.js::buildIndexes`, which clones the Maps and then overlays any catalogue-local shared entries.
- **Released** by `WahapediaParser.releaseSharedIndex()` once `loadAllFactions` finishes. This is important: each retained element holds its entire XML `Document` alive through `ownerDocument`. Clearing these Maps lets `DOMParser`-produced docs be garbage-collected.

## Crusade filtering

`CRUSADE_RE = /crusade|battle\s+honour|battle\s+scar|battle\s+trait|^enhancement|psychic\s+tradition/i` in `classify.js`. `isCrusadeSection(name)` is checked at every recursive walk (weapons, abilities, wargear, unit-entry, detachment, enhancement). Removing this floods standard 10e output with Crusade-only content. The `^enhancement` anchor stops the regex from matching Enhancement detachment-upgrade entries (which are prefixed with faction names and handled separately in `catalogue.js`).

## Debugging tips

- **Test a single catalogue in the browser**: load the app in a tab (so the shared index is populated), then in DevTools:
  ```
  const xml = await BSData.fetchFile('Necrons.cat');
  const faction = WahapediaParser.parse(xml, 'Necrons.cat');
  console.log(faction.units.find(u => u.name === 'Immortals'));
  ```
- **Missing weapons or abilities on a unit**: the unit probably references a `sharedSelectionEntry` that lives in a library catalogue. Confirm the library was loaded (check the Phase 1.5 filter regex against the actual filename) and that `WahapediaParser._internal.sharedEntriesById.size > 0` before catalogue parsing begins.
- **IndexedDB stale after a parser change**: bump `DB_VERSION` in `js/db.js`. Do not edit cached values by hand. To force-clear from devtools: `BSData.clearFactionCache()`.
- **Cycle / depth-limit bailout**: if a faction silently loses abilities or weapons on deeply-nested units, check the `depth >` guards in `findStats` (4), `collectWeapons` (6), `collectAbilities` (3). Raise carefully — the guards exist because BSData has legitimate cycles.

## What NOT to touch

- The depth limits in `findStats`, `collectWeapons`, `collectAbilities`. Raising blows up parse time; lowering drops content.
- The `visited` id-sets inside `collectWeapons` and `collectAbilities`. They break cycles (entry A → entry B → entry A) in BSData catalogue graphs.
- The `releaseSharedIndex` call site. Holding DOM refs longer than Phase 2 leaks tens of MB per tab.
- Do not re-introduce any long-lived references to parsed XML elements. Anything stored globally must be plain JSON.
- The detachment-rule dedup-by-lowercased-name filter in `catalogue.js` (army-rules block). Without it, detachment rules also appear under Army Rules.
