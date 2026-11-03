// scripts/verify/tts-export.mjs — "Send to Tabletop Simulator" check (docs/TTS-EXPORT.md §2).
//
// Node only, no browser. Evaluates js/app/tts-export.js under a stub window,
// builds a synthetic army from the live dataset, writes the .regiztry zip to
// OUT, POSTs it to Yellowscribe's own parser (/getFormattedArmy — parses and
// returns the roster, stores nothing, mints no code) and asserts on what came
// back. Yellowscribe is a volunteer service: run this a handful of times, not
// in a loop.
//
//   docker run --rm -v "$PWD":/w -w /w -e OUT=/w/.work/tts node:22-slim \
//     node scripts/verify/tts-export.mjs              # from app/
//   NO_POST=1 ...   build + zip only, skip the network call
//   YS_URL=...      parser base URL (default https://yellowscribe.link)
//   PARSED=file     re-run the assertions on a saved parsed.json, no POST
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.OUT || path.join(APP, '.work', 'tts');
const YS = (process.env.YS_URL || 'https://yellowscribe.link').replace(/\/$/, '');
mkdirSync(OUT, { recursive: true });

// ── load the IIFE ──────────────────────────────────────────────────────────
const window = { App: {}, UI: {
  factionShort: (n) => (n && n.includes(' - ') ? n.split(' - ').pop().trim() : (n || '')),
  mdPlain: (s) => String(s == null ? '' : s).replace(/\*\*/g, ''),
} };
new Function('window', readFileSync(path.join(APP, 'js/app/tts-export.js'), 'utf8'))(window);
const T = window.App.TtsExport;
// army.js (Army statics) + the picker's rule engine, to build each synthetic
// entry's inventory (entry.loadout, docs/WARGEAR-RULES.md §5) the way the app
// does: defaults at the size − replaced + added.
new Function('window', readFileSync(path.join(APP, 'js/army.js'), 'utf8'))(window);
globalThis.Army = window.Army;
new Function('window', 'document', readFileSync(path.join(APP, 'js/app/wargear-picker.js'), 'utf8'))(window, { getElementById: () => null });
const W = window.App.WargearPicker;

// ── synthetic army ─────────────────────────────────────────────────────────
const fac = (id) => JSON.parse(readFileSync(path.join(APP, 'data/dataset/current', id + '.json'), 'utf8'));
const sm = fac('adeptus-astartes'), nec = fac('necrons'), am = fac('astra-militarum');
const unit = (f, name) => {
  const u = f.units.find((x) => x.name === name);
  if (!u) throw new Error(`no unit "${name}" in ${f.factionName}`);
  return Object.assign({}, u, { _factionName: f.factionName });
};
// A rule (wargearProfile.rules, or legacy options via rulesOf) offering a match.
const optId = (u, test) => {
  const o = W.rulesOf(u.wargearProfile).find(test);
  if (!o) throw new Error(`no matching wargear option on ${u.name}`);
  return o;
};
const choiceOf = (o, re) => o.choices.findIndex((g) => g.some((x) => re.test(x.name)));

const isq = unit(sm, 'Intercessor Squad');
const hammerOpt = optId(isq, (o) => o.choices.some((g) => g.some((x) => /thunder hammer/i.test(x.name))));
const glOpt = optId(isq, (o) => o.choices.some((g) => g.some((x) => /grenade launcher/i.test(x.name))));
const cap = unit(sm, 'Captain in Terminator Armour');
const enh = sm.detachments.flatMap((d) => d.enhancements || []).find((e) => e && e.name);
const nw = unit(nec, 'Necron Warriors');
const reaperOpt = optId(nw, (o) => o.choices.some((g) => g.some((x) => /gauss reaper/i.test(x.name))));
const lr = unit(am, 'Leman Russ Battle Tank');

const sel = (o, re, count) => {
  const ci = choiceOf(o, re);
  return { optionId: o.id, choice: ci, count, items: o.choices[ci].map((x) => x.name), label: '' };
};
const lo = (u, models, sels) => W.loadoutFromWargear(u, models, sels);
const army = { name: 'TTS verify', entries: [
  { unitId: isq.id, unitData: isq, count: 1, squadLabel: '10 models', selectedPts: 170, enhancements: [],
    loadout: lo(isq, 10, [sel(hammerOpt, /thunder hammer/i, 1), sel(glOpt, /grenade launcher/i, 2)]) },
  { unitId: cap.id, unitData: cap, count: 1, squadLabel: '1 models', selectedPts: cap.points,
    enhancements: [{ name: enh.name, pts: enh.pts, description: enh.description }], loadout: lo(cap, 1, []) },
  { unitId: nw.id, unitData: nw, count: 1, squadLabel: '10 models', selectedPts: 85, enhancements: [],
    loadout: lo(nw, 10, [sel(reaperOpt, /gauss reaper/i, 3)]) },
  { unitId: lr.id, unitData: lr, count: 1, squadLabel: null, selectedPts: lr.points, enhancements: [], loadout: lo(lr, 1, []) },
] };
army.entries.forEach((e) => console.log(`  loadout ${e.unitData.name}: ${e.loadout.map((x) => x.count + 'x ' + x.name).join(', ')}`));

const reg = T.buildRegistry(army);
writeFileSync(path.join(OUT, 'roster.regiztry.json'), JSON.stringify(reg, null, 2));
const zip = T.buildZip(reg);
writeFileSync(path.join(OUT, 'yaab.regiztry'), zip);
console.log(`built ${reg.assets.included.length} unit assets, zip ${zip.length} bytes -> ${OUT}/yaab.regiztry`);

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

if (process.env.NO_POST) { console.log('NO_POST set: skipped the Yellowscribe parse'); process.exit(0); }

// ── parse with Yellowscribe ────────────────────────────────────────────────
let text;
if (process.env.PARSED) {
  text = readFileSync(process.env.PARSED, 'utf8');
  console.log(`using saved parse ${process.env.PARSED} (no POST)`);
} else {
  const resp = await fetch(`${YS}/getFormattedArmy?filename=yaab.regiztry`, {
    method: 'POST', body: zip,
    headers: { 'Content-Type': 'application/octet-stream', 'User-Agent': 'yaab verify (yaab.thewheeliebois.com)' },
  });
  text = await resp.text();
  writeFileSync(path.join(OUT, 'parsed.json'), text);
  ok(resp.ok, `Yellowscribe parsed the file (HTTP ${resp.status})`);
  if (!resp.ok) { console.log(text.slice(0, 500)); process.exit(1); }
}
const roster = JSON.parse(text);

// Roster.serialize flattens Maps; accept either a plain object or [k, v] pairs.
const vals = (m) => (m == null ? [] : Array.isArray(m) ? m.map((x) => (Array.isArray(x) ? x[1] : x)) : Object.values(m));
const units = vals(roster.units);
const models = (u) => vals(u.models && u.models.models);
const weaponCount = (u, re) => models(u).reduce((s, m) =>
  s + (m.weapons || []).filter((w) => re.test(w.name)).reduce((a, w) => a + (w.number || 1) * (m.number || 1), 0), 0);
const modelsWith = (u, re) => models(u).filter((m) => (m.weapons || []).some((w) => re.test(w.name)))
  .reduce((s, m) => s + (m.number || 1), 0);
const byName = (re) => units.find((u) => re.test(u.name));

for (const u of units) {
  console.log(`  ${u.name}: ${models(u).map((m) => `${m.number}x ${m.name} [${(m.weapons || []).map((w) => (w.number > 1 ? w.number + 'x ' : '') + w.name).join(', ')}]`).join(' | ')}`);
}

ok((roster.errors || []).length === 0, `zero errors (${JSON.stringify(roster.errors || [])})`);
ok(units.length === 4, `4 units (got ${units.length})`);

const iu = byName(/^Intercessor Squad/);
ok(!!iu, 'Intercessor Squad present');
if (iu) {
  const total = models(iu).reduce((s, m) => s + m.number, 0);
  const sgt = models(iu).filter((m) => /Sergeant/.test(m.name)).reduce((s, m) => s + m.number, 0);
  ok(total === 10, `Intercessors: 10 models (got ${total})`);
  ok(sgt === 1, `Intercessors: 1 Sergeant (got ${sgt})`);
  ok(total - sgt === 9, `Intercessors: 9 Intercessors (got ${total - sgt})`);
  ok(modelsWith(iu, /^Thunder Hammer/i) === 1, `thunder hammer on exactly one model (got ${modelsWith(iu, /^Thunder Hammer/i)})`);
  const hammerOnSgt = models(iu).some((m) => /Sergeant/.test(m.name) && (m.weapons || []).some((w) => /^Thunder Hammer/i.test(w.name)));
  ok(hammerOnSgt, 'thunder hammer is on the Sergeant');
  ok(modelsWith(iu, /^Grenade Launcher – Frag/i) === 2, `2 grenade launchers (got ${modelsWith(iu, /^Grenade Launcher – Frag/i)})`);
  ok(modelsWith(iu, /^Bolt Rifle – Saturation/i) === 10, `bolt rifle on all 10 (got ${modelsWith(iu, /^Bolt Rifle – Saturation/i)})`);
  const kaf = models(iu).filter((m) => /Sergeant/.test(m.name)).some((m) => (m.weapons || []).some((w) => /Knives and Fists/i.test(w.name)));
  ok(!kaf, 'Sergeant gave up Knives and Fists for the hammer');
}

const cu = byName(/Captain in Terminator Armour/);
ok(!!cu, 'Captain in Terminator Armour present');
if (cu) {
  const abil = Object.keys(cu.abilities || {}).concat(models(cu).flatMap((m) => m.abilities ? Array.from(m.abilities) : []));
  ok(abil.some((a) => a === enh.name), `enhancement "${enh.name}" present`);
  ok(abil.some((a) => a === 'Invulnerable Save'), 'invulnerable save present');
  ok(models(cu).length === 1 && models(cu)[0].number === 1, 'Captain is one model');
}

const nu = byName(/Necron Warriors/);
ok(!!nu, 'Necron Warriors present');
if (nu) {
  const total = models(nu).reduce((s, m) => s + m.number, 0);
  ok(total === 10, `Necron Warriors: 10 models (got ${total})`);
  ok(modelsWith(nu, /^Gauss reaper/i) === 3, `3 gauss reapers (got ${modelsWith(nu, /^Gauss reaper/i)})`);
  ok(modelsWith(nu, /^Gauss flayer/i) === 7, `7 gauss flayers left (got ${modelsWith(nu, /^Gauss flayer/i)})`);
}

const lu = byName(/Leman Russ/);
ok(!!lu, 'Leman Russ Battle Tank present');
if (lu) {
  ok(models(lu).length === 1 && models(lu)[0].number === 1, 'Leman Russ is one model');
  ok(weaponCount(lu, /battle cannon/i) === 1 && weaponCount(lu, /^Lascannon/i) === 1, 'Leman Russ has its battle cannon + lascannon');
  const fk = vals(lu.factionKeywords);
  ok(fk.includes('Astra Militarum') && !vals(lu.keywords).includes('Astra Militarum'),
    `faction keyword Astra Militarum split from keywords (${fk.join(', ')})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
