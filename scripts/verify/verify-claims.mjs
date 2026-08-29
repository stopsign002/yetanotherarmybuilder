// verify-claims.mjs — adversarial re-test of the ambiguous failures from
// interact.mjs. Each one below failed there for a reason that could equally be
// the app's fault or the test's. This controls for the test's fault:
//   * ACCEPTS confirm() instead of dismissing (New army fires one)
//   * picks a real CHARACTER before touching enhancements
//   * parses "80 / 165 pts" as two costs, not the integer 80165
//   * undoes an ADD specifically, not whatever mutation happened to be last
// READ-ONLY (localStorage in a throwaway profile).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT || '/out';
const SITE = 'https://yaab.thewheeliebois.com/';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const results = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? 'CONFIRMED-OK  ' : 'REAL-BUG      '}  ${label}${detail ? `  [${detail}]` : ''}`);
  results.push({ label, appBehavesCorrectly: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 400) });
  ok ? pass++ : fail++;
};
async function until(page, fn, { timeout = 15000, step = 250, arg } = {}) {
  const d = Date.now() + timeout;
  for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > d) return null; await page.waitForTimeout(step); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
const page = await ctx.newPage();
// ACCEPT dialogs — dismissing them cancelled New-army last time.
page.on('dialog', async d => { await d.accept().catch(() => {}); });
const shot = n => page.screenshot({ path: `${OUT}/v-${n}.png` }).catch(() => {});

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 240000, step: 1000 });

// ── 1. boot splash ────────────────────────────────────────────────────────
const splash = await page.evaluate(() => {
  const e = document.getElementById('boot-splash');
  if (!e) return { present: false };
  const s = getComputedStyle(e);
  return { present: true, display: s.display, opacity: s.opacity, visibility: s.visibility, rect: e.getBoundingClientRect().height };
});
check('boot splash is gone or fully hidden', !splash.present || splash.display === 'none' || splash.visibility === 'hidden' || Number(splash.opacity) === 0,
  JSON.stringify(splash));

// ── 2. SM chapter dropdown — use the GENERIC parent, not a named chapter ──
const opts = await page.evaluate(() => Array.from(document.getElementById('army-faction-select').options).map(o => o.value).filter(Boolean));
const generic = opts.find(o => /Adeptus Astartes - Space Marines$/i.test(o)) || opts.find(o => /Adeptus Astartes$/i.test(o));
const named = opts.find(o => /Blood Angels/i.test(o));
for (const [label, f] of [['generic Space Marines', generic], ['a named chapter (Blood Angels)', named]]) {
  if (!f) { check(`chapter dropdown for ${label}`, false, 'faction option not found'); continue; }
  await page.evaluate(v => { const s = document.getElementById('army-faction-select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, f);
  await page.waitForTimeout(3200);
  const g = await page.evaluate(() => {
    const el = document.getElementById('army-chapter-group');
    if (!el) return { exists: false };
    return { exists: true, hidden: el.hasAttribute('hidden'), display: getComputedStyle(el).display,
             options: Array.from((document.getElementById('army-chapter-select') || {}).options || []).map(o => o.textContent).slice(0, 6) };
  });
  console.log(`   ${label} (${f}) -> ${JSON.stringify(g)}`);
}
// The real question: does the chapter group EVER reveal?
const everReveals = await page.evaluate(async () => {
  const s = document.getElementById('army-faction-select');
  const g = document.getElementById('army-chapter-group');
  if (!s || !g) return { ok: false, why: 'missing elements' };
  for (const o of Array.from(s.options).filter(x => /Astartes/i.test(x.value))) {
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    if (!g.hasAttribute('hidden')) return { ok: true, faction: o.value };
  }
  return { ok: false, why: 'no Astartes faction revealed it' };
});
check('chapter sub-dropdown reveals for at least one Astartes faction', everReveals.ok, JSON.stringify(everReveals));

// ── seed a CHARACTER ──────────────────────────────────────────────────────
await page.evaluate(v => { const s = document.getElementById('army-faction-select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, named || generic || opts[1]);
await page.waitForTimeout(3200);
await page.evaluate(() => {
  const cb = document.querySelector('#detachments-body input.detachment-row-cb');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(1800);
const pickedChar = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#unit-grid .unit-card'));
  const c = cards.find(x => /CHARACTER/i.test(x.textContent) && !/ALLY/i.test(x.textContent));
  if (!c) return null;
  c.click();
  return c.querySelector('.unit-card-name') ? c.querySelector('.unit-card-name').textContent.trim() : 'unknown';
});
await page.waitForTimeout(1500);
console.log(`   picked character: ${pickedChar}`);
await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
await page.waitForTimeout(1800);
await shot('01-character-added');

// ── 3. enhancement points, on an eligible CHARACTER ───────────────────────
const enh = await page.evaluate(() => {
  const boxes = Array.from(document.querySelectorAll('.enhancement-cb'));
  const usable = boxes.filter(b => !b.disabled);
  if (!usable.length) return { none: true, total: boxes.length, disabled: boxes.length };
  const cb = usable[0];
  const pts = parseInt(cb.getAttribute('data-enh-pts') || '0', 10) || 0;
  const before = parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0;
  cb.click();
  return { none: false, pts, before, name: cb.getAttribute('data-enh-name') };
});
if (enh.none) {
  check('enhancement checkbox available for a character', false, `${enh.total} boxes, all disabled`);
} else {
  await page.waitForTimeout(1800);
  const afterPts = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
  check('enhancement adds exactly its own points', afterPts === enh.before + enh.pts,
    `"${enh.name}" ${enh.before} + ${enh.pts} => ${afterPts}`);
  await shot('02-enhancement');
}

// ── 4. undo an ADD specifically ───────────────────────────────────────────
const undoTest = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
await page.evaluate(() => {
  const c = document.querySelector('#unit-grid .unit-card');
  if (c) c.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
await page.waitForTimeout(1800);
const afterAdd = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
await page.keyboard.press('Control+z');
await page.waitForTimeout(1800);
const afterUndo = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
check('Ctrl+Z undoes an add-to-army', afterAdd > undoTest && afterUndo === undoTest,
  `${undoTest} -> add ${afterAdd} -> undo ${afterUndo}`);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1500);
const afterRedo = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
check('Ctrl+Shift+Z redoes the add', afterRedo === afterAdd, `${afterUndo} -> ${afterRedo}`);

// ── 5. comparator filter, parsing multi-cost badges correctly ─────────────
await page.evaluate(() => { const s = document.getElementById('search-input'); s.value = '<=100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1500);
const cmp = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#unit-grid .unit-card'));
  const rows = cards.map(c => {
    const raw = ((c.querySelector('.unit-card-pts') || {}).textContent || '').trim();
    const nums = (raw.match(/\d+/g) || []).map(Number);       // "80 / 165 pts" -> [80,165]
    return { raw, nums, name: ((c.querySelector('.unit-card-name') || {}).textContent || '').trim() };
  });
  // documented rule: a unit passes if ANY of its variant costs satisfies it
  const violating = rows.filter(r => r.nums.length && !r.nums.some(n => n <= 100));
  return { n: rows.length, violating: violating.slice(0, 5), violatingCount: violating.length };
});
check('comparator "<=100" — every shown unit has SOME variant <=100', cmp.violatingCount === 0,
  `${cmp.n} cards, ${cmp.violatingCount} violating${cmp.violatingCount ? ': ' + JSON.stringify(cmp.violating) : ''}`);
await page.evaluate(() => { const s = document.getElementById('search-input'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1200);

// ── 6. New army, ACCEPTING the confirm ────────────────────────────────────
const beforeNew = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
await page.evaluate(() => { const b = document.getElementById('btn-new-army'); if (b) b.click(); });
await page.waitForTimeout(2500);
const afterNew = await page.evaluate(() => ({
  pts: parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0,
  entries: document.querySelectorAll('#army-entry-list li.army-entry').length,
}));
check('New army clears the army when the confirm is ACCEPTED', afterNew.pts === 0 && afterNew.entries === 0,
  `${beforeNew} pts -> ${afterNew.pts} pts, ${afterNew.entries} entries`);
await shot('03-new-army');

// ── 7. command palette search, with real typing ───────────────────────────
await page.keyboard.press('Control+k');
await page.waitForSelector('.cmdp-modal', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(600);
const before = await page.evaluate(() => document.querySelectorAll('.cmdp-row').length);
await page.keyboard.type('analytics', { delay: 60 });
await page.waitForTimeout(1200);
const palette = await page.evaluate(() => ({
  rows: Array.from(document.querySelectorAll('.cmdp-row')).map(r => r.textContent.trim().slice(0, 60)),
  empty: !!document.querySelector('.cmdp-empty'),
  value: (document.querySelector('.cmdp-input') || {}).value,
}));
check('command palette finds "analytics" when typed', palette.rows.some(r => /analytic/i.test(r)),
  `input="${palette.value}" rowsBefore=${before} rowsNow=${palette.rows.length} ${palette.empty ? '(empty state)' : ''} ${JSON.stringify(palette.rows.slice(0,4))}`);
await shot('04-palette');
// can the dropped tools be reached from here at all?
await page.evaluate(() => { const i = document.querySelector('.cmdp-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } });
await page.waitForTimeout(800);
const allRows = await page.evaluate(() => Array.from(document.querySelectorAll('.cmdp-row')).map(r => r.textContent.trim().slice(0, 50)));
const wanted = ['match', 'analytic', 'crusade', 'kill team', 'deploy', 'stratagem', 'synerg', 'tournament', 'coach', 'collection'];
const found = wanted.filter(w => allRows.some(r => new RegExp(w, 'i').test(r)));
check('command palette exposes the button-less tools', found.length >= wanted.length - 2,
  `found ${found.length}/${wanted.length}: ${found.join(', ')} | missing: ${wanted.filter(w => !found.includes(w)).join(', ')}`);
writeFileSync(`${OUT}/palette-rows.json`, JSON.stringify(allRows, null, 2));
await page.keyboard.press('Escape');

// ── 8. detailActions — are the star / print / calc buttons really gone? ───
await page.evaluate(() => { const c = document.querySelector('#unit-grid .unit-card'); if (c) c.click(); });
await page.waitForTimeout(1500);
const da = await page.evaluate(() => ({
  hookLen: ((window.App && App.hooks && App.hooks.detailActions) || []).length,
  domBtns: Array.from(document.querySelectorAll('.detail-action-btn, .detail-header button, .detail-banner button')).map(b => (b.id || b.className || '').slice(0, 40)),
}));
check('unit detail header still offers its actions (star/print/calc)', da.hookLen > 0 || da.domBtns.length > 1,
  `detailActions=${da.hookLen}, header buttons=${JSON.stringify(da.domBtns)}`);

writeFileSync(`${OUT}/verify-claims.json`, JSON.stringify({ confirmedOk: pass, realBugs: fail, results }, null, 2));
console.log(`\nbehaving correctly: ${pass}   genuine problems: ${fail}`);
if (fail) console.log('GENUINE: ' + results.filter(r => !r.appBehavesCorrectly).map(r => r.label).join('; '));
await ctx.close();
await browser.close();
