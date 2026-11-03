// scripts/verify/wargear-rules.mjs — the Wargear inventory (contract
// docs/WARGEAR-RULES.md §5 "Inventory v2"): every row has − N +, nothing is
// ever disabled, the datasheet rules are WARNINGS. Signed in, desktop width.
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
// Every stepper is pressed through the real button. Writes only the fixture
// account's current army, emptied at the start and the end.
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

async function openUnit(name, fixture) {
  const ok = await page.evaluate(({ name, fixture }) => {
    const u = (App.state.allUnits || []).find((x) => x && x.name === name && x.wargearProfile);
    if (!u) return false;
    if (fixture) u.wargearProfile = Object.assign({}, u.wargearProfile, { rules: fixture, unparsed: [] });
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
// Open an army entry's pane the way an army-list click does (entry-bound).
async function openEntry(idx) {
  await page.evaluate((idx) => {
    const s = App.state, e = s.currentArmy.entries[idx];
    s.selectedUnit = e.unitData;
    s.selectedArmyEntryIndex = idx;
    UI.renderUnitDetail(e.unitData, App.getActiveEnhancements ? App.getActiveEnhancements() : [], e.enhancements || []);
  }, idx);
  await page.waitForSelector('#detail-wargear-picker .wgp-row', { timeout: 15000 });
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

// Row by exact label (+ optional chip text). Returns its index or -1.
async function rowIndex(label, chip) {
  return page.evaluate(({ label, chip }) => {
    const rows = Array.from(document.querySelectorAll('#detail-wargear-picker .wgp-row'));
    return rows.findIndex((r) => {
      const item = r.querySelector('.wgp-item');
      const first = item && item.firstChild ? item.firstChild.textContent.trim() : '';
      const c = r.querySelector('.wgp-chip');
      return first.toLowerCase() === label.toLowerCase() && (!chip || (c && c.textContent.includes(chip)));
    });
  }, { label, chip: chip || '' });
}
const rowLoc = (i) => page.locator('#detail-wargear-picker .wgp-row').nth(i);
async function count(label, chip) {
  const i = await rowIndex(label, chip);
  return i < 0 ? null : parseInt(await rowLoc(i).locator('.wgp-count').textContent(), 10);
}
async function press(label, n, minus, chip) {
  for (let k = 0; k < n; k++) {
    const i = await rowIndex(label, chip);
    if (i < 0) return false;
    await rowLoc(i).locator(minus ? '.wgp-minus' : '.wgp-plus').click();
  }
  return true;
}
const setCount = async (label, want, chip) => {
  const c = await count(label, chip);
  if (c == null) return false;
  return press(label, Math.abs(want - c), want < c, chip);
};
const warnText = () => page.evaluate(() => {
  const w = document.querySelector('#detail-wargear-picker .wgp-warnings');
  return w ? w.textContent.replace(/\s+/g, ' ').trim() : '';
});
const anyDisabled = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#detail-wargear-picker .wgp-btn')).filter((b) => b.disabled).length);
// No eval in the page (CSP): select the entry by datasheet name.
const loadoutOf = (unitName) => page.evaluate((unitName) => {
  const e = App.state.currentArmy.entries.find((x) => x.unitName === unitName);
  if (!e) return null;
  return { lo: (e.loadout || []).map((x) => `${x.name}:${x.count}`).sort().join(' '), wargear: (e.wargear || []).length, idx: App.state.currentArmy.entries.indexOf(e) };
}, unitName);

check('army emptied at start', (await emptyArmy()) === 0);

// ── 1. Necron Warriors: slot warning, never disabled, size reset ──────────
check('Necron Warriors opens', await openUnit('Necron Warriors'));
check('Warriors size 10', await setSize(10));
check('Warriors: defaults have steppers (Gauss flayer 10)', (await count('Gauss flayer')) === 10);
check('Warriors: no warnings on the default loadout', (await warnText()) === '', await warnText());
await press('Gauss reaper', 3);
let w = await warnText();
check('Warriors: 3 reapers, flayers untouched → slot warning', /Gauss flayer: 13 weapons for 10 models/.test(w), w);
check('steppers never disabled (over the limit)', (await anyDisabled()) === 0);
await press('Gauss flayer', 3, true);
check('Warriors: flayers lowered to 7 → warning clears', (await warnText()) === '', await warnText());
await press('Gauss reaper', 30);
check('Warriors: "+" keeps going past every limit (33 reapers)', (await count('Gauss reaper')) === 33 && (await anyDisabled()) === 0, await count('Gauss reaper'));
check('Warriors: over-cap reapers warn', /Gauss reaper: 33 taken, the datasheet allows up to 10/.test(await warnText()), await warnText());
await setSize(20);
check('Warriors 10→20 (unsaved pick) resets to defaults', (await count('Gauss flayer')) === 20 && (await count('Gauss reaper')) === 0,
  `${await count('Gauss flayer')} / ${await count('Gauss reaper')}`);
await setSize(10);
await setCount('Gauss flayer', 7); await setCount('Gauss reaper', 3);
await page.click('#btn-detail-add');
await page.waitForTimeout(300);
let nw = await loadoutOf('Necron Warriors');
check('Add to Army saves loadout (and no wargear rows)',
  nw && nw.lo === 'Close combat weapon:10 Gauss flayer:7 Gauss reaper:3' && nw.wargear === 0, nw && JSON.stringify(nw));

// Army-list badge: gains only.
const badges = await page.evaluate(() => Array.from(document.querySelectorAll('#army-entry-list .army-entry'))
  .filter((li) => /Necron Warriors/.test(li.textContent))
  .map((li) => Array.from(li.querySelectorAll('.army-wg-badge')).map((b) => b.textContent.trim()).join(' | ')));
check('army badge shows only the gain ("3× Gauss reaper")', badges.length && badges[0] === '3× Gauss reaper', JSON.stringify(badges));

// Entry-bound edit writes back and keeps counts across a size change.
await openEntry(nw.idx);
check('entry pane shows the saved counts', (await count('Gauss reaper')) === 3 && (await count('Gauss flayer')) === 7);
await press('Gauss reaper', 1);
nw = await loadoutOf('Necron Warriors');
check('entry pane "+" writes entry.loadout', nw && /Gauss reaper:4/.test(nw.lo), nw && nw.lo);
const warnBadge = await page.evaluate(() => Array.from(document.querySelectorAll('#army-entry-list .army-entry'))
  .filter((li) => /Necron Warriors/.test(li.textContent))
  .map((li) => { const b = li.querySelector('.army-wg-warn'); return b ? b.textContent.trim() + ' — ' + b.title : ''; })[0] || '');
check('army entry gets a ⚠ wargear badge when the loadout warns', /wargear/.test(warnBadge) && /Gauss flayer/.test(warnBadge), warnBadge);
await press('Gauss reaper', 1, true);

// TTS allocation of the inventory (pure buildRegistry, nothing is sent).
const tts = await page.evaluate(() => {
  const a = App.state.currentArmy;
  const e = a.entries.find((x) => x.unitName === 'Necron Warriors');
  const reg = App.TtsExport.buildRegistry({ name: 'v', factionName: a.factionName, entries: [e] }, {});
  const out = [];
  const walk = (o) => { if (o && typeof o === 'object') { if (o.classification === 'Model') out.push(o); Object.values(o).forEach(walk); } };
  walk(reg);
  return out.map((m) => `${m.quantity}:${m.assets.traits.map((t) => t.designation).filter((d) => /gauss/i.test(d)).join('+')}`).sort().join(' ');
});
check('TTS export allocates 7 flayers + 3 reapers over 10 Warriors', tts === '3:Gauss reaper 7:Gauss flayer', tts);

// ── 2. Plague Marines (fixture rules): cap + requires warnings ────────────
const fixture = process.env.NO_FIXTURE ? null : FIXTURE_RULES;
check('Plague Marines opens', await openUnit('Plague Marines', fixture));
check('PM size 10', await setSize(10));
await press('Heavy plague weapon', 5);
w = await warnText();
check('PM10: 5 heavies → cap warning', /Heavy plague weapon: 5 taken, the datasheet allows up to 4 \(up to 2 per 5 models\)/.test(w), w);
await press('Heavy plague weapon', 1, true);
w = await warnText();
check('PM10: 4 heavies → no cap warning', !/Heavy plague weapon: \d+ taken/.test(w), w);
await setCount('Boltgun', 6);
check('PM10: 4 heavies with boltguns lowered to 6 → clean', (await warnText()) === '', await warnText());
await setCount('Heavy plague weapon', 0); await setCount('Boltgun', 0); await press('Icon of despair', 1);
w = await warnText();
check('PM10: icon 1 with boltgun 0 → requires warning', /Icon of despair needs a model that still carries a boltgun/i.test(w), w);
check('steppers never disabled (PM)', (await anyDisabled()) === 0);
await page.screenshot({ path: `${OUT}/wargear-pm10.png`, fullPage: false });
const panel = page.locator('#detail-wargear-picker');
if (await panel.count()) await panel.screenshot({ path: `${OUT}/wargear-pm10-picker.png` }).catch(() => {});

// Old-format entries migrate to the same loadout as the picker would build.
const mig = await page.evaluate((fx) => {
  const s = App.state, a = s.currentArmy;
  const nwU = s.allUnits.find((x) => x.name === 'Necron Warriors' && x.wargearProfile);
  const pmU = s.allUnits.find((x) => x.name === 'Plague Marines' && x.wargearProfile);
  const e1 = a.addUnit(nwU, 1, nwU.squadOptions.find((o) => o.models === 10), [],
    [{ optionId: 'necron-warriors-wgo-mfm-1', choice: 0, count: 3, items: ['Gauss reaper'], label: 'Gauss reaper', pts: 0 }]);
  const rows = [
    { optionId: 'plague-marines-wgo-mfm-4', choice: 2, count: 2, items: ['Heavy plague weapon'], label: 'Heavy plague weapon', pts: 0 },
    { optionId: 'plague-marines-wgo-mfm-1', choice: 0, count: 1, items: ['Plasma gun'], label: 'Plasma gun', pts: 0 },
    { optionId: 'plague-marines-wgo-mfm-6', choice: 0, count: 1, items: ['Icon of Despair (Aura)'], label: 'Icon', pts: 0 },
    { optionId: 'not-a-real-option', choice: 0, count: 1, items: ['Lascannon'], label: 'Lascannon', pts: 0 },
  ];
  const e2 = a.addUnit(pmU, 1, pmU.squadOptions.find((o) => o.models === 10), [], rows);
  const before = [e1.loadout === undefined, e2.loadout === undefined];
  App.rehydrateEntryUnitData();
  const f = (e) => (e.loadout || []).map((x) => `${x.name}:${x.count}`).sort().join(' ');
  return { before, nw: f(e1), pm: f(e2), kept: e2.wargear.length, fx: !!fx };
}, fixture);
check('old entries start without loadout', mig.before[0] && mig.before[1], JSON.stringify(mig.before));
check('old Warriors entry migrates to flayer 7 + reaper 3', mig.nw === 'Close combat weapon:10 Gauss flayer:7 Gauss reaper:3', mig.nw);
check('old Plague Marines entry migrates (defaults − replaced + added, unmatched row still counted)',
  mig.pm === 'Boltgun:7 Heavy plague weapon:2 Icon of despair:1 Lascannon:1 Plague knives:10 Plasma gun:1'
  || (!fixture && /Heavy plague weapon:2/.test(mig.pm)), mig.pm);

// ── 3. points: defaults unchanged, a priced swap adds up ──────────────────
check('Leman Russ opens', await openUnit('Leman Russ Battle Tank'));
const totalNote = () => page.evaluate(() => { const n = document.querySelector('#detail-wargear-picker .wgp-total'); return n ? n.textContent.trim() : ''; });
const base = await page.evaluate(() => { const u = App.state.selectedUnit; return (u.wargearProfile.defaultCostBySize || {})['1'] || 0; });
check('Russ: default loadout costs the old priced base', (await totalNote()) === `Wargear points: +${base} pts` && base > 0, `${await totalNote()} vs base ${base}`);
await press('Multi-melta', 2);
check('Russ: 2 multi-meltas (5 pts each) → +10', (await totalNote()) === `Wargear points: +${base + 10} pts`, await totalNote());
await page.click('#btn-detail-add');
await page.waitForTimeout(300);
const russ = await page.evaluate(() => {
  const a = App.state.currentArmy, i = a.entries.findIndex((x) => x.unitName === 'Leman Russ Battle Tank');
  return { copy: a.getEntryCopyWargearPts(i), total: a.getEntryPoints(i), sel: a.entries[i].selectedPts };
});
check('Russ entry: wargear pts and total agree with the pane', russ.copy === base + 10 && russ.total === russ.sel + base + 10, JSON.stringify(russ));
const defEntry = await page.evaluate(() => {
  const s = App.state, a = s.currentArmy, u = s.allUnits.find((x) => x.name === 'Leman Russ Battle Tank');
  const e = a.addUnit(u, 1, u.squadOptions[0], [], []);   // double-click path: no loadout stored
  const i = a.entries.indexOf(e);
  return { copy: a.getEntryCopyWargearPts(i), base: a.getEntryWargearBasePts(i), lo: e.loadout === undefined };
});
check('a default entry bills exactly the old base', defEntry.copy === defEntry.base && defEntry.base === base, JSON.stringify(defEntry));

// ── clean up ───────────────────────────────────────────────────────────────
check('army emptied at end', (await emptyArmy()) === 0);
await page.waitForTimeout(1500);
check('no page errors', errors.length === 0, errors.join(' | '));
const fails = summary({ list: true });
await browser.close();
process.exit(fails ? 1 : 0);
