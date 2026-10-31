// validate.mjs — DATASET.md §6: schema + coverage + pricing + joins + parity +
// freshness for one candidate. Writes <candidate>/report.json; exit 1 on any
// FAIL category (report.ok === false), 0 otherwise. `yaab-data approve`
// refuses a candidate whose report.json is not ok:true.
//
//   node validate.mjs <candidateId> [--ref <dir>] [--quiet]
//
// Reference for parity / known gaps: <dataset>/current/ when it has a
// manifest, else the golden set (sources.json golden).
//
// "Known gap" rule for coverage and join checks: a violation that the
// reference dataset ALSO has (same faction, same unit/detachment, same check)
// is LISTED, not failed — the candidate is not worse there, and an upstream
// hole (Orks' Brute Bosses ships no stratagems in GDC or in 40kdc) would
// otherwise make every candidate unapprovable. A violation the reference does
// not have FAILS.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDatasets, FAIL_CATS as PARITY_FAIL } from './parity.mjs';
import { SOURCES, ALWAYS_COST_ALLOWLIST, parsePoints, nk, sheetCarries } from './build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.WORK_DIR ? join(process.env.WORK_DIR, 'work') : SOURCES.work;
const DATASET = process.env.YAAB_DATASET_DIR || SOURCES.datasetDir;
const STAT_KEYS = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
const SPOT_CHECKS = [   // contract acceptance: MFM points on shared chassis
  { faction: 'death-guard', unit: 'defiler', points: 300 },
  { faction: 'world-eaters', unit: 'defiler', points: 270 },
];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
function loadFactions(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'manifest.json' || f === 'report.json') continue;
    const j = readJson(join(dir, f));
    if (j && j._factionId && Array.isArray(j.units)) m.set(j._factionId, j);
  }
  return m;
}

// ── minimal JSON-Schema (the subset faction.schema.json uses) ───────────────
function typeOk(v, t) {
  if (Array.isArray(t)) return t.some((x) => typeOk(v, x));
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && isFinite(v);
    default: return typeof v === t;
  }
}
function checkSchema(v, s, path, errs) {
  if (errs.length > 200) return;
  if (s.enum && !s.enum.some((e) => e === v)) { errs.push(`${path}: ${JSON.stringify(v)} not in enum`); return; }
  if (s.type && !typeOk(v, s.type)) { errs.push(`${path}: expected ${s.type}, got ${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}`); return; }
  if (v === null) return;
  if (typeof v === 'string' && s.minLength && v.length < s.minLength) errs.push(`${path}: empty string`);
  if (Array.isArray(v)) {
    if (s.minItems && v.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => checkSchema(x, s.items, `${path}[${i}]`, errs));
  } else if (typeof v === 'object') {
    (s.required || []).forEach((k) => { if (!(k in v)) errs.push(`${path}: missing key ${k}`); });
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) checkSchema(v[k], sub, `${path}.${k}`, errs);
  }
}

// ── coverage (§6.2) + leader joins (§6.4) as keyed violations ───────────────
function coverage(factions) {
  const out = [];
  for (const [fid, f] of factions) {
    for (const u of f.units) {
      if (u._allyOf) continue;
      const rows = Array.isArray(u.modelStats) ? u.modelStats : [];
      if (!rows.length || !rows.some((r) => STAT_KEYS.every((k) => r && String(r[k] == null ? '' : r[k]).trim() !== '')))
        out.push({ check: 'unit-no-full-statline', faction: fid, key: nk(u.name), unit: u.name });
      if (!u.isLegends && !(u.weapons || []).length && !(u.abilities || []).length)
        out.push({ check: 'unit-no-weapon-or-ability', faction: fid, key: nk(u.name), unit: u.name });
    }
    for (const d of f.detachments) {
      if (!(d.rules || []).some((r) => r && String(r.description || '').trim())) out.push({ check: 'detachment-no-rule-text', faction: fid, key: d.name });
      if (!(d.gdcStratagems || []).length) out.push({ check: 'detachment-no-stratagem', faction: fid, key: d.name });
      for (const e of d.enhancements || []) if (!String(e.description || '').trim()) out.push({ check: 'enhancement-no-text', faction: fid, key: `${d.name}/${e.name}` });
    }
  }
  return out;
}
function leaderJoins(factions) {
  const out = [];
  for (const [fid, f] of factions) {
    const names = new Set(f.units.map((u) => nk(u.name)));
    for (const u of f.units) {
      if (u._allyOf) continue;
      for (const t of u.gdcLeadBy || []) if (!names.has(nk(t))) out.push({ check: 'leadby-target-unknown', faction: fid, key: `${nk(u.name)} -> ${nk(t)}`, unit: u.name, target: t });
    }
  }
  return out;
}
// Option items must be things the datasheet prints (same test the builder
// uses to drop such options, so a FAIL here means the builder regressed).
function optionJoins(factions) {
  const out = []; const seen = new Set();
  for (const [fid, f] of factions) for (const u of f.units) {
    if (u._allyOf || !u.wargearProfile) continue;
    for (const o of u.wargearProfile.options || []) for (const it of [o.replaces || [], ...(o.choices || [])].flat()) {
      if (sheetCarries(u, it.name)) continue;
      const key = `${nk(u.name)}: ${it.id}`;
      if (seen.has(fid + key)) continue; seen.add(fid + key);
      out.push({ check: 'wargear-option-item-not-on-datasheet', faction: fid, key, unit: u.name, item: it.name });
    }
  }
  return out;
}
function splitKnown(cand, ref) {
  const refKeys = new Set(ref.map((x) => `${x.check}|${x.faction}|${x.key}`));
  const fail = [], known = [];
  for (const x of cand) (refKeys.has(`${x.check}|${x.faction}|${x.key}`) ? known : fail).push(x);
  return { fail, known };
}

export function validate(id, opts = {}) {
  const cdir = join(DATASET, 'candidate', id);
  if (!existsSync(join(cdir, 'manifest.json'))) throw new Error(`no candidate ${id} in ${join(DATASET, 'candidate')}`);
  const manifest = readJson(join(cdir, 'manifest.json'));
  const blog = existsSync(join(cdir, '_build-log.json')) ? readJson(join(cdir, '_build-log.json')) : {};
  const mfm = readJson(join(WORK, 'mfm.json'));
  const curDir = join(DATASET, 'current');
  const refDir = opts.ref || (existsSync(join(curDir, 'manifest.json')) ? curDir : SOURCES.golden);
  const cand = loadFactions(cdir);
  const ref = loadFactions(refDir);
  const fails = {}; const listed = {};
  const F = (cat, item) => (fails[cat] ??= []).push(item);
  const L = (cat, item) => (listed[cat] ??= []).push(item);

  // 1. schema
  const schema = readJson(join(HERE, 'schema', 'faction.schema.json'));
  for (const [fid, f] of cand) { const errs = []; checkSchema(f, schema, fid, errs); errs.forEach((e) => F('schema', e)); }
  for (const m of manifest.factions || []) if (!cand.has(m.id)) F('schema', `manifest lists ${m.id} but its file is missing`);
  if (cand.size !== (manifest.factions || []).length) F('schema', `manifest lists ${(manifest.factions || []).length} factions, dir has ${cand.size}`);
  if (ref.size) for (const fid of ref.keys()) if (!cand.has(fid)) F('schema', `reference faction ${fid} missing from candidate`);

  // 1b. id stability: every reference unit id (own rows) must still exist in
  // that faction — saved armies, reserves and favourites key on it.
  for (const [fid, f] of ref) {
    const c = cand.get(fid); if (!c) continue;
    const ids = new Set(c.units.filter((u) => !u._allyOf).map((u) => u.id));
    for (const u of f.units) if (!u._allyOf && !ids.has(u.id)) F('unit-id-dropped', { faction: fid, id: u.id, unit: u.name });
  }

  // 2. coverage (+ known-gap rule)
  const cov = splitKnown(coverage(cand), coverage(ref));
  cov.fail.forEach((x) => F('coverage', x)); cov.known.forEach((x) => L('coverage-known-gap', x));

  // 3. pricing
  const mrows = mfm.units || {};
  const keyOf = blog.mfmUnitKey || {};
  let priced = 0;
  for (const [fid, f] of cand) {
    const own = new Map(f.units.filter((u) => !u._allyOf).map((u) => [u.id, u]));
    for (const u of f.units) {
      let key = u._allyOf ? (keyOf[`${fid}/${u.id}/ally`] || null) : (keyOf[`${fid}/${u.id}`] || null);
      if (u._allyOf && !key) {   // priced as the source faction's unit
        const srcFid = [...cand.keys()].find((x) => cand.get(x).factionName === u._allySourceFaction);
        key = srcFid ? keyOf[`${srcFid}/${u.id}`] || null : null;
      }
      if (!key) {
        if (u._mfmPoints) F('points-differs-from-mfm', { faction: fid, unit: u.name, why: '_mfmPoints set but no MFM row recorded' });
        continue;
      }
      const row = mrows[key];
      if (!row) { F('points-differs-from-mfm', { faction: fid, unit: u.name, why: `MFM key ${key} not in mfm.json` }); continue; }
      priced++;
      const want = parsePoints(row.points || []);
      const got = { squadOptions: u.squadOptions, pointsOptions: u.pointsOptions, ordinal: u.ordinal, points: u.points };
      const exp = { squadOptions: want.squadOptions, pointsOptions: want.pointsOptions, ordinal: want.ordinal, points: want.pointsOptions[0] ?? 0 };
      if (JSON.stringify(got) !== JSON.stringify(exp)) F('points-differs-from-mfm', { faction: fid, unit: u.name, mfm: key, a: exp, b: got });
      if (!u._mfmPoints) F('points-differs-from-mfm', { faction: fid, unit: u.name, why: 'priced from MFM but _mfmPoints false' });
    }
    for (const u of own.values()) {
      const wp = u.wargearProfile;
      if (wp && wp.alwaysCost > 0) {
        const allow = ALWAYS_COST_ALLOWLIST[`${fid}/${u.id}`] || [];
        const flat = Object.entries(wp.itemCosts || {}).filter(([k]) => allow.includes(k)).reduce((s, [, v]) => s + v, 0);
        if (!allow.length || flat !== wp.alwaysCost) F('always-cost-not-allowlisted', { faction: fid, unit: u.name, alwaysCost: wp.alwaysCost });
      }
      if (u._unpriced) L('unpriced-unit', { faction: fid, unit: u.name });
      if (u._provisional) L('provisional-gdc-points', { faction: fid, unit: u.name, points: u.points });
    }
  }
  for (const k of blog.unpricedMfmRows || []) L('unpriced-mfm-row', k);
  for (const s of blog.unbilledItems || []) L('unbilled-wargear-cost', s);
  for (const s of blog.mfmItemsUnmatched || []) L('mfm-item-unjoined', s);
  for (const c of SPOT_CHECKS) {
    const u = cand.get(c.faction) && cand.get(c.faction).units.find((x) => x.id === c.unit && !x._allyOf);
    if (!u || u.points !== c.points) F('points-differs-from-mfm', { faction: c.faction, unit: c.unit, why: `spot check: expected ${c.points}, got ${u ? u.points : 'no unit'}` });
  }

  // 4. joins
  for (const s of blog.aliasesUnresolved || []) F('alias-unresolved', s);
  const lj = splitKnown(leaderJoins(cand), leaderJoins(ref));
  lj.fail.forEach((x) => F('join-leadby', x)); lj.known.forEach((x) => L('join-leadby-known-gap', x));
  const oj = splitKnown(optionJoins(cand), optionJoins(ref));
  oj.fail.forEach((x) => F('join-wargear-option', x)); oj.known.forEach((x) => L('join-wargear-option-known-gap', x));
  for (const s of blog.noDcJoin || []) L('no-40kdc-unit (no structured wargear)', s);

  // 5. parity (W4's harness)
  const mfmOpt = {};
  for (const [fid, f] of cand) for (const u of f.units) {
    if (u._allyOf) continue;
    const key = keyOf[`${fid}/${u.id}`]; if (key && mrows[key]) mfmOpt[`${fid}/${u.name}`] = parsePoints(mrows[key].points || []).squadOptions;
  }
  const parity = compareDatasets(refDir, cdir, { mfm: mfmOpt });
  // Triage each parity FAIL so a reviewer can see which are artefacts of
  // name-keyed matching and which are real content differences. Does not
  // change ok/fail — W4's categories stand; this only annotates them.
  const lc = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]/g, '');
  const triage = {};
  for (const i of parity.fail) {
    const a = ref.get(i.faction), b = cand.get(i.faction);
    let t = 'content';
    if (i.category === 'unit-missing' && a && b) {
      const ua = a.units.find((u) => u.name === i.unit);
      const sameId = ua && b.units.find((u) => u.id === ua.id && !!u._allyOf === !!ua._allyOf);
      if (b.units.some((u) => lc(u.name) === lc(i.unit))) t = 'name-spelling-only (same unit, GDC spelling)';
      else if (sameId) t = `renamed-by-gdc (same id ${ua.id}, now "${sameId.name}")`;
      else t = ua && ua.isLegends ? 'legends-sheet-not-in-gdc' : 'not-in-gdc';
    } else if (i.category === 'weapons-lost' && b) {
      const ub = b.units.find((u) => u.name === i.unit);
      t = ub && ub.weapons.some((w) => lc(w.name) === lc(i.a)) ? 'case-only' : 'gdc-weapon-naming/content';
    } else if (i.category === 'stat-rows-lost') {
      t = (i.a || []).length === (i.b || []).length ? 'rows-renamed-by-gdc' : 'row-count-differs';
    } else if (i.category === 'text-lost' && b) {
      const ub = b.units.find((u) => u.name === i.unit);
      const an = String(i.field || '').replace(/^ability:/, '');
      if (ub && (ub.wargearAbilities || []).some((x) => lc(x.name) === lc(an))) t = 'moved-to-wargearAbilities-by-gdc';
      else if (ub && ub._allyOf) t = 'ally-row (source datasheet differs)';
      else if (ub && ub.abilities.some((x) => lc(x.name.replace(/\(.*?\)/g, '')) === lc(an.replace(/\(.*?\)/g, '')))) t = 'renamed-suffix-only';
      else t = 'ability-not-on-gdc-datasheet';
    }
    i.triage = t;
    const k = `${i.category}: ${t.replace(/ \(same id.*$/, ' (same id)')}`;
    triage[k] = (triage[k] || 0) + 1;
  }
  // Explicit acceptance (pipeline/parity-accepted.json): a parity FAIL item
  // that matches an accepted entry is LISTED as `accepted`; anything new fails.
  const acceptedPath = join(HERE, 'parity-accepted.json');
  const accepted = existsSync(acceptedPath) ? readJson(acceptedPath) : [];
  const accKey = (x) => [x.category, x.faction, x.unit || '', typeof x.a === 'string' ? x.a : JSON.stringify(x.a ?? null)].join('|');
  const accSet = new Map(accepted.map((x) => [accKey(x), x]));
  const usedAcc = new Set();
  for (const i of parity.fail) {
    const hit = accSet.get(accKey(i));
    if (hit) { usedAcc.add(accKey(i)); L('accepted', { ...i, reason: hit.reason }); } else F(`parity:${i.category}`, i);
  }
  for (const [k, x] of accSet) if (!usedAcc.has(k)) L('accepted-entry-no-longer-needed', x);
  if (opts.accept) {
    const reasons = opts.reasons || {};
    const list = parity.fail.map((i) => ({ category: i.category, faction: i.faction, unit: i.unit || '', a: i.a ?? null,
      reason: reasons[i.category] || 'accepted at cutover: GDC is the owner' }));
    writeFileSync(acceptedPath, JSON.stringify(list, null, 1) + '\n');
  }
  for (const i of parity.listed) L(`parity:${i.category}`, i);

  // 6. freshness
  if (existsSync(join(curDir, 'manifest.json'))) {
    const cur = readJson(join(curDir, 'manifest.json'));
    const cv = (cur.sources && cur.sources.gdc && cur.sources.gdc.version) || 0;
    const cu = (cur.sources && cur.sources.mfm && cur.sources.mfm.unitsPriced) || 0;
    if ((manifest.sources.gdc.version || 0) < cv) F('freshness', `GDC compatibleDataVersion ${manifest.sources.gdc.version} < current ${cv}`);
    if ((manifest.sources.mfm.unitsPriced || 0) < cu) F('freshness', `MFM unitsPriced ${manifest.sources.mfm.unitsPriced} < current ${cu}`);
  } else L('freshness', 'no current/manifest.json yet — freshness not compared');
  if (blog.coreRules && blog.coreRules.loaded === false) F('freshness', 'core-rules glossary not loaded');
  if (blog.coreRules && blog.coreRules.ok === false) F('freshness', `core-rules md5 ${blog.coreRules.md5} != pinned ${blog.coreRules.pinned}`);

  const count = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]).sort());
  const report = { id, ok: Object.keys(fails).length === 0, checkedAt: new Date().toISOString(), reference: refDir,
    summary: { fail: count(fails), listed: count(listed), factions: cand.size,
      units: [...cand.values()].reduce((s, f) => s + f.units.length, 0), pricedUnitsChecked: priced,
      parity: parity.summary, parityFailTriage: triage },
    fail: fails, listed,
    unpricedMfmRows: blog.unpricedMfmRows || [], parityFailCategories: PARITY_FAIL };
  writeFileSync(join(cdir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const id = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--ref');
  const refI = a.indexOf('--ref');
  if (!id) { console.error('usage: node validate.mjs <candidateId> [--ref <dir>]'); process.exit(2); }
  try {
    // --write-accepted: (re)generate parity-accepted.json from THIS candidate's
    // parity FAIL items. Only for a reviewed cutover; never in the daily run.
    const accept = a.includes('--write-accepted');
    const reasons = {
      'ability-missing': 'GDC 11e sheet does not carry this ability (v1 had it from 40kdc or hand data); GDC is the owner',
      'weapons-lost': 'GDC 11e weapon name/list is the owner (renamed or no longer on the sheet)',
      'stat-rows-lost': 'GDC 11e profile rows are the owner (Wardens of Ultramar prints 4 rows)',
      'text-lost': 'no GDC, 40kdc or v1-index text exists for this ability (v1 showed hand-written text, dropped by the no-hand-text rule)',
      'unit-missing': 'sheet no longer exists in GDC or 40kdc',
    };
    const r = validate(id, { ref: refI !== -1 ? a[refI + 1] : undefined, accept, reasons });
    console.log(`candidate ${id}: ${r.ok ? 'OK' : 'FAIL'} (reference ${r.reference})`);
    console.log(`  units ${r.summary.units}, MFM-priced units checked ${r.summary.pricedUnitsChecked}`);
    for (const [k, n] of Object.entries(r.summary.fail)) console.log(`  FAIL    ${k.padEnd(44)} ${n}`);
    for (const [k, n] of Object.entries(r.summary.listed)) console.log(`  listed  ${k.padEnd(44)} ${n}`);
    for (const [k, n] of Object.entries(r.summary.parityFailTriage).sort()) console.log(`  triage  ${k.padEnd(70)} ${n}`);
    console.log(`  report: ${join(DATASET, 'candidate', id, 'report.json')}`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error('validate failed:', e.stack || e.message); process.exit(2); }
}
