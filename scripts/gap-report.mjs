// gap-report.mjs — audit every faction for MISSING game data, exactly as a user
// would see it after all of yaab's data layers run: the 40kdc bundle
// (js/vendor/dc-bundle.js) + the dc-adapter.js hand-patches + the live GDC text
// overlay (js/gdc.js). Prints a plain-text report to stdout. Run in a node:22
// container with network access (the GDC overlay fetches game-datacards JSON):
//
//   docker run --rm -v <app>:/app -w /app node:22-alpine node scripts/gap-report.mjs
//
// The wrapper ~/sites/base/gap-report.sh runs this and emails the output.
import { readFileSync } from 'node:fs';

const APP = process.env.APP_DIR || '/app';
const read = (p) => readFileSync(`${APP}/${p}`, 'utf8');

// ── stand up the production data pipeline in node ──────────────────────────
global.window = {};
// 1. The built bundle sets window.DC (units/factions/… + embedded abilityText).
(0, eval)(read('js/vendor/dc-bundle.js'));
if (!global.window.DC) { console.error('FATAL: window.DC not set by bundle'); process.exit(2); }
// 2. Minimal App shim: the GDC merge routes chapter detachments/strats through
//    App.CHAPTER_PARENTS (mirror of js/app/state.js).
const SM = 'Imperium - Adeptus Astartes - Space Marines';
global.window.App = { CHAPTER_PARENTS: {
  'Imperium - Adeptus Astartes - Blood Angels':    SM,
  'Imperium - Adeptus Astartes - Dark Angels':     SM,
  'Imperium - Adeptus Astartes - Space Wolves':    SM,
  'Imperium - Adeptus Astartes - Black Templars':  SM,
  'Imperium - Adeptus Astartes - Deathwatch':      SM,
  'Imperium - Adeptus Astartes - Imperial Fists':  SM,
  'Imperium - Adeptus Astartes - Iron Hands':      SM,
  'Imperium - Adeptus Astartes - Raven Guard':     SM,
  'Imperium - Adeptus Astartes - Salamanders':     SM,
  'Imperium - Adeptus Astartes - Ultramarines':    SM,
  'Imperium - Adeptus Astartes - White Scars':     SM,
} };
// 3. Adapter → window.BSData ; GDC overlay → window.App.GDC.
(0, eval)(read('js/data/dc-adapter.js'));
(0, eval)(read('js/gdc.js'));
const { BSData, App } = global.window;

// 4. Build + overlay + reconcile exactly like loadAllFactions() does at runtime.
const factions = BSData._build();
try {
  await App.GDC.loadAll(factions.map((f) => f.factionName));
  App.GDC.mergeIntoFactions(factions);
} catch (e) { console.error('WARN: GDC overlay failed:', e && e.message); }
factions.forEach((f) => (f.detachments || []).forEach((d) => { try { BSData._reconcileStrats(d); } catch (_) {} }));

// ── scan for gaps ──────────────────────────────────────────────────────────
// The ~15 generic Space Marine detachments repeat under all 12 SM chapters as
// separate objects, so a raw per-faction count multiplies the same underlying
// gap 12x. We DEDUPE the shared categories (detachments/strats/enhancements) by
// content, tracking how many faction-copies each affects, and flag whether a
// gap sits in a "generic" (parent-SM) detachment (systemic — one fix) vs a
// faction-unique one (genuinely-absent upstream data).
const hasText = (s) => !!(s && String(s).trim());
const short = (name) => name.replace(/^(Imperium|Xenos|Chaos) - (Adeptus Astartes - )?/, '');
const smParent = factions.find((f) => f.factionName.endsWith('- Space Marines'));
const genericDet = new Set((smParent ? smParent.detachments || [] : []).map((d) => d.name));

const unitsNoAbil = [];   // "faction :: unit"
const abilNoText = [];    // "faction :: unit → ability"
const armyNoText = [];    // "faction :: rule"
// content-key → { factions:Set, generic:bool }
const detRules = new Map(), strat = new Map(), enh = new Map();
const bump = (m, key, faction, generic) => {
  const e = m.get(key) || { factions: new Set(), generic };
  e.factions.add(faction); m.set(key, e);
};

for (const f of factions) {
  const fn = short(f.factionName);
  for (const u of (f.units || [])) {
    const abils = u.abilities || [];
    if (abils.length === 0) unitsNoAbil.push(`${fn} :: ${u.id || u.name}`);
    else abils.filter((a) => a && !a.isCore && a.name && !hasText(a.description))
             .forEach((a) => abilNoText.push(`${fn} :: ${u.id || u.name} → ${a.name}`));
  }
  for (const r of (f.armyRules || [])) if (r && r.name && !hasText(r.description)) armyNoText.push(`${fn} :: ${r.name}`);
  for (const d of (f.detachments || [])) {
    const g = genericDet.has(d.name);
    const rules = d.rules || [];
    if (rules.length === 0 || !rules.some((r) => hasText(r.description))) bump(detRules, d.name, fn, g);
    for (const s of (d.gdcStratagems || [])) if (s && s.name && !hasText(s.description)) bump(strat, `${d.name} → ${s.name}`, fn, g);
    for (const e of (d.enhancements || [])) if (e && e.name && !hasText(e.description)) bump(enh, `${d.name} → ${e.name}`, fn, g);
  }
}

const split = (m) => {
  const genuine = [], systemic = [];
  for (const [k, v] of m) (v.generic ? systemic : genuine).push({ k, n: v.factions.size });
  const bySize = (a, b) => b.n - a.n || a.k.localeCompare(b.k);
  return { genuine: genuine.sort(bySize), systemic: systemic.sort(bySize) };
};
const dRules = split(detRules), sStrat = split(strat), eEnh = split(enh);

// ── render ─────────────────────────────────────────────────────────────────
const out = [];
const stamp = process.env.REPORT_DATE || '(undated)';
const nf = (arr) => new Set(arr.map((x) => x.split(' :: ')[0])).size;
out.push(`yaab DATA GAP REPORT — ${stamp}`);
out.push(`Pipeline scanned: 40kdc bundle + dc-adapter.js hand-patches + live GDC overlay (what users actually see)`);
out.push(`Factions: ${factions.length}   Units: ${factions.reduce((n, f) => n + (f.units || []).length, 0)}`);
out.push('');
out.push('════ SUMMARY ════');
out.push(`Units with NO abilities ........ ${unitsNoAbil.length}   (across ${nf(unitsNoAbil)} factions)`);
out.push(`Abilities present but no text .. ${abilNoText.length}   (across ${nf(abilNoText)} factions)`);
out.push(`Army rules missing text ........ ${armyNoText.length}`);
out.push(`Detachments missing rules ...... ${dRules.genuine.length} genuine  +  ${dRules.systemic.length} in generic SM detachments (chapter-inherited)`);
out.push(`Stratagems missing text ........ ${sStrat.genuine.length} genuine  +  ${sStrat.systemic.length} in generic SM detachments (chapter-inherited)`);
out.push(`Enhancements missing text ...... ${eEnh.genuine.length} genuine  +  ${eEnh.systemic.length} in generic SM detachments`);
out.push('');
out.push('════ SYSTEMIC NOTES (fix once, not per-item) ════');
out.push('1. ENHANCEMENTS: yaab sources enhancement prose only from 40kdc (almost all empty); the GDC overlay is NOT wired to fill enhancement text the way it now fills detachment rules. This is the bulk of the numbers above — ONE fix (merge GDC enhancement text) closes most of it.');
out.push('2. CHAPTER-INHERITED: the ~15 generic Space Marine detachments repeat under all 12 SM chapters. Their detachment RULES are parent-borrowed, but their STRATAGEM/ENHANCEMENT text is not routed to the chapter copies (it lives in space_marines.json). "chapter-inherited" counts above are that one gap, deduped. Fix: extend the parent-borrow to strats + enhancements.');
out.push('');
out.push('════ GENUINELY-ABSENT DATA (actionable, deduped) ════');
out.push('');
const listBlock = (label, arr) => { out.push(`── ${label} (${arr.length}) ──`); if (!arr.length) out.push('   (none)'); arr.forEach((x) => out.push(`   - ${x}`)); out.push(''); };
const keyBlock = (label, arr) => { out.push(`── ${label} (${arr.length}) ──`); if (!arr.length) out.push('   (none)'); arr.forEach((e) => out.push(`   - ${e.k}${e.n > 1 ? `   (×${e.n} factions)` : ''}`)); out.push(''); };
listBlock('Units with NO abilities', unitsNoAbil);
listBlock('Abilities present but missing text', abilNoText);
listBlock('Army rules missing text', armyNoText);
keyBlock('Detachments missing rules — faction-unique', dRules.genuine);
keyBlock('Stratagems missing text — faction-unique', sStrat.genuine);
keyBlock('Enhancements missing text — faction-unique', eEnh.genuine);
out.push('════ CHAPTER-INHERITED (systemic — generic SM detachments, deduped) ════');
keyBlock('Detachments missing rules — generic SM', dRules.systemic);
keyBlock('Stratagems missing text — generic SM', sStrat.systemic);
out.push(`Enhancements missing text — generic SM: ${eEnh.systemic.length} unique (list omitted; see systemic note #1/#2)`);
console.log(out.join('\n'));
