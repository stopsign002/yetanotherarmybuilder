# GDC-authoritative factions

Written 2026-09-09 after the Ork codex verification (five three-way audits:
weapons, units-core, abilities, detachments, wargear — reports in the
session scratchpad, findings summarised below). This is both the design note
and the implementation contract for the change.

## Why

For a faction whose codex has landed but whose upstream 40kdc data has NOT
been re-authored yet, the 40kdc layer is wrong in ways no expect-gated overlay
can chase: stale 10e ability sets (64 phantom abilities on 42 Ork units),
10e weapon profiles (29 wrong values, 25 missing profile splits, 4 units with
no weapons at all), stale keywords (24/55 units), stale leader attachments
(3 illegal leaders), whole detachments with the wrong six stratagems and the
wrong rule (Dread Mob, Blitz Brigade), 26 index-era enhancements still listed
(two of them as free 0-pt duplicates).

GW's own app dump (GDC, `data/gdc/11th/gdc/<faction>.json`) is codex-current
for all of those. Wahapedia's 11e CSVs agreed with GDC against us in every
material case. So: for an allowlisted faction, **GDC is the source of record
for everything it carries**, and 40kdc only supplies what GDC lacks.

`GDC_STATS_AUTHORITATIVE` (js/data/dc-adapter.js ~2275) already does this for
statlines + invulns. This change widens it into `GDC_AUTHORITATIVE`.

## Division of authority for an allowlisted faction

| Field | Source of record | Notes |
|---|---|---|
| unit list / ids / hidden Legends | 40kdc + MFM gate (unchanged) | `MFM_DELISTED`, `ADOPT_UNITS` unchanged |
| points, size bands, ordinal | MFM overlay (unchanged) | |
| statlines, invuln | GDC (already) | plus: OC that parses negative → `'-'` (GDC artefact on 4 Ork aircraft) |
| **keywords** | **GDC** `keywords[]` + `factions[]` | same shape/casing `synthesizeUnit` produces (`kws.concat('Orks')`) |
| **weapons** (`u.weapons`) | **GDC** via `gdcWeaponRows` | only when GDC has ≥1 weapon group; otherwise leave ours |
| **abilities** | **GDC** `abilities.core/other/damaged` rebuilt like `synthesizeUnit` | Leader excluded (it is `attachmentRole`); faction bucket excluded (army-rules panel); then overlay `updateNamed` re-applied (expect-gated) |
| **wargearAbilities** | **GDC** `abilities.wargear` | then overlay `updateWargear` re-applied (expect-gated) |
| **attachmentRole / gdcLeadBy** | **GDC** core `Leader` + `attachesTo` | `gdcLeadBy` = EVERY `attachesTo` target (GDC types them `leader` AND `support`); the role lives in `attachmentRole`. Empty means "attaches to nobody" — NO fallback to 40kdc `leader-attachments` |
| wargear options tree + costs | 40kdc + MFM (unchanged) | option items must still resolve to a row in `u.weapons` by name |
| composition, loadout prose, transport | GDC via gdc.js (unchanged) | |
| army rules | 40kdc names + GDC/store text (unchanged) + `ARMY_RULE_TEXT_OVERRIDES` | GDC ships no Waaagh! text; 10e store text is overridden expect-gated |
| **detachment rule** | **GDC** `rules.detachment` (name = the RULE's name, e.g. "Unstoppable Momentum") | replace, not fill |
| **stratagems** (list, CP, phases, text) | **GDC** | `reconcileStrats` short-circuits to the GDC list; `projectStratagem` gains secondary effects |
| **enhancements** (list, pts, text) | **GDC** | text: keep 40kdc's when it is a strict superset of GDC's (weapon-profile cards GDC ships as images) |
| detachment id / points / dispositions | 40kdc (unchanged) | |

Everything not in the table is untouched. **Non-allowlisted factions must be
byte-identical before and after** — that is the regression test.

## Implementation notes (dc-adapter.js unless stated)

1. Rename `GDC_STATS_AUTHORITATIVE` → `GDC_AUTHORITATIVE`; value stays a note
   string. Keep the function name `applyGdcStatlines` and the
   `window.BSData._applyGdcStatlines` export — `~/sites/base/wahapedia-audit-dump.mjs:89`
   and the daily audits call it by that name. All datasheet-level authority
   work goes INSIDE that function so the node harness reproduces the browser.
2. Keywords: build from `ds.keywords[].en` + `ds.factions[]` exactly as
   `synthesizeUnit` does. Drop any `orks` entries from `UNIT_KEYWORD_FIXES`
   (GDC now owns them). Check every consumer of `unit.keywords`
   (`ui/detail.js` enhancement eligibility ~767-824, `app/validation.js`
   40-58, `ui/roster.js`, `ui/role-icons.js`, `app/attachments.js`) still
   works with GDC casing — they lower-case already, confirm.
3. Weapons: `unit.weapons = gdcWeaponRows(ds.rangedWeapons,false).concat(gdcWeaponRows(ds.meleeWeapons,true))`
   when the concat is non-empty. Then confirm the wargear picker
   (`wargearProfile` option items → weapon row) still resolves: it matches by
   folded weapon name, and GDC's names for optional weapons are the same
   strings the picker uses (verify on Gunwagon Zzap gun, Meganobz Killsaw,
   Nobz Paired Krumpas, Breaka Boyz Rokkit pistol). `syncOptionalWeaponsFromGdc`
   and `applyWeaponFixes` must become no-ops for authoritative units (they
   already are content-wise; make sure they do not re-add rows).
4. Abilities: mirror `synthesizeUnit` (~2500-2540) — core entries
   `{name, description: weaponKwText(aid)||textFor(aid)||'', isCore:true, id:aid}`,
   `other` entries `{name, description: cleanMarkup, isCore:false, id:null}`,
   Damaged as `gdcCoreAbilityAdds` names it (`Damaged: 1-5 wounds remaining`).
   Skip `Leader`. Keep a per-unit `keepAbilities` list on the allowlist entry
   for abilities GDC omits but GW prints (Wazdakka Gutsmek: Pulse Jet, Shokk
   Attack Engine, Turbo Engine — the Throttlerokkit sub-abilities GDC ships
   as an image); those are carried over from the 40kdc build by name only
   when GDC lacks them. Then re-apply `DC.abilityFixes[fid::id].updateNamed`
   and `.updateWargear` (same expect-gated code as `toUnit`; factor it out
   rather than copy it). `addCore/addNamed/addWargear/remove` are NOT
   re-applied — GDC owns the list. (This is what removes the stale
   `feel-no-pain-6` addCore on hunta-rig/kill-rig and the 10e wargear cards
   'Ard Case / Grot Oiler / Grot Assistant without touching any source file.)
5. Leader: `attachmentRole = 'leader'` iff `ds.abilities.core` has Leader;
   else `'support'` iff `ds.abilities.special` has Support; else `null`.
   `gdcLeadBy` = targets from `ds.attachesTo` (BOTH type `leader` and type
   `support` — GDC 946 types the Bannernob, Bigboss, Mek, Painboss, Painboy,
   Runtherd and Weirdboy rows `support`, and a leader-only filter unattaches
   every one of them) or `App.GDC._leaderTargets(ds.leader)`; `[]` when none. Set
   `unit._gdcAuthoritative = true`. In `js/app/attachments.js` the
   `gdcLeadBy` empty → 40kdc-fallback branch must NOT fire when
   `_gdcAuthoritative` is set (Ghazghkull, Mozrog, Beastboss on Squigosaur
   lead nobody in 11e).
6. OC: inside the statline apply, if `parseInt(OC) < 0` write `'-'`.
7. `ARMY_RULE_TEXT_OVERRIDES = { waaagh: { expectContains, description } }`
   consulted in `buildArmyRules` after `textFor(id)`; applies only while the
   store text contains `expectContains` (a phrase unique to the 10e rule).
   11e text: wahapedia ORK "Waaagh!" (re-roll Advance; riled up → 5+ invuln,
   ranged [ASSAULT], eligible to charge after advancing; War Cry once per
   battle) — the wahapedia CSVs are in the session scratchpad, grep `riled up`.
   Write it in the house style of `MISSING_ARMY_RULE_TEXT` (plain text, `•`
   bullets).
8. Detachments (js/gdc.js `mergeIntoFactions` + adapter `reconcileStrats`):
   expose the allowlist to gdc.js (e.g. `App.GDC_AUTHORITATIVE = {orks:…}` set
   by the adapter before `loadAll`, keyed by 40kdc faction id; gdc.js has
   `faction._factionId`). For an allowlisted faction:
   - detachment rules: REPLACE `d.rules` with GDC's built list (name = rule
     name), not fill-only.
   - enhancements: REPLACE `d.enhancements` with GDC's rows for that
     detachment: `{name, pts:int(cost), description}`; where a 40kdc row
     matches by `nameKey` and `squash(dc.description)` contains
     `squash(gdc.description)` and is longer, keep the 40kdc description
     (Da Gobshot Thunderbuss, Da Krunch, 'Eadbanger carry the weapon profile).
     `squash` = lowercase alphanumerics only, as in `reconcileStrats`.
   - stratagems: `reconcileStrats` returns the GDC list untouched (name, cp,
     `phase` = cap(first phase) or 'Any', `phases` = GDC array, turn, type,
     description, source 'gdc'). 40kdc's `stratagemIds` are ignored.
   - `projectStratagem` (all factions): render `secondary_effect` as
     `\n\n+<secondary_effect_cost> CP — Or: <effect>` (cost omitted when 0);
     strip control characters (the dump has `\x07`) in `cleanMarkup`.
9. `manual-corrections.json` (`~/sites/base/manual-corrections.json`,
   `abilityFixes`): three `updateWargear` pins where GDC 946 still carries
   10e wargear prose and wahapedia 11e + the 40kdc codex enrichment agree
   with our current text — `orks::big-mek-in-mega-armour` Kustom Force Field,
   `orks::wazbom-blastajet` Blastajet Force Field, `orks::tankbustas` Pulsa
   Rokkit. `expectContains` = a phrase unique to GDC's text, `description` =
   the current live text, `_source` note citing both oracles. Then re-append
   the overlay line under the tree lock:
   `flock ~/sites/base/.yaab-tree.lock sh -c 'sed -i "/;\/\/yaab-overlays$/d" js/vendor/dc-bundle.js && python3 ~/sites/base/overlay_merge.py >> js/vendor/dc-bundle.js'`
   (the overlay is the single last line of the bundle; `--prose` is NOT
   passed — dc-prose.js is untouched.)
10. `js/data/stratagems-data.js` (separate task): the eight 10e core
    stratagems → the ten 11e ones (Command Re-roll, Counteroffensive 2CP,
    Epic Challenge, Insane Bravery, Crushing Impact, Explosives, Rapid
    Ingress, Fire Overwatch, Smokescreen, Heroic Intervention 1CP). Source:
    wahapedia `Stratagems.csv` ids `000010810002`–`012` (not 009, which is
    the Snap Shooting ability). Same object shape and paraphrase style as the
    file already uses.
11. Changelog `js/data/changelog-data.js`: one entry, version `2026.09.09-2`,
    player-facing wording. Stamp: `node scripts/stamp-assets.mjs --data "$(md5sum js/vendor/dc-bundle.js | cut -d' ' -f1)"`.

## Self-checks (node harness, no browser)

Harness: copy `~/sites/base/wahapedia-audit-dump.mjs` to a scratch script,
keep its setup, emit what you need; run from the app dir with
`docker run --rm -v "$PWD":/app -v ~/sites/base:/base -w /app node:22-alpine node /base/.tmp-<x>.mjs`
(the script must sit under `~/sites/base`; delete the copy after).
`[DC] … App is not defined` on stderr is a known artefact. The harness calls
`_applyGdcStatlines` and `_reconcileStrats` explicitly — if the browser path
needs a phase the harness does not call, add it to the harness too.

Assert, Orks:
- Ghazghkull Thraka, Mozrog Skragbad, Beastboss on Squigosaur: `attachmentRole` null, `gdcLeadBy` `[]`; Warboss still leads Boyz/Breaka Boyz/Nobz.
- Big Mek Dakkarig keywords include Character + Vehicle; Big Mek in Mega Armour has Big Mek, not Mek; Trukk has Speed Freeks; Wazbom has Smoke; no unit has Grenades.
- Wartrakks, Rukkatrukk Squigbuggies, Nazdreg, Runtherd: `weapons.length > 0`; Deffkilla Wartrike has a ranged Snagga klaw row; Rokkit launcha rows read A 2 (not D3).
- Beast Snagga Boyz / Hunta Rig / Kill Rig: no "Feel No Pain 6+"; Kill Rig has "Damaged: 1-5 wounds remaining"; Stompa Damaged 1-10; Battlewagon has no 'Ard Case; Big Mek in Mega Armour has no Grot Oiler and its Kustom Force Field text is the pinned one; Wazdakka still has Pulse Jet/Shokk Attack Engine/Turbo Engine; Warboss Might Is Right says +3 A.
- Blitza-bommer/Burna-bommer/Dakkajet/Wazbom OC = `-`.
- Army rule Waaagh! text contains "riled up".
- Dread Mob strats = Stomping Juggernaut / Dread Power / Crazed Rampage, each with text; Blitz Brigade rule name Unstoppable Momentum; Madcap Meks rule Unpredictable Genius; Green Tide + Taktikal Brigade have 2 enhancements each, none at 0 pts; Bully Boyz Hulking Brutes text contains "+1 CP"; Wurrband Da Krunch text still contains its weapon profile; Shoota Boyz has "Glowin’ Dakka"; total strats 40, enhancements 38.
- Every 40kdc wargear option item on Gunwagon, Meganobz, Nobz, Breaka Boyz, Kommandos, Tankbustas resolves to a `u.weapons` row.

Assert, everyone else: dump ALL non-Ork factions (units + detachments, JSON)
before and after — `diff` must be empty except stratagem texts that gained a
secondary-effect line (list them). `git diff --stat` in the report.

## The MFM is the oracle for POINTS *and* LEADER/SUPPORT attachments

Owner ruling, 2026-09-10, and it is expected to hold for every faction going
forward. Two separate things live in the MFM and nowhere else:

- **Points** — base costs, size bands, ordinal surcharges, per-item wargear.
  A codex datasheet does not price wargear at all, so print is not even a
  competing source. GDC/wahapedia/New Recruit disagreeing about a cost is that
  source being wrong, not a conflict to research.
- **Leader / Support attachments** — the MFM states it itself, above the unit
  list: *"If a unit has the Leader/Support ability, the units it can be
  attached to are listed after its points values."* Each unit block renders a
  `LEADER` or `SUPPORT` label followed by the comma-separated unit names.

Verified against the Ork page (MFM v1.4): 17 Ork units carry an attachment
list, and all 17 match GDC and 40kdc exactly.

**The attachment list is SCOPE-DEPENDENT, and that was missed on the first
pass.** With "Show Legends" off the Deffkilla Wartrike leads **WARBIKERS**
only — matching GDC, 40kdc and what yaab ships. With Legends on the same row
reads **NOBZ ON WARBIKES, SKORCHAS, WARBIKERS, WARBUGGIES**. So a conclusion
about an attachment list is only meaningful once the scope is stated:

- For standard play the WARBIKERS-only answer is right and yaab is correct.
- The Legends-inclusive list is exactly what New Recruit ships, so NR was
  transcribing the fuller list rather than carrying stale junk — an earlier
  version of this document said otherwise and was wrong. Wahapedia's
  WARBIKERS + WARBUGGIES sits between the two.
- **WARBUGGIES is not itself a Legends unit** (it is priced on the Legends-off
  page and yaab carries it with `isLegends: false`), yet it appears only in the
  Legends-on list. NOBZ ON WARBIKES and SKORCHAS are priced in neither scope.
  Nobody has read the printed Wartrike card yet, so treat the four-unit list as
  unexplained rather than authoritative, and do not "fix" yaab to match it
  without the card (yaab#77 item 1).

The MFM also independently confirmed the
three bogus leaders this document's Ork pass removed — Ghazghkull Thraka,
Mozrog Skragbad and Beastboss on Squigosaur are absent from the MFM's
attachment list, and 40kdc still ships all three.

**How to read it:** render the page and take `document.body.innerText` —
do not regex the HTML. The attachment strings sit behind `$L<id>` lazy
references in the Next.js RSC payload, so they are simply absent from the
raw markup that `mfm-scrape-wargear.py` parses today. A worked scrape is in
`stopsign002/yetanotherarmybuilder#86`, which proposes making this overlay
automatic and self-healing the way wargear costs already are.

---

## Space Marines + chapters (contract, 2026-10-05)

Written after the 2026-10-02 Space Marines 11e codex / MFM / all-faction
dataslate. State on 2026-10-05 after the bundle refresh (40kdc@709ecd9f,
GDC data_version 972, dump-corrections promoted):

* 40kdc ingested the codex **stat profiles** (and kept its old unit ids), the
  MFM overlay has the codex points, and dump-corrections.json carries the
  dataslate statline/weapon sweep. **Statlines, points and weapon numbers are
  right.** Do not touch those paths.
* Still wrong, and not expressible as an expect-gated overlay:
  * **Detachments**: 40kdc ships the 17 index-era SM detachments (1st Company
    Task Force, Librarius Conclave, Vanguard Spearhead, Anvil Siege Force…).
    GDC `space_marines.json` ships the **22 codex detachments** (Blade of
    Ultramar, Tactical Brethren, Gravis Siege Force, Terminator Storm Force,
    Phobos Shock Force, Deathwatch Support…). Only Gladius, Stormlance,
    Ironstorm and Ceramite Sentinels overlap. The live picker is wrong for the
    most-played faction in the app.
  * **Keywords**: GRENADES → EXPLOSIVES on ~150 Astartes datasheets (GDC has
    it; CSM keeps GRENADES — this is SM-only). Several sheets also carry a
    stale self-name keyword 40kdc added ("high marshal helbrecht").
  * **Core abilities**: Damaged profiles (Gladiators, Repulsors, Land Raider
    Crusader…), Firing Deck 6 → 7 on the Impulsor, Deep Strike on the
    Darkshroud / Land Speeder Vengeance, Mephiston FNP 4+ → 5+.
  * **Named abilities**: ~60 missing (Rapid Disembarkation, Combat
    Embarkation, Veteran Marksmen, Fury of the Machine Spirit, Death Visions of
    Sanguinius, Chief Librarian (Psyker level 3), Icon of Old Caliban…).
  * **Leader roles**: 5 mismatches (Judiciar is SUPPORT, Cato Sicarius is a
    LEADER, Captain on Bike is a LEADER, Kaius Konorius is SUPPORT, Death
    Company Captain with Jump Pack attaches to nobody).

The fix is the Ork mechanism above, widened to every Astartes faction, plus
ONE new capability: **adopting detachments 40kdc does not carry**. The
existing `mergeIntoFactions` can only decorate a detachment that already
exists (`detKeyToTargets`), so a flip alone would leave the 18 missing
detachments missing.

### 1. Allowlist

Add to `GDC_AUTHORITATIVE` in `js/data/dc-adapter.js`, each with a note
string: `adeptus-astartes`, `black-templars`, `blood-angels`, `dark-angels`,
`deathwatch`, `space-wolves`, and every other 40kdc faction id that maps to an
`Imperium - Adeptus Astartes - *` faction name (Imperial Fists, Iron Hands,
Raven Guard, Salamanders, Ultramarines, White Scars — read the ids from
`window.DC.factions`, do not guess them).

### 2. GDC file resolution for authoritative chapters

`applyGdcStatlines` resolves datasheets through `FACTION_TO_GDC[name]` — the
PRIMARY file only. For a chapter (Blood Angels → `bloodangels`) that misses
every generic sheet in the chapter's roster (Intercessors, Impulsor…), which
would stay stale. Resolve through `App.GDC.gdcFilesFor(name)` (chapter file
first, then `space_marines`) and index the chapter file's sheets FIRST so a
chapter override of a shared name (Blood Angels Captain vs Captain) wins.
Expose `gdcFilesFor` on `App.GDC` if it is not already.

### 3. Detachment adoption (new)

For an authoritative faction, after `toDetachment` has built the 40kdc list
and BEFORE `mergeIntoFactions` runs:

* Collect the GDC detachment entries for the faction from the same files as
  §2 (`payload.detachments[]`: `{id, name{en}, faction, detachmentPoints,
  forceDispositions[{id,name{en}}]}`).
* **Eligibility by `faction` field.** `space_marines.json` tags each
  detachment with the chapter it belongs to: `Adeptus Astartes` (generic),
  `Ultramarines`, `Imperial Fists`, `Raven Guard`, `Salamanders`, `White
  Scars`, `Iron Hands`. A faction may adopt: everything from its OWN chapter
  file; from `space_marines.json`, entries tagged `Adeptus Astartes` plus
  entries tagged with its own chapter name (so `Imperium - Adeptus Astartes -
  Ultramarines` gets Blade of Ultramar, Black Templars does not). Vanilla
  `Space Marines` adopts ALL 22 — a vanilla-SM list can be any chapter.
  **Open rules question for the owner** (ask, do not decide): whether a
  Blood Angels / Dark Angels / Space Wolves / Black Templars / Deathwatch army
  may take the generic codex detachments at all now that those chapters have
  their own books. Until answered, keep the current behaviour (chapters borrow
  the generic ones) — the mechanism just swaps WHICH generic ones.
* **Match by `nameKey`** against the existing 40kdc detachments (the same
  relaxed key `gdc.js` uses). Existing match → keep the 40kdc object (its
  id is what allied-rule gates and saved armies reference). No match →
  synthesise `{ name, rules: [], enhancements: [], _factionId, id:
  'gdc:' + <GDC detachment id>, points: detachmentPoints, dispositions,
  stratagemIds: [], _adopted: true }`. `dispositions` must be the same shape
  `toDispositions` emits — resolve each GDC disposition NAME against
  `window.DC.forceDispositions` / `FORCE_DISPOSITIONS` by name, and if a
  name does not resolve emit `{id: null, name, text: ''}` rather than
  dropping it.
* **Retire what GW no longer lists.** A 40kdc detachment of an authoritative
  faction that matches NO eligible GDC detachment is removed from
  `faction.detachments`. Keep a `faction._retiredDetachments = [names]`
  list so the army loader can tell a user why a saved army's detachment is
  gone (check `js/app/selections.js` / `detachment-picker.js` for how a
  missing detachment is handled today and make sure it degrades to "no
  detachment selected", never a crash).
* `mergeIntoFactions` already REPLACES rules / enhancements / stratagems for
  authoritative factions by `nameKey` — the adopted objects pick those up
  with no further change, but VERIFY it: every adopted detachment must end
  with ≥1 rule, its GDC enhancement rows (with `pts`), and its GDC stratagems
  (3 or 6 — see the per-detachment counts in `space_marines.json`).
* Enhancement `cost` in GDC is a STRING ("15") — `parseInt` it.

### 4. Datasheet authority — nothing new, but confirm each

Keywords, weapons, abilities, wargearAbilities, attachmentRole/gdcLeadBy all
flow from the existing authority pass once the faction is allowlisted. Confirm
on these specific sheets (they are the audit's own examples):

| Sheet | Expect |
|---|---|
| Intercessor Squad (SM and under Blood Angels) | keywords contain EXPLOSIVES, not GRENADES |
| Impulsor | core `Firing Deck 7`, named `Rapid Disembarkation` |
| Gladiator Lancer | core `Damaged: 1-4 wounds remaining` |
| Chief Librarian Mephiston (Blood Angels) | core FNP 5+, named `Chief Librarian (Psyker level 3)` |
| Judiciar | `attachmentRole === 'support'` |
| Cato Sicarius | `attachmentRole === 'leader'`, `gdcLeadBy` non-empty |
| Death Company Captain with Jump Pack | `gdcLeadBy` is `[]` and attachments.js offers no targets |
| Tactical Squad | still present, `isLegends === true`, untouched by the authority pass (GDC does not list it; that path already returns early) |

`GDC_KEEP_ABILITIES` entries may be needed where GDC ships an ability as an
image — look for Astartes sheets whose GDC `abilities.other` is shorter than
the printed card (the dump audit's `namedAbilityInfo` rows are the hint) and
list what you find in the report rather than guessing.

### 5. Regression contract

* **Every non-Astartes faction must be byte-identical before and after.**
  Dump `JSON.stringify(faction)` per faction from the node harness on `main`
  and on the branch and diff. Orks included.
* The node harness is the validator the refresh uses:
  ```
  docker run --rm -v ~/sites/base/40kdc-build:/work -v <APP>:/app -w /work/bundle \
    -u "$(id -u):$(id -g)" -e HOME=/work/bundle \
    -e ADAPTER_PATH=/app/js/data/dc-adapter.js -e BUNDLE_PATH=/app/js/vendor/dc-bundle.js \
    -e PROSE_PATH=/app/js/vendor/dc-prose.js node:22-alpine node validate-deploy.mjs
  ```
  `<APP>` may be a git worktree; copy the untracked server-only
  `js/vendor/dc-prose.js` from the live tree into it first (or pass
  `PROSE_PATH=""`). It must print `"ok":true` with 35 factions and ~998 units.
  `validate-deploy.mjs` exposes nothing per-faction; write a sibling
  `inspect-sm.mjs` next to it (same boot sequence — read the top of
  validate-deploy.mjs) that prints the table in §4 plus every Astartes
  faction's detachment list with rule/enhancement/stratagem counts.
* Consumers to re-read for the new shape: `js/app/detachment-picker.js`,
  `js/app/selections.js`, `js/ui/faction-rules.js`, `js/app/allies.js`
  (gates on 40kdc detachment ids — adopted ids are `gdc:*` and must simply
  never match), `js/app/sm-chapter-filter.js`, `js/ui/play-mode.js`,
  `js/ui/cards-mode.js` (prints detachment rules/strats).
* Nothing in this contract touches `js/vendor/dc-bundle.js`,
  `build/abilities-index.json`, `data/gdc/`, or anything under
  `~/sites/base/`.

### Done means

The §4 table passes, every Astartes faction lists exactly its eligible GDC
detachments (vanilla SM: 22) each with rule + enhancements + stratagems, the
retired index-era ones are gone, non-Astartes factions are byte-identical,
`validate-deploy.mjs` is ok, and `dump-audit.py` (report mode, run by the
session after merge) shows the SM keyword/coreAbility/namedAbility/
attachmentRole rows gone.
