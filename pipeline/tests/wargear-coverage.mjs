// Coverage report (a report, not a test):
//   node pipeline/tests/wargear-coverage.mjs [--work /work] [--list] [--prose]
// Runs parseWargearGroups over every datasheet's raw GDC wargearOptions in
// work/gdc.json (ctx from the matching unit in data/dataset/current when there
// is one) and prints groups turned into rules / total, plus the unparsed groups.
// --prose measures the fallback instead: parseWargearRules over gdcWargear lines.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWargearGroups, parseWargearRules, ctxFromUnit } from '../wargear-rules.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : process.argv[i + 1]; };
const work = arg('--work', existsSync('/work/work/gdc.json') ? '/work/work' : '/home/stopsign002/sites/base/yaab-data/work');
const list = process.argv.includes('--list');
const prose = process.argv.includes('--prose');
const cur = join(HERE, '..', '..', 'data', 'dataset', 'current');
const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const en = (v) => (v == null ? '' : typeof v === 'string' ? v : (v.en || ''));
const built = new Map();
for (const f of readdirSync(cur).filter((x) => x.endsWith('.json') && !x.startsWith('_') && x !== 'manifest.json' && x !== 'core-rules.json')) {
  for (const u of JSON.parse(readFileSync(join(cur, f), 'utf8')).units || []) if (!u._allyOf && !built.has(nk(u.name))) built.set(nk(u.name), u);
}
const plain = (s) => en(s).replace(/<\/li>|<br\s*\/?>|\r/gi, '\n').replace(/<[^>]+>/g, '').replace(/\*\*/g, '');
const gdc = JSON.parse(readFileSync(join(work, 'gdc.json'), 'utf8'));
let groups = 0, ok = 0, sheets = 0, noGroups = 0, lines = 0, linesOk = 0; const miss = [];
for (const [fk, f] of Object.entries(gdc.factions || {})) for (const ds of f.datasheets || []) {
  sheets++;
  const name = en(ds.name); const b = built.get(nk(name));
  const unit = b || { id: ds._slug, name, weapons: [...(ds.rangedWeapons || []), ...(ds.meleeWeapons || [])].flatMap((w) => (w.profiles || []).map((p) => ({ name: en(p.name) }))),
    wargearAbilities: ((ds.abilities || {}).wargear || []).map((a) => ({ name: en(a.name) })),
    gdcComposition: (ds.composition || []).flatMap((c) => plain(c).split(/\n|■/)).map((x) => x.trim()).filter(Boolean), modelStats: ds.stats || [] };
  const mbs = b && b.wargearProfile && b.wargearProfile.modelsBySize;
  const ctx = ctxFromUnit(unit, { extraModels: [...new Set(Object.values(mbs || {}).flatMap(Object.keys))] });
  if (prose) {
    const l = (b && b.gdcWargear) || []; const r = parseWargearRules(l, ctx);
    lines += l.length; linesOk += l.length - r.unparsed.length; r.unparsed.forEach((x) => miss.push(`${fk}/${ds._slug}: ${x}`));
    continue;
  }
  const wo = ds.wargearOptions || [];
  if (!wo.length) { noGroups++; continue; }
  const r = parseWargearGroups(wo, { ...ctx, proseLines: (b && b.gdcWargear) || [] });
  groups += r.groups; ok += r.groupsParsed;
  r.unparsed.forEach((x) => miss.push(`${fk}/${ds._slug}: ${x.replace(/\s+/g, ' ')}`));
}
if (prose) console.log(`prose lines parsed ${linesOk} / ${lines} = ${(100 * linesOk / lines).toFixed(2)}%`);
else console.log(`sheets ${sheets} (no wargearOptions: ${noGroups}); groups turned into rules ${ok} / ${groups} = ${(100 * ok / groups).toFixed(2)}%`);
miss.slice(0, list ? 1e9 : 40).forEach((x) => console.log('  ' + x.slice(0, 260)));
