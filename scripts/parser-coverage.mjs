#!/usr/bin/env node
// scripts/parser-coverage.mjs
//
// Run the in-browser BattleScribe parser against every locally-mirrored
// catalogue and emit a coverage report comparing what's *in* the XML
// vs what made it *into* the parsed Unit / armyRules / detachments output.
//
// Goal: surface profile typeNames, characteristic names, etc. that the
// parser silently drops, plus per-unit health (missing weapons / stats /
// abilities). The script is deliberately additive — it doesn't modify the
// parser. It just runs it and diffs.
//
// Usage:
//   docker run --rm -v "$(pwd):/work" -w /work node:20-alpine sh -c \
//     'npm i --no-save linkedom >/dev/null 2>&1 && node scripts/parser-coverage.mjs'
//
// Outputs:
//   scripts/parser-coverage-report.json   — full structured aggregate
//   scripts/parser-coverage-report.md     — human-skimmable summary

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirror index.html's <script src="js/parser/..."> order exactly. Order
// matters because each module is an IIFE that mutates window.WahapediaParser
// and may depend on previous modules' exports.
const PARSER_FILES = [
  'js/parser/shared-index.js',
  'js/parser/classify.js',
  'js/parser/stats.js',
  'js/parser/weapons.js',
  'js/parser/abilities.js',
  'js/parser/wargear.js',
  'js/parser/costs.js',
  'js/parser/keywords.js',
  'js/parser/entry.js',
  'js/parser/catalogue.js',
  'js/parser/index.js',
];

// typeName values the parser intentionally ignores (Crusade / Battle Honours,
// per docs/PARSER.md). Don't flag these as "gaps" in the report — they're policy.
const INTENTIONAL_TYPENAME_SKIPS = new Set([
  // Populated empirically as we triage. Empty for first pass.
]);

// ── Set up a minimal browser-shaped environment ───────────────────────────
const { window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.localStorage = {
  _data: new Map(),
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
  setItem(k, v) { this._data.set(k, String(v)); },
  removeItem(k) { this._data.delete(k); },
  clear() { this._data.clear(); },
};
// Some parser modules check console; linkedom doesn't ship one. Already provided
// by Node, but make sure window.console exists too in case any IIFE uses it.
window.console = console;

// ── Load parser modules in order ──────────────────────────────────────────
for (const rel of PARSER_FILES) {
  const src = await readFile(resolve(ROOT, rel), 'utf8');
  // Each parser file is an IIFE. Run it with `this === window` and the same
  // bare `window`/`document` references it expects from the browser.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src).call(window, window, window.document);
}

const Parser = window.WahapediaParser;
if (!Parser || typeof Parser.parse !== 'function') {
  console.error('FATAL: WahapediaParser.parse is not a function after loading parser modules.');
  process.exit(1);
}
const classifyProfile = Parser._internal && Parser._internal.classifyProfile;
if (typeof classifyProfile !== 'function') {
  console.error('FATAL: WahapediaParser._internal.classifyProfile not exposed.');
  process.exit(1);
}
// Characteristic names that classifyProfile uses as "this profile carries ability
// prose" sentinels (per classify.js). Treat them as handled when surfaced as
// characteristics — they make it into ability.description, not into stat keys.
const DESCRIPTION_CHARACTERISTICS = new Set(['Description', 'Effect', 'Capacity']);

// ── Collect XML-side and parser-side facts per file ───────────────────────
// XML-side
const xmlElementCounts = new Map();           // tag -> count
const xmlAttrSet = new Set();
const xmlProfileTypes = new Map();            // typeName -> { count, factions: Set, examples: [] }
const xmlCharacteristicNames = new Map();     // name -> count
const xmlInfoLinkTypes = new Map();           // type -> count
const xmlModifierFields = new Map();          // field -> count
const xmlConstraintFields = new Map();        // field -> count
const xmlCostNames = new Map();               // cost name -> count

// Parser-output side
const handledProfileTypes = new Set();
const handledCharacteristicNames = new Set();
const handledKeywords = new Set();

// Per-faction summary + per-unit anomalies
const perFaction = [];
const emptyUnits = [];          // missing weapons OR stats
const noAbilityUnits = [];      // separately tracked
const noWargearUnits = [];      // separately tracked
const zeroPointsUnits = [];

const filesDir = resolve(ROOT, 'data/bsdata/files');
const files = (await readdir(filesDir))
  .filter(f => f.endsWith('.cat.xml') || f.endsWith('.gst.xml'))
  .sort();

console.log(`[coverage] parsing ${files.length} files…`);
let parsedOk = 0;
let parseFailures = [];

for (const fname of files) {
  const xmlPath = resolve(filesDir, fname);
  const xml = await readFile(xmlPath, 'utf8');
  const isStub = /Library/i.test(fname) || /Unaligned/i.test(fname);

  // XML-side: enumerate every interesting node
  let doc;
  try {
    doc = new window.DOMParser().parseFromString(xml, 'text/xml');
  } catch (err) {
    parseFailures.push({ file: fname, phase: 'dom-parse', error: String(err) });
    continue;
  }

  for (const el of doc.querySelectorAll('*')) {
    xmlElementCounts.set(el.tagName, (xmlElementCounts.get(el.tagName) || 0) + 1);
    for (const a of el.attributes || []) xmlAttrSet.add(a.name);
  }
  for (const p of doc.querySelectorAll('profile[typeName]')) {
    const t = p.getAttribute('typeName');
    if (!xmlProfileTypes.has(t)) xmlProfileTypes.set(t, {
      count: 0, factions: new Set(), examples: new Set(),
      classifyVerdicts: new Map(),         // 'ability'|'stats'|'weapon'|'other' -> count
      sampleCharacteristicNames: new Set(),
    });
    const e = xmlProfileTypes.get(t);
    e.count++;
    e.factions.add(fname);
    if (e.examples.size < 5) e.examples.add(p.getAttribute('name') || '?');
    const verdict = classifyProfile(p);
    e.classifyVerdicts.set(verdict, (e.classifyVerdicts.get(verdict) || 0) + 1);
    if (e.sampleCharacteristicNames.size < 6) {
      for (const ch of p.querySelectorAll('characteristic[name]')) {
        e.sampleCharacteristicNames.add(ch.getAttribute('name'));
        if (e.sampleCharacteristicNames.size >= 6) break;
      }
    }
  }
  for (const c of doc.querySelectorAll('characteristic[name]')) {
    const n = c.getAttribute('name');
    xmlCharacteristicNames.set(n, (xmlCharacteristicNames.get(n) || 0) + 1);
  }
  for (const il of doc.querySelectorAll('infoLink[type]')) {
    const t = il.getAttribute('type');
    xmlInfoLinkTypes.set(t, (xmlInfoLinkTypes.get(t) || 0) + 1);
  }
  for (const m of doc.querySelectorAll('modifier[field]')) {
    const f = m.getAttribute('field');
    xmlModifierFields.set(f, (xmlModifierFields.get(f) || 0) + 1);
  }
  for (const c of doc.querySelectorAll('constraint[field]')) {
    const f = c.getAttribute('field');
    xmlConstraintFields.set(f, (xmlConstraintFields.get(f) || 0) + 1);
  }
  for (const c of doc.querySelectorAll('cost[name]')) {
    const n = c.getAttribute('name');
    xmlCostNames.set(n, (xmlCostNames.get(n) || 0) + 1);
  }

  // Parser-side
  let result;
  try {
    result = Parser.parse(xml, fname);
  } catch (err) {
    parseFailures.push({ file: fname, phase: 'parser', error: String(err), stack: err && err.stack });
    continue;
  }
  parsedOk++;

  const units = result?.units || [];
  perFaction.push({
    file: fname,
    isStub,
    factionName: result?.factionName || '(unknown)',
    units: units.length,
    armyRules: (result?.armyRules || []).length,
    detachments: (result?.detachments || []).length,
    unitsMissingWeapons:   units.filter(u => !u?.weapons   || !u.weapons.length).length,
    unitsMissingStats:     units.filter(u => !u?.stats     || !Object.keys(u.stats).length).length,
    unitsMissingAbilities: units.filter(u => !u?.abilities || !u.abilities.length).length,
    unitsMissingWargear:   units.filter(u => !u?.wargearOptions || !u.wargearOptions.length).length,
    unitsZeroPoints:       units.filter(u => (u?.points || 0) === 0).length,
  });

  for (const u of units) {
    if (!u) continue;
    const noWeapons = !u.weapons || !u.weapons.length;
    const noStats = !u.stats || !Object.keys(u.stats).length;
    const noAbil = !u.abilities || !u.abilities.length;
    const noWg = !u.wargearOptions || !u.wargearOptions.length;
    const zeroPts = !u.points;

    for (const w of (u.weapons || []))   if (w?._typeName) handledProfileTypes.add(w._typeName);
    for (const a of (u.abilities || [])) if (a?._typeName) handledProfileTypes.add(a._typeName);
    for (const m of (u.modelStats || [])) if (m?._typeName) handledProfileTypes.add(m._typeName);
    for (const k of Object.keys(u.stats || {}))            handledCharacteristicNames.add(k);
    for (const m of (u.modelStats || []))
      for (const k of Object.keys(m || {}))                if (!k.startsWith('_')) handledCharacteristicNames.add(k);
    for (const w of (u.weapons || []))
      for (const k of Object.keys(w || {}))                if (!k.startsWith('_')) handledCharacteristicNames.add(k);
    for (const k of (u.keywords || []))                    handledKeywords.add(k);

    if (noWeapons || noStats) {
      emptyUnits.push({ file: fname, faction: result?.factionName, unit: u.name, noWeapons, noStats });
    }
    if (noAbil)  noAbilityUnits.push({ file: fname, faction: result?.factionName, unit: u.name });
    if (noWg)    noWargearUnits.push({ file: fname, faction: result?.factionName, unit: u.name });
    if (zeroPts) zeroPointsUnits.push({ file: fname, faction: result?.factionName, unit: u.name });
  }

  // Detachments / armyRules / stratagems also go through profile typeName
  // routing — credit those typeNames too.
  for (const det of (result?.detachments || [])) {
    for (const r of (det?.rules || []))         if (r?._typeName) handledProfileTypes.add(r._typeName);
    for (const e of (det?.enhancements || [])) if (e?._typeName) handledProfileTypes.add(e._typeName);
    for (const s of (det?.stratagems || []))   if (s?._typeName) handledProfileTypes.add(s._typeName);
  }
  for (const r of (result?.armyRules || []))     if (r?._typeName) handledProfileTypes.add(r._typeName);
}

console.log(`[coverage] parsed ${parsedOk}/${files.length} files (${parseFailures.length} failures)`);

// ── Compute diffs ─────────────────────────────────────────────────────────
function unhandled(map, handledSet) {
  const out = [];
  for (const [k, v] of map.entries()) {
    if (handledSet.has(k)) continue;
    if (INTENTIONAL_TYPENAME_SKIPS.has(k)) continue;
    out.push({ name: k, count: typeof v === 'number' ? v : v.count });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// For typeNames we have richer metadata; render specifically. Classify each
// typeName into one of three buckets:
//   - 'classify-other'           classifyProfile said 'other' AND no description
//                                 carrier characteristic → parser silently drops.
//                                 This is the high-signal "real gap" bucket.
//   - 'classified-but-missing'   classify said 'ability'/'stats'/'weapon' (parser
//                                 INTENDS to handle) but no output ever stamped
//                                 _typeName=this. Either extraction failed or the
//                                 parser absorbs it without tagging (e.g. Unit
//                                 absorbed into u.stats).
//   - 'handled'                   appeared in output's _typeName.
function classifyTypeNameDetail() {
  const out = [];
  for (const [t, info] of xmlProfileTypes.entries()) {
    if (INTENTIONAL_TYPENAME_SKIPS.has(t)) continue;
    const verdicts = [...info.classifyVerdicts.entries()].sort((a, b) => b[1] - a[1]);
    const dominantVerdict = verdicts[0]?.[0] || 'other';
    const inOutput = handledProfileTypes.has(t);
    let bucket;
    if (inOutput) bucket = 'handled';
    else if (dominantVerdict === 'other') bucket = 'classify-other';
    else bucket = 'classified-but-missing';
    out.push({
      typeName: t,
      count: info.count,
      factions: info.factions.size,
      examples: [...info.examples].slice(0, 5),
      sampleCharacteristicNames: [...info.sampleCharacteristicNames],
      classifyVerdicts: Object.fromEntries(info.classifyVerdicts),
      bucket,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

const allTypeNameDetail = classifyTypeNameDetail();
const realGapTypeNames = allTypeNameDetail.filter(e => e.bucket === 'classify-other');
const classifiedButMissing = allTypeNameDetail.filter(e => e.bucket === 'classified-but-missing');

// Characteristic names: subtract description carriers (Description, Effect, Capacity)
// because the parser extracts those into ability.description, not as stat keys.
function unhandledCharacteristicNamesFiltered() {
  const out = [];
  for (const [k, v] of xmlCharacteristicNames.entries()) {
    if (handledCharacteristicNames.has(k)) continue;
    if (DESCRIPTION_CHARACTERISTICS.has(k)) continue;
    out.push({ name: k, count: v });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
const unhandledCharNames = unhandledCharacteristicNamesFiltered();
const summary = {
  generatedAt: new Date().toISOString(),
  sourceCommit: await (async () => {
    try {
      const idx = JSON.parse(await readFile(resolve(ROOT, 'data/bsdata/index.json'), 'utf8'));
      return idx.sourceCommit || null;
    } catch (_) { return null; }
  })(),
  totals: {
    files: files.length,
    parsedOk,
    parseFailures: parseFailures.length,
    distinctElementNames: xmlElementCounts.size,
    distinctAttributeNames: xmlAttrSet.size,
    distinctProfileTypes: xmlProfileTypes.size,
    distinctCharacteristicNames: xmlCharacteristicNames.size,
    handledProfileTypes: handledProfileTypes.size,
    handledCharacteristicNames: handledCharacteristicNames.size,
    realGapTypeNames: realGapTypeNames.length,           // classify says 'other' AND not in output
    classifiedButMissing: classifiedButMissing.length,   // classify says 'ability/etc' but not in output
    unhandledCharacteristicNames: unhandledCharNames.length,
  },
  parseFailures,
  realGapTypeNames,                       // priority — these are classify.js gaps
  classifiedButMissing,                   // either harness FP or extraction bug
  unhandledCharacteristicNames: unhandledCharNames,
  allTypeNameDetail,                      // full reference list with classify verdicts
  xmlInfoLinkTypes: [...xmlInfoLinkTypes.entries()].map(([k, v]) => ({ type: k, count: v })).sort((a, b) => b.count - a.count),
  xmlModifierFields: [...xmlModifierFields.entries()].map(([k, v]) => ({ field: k, count: v })).sort((a, b) => b.count - a.count),
  xmlConstraintFields: [...xmlConstraintFields.entries()].map(([k, v]) => ({ field: k, count: v })).sort((a, b) => b.count - a.count),
  xmlCostNames: [...xmlCostNames.entries()].map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count),
  xmlElementFrequency: [...xmlElementCounts.entries()].map(([k, v]) => ({ tag: k, count: v })).sort((a, b) => b.count - a.count),
  perFaction: perFaction.sort((a, b) => a.factionName.localeCompare(b.factionName)),
  emptyUnitsCount: emptyUnits.length,
  emptyUnits,
  noAbilityUnitsCount: noAbilityUnits.length,
  noAbilityUnits: noAbilityUnits.slice(0, 200),     // cap so the JSON isn't huge
  noWargearUnitsCount: noWargearUnits.length,
  noWargearUnits: noWargearUnits.slice(0, 200),
  zeroPointsUnitsCount: zeroPointsUnits.length,
  zeroPointsUnits: zeroPointsUnits.slice(0, 200),
  handledProfileTypes: [...handledProfileTypes].sort(),
  handledCharacteristicNames: [...handledCharacteristicNames].sort(),
};

await writeFile(
  resolve(ROOT, 'scripts/parser-coverage-report.json'),
  JSON.stringify(summary, null, 2) + '\n'
);

// ── Markdown summary ──────────────────────────────────────────────────────
const md = [];
md.push(`# Parser coverage report`);
md.push('');
md.push(`Generated: \`${summary.generatedAt}\``);
md.push(`BSData commit: \`${summary.sourceCommit || '?'}\``);
md.push('');
md.push(`Files: ${summary.totals.files} (${summary.totals.parsedOk} parsed OK, ${summary.totals.parseFailures} failures)`);
md.push(`Element names: ${summary.totals.distinctElementNames}, attributes: ${summary.totals.distinctAttributeNames}`);
md.push(`Profile typeNames in XML: ${summary.totals.distinctProfileTypes}`);
md.push(`  - handled (appeared in parser output): ${summary.totals.handledProfileTypes}`);
md.push(`  - **classify says 'other' (silent drop — likely real gap): ${summary.totals.realGapTypeNames}**`);
md.push(`  - classify says ability/stats/weapon but never in output (harness FP or extraction bug): ${summary.totals.classifiedButMissing}`);
md.push(`Characteristic names in XML: ${summary.totals.distinctCharacteristicNames} (description carriers already filtered, **remaining unhandled: ${summary.totals.unhandledCharacteristicNames}**)`);
md.push('');
if (parseFailures.length) {
  md.push(`## Parse failures (${parseFailures.length})`);
  md.push('');
  for (const f of parseFailures) {
    md.push(`- **${f.file}** (${f.phase}): ${f.error}`);
  }
  md.push('');
}
md.push(`## Real-gap typeNames (classify returned 'other', ${realGapTypeNames.length})`);
md.push('');
md.push('These are profiles the parser silently drops — classifyProfile said \'other\' so they never reach the renderer. **Most likely fixes are in [classify.js](../js/parser/classify.js).**');
md.push('');
md.push('| typeName | count | factions | example names | characteristic names in profile |');
md.push('|---|---:|---:|---|---|');
for (const e of realGapTypeNames) {
  md.push(`| \`${e.typeName}\` | ${e.count} | ${e.factions} | ${e.examples.map(x => '`' + x + '`').join(', ')} | ${e.sampleCharacteristicNames.map(x => '`' + x + '`').join(', ')} |`);
}
md.push('');
md.push(`## Classified-but-missing typeNames (${classifiedButMissing.length})`);
md.push('');
md.push('classifyProfile said `ability`/`stats`/`weapon` but the typeName never appears in any output object\'s `_typeName`. Either the harness misses where the parser surfaces it (e.g. \'Unit\' is absorbed into `u.stats` without stamping), or extraction failed somewhere downstream of classify.');
md.push('');
md.push('| typeName | count | factions | classify verdict | example names |');
md.push('|---|---:|---:|---|---|');
for (const e of classifiedButMissing) {
  const verdict = Object.entries(e.classifyVerdicts).map(([k, v]) => `${k}:${v}`).join(', ');
  md.push(`| \`${e.typeName}\` | ${e.count} | ${e.factions} | ${verdict} | ${e.examples.map(x => '`' + x + '`').join(', ')} |`);
}
md.push('');
md.push(`## Unhandled characteristic names (${unhandledCharNames.length})`);
md.push('');
md.push('| name | count |');
md.push('|---|---:|');
for (const e of unhandledCharNames) md.push(`| \`${e.name}\` | ${e.count} |`);
md.push('');
md.push(`## Per-faction health`);
md.push('');
md.push('| Faction | Units | Missing weapons | Missing stats | Missing abilities | Missing wargear | Zero pts |');
md.push('|---|---:|---:|---:|---:|---:|---:|');
for (const f of summary.perFaction) {
  const flag = f.isStub ? ' *(stub)*' : '';
  md.push(`| ${f.factionName}${flag} | ${f.units} | ${f.unitsMissingWeapons} | ${f.unitsMissingStats} | ${f.unitsMissingAbilities} | ${f.unitsMissingWargear} | ${f.unitsZeroPoints} |`);
}
md.push('');
md.push(`## Empty units (no weapons or no stats) — ${emptyUnits.length}`);
md.push('');
for (const u of emptyUnits.slice(0, 60)) {
  md.push(`- **${u.faction}**: ${u.unit}${u.noWeapons ? ' [no weapons]' : ''}${u.noStats ? ' [no stats]' : ''}`);
}
if (emptyUnits.length > 60) md.push(`- … and ${emptyUnits.length - 60} more`);
md.push('');
md.push(`## XML element frequency (top 30)`);
md.push('');
md.push('| tag | count |');
md.push('|---|---:|');
for (const e of summary.xmlElementFrequency.slice(0, 30)) md.push(`| \`${e.tag}\` | ${e.count} |`);
md.push('');

await writeFile(
  resolve(ROOT, 'scripts/parser-coverage-report.md'),
  md.join('\n')
);

console.log(`[coverage] wrote scripts/parser-coverage-report.{json,md}`);
console.log(`[coverage] real-gap typeNames (classify=other): ${realGapTypeNames.length}`);
console.log(`[coverage] classified-but-missing typeNames: ${classifiedButMissing.length}`);
console.log(`[coverage] unhandled characteristic names: ${unhandledCharNames.length}`);
console.log(`[coverage] empty units (no weapons or no stats): ${emptyUnits.length}`);
