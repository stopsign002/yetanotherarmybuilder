// play-e2e.mjs — end-to-end check of yaab's new Play mode.
// Run: ~/sites/base/browser/browse.sh run play-e2e.mjs <outdir>
//
// READ-ONLY server-wise: everything it creates lives in the browser's own
// localStorage (a throwaway context), signed out, so sync never fires.
// No waitForFunction anywhere — yaab's CSP has no 'unsafe-eval'.
import { chromium } from 'playwright';

const OUT = process.env.OUT || '/out';
const BASE = 'https://yaab.thewheeliebois.com';

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
    name: (el.querySelector('.detail-name') || {}).textContent || '',
    weapons: !!el.querySelector('.detail-weapons-section'),
    addBtn: !!el.querySelector('#btn-detail-add, .detail-add-btn'),
    enhCheckbox: !!el.querySelector('.enhancement-cb'),
  }));
  check('desktop: visible sheet is the Details-pane datasheet', sheetHasContent.detail && sheetHasContent.stats, sheetHasContent.name);
  check('desktop: sheet has weapon tables', sheetHasContent.weapons);
  check('desktop: no Add-to-Army / enhancement checkboxes on sheet',
    !sheetHasContent.addBtn && !sheetHasContent.enhCheckbox);

  // No points anywhere in play mode: no banner points stack, no ordinal
  // pricing box, no "pts" in the header or the unit chips.
  const noPts = await page.evaluate(() => {
    const root = document.querySelector('#play-mode');
    return {
      stack: !!root.querySelector('.detail-pts-stack'),
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
    ['strats', '.play-panel[data-panel="strats"] .dcc-card-strat'],
    ['rules', '.play-panel[data-panel="rules"] .dcc-card-rule'],
    ['enhance', '.play-panel[data-panel="enhance"] .dcc-card'],
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
      hasBold: !!panel.querySelector('strong'),
      cards: panel.querySelectorAll('.dcc-card-strat').length,
    };
  });
  check('desktop: stratagem cards rendered', strat.cards > 5, strat.cards + ' cards');
  check('desktop: detachment stratagem group header present',
    strat.heads.some(h => h.includes(seed.dets[0])), JSON.stringify(strat.heads));
  check('desktop: core stratagems present', !!strat.hasCore);
  check('desktop: **bold** converted to <strong>', strat.hasBold);

  // Rules tab: army rules group + faction army rule name.
  const rules = await page.evaluate(() => {
    const panel = document.querySelector('.play-panel[data-panel="rules"]');
    return {
      heads: [...panel.querySelectorAll('.play-group-head')].map(h => h.textContent),
      cards: panel.querySelectorAll('.dcc-card-rule').length,
    };
  });
  check('desktop: rules tab has Army rules group', rules.heads.some(h => /army rules/i.test(h)));
  check('desktop: rules cards rendered', rules.cards >= 1, rules.cards + ' cards');

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

  // Tracking: CP, wounds, dead.
  await page.click('.play-cp-btn[data-cp="1"]');
  await page.click('.play-cp-btn[data-cp="1"]');
  const cpText = await page.$eval('.play-cp-val', el => el.textContent);
  check('desktop: CP counter increments', cpText.trim() === '2 CP', cpText);

  const visSheet = await page.$eval('.play-sheet:not([hidden])', el => el.dataset.entryId);
  const hasWounds = await page.$(`.play-sheet[data-entry-id="${visSheet}"] .play-w-btn[data-w="-1"]`);
  if (hasWounds) {
    await hasWounds.click();
    await page.waitForTimeout(250);
    const badge = await page.$eval(`.play-unit-chip[data-entry-id="${visSheet}"] .play-chip-w`,
      el => ({ hidden: el.hidden, text: el.textContent }));
    check('desktop: wound loss shows chip badge', !badge.hidden && /\d+\/\d+/.test(badge.text), badge.text);
  } else {
    check('desktop: wound stepper present on sheet', false, 'no stepper for ' + visSheet);
  }
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

  // The drawer row must exist (the real mobile path) — but ENTER directly:
  // clicking the row hits the pre-existing drawer/backTrap history race
  // (issue #73) which poisons every later history assertion in this context.
  await page.evaluate(() => App.settingsDrawer.open());
  const row = await page.waitForSelector('#set-action-go-play', { timeout: 5000 }).catch(() => null);
  check('phone: drawer Play row exists', !!row);
  await page.evaluate(() => App.settingsDrawer.close());
  await page.waitForTimeout(300);
  await page.evaluate(() => App.openPlayMode());
  await page.waitForSelector('#play-mode:not([hidden]) .play-unit-chip', { timeout: 10000 });
  check('phone: play mode opens', true);
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
    const card = panel.querySelector('.play-sheet:not([hidden]) .detail-header');
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
  const stratCard = await page.waitForSelector('.play-panel[data-panel="strats"] .dcc-card-strat', { timeout: 5000 }).catch(() => null);
  check('phone: stratagems tab renders', !!stratCard);

  await page.screenshot({ path: `${OUT}/phone-final.png`, fullPage: false });

  // Hardware Back returns to Build (mobile back-trap). Enter play DIRECTLY —
  // entering via the settings drawer hits a pre-existing history race
  // (drawer close's history.go(-1) vs the mode trap's pushState) that also
  // breaks Back after drawer->Collect; filed separately.
  await page.evaluate(() => App.setMode('build'));
  await page.waitForTimeout(400);
  await page.evaluate(() => App.openPlayMode());
  await page.waitForTimeout(400);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(600);
  const modeAfterBack = await page.evaluate(() => window.App && App.getMode && App.getMode()).catch(() => null);
  check('phone: Back button returns to build', modeAfterBack === 'build', String(modeAfterBack));
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
