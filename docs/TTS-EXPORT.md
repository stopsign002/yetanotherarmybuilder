# Export to Tabletop Simulator via Yellowscribe — 2026-11-02 (contract)

Owner request: a friend builds in NewRecruit, presses "export to Yellowscribe",
gets an 8-character code and types it into the Yellowscribe v2 mod in
Tabletop Simulator. yaab gets the same button: **Export → Send to Tabletop
Simulator** produces the code. Research (session, 2026-11-02): Yellowscribe
(https://yellowscribe.link, source https://github.com/ThePants999/Yellowscribe)
builds the TTS datasheets FROM THE UPLOADED FILE; it accepts BattleScribe
`.rosz` or Rosterizer `.regiztry`, and `POST /makeArmyAndReturnCode?filename=
<name>.regiztry` (the endpoint NewRecruit uses) turns a file into a code in
one step. Codes expire after 10 minutes. The server sends no CORS headers, so
the browser cannot call it: yaab-api forwards the file.

## 1. The `.regiztry` yaab produces (W-X, `js/app/tts-export.js`)

A zip (STORED, no compression; one entry `roster.regiztry.json`) holding one
JSON document shaped for Yellowscribe's `bin/rosterizerParser.js`:

```
{ "assets": { "traits": [], "included": [ <unitAsset>... ] }, "errors": [] }
unitAsset = { "lineage": ["Unit"], "designation": "<datasheet name>",
  "name": <customName or null>, "aspects": {}, "classification": "Unit",
  "keywords": { "Faction": [<faction keywords>], "Keywords": [<other keywords>] },
  "assets": { "traits": [ <modelAsset>..., <unitAbilityAsset>... ], "included": [] } }
modelAsset = { "lineage": ["Model"], "classification": "Model",
  "designation": "<model type name>", "name": null, "aspects": {}, "quantity": N,
  "keywords": {}, "stats": { "M": S("6\""), "T": S("5"), "Sv": S("3+"), "W": S("2"),
  "Ld": S("6+"), "OC": S("2") },
  "assets": { "traits": [ <weaponAsset>..., <abilityAsset>... ], "included": [] } }
weaponAsset = { "lineage": ["Weapon"], "classIdentity": "Weapon",
  "classification": "Ranged Weapon" | "Melee Weapon", "designation": "<name>",
  "name": null, "aspects": {}, "quantity": 1, "keywords": {},
  "stats": { "Range": S("24\""), "A": S("2"), "BS": S("3+") | "WS": S("3+"),
  "S": S("4"), "AP": S("-1"), "D": S("1") },
  "assets": { "traits": [ <abilityAsset for each weapon keyword>... ], "included": [] } }
abilityAsset = { "lineage": ["Ability"], "classification": "Ability" | "Enhancement" | "Wargear",
  "designation": "<name>", "name": null, "aspects": {}, "text": "<rule text>",
  "keywords": { "Keywords": [] }, "assets": { "traits": [], "included": [] } }
S(v) = { "processed": { "format": { "current": v } } }
```

Mapping from a yaab army entry (see `js/army.js` entry shape, `docs/DATASET.md`
unit shape):

- **One unitAsset per entry**, `quantity`-expanded: an entry with `count` 2
  becomes two unitAssets. Attached leaders are their own unitAssets (the mod
  attaches in TTS). `designation` = `unit.name`; `name` = `entry.customName`.
- **Model types** from `unit.gdcComposition` lines of the form
  `"1 Intercessor Sergeant model"`, `"4-9 Intercessor models"`, `"1 Captain
  model"`: parse `<n>` or `<lo>-<hi>` + type name. Squad size = the entry's
  chosen size (`entry.squadLabel`/`selectedPts` → the matching
  `squadOptions[].models`, else `pointsOptions`/composition minimum). Fixed
  counts first, the open-range type takes the remainder. No composition →
  one model type named after the unit. Vehicles/monsters: one model.
- **Stats** per model type from `unit.modelStats` by name; when a type has no
  own row (Sergeant), use the row whose name is contained in the type name or
  the first row. Keys M T SV W LD OC → M T Sv W Ld OC.
- **Default loadout** from composition lines `"Every model is equipped with:
  A; B; C."` and `"The <type> is equipped with: ..."` (strip the leading count
  "1 "): names resolve to `unit.weapons` rows case-insensitively; a weapon
  with several profiles ("Plasma Pistol – Standard" / "– Supercharge") emits
  every profile whose name starts with the loadout name + " –". A loadout name
  that matches no weapon row becomes a Wargear abilityAsset (text from
  `unit.wargearAbilities` if present, else the name) so it is not lost.
- **Swaps** from `entry.wargear` (`{optionId, choice, count, items, label}`)
  against `unit.wargearProfile.options[]` (`replaces`, `choices`,
  `constraint.model_name`): apply to `count` models of the constrained type
  (or any type when unconstrained), removing `replaces` and adding `items`,
  splitting that model type's modelAsset into "with" and "without" groups.
  Several swaps that target the same single model (a Sergeant's two
  replacements) stack on the same model. Ranged/melee from the weapon row's
  `_typeName`.
- **Abilities**: every `unit.abilities[]` entry (core ones included, text
  from `description`) as unit-level abilityAssets; `unit.invulnSave` →
  ability "Invulnerable Save" text `"This model has a <n> invulnerable save."`
  (`invulnNote` appended when present); `entry.enhancements[]` → abilityAssets
  with classification "Enhancement" on the first model of the unit (name +
  description); `unit.wargearAbilities[]` as "Wargear" abilityAssets.
  Weapon keywords (`weapon.Keywords` split on ", ") → abilityAssets on the
  weapon with text from `weapon._keywordDefs[k]` (empty text allowed).
- **Keywords**: `keywords.Faction` = `[UI.factionShort(unit._factionName)]`
  plus the allegiance word if present in `unit.keywords` (Imperium, Chaos,
  Xenos, Aeldari …: whatever `cards-mode.js` uses for its FACTION KEYWORDS
  footer — reuse that helper or copy its rule); `keywords.Keywords` = the rest.
- Markdown in texts (`**bold**`) is stripped to plain text (`UI.mdPlain`).

`App.TtsExport = { buildRegistry(army, opts) -> object, buildZip(obj, name)
-> Uint8Array, send(army) -> Promise<{code}> }`. `buildRegistry` is PURE
(no DOM, no fetch; takes `{ unitsById }` or reads `entry.unitData`) so a node
script can run it. The zip writer is a ~60-line STORED zip (local header,
central directory, EOCD, CRC-32 table); no library.

## 2. UI (W-X)

- Export menu (`js/ui/topbar-export.js` `mkItem`, plus the Settings drawer
  and command palette rows that mirror `btn-export-text`): **"Send to
  Tabletop Simulator"**, id `btn-export-tts`. Handler in `js/app/events.js`
  next to the other export buttons.
- Flow: build → `POST /api/export/tts` (body: the zip, `Content-Type:
  application/octet-stream`, header `X-Roster-Name: <army name>.regiztry`) →
  modal (reuse `#export-modal`'s structure/classes, own ids) showing the code
  in large monospace with a Copy button, the text "Paste this into the
  Yellowscribe v2 mod in Tabletop Simulator. The code expires in about 10
  minutes.", and a small "Yellowscribe is a third-party service" line with
  the link. On a failed send (network, 5xx, 502 `yellowscribe_unavailable`):
  toast the reason and offer **Download .regiztry** (same file; the friend
  uploads it at yellowscribe.link). Buttons styled like the rest of the
  modal's buttons, both themes.
- `scripts/verify/tts-export.mjs` (node, no browser; run via docker
  `node:22-slim` with `app/` mounted): loads `data/dataset/current/
  adeptus-astartes.json` + `necrons.json`, builds a synthetic army of
  {Intercessor Squad ×10 with Sergeant thunder hammer + 2 grenade launchers,
  Captain in Terminator Armour with one enhancement, Necron Warriors ×10 with
  3 gauss reapers, a Leman Russ-like vehicle from any faction}, writes the
  zip to the out dir, POSTs it to `https://yellowscribe.link/getFormattedArmy
  ?filename=yaab.regiztry` and prints the parsed roster: assert unit count,
  model counts per unit (1 Sergeant + 9 Intercessors), the thunder hammer on
  exactly one model, 2 grenade launchers, 3 gauss reapers, the enhancement
  present, zero `errors`. Run it at most a handful of times (volunteer
  service). It needs no account anywhere.

## 3. API (W-Y, `api/export.js`, registered in `api/server.js`)

`POST /export/tts` — `requireUser`, `perUserLimit(6, '1 minute')`, body
`application/octet-stream` up to 1 MB (add a content-type parser for it in
this file only). Forwards the bytes unchanged with `fetch` to
`${YELLOWSCRIBE_URL}/makeArmyAndReturnCode?filename=<sanitised X-Roster-Name
or 'yaab.regiztry'>` (`YELLOWSCRIBE_URL` default `https://yellowscribe.link`,
15 s timeout via AbortController, `User-Agent: yaab (yaab.thewheeliebois.com)`).
Upstream 200 `{code}` → `{ code }`. Upstream error or timeout → 502
`{ error: 'yellowscribe_unavailable' }` with the upstream status logged
(never the body: it can echo the roster). `api/CLAUDE.md` route table + a
line in `docs/AUTH.md`'s route list. No DB. Rebuild: `docker compose -f
~/sites/sites/yetanotherarmybuilder/docker-compose.yml up -d --build yaab-api`
(session does it).

## 4. Done means

`tts-export.mjs` passes against the live Yellowscribe parser; the API route
answers 401 signed out and 502 when `YELLOWSCRIBE_URL` points at a dead host
(session checks with a signed-in fixture when one exists, else by reading
the code); the button and modal verified in the browser by the owner (the
session has no signed-in account); release note "Send to Tabletop Simulator".
