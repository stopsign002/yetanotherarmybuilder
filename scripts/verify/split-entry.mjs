// split-entry.mjs — verifies the per-entry "split one copy off" button.
//
//   ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yetanotherarmybuilder/app/scripts/verify/split-entry.mjs \
//     ~/sites/base/browser/out/yaab-split
//
// READ-ONLY: anonymous, throwaway profile, all state in localStorage. yaab is
// not an SSO site, so there is no cookie to mint and no server write anywhere.
// THEME=brutalist|brutalist-dark to check the other themes.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT   = process.env.OUT || '/out';
const THEME = process.env.THEME || 'grimdark';
const SITE  = 'https://yaab.thewheeliebois.com/';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const results = [];
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? `  [${detail}]` : ''}`);
  results.push({ label, ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 300) });
  if (ok) pass++; else fail++;
}
// Poll via evaluate. NOT page.waitForFunction — it needs eval and every vhost
// here ships a CSP without 'unsafe-eval', so it throws instantly rather than
// waiting, and every later assertion then races the fetch it should have
// waited for.
async function until(page, fn, { timeout = 15000, step = 250, arg } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(step);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
await ctx.addInitScript(t => { try { localStorage.setItem('yaab_theme', t); } catch (_) {} }, THEME);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('EXCEPTION ' + e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'error' && !/401|auth\/me|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
page.on('dialog', async d => { await d.dismiss().catch(() => {}); });
const shot = n => page.screenshot({ path: `${OUT}/split-${THEME}-${n}.png`, fullPage: true }).catch(() => {});

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
const booted = await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 240000, step: 1000 });
check('boot: roster renders', !!booted);

// ── Necrons, so we can use Warriors + a Cryptek as the leader ──────────────
const fac = await page.evaluate(() => {
  const s = document.getElementById('army-faction-select');
  const opt = Array.from(s.options).map(o => o.value).find(v => /Necron/i.test(v));
  if (opt) { s.value = opt; s.dispatchEvent(new Event('change', { bubbles: true })); }
  return opt || null;
});
check('faction: Necrons selected', !!fac, fac);
await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 30000, step: 500 });

// Add a named unit to the army by driving the real roster card + Add button.
// The roster is capped-render, so the unit has to be SEARCHED for first — it is
// not in the DOM on a fresh faction load.
async function addByName(re, term) {
  await page.evaluate((t) => {
    const i = document.getElementById('search-input');
    if (i) { i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }
  }, term);
  await page.waitForTimeout(900);
  const clicked = await page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const card = Array.from(document.querySelectorAll('#unit-grid .unit-card'))
      .find(c => rx.test((c.querySelector('.unit-card-name') || c).textContent || ''));
    if (!card) return false;
    card.click();
    return true;
  }, re.source);
  if (!clicked) return false;
  await until(page, () => !!document.querySelector('#btn-detail-add, #btn-add-to-army'), { timeout: 10000 });
  await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
  await page.waitForTimeout(900);
  return true;
}

const readArmy = () => page.evaluate(() => {
  const a = window.App && App.state && App.state.currentArmy;
  return {
    total: (document.getElementById('points-current') || {}).textContent,
    cards: document.querySelectorAll('#army-entry-list .army-entry').length,
    splitBtns: document.querySelectorAll('#army-entry-list .army-entry-split').length,
    entries: a ? a.entries.map(e => ({
      name: e.unitName, count: e.count, id: e.entryId, parent: e.attachedToEntryId,
    })) : [],
    warnings: Array.from(document.querySelectorAll('.validation-banner li, .validation-banner')).map(n => n.textContent.trim()).join(' | ').slice(0, 300),
  };
});

// ── Add Necron Warriors twice — they must stack ───────────────────────────
const okW = await addByName(/Necron Warriors/, 'Necron Warriors');
check('roster: Necron Warriors found + added', okW);
await addByName(/Necron Warriors/, 'Necron Warriors');
const stacked = await readArmy();
check('two adds produce ONE card (stacked)', stacked.cards === 1, `${stacked.cards} cards`);
check('stacked entry has count 2', stacked.entries[0] && stacked.entries[0].count === 2, JSON.stringify(stacked.entries));
check('split button IS shown on a stack', stacked.splitBtns === 1, `${stacked.splitBtns}`);
// The button must actually be VISIBLE, not just present. Every other assertion
// here passed once while the control was a 12x10 empty box with no icon in it
// (the svg was never wired onto the action), which is exactly the failure a
// DOM-presence check cannot see.
const btnPaint = await page.evaluate(() => {
  const b = document.querySelector('#army-entry-list .army-entry-split');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const svg = b.querySelector('svg');
  const sr = svg && svg.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    svg: !!svg, svgW: sr ? Math.round(sr.width) : 0, svgH: sr ? Math.round(sr.height) : 0,
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity, color: cs.color,
  };
});
check('split button renders an actual icon', btnPaint && btnPaint.svg && btnPaint.svgW >= 10 && btnPaint.svgH >= 10, JSON.stringify(btnPaint));
check('split button is a real hit target (>=20x20)', btnPaint && btnPaint.w >= 20 && btnPaint.h >= 20, btnPaint && `${btnPaint.w}x${btnPaint.h}`);
check('split button is not transparent/hidden',
  btnPaint && btnPaint.visibility === 'visible' && Number(btnPaint.opacity) > 0.5 && btnPaint.display !== 'none',
  btnPaint && `${btnPaint.display}/${btnPaint.visibility}/${btnPaint.opacity}`);

// It must not be clipped away by the card's overflow:hidden.
const notClipped = await page.evaluate(() => {
  const b = document.querySelector('#army-entry-list .army-entry-split');
  const card = b && b.closest('.army-entry');
  if (!b || !card) return null;
  const br = b.getBoundingClientRect(), cr = card.getBoundingClientRect();
  return { inside: br.right <= cr.right + 1 && br.left >= cr.left - 1 && br.bottom <= cr.bottom + 1, br: [br.left, br.right], cr: [cr.left, cr.right] };
});
check('split button is inside the card box (not clipped)', notClipped && notClipped.inside, JSON.stringify(notClipped));
await shot('1-stacked');

const totalBefore = stacked.total;

// ── Split ─────────────────────────────────────────────────────────────────
await page.click('#army-entry-list .army-entry-split');
await page.waitForTimeout(700);
const afterSplit = await readArmy();
check('split produces TWO cards', afterSplit.cards === 2, `${afterSplit.cards} cards`);
check('both cards are count 1', afterSplit.entries.length === 2 && afterSplit.entries.every(e => e.count === 1), JSON.stringify(afterSplit.entries));
check('the two entries have DISTINCT entryIds',
  afterSplit.entries.length === 2 && afterSplit.entries[0].id && afterSplit.entries[1].id
  && afterSplit.entries[0].id !== afterSplit.entries[1].id,
  afterSplit.entries.map(e => e.id).join(' / '));
check('POINTS UNCHANGED by the split', afterSplit.total === totalBefore, `${totalBefore} -> ${afterSplit.total}`);
check('split button hidden once count is 1', afterSplit.splitBtns === 0, `${afterSplit.splitBtns}`);
await shot('2-split');

// ── THE ACTUAL BUG: a leader on EACH squad ────────────────────────────────
// In 11e there is no datasheet literally called "Cryptek" — the Crypteks are
// Technomancer / Plasmancer / Chronomancer etc. Both of these are listed by the
// data as able to lead Necron Warriors.
const okL1 = await addByName(/Technomancer/, 'Technomancer');
check('roster: Technomancer added', okL1);
const okL2 = await addByName(/Royal Warden/, 'Royal Warden');
check('roster: Royal Warden added', okL2);

const attached = await page.evaluate(() => {
  const a = App.state.currentArmy;
  const w = a.entries.filter(e => /Necron Warriors/i.test(e.unitName));
  const t = a.entries.find(e => /Technomancer/i.test(e.unitName));
  const r = a.entries.find(e => /Royal Warden/i.test(e.unitName));
  if (w.length < 2 || !t || !r) return null;
  // Exactly the write drag-to-attach performs (flip-animations.js:730).
  t.attachedToEntryId = w[0].entryId;
  r.attachedToEntryId = w[1].entryId;
  a.touch();
  UI.renderArmyList(a);
  return { squad1: w[0].entryId, squad2: w[1].entryId, tech: t.entryId, warden: r.entryId };
});
check('attach: one leader pointed at EACH of the two squads', !!attached, JSON.stringify(attached));
await page.waitForTimeout(600);

const nested = await page.evaluate((t) => {
  const roots = Array.from(document.querySelectorAll('#army-entry-list > .army-entry'));
  const kidsOf = (id) => {
    const host = roots.find(li => li.dataset.entryId === id);
    if (!host) return null;
    return Array.from(host.querySelectorAll('.army-entry-attachments > .army-entry'))
      .map(li => li.dataset.entryId);
  };
  return { rootCount: roots.length, s1: kidsOf(t.squad1), s2: kidsOf(t.squad2) };
}, attached || { squad1: '', squad2: '' });

check('squad 1 has exactly its own leader nested under it',
  nested.s1 && nested.s1.length === 1 && nested.s1[0] === attached.tech, JSON.stringify(nested.s1));
check('squad 2 has exactly its OWN, DIFFERENT leader nested under it',
  nested.s2 && nested.s2.length === 1 && nested.s2[0] === attached.warden, JSON.stringify(nested.s2));
check('the two squads are separate root cards', nested.rootCount === 2, `${nested.rootCount} roots`);
await shot('3-leader-each');

// ── Survives a reload (localStorage round-trip) ───────────────────────────
await page.evaluate(() => {
  const a = App.state.currentArmy;
  a.name = 'zz split verify';
  App.state.armyManager.saveArmy(a);
});
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'domcontentloaded' });
await until(page, () => document.querySelectorAll('#army-entry-list .army-entry').length > 0, { timeout: 120000, step: 1000 });
const reloaded = await readArmy();
check('after reload: still two Warriors entries', reloaded.entries.filter(e => /Necron Warriors/i.test(e.name)).length === 2, JSON.stringify(reloaded.entries.filter(e => /Necron Warriors/i.test(e.name))));
check('after reload: Technomancer still on squad 1',
  reloaded.entries.some(e => /Technomancer/i.test(e.name) && e.parent === attached.squad1),
  JSON.stringify(reloaded.entries.find(e => /Technomancer/i.test(e.name))));
check('after reload: Royal Warden still on squad 2',
  reloaded.entries.some(e => /Royal Warden/i.test(e.name) && e.parent === attached.squad2),
  JSON.stringify(reloaded.entries.find(e => /Royal Warden/i.test(e.name))));
check('after reload: points still match the pre-split total plus the leaders',
  Number(reloaded.total) > Number(totalBefore), `${totalBefore} -> ${reloaded.total}`);

// ── Text export lists them as two separate lines ──────────────────────────
const exported = await page.evaluate(() => {
  try { return window.Storage && Storage.exportArmyToText ? Storage.exportArmyToText(App.state.currentArmy) : null; }
  catch (e) { return 'ERR ' + e.message; }
});
check('text export lists TWO separate 1x Necron Warriors lines',
  typeof exported === 'string' && (exported.match(/1x .*Necron Warriors/g) || []).length === 2,
  typeof exported === 'string' ? JSON.stringify((exported.match(/\d+x [^\[]*/g) || []).slice(0, 6)) : String(exported));

// ── Rule of Three counts copies, stacked or not ───────────────────────────
// computeWarnings is private to the module, so assert the RENDERED banner —
// which is what the user actually sees anyway.
const readWarn = () => page.evaluate(() => {
  const b = document.getElementById('validation-banner');
  if (!b || b.hidden) return [];
  return Array.from(b.querySelectorAll('li')).map(li => li.textContent.trim());
});

// 4 copies in ONE stacked entry: before the fix this warned about nothing.
await page.evaluate(() => {
  const a = App.state.currentArmy;
  const c = a.entries.find(e => /Technomancer/i.test(e.unitName));
  c.attachedToEntryId = null;
  c.count = 4;
  a.touch();
  UI.renderArmyList(a);
});
await page.waitForTimeout(600);
// Baseline AFTER the count bump (which legitimately adds 3 more Technomancers'
// worth of points) — the splits that follow are what must be free.
const totalWithFour = (await readArmy()).total;
const wStacked = await readWarn();
check('Rule of Three fires on a STACKED count-4 entry',
  wStacked.some(w => /Rule of Three/i.test(w) && /Technomancer/i.test(w)),
  JSON.stringify(wStacked));

// Same four copies, now split across entries — must say the same thing.
await page.evaluate(() => {
  const a = App.state.currentArmy;
  const i = a.entries.findIndex(e => /Technomancer/i.test(e.unitName));
  a.splitEntry(i); a.splitEntry(i); a.splitEntry(i);
  UI.renderArmyList(a);
});
await page.waitForTimeout(600);
const wSplit = await readWarn();
check('Rule of Three says the SAME thing once split apart',
  wSplit.some(w => /Rule of Three/i.test(w) && /Technomancer/i.test(w))
  && wSplit.filter(w => /Technomancer/i.test(w)).length === wStacked.filter(w => /Technomancer/i.test(w)).length,
  JSON.stringify(wSplit));

// Splitting three times must still not have moved the points.
const afterR3 = await readArmy();
check('points still unchanged after 3 more splits', afterR3.total === totalWithFour,
  `${totalWithFour} -> ${afterR3.total}`);
check('4 Technomancers now on 4 separate cards',
  afterR3.entries.filter(e => /Technomancer/i.test(e.name)).length === 4,
  afterR3.entries.filter(e => /Technomancer/i.test(e.name)).map(e => e.count).join(','));
await shot('5-rule-of-three');

// ── Phone width ───────────────────────────────────────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await shot('4-phone');

check('no page exceptions / console errors', errors.length === 0, errors.slice(0, 4).join(' ;; '));

writeFileSync(`${OUT}/split-${THEME}-results.json`, JSON.stringify({ theme: THEME, pass, fail, results, errors }, null, 2));
console.log(`\n${THEME}: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
