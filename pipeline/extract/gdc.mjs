// extract/gdc.mjs — GDC datasources (28 faction files) → work/gdc.json (DATASET.md §4).
//
//   node extract/gdc.mjs [--from snapshot|remote] [--out /work/work/gdc.json]
//
// Raw GDC records, unchanged, plus a `_slug` (lower-kebab of the English name)
// on every datasheet / stratagem / enhancement / detachment / rule. No
// reshaping beyond that. Keyed by GDC FILE id (space_marines, bloodangels, …):
// the SM chapter files fold into one faction at build time, so a factionId key
// would have to merge files here, which is the builder's job, not ours.
//
// --from snapshot (default) reads sources.json gdc.snapshotDir (the committed
// app/data/gdc copy); --from remote fetches gdc.rawBase at gdc.ref.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = JSON.parse(readFileSync(join(HERE, '..', 'sources.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const FROM = opt('--from', 'snapshot');
const OUT = opt('--out', join(SOURCES.work, 'gdc.json'));

export const en = (v) => (v == null ? '' : typeof v === 'string' ? v : (typeof v === 'object' ? (v.en || '') : String(v)));
export const slug = (s) => en(s).toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function load(file) {
  if (FROM === 'remote') {
    const url = SOURCES.gdc.rawBase + file + '.json';
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }
  return JSON.parse(readFileSync(join(SOURCES.gdc.snapshotDir, file + '.json'), 'utf8'));
}

function tag(list) {
  return (Array.isArray(list) ? list : []).map((r) => (r && typeof r === 'object' ? { ...r, _slug: slug(r.name) } : r));
}

async function main() {
  const factions = {};
  let version = 0, updated = '';
  const files = {};
  for (const file of SOURCES.gdc.files) {
    const p = await load(file);
    if (!p || !Array.isArray(p.datasheets)) throw new Error(`${file}: no datasheets array`);
    const v = Number(p.compatibleDataVersion) || 0;
    if (v > version) version = v;
    if (p.updated && p.updated > updated) updated = p.updated;
    files[file] = { version: v, updated: p.updated || null, datasheets: p.datasheets.length };
    const rules = p.rules || {};
    factions[file] = {
      file,
      id: p.id || null,
      name: en(p.name),
      parent_name: p.parent_name || null,
      compatibleDataVersion: v,
      updated: p.updated || null,
      datasheets: tag(p.datasheets),
      stratagems: tag(p.stratagems),
      enhancements: tag(p.enhancements),
      detachments: tag(p.detachments),
      rules: { army: tag(rules.army), detachment: tag(rules.detachment) },
    };
  }
  const out = { version, updated, ref: SOURCES.gdc.ref, from: FROM, extractedAt: new Date().toISOString(), files, factions };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const n = Object.values(factions).reduce((s, f) => s + f.datasheets.length, 0);
  console.log(`gdc: ${Object.keys(factions).length} files, ${n} datasheets, version ${version}, updated ${updated} -> ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('gdc extract failed:', e.message); process.exit(3); });
}
