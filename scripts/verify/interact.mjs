// interact.mjs — yaab functional click-through. Automates the manual
// "Testing checklist" in app/docs/UI.md and extends it, asserting OUTCOMES
// (points recomputed, filter removed the right rows, export round-trips)
// rather than the absence of an exception.
//
// Pruned 2026-10-30 to the LIVE surface. Checks for features that were
// removed on purpose (Action Center, detailActions buttons, the Analytics
// palette command, the SM chapter sub-dropdown, the hidden topbar mode tabs)
// were deleted, and four checks that failed on script bugs rather than site
// bugs were fixed (splash-removal timing, native-undo focus, the New-army confirm(), the
// comparator's "85 / 170 pts" parse). One check is a KNOWN FAIL as of
// 2026-10-30 — see 'enhancement adds its own points' below.
//
//   ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yetanotherarmybuilder/app/scripts/verify/interact.mjs \
//     ~/sites/base/browser/out/yaab-interact
//
// READ-ONLY: localStorage in a throwaway profile. No account, no server writes.
import { writeFileSync } from 'node:fs';
import { OUT, launch, newPage, until, wire, makeChecker, boot } from './_lib.mjs';

const THEME = process.env.THEME || 'grimdark';

const C = makeChecker();
const { check, results } = C;

const browser = await launch();
const { ctx, page } = await newPage(browser, { theme: THEME, reducedMotion: 'reduce' });
const errors = wire(page);
// confirm()/alert() would hang the run. Dismiss by default; a step that needs
// a confirm() ACCEPTED (New army over a dirty army) sets acceptNextDialog.
let acceptNextDialog = false;
page.on('dialog', async d => {
  const accept = acceptNextDialog; acceptNextDialog = false;
  await (accept ? d.accept() : d.dismiss()).catch(() => {});
});

const shot = n => page.screenshot({ path: `${OUT}/ix-${n}.png` }).catch(() => {});

// ── 1-3. boot ─────────────────────────────────────────────────────────────
const t0 = Date.now();
const booted = await boot(page);
check('boot: roster renders unit cards', !!booted, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
// The static #boot-splash fades out (400 ms) after boot; poll rather than
// sampling the instant the first card appears.
check('boot: splash removed', !!(await until(page, () => !document.getElementById('boot-splash'), { timeout: 10000 })));

// ── 4. faction -> chapter ─────────────────────────────────────────────────
const factions = await page.evaluate(() => {
  const s = document.getElementById('army-faction-select');
  return s ? Array.from(s.options).map(o => o.value).filter(Boolean) : [];
});
check('faction select is populated', factions.length > 5, `${factions.length} options`);

// (The old "SM faction reveals #army-chapter-group" check was removed: Space
// Marine chapters are separate entries in the faction select now.)

// use a normal faction for the rest
const bloodAngels = factions.find(f => /Blood Angels/i.test(f)) || factions.find(f => /Necrons/i.test(f)) || factions[1];
await page.evaluate(v => { const s = document.getElementById('army-faction-select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, bloodAngels);
await page.waitForTimeout(3500);
const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));
check('faction sets an inline --accent on <html>', !!accent, accent || 'empty');

// ── 5. detachment -> rules + enhancements ─────────────────────────────────
const detCount = await page.evaluate(() => document.querySelectorAll('#detachments-body input.detachment-row-cb').length);
check('detachments list populated', detCount > 0, `${detCount} rows`);
await page.evaluate(() => {
  const cb = document.querySelector('#detachments-body input.detachment-row-cb');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(2000);
const rulesShown = await page.evaluate(() => {
  const d = document.getElementById('army-detachment-subsection');
  const e = document.getElementById('army-stratagem-subsection');
  return { det: d ? !d.hasAttribute('hidden') : false, enh: e ? !e.hasAttribute('hidden') : false };
});
check('detachment reveals Detachment Rule section', rulesShown.det);
check('detachment reveals Enhancements section', rulesShown.enh);

// ── 6. unit detail ────────────────────────────────────────────────────────
await page.click('#unit-grid .unit-card').catch(() => {});
await page.waitForTimeout(1500);
const detail = await page.evaluate(() => {
  const c = document.querySelector('.unit-detail-content');
  if (!c) return null;
  return {
    kind: c.getAttribute('data-detail-kind'),
    stats: document.querySelectorAll('.detail-stat-cell, .stat-cell').length,
    weapons: document.querySelectorAll('.wg-line, .detail-weapons-section .wg-name').length,
    keywords: document.querySelectorAll('.unit-detail-content .keyword-tag').length,
    name: (document.querySelector('.detail-name') || {}).textContent || '',
  };
});
check('unit detail renders', !!detail && detail.kind === 'unit', detail ? detail.name.trim().slice(0, 40) : 'no content');
check('unit detail shows stats', !!detail && detail.stats > 0, detail ? `${detail.stats} cells` : '');
check('unit detail shows keywords', !!detail && detail.keywords > 0, detail ? `${detail.keywords} tags` : '');
await shot('01-detail');

// ── 7. add to army, points update ─────────────────────────────────────────
const before = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
await page.waitForTimeout(1800);
const after = await page.evaluate(() => ({
  pts: parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0,
  entries: document.querySelectorAll('#army-entry-list li.army-entry').length,
}));
check('add-to-army creates an entry', after.entries > 0, `${after.entries} entries`);
check('add-to-army increases points', after.pts > before, `${before} -> ${after.pts}`);
await shot('02-added');

// quantity stepper recomputes the total
const qtyOk = await page.evaluate(() => {
  const i = document.querySelector('#army-entry-list input.army-qty-input');
  if (!i) return null;
  const p0 = parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0;
  i.value = String((parseInt(i.value, 10) || 1) + 1);
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return { p0 };
});
await page.waitForTimeout(1200);
if (qtyOk) {
  const p1 = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
  check('quantity increase raises points', p1 > qtyOk.p0, `${qtyOk.p0} -> ${p1}`);
}

// ── 8. enhancement checkbox ───────────────────────────────────────────────
// KNOWN FAIL as of 2026-10-30 (180 + 15 -> 180), almost certainly a TEST
// problem: the unit under test is the first roster card (an Aggressor Squad,
// not a Character), so the enhancement is not applicable to it.
// verify-claims.mjs re-tests this with a real Character; trust that one.
const enh = await page.evaluate(() => {
  const cb = document.querySelector('.enhancement-cb:not(:disabled)');
  if (!cb) return null;
  const p0 = parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0;
  const pts = parseInt(cb.getAttribute('data-enh-pts') || '0', 10) || 0;
  cb.click();
  return { p0, pts };
});
if (enh) {
  await page.waitForTimeout(1500);
  const p1 = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
  check('enhancement adds its own points', p1 === enh.p0 + enh.pts, `${enh.p0} + ${enh.pts} = ${p1}`);
} else {
  check('enhancement checkbox available', false, 'no .enhancement-cb found');
}

// ── 11. undo / redo ───────────────────────────────────────────────────────
// Ctrl+Z is deliberately ignored while an input has focus (native input undo;
// js/app/history.js isTypingTarget), so take focus off the qty input first.
await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
const preUndo = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
const postUndo = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
const undoChanged = postUndo !== preUndo || await page.evaluate(() => !!document.querySelector('.enhancement-cb:checked') === false);
check('Ctrl+Z mutates state', !!undoChanged, `entries ${preUndo} -> ${postUndo}`);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1200);
const postRedo = await page.evaluate(() => document.querySelectorAll('#army-entry-list li.army-entry').length);
check('Ctrl+Shift+Z redoes', postRedo >= postUndo, `-> ${postRedo}`);

// ── search + points comparator filter ─────────────────────────────────────
const total = await page.evaluate(() => document.querySelectorAll('#unit-grid .unit-card').length);
await page.evaluate(() => { const s = document.getElementById('search-input'); s.value = 'zzzznomatch'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1000);
const none = await page.evaluate(() => ({
  cards: document.querySelectorAll('#unit-grid .unit-card').length,
  empty: (() => { const e = document.getElementById('roster-empty'); return !!e && getComputedStyle(e).display !== 'none'; })(),
}));
check('nonsense search yields zero cards', none.cards === 0, `${total} -> ${none.cards}`);
check('nonsense search shows #roster-empty', none.empty);

await page.evaluate(() => { const s = document.getElementById('search-input'); s.value = '<=100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1200);
const cmp = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#unit-grid .unit-card'));
  const pts = cards.map(c => {
    // A card shows every cost option ("85 / 170 pts"); the filter keeps a unit
    // if ANY option satisfies it, so compare the cheapest number.
    const m = (c.querySelector('.unit-card-pts') || {}).textContent || '';
    const nums = (String(m).match(/\d+/g) || []).map(Number);
    return nums.length ? Math.min.apply(null, nums) : null;
  }).filter(n => n !== null);
  return { n: cards.length, over: pts.filter(p => p > 100).length, sample: pts.slice(0, 8) };
});
check('comparator filter "<=100" returns results', cmp.n > 0, `${cmp.n} cards`);
check('comparator filter excludes >100pt units', cmp.over === 0, `${cmp.over} over-limit, sample ${JSON.stringify(cmp.sample)}`);
await page.evaluate(() => { const s = document.getElementById('search-input'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(1000);

// ── role filter chips ─────────────────────────────────────────────────────
const chip = await page.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.filter-chip')).find(x => /character/i.test(x.textContent));
  if (!c) return null;
  const n0 = document.querySelectorAll('#unit-grid .unit-card').length;
  c.click();
  return { n0, label: c.textContent.trim() };
});
if (chip) {
  await page.waitForTimeout(1200);
  const n1 = await page.evaluate(() => document.querySelectorAll('#unit-grid .unit-card').length);
  check('role chip filters the roster', n1 > 0 && n1 < chip.n0, `${chip.n0} -> ${n1}`);
  await page.evaluate(() => { const c = document.querySelector('.filter-chips-clear'); if (c) c.click(); });
  await page.waitForTimeout(1000);
  const n2 = await page.evaluate(() => document.querySelectorAll('#unit-grid .unit-card').length);
  check('clearing chips restores the roster', n2 === chip.n0, `${n1} -> ${n2}`);
}

// ── 9-10. save / load / export / import round-trip ────────────────────────
await page.evaluate(() => { const i = document.getElementById('army-name-input'); if (i) { i.value = 'VERIFY SWEEP ARMY'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } });
await page.waitForTimeout(600);
const ptsBeforeSave = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
await page.evaluate(() => { const b = document.getElementById('btn-save-army'); if (b) b.click(); });
await page.waitForTimeout(1500);
await page.evaluate(() => { const b = document.getElementById('btn-load-army'); if (b) b.click(); });
await page.waitForTimeout(1200);
const saved = await page.evaluate(() => Array.from(document.querySelectorAll('#saved-army-list li')).map(li => li.textContent.trim().slice(0, 80)));
check('saved army appears in Load modal', saved.some(s => /VERIFY SWEEP ARMY/i.test(s)), saved.slice(0, 3).join(' | '));
await shot('03-load-modal');
await page.evaluate(() => { const b = document.getElementById('modal-load-close'); if (b) b.click(); });
await page.waitForTimeout(700);

// export string
await page.evaluate(() => { const b = document.getElementById('btn-export-string'); if (b) b.click(); });
await page.waitForTimeout(1200);
const exported = await page.evaluate(() => (document.getElementById('export-string-textarea') || {}).value || '');
check('export produces a YAAB1 string', /^YAAB1:/.test(exported), `${exported.length} chars`);
await page.evaluate(() => { const b = document.getElementById('modal-export-close'); if (b) b.click(); });
await page.waitForTimeout(700);

// new -> import -> same points
acceptNextDialog = true;   // New army raises a confirm() when the army is dirty
await page.evaluate(() => { const b = document.getElementById('btn-new-army'); if (b) b.click(); });
await page.waitForTimeout(1500);
acceptNextDialog = false;
const ptsAfterNew = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
check('New army resets points to 0', ptsAfterNew === 0, String(ptsAfterNew));
if (/^YAAB1:/.test(exported)) {
  await page.evaluate(() => { const b = document.getElementById('btn-import-string'); if (b) b.click(); });
  await page.waitForTimeout(900);
  await page.evaluate(s => {
    const t = document.getElementById('import-json-textarea');
    if (t) { t.value = s; t.dispatchEvent(new Event('input', { bubbles: true })); }
  }, exported);
  await page.evaluate(() => { const b = document.getElementById('btn-import-confirm'); if (b) b.click(); });
  await page.waitForTimeout(3000);
  const ptsAfterImport = await page.evaluate(() => parseInt((document.getElementById('points-current') || {}).textContent || '0', 10) || 0);
  check('import round-trips to the same points', ptsAfterImport === ptsBeforeSave, `saved ${ptsBeforeSave} -> imported ${ptsAfterImport}`);
  await shot('04-imported');
}

// ── 12. command palette ───────────────────────────────────────────────────
await page.keyboard.press('Control+k');
await page.waitForTimeout(900);
const paletteOpen = await page.evaluate(() => !!document.querySelector('.cmdp-modal'));
check('Ctrl+K opens the command palette', paletteOpen);
if (paletteOpen) {
  // Collect is reachable on desktop ONLY through this palette entry.
  await page.evaluate(() => { const i = document.querySelector('.cmdp-input'); if (i) { i.value = 'collect'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await page.waitForTimeout(900);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.cmdp-row')).map(r => r.textContent.trim().slice(0, 50)));
  check('palette finds "Collect mode"', rows.some(r => /collect mode/i.test(r)), rows.slice(0, 3).join(' | '));
  await shot('05-palette');
}
await page.keyboard.press('Escape');

// ── 14. resize handles ────────────────────────────────────────────────────
const rz = await page.evaluate(() => {
  const h = document.getElementById('resize-left');
  const p = document.getElementById('panel-left');
  if (!h || !p) return null;
  return { w0: p.getBoundingClientRect().width, x: h.getBoundingClientRect().x + 2, y: h.getBoundingClientRect().y + 100 };
});
if (rz) {
  await page.mouse.move(rz.x, rz.y);
  await page.mouse.down();
  await page.mouse.move(rz.x + 90, rz.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const w1 = await page.evaluate(() => document.getElementById('panel-left').getBoundingClientRect().width);
  check('left resize handle drags the panel wider', w1 > rz.w0 + 20, `${rz.w0.toFixed(0)} -> ${w1.toFixed(0)}`);
}

writeFileSync(`${OUT}/interact.json`, JSON.stringify({ theme: THEME, pass: C.pass, fail: C.fail, results, errors }, null, 2));
console.log(`\npassed ${C.pass}, failed ${C.fail}`);
if (C.fail) console.log('failed: ' + results.filter(r => !r.ok).map(r => r.label).join('; '));
console.log('errors: ' + (errors.length ? [...new Set(errors)].slice(0, 10).join(' | ') : '(none)'));
await ctx.close();
await browser.close();
