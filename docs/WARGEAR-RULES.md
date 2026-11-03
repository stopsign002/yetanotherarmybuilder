# Wargear rules — parse the datasheet prose, enforce it in the picker (contract, 2026-11-03)

Owner request: the Wargear inventory must only allow what the datasheet
allows ("test it on Plague Marines, they are super complicated"). Today the
options come from the pinned 40kdc snapshot's `wargear_options[].model_constraint`,
which merges rules (Plague Marines' five different boltgun swaps become one
"any number" option), knows nothing of "up to 2 per 5", mutual exclusivity,
"cannot be replaced" locks or footnotes, and is 10th-edition data. GDC
carries the exact 11th wording per datasheet in `unit.gdcWargear[]`
(2,394 lines over all factions, ~20 phrasings). This pass parses that prose
into structured rules and makes the picker obey them. Points (MFM
`itemCosts`) are unchanged.

## 1. Schema — `unit.wargearProfile.rules[]` (replaces `options[]`; W-P writes, W-C reads)

```
rule = {
  id: "<unit.id>-wr-<n>",          // n = 1-based index of the source line; stable across builds
  text: "<the source line verbatim>",
  kind: "replace" | "add",          // add = "can be equipped with" (nothing removed)
  model: "<model type name>" | null, // null = single-model unit ("This model…") or unit-wide ("All models…")
  scope: "per_n" | "fixed" | "any", // how max is read
  n: 5,                             // per_n only: "For every N models"
  max: 2,                           // per_n: K per N (floor(size / n) * K); fixed: absolute; any: ignored
  replaces: [{id,name}, ...],       // AND: every listed item leaves the model ("boltgun and power weapon")
  choices: [[{id,name}, ...], ...], // OR of AND-bundles ("1 autopistol and 1 chainfist" is one bundle)
  requires: [{id,name}, ...],       // "equipped with a boltgun can be equipped with…" / "If this model is equipped with…"
  locks: [{id,name}, ...],          // "This model's boltgun cannot be replaced" → the taker's listed items are locked
  exclusiveWith: ["<rule id>", ...],// footnote "*You cannot select both of these options for the same model" /
                                    // "The same model cannot be equipped with more than one of these wargear options"
  condition: { minModels: 10 } | null // "If this unit contains N or more models, …"
}
profile.unparsed: ["<line>", ...]   // lines the parser could not turn into a rule (shown as prose, not enforced)
```

Item `{id,name}` uses the sheet's own weapon/wargear names: `name` as printed
on the datasheet (first-letter case as in `unit.weapons[].name` /
`wargearAbilities[].name`), `id` = the existing kebab id when 40kdc has one
for that name on this sheet, else `kebab(name)`. A choice item whose name
matches no weapon row and no wargear ability is still emitted (the picker
shows it; the export emits it as a Wargear ability) and logged under
`log.wargearItemUnmatched`.

Composition (`modelsBySize`, `defaultsBySize`) stays as built today, but
**default loadouts now come from `gdcComposition`'s "equipped with" lines
when present** ("Every model is equipped with: …", "The Plague Champion is
equipped with: …"), 40kdc defaults only as fallback — so defaults and rules
agree on names. `options[]` is no longer emitted. `budgets[]` is dropped.

## 2. Parser (W-P, `pipeline/wargear-rules.mjs`, called from `build.mjs` `wargearProfile()`)

Pure function `parseWargearRules(lines, ctx) -> { rules, unparsed }` where
`ctx = { unitId, modelNames: [...], itemNames: [...], singleModel: bool }`.
Phrasings to cover (counts over the current dataset in brackets):

- `This model's X can be replaced with (one of the following: ◦ A ◦ B | 1 A)` [711] → replace, model null, fixed max 1.
- `This model can be equipped with (1 A | up to N A | one of the following: …)` [379] → add, fixed max 1 or N; "up to N A" = max N of the single choice.
- `For every N models in this unit, 1 <M>'s X can be replaced with …` [158] → replace, per_n, max 1.
- `For every N models in this unit, up to K <M> can each have their X replaced with …` [55] → per_n, max K.
- `For every N models in this unit, (1|up to K) <M> can (each )?be equipped with …` [18] → add, per_n.
- `Any number of <M> can each have their X replaced with …` [152] → replace, any.
- `Any number of <M> can each be equipped with …` [22] → add, any.
- `The <M>'s X can be replaced with …` [127] / `The <M> can have their X replaced with …` → replace, model M, fixed max = (count of M in the unit, read at pick time) → emit `scope:"fixed", max:null` meaning "every model of that type".
- `The <M> can be equipped with (1|up to N) A` [67] → add, model M, fixed.
- `1 <M>('s X can be replaced with | can have (its|their) X replaced with | can be equipped with) …` [many of the 585 unmatched] → fixed max 1 on model M.
- `Up to N <M> can each …` [42] → fixed max N.
- `All (of the )?models in this unit can each have their X replaced with …` [26] → any, model null.
- `One <M> (equipped with X) can be equipped with 1 A. This model's X cannot be replaced.` [6] → add, fixed 1, requires X, locks X.
- `If this unit contains N or more models, …<any of the above>` [21] → condition.minModels.
- `If this model is equipped with X, its Y can be replaced with …` → requires X.
- `… X and Y replaced with …` → replaces AND; `◦ 1 A and 1 B` → bundle choice.
- Footnotes `*You cannot select both of these options for the same model.` /
  `The same model cannot be equipped with more than one of these wargear options.`
  apply `exclusiveWith` to the rules marked `*` (or, without asterisks, to
  the immediately preceding rules back to the previous blank/unmarked one).
- `Each model's`, `Every model's` → any, model null. `its`/`their` are
  interchangeable; curly and straight apostrophes both; "weapon" plurals
  ("bubotic weapons") are names, not plurals.

Numbers: "1", "2", "up to 2", "one", "two". Model names: longest match from
`ctx.modelNames` (composition), plural tolerant ("Plague Marines" ↔ "Plague
Marine"). Item names: match against `ctx.itemNames` case-insensitively with
the leading count and trailing "." stripped; unmatched names are still
emitted as items.

Tests: `pipeline/tests/wargear-rules.test.mjs` (node:test) with expected
rule sets for at least: Plague Marines (10 and 5 model behaviours documented
in comments), Intercessor Squad, Deathwatch Veterans, Battle Sisters Squad,
Grey Knights Terminator Squad, Navis Armsmen, Inquisitorial Agents, Exaction
Squad, Leman Russ Battle Tank, Terminator Squad, Necron Warriors, Necron
Immortals, Boyz, Kabalite Warriors, Fire Warriors. Coverage: run over every
unit and print `parsed / total lines`; **≥ 95 % parsed** is the bar, the
rest land in `profile.unparsed` and `log.wargearUnparsed` (per unit, in the
build log) — never dropped silently. `pipeline/validate.mjs` lists
`wargear-unparsed` as a LISTED (not FAIL) category with the count.

## 3. Picker engine (W-C, `js/app/wargear-picker.js`, plus the readers below)

Inventory view stays. Counts are per `(rule.id, choiceIndex)`. Enforce:

1. **Rule cap**: Σ over the rule's choices ≤ cap(rule, size): per_n → `floor(size/n) * max`; fixed → `max`, or the model type's count when `max` is null; any → the model type's count (or size when model null). Condition `minModels` unmet → rule hidden.
2. **Model availability**: for model type M (or the whole unit when model null), Σ over all rules of `count × |replaces ∩ {X}|` for item X ≤ carriers(M, X) = number of M models whose default loadout at this size includes X, minus models that took a rule with `locks` containing X. `kind:"add"` rules consume a model too: Σ of all rule takes on M that touch the same model (every replace/add) ≤ count of M — no model gets two swaps from different rules unless they touch different items (replace boltgun + replace knives on the Champion is fine: two items; two rules both replacing the boltgun is not).
3. **Exclusivity**: rules in one `exclusiveWith` set share one pool: Σ of their counts ≤ the smallest of their caps … no: each keeps its own cap, but a model can take only one of them, so Σ ≤ count of M.
4. **Requires**: a take needs a model that still carries every `requires` item (default count minus removals, computed as in 2).
5. **+** is disabled (`disabled`, not hidden) at the cap, with a `title` saying why ("Up to 2 per 5 models", "No Plague Marine still carries a boltgun", "Only one of these per model"). **−** never disabled above 0.

Derived default rows show `defaultCount − removed`. A rule's row label is
the choice label; the chip shows the model type when `model` is set and the
cap text ("up to 2 per 5", "1 per 5", "1 only", "any") instead of
"replaces X".

Saved entries: `entry.wargear[]` keeps its shape `{optionId, choice, count,
items, label, pts}` with `optionId` = rule id. **Migration** of entries saved
against the old 40kdc option ids: on load (`js/app/entry-rehydrate.js`),
match each old row to the new rule whose `choices[c]` item names equal the
row's `items` and whose `replaces` names equal the old option's `replaces`
(if known), else by items alone; unmatched rows stay as they are (still
count in points and export) and are flagged in the console once. Readers to
switch from `options` to `rules`: `wargear-picker.js` (groupCost,
effectiveCounts, takeSelections, maxFor), `entry-rehydrate.js`,
`army.js` wargear points (if it reads options), `tts-export.js`
(constraint.model_name → rule.model; replaces/choices same shape),
`cards-mode.js` effective loadout.

Browser test (signed in, `scripts/verify/wargear-rules.mjs` using `_lib.mjs`
`login`): Plague Marines at 10 and at 7 models asserting the caps in the
table below by pressing + past the limit; Intercessor Squad (Sergeant
exclusive choices, grenade launcher per 5); Necron Warriors (any number);
one vehicle (Leman Russ: hunter-killer missile add, sponsons). Expected at
10 Plague Marines (1 Champion + 9 Plague Marines, every model boltgun +
plague knives):

| rule | cap |
|---|---|
| Champion boltgun → plasma gun / plasma pistol / bolt pistol | 1 total across the three |
| Champion plague knives → power fist / bubotic weapons | 1 total |
| Icon of despair (add, requires boltgun, locks it) | 1 |
| Heavy plague weapon (up to 2 per 5) | 4 |
| Bubotic weapons on Plague Marines (up to 2 per 5) | 4 |
| Meltagun / plague belcher / plasma gun (1 per 5, one choice set) | 2 total |
| Plague spewer (1 per 5) | 2 |
| Blight launcher (1 per 5) | 2 |
| All Plague Marine boltgun swaps + icon together | ≤ 9 |

At 7 models every "per 5" cap is 1 (floor(7/5) = 1), heavies 2.

## 4. Ownership

- **W-P (Opus)**: `pipeline/wargear-rules.mjs`, the `wargearProfile()` changes in `pipeline/build.mjs`, `pipeline/tests/wargear-rules.test.mjs`, `pipeline/validate.mjs` category, `pipeline/schema/faction.schema.json` (rules/unparsed; options removed), `docs/DATASET.md` §wargearProfile. Nothing in `js/`.
- **W-C (Opus)**: `js/app/wargear-picker.js`, `js/app/entry-rehydrate.js`, `js/app/tts-export.js`, `js/army.js` (only if it reads options), `js/ui/cards-mode.js` effective-loadout call, `scripts/verify/wargear-rules.mjs`, `docs/UI.md` picker section. Works against a hand-written fixture profile for Plague Marines (write it from §1 and the rules table into the test script's `FIXTURE`) until the dataset carries rules. Nothing in `pipeline/`.
- Session: dataset rebuild/approve, signed-in browser runs, release.

## 5. Inventory v2 — counts, not swaps (owner decision 2026-11-03, supersedes §3's hard caps)

"Set the weapon pick to not limit the weapon selections but warn if they
appear over the limit. People will need to manually lower their amount of
default guns. Truly a full inventory of guns."

- **Every row has − N +**, default items included. Nothing is ever disabled
  or capped (floor at 0 only). Rows: default items first (in default order),
  then every item any rule offers (deduplicated; an item that is both a
  default and an option appears once, in the defaults block). Chips: model
  type when all rules offering the item name the same model; the cap text
  ("up to 2 per 5", "1 per 5", "1 only", "any") stays on option rows as
  information.
- **Storage**: `entry.loadout = [{ id, name, count }]`, the complete
  inventory (defaults with their counts, extras, zeros omitted). `army.js`
  gets `setLoadout(index, loadout)`; `entry.wargear` is no longer written.
  Migration on read (`entry-rehydrate.js`): `loadout` missing and `wargear`
  present → loadout = defaults at the entry's size − replaced + added, then
  the entry is saved with `loadout`. A brand-new pick starts from the
  defaults at the chosen size; changing size on an unsaved pick resets to
  that size's defaults; changing size on a saved entry keeps the counts.
- **Points**: `getEntryCopyWargearPts` = `max(0, Σ itemCosts[id] × count)`
  over the loadout (`alwaysCost` added as today). For an untouched default
  loadout this equals today's priced-default base, so no army total moves.
- **Warnings** (rendered under the list in the composition-warning style,
  `.wgp-warnings`, and a small "wargear" warning badge on the army entry):
  1. *Slot*: for each default item D with rules that replace it, let R(D) =
     items whose rule `replaces` includes D; if count(D) + Σ count(R(D)) ≠
     default(D): "Boltgun: 13 weapons for 10 models — lower the boltgun count
     when you add swaps" (or "… only 8 for 10 models").
  2. *Cap*: for each non-default item X, extras(X) = count(X) − default(X);
     allowed(X) = Σ cap(rule) over rules whose choices include X
     (per_n → floor(size/n)×max, fixed → max or the model count, any → the
     model count), minus what other items sharing those rules already used
     (split fairly: a rule's cap is shared across its choices, so compute
     per rule: Σ extras of its choice items ≤ cap, attributing an item to
     the first rule that offers it). Message: "Heavy plague weapon: 5 taken,
     the datasheet allows up to 4 (up to 2 per 5 models)".
  3. *Requires / locks*: count(icon) > count(boltgun) → "Icon of despair
     needs a model that still carries a boltgun".
  4. *Exclusive*: Σ counts of items in an `exclusiveWith` group > model
     count → "Only one of these per model".
  5. *Size*: no warning for the Champion's single swap beyond its block
     (covered by cap with the model count 1).
  None → no warnings block.
- **Export** (`tts-export.js`): allocate the loadout to models: for each
  model-type block, items any of its rules offer (or that are defaults only
  of that type) go to that type; remaining default items are spread over the
  remaining models; the Champion/Sergeant block is filled first. Over-limit
  inventories still export (extra items go on extra models in order).
- **Verify** (`scripts/verify/wargear-rules.mjs`, signed in, NO_FIXTURE when
  the dataset carries rules): steppers are never disabled; adding 3 reapers
  without touching flayers shows the slot warning, lowering flayers to 7
  clears it; Plague Marines at 10: 5 heavies shows the cap warning, 4 does
  not; icon 1 with boltgun 0 shows the requires warning; points unchanged
  for defaults and correct for a priced swap (Intercessor Sergeant power
  fist if priced, else any priced item on another sheet); Add to Army saves
  `loadout`; an old-format entry migrates to the same loadout; TTS export
  NO_POST run allocates 7 flayers + 3 reapers over 10 Warriors.
