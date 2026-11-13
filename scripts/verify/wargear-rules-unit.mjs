// scripts/verify/wargear-rules-unit.mjs — the wargear WARNING engine
// (App.WargearPicker.warnings, contract docs/WARGEAR-RULES.md §5/§6) run in
// plain node against the LIVE dataset (data/dataset/current/), no browser,
// no login, writes nothing. The signed-in UI path is wargear-rules.mjs.
//
//   docker run --rm -v "$PWD":/w:ro -w /w node:22 node scripts/verify/wargear-rules-unit.mjs
//
// Each case is a full inventory (per model-type rows on multi-type units)
// and whether the datasheet text makes it legal. Cases are written from the
// GDC wargear text quoted beside them; a case whose unit is missing from the
// dataset FAILS rather than skipping, so a rename is noticed.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const win = { App: {} };
const sandbox = vm.createContext({ window: win, document: { getElementById: () => null }, console });
for (const f of ['js/army.js', 'js/app/wargear-picker.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const WP = win.App.WargearPicker;
const DS = path.join(APP, 'data/dataset/current');
const factions = new Map();
function unit(fac, name) {
  if (!factions.has(fac)) factions.set(fac, JSON.parse(fs.readFileSync(path.join(DS, fac + '.json'), 'utf8')));
  return (factions.get(fac).units || []).find((u) => u.name === name && u.wargearProfile) || null;
}

let fails = 0, n = 0;
// rows: 'Model>Item:count' (Model omitted on single-type units).
const lo = (rows) => rows.map((s) => {
  const m = /^(?:(.+)>)?(.+):(\d+)$/.exec(s);
  const r = { id: '', name: m[2], count: +m[3] };
  if (m[1]) r.model = m[1];
  return r;
});
function check(fac, name, models, rows, legal, label, match) {
  n++;
  const u = unit(fac, name);
  if (!u) { fails++; console.log(`FAIL ${name}: not in ${fac}.json`); return; }
  const w = WP.warnings(u, models, lo(rows));
  let ok = legal ? w.length === 0 : w.length > 0;
  if (ok && match) ok = w.some((x) => match.test(x));
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} @${models}: ${label}${ok ? '' : ` — got ${JSON.stringify(w)}`}`);
}
const dflt = (fac, name, models) => {
  n++;
  const u = unit(fac, name);
  const w = u ? WP.warnings(u, models, WP.defaultLoadout(u, models)) : ['missing'];
  if (w.length) fails++;
  console.log(`${w.length ? 'FAIL' : 'ok  '} ${name} @${models}: default loadout is clean${w.length ? ' — ' + JSON.stringify(w) : ''}`);
};

// ── Crisis Fireknife: "Every model is equipped with: plasma rifle; missile
// pod; battlesuit fists." + "Any number of models can each have their
// plasma rifle replaced with 1 missile pod." + the reverse. So each model
// carries two guns: PR+MP, 2 PR or 2 MP. Drones: up to two, no duplicates.
const FK = 'Crisis Fireknife Battlesuits', V = 'Crisis Fireknife Shas’vre', U = 'Crisis Fireknife Shas’ui';
const fk = (vPR, vMP, uPR, uMP, extra = []) => [`${V}>Plasma rifle:${vPR}`, `${V}>Missile pod:${vMP}`, `${V}>Battlesuit fists:1`,
  `${U}>Plasma rifle:${uPR}`, `${U}>Missile pod:${uMP}`, `${U}>Battlesuit fists:2`, ...extra].filter((s) => !/:0$/.test(s));
dflt('tau-empire', FK, 3);
check('tau-empire', FK, 3, fk(2, 0, 4, 0, [`${U}>Gun Drone:2`, `${U}>Shield Drone:2`]), true, '2 plasma rifles per model (the reported loadout) is legal');
check('tau-empire', FK, 3, fk(0, 2, 0, 4), true, '2 missile pods per model is legal');
check('tau-empire', FK, 3, fk(1, 1, 3, 1), true, 'a mix (1+1, then 2 PR and 1+1) is legal');
check('tau-empire', FK, 3, fk(2, 1, 2, 2), false, '3 guns on the one Shas’vre is flagged', /Shas’vre: Missile pod 1 and swaps 1 for 1 model/);
check('tau-empire', FK, 3, fk(3, 0, 2, 2), false, '3 plasma rifles on the one Shas’vre is flagged', /Shas’vre: Missile pod 0 and swaps 2 for 1 model/);
check('tau-empire', FK, 3, fk(1, 1, 5, 0), false, '5 plasma rifles on 2 Shas’ui is flagged', /Shas’uis: Missile pod 0 and swaps 3 for 2 models/);
check('tau-empire', FK, 3, fk(1, 0, 2, 2), false, 'a Shas’vre with one gun is flagged', /Shas’vre: Missile pod 0 and swaps 0 for 1 model/);
// Starscythe / Sunforge share the shape ("burst cannon; T’au flamer" ⇄).
const SS = 'Crisis Starscythe Battlesuits', SV = 'Crisis Starscythe Shas’vre', SU = 'Crisis Starscythe Shas’ui';
dflt('tau-empire', SS, 3);
check('tau-empire', SS, 3, [`${SV}>Burst cannon:2`, `${SV}>Battlesuit fists:1`, `${SU}>Burst cannon:4`, `${SU}>Battlesuit fists:2`], true, '2 burst cannons per model is legal');
dflt('tau-empire', 'Crisis Sunforge Battlesuits', 3);

// ── Vespid Stingwings: "Each model is equipped with: neutron blaster;
// Stingwing claws." + "If this unit contains 10 models: ◦ The Vespid Strain
// Leader can be equipped with 1 Oversight Drone. ◦ 1 Vespid Stingwing can
// replace its neutron blaster with 1 T’au flamer. ◦ … 1 neutron grenade
// launcher. ◦ … 1 neutron rail rifle." — at 5 models no options at all.
const VS = 'Vespid Stingwings', VL = 'Vespid Strain Leader', VW = 'Vespid Stingwing';
const vs = (blasters, extra = [], leader = []) => [`${VL}>Neutron blaster:1`, `${VL}>Stingwing claws:1`, ...leader,
  `${VW}>Neutron blaster:${blasters}`, `${VW}>Stingwing claws:9`, ...extra];
dflt('tau-empire', VS, 5); dflt('tau-empire', VS, 10);
check('tau-empire', VS, 10, vs(6, [`${VW}>T’au flamer:1`, `${VW}>Neutron grenade launcher:1`, `${VW}>Neutron rail rifle:1`], [`${VL}>Oversight Drone:1`]), true, 'one of each special + Oversight Drone at 10 is legal');
check('tau-empire', VS, 10, vs(7, [`${VW}>T’au flamer:2`]), false, '2 T’au flamers at 10 is flagged', /T’au flamer 2 taken, the datasheet allows up to 1/);
check('tau-empire', VS, 5, [`${VL}>Neutron blaster:1`, `${VL}>Stingwing claws:1`, `${VW}>Neutron blaster:3`, `${VW}>Stingwing claws:4`, `${VW}>T’au flamer:1`], false,
  'a T’au flamer at 5 models is flagged and says why', /T’au flamer 1 taken, the datasheet allows up to 0 \(only with 10 models\)/);
// ── per-model counts > 1 ("each of its Xs can be replaced")
check('aeldari', 'War Walkers', 2, ['Bright lance:4', 'War Walker feet:2'], true, '"each shuriken cannon it is equipped with" — 4 bright lances on 2 is legal');
check('aeldari', 'War Walkers', 2, ['Bright lance:5', 'War Walker feet:2'], false, '5 bright lances on 2 is flagged');
check('aeldari', 'Wraithlord', 1, ['Flamer:2', 'Wraithbone fists:1'], true, '"each of this model’s shuriken catapults" — 2 flamers is legal');
check('drukhari', 'Ravager', 1, ['Disintegrator cannon:3', 'Bladevanes:1'], true, '"any number of this model’s dark lances" — 3 disintegrators is legal');
check('drukhari', 'Talos', 1, ['Twin splinter cannon:1', 'Talos ichor injector:2'], false, '"replace ONE of their macro-scalpels" — 2 injectors is flagged', /allows up to 1/);
check('drukhari', 'Talos', 1, ['Twin splinter cannon:1', 'Macro-scalpel:1', 'Talos ichor injector:1'], true, 'Talos: 1 injector + 1 scalpel is legal');
// A default that is also a swap target ("2 twin heavy flamers → 2 twin heavy bolters" next to its own).
const BB = ['Baneblade cannon:1', 'Co-axial autocannon:1', 'Demolisher cannon:1', 'Heavy stubber:1', 'Lascannon:2', 'Armoured tracks:1'];
check('astra-militarum', 'Baneblade', 1, [...BB, 'Twin heavy bolter:3'], true, 'twin heavy flamers swapped: 3 twin heavy bolters is legal');
check('astra-militarum', 'Baneblade', 1, [...BB, 'Twin heavy bolter:6'], false, '6 twin heavy bolters (1 + 2 swapped + 2 sponson = 5 max) is flagged');
// One take of a multi-item choice gains every item in it.
check('necrons', 'Seraptek Heavy Construct', 1, ['Synaptic obliterator:2', 'Transdimensional projector:2', 'Titanic forelimbs:1'], true, '2 obliterators AND 2 projectors is one legal swap');
// A per-unit choice limit binds only when every rule offering the item has one.
const LG = (cs) => ['Aspiring Champion>Bolt pistol:1', 'Aspiring Champion>Boltgun:1', 'Aspiring Champion>Close Combat Weapon:1',
  `Legionary>Bolt pistol:9`, `Legionary>Boltgun:${9 - cs}`, 'Legionary>Close Combat Weapon:9', `Legionary>Astartes chainsword:${cs}`];
check('chaos-space-marines', 'Legionaries', 10, LG(9), true, '"any number of Legionaries … Astartes chainsword" — 9 is legal');
check('astra-militarum', 'Catachan Command Squad', 5, ['Catachan Commander>Laspistol:1', 'Catachan Commander>Close combat weapon:1',
  'Veteran Guardsman>Lasgun:2', 'Veteran Guardsman>Laspistol:4', 'Veteran Guardsman>Close combat weapon:4', 'Veteran Guardsman>Flamer:2'], false,
  '"same weapon not more than once per unit" — 2 flamers is still flagged', /allows 1 per unit/);

// ── regressions from the inventory contract
check('necrons', 'Necron Warriors', 10, ['Gauss flayer:10', 'Gauss reaper:3', 'Close combat weapon:10'], false, '3 reapers, flayers untouched → slot warning', /Gauss flayer: 13 weapons for 10 models/);
check('necrons', 'Necron Warriors', 10, ['Gauss flayer:7', 'Gauss reaper:3', 'Close combat weapon:10'], true, '7 flayers + 3 reapers is legal');

// ── every unit's default loadout at every size is clean (known data faults listed)
const KNOWN = new Set([]);   // known data faults (none)
let swept = 0; const dirty = [];
for (const f of fs.readdirSync(DS).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
  const d = JSON.parse(fs.readFileSync(path.join(DS, f), 'utf8'));
  for (const u of d.units || []) {
    if (!u.wargearProfile || KNOWN.has(u.name)) continue;
    for (const so of (u.squadOptions && u.squadOptions.length ? u.squadOptions : [{ models: null }])) {
      swept++;
      if (WP.warnings(u, so.models, WP.defaultLoadout(u, so.models)).length) dirty.push(`${f}:${u.name}@${so.models}`);
    }
  }
}
n++;
if (dirty.length) fails++;
console.log(`${dirty.length ? 'FAIL' : 'ok  '} default loadouts clean across ${swept} unit sizes${dirty.length ? ': ' + dirty.slice(0, 10).join(', ') : ''}`);

{ // Krieg Command Squad: five model types differing only in a "(...)" suffix
  const ds = JSON.parse(fs.readFileSync(path.join(DS, 'astra-militarum.json'), 'utf8'));
  const u = (ds.units || []).find((x) => x.name === 'Krieg Command Squad');
  const sizes = u ? (u.squadOptions && u.squadOptions.length ? u.squadOptions.map((o) => o.models) : [null]) : [];
  const bad = [];
  for (const sz of sizes) {
    const w = WP.warnings(u, sz, WP.defaultLoadout(u, sz));
    if (w.length) bad.push(`${sz}: ${w.length} warnings`);
    const lo = WP.defaultLoadout(u, sz);
    if (new Set(lo.map((x) => x.model)).size < 5) bad.push(`${sz}: <5 distinct model types`);
    if (WP.needsModel(u, sz, lo)) bad.push(`${sz}: rows not mapped to blocks`);
  }
  n++;
  const ok = u && sizes.length && !bad.length;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} Krieg Command Squad default loadout clean at every size${bad.length ? ': ' + bad.join(', ') : ''}`);
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
