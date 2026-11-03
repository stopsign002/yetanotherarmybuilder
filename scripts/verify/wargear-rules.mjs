// scripts/verify/wargear-rules.mjs — the Wargear picker enforces the datasheet
// rules (contract docs/WARGEAR-RULES.md §3). Signed in, desktop width.
//
//   set -a; . ~/sites/base/yaab-fixture.env; set +a
//   BROWSE_ENV="FIXTURE_USER FIXTURE_PASS" ~/sites/base/browser/browse.sh run \
//     scripts/verify/wargear-rules.mjs <outdir>
//
// Plague Marines run against FIXTURE below (written from the GDC prose + the
// §3 table) injected onto the live unit object, so the test does not wait on
// a dataset that carries `wargearProfile.rules`. The live `options[]` are kept
// beside it so the migration check has old option ids to map from. Intercessor
// Squad, Necron Warriors and the Leman Russ run on the LIVE profile as it is
// today — with `rules` that is the parsed data, without it the legacy adapter.
// Set NO_FIXTURE=1 once the dataset carries rules to run Plague Marines live.
//
// Every "+" is pressed through the real button until it is disabled. Writes
// only the fixture account's current army, emptied at the start and the end.
// No page.waitForFunction (CSP) — waitForSelector and page.evaluate only.
import { launch, newPage, boot, wire, makeChecker, OUT } from './_lib.mjs';

const I = (id, name) => ({ id, name });
const BG = I('boltgun', 'Boltgun'), PK = I('plague-knives-plague-marines', 'Plague knives');
const R = (n, o) => Object.assign({
  id: 'plague-marines-wr-' + n, text: '', kind: 'replace', model: 'Plague Marine',
  scope: 'per_n', n: 5, max: 1, replaces: [BG], choices: [], requires: [], locks: [],
  exclusiveWith: [], condition: null,
}, o);
const FIXTURE_RULES = [
  R(1, { text: 'One Plague Marine equipped with a boltgun can be equipped with 1 icon of despair. This model’s boltgun cannot be replaced.',
    kind: 'add', scope: 'fixed', n: null, max: 1, replaces: [], choices: [[I('icon-of-despair-aura', 'Icon of despair')]], requires: [BG], locks: [BG] }),
  R(2, { text: 'For every 5 models in this unit, up to 2 Plague Marines can each have their boltgun replaced with 1 heavy plague weapon.',
    max: 2, choices: [[I('heavy-plague-weapon', 'Heavy plague weapon')]] }),
  R(3, { text: 'For every 5 models in this unit, up to 2 Plague Marines can each have their boltgun replaced with 1 bubotic weapons.',
    max: 2, choices: [[I('bubotic-weapons', 'Bubotic weapons')]] }),
  R(4, { text: 'For every 5 models in this unit, 1 Plague Marine’s boltgun can be replaced with one of the following: ◦ 1 meltagun ◦ 1 plague belcher ◦ 1 plasma gun',
    choices: [[I('meltagun', 'Meltagun')], [I('plague-belcher', 'Plague belcher')], [I('plasma-gun', 'Plasma gun')]] }),
  R(5, { text: 'For every 5 models in this unit, 1 Plague Marine’s boltgun can be replaced with 1 plague spewer.',
    choices: [[I('plague-spewer', 'Plague spewer')]] }),
  R(6, { text: 'For every 5 models in this unit, 1 Plague Marine’s boltgun can be replaced with 1 blight launcher.',
    choices: [[I('blight-launcher', 'Blight launcher')]] }),
  R(7, { text: 'The Plague Champion’s plague knives can be replaced with one of the following: ◦ 1 bubotic weapons ◦ 1 power fist',
    model: 'Plague Champion', scope: 'fixed', n: null, max: null, replaces: [PK],
    choices: [[I('bubotic-weapons', 'Bubotic weapons')], [I('power-fist', 'Power fist')]] }),
  R(8, { text: 'The Plague Champion’s boltgun can be replaced with one of the following: ◦ 1 bolt pistol ◦ 1 plasma gun ◦ 1 plasma pistol',
    model: 'Plague Champion', scope: 'fixed', n: null, max: null,
    choices: [[I('bolt-pistol', 'Bolt pistol')], [I('plasma-gun', 'Plasma gun')], [I('plasma-pistol-plague-marines', 'Plasma pistol')]] }),
];

const { check, summary } = makeChecker({ strict: true });
const browser = await launch();
const { page } = await newPage(browser);
const errors = wire(page, '', { responses: false });

if (!(await boot(page))) { console.log('FAIL boot'); await browser.close(); process.exit(1); }

// ── page helpers ───────────────────────────────────────────────────────────
async function emptyArmy() {
  return page.evaluate(() => {
    const s = App.state, a = s && s.currentArmy;
    if (!a) return -1;
    while (a.entries.length) a.removeEntry(a.entries.length - 1);
    a.updatedAt = new Date().toISOString();
    if (s.armyManager) s.armyManager.saveArmy(a);
    if (window.UI && UI.renderArmyList) UI.renderArmyList(a);
    return a.entries.length;
  });
}

// Open a unit's details pane (optionally with the fixture rules injected).
async function openUnit(name, fixture) {
  const ok = await page.evaluate(({ name, fixture }) => {
    const u = (App.state.allUnits || []).find((x) => x && x.name === name && x.wargearProfile);
    if (!u) return false;
    if (fixture) {
      // Keep options[] beside rules: the migration check maps from them.
      u.wargearProfile = Object.assign({}, u.wargearProfile, { rules: fixture, unparsed: [] });
    }
    if (App.getMode && App.setMode && App.getMode() !== 'build') App.setMode('build');
    App.state.selectedUnit = u;
    App.state.selectedArmyEntryIndex = null;
    UI.renderUnitDetail(u, App.getActiveEnhancements ? App.getActiveEnhancements() : [], []);
    return true;
  }, { name, fixture: fixture || null });
  if (!ok) return false;
  await page.waitForSelector('#detail-wargear-picker .wgp-row', { timeout: 15000 });
  return true;
}

async function setSize(models) {
  for (let i = 0; i < 6; i++) {
    const cur = await page.evaluate(() => {
      const u = App.state.selectedUnit, el = document.getElementById('detail-squad-select');
      const o = u.squadOptions[el ? parseInt(el.value, 10) : 0];
      return o ? o.models : null;
    });
    if (cur === models) return true;
    await page.click(cur < models ? '#detail-size-plus' : '#detail-size-minus');
    await page.waitForTimeout(80);
  }
  return false;
}

// Row = exact label + a chip containing `chip`. Returns its nth index.
async function rowIndex(label, chip) {
  return page.evaluate(({ label, chip }) => {
    const rows = Array.from(document.querySelectorAll('#detail-wargear-picker .wgp-row'));
    return rows.findIndex((r) => {
      const item = r.querySelector('.wgp-item');
      const first = item && item.firstChild ? item.firstChild.textContent.trim() : '';
      const c = r.querySelector('.wgp-chip');
      return first === label && (!chip || (c && c.textContent.includes(chip)));
    });
  }, { label, chip: chip || '' });
}
const rowLoc = (i) => page.locator('#detail-wargear-picker .wgp-row').nth(i);

async function rowState(label, chip) {
  const i = await rowIndex(label, chip);
  if (i < 0) return null;
  const r = rowLoc(i);
  const plus = r.locator('.wgp-plus');
  return {
    count: parseInt(await r.locator('.wgp-count').textContent(), 10),
    plusDisabled: (await plus.count()) ? await plus.isDisabled() : null,
    title: (await plus.count()) ? (await plus.getAttribute('title')) || '' : '',
  };
}

// Press "+" until it disables (or `limit` presses). Returns the final state.
async function fill(label, chip, limit = 25) {
  for (let n = 0; n < limit; n++) {
    const i = await rowIndex(label, chip);
    if (i < 0) return null;
    const plus = rowLoc(i).locator('.wgp-plus');
    if (await plus.isDisabled()) break;
    await plus.click();
  }
  return rowState(label, chip);
}
async function press(label, chip, minus) {
  const i = await rowIndex(label, chip);
  if (i < 0) return false;
  await rowLoc(i).locator(minus ? '.wgp-minus' : '.wgp-plus').click();
  return true;
}
async function zero() {
  for (let n = 0; n < 80; n++) {
    const m = page.locator('#detail-wargear-picker .wgp-minus:not([disabled])');
    if (!(await m.count())) return true;
    await m.first().click();
  }
  return false;
}
const defaultCount = (label) => page.evaluate((label) => {
  const r = Array.from(document.querySelectorAll('#detail-wargear-picker .wgp-row-default'))
    .find((x) => x.querySelector('.wgp-item').firstChild.textContent.trim() === label);
  return r ? parseInt(r.querySelector('.wgp-count').textContent, 10) : null;
}, label);

const capCheck = async (tag, label, chip, want, why) => {
  const s = await fill(label, chip);
  check(`${tag}: ${label}${chip ? ' (' + chip + ')' : ''} stops at ${want}`,
    s && s.count === want && s.plusDisabled && (!why || why.test(s.title)), s ? `${s.count}, "${s.title}"` : 'row missing');
};
const blocked = async (tag, label, chip, why) => {
  const s = await rowState(label, chip);
  check(`${tag}: ${label}${chip ? ' (' + chip + ')' : ''} + disabled`,
    s && s.count === 0 && s.plusDisabled && (!why || why.test(s.title)), s ? `${s.count}, "${s.title}"` : 'row missing');
};

// ── start clean ────────────────────────────────────────────────────────────
check('army emptied at start', (await emptyArmy()) === 0);

// ── Plague Marines, 10 models ──────────────────────────────────────────────
const fixture = process.env.NO_FIXTURE ? null : FIXTURE_RULES;
check('Plague Marines detail opens', await openUnit('Plague Marines', fixture));
check('size 10', await setSize(10));
const PM = 'Plague Marine ·', CH = 'Plague Champion';

await capCheck('PM10', 'Plasma gun', CH, 1, /Plague Champion/);
await blocked('PM10', 'Plasma pistol', CH, /Plague Champion|one of these/);
await blocked('PM10', 'Bolt pistol', CH);
await capCheck('PM10', 'Power fist', CH, 1);
await blocked('PM10', 'Bubotic weapons', CH);
await capCheck('PM10', 'Icon of despair', PM, 1);
await capCheck('PM10', 'Heavy plague weapon', PM, 4, /2 per 5/);
await capCheck('PM10', 'Bubotic weapons', PM, 4, /2 per 5/);
await zero();
// Meltagun / plague belcher / plasma gun are ONE rule: 1 per 5 → 2 across the set.
await capCheck('PM10', 'Meltagun', PM, 2, /1 per 5/);
await blocked('PM10 2 meltaguns', 'Plague belcher', PM, /1 per 5/);
await press('Meltagun', PM, true);
await capCheck('PM10 1 meltagun', 'Plague belcher', PM, 1, /1 per 5/);
await blocked('PM10 meltagun+belcher', 'Plasma gun', PM, /1 per 5/);
await capCheck('PM10', 'Plague spewer', PM, 2, /1 per 5/);
await capCheck('PM10', 'Blight launcher', PM, 2, /1 per 5/);
await zero();
// All Plague Marine boltgun swaps + the icon share the 9 Plague Marines.
await fill('Icon of despair', PM); await fill('Heavy plague weapon', PM); await fill('Bubotic weapons', PM);
await blocked('PM10 icon+4+4', 'Plague spewer', PM, /No Plague Marine still carries a boltgun/);
await blocked('PM10 icon+4+4', 'Meltagun', PM, /boltgun/);
check('PM10 icon+4+4: default Boltgun row shows 2 left', (await defaultCount('Boltgun')) === 2, await defaultCount('Boltgun'));
await press('Heavy plague weapon', PM, true);
const sp = await rowState('Plague spewer', PM);
check('PM10: freeing one boltgun re-enables Plague spewer', sp && !sp.plusDisabled, sp && sp.title);
const minusOk = await page.evaluate(() => Array.from(document.querySelectorAll('#detail-wargear-picker .wgp-stepper'))
  .every((st) => { const c = parseInt(st.querySelector('.wgp-count').textContent, 10); const m = st.querySelector('.wgp-minus'); return !m || c === 0 || !m.disabled; }));
check('"−" never disabled above 0', minusOk);
await page.screenshot({ path: `${OUT}/wargear-pm10.png`, fullPage: false });
const panelShot = page.locator('#detail-wargear-picker');
if (await panelShot.count()) await panelShot.screenshot({ path: `${OUT}/wargear-pm10-picker.png` }).catch(() => {});

// ── shrink to 7: the pending loadout is re-fitted, per-5 caps drop to 1 ───
await zero();
await fill('Heavy plague weapon', PM);
check('size 7', await setSize(7));
const hv = await rowState('Heavy plague weapon', PM);
check('PM10→7: 4 heavy plague weapons re-fitted to 2', hv && hv.count === 2 && hv.plusDisabled, hv && `${hv.count}, "${hv.title}"`);
await zero();
await capCheck('PM7', 'Heavy plague weapon', PM, 2, /2 at 7/);
await capCheck('PM7', 'Bubotic weapons', PM, 2);
await zero();
await capCheck('PM7', 'Meltagun', PM, 1, /1 at 7/);
await blocked('PM7', 'Plague belcher', PM);
await capCheck('PM7', 'Plague spewer', PM, 1);
await capCheck('PM7', 'Blight launcher', PM, 1);
await capCheck('PM7', 'Icon of despair', PM, 1);
await zero();

// ── add to army: saved rows carry rule ids ─────────────────────────────────
await setSize(10);
await press('Icon of despair', PM); await press('Heavy plague weapon', PM); await press('Heavy plague weapon', PM);
await press('Plasma gun', CH);
await page.click('#btn-detail-add');
await page.waitForTimeout(300);
const added = await page.evaluate(() => {
  const e = App.state.currentArmy.entries.find((x) => x.unitName === 'Plague Marines');
  return e ? e.wargear.map((w) => `${w.optionId}:${w.choice}x${w.count}`).sort().join(' ') : null;
});
const wantAdded = fixture
  ? 'plague-marines-wr-1:0x1 plague-marines-wr-2:0x2 plague-marines-wr-8:1x1' : null;
check('Add to Army snapshots the loadout by rule id', wantAdded ? added === wantAdded : !!added, added);

// ── migration of rows saved against the old 40kdc option ids ──────────────
if (fixture) {
  const mig = await page.evaluate(() => {
    const s = App.state, a = s.currentArmy;
    const u = s.allUnits.find((x) => x.name === 'Plague Marines' && x.wargearProfile);
    const so = u.squadOptions.find((o) => o.models === 10);
    const e = a.addUnit(u, 1, so, [], [
      { optionId: 'plague-marines-wgo-mfm-4', choice: 1, count: 2, items: ['Bubotic weapons'], label: 'Bubotic weapons', pts: 0 },
      { optionId: 'plague-marines-wgo-mfm-1', choice: 0, count: 1, items: ['Plasma gun'], label: 'Plasma gun', pts: 0 },
      { optionId: 'plague-marines-wgo-mfm-6', choice: 0, count: 1, items: ['Icon of Despair (Aura)'], label: 'Icon of Despair (Aura)', pts: 0 },
      { optionId: 'plague-marines-wgo-mfm-2', choice: 0, count: 1, items: ['Power fist'], label: 'Power fist', pts: 0 },
      { optionId: 'not-a-real-option', choice: 0, count: 1, items: ['Lascannon'], label: 'Lascannon', pts: 0 },
    ]);
    App.rehydrateEntryUnitData();
    return e.wargear.map((w) => `${w.optionId}:${w.choice}x${w.count}`).join(' ');
  });
  check('migration: old option rows re-pointed to rules, unmatched row kept',
    mig === 'plague-marines-wr-3:0x2 plague-marines-wr-8:1x1 plague-marines-wr-1:0x1 plague-marines-wr-7:1x1 not-a-real-option:0x1', mig);
}

// ── legacy profiles (live dataset: options[] or rules, whichever it has) ──
check('Intercessor Squad opens', await openUnit('Intercessor Squad'));
await setSize(10);
const live = await page.evaluate(() => !!(App.state.selectedUnit.wargearProfile || {}).rules);
console.log(`(live dataset ${live ? 'carries rules' : 'has options[] only — legacy adapter'})`);
await capCheck('Intercessors10', 'Astartes grenade launcher', '', 2, /1 per 5/);
const sgt = live ? 'Intercessor Sergeant' : 'Intercessor Sergeant';
await capCheck('Intercessors10', 'Hand Flamer', sgt, 1);
await blocked('Intercessors10', 'Plasma pistol', sgt);
await capCheck('Intercessors10', 'Thunder hammer', sgt, 1);   // the other weapon: both swaps on one Sergeant
await blocked('Intercessors10', 'Power Fist', sgt);
await zero();
await setSize(5);
await capCheck('Intercessors5', 'Astartes grenade launcher', '', 1, /1 at 5/);
await zero();

check('Necron Warriors opens', await openUnit('Necron Warriors'));
await setSize(10);
await capCheck('Warriors10', 'Gauss reaper', '', 10);
await zero();

check('Leman Russ Battle Tank opens', await openUnit('Leman Russ Battle Tank'));
await capCheck('Russ', 'Hunter-killer missile', '', 1);
await capCheck('Russ', 'Heavy bolter + Heavy bolter', '', 1);
await blocked('Russ', 'Heavy flamer + Heavy flamer', '');
await capCheck('Russ', 'Storm bolter', '', 1);
await blocked('Russ', 'Heavy stubber', '');
const russAdds = await rowState('Hunter-killer missile', '');
check('Russ: add-ons stack (missile kept with sponsons + pintle)', russAdds && russAdds.count === 1, russAdds && russAdds.count);
await capCheck('Russ', 'Heavy flamer', '', 1);   // lascannon → heavy flamer
await blocked('Russ', 'Heavy bolter', '');
check('Russ: lascannon row reads 0 after the swap', (await defaultCount('Lascannon')) === 0, await defaultCount('Lascannon'));
await zero();

// ── clean up ───────────────────────────────────────────────────────────────
check('army emptied at end', (await emptyArmy()) === 0);
await page.waitForTimeout(1500);   // let autosave / sync push the empty army
check('no page errors', errors.length === 0, errors.join(' | '));
const fails = summary({ list: true });
await browser.close();
process.exit(fails ? 1 : 0);
