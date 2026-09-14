// ability-text-factions.mjs — does the live yaab show faction-correct text for shared ability ids?
// Regression check for build/README.md "Faction-scoped ability text". Baseline before the
// 2026-09-14 fix: Chaplain showed GSC text, Techmarine showed Grey Knights text, Death Guard
// Deep Strike showed the literal stub "CORE: Deep Strike".
// Run: ~/sites/base/browser/browse.sh run scripts/verify/ability-text-factions.mjs <outdir>   (read-only, signed out)
import { chromium } from 'playwright';
const OUT = process.env.OUT || '/out';
const BASE = 'https://yaab.thewheeliebois.com';
let fails = 0;
const check = (label, ok, detail='') => { console.log(`${ok?'ok  ':'FAIL'}  ${label}${detail?`  [${detail}]`:''}`); if(!ok) fails++; };
async function poll(page, fn, timeout=45000){ const t0=Date.now(); while(Date.now()-t0<timeout){ const v=await page.evaluate(fn).catch(()=>null); if(v) return v; await page.waitForTimeout(250);} return null; }

const CASES = [
  { faction: /Astartes - Space Marines$/, unit: 'Chaplain', ability: 'Spiritual Leader', must: 'ADEPTUS ASTARTES', mustNot: 'GENESTEALER', shot: 'chaplain', phone: true },
  { faction: /Astartes - Blood Angels$/, unit: 'Chaplain', ability: 'Spiritual Leader', must: 'ADEPTUS ASTARTES', mustNot: 'GENESTEALER', shot: 'chaplain-ba', dataSkip: true },  // chapter factions carry no units of their own; the grid shows the SM parent's
  { faction: /Genestealer Cults$/, unit: 'Magus', ability: 'Spiritual Leader', must: 'GENESTEALER CULTS', mustNot: 'ADEPTUS ASTARTES', shot: 'magus' },
  { faction: /Astartes - Space Marines$/, unit: 'Techmarine', ability: 'Blessing of the Omnissiah', must: 'ADEPTUS ASTARTES', mustNot: 'GREY KNIGHTS', shot: 'techmarine' },
  { faction: /Death Guard$/, unit: 'Lord of Contagion', ability: 'Deep Strike', must: 'Reserves', mustNot: 'CORE: Deep Strike', shot: 'dg-deepstrike', paneSkip: true },  // core abilities render as chips, no inline prose
];
const browser = await chromium.launch();
for (const vp of [{w:1280,h:900,tag:'desktop'},{w:390,h:844,tag:'phone'}]) {
  const ctx = await browser.newContext({ viewport:{width:vp.w,height:vp.h} });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e))); page.on('console', m=>{ if(m.type()==='error' && !/401/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  const ready = await poll(page, () => window.App && App.state && App.state.factions && App.state.factions.length>=30 ? true : null);
  check(`${vp.tag}: app loaded`, !!ready);
  for (const c of CASES) {
    // data layer: what the adapter produced
    const data = await page.evaluate(({fx, unit, ability}) => {
      const f = App.state.factions.find(x => new RegExp(fx).test(x.factionName)); if(!f) return {err:'no faction'};
      const u = f.units.find(x => x.name === unit); if(!u) return {err:'no unit', names:f.units.slice(0,5).map(x=>x.name)};
      const a = (u.abilities||[]).find(x => x.name === ability); return { faction:f.factionName, desc: a ? a.description : null, names:(u.abilities||[]).map(x=>x.name) };
    }, { fx: c.faction.source, unit: c.unit, ability: c.ability });
    if (!c.dataSkip) check(`${vp.tag}: data ${c.unit}/${c.ability} has "${c.must}"`, !!data.desc && data.desc.includes(c.must) && !data.desc.includes(c.mustNot), (data.desc||JSON.stringify(data)).slice(0,90));
    if (vp.tag !== 'desktop' && !c.phone) continue;   // click-through at desktop; phone only for cases marked phone
    // UI layer: real controls
    const optVal = await page.evaluate(fx => [...document.querySelectorAll('#army-faction-select option')].map(o=>o.value).find(v => new RegExp(fx).test(v)) || null, c.faction.source);
    check(`${vp.tag}: faction option for ${c.unit}`, !!optVal, optVal);
    if (!optVal) continue;
    if (vp.tag === 'phone') { await page.click('.mobile-tabbar [data-panel="army"]').catch(()=>{}); await page.waitForTimeout(200); }
    await page.selectOption('#army-faction-select', optVal);
    if (vp.tag === 'phone') { await page.click('.mobile-tabbar [data-panel="units"]'); await page.waitForTimeout(300); }
    await page.fill('#search-input', c.unit);
    await page.waitForTimeout(600);
    const card = page.locator('#unit-grid .unit-card').filter({ has: page.locator('.unit-card-name', { hasText: new RegExp(`^\\W*${c.unit}$`) }) }).first();
    const n = await card.count();
    check(`${vp.tag}: unit card "${c.unit}" in grid`, n>0);
    if (!n) continue;
    await card.click();
    await page.waitForSelector('#unit-detail-panel');
    await page.waitForTimeout(400);
    const txt = await page.locator('#unit-detail-panel').innerText();
    const ok = txt.toLowerCase().includes(c.ability.toLowerCase()) && (c.paneSkip || (txt.includes(c.must) && !txt.includes(c.mustNot)));
    check(`${vp.tag}: details pane ${c.unit} → ${c.ability} shows "${c.must}"`, ok, ok ? '' : txt.slice(0, 300).replace(/\n/g,' | '));
    await page.evaluate((ab) => {
      const pane = document.querySelector('#unit-detail-panel');
      const el = [...pane.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim().toLowerCase() === ab.toLowerCase())
             || [...pane.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.toLowerCase().includes(ab.toLowerCase()));
      if (el) el.scrollIntoView({ block: 'start' });
    }, c.ability);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${c.shot}-${vp.tag}.png`, fullPage: false });
  }
  check(`${vp.tag}: no page errors`, errors.length===0, errors.slice(0,2).join(' ; '));
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
