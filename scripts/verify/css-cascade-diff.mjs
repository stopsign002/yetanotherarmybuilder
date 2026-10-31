// css-cascade-diff.mjs <beforeDir> <afterDir> — plain node, no browser.
// Compares every <theme>-<width>-<state>.json.gz present in both dirs (contract §3).
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const [b, a] = process.argv.slice(2);
if (!b || !a) { console.error('usage: css-cascade-diff.mjs <beforeDir> <afterDir>'); process.exit(2); }
const files = (d) => new Set(readdirSync(d).filter(f => f.endsWith('.json.gz') && f !== 'matches.json.gz'));
const fb = files(b), fa = files(a);
const load = (d, f) => JSON.parse(gunzipSync(readFileSync(`${d}/${f}`)));
const label = (e) => `${e.tag}${e.id ? '#' + e.id : ''}${e.classes ? '.' + e.classes.trim().split(/\s+/).join('.') : ''}${e.pseudo || ''}`;
const parse = (s) => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; };
const lines = new Map(); // collapsed-key -> {count, first}
const add = (key, text) => { const l = lines.get(key); if (l) l.count++; else lines.set(key, { count: 1, text, order: lines.size }); };
let nStates = 0, nEls = 0, diffs = 0;
for (const f of [...fb].filter(x => !fa.has(x))) { console.log(`only in before: ${f}`); diffs++; }
for (const f of [...fa].filter(x => !fb.has(x))) { console.log(`only in after: ${f}`); diffs++; }
for (const f of [...fb].filter(x => fa.has(x)).sort()) {
  const B = load(b, f), A = load(a, f); nStates++;
  const key = (e) => e.path + '|' + (e.pseudo || '');
  const mb = new Map(B.elements.map(e => [key(e), e])), ma = new Map(A.elements.map(e => [key(e), e]));
  const st = B.state;
  const tag = `${B.theme}-${B.width}-${st}`;
  for (const [k, e] of mb) {
    const x = ma.get(k);
    if (!x) { add(`${tag}\0missing\0${label(e)}`, `${tag}  ${e.path} (${label(e)})  MISSING in after`); diffs++; continue; }
    nEls++;
    if (e.styles === x.styles) continue;
    const pb = new Map(e.styles.map(i => parse(B.pairs[i]))), pa = new Map(x.styles.map(i => parse(A.pairs[i])));
    for (const p of new Set([...pb.keys(), ...pa.keys()])) {
      const v1 = pb.get(p), v2 = pa.get(p);
      if (v1 === v2) continue;
      diffs++;
      const d = `${p}: ${v1 === undefined ? '(absent)' : v1} → ${v2 === undefined ? '(absent)' : v2}`;
      add(`${tag}\0${label(e)}\0${d}`, `${tag}  ${e.path} (${label(e)})  ${d}`);
    }
  }
  for (const [k, e] of ma) if (!mb.has(k)) { add(`${tag}\0extra\0${label(e)}`, `${tag}  ${e.path} (${label(e)})  EXTRA in after`); diffs++; }
}
for (const { count, text } of [...lines.values()].sort((x, y) => x.order - y.order)) console.log(count > 1 ? `${text}  ×${count}` : text);
console.log(`${nStates} states, ${nEls} elements, ${diffs} differences`);
process.exit(diffs ? 1 : 0);
