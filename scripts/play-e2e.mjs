// play-e2e.mjs — end-to-end check of yaab's new Play mode.
// Run: ~/sites/base/browser/browse.sh run play-e2e.mjs <outdir>
//
// READ-ONLY server-wise: everything it creates lives in the browser's own
// localStorage (a throwaway context), signed out, so sync never fires.
// No waitForFunction anywhere — yaab's CSP has no 'unsafe-eval'.
import { chromium } from 'playwright';

const OUT = process.env.OUT || '/out';
const BASE = process.env.BASE || process.env.SITE || 'https://yaab.thewheeliebois.com';

let pass = 0, fail = 0;
const fails = [];
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  if (ok) pass++; else { fail++; fails.push(label); }
}
async function poll(page, fn, { timeout = 45000, step = 250 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
}

// Build a small real army through the app's own APIs: 3 entries incl. an
// attached leader with an enhancement, two detachments. Returns a summary.
async function seedArmy(page) {
  return await page.evaluate(() => {
    const S = App.state;
    const f = S.factions.find(x =>
      (x.detachments || []).length >= 2 &&
      (x.units || []).length > 20 &&
      (x.armyRules || []).length > 0 &&
      x.detachments.some(d => (d.enhancements || []).length && ((d.gdcStratagems || []).length || (d.stratagems || []).length)) &&
      x.units.some(u => u.attachmentRole === 'leader'));
    if (!f) return { error: 'no suitable faction' };
    const dets = f.detachments.filter(d => (d.enhancements || []).length).slice(0, 1)
      .concat(f.detachments.filter(d => !(d.enhancements || []).length).slice(0, 1));
    if (dets.length < 2) dets.push(f.detachments.find(d => d !== dets[0]));
    const leader = f.units.find(u => u.attachmentRole === 'leader' && (u.gdcLeadBy || []).length);
    const body = leader
      ? f.units.find(u => (leader.gdcLeadBy || []).includes(u.name))
      : null;
    const bodyguard = body || f.units.find(u => u.attachmentRole !== 'leader' && !/character/i.test(u.role || ''));
    const third = f.units.find(u => u !== leader && u !== bodyguard);
    if (!leader || !bodyguard || !third) return { error: 'could not pick units' };

    const army = new Army({ name: 'E2E Play Test', factionName: f.factionName,
                            detachmentNames: dets.map(d => d.name) });
    army.addUnit(bodyguard);
    army.addUnit(leader);
    army.addUnit(third);
    army.entries[1].attachedToEntryId = army.entries[0].entryId;
    const enh = (dets[0].enhancements || [])[0];
    if (enh) army.setEnhancements(1, [{ name: enh.name, pts: enh.pts, description: enh.description }]);

    S.selectedDetachments = dets;
    S.selectedDetachment = dets[0];
    S.factionFilter = f.factionName;
    S.armyManager.armies.push(army);
    S.armyManager.save();
    S.currentArmy = army;
    return {
      armyId: army.id, faction: f.factionName,
      dets: dets.map(d => d.name),
      units: [bodyguard.name, leader.name, third.name],
      enh: enh ? enh.name : null,
      entryIds: army.entries.map(e => e.entryId),
      leaderEntry: army.entries[1].entryId,
      parentEntry: army.entries[0].entryId,
    };
  });
}

async function bootAndSeed(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  // Wait for the async GDC merge too (armyRules / gdcStratagems land after
  // the factions themselves), by polling for a faction that satisfies the
  // seed criteria rather than a bare faction count.
  const ready = await poll(page, () =>
    window.App && App.state && App.state.factions && App.state.factions.length >= 30 &&
    App.state.armyManager && window.Army && App.CardRenderers &&
    App.state.factions.some(f =>
      (f.detachments || []).length >= 2 &&
      (f.units || []).length > 20 &&
      (f.armyRules || []).length > 0 &&
      f.detachments.some(d => (d.enhancements || []).length && ((d.gdcStratagems || []).length || (d.stratagems || []).length)) &&
      f.units.some(u => u.attachmentRole === 'leader' && (u.gdcLeadBy || []).length))
    ? true : null, { timeout: 90000 });
  if (!ready) throw new Error('app never finished booting');
  const seed = await seedArmy(page);
  if (!seed || seed.error) throw new Error('seed failed: ' + (seed && seed.error));
  return seed;
}

const browser = await chromium.launch();

// ════════════════════════ DESKTOP 1440 ════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const seed = await bootAndSeed(page);
  console.log('# seeded:', JSON.stringify(seed.units), 'dets:', JSON.stringify(seed.dets));

  // Entry point 1: the top-bar shelf Play button.
  const shelfBtn = await page.$('#btn-play-mode');
  check('desktop: top-bar Play button exists', !!shelfBtn);
  if (shelfBtn) await shelfBtn.click();
  else await page.evaluate(() => App.openPlayMode());
  await page.waitForSelector('#play-mode:not([hidden]) .play-unit-chip', { timeout: 10000 });
  check('desktop: play mode opens with unit chips', true);

  // Chips: count + leader adjacency.
  const chips = await page.$$eval('.play-unit-chip', els =>
    els.map(e => ({ id: e.dataset.entryId, leader: e.classList.contains('is-leader') })));
  check('desktop: one chip per entry', chips.length === 3, 'got ' + chips.length);
  const pIdx = chips.findIndex(c => c.id === seed.parentEntry);
  const lIdx = chips.findIndex(c => c.id === seed.leaderEntry);
  check('desktop: leader chip directly after its unit', lIdx === pIdx + 1 && chips[lIdx].leader);

  // All sheets pre-rendered, exactly one visible.
  const sheetStates = await page.$$eval('.play-sheet', els =>
    ({ total: els.length, visible: els.filter(e => !e.hidden).length }));
  check('desktop: all sheets pre-rendered in DOM', sheetStates.total === 3, JSON.stringify(sheetStates));
  check('desktop: exactly one sheet visible', sheetStates.visible === 1);

  // Sheet actually renders the Details-pane datasheet (stat pillars +
  // weapon section), with the builder chrome stripped.
  const sheetHasContent = await page.$eval('.play-sheet:not([hidden])', el => ({
    detail: !!el.querySelector('.unit-detail-content'),
    stats: !!el.querySelector('.detail-stat-pillar'),
    weapons: !!el.querySelector('.detail-weapons-section'),
    addBtn: !!el.querySelector('#btn-detail-add, .detail-add-btn'),
    enhCheckbox: !!el.querySelector('.enhancement-cb'),
    banner: !!el.querySelector('.detail-banner'),
    name: !!el.querySelector('.detail-name'),
    google: !!el.querySelector('.btn-google-search'),
  }));
  check('desktop: visible sheet is the Details-pane datasheet', sheetHasContent.detail && sheetHasContent.stats);
  check('desktop: sheet has weapon tables', sheetHasContent.weapons);
  check('desktop: no Add-to-Army / enhancement checkboxes on sheet',
    !sheetHasContent.addBtn && !sheetHasContent.enhCheckbox);
  check('desktop: no banner/name/faction/google on sheet (chip names the unit)',
    !sheetHasContent.banner && !sheetHasContent.name && !sheetHasContent.google,
    JSON.stringify({ banner: sheetHasContent.banner, name: sheetHasContent.name, google: sheetHasContent.google }));

  // No points anywhere in play mode: no banner points stack, no ordinal
  // pricing box, no "pts" in the header or the unit chips.
  const noPts = await page.evaluate(() => {
    const root = document.querySelector('#play-mode');
    return {
      // CP stacks are fine (game resource); any stack captioned "pts" is not.
      stack: [...root.querySelectorAll('.detail-pts-caption')].some(c => /pts|points/i.test(c.textContent)),
      ordinal: !!root.querySelector('.detail-ordinal'),
      headerPts: /\bpts\b/i.test(document.querySelector('.play-header').textContent),
      chipPts: [...root.querySelectorAll('.play-unit-chip')].some(c => /\d+\s*pts/i.test(c.textContent)),
    };
  });
  check('desktop: no points info anywhere in play mode',
    !noPts.stack && !noPts.ordinal && !noPts.headerPts && !noPts.chipPts, JSON.stringify(noPts));

  // Switching: click the 3rd chip; no network requests may fire.
  let reqs = 0;
  const onReq = () => { reqs++; };
  page.on('request', onReq);
  await page.click(`.play-unit-chip[data-entry-id="${seed.entryIds[2]}"]`);
  await page.waitForTimeout(300);
  page.off('request', onReq);
  const nowVisible = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  check('desktop: chip click switches sheet', nowVisible === seed.entryIds[2]);
  check('desktop: switching fires zero network requests', reqs === 0, reqs + ' requests');

  // Arrow-key navigation.
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  const afterArrow = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  check('desktop: ArrowLeft pages to previous sheet', afterArrow === seed.entryIds[1]);

  // The leader entry (now visible) carries an enhancement — its sheet shows
  // it as a read-only Enhancements section.
  const leaderEnh = await page.$eval('.play-sheet:not([hidden])', el =>
    [...el.querySelectorAll('.detail-section-title')].some(t => /enhancements/i.test(t.textContent)));
  check('desktop: leader sheet lists its enhancement read-only', leaderEnh);

  // Tabs.
  for (const [tab, expectSel] of [
    ['strats', '.play-panel[data-panel="strats"] .play-strat-row'],
    ['rules', '.play-panel[data-panel="rules"] .unit-detail-rule'],
    ['enhance', '.play-panel[data-panel="enhance"] .unit-detail-rule'],
  ]) {
    await page.click(`.play-tab[data-tab="${tab}"]`);
    const el = await page.waitForSelector(expectSel, { timeout: 5000 }).catch(() => null);
    check(`desktop: ${tab} tab shows content`, !!el);
  }

  // Stratagems: core strat present, detachment group header present, bold ran.
  const strat = await page.evaluate(() => {
    const panel = document.querySelector('.play-panel[data-panel="strats"]');
    const heads = [...panel.querySelectorAll('.play-group-head')].map(h => h.textContent);
    const coreName = (App.CORE_STRATAGEMS && App.CORE_STRATAGEMS[0] || {}).name || '';
    return {
      heads,
      hasCore: coreName && panel.textContent.toUpperCase().includes(coreName.toUpperCase()),
      // Details-pane rendering bolds only genuine **markers**; this faction's
      // prose has none (verified), so assert the inverse responsibility:
      // mdBold must never leak literal ** into rendered text.
      noLiteralMarkers: !panel.textContent.includes('**')
        && !document.querySelector('.play-panel[data-panel="rules"]').textContent.includes('**'),
      rows: panel.querySelectorAll('.play-strat-row').length,
      closed: [...panel.querySelectorAll('.play-strat-row')].every(r => r.getAttribute('aria-expanded') === 'false'),
      renderedEarly: panel.querySelectorAll('.unit-detail-rule').length,
      cpBadges: panel.querySelectorAll('.play-strat-row .cp-badge').length,
      phased: [...panel.querySelectorAll('.play-strat-row')].filter(r => r.querySelector('.strat-phase-badge')).length,
      emptyBadges: [...panel.querySelectorAll('.strat-phase-badge')].filter(b => !b.textContent.trim()).length,
    };
  });
  check('desktop: stratagems render as compact rows', strat.rows > 5, strat.rows + ' rows');
  check('desktop: every row is aria-expanded=false until clicked', strat.closed);
  check('desktop: rule text is lazy (nothing rendered before a click)', strat.renderedEarly === 0, strat.renderedEarly + ' cards');
  check('desktop: rows show CP badges', strat.cpBadges > 5, strat.cpBadges + ' CP badges');
  check('desktop: rows show phase badges, none empty', strat.phased > 0 && strat.emptyBadges === 0, strat.phased + ' with phase, ' + strat.emptyBadges + ' empty');
  check('desktop: detachment stratagem group header present',
    strat.heads.some(h => h.includes(seed.dets[0])), JSON.stringify(strat.heads));
  check('desktop: core stratagems present', !!strat.hasCore);
  check('desktop: no literal ** markers leak into rendered text', strat.noLiteralMarkers);

  // Multi-phase stratagems: one badge per phase (Item E).
  {
    const pb = await page.$$eval('.play-panel[data-panel="strats"] .play-strat-row',
      rows => rows.map(r => [...r.querySelectorAll('.strat-phase-badge')].map(x => x.textContent)));
    check('desktop: a multi-phase stratagem shows one badge per phase', pb.some(b => b.length === 2), JSON.stringify(pb.find(b => b.length === 2)));
    check('desktop: single-phase and Any rows show one badge', pb.some(b => b.length === 1) && pb.some(b => b.length === 1 && b[0] === 'Any'));
  }

  // Expand/collapse: click opens + renders text, click again closes, two open together.
  {
    await page.click('.play-tab[data-tab="strats"]');
    const rows = await page.$$('.play-panel[data-panel="strats"] .play-strat-row');
    const r0 = rows[0], r1 = rows[1];
    const st = async r => r.getAttribute('aria-expanded');
    const bodyHas = async r => r.evaluate(el => {
      const b = el.closest('.play-strat').querySelector('.play-strat-body');
      return { cards: b.querySelectorAll('.unit-detail-rule').length, text: b.textContent.trim().length, inert: b.hasAttribute('inert') };
    });
    await r0.click();
    await page.waitForSelector('.play-panel[data-panel="strats"] .play-strat.is-open .unit-detail-rule', { timeout: 3000 }).catch(() => null);
    const o0 = await bodyHas(r0);
    check('desktop: clicking a strat row opens it (aria-expanded=true)', (await st(r0)) === 'true');
    check('desktop: opened row renders its rule text into the body', o0.cards === 1 && o0.text > 20 && !o0.inert, JSON.stringify(o0));
    await r1.click();
    check('desktop: a second row can be open together with the first',
      (await st(r0)) === 'true' && (await st(r1)) === 'true');
    await page.waitForTimeout(300);
    const h = await r0.evaluate(el => el.closest('.play-strat').querySelector('.play-strat-body').getBoundingClientRect().height);
    check('desktop: expanded body has natural height after the transition', h > 20, Math.round(h) + 'px');
    await r0.click();
    check('desktop: clicking again closes the row', (await st(r0)) === 'false' && (await st(r1)) === 'true');
    const c0 = await bodyHas(r0);
    check('desktop: closed body is inert', c0.inert);
    await r0.focus();
    await page.keyboard.press('Enter');
    check('desktop: Enter on the focused row toggles it', (await st(r0)) === 'true');
    await r0.click(); await r1.click();
  }

  // Rules tab: army rules group + faction army rule name.
  const rules = await page.evaluate(() => {
    const panel = document.querySelector('.play-panel[data-panel="rules"]');
    return {
      heads: [...panel.querySelectorAll('.play-group-head')].map(h => h.textContent),
      cards: panel.querySelectorAll('.unit-detail-rule').length,
      detEyebrow: [...panel.querySelectorAll('.detail-eyebrow')].some(e => /detachment rule/i.test(e.textContent)),
    };
  });
  check('desktop: rules tab has Army rules group', rules.heads.some(h => /army rules/i.test(h)));
  check('desktop: rules rendered as Details-pane rules', rules.cards >= 1, rules.cards + ' cards');
  check('desktop: detachment rules labelled as such', rules.detEyebrow);

  // Enhancements: taken enhancement listed with carrier link; link jumps to sheet.
  await page.click('.play-tab[data-tab="enhance"]');
  const enh = await page.evaluate(() => {
    const panel = document.querySelector('.play-panel[data-panel="enhance"]');
    const carrier = panel.querySelector('.play-enh-carrier');
    return {
      inArmy: [...panel.querySelectorAll('.play-group-head')].some(h => /in this army/i.test(h.textContent)),
      carrier: carrier ? carrier.dataset.entryId : null,
      taken: !!panel.querySelector('.play-enh-taken-badge'),
    };
  });
  check('desktop: taken enhancement shown under "In this army"', enh.inArmy && !!enh.carrier);
  check('desktop: TAKEN badge on the detachment list', enh.taken);
  if (enh.carrier) {
    await page.click('.play-enh-carrier');
    await page.waitForTimeout(150);
    const jumped = await page.evaluate(() => ({
      tab: document.querySelector('.play-root').dataset.activeTab,
      sheet: (document.querySelector('.play-sheet:not([hidden])') || {}).dataset?.entryId,
    }));
    check('desktop: carrier link jumps to that sheet',
      jumped.tab === 'sheets' && jumped.sheet === enh.carrier, JSON.stringify(jumped));
  }

  // Tracking: CP and dead. Wounds are tracked on the board, not in the app
  // (play-mode.js header) — the per-entry stepper was removed, so assert it
  // stays gone rather than carrying a check that could only fail (#103).
  await page.click('.play-cp-btn[data-cp="1"]');
  await page.click('.play-cp-btn[data-cp="1"]');
  const cpText = await page.$eval('.play-cp-val', el => el.textContent);
  check('desktop: CP counter increments', cpText.trim() === '2 CP', cpText);

  const visSheet = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  const woundUi = await page.$$eval('#play-mode .play-w-btn, #play-mode .play-chip-w', els => els.length);
  check('desktop: no wound stepper or wound badge in Play (wounds live on the board)', woundUi === 0, woundUi + ' wound controls');
  await page.click(`.play-sheet[data-entry-id="${visSheet}"] .play-dead`);
  await page.waitForTimeout(150);
  const deadState = await page.evaluate(id => ({
    sheet: document.querySelector(`.play-sheet[data-entry-id="${id}"]`).classList.contains('is-dead'),
    chip: document.querySelector(`.play-unit-chip[data-entry-id="${id}"]`).classList.contains('is-dead'),
  }), visSheet);
  check('desktop: dead toggle dims sheet + chip', deadState.sheet && deadState.chip);

  // Persistence across reload.
  await page.waitForTimeout(400); // let the debounced write land
  await page.reload({ waitUntil: 'load' });
  const rb = await poll(page, () =>
    window.App && App.state && App.state.factions && App.state.factions.length >= 30 ? true : null);
  check('desktop: app reboots after reload', !!rb);
  await page.evaluate(() => App.openPlayMode());
  await page.waitForSelector('#play-mode:not([hidden]) .play-unit-chip', { timeout: 10000 });
  const persisted = await page.evaluate(id => ({
    cp: document.querySelector('.play-cp-val').textContent.trim(),
    dead: document.querySelector(`.play-unit-chip[data-entry-id="${id}"]`)?.classList.contains('is-dead'),
  }), visSheet);
  check('desktop: CP persists across reload', persisted.cp === '2 CP', persisted.cp);
  check('desktop: dead state persists across reload', persisted.dead === true);

  // Reset game (dialog auto-accepted).
  await page.click('.play-reset');
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(id => ({
    cp: document.querySelector('.play-cp-val').textContent.trim(),
    dead: document.querySelector(`.play-unit-chip[data-entry-id="${id}"]`)?.classList.contains('is-dead'),
  }), visSheet);
  check('desktop: reset clears CP + dead', afterReset.cp === '0 CP' && afterReset.dead === false,
    JSON.stringify(afterReset));

  // Destroyed units sink to the end of the chip rail and the sheet panel,
  // first-killed first; un-marking restores the original position.
  {
    const order = () => page.evaluate(() => ({
      chips: [...document.querySelectorAll('.play-switcher .play-unit-chip')].map(c => c.dataset.entryId),
      sheets: [...document.querySelectorAll('.play-panel[data-panel="sheets"] .play-sheet')].map(c => c.dataset.entryId),
      first: [...document.querySelectorAll('.play-unit-chip[data-first-dead]')].map(c => c.dataset.entryId),
    }));
    const kill = async id => {
      await page.click(`.play-unit-chip[data-entry-id="${id}"]`);
      await page.click(`.play-sheet[data-entry-id="${id}"] .play-dead`);
      await page.waitForTimeout(120);
    };
    const o0 = await order();
    const [a0, b0] = o0.chips;
    await kill(a0);
    const o1 = await order();
    check('desktop: destroyed chip + sheet go last',
      o1.chips[o1.chips.length - 1] === a0 && o1.sheets[o1.sheets.length - 1] === a0, JSON.stringify(o1.chips));
    check('desktop: first-dead separator on that chip', o1.first.length === 1 && o1.first[0] === a0);
    const act = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
    check('desktop: active sheet stays put after reorder', act === a0, act);
    await kill(b0);
    const o2 = await order();
    const n = o2.chips.length;
    check('desktop: first-killed sits before second-killed',
      o2.chips[n - 2] === a0 && o2.chips[n - 1] === b0 && o2.sheets[n - 2] === a0 && o2.sheets[n - 1] === b0,
      JSON.stringify(o2.chips));
    await kill(a0);   // un-mark
    const o3 = await order();
    check('desktop: un-marking returns unit to its place among the living',
      o3.chips[0] === a0 && o3.sheets[0] === a0 && o3.chips[n - 1] === b0, JSON.stringify(o3.chips));
    await kill(b0);   // un-mark
    const o4 = await order();
    check('desktop: order fully restored', JSON.stringify(o4.chips) === JSON.stringify(o0.chips)
      && JSON.stringify(o4.sheets) === JSON.stringify(o0.sheets) && o4.first.length === 0, JSON.stringify(o4.chips));
  }

  // Stacked squads (count > 1) always split into one sheet per copy, with
  // independent tracking.
  await page.evaluate(() => { App.state.currentArmy.entries[2].count = 2; App.playMode.refresh(); });
  await page.waitForTimeout(300);
  const split = await page.evaluate(id => {
    const chips = [...document.querySelectorAll('.play-unit-chip')];
    const mine = chips.filter(c => c.dataset.entryId === id || c.dataset.entryId.startsWith(id + '::'));
    return {
      total: chips.length,
      copies: mine.map(c => ({ vid: c.dataset.entryId, label: c.textContent.trim() })),
      sheets: document.querySelectorAll('.play-sheet').length,
    };
  }, seed.entryIds[2]);
  check('desktop: stacked squad splits into one chip per copy',
    split.copies.length === 2 && split.total === 4, JSON.stringify(split.copies));
  check('desktop: split copies numbered #1/#2',
    split.copies[0].label.includes('#1') && split.copies[1].label.includes('#2'));
  check('desktop: one pre-rendered sheet per copy', split.sheets === 4, split.sheets + ' sheets');
  const vid2 = seed.entryIds[2] + '::1';
  await page.click(`.play-unit-chip[data-entry-id="${vid2}"]`);
  await page.click(`.play-sheet[data-entry-id="${vid2}"] .play-dead`);
  await page.waitForTimeout(250);
  const indep = await page.evaluate(({ v1, v2 }) => ({
    c2dead: document.querySelector(`.play-unit-chip[data-entry-id="${v2}"]`).classList.contains('is-dead'),
    c1dead: document.querySelector(`.play-unit-chip[data-entry-id="${v1}"]`).classList.contains('is-dead'),
  }), { v1: seed.entryIds[2], v2: vid2 });
  check('desktop: split copies track dead independently', indep.c2dead && !indep.c1dead, JSON.stringify(indep));
  await page.evaluate(() => { App.state.currentArmy.entries[2].count = 1; App.playMode.refresh(); });
  await page.waitForTimeout(200);

  // Exit button leaves play mode.
  const exitBtn = await page.$('.play-exit');
  check('desktop: Exit button present in header', !!exitBtn);
  if (exitBtn) {
    await exitBtn.click();
    await page.waitForTimeout(300);
    const modeAfterExit = await page.evaluate(() => App.getMode());
    check('desktop: Exit returns to build', modeAfterExit === 'build', modeAfterExit);
  }

  // Settings drawer go-play row exists on desktop.
  await page.evaluate(() => App.settingsDrawer.open());
  const goPlay = await page.waitForSelector('#set-action-go-play', { timeout: 4000 }).catch(() => null);
  check('desktop: settings drawer has a Play row', !!goPlay);
  await page.evaluate(() => App.settingsDrawer.close());

  // Cards mode regression: the facade must not have perturbed prefs.
  // (The Back-button trap is mobile-only — checked in the phone section.)
  await page.evaluate(() => App.openCardsMode());
  const cardsOk = await page.waitForSelector('#cards-mode:not([hidden]) .dcc-card', { timeout: 10000 }).catch(() => null);
  check('desktop: cards mode still renders after facade change', !!cardsOk);

  await page.screenshot({ path: `${OUT}/desktop-final.png`, fullPage: false });
  await ctx.close();
}

// ════════════════════════ PHONE 390 ════════════════════════
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const seed = await bootAndSeed(page);

  // Enter Play the way a phone user does: tap the settings-drawer row. This
  // used to call App.openPlayMode() directly to dodge the drawer-close
  // history.go(-1) vs mode-trap pushState race (#73, fixed for every caller
  // by #106 in mobile-history.js). The drawer path is the one that regressed,
  // so it is the one this suite drives (#107).
  await page.evaluate(() => App.settingsDrawer.open());
  const row = await page.waitForSelector('#set-action-go-play', { timeout: 5000 }).catch(() => null);
  check('phone: drawer Play row exists', !!row);
  if (row) await row.click(); else await page.evaluate(() => App.openPlayMode());
  await page.waitForSelector('#play-mode:not([hidden]) .play-unit-chip', { timeout: 10000 });
  check('phone: play mode opens from the drawer row', true);
  await page.waitForTimeout(500); // let the mode-enter slide animation settle

  // Switcher is a horizontal strip.
  const switcherBox = await page.$eval('.play-switcher', el => {
    const r = el.getBoundingClientRect();
    return { h: r.height, w: r.width };
  });
  check('phone: switcher is a slim horizontal strip', switcherBox.h < 80, JSON.stringify(switcherBox));

  // Play mode is full-screen on phones: the bottom tab bar is hidden and
  // the sheet panel runs to the bottom of the viewport.
  const fullscreen = await page.evaluate(() => {
    const tabbar = document.querySelector('.mobile-tabbar');
    const panel = document.querySelector('.play-panel[data-panel="sheets"]');
    return {
      tbHidden: !tabbar || getComputedStyle(tabbar).display === 'none',
      panelBottom: panel ? Math.round(panel.getBoundingClientRect().bottom) : -1,
      vh: window.innerHeight,
    };
  });
  check('phone: tab bar hidden in play mode', fullscreen.tbHidden);
  check('phone: sheet panel uses the full viewport',
    Math.abs(fullscreen.panelBottom - fullscreen.vh) <= 3, JSON.stringify(fullscreen));

  // Swipe left → next sheet.
  const before = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  await page.evaluate(() => {
    const panel = document.querySelector('.play-panel[data-panel="sheets"]');
    const card = panel.querySelector('.play-sheet:not([hidden]) .unit-detail-content');
    function touchEv(type, x, y) {
      const t = new Touch({ identifier: 1, target: card, clientX: x, clientY: y });
      return new TouchEvent(type, { changedTouches: [t], bubbles: true, cancelable: true });
    }
    card.dispatchEvent(touchEv('touchstart', 300, 400));
    card.dispatchEvent(touchEv('touchend', 120, 410));
  });
  await page.waitForTimeout(200);
  const after = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  const bi = seed.entryIds.indexOf(before), ai = seed.entryIds.indexOf(after);
  check('phone: swipe left advances to next sheet', ai === bi + 1, `${before} -> ${after}`);

  // Tabs reachable + strats render on phone.
  await page.click('.play-tab[data-tab="strats"]');
  const stratCard = await page.waitForSelector('.play-panel[data-panel="strats"] .play-strat-row', { timeout: 5000 }).catch(() => null);
  check('phone: stratagems tab renders', !!stratCard);

  await page.screenshot({ path: `${OUT}/phone-final.png`, fullPage: false });

  // Hardware Back returns to Build (mobile back-trap), entering through the
  // drawer row so the drawer-close rewind and the mode trap's push are both
  // in the history this Back press walks. A marker on window proves Back
  // stayed in the same document: #106's symptom was the rewind overshooting
  // the yaab entry and reloading the whole app.
  await page.evaluate(() => App.setMode('build'));
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__e2eDoc = 'same-document'; App.settingsDrawer.open(); });
  await page.click('#set-action-go-play');
  // The Strats tab is still active from above, which hides the chip
  // switcher — wait on the header's Exit button, present on every tab.
  await page.waitForSelector('#play-mode:not([hidden]) .play-exit', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(600);
  const afterBack = await page.evaluate(() => ({
    mode: window.App && App.getMode && App.getMode(),
    doc: window.__e2eDoc,
  })).catch(() => ({}));
  check('phone: Back from drawer-entered Play returns to build', afterBack.mode === 'build', JSON.stringify(afterBack));
  check('phone: Back stayed in the same document (no reload)', afterBack.doc === 'same-document', JSON.stringify(afterBack));
  const tabbarBack = await page.evaluate(() => {
    const t = document.querySelector('.mobile-tabbar');
    return !!t && getComputedStyle(t).display !== 'none';
  });
  check('phone: tab bar returns after leaving play', tabbarBack === true);

  // The Exit button works on the phone too.
  await page.evaluate(() => App.openPlayMode());
  await page.waitForTimeout(400);
  await page.click('.play-exit');
  await page.waitForTimeout(300);
  const afterExit = await page.evaluate(() => ({
    mode: App.getMode(),
    tabbar: (() => { const t = document.querySelector('.mobile-tabbar'); return !!t && getComputedStyle(t).display !== 'none'; })(),
  }));
  check('phone: Exit button returns to build + restores tab bar',
    afterExit.mode === 'build' && afterExit.tabbar, JSON.stringify(afterExit));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? ':\n  - ' + fails.join('\n  - ') : ''}`);
process.exit(fail ? 1 : 0);
