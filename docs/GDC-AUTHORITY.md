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
