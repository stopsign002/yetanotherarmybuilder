// detachment-restore.mjs — a saved army keeps its detachments and enhancements
// when the cloud pull lands BEFORE the game data has loaded (bug #37).
//
// WRITES TO THE LIVE DATABASE as the fixture account. Run SERIALLY. The one
// army it creates is named `zz_test detrestore …` and deleted at the end
// (locally, via sync, and by a direct DELETE as a backstop).
//
//   set -a; . ~/sites/base/yaab-fixture.env; set +a
//   BROWSE_ENV="FIXTURE_USER FIXTURE_PASS" \
//     ~/sites/base/browser/browse.sh run scripts/verify/detachment-restore.mjs <outdir>
//
// Scenarios, each with /data/dataset/* held back DELAY ms so the pull wins:
//   A  same device, reload
//   B  fresh device (empty localStorage), sign in
//   C  the cloud copy is newer and has a different detachment set
import { SITE, OUT, launch, newPage, until, wire, makeChecker, login, boot } from './_lib.mjs';

const DELAY = Number(process.env.DELAY || 4000);
const FACTION = 'Imperium - Grey Knights';
const NAME = 'zz_test detrestore ' + Date.now();

const C = makeChecker({ strict: true });
const { check } = C;
const browser = await launch();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function device(tag) {
  const { ctx, page } = await newPage(browser, { reducedMotion: 'reduce' });
  const errors = wire(page, tag);
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { ctx, page, errors, tag };
}
const slowData = page => page.route('**/data/dataset/**', async r => {
  await new Promise(res => setTimeout(res, DELAY));
  await r.continue().catch(() => {});
});
const synced = (page, id, present) => until(page, async a => {
  if (App.Sync.queueLength() > 0) return false;
  const list = await fetch('/api/armies', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
  return Array.isArray(list) && list.some(x => x.id === a.id) === a.present;
}, { arg: { id, present }, timeout: 30000, step: 500 });

// What the app holds for our army, from every place it is kept.
const snap = (page, id) => page.evaluate(id => {
  const s = App.state, mgr = s.armyManager;
  const stored = mgr.getArmy(id);
  const ls = (JSON.parse(localStorage.getItem('yaab_armies') || '[]')).find(a => a.id === id);
  const enh = a => a ? (a.entries || []).flatMap(e => (e.enhancements || []).map(x => x.name)) : null;
  return {
    currentIsOurs: !!(s.currentArmy && s.currentArmy.id === id),
    current: s.currentArmy ? (s.currentArmy.detachmentNames || []).slice() : null,
    faction: s.currentArmy ? s.currentArmy.factionName : null,
    stored: stored ? stored.detachmentNames.slice() : null,
    local: ls ? (ls.detachmentNames || []) : null,
    selected: (s.selectedDetachments || []).map(d => d.name),
    ticked: Array.from(document.querySelectorAll('#detachments-body .detachment-row-cb:checked')).map(c => c.dataset.name),
    enh: enh(s.currentArmy),
    select: document.getElementById('army-faction-select').value,
  };
}, id);

async function expectArmy(d, id, label, dets, enh) {
  // Let the pull, the boot restore and any autosave all finish.
  await d.page.waitForTimeout(DELAY + 3000);
  const s = await snap(d.page, id);
  check(`${label}: our army is the open one`, s.currentIsOurs);
  check(`${label}: faction kept`, s.faction === FACTION && s.select === FACTION, `${s.faction} / ${s.select}`);
  check(`${label}: army detachments`, same(s.current, dets), JSON.stringify(s.current));
  check(`${label}: picker state + ticked boxes`, same(s.selected, dets) && same(s.ticked.slice().sort(), dets.slice().sort()),
    JSON.stringify(s.selected) + ' ' + JSON.stringify(s.ticked));
  check(`${label}: saved copy (manager + localStorage)`, same(s.stored, dets) && same(s.local, dets),
    JSON.stringify(s.stored) + ' ' + JSON.stringify(s.local));
  check(`${label}: enhancements`, same(s.enh, enh), JSON.stringify(s.enh));
  await d.page.screenshot({ path: `${OUT}/${label.replace(/\W+/g, '-')}.png` }).catch(() => {});
  return s;
}

let id = null;
const d1 = await device('dev1');
try {
  check('boot dev1', await boot(d1.page));

  // ── Fixture: a Grey Knights army, two detachments, one enhancement from the second.
  const made = await d1.page.evaluate(async ({ FACTION, NAME }) => {
    const s = App.state, mgr = s.armyManager;
    const army = mgr.newArmy(FACTION);
    army.name = NAME;
    s.currentArmy = army; mgr.currentArmy = army;
    App.applyImportedSelections(FACTION, null, []);
    const dets = App.getAvailableDetachments().filter(d => (d.enhancements || []).length).slice(0, 2);
    App.setSelectedDetachments(dets.map(d => d.name), { persist: true });
    const fac = s.factions.find(f => f.factionName === FACTION);
    const unit = fac.units.find(u => /character/i.test(JSON.stringify(u.keywords || ''))) || fac.units[0];
    army.addUnit(unit, 1);
    army.setEnhancements(0, [dets[1].enhancements[0]]);
    mgr.saveArmy(army);
    App.renderAll();
    return { id: army.id, dets: army.detachmentNames.slice(), enh: [dets[1].enhancements[0].name] };
  }, { FACTION, NAME });
  id = made.id;
  check('fixture: two detachments + one enhancement', made.dets.length === 2 && made.enh.length === 1,
    JSON.stringify(made));
  check('fixture reached the cloud', !!(await synced(d1.page, id, true)));

  // ── A: same device, reload, data slow.
  await slowData(d1.page);
  check('A: reload boots', await boot(d1.page));
  await expectArmy(d1, id, 'A same device', made.dets, made.enh);

  // ── B: fresh device, sign in, data slow.
  const d2 = await device('dev2');
  await slowData(d2.page);
  check('B: fresh device boots', await boot(d2.page));
  await expectArmy(d2, id, 'B fresh device', made.dets, made.enh);

  // ── C: dev2 drops the second detachment (its enhancement goes with it);
  // dev1 still holds the older two-detachment copy and reloads.
  const one = [made.dets[0]];
  await d2.page.click(`#detachments-body .detachment-row-cb[data-name="${made.dets[1]}"]`);
  const after = await snap(d2.page, id);
  check('C: dev2 untick took effect', same(after.current, one) && same(after.enh, []),
    JSON.stringify(after.current) + ' ' + JSON.stringify(after.enh));
  await d2.page.waitForTimeout(1500);
  check('C: dev2 change pushed', !!(await until(d2.page, () => App.Sync.queueLength() === 0, { timeout: 30000 })));
  check('C: dev1 reload boots', await boot(d1.page));
  await expectArmy(d1, id, 'C cloud newer', one, []);

  check('no page errors', d1.errors.length + d2.errors.length === 0,
    d1.errors.concat(d2.errors).slice(0, 4).join(' | '));
} finally {
  // ── Cleanup, by id, never by name pattern or date.
  if (id) {
    try {
      await d1.page.evaluate(id => {
        const s = App.state, mgr = s.armyManager;
        mgr.deleteArmy(id);
        if (s.currentArmy && s.currentArmy.id === id) { s.currentArmy = mgr.newArmy(); }
      }, id);
      await synced(d1.page, id, false);
    } catch (_) {}
    await login(d1.page);
    await d1.page.request.delete(`${SITE}/api/armies/${encodeURIComponent(id)}`).catch(() => {});
    const left = await d1.page.request.get(`${SITE}/api/armies`).then(r => r.json()).catch(() => null);
    check('cleanup: fixture army gone from the cloud', Array.isArray(left) && !left.some(a => a.id === id));
    const stray = Array.isArray(left) ? left.filter(a => /^zz_test detrestore/.test(a.name || '')).length : '?';
    console.log(`zz_test detrestore armies left on the account: ${stray}`);
  }
  await browser.close();
}
process.exit(C.summary({ list: true }) ? 1 : 0);
