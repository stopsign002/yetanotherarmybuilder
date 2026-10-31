// dataset-parity.mjs — LIVE vs TEST, in the browser (DATASET.md §9).
//   ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yaab-test/app/scripts/verify/dataset-parity.mjs <outdir>
// LIVE=https://... TEST=https://... override the sites (BROWSE_ENV="LIVE TEST").
// READ-ONLY: anonymous throwaway contexts; armies live in localStorage only.
// Part 1: BSData.loadAllFactions() on both, diffed per unit/detachment with the
//         parity.mjs categories. Part 2: five fixed armies built through the UI,
//         #points-current compared. No page.waitForFunction (CSP) — polling via evaluate.
import { writeFileSync } from 'node:fs';
import { OUT, launch, newPage, until, boot } from './_lib.mjs';

const LIVE = process.env.LIVE || 'https://yaab.thewheeliebois.com/';
const TEST = process.env.TEST || 'https://yaab-test.thewheeliebois.com/';

// Fixed armies: faction option matcher + [unit name, count].
const ARMIES = [
  { name: 'Space Marines', faction: 'Space Marines$|^adeptus-astartes$', units: [['Captain', 1], ['Intercessor Squad', 2], ['Redemptor Dreadnought', 1]] },
  { name: 'Death Guard', faction: 'Death Guard', units: [['Defiler', 1], ['Plague Marines', 2], ['Typhus', 1]] },
  { name: 'Necrons', faction: 'Necrons', units: [['Overlord', 1], ['Immortals', 2], ['Doomsday Ark', 1]] },
  { name: 'Orks', faction: 'Orks', units: [['Warboss', 1], ['Boyz', 3], ['Battlewagon', 1]] },
  { name: 'Agents of the Imperium', faction: 'Agents of the Imperium', units: [['Inquisitor', 1], ['Aquila Kill Team', 1]] },
];


const browser = await launch();
async function open(url) {
  const { ctx, page } = await newPage(browser, { reducedMotion: 'reduce' });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  if (!(await boot(page, { url }))) throw new Error('roster never rendered: ' + url);
  return { ctx, page };
}

// ── Part 1: dataset as the renderer sees it ─────────────────────────────────
async function pull(url) {
  const { ctx, page } = await open(url);
  const data = await page.evaluate(async () => {
    const r = await BSData.loadAllFactions();
    // The live adapter resolves to undefined and delivers via App.state.factions
    // (post-GDC merge); the v2 loader resolves to the array. Take whichever exists.
    const all = Array.isArray(r) ? r : App.state.factions;
    const names = l => (l || []).map(x => x && x.name);
    return all.map(f => ({
      id: f._factionId, name: f.factionName, unitCount: (f.units || []).length,
      units: (f.units || []).map(u => ({
        name: u.name, points: u.points, squadOptions: (u.squadOptions || []).map(o => [o.models, o.pts]),
        ordinal: u.ordinal ?? null, modelStats: (u.modelStats || []).length, weapons: names(u.weapons),
        abilities: names(u.abilities), keywords: (u.keywords || []).length, isLegends: !!u.isLegends,
      })),
      detachments: (f.detachments || []).map(d => ({
        name: d.name, rules: (d.rules || []).length, enhancements: (d.enhancements || []).length,
        strats: (d.gdcStratagems || []).length,
      })),
    }));
  });
  await ctx.close();
  return data;
}

const items = [];
const add = (category, faction, rest) => items.push({ category, faction, ...rest });
const J = JSON.stringify;

const [liveData, testData] = await Promise.all([pull(LIVE), pull(TEST)]);
const tIdx = new Map(testData.map(f => [f.id, f]));
let unitsCompared = 0;
for (const fa of liveData) {
  const fb = tIdx.get(fa.id);
  if (!fb) { add('unit-missing', fa.id, { unit: '*', a: fa.unitCount, b: 'faction missing' }); continue; }
  if (fa.name !== fb.name) add('text-changed', fa.id, { field: 'factionName', a: fa.name, b: fb.name });
  const ub = new Map(); for (const u of fb.units) ub.set(u.name, u);
  const ua = new Set();
  for (const a of fa.units) {
    ua.add(a.name);
    const b = ub.get(a.name);
    if (!b) { add('unit-missing', fa.id, { unit: a.name, a: 'present', b: null }); continue; }
    unitsCompared++;
    if (a.points !== b.points) add('points-changed', fa.id, { unit: a.name, field: 'points', a: a.points, b: b.points });
    if (J(a.squadOptions) !== J(b.squadOptions)) add('points-changed', fa.id, { unit: a.name, field: 'squadOptions', a: a.squadOptions, b: b.squadOptions });
    if (J(a.ordinal) !== J(b.ordinal)) add('points-changed', fa.id, { unit: a.name, field: 'ordinal', a: a.ordinal, b: b.ordinal });
    if (b.modelStats < a.modelStats) add('stat-rows-lost', fa.id, { unit: a.name, field: 'modelStats', a: a.modelStats, b: b.modelStats });
    for (const w of a.weapons) if (!b.weapons.includes(w)) add('weapons-lost', fa.id, { unit: a.name, field: 'weapons', a: w, b: null });
    for (const w of b.weapons) if (!a.weapons.includes(w)) add('extra-weapon', fa.id, { unit: a.name, field: 'weapons', a: null, b: w });
    const gone = a.abilities.filter(x => !b.abilities.includes(x)), extra = b.abilities.filter(x => !a.abilities.includes(x));
    const n = Math.min(gone.length, extra.length);
    for (let i = 0; i < n; i++) add('ability-renamed', fa.id, { unit: a.name, field: 'abilities', a: gone[i], b: extra[i] });
    for (const g of gone.slice(n)) add('text-lost', fa.id, { unit: a.name, field: 'abilities', a: g, b: null });
    for (const e of extra.slice(n)) add('extra-ability', fa.id, { unit: a.name, field: 'abilities', a: null, b: e });
    if (a.keywords !== b.keywords) add('keyword-changed', fa.id, { unit: a.name, field: 'keywords(count)', a: a.keywords, b: b.keywords });
    if (a.isLegends !== b.isLegends) add('text-changed', fa.id, { unit: a.name, field: 'isLegends', a: a.isLegends, b: b.isLegends });
  }
  for (const u of fb.units) if (!ua.has(u.name)) add('extra-unit', fa.id, { unit: u.name, a: null, b: 'present' });
  const db = new Map(fb.detachments.map(d => [d.name, d])), da = new Set();
  for (const d of fa.detachments) {
    da.add(d.name);
    const e = db.get(d.name);
    if (!e) { add('det-missing', fa.id, { field: `detachment:${d.name}`, a: d.name, b: null }); continue; }
    if (d.strats !== e.strats) add('strat-count-changed', fa.id, { field: `detachment:${d.name}`, a: d.strats, b: e.strats });
    if (d.enhancements !== e.enhancements) add('enh-count-changed', fa.id, { field: `detachment:${d.name}`, a: d.enhancements, b: e.enhancements });
    if (d.rules !== e.rules) add('text-changed', fa.id, { field: `detachment:${d.name}/rules(count)`, a: d.rules, b: e.rules });
  }
  for (const d of fb.detachments) if (!da.has(d.name)) add('det-extra', fa.id, { field: `detachment:${d.name}`, a: null, b: d.name });
}
const lIdx = new Set(liveData.map(f => f.id));
for (const fb of testData) if (!lIdx.has(fb.id)) add('extra-unit', fb.id, { unit: '*', a: null, b: `faction only on test (${fb.unitCount} units)` });

const counts = {};
for (const i of items) counts[i.category] = (counts[i.category] || 0) + 1;
console.log(`dataset: factions live/test ${liveData.length}/${testData.length}, units compared ${unitsCompared}, items ${items.length}`);
for (const [c, n] of Object.entries(counts)) console.log(`  ${c.padEnd(24)} ${n}`);
const seen = {};
for (const i of items) { seen[i.category] = (seen[i.category] || 0) + 1; if (seen[i.category] <= 10) console.log(`  - ${i.category}: ${i.faction}${i.unit ? ' / ' + i.unit : ''}${i.field ? ' [' + i.field + ']' : ''} ${J(i.a)} -> ${J(i.b)}`); }

// ── Part 2: five armies through the UI ──────────────────────────────────────
async function buildArmy(url, army) {
  const { ctx, page } = await open(url);
  const log = [];
  const fac = await page.evaluate(src => {
    const rx = new RegExp(src, 'i');
    const s = document.getElementById('army-faction-select');
    const o = Array.from(s.options).find(o => rx.test(o.value) || rx.test(o.textContent));
    if (!o) return null;
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    return o.value;
  }, army.faction);
  if (!fac) { await ctx.close(); return { total: null, log: ['faction option not found'] }; }
  await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 30000, step: 500 });
  for (const [uname, count] of army.units) {
    for (let k = 0; k < count; k++) {
      await page.evaluate(t => { const i = document.getElementById('search-input'); if (i) { i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); } }, uname);
      await page.waitForTimeout(900);
      const clicked = await page.evaluate(n => {
        const cards = Array.from(document.querySelectorAll('#unit-grid .unit-card'));
        const nm = c => ((c.querySelector('.unit-card-name') || c).textContent || '').replace(/^[^A-Za-z0-9]+/, '').trim().toLowerCase();
        const want = n.toLowerCase();
        const card = cards.find(c => nm(c) === want) || cards.find(c => nm(c).startsWith(want));
        if (!card) return false; card.click(); return true;
      }, uname);
      if (!clicked) { log.push(`card not found: ${uname}`); break; }
      const hasBtn = await until(page, () => !!document.querySelector('#btn-detail-add, #btn-add-to-army'), { timeout: 10000 });
      if (!hasBtn) { log.push(`add button missing: ${uname}`); break; }
      await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
      await page.waitForTimeout(900);
    }
  }
  const total = await page.evaluate(() => (document.getElementById('points-current') || {}).textContent);
  await page.screenshot({ path: `${OUT}/army-${army.name.replace(/\W+/g, '_')}-${url.includes('-test') ? 'test' : 'live'}.png` }).catch(() => {});
  await ctx.close();
  return { total: total == null ? null : String(total).trim(), log };
}

const armies = [];
for (const army of ARMIES) {
  const [a, b] = await Promise.all([buildArmy(LIVE, army), buildArmy(TEST, army)]);
  const same = /\d/.test(a.total || '') && Number(a.total) > 0 && a.total === b.total;
  armies.push({ army: army.name, live: a, test: b, same });
  console.log(`army ${army.name.padEnd(24)} live=${a.total} test=${b.total} ${same ? 'SAME' : 'DIFF'}${[...a.log, ...b.log].length ? '  notes: ' + [...a.log, ...b.log].join('; ') : ''}`);
}

writeFileSync(`${OUT}/dataset-parity.json`, J({ counts, unitsCompared, items, armies }, null, 1));
await browser.close();
const armyDiffs = armies.filter(a => !a.same).length;
console.log(`RESULT dataset items=${items.length} armyDiffs=${armyDiffs}`);
process.exit(items.length || armyDiffs ? 1 : 0);
