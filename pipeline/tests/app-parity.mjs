// tests/app-parity.mjs — our app extraction vs the GDC snapshot of the same
// data version (DATASET.md §11.6). The acceptance test for extract/app.mjs.
//
//   node tests/app-parity.mjs [--dump PATH] [--snapshot /app/data/gdc/11th/gdc] [--out DIR] [--level 1|2|both]
//
// Level 1, records: work/gdc.json from the snapshot (gdc.mjs's transform) vs
// from extract/app.mjs: per file the datasheet / stratagem / enhancement /
// detachment / rule name sets, then every field build.mjs reads, deep-equal
// on the English value. Reported, never gating.
// Level 2, dataset: build.mjs twice with identical mfm.json, dc.json,
// core-rules.json and aliases, once per gdc.json; the 34 faction files
// compared deep. Exit 0 only when every Level 2 difference is on
// pipeline/app-parity-accepted.json AND every id is identical (§11.5: an id
// difference can never be accepted).
//
// Writes <out>/parity-report.json and <out>/parity-report.md. Scratch (the two
// gdc.json, a private work dir, both candidates) also goes under <out>, so a
// run never touches the real work/ or dataset/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { en, slug } from '../extract/gdc.mjs';
import { pickStored } from '../extract/app.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPE = resolve(HERE, '..');
const SOURCES = JSON.parse(readFileSync(join(PIPE, 'sources.json'), 'utf8'));
const WORK_ROOT = process.env.WORK_DIR || dirname(SOURCES.work);   // /work
const ACCEPTED = join(PIPE, 'app-parity-accepted.json');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const SNAP = opt('--snapshot', SOURCES.gdc.snapshotDir);
const OUT = resolve(opt('--out', join(WORK_ROOT, 'work', 'app-parity')));
const LEVEL = opt('--level', 'both');
const STORE = SOURCES.app.store;

// ── the two gdc.json ─────────────────────────────────────────────────────────
// Baseline: gdc.mjs's own transform of a snapshot directory (same code path
// as `gdc.mjs --from snapshot`, but for any directory, so older snapshots can
// be checked too).
function snapshotGdc(dir) {
  const tag = (list) => (Array.isArray(list) ? list : []).map((r) => (r && typeof r === 'object' ? { ...r, _slug: slug(r.name) } : r));
  const factions = {}; const files = {}; let version = 0; let updated = '';
  for (const file of SOURCES.gdc.files) {
    const p = JSON.parse(readFileSync(join(dir, file + '.json'), 'utf8'));
    const v = Number(p.compatibleDataVersion) || 0;
    if (v > version) version = v;
    if (p.updated && p.updated > updated) updated = p.updated;
    files[file] = { version: v, updated: p.updated || null, datasheets: (p.datasheets || []).length };
    const rules = p.rules || {};
    factions[file] = { file, id: p.id || null, name: en(p.name), parent_name: p.parent_name || null, compatibleDataVersion: v,
      updated: p.updated || null, datasheets: tag(p.datasheets), stratagems: tag(p.stratagems), enhancements: tag(p.enhancements),
      detachments: tag(p.detachments), rules: { army: tag(rules.army), detachment: tag(rules.detachment) } };
  }
  return { version, updated, ref: SOURCES.gdc.ref, from: 'snapshot', extractedAt: new Date().toISOString(), files, factions };
}

function node(script, argv, env = {}) {
  const r = spawnSync(process.execPath, [script, ...argv], { cwd: PIPE, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${script} ${argv.join(' ')} failed (${r.status}):\n${r.stderr || r.stdout}`);
  return r.stdout;
}

// ── diff helpers ─────────────────────────────────────────────────────────────
const strip = (o) => {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === 'object') {
    const k = Object.keys(o);
    if (k.includes('en') && k.every((x) => x.length === 2)) return o.en;
    const r = {}; for (const x of k) r[x] = strip(o[x]); return r;
  }
  return o;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// every leaf that differs, as [path, baseline, ours]; arrays index-by-index
function deepDiff(a, b, path, out) {
  if (same(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push([path, a, b]); return out; }
    a.forEach((x, i) => deepDiff(x, b[i], `${path}[${i}]`, out)); return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push([path, a, b]); return out;
}
const category = (path) => path.replace(/\[[^\]]*\]/g, '[]');
const short = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 240 ? s.slice(0, 237) + '...' : s; };

// ── Level 1: records, the fields build.mjs reads ─────────────────────────────
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
const PROFILE = ['name', 'range', 'skill', 'attacks', 'strength', 'ap', 'damage', 'keywords'];
const weapons = (ws) => (ws || []).map((w) => ({ active: w.active, profiles: (w.profiles || []).map((p) => pick(p, PROFILE)) }));
const nameDesc = (l) => (l || []).map((a) => pick(a, ['name', 'description']));
// build.mjs buildUnit() / wargearProfile() / the leader pass / ruleTextFor()
function readDatasheet(d) {
  const ab = d.abilities || {};
  return { name: d.name, keywords: d.keywords, factions: d.factions,
    stats: (d.stats || []).map((s) => pick(s, ['name', 'm', 't', 'sv', 'w', 'ld', 'oc'])),
    abilities: { core: (ab.core || []).map((a) => pick(a, ['name'])), faction: (ab.faction || []).map((a) => pick(a, ['name'])),
      other: nameDesc(ab.other), special: nameDesc(ab.special), wargear: nameDesc(ab.wargear),
      primarch: (ab.primarch || []).map((g) => ({ name: g.name, abilities: nameDesc(g.abilities) })),
      damaged: ab.damaged ? pick(ab.damaged, ['range', 'description']) : null, invul: ab.invul ? pick(ab.invul, ['value', 'info']) : null },
    rangedWeapons: weapons(d.rangedWeapons), meleeWeapons: weapons(d.meleeWeapons),
    points: (d.points || []).map((p) => pick(p, ['cost', 'models', 'keyword', 'detachment'])),
    transport: d.transport, imperialArmour: d.imperialArmour, legends: d.legends, loadout: d.loadout, wargear: d.wargear, composition: d.composition,
    wargearOptions: (d.wargearOptions || []).map((g) => ({ instruction: g.instruction, options: (g.options || []).map((o) => pick(o, ['name', 'cost'])) })),
    attachesTo: (d.attachesTo || []).map((a) => pick(a, ['type', 'targetType', 'target'])), leader: d.leader };
}
const READ = {
  datasheets: readDatasheet,
  stratagems: (s) => pick(s, ['name', 'detachment', 'phase', 'cost', 'when', 'target', 'effect', 'restrictions', 'secondary_effect', 'secondary_effect_cost', 'fluff', 'turn', 'type']),
  enhancements: (e) => pick(e, ['name', 'detachment', 'cost', 'keywords', 'description']),
  detachments: (d) => ({ ...pick(d, ['id', 'name', 'faction', 'detachmentPoints']), forceDispositions: (d.forceDispositions || []).map((x) => x && x.name), forceDisposition: d.forceDisposition && d.forceDisposition.name }),
  army: (r) => ({ name: r.name, rules: (r.rules || []).map((c) => pick(c, ['order', 'type', 'title', 'text'])) }),
  detachmentRules: (r) => ({ detachment: r.detachment, rules: (r.rules || []).map((x) => ({ name: x.name, rules: (x.rules || []).map((c) => pick(c, ['order', 'type', 'title', 'text'])) })) }),
};
function level1(base, ours) {
  const diffs = [];
  const add = (file, kind, rec, path, a, b) => diffs.push({ file, kind, record: rec, path, category: `${kind}:${category(path)}`, baseline: a, ours: b });
  for (const file of SOURCES.gdc.files) {
    const B = strip(base.factions[file] || {}); const O = strip(ours.factions[file] || {});
    const lists = [['datasheets', B.datasheets, O.datasheets, (r) => r.name],
      ['stratagems', B.stratagems, O.stratagems, (r) => `${r.detachment} / ${r.name}`],
      ['enhancements', B.enhancements, O.enhancements, (r) => `${r.detachment} / ${r.name}`],
      ['detachments', B.detachments, O.detachments, (r) => r.name],
      ['army', (B.rules || {}).army, (O.rules || {}).army, (r) => r.name],
      ['detachmentRules', (B.rules || {}).detachment, (O.rules || {}).detachment, (r) => r.detachment]];
    for (const [kind, bl, ol, key] of lists) {
      const bm = new Map((bl || []).map((r) => [key(r), r])); const om = new Map((ol || []).map((r) => [key(r), r]));
      for (const [k, r] of bm) {
        if (!om.has(k)) { add(file, kind, k, '(record)', 'present', 'missing'); continue; }
        for (const [p, a, b] of deepDiff(READ[kind](r), READ[kind](om.get(k)), '', [])) add(file, kind, k, p, a, b);
      }
      for (const k of om.keys()) if (!bm.has(k)) add(file, kind, k, '(record)', 'missing', 'present');
      // order matters to the builder only within a detachment (stratagems,
      // enhancements) and for datasheets (unit order): compare that too
      const seq = (l, f) => (l || []).filter(f).map(key);
      if (kind === 'datasheets' && !same(seq(bl, () => true), seq(ol, () => true)) && bm.size === om.size) add(file, kind, '(all)', '(order)', seq(bl, () => true).slice(0, 8), seq(ol, () => true).slice(0, 8));
      if (kind === 'stratagems' || kind === 'enhancements') {
        for (const det of new Set((bl || []).map((r) => r.detachment))) {
          const a = seq(bl, (r) => r.detachment === det); const b = seq(ol, (r) => r.detachment === det);
          if (!same(a, b) && same([...a].sort(), [...b].sort())) add(file, kind, det, '(order)', a, b);
        }
      }
    }
  }
  return diffs;
}

// ── Level 2: the built dataset ───────────────────────────────────────────────
// Ids under the §11.5 invariant, per faction file.
function idsOf(f) {
  return { _factionId: f._factionId, units: (f.units || []).map((u) => u.id),
    detachments: (f.detachments || []).map((d) => ({ id: d.id, stratagemIds: d.stratagemIds, enhancements: (d.enhancements || []).map((e) => e.id) })) };
}
function level2(baseDir, oursDir) {
  const diffs = []; const idDiffs = [];
  const files = (d) => readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'manifest.json' && !f.startsWith('_') && f !== 'core-rules.json').sort();
  const bf = files(baseDir); const of = files(oursDir);
  if (!same(bf, of)) idDiffs.push({ faction: '*', path: 'faction files', baseline: bf, ours: of });
  for (const fn of bf) {
    if (!of.includes(fn)) continue;
    const B = JSON.parse(readFileSync(join(baseDir, fn), 'utf8')); const O = JSON.parse(readFileSync(join(oursDir, fn), 'utf8'));
    const fac = B._factionId;
    for (const [p, a, b] of deepDiff(idsOf(B), idsOf(O), '', [])) idDiffs.push({ faction: fac, path: 'ids.' + p, baseline: a, ours: b });
    // units by id (an id mismatch is reported above, not again here)
    const om = new Map((O.units || []).map((u) => [u.id + '|' + (u._allyOf || ''), u]));
    for (const u of B.units || []) {
      const o = om.get(u.id + '|' + (u._allyOf || '')); if (!o) continue;
      const where = u._allyOf ? `ally:${u.id}` : u.id;
      for (const [p, a, b] of deepDiff(u, o, '', [])) diffs.push({ faction: fac, unit: where, name: u.name, path: `units[${where}].${p}`, category: `units[].${category(p)}`, baseline: a, ours: b });
    }
    const od = new Map((O.detachments || []).map((d) => [d.id, d]));
    for (const d of B.detachments || []) {
      const o = od.get(d.id); if (!o) continue;
      for (const [p, a, b] of deepDiff(d, o, '', [])) diffs.push({ faction: fac, unit: null, name: d.name, path: `detachments[${d.id}].${p}`, category: `detachments[].${category(p)}`, baseline: a, ours: b });
    }
    const rest = (f) => { const { units, detachments, ...r } = f; return r; };
    for (const [p, a, b] of deepDiff(rest(B), rest(O), '', [])) diffs.push({ faction: fac, unit: null, name: null, path: p, category: category(p), baseline: a, ours: b });
  }
  return { diffs, idDiffs };
}

// accepted list: { match: { faction, unit?, path }, reason, verdict, count? };
// path may use * (any run of characters); an entry with `count` must match
// exactly that many differences.
const VERDICTS = new Set(['gdc-hand-edit', 'gdc-converter-bug', 'dump-newer']);
function applyAccepted(diffs, accepted) {
  const rx = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const entries = accepted.map((e, i) => ({ e, i, re: rx(e.match.path), hits: 0 }));
  const problems = [];
  for (const x of entries) {
    if (!VERDICTS.has(x.e.verdict)) problems.push(`entry ${x.i}: verdict ${x.e.verdict} is not one of ${[...VERDICTS].join(', ')}`);
    if (!x.e.reason) problems.push(`entry ${x.i}: no reason`);
    if (/^ids\./.test(x.e.match.path)) problems.push(`entry ${x.i}: ids can never be accepted (§11.5)`);
  }
  const open = [];
  for (const d of diffs) {
    const hit = entries.find((x) => x.e.match.faction === d.faction && (x.e.match.unit == null || x.e.match.unit === d.unit) && x.re.test(d.path));
    if (hit) { hit.hits++; d.accepted = hit.i; } else open.push(d);
  }
  for (const x of entries) {
    if (x.e.count != null && x.hits !== x.e.count) problems.push(`entry ${x.i} (${x.e.match.faction} ${x.e.match.path}): matched ${x.hits}, states count ${x.e.count}`);
    if (!x.hits) problems.push(`entry ${x.i} (${x.e.match.faction} ${x.e.match.path}): matched nothing (stale)`);
  }
  return { open, problems, entries: entries.map((x) => ({ index: x.i, faction: x.e.match.faction, unit: x.e.match.unit || null, path: x.e.match.path, verdict: x.e.verdict, hits: x.hits })) };
}

function summarise(diffs, key = (d) => d.category) {
  const by = new Map();
  for (const d of diffs) { const k = key(d); if (!by.has(k)) by.set(k, []); by.get(k).push(d); }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([cat, l]) => ({ category: cat, count: l.length,
    examples: l.slice(0, 10).map((d) => ({ faction: d.faction || d.file, unit: d.unit || d.record || null, path: d.path, baseline: d.baseline, ours: d.ours })) }));
}

function markdown(rep) {
  const L = [`# App extraction parity — data ${rep.dataVersion}`, '',
    `Dump \`${rep.dump}\` vs snapshot \`${rep.snapshot}\` (compatibleDataVersion ${rep.snapshotVersion}). Run ${rep.at}.`, '',
    `**${rep.ok ? 'PASS' : 'FAIL'}** — ${rep.verdict}`, ''];
  if (rep.excluded) L.push(`Dump datasheets not emitted, by rule: ${Object.entries(rep.excluded).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  const table = (title, sum) => {
    L.push(`## ${title}`, '');
    if (!sum.length) { L.push('None.', ''); return; }
    L.push('| category | count |', '|---|---:|'); sum.forEach((s) => L.push(`| \`${s.category}\` | ${s.count} |`)); L.push('');
    for (const s of sum) {
      L.push(`### \`${s.category}\` (${s.count})`, '');
      s.examples.forEach((e) => L.push(`- ${e.faction} · ${e.unit || '—'} · \`${e.path}\``, `  - baseline: \`${short(e.baseline)}\``, `  - ours: \`${short(e.ours)}\``));
      L.push('');
    }
  };
  if (rep.level1) table(`Level 1 — records (${rep.level1.total} differences; reported, not gating)`, rep.level1.summary);
  if (rep.level2) {
    L.push(`## Level 2 — dataset`, '', `Ids (§11.5): ${rep.level2.idDiffs.length ? `**${rep.level2.idDiffs.length} differ**` : 'identical'}.`,
      `Differences: ${rep.level2.total}; accepted ${rep.level2.total - rep.level2.open}; open ${rep.level2.open}.`, '');
    if (rep.level2.idDiffs.length) { L.push('### Id differences (blockers)', ''); rep.level2.idDiffs.slice(0, 20).forEach((d) => L.push(`- ${d.faction} \`${d.path}\`: \`${short(d.baseline)}\` → \`${short(d.ours)}\``)); L.push(''); }
    if (rep.level2.problems.length) { L.push('### Accepted-list problems', ''); rep.level2.problems.forEach((p) => L.push(`- ${p}`)); L.push(''); }
    L.push('### Accepted entries', '', '| # | faction | unit | path | verdict | matched |', '|---:|---|---|---|---|---:|');
    rep.level2.accepted.forEach((a) => L.push(`| ${a.index} | ${a.faction} | ${a.unit || ''} | \`${a.path}\` | ${a.verdict} | ${a.hits} |`)); L.push('');
    table('Level 2 — open differences', rep.level2.openSummary);
  }
  return L.join('\n') + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  mkdirSync(OUT, { recursive: true });
  let dumpPath = opt('--dump', null);
  if (!dumpPath) dumpPath = join(STORE, pickStored(STORE).entry.file);
  const appJson = join(OUT, 'gdc-app.json'); const snapJson = join(OUT, 'gdc-snapshot.json');
  process.stdout.write(node(join(PIPE, 'extract', 'app.mjs'), ['--dump', dumpPath, '--store', STORE, '--out', appJson]));
  const base = snapshotGdc(SNAP);
  writeFileSync(snapJson, JSON.stringify(base));
  const ours = JSON.parse(readFileSync(appJson, 'utf8'));
  const rep = { at: new Date().toISOString(), dump: dumpPath, dataVersion: ours.version, snapshot: SNAP, snapshotVersion: base.version, excluded: ours.excluded || null };
  if (base.version !== ours.version) console.log(`WARNING: snapshot is data ${base.version}, dump is data ${ours.version}: not the same version`);
  let ok = true; const why = [];

  if (LEVEL === '1' || LEVEL === 'both') {
    const d1 = level1(base, ours);
    rep.level1 = { total: d1.length, summary: summarise(d1) };
    console.log(`level 1: ${d1.length} record differences in ${rep.level1.summary.length} categories`);
    rep.level1.summary.forEach((s) => console.log(`  ${String(s.count).padStart(5)}  ${s.category}`));
  }
  if (LEVEL === '2' || LEVEL === 'both') {
    // a private work dir with the frozen inputs: build.mjs writes
    // mfm-unjoined.json next to them, and must not touch the real work/
    const w = join(OUT, 'w'); mkdirSync(join(w, 'work'), { recursive: true });
    for (const f of ['mfm.json', 'dc.json']) copyFileSync(join(WORK_ROOT, 'work', f), join(w, 'work', f));
    const ds = join(OUT, 'ds'); rmSync(ds, { recursive: true, force: true }); mkdirSync(ds, { recursive: true });
    const env = { WORK_DIR: w, YAAB_DATASET_DIR: ds };
    node(join(PIPE, 'build.mjs'), ['--out', ds, '--id', 'baseline'], { ...env, GDC_JSON: snapJson });
    node(join(PIPE, 'build.mjs'), ['--out', ds, '--id', 'app'], { ...env, GDC_JSON: appJson });
    const { diffs, idDiffs } = level2(join(ds, 'candidate', 'baseline'), join(ds, 'candidate', 'app'));
    const accepted = existsSync(ACCEPTED) ? JSON.parse(readFileSync(ACCEPTED, 'utf8')) : [];
    const list = Array.isArray(accepted) ? accepted : accepted.accepted || [];
    const { open, problems, entries } = applyAccepted(diffs, list);
    rep.level2 = { total: diffs.length, open: open.length, idDiffs, problems, accepted: entries,
      openSummary: summarise(open), allSummary: summarise(diffs), open_differences: open, accepted_differences: diffs.filter((d) => d.accepted != null) };
    console.log(`level 2: ${diffs.length} dataset differences, ${diffs.length - open.length} accepted, ${open.length} open; ids ${idDiffs.length ? idDiffs.length + ' DIFFER' : 'identical'}`);
    rep.level2.openSummary.forEach((s) => console.log(`  ${String(s.count).padStart(5)}  ${s.category}`));
    problems.forEach((p) => console.log('  accepted-list: ' + p));
    if (idDiffs.length) { ok = false; why.push(`${idDiffs.length} id differences (blocker, §11.5)`); }
    if (open.length) { ok = false; why.push(`${open.length} differences not on the accepted list`); }
    if (problems.length) { ok = false; why.push(`${problems.length} accepted-list problems`); }
  }
  rep.ok = ok; rep.verdict = ok ? (rep.level2 ? 'Level 2 has no difference outside the accepted list; ids identical.' : 'Level 1 only (not gating).') : why.join('; ');
  writeFileSync(join(OUT, 'parity-report.json'), JSON.stringify(rep, null, 1));
  writeFileSync(join(OUT, 'parity-report.md'), markdown(rep));
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${rep.verdict}`);
  console.log(`report: ${join(OUT, 'parity-report.md')}`);
  process.exit(ok ? 0 : 1);
}

try { main(); } catch (e) { console.error('app-parity failed:', e.stack || e.message); process.exit(2); }
