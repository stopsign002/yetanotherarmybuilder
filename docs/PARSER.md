# Parser (`js/parser/`)

The parser is the riskiest part of the codebase to modify — every UI path, export format, and cache key depends on its output shape.

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

Do not change this shape without bumping `DB_VERSION` in `js/db.js`. Parsed factions are persisted in IndexedDB across sessions; the `onupgradeneeded` handler drops both `factions` and `gst` stores on a version bump. NOT bumping leaves users reading stale cached JSON that lacks the new field, and the mismatch will silently misrender.

## Module map

| File | Role |
|---|---|
| `shared-index.js` | Three `Map`s (`sharedProfilesById`, `sharedRulesById`, `sharedEntriesById`) + `addToSharedIndex(xml)` / `releaseSharedIndex()`. Attaches to `P._internal`. |
| `classify.js` | `cleanText` (strips `**`, `^^`, `__`, `~~`), `isCrusadeSection`, `getAttr`, `classifyProfile` (→ `'stats'` / `'weapon'` / `'ability'` / `'other'`). |
| `stats.js` | `parseCharacteristics`, `parseDirectProfiles`, `statsFromInfoLinks`, `findStats` (recurses into child `model`/`unit` entries and through `entryLinks`, depth-capped at 4). |
| `weapons.js` | `collectWeapons` (recurses children/entryLinks, depth-capped at 6, visited-set breaks cycles). `findWeaponKeywordDesc` handles parameterized keywords like `"Sustained Hits 2"`, `"Anti-Titanic 4+"` (strip trailing digits/+), and `"Melta "` trailing-dash prefixes. |
| `abilities.js` | `collectAbilities` (depth-capped at 3). Pulls direct profile abilities, `infoLink type="profile"` into shared profiles, and `infoLink type="rule"` into shared rules (flagged `isCore: true` — this is how Deep Strike / Deadly Demise surface). Supports `modifier field="name" type="append"` on rule infoLinks. |
| `wargear.js` | Two categories: **Category A** model-variant groups (squad-sizing constraint + contained model entries) walked to surface per-model `subOptions`. **Category B** direct `selectionEntryGroup` choice groups at unit level. Filters hidden, Crusade, and `New ...` placeholders. |
| `costs.js` | Four-pattern cost + model-count detection. See below. |
| `keywords.js` | `parseKeywords` reads `categoryLinks > categoryLink` (skips `New category` placeholders). Also exports generic `dedup(arr, key)`. |
| `entry.js` | `parseEntry` assembles one `Unit` object. Extracts `invulnSave` from either stats `INV` / `Invulnerable Save` or from an ability with `/invulnerable\s+save/i`. Filters out ability objects whose name matches a weapon-keyword the unit already carries (avoids duplicating Deep Strike etc. when weapons reference the same rule by name). |
| `catalogue.js` | `buildIndexes` copies the shared Maps and overlays catalogue-local `sharedSelectionEntries` / `sharedProfiles` / `sharedRules` / `rules`. `parse` walks Pattern A (`selectionEntries`) and Pattern B (root `entryLinks` → sharedSelectionEntries) unit sources, extracts detachments, enhancements-by-detachment, and army rules (with detachment-rule de-duplication by both id and lowercased name). |
| `index.js` | Loads LAST. Copies `P._internal.parse`, `P._internal.addToSharedIndex`, `P._internal.releaseSharedIndex` onto the public `P`. |

## Cost patterns (A/B/C/D)

All in `parser/costs.js::findCosts`. They run in order; the first one that yields non-null `min`/`max` wins.

- **Pattern A** (lines ~36–42): per-group `constraints > constraint[type="min"|"max"]` directly on a `selectionEntryGroup`. This is the standard BSData squad-size pattern (`min: 5, max: 10`).
- **Pattern B** (lines ~44–58): if a group has no direct constraint but contains per-model `selectionEntry[type="model"]` each with its own `constraint`, sum them. Used when a squad has multiple distinct model entries (leader + bodies) each size-capped individually.
- **Pattern C** (lines ~64–73): entry-level `constraints > constraint` on the unit entry itself. Used for single-model units and some characters.
- **Pattern D** (lines ~75–89): if the entry has no constraints but its direct `selectionEntry[type="model"]` children do, sum those.

Then `basePts` comes from the entry's own `costs > cost[name="pts"|"points"]`. Squad-variant prices come from `modifier[type="set"][field=<ptsTypeId>]` children under the entry — this is how "5 for 90 / 10 for 170" surfaces. Sorted ascending into `squadOptions`.

Finally, if `basePts === 0` and nothing was extracted, the code walks `selectionEntryGroup > entryLinks > entryLink` looking for `cost` on the link or on the target.

## The shared index

Catalogue `entryLink`s routinely resolve into `sharedSelectionEntries` defined in the game-system file (e.g. `Warhammer 40,000 10th Edition.gst`) or in library catalogues (`Library - Tyranids.cat`). The shared index exists so a per-catalogue parse can resolve those refs.

- **Seeded** by `BSData.loadAllFactions` in two phases:
  - **Phase 1**: every `.gst` file.
  - **Phase 1.5**: every catalogue whose filename matches `^library[\s-]` (case-insensitive).
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
