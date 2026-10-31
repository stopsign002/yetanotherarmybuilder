// parity.mjs — compare two dataset dirs of <factionId>.json files (DATASET.md §6.5, §9).
//   import { compareDatasets } from './parity.mjs'
//   node parity.mjs <dirA> <dirB> [--json out] [--md out]
// Units match by name within a faction, weapons/abilities by name, detachments by name.
// FAIL: unit-missing points-differs-from-mfm stat-rows-lost weapons-lost text-lost
// LISTED: points-changed text-changed ability-renamed keyword-changed extra-unit
//         extra-weapon extra-ability strat-count-changed enh-count-changed det-missing det-extra
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAIL_CATS = ['unit-missing', 'points-differs-from-mfm', 'stat-rows-lost', 'weapons-lost', 'text-lost'];
export const LISTED_CATS = ['points-changed', 'text-changed', 'ability-renamed', 'keyword-changed', 'extra-unit',
  'extra-weapon', 'extra-ability', 'strat-count-changed', 'enh-count-changed', 'det-missing', 'det-extra'];

function loadDir(dir) {
  const m = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    m.set(j._factionId || f.slice(0, -5), j);
  }
  return m;
}
const txt = v => (typeof v === 'string' ? v.trim() : '');
const norm = s => txt(s).replace(/\s+/g, ' ');
// name -> item; duplicate names get "#2", "#3" so none is silently dropped
function byName(list) {
  const m = new Map(); const seen = {};
  for (const x of list || []) {
    const n = x && x.name != null ? String(x.name) : '';
    seen[n] = (seen[n] || 0) + 1;
    m.set(seen[n] > 1 ? `${n}#${seen[n]}` : n, x);
  }
  return m;
}
const sq = u => JSON.stringify((u.squadOptions || []).map(o => [o.models, o.pts]));
const mfmSq = o => JSON.stringify((o || []).map(x => Array.isArray(x) ? [x[0], x[1]] : [x.models, x.pts]));

export function compareDatasets(dirA, dirB, opts = {}) {
  const A = loadDir(dirA), B = loadDir(dirB);
  const items = [];
  const add = (category, faction, rest) => items.push({ category, faction, ...rest });
  let unitsCompared = 0;

  for (const [fid, fa] of A) {
    const fb = B.get(fid);
    const ua = byName(fa.units);
    if (!fb) { for (const [n] of ua) add('unit-missing', fid, { unit: n, a: 'present', b: 'faction file missing' }); continue; }
    const ub = byName(fb.units);
    for (const [n, a] of ua) {
      const b = ub.get(n);
      if (!b) { add('unit-missing', fid, { unit: n, a: 'present', b: null }); continue; }
      unitsCompared++;
      // points
      for (const f of ['points', 'ordinal']) if (JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null))
        add('points-changed', fid, { unit: n, field: f, a: a[f] ?? null, b: b[f] ?? null });
      if (sq(a) !== sq(b)) add('points-changed', fid, { unit: n, field: 'squadOptions', a: a.squadOptions, b: b.squadOptions });
      // stat rows
      const ra = (a.modelStats || []).map(r => r.name), rb = (b.modelStats || []).map(r => r.name);
      const lostRows = ra.filter(x => !rb.includes(x));
      if (rb.length < ra.length || lostRows.length) add('stat-rows-lost', fid, { unit: n, field: 'modelStats', a: ra, b: rb });
      // weapons
      const wa = byName(a.weapons), wb = byName(b.weapons);
      for (const [wn] of wa) if (!wb.has(wn)) add('weapons-lost', fid, { unit: n, field: 'weapons', a: wn, b: null });
      for (const [wn] of wb) if (!wa.has(wn)) add('extra-weapon', fid, { unit: n, field: 'weapons', a: null, b: wn });
      // abilities
      const aa = byName(a.abilities), ab = byName(b.abilities);
      const gone = [], extra = [];
      for (const [an, x] of aa) {
        const y = ab.get(an);
        if (!y) { gone.push(an); continue; }
        const ta = norm(x.description), tb = norm(y.description);
        if (ta && !tb) add('text-lost', fid, { unit: n, field: `ability:${an}`, a: ta.slice(0, 200), b: '' });
        else if (ta !== tb) add('text-changed', fid, { unit: n, field: `ability:${an}`, a: ta.slice(0, 200), b: tb.slice(0, 200) });
      }
      for (const [bn] of ab) if (!aa.has(bn)) extra.push(bn);
      const pairs = Math.min(gone.length, extra.length);
      for (let i = 0; i < pairs; i++) add('ability-renamed', fid, { unit: n, field: 'abilities', a: gone[i], b: extra[i] });
      for (const g of gone.slice(pairs)) add('text-lost', fid, { unit: n, field: `ability:${g}`, a: norm(aa.get(g).description).slice(0, 200), b: null });
      for (const e of extra.slice(pairs)) add('extra-ability', fid, { unit: n, field: 'abilities', a: null, b: e });
      // unit description
      if (norm(a.description) && !norm(b.description)) add('text-lost', fid, { unit: n, field: 'description', a: norm(a.description).slice(0, 200), b: '' });
      else if (norm(a.description) !== norm(b.description)) add('text-changed', fid, { unit: n, field: 'description', a: norm(a.description).slice(0, 200), b: norm(b.description).slice(0, 200) });
      // keywords
      const ka = [...new Set(a.keywords || [])].sort(), kb = [...new Set(b.keywords || [])].sort();
      if (JSON.stringify(ka) !== JSON.stringify(kb)) add('keyword-changed', fid, { unit: n, field: 'keywords', a: ka.filter(x => !kb.includes(x)), b: kb.filter(x => !ka.includes(x)) });
    }
    for (const [n] of ub) if (!ua.has(n)) add('extra-unit', fid, { unit: n, a: null, b: 'present' });

    // MFM check on B
    if (opts.mfm) for (const [n, b] of ub) {
      const m = opts.mfm[`${fid}/${n}`];
      if (m && mfmSq(m) !== sq(b)) add('points-differs-from-mfm', fid, { unit: n, field: 'squadOptions', a: m, b: b.squadOptions });
    }

    // detachments
    const da = byName(fa.detachments), db = byName(fb.detachments);
    for (const [dn, x] of da) {
      const y = db.get(dn);
      if (!y) { add('det-missing', fid, { field: `detachment:${dn}`, a: dn, b: null }); continue; }
      const sa = (x.gdcStratagems || []).length, sb = (y.gdcStratagems || []).length;
      if (sa !== sb) add('strat-count-changed', fid, { field: `detachment:${dn}`, a: sa, b: sb });
      const ea = (x.enhancements || []).length, eb = (y.enhancements || []).length;
      if (ea !== eb) add('enh-count-changed', fid, { field: `detachment:${dn}`, a: ea, b: eb });
      const texts = (la, lb, label) => {
        const mb = byName(lb);
        for (const [k, p] of byName(la)) {
          const q = mb.get(k); if (!q) continue;
          const ta = norm(p.description), tb = norm(q.description);
          if (ta && !tb) add('text-lost', fid, { field: `detachment:${dn}/${label}:${k}`, a: ta.slice(0, 200), b: '' });
          else if (ta !== tb) add('text-changed', fid, { field: `detachment:${dn}/${label}:${k}`, a: ta.slice(0, 200), b: tb.slice(0, 200) });
        }
      };
      texts(x.rules, y.rules, 'rule'); texts(x.enhancements, y.enhancements, 'enh'); texts(x.gdcStratagems, y.gdcStratagems, 'strat');
    }
    for (const [dn] of db) if (!da.has(dn)) add('det-extra', fid, { field: `detachment:${dn}`, a: null, b: dn });
  }
  for (const [fid, fb] of B) if (!A.has(fid)) for (const u of fb.units || []) add('extra-unit', fid, { unit: u.name, a: null, b: 'faction file only in B' });

  const counts = {};
  for (const c of [...FAIL_CATS, ...LISTED_CATS]) counts[c] = 0;
  for (const i of items) counts[i.category]++;
  const fail = items.filter(i => FAIL_CATS.includes(i.category));
  const listed = items.filter(i => LISTED_CATS.includes(i.category));
  return { fail, listed, summary: { factionsA: A.size, factionsB: B.size, unitsCompared, failCount: fail.length, listedCount: listed.length, counts } };
}

export function formatReport(r, per = 15) {
  const L = [`factions A/B ${r.summary.factionsA}/${r.summary.factionsB}, units compared ${r.summary.unitsCompared}, FAIL ${r.summary.failCount}, LISTED ${r.summary.listedCount}`, ''];
  for (const [c, n] of Object.entries(r.summary.counts)) L.push(`${FAIL_CATS.includes(c) ? 'FAIL  ' : 'listed'}  ${c.padEnd(26)} ${n}`);
  for (const c of Object.keys(r.summary.counts)) {
    const ex = [...r.fail, ...r.listed].filter(i => i.category === c).slice(0, per);
    if (!ex.length) continue;
    L.push('', `## ${c} (first ${ex.length} of ${r.summary.counts[c]})`);
    for (const i of ex) L.push(`- ${i.faction}${i.unit ? ' / ' + i.unit : ''}${i.field ? ' [' + i.field + ']' : ''}: ${JSON.stringify(i.a)} -> ${JSON.stringify(i.b)}`);
  }
  return L.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), pos = [];
  let json, md;
  for (let i = 0; i < a.length; i++) { if (a[i] === '--json') json = a[++i]; else if (a[i] === '--md') md = a[++i]; else pos.push(a[i]); }
  if (pos.length < 2) { console.error('usage: node parity.mjs <dirA> <dirB> [--json out] [--md out]'); process.exit(2); }
  const r = compareDatasets(pos[0], pos[1]);
  const out = formatReport(r);
  console.log(out);
  if (json) writeFileSync(json, JSON.stringify(r, null, 1));
  if (md) writeFileSync(md, '```\n' + formatReport(r, 50) + '\n```\n');
  process.exit(r.summary.failCount ? 1 : 0);
}
