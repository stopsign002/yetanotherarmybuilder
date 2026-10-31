// report.mjs — candidate vs current -> report.md (+ optional mail). DATASET.md §6, §8.
//   node report.mjs <candidateId> [--app <app dir>] [--mail] [--out <file>]
// <app dir> defaults to the app this file lives in (docker: /app).
// Reads <app>/data/dataset/candidate/<id>/{manifest.json,report.json,<faction>.json}
// and <app>/data/dataset/current/. Points moved / sheets added+removed / text
// changed are computed here from the faction files themselves (independent of
// validate's parity list); FAIL list, unresolved joins and unpriced MFM rows come
// from report.json. --mail POSTs through the shared mailer ONLY when the
// candidate's md5 differs from current's. Mail env: MAILER_TOKEN (required),
// MAILER_URL (default http://127.0.0.1:8025/send; from docker use --network host).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const id = argv.find((a, i) => !a.startsWith('--') && (i === 0 || !['--app', '--out'].includes(argv[i - 1])));
if (!id) { console.error('usage: report.mjs <candidateId> [--app dir] [--mail] [--out file]'); process.exit(2); }
const app = path.resolve(val('--app', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
const ds = process.env.YAAB_DATASET_DIR || path.join(app, 'data/dataset');
const candDir = path.join(ds, 'candidate', id);
const curDir = path.join(ds, 'current');
const j = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } };
const manifest = j(path.join(candDir, 'manifest.json'));
if (!manifest) { console.error('no manifest at', candDir); process.exit(2); }
const curManifest = j(path.join(curDir, 'manifest.json'));
const report = j(path.join(candDir, 'report.json')) || {};

const loadDir = (dir) => {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'manifest.json' || f === 'report.json' || f.startsWith('_')) continue;
    const x = j(path.join(dir, f)); if (x) m.set(x._factionId || f.slice(0, -5), x);
  }
  return m;
};
const cand = loadDir(candDir), cur = loadDir(curDir);
const ptsOf = (u) => JSON.stringify([u.points, (u.squadOptions || []).map((o) => [o.models, o.pts]), u.ordinal ?? null]);
const textOf = (u) => JSON.stringify([u.description, u.abilities, u.wargearAbilities, u.weapons, u.keywords]);
const brief = (u) => { const so = (u.squadOptions || []).map((o) => `${o.models}:${o.pts}`).join('/'); return `${u.points ?? '-'}${so ? ' [' + so + ']' : ''}`; };

const moved = [], added = [], removed = [], textChanged = [];
let unitsCand = 0;
for (const [fid, cf] of cand) {
  const old = cur.get(fid);
  const oldBy = new Map((old ? old.units : []).map((u) => [u.id, u]));
  const seen = new Set();
  for (const u of cf.units || []) {
    unitsCand++; seen.add(u.id);
    const o = oldBy.get(u.id);
    if (!o) { added.push(`${cf.factionName || fid}: ${u.name}`); continue; }
    if (ptsOf(u) !== ptsOf(o)) moved.push({ f: cf.factionName || fid, name: u.name, was: brief(o), now: brief(u) });
    if (textOf(u) !== textOf(o)) textChanged.push(`${cf.factionName || fid}: ${u.name}`);
  }
  for (const [uid, o] of oldBy) if (!seen.has(uid)) removed.push(`${cf.factionName || fid}: ${o.name}`);
}
for (const [fid, of] of cur) if (!cand.has(fid)) removed.push(`(whole faction missing) ${of.factionName || fid}`);

const arr = (...ks) => { for (const k of ks) if (Array.isArray(report[k])) return report[k]; return []; };
const FAIL_CATS = ['unit-missing', 'points-differs-from-mfm', 'stat-rows-lost', 'weapons-lost', 'text-lost'];
let fails = arr('failures', 'fail', 'errors', 'fails');
const parity = arr('parity');
if (!fails.length) fails = parity.filter((p) => FAIL_CATS.includes(p.category));
const unresolved = arr('unresolvedJoins', 'unresolved', 'unresolvedAliases');
const unpriced = arr('unpricedMfmRows');
const show = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
const sec = (title, items, max = 40) => items.length
  ? `## ${title} (${items.length})\n\n${items.slice(0, max).map((x) => '- ' + show(x)).join('\n')}${items.length > max ? `\n- ... ${items.length - max} more (see report.json)` : ''}\n\n` : '';

const differs = !curManifest || curManifest.md5 !== manifest.md5;
const verdict = report.ok === false || fails.length ? 'FAIL' : (report.ok === true ? 'PASS' : 'UNVALIDATED');
let md = `# yaab dataset candidate ${id}\n\n`;
md += `- verdict: **${verdict}**${fails.length ? ` (${fails.length} FAIL items)` : ''}\n`;
md += `- differs from current: **${differs ? 'yes' : 'no'}** (candidate md5 ${manifest.md5}, current ${curManifest ? curManifest.md5 : 'none'})\n`;
md += `- built ${manifest.builtAt}; units ${unitsCand}; GDC ${manifest.sources?.gdc?.version ?? '?'} (${manifest.sources?.gdc?.updated ?? '?'}); MFM priced ${manifest.sources?.mfm?.unitsPriced ?? '?'}/${curManifest?.sources?.mfm?.unitsPriced ?? '?'} units, wargear ${manifest.sources?.mfm?.wargearPriced ?? '?'}/${curManifest?.sources?.mfm?.wargearPriced ?? '?'}; 40kdc ${String(manifest.sources?.dc?.sha ?? '?').slice(0, 8)}\n\n`;
md += sec('FAIL list', fails);
if (moved.length) {
  md += `## Points moved (${moved.length})\n\n| Faction | Unit | Was | Now |\n|---|---|---|---|\n`;
  md += moved.slice(0, 200).map((m) => `| ${m.f} | ${m.name} | ${m.was} | ${m.now} |`).join('\n');
  md += moved.length > 200 ? `\n| ... | ${moved.length - 200} more | | |` : '';
  md += '\n\n';
}
md += sec('Sheets added', added) + sec('Sheets removed', removed);
md += `## Text changed\n\n${textChanged.length} units have changed description/abilities/weapons/keywords vs current.\n\n`;
md += sec('Unresolved joins', unresolved) + sec('Unpriced MFM rows', unpriced);
if (parity.length) {
  const cnt = {}; parity.forEach((p) => { cnt[p.category] = (cnt[p.category] || 0) + 1; });
  md += `## Parity categories\n\n${Object.entries(cnt).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n`;
}
const outFile = val('--out', path.join(candDir, 'report.md'));
fs.writeFileSync(outFile, md);
console.log(`report.md -> ${outFile}  verdict=${verdict} differs=${differs} moved=${moved.length} added=${added.length} removed=${removed.length} textChanged=${textChanged.length} fails=${fails.length}`);

if (flag('--mail')) {
  if (!differs) { console.log('mail: candidate md5 equals current — not sending'); process.exit(0); }
  const tok = process.env.MAILER_TOKEN;
  if (!tok) { console.error('mail: MAILER_TOKEN not set'); process.exit(1); }
  const subject = `[yaab data] candidate ${id}: ${verdict}, ${moved.length} points moved, ${added.length}+/${removed.length}- sheets`;
  const r = await fetch(process.env.MAILER_URL || 'http://127.0.0.1:8025/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, text: md.slice(0, 200000) }) });
  console.log('mail http', r.status);
  if (!r.ok) process.exit(1);
}
