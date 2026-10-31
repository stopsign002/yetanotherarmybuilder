// css-cascade.mjs — computed-style capture + selector co-match map (contract:
// docs/CSS-REORG-2026-10-31.md §3). Run:
//   browse.sh run scripts/verify/css-cascade.mjs <outdir>
// Env (forward with BROWSE_ENV): CSS_FROM (e.g. /out/candidate), THEMES, WIDTHS, STATES.
// Read-only against the live site; signs in as nobody. NEVER page.waitForFunction.
import { launch, newPage, until, boot, OUT, SITE } from './_lib.mjs';
import { gzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const THEMES = (process.env.THEMES || 'grimdark,brutalist,brutalist-dark').split(',').filter(Boolean);
const WIDTHS = (process.env.WIDTHS || '1440,390').split(',').map(Number);
const STATES = process.env.STATES ? process.env.STATES.split(',') : null;
const CSS_FROM = process.env.CSS_FROM || '';
mkdirSync(OUT, { recursive: true });

// ---- in-page code (passed as strings of functions; evaluated by Playwright, not eval) ----
const capturePage = () => {
  const elements = [], pairs = [], idx = new Map();
  const intern = (p, v) => { const k = p + ':' + v; let i = idx.get(k); if (i === undefined) { i = pairs.length; idx.set(k, i); pairs.push(k); } return i; };
  const styleOf = (cs) => { const out = new Array(cs.length); for (let i = 0; i < cs.length; i++) { const p = cs[i]; out[i] = intern(p, cs.getPropertyValue(p)); } return out; };
  const paths = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.hasAttribute('data-cssx')) { paths.push(null); continue; }
    const ix = []; for (let n = el; n && n.parentElement; n = n.parentElement) ix.push(Array.prototype.indexOf.call(n.parentElement.children, n));
    const path = ix.reverse().join('/'); paths.push(path);
    const base = { path, tag: el.tagName.toLowerCase(), id: el.id || '', classes: typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '') };
    elements.push({ ...base, pseudo: null, styles: styleOf(getComputedStyle(el)) });
    for (const ps of ['::before', '::after']) {
      const pc = getComputedStyle(el, ps);
      if (pc.content !== 'none') elements.push({ ...base, pseudo: ps, styles: styleOf(pc) });
    }
  }
  return { elements, pairs };
};

const matchPage = (known) => {
  // known: selectors already evaluated this run are still re-evaluated (DOM differs per state); we
  // return per-selector element PATHS (compact via local index table).
  const rules = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.type === 1) rules.push(r.selectorText);
      else if (r.type === 4 || r.type === 12) walk(r.cssRules); // media, supports
      else if (r.cssRules && r.type !== 7 && r.type !== 5) { try { walk(r.cssRules); } catch (_) {} }
    }
  };
  for (const sh of document.styleSheets) {
    if (sh.ownerNode && sh.ownerNode.hasAttribute && sh.ownerNode.hasAttribute('data-cssx')) continue;
    let rl; try { rl = sh.cssRules; } catch (_) { continue; }
    walk(rl);
  }
  const splitTop = (s) => {
    const out = []; let d = 0, q = '', cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
      if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const strip = (sel) => {
    const fix = (re) => (s) => s.replace(re, (m, ...a) => {
      const off = a[a.length - 2]; const before = s.slice(0, off);
      return (before === '' || /[\s>+~(,]$/.test(before)) ? '*' : '';
    });
    let s = sel;
    s = fix(/::?(?:before|after|first-line|first-letter)(?![\w-])/g)(s);
    s = fix(/::[\w-]+(?:\([^)]*\))?/g)(s);
    s = fix(/:(?:hover|focus-visible|focus-within|focus|active|visited|target|placeholder-shown)(?![\w-])/g)(s);
    return s.trim();
  };
  const all = Array.from(document.querySelectorAll('*'));
  const pathOf = (el) => { const ix = []; for (let n = el; n && n.parentElement; n = n.parentElement) ix.push(Array.prototype.indexOf.call(n.parentElement.children, n)); return ix.reverse().join('/'); };
  const pathCache = new Map(); const pc = (el) => { let p = pathCache.get(el); if (p === undefined) { p = el.hasAttribute('data-cssx') ? null : pathOf(el); pathCache.set(el, p); } return p; };
  const res = {}; const seen = new Set();
  for (const text of rules) for (const part of splitTop(text)) {
    if (seen.has(part)) continue; seen.add(part);
    const st = strip(part);
    let list = null;
    if (st) { try { list = Array.from(document.querySelectorAll(st)).map(pc).filter(p => p !== null); } catch (_) { list = null; } }
    res[part] = list;
  }
  return res;
};

// ---- node side ----
const matchElems = new Map(); // path -> idx
const matchSets = new Map();  // selector -> Set(idx) | null
const unreached = new Map();  // state key -> reason
const reached = new Map();    // state id -> count
let totalBytes = 0, totalEls = 0;

function mergeMatches(res, stateId) {
  for (const [sel, list] of Object.entries(res)) {
    if (list === null) { matchSets.set(sel, null); continue; }
    if (matchSets.get(sel) === null) continue;
    let set = matchSets.get(sel); if (!set) { set = new Set(); matchSets.set(sel, set); }
    for (const p0 of list) { const p = `${stateId}|${p0}`; let i = matchElems.get(p); if (i === undefined) { i = matchElems.size; matchElems.set(p, i); } set.add(i); }
  }
}

async function capture(page, theme, width, id, wait = 350) {
  if (STATES && !STATES.includes(id)) return;
  if (wait) await page.waitForTimeout(wait);
  const cap = await page.evaluate(capturePage);
  const doc = { state: id, theme, width, elements: cap.elements, pairs: cap.pairs };
  const gz = gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 });
  writeFileSync(`${OUT}/${theme}-${width}-${id}.json.gz`, gz);
  totalBytes += gz.length; totalEls += cap.elements.length;
  mergeMatches(await page.evaluate(matchPage, null), id);
  reached.set(id, (reached.get(id) || 0) + 1);
  console.log(`captured ${theme}-${width}-${id}  ${cap.elements.length} els  ${(gz.length / 1024).toFixed(0)} KB`);
}

let dbg = async () => ''; // set per page
const FORCE = { force: true, timeout: 20000 };
async function tryStep(theme, width, id, fn) {
  if (STATES && !STATES.includes(id) && !id.startsWith('_')) { /* still run: later states depend on it */ }
  try { const r = await fn(); if (process.env.DEBUG) console.log('  [dbg]', id, await dbg()); if (r === false) throw new Error('not reachable (element missing/hidden)'); return true; }
  catch (e) { unreached.set(`${theme}-${width}-${id}`, String(e.message).replace(/\s+/g, ' ').slice(0, 200)); return false; }
}

async function run() {
  const browser = await launch();
  for (const theme of THEMES) for (const width of WIDTHS) {
    const phone = width < 500;
    const { ctx, page } = await newPage(browser, {
      viewport: { width, height: phone ? 844 : 900 }, theme,
      ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('yaab_reduced_motion', '1'); localStorage.setItem('yaab_changelog_seen', '9999'); } catch (_) {} });
    if (CSS_FROM) {
      const send = async (route, file, type) => {
        if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not in CSS_FROM' });
        return route.fulfill({ status: 200, contentType: type, headers: { 'cache-control': 'no-store' }, body: readFileSync(file) });
      };
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin !== new URL(SITE).origin) return route.continue();
        if (u.pathname === '/' || u.pathname === '/index.html') return send(route, `${CSS_FROM}/index.html`, 'text/html; charset=utf-8');
        if (u.pathname.startsWith('/css/')) return send(route, `${CSS_FROM}${u.pathname}`, 'text/css; charset=utf-8');
        return route.continue();
      });
    }
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const tag = `${theme}-${width}`;
    console.log(`\n== ${tag}`);
    // 00-boot: capture right after DOMContentLoaded, before the roster exists (cold-start splash etc.)
    await tryStep(theme, width, '00-boot', async () => {
      const bp = await ctx.newPage();
      await bp.route('**/data/dataset/**', async (r) => { await new Promise(x => setTimeout(x, 4000)); r.fallback(); });
      await bp.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await bp.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await bp.evaluate(() => { const s = document.head.querySelector('style:last-of-type'); if (s) s.setAttribute('data-cssx', '1'); });
      const early = await bp.evaluate(() => !document.querySelector('#unit-grid .unit-card'));
      await capture(bp, theme, width, '00-boot', 0);
      await bp.close();
      if (!early) unreached.set(`${theme}-${width}-00-boot`, 'captured, but roster had already rendered');
    });
    if (!(await boot(page, { timeout: 120000, settle: 1500 }))) { console.log('BOOT FAILED', tag); unreached.set(`${tag}-*`, 'boot failed'); await ctx.close(); continue; }
    // determinism: kill animations/transitions/caret; marked so it is excluded from capture + match map
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.evaluate(() => { const s = document.head.querySelector('style:last-of-type'); if (s) s.setAttribute('data-cssx', '1'); });
    dbg = () => page.evaluate(() => `cards=${document.querySelectorAll('#unit-grid .unit-card').length} q='${document.getElementById('search-input')?.value}' active=${[...document.querySelectorAll('.filter-chip.active,.filter-chip.excluded,.reserves-view-btn.active')].map(e=>e.className.split(' ').slice(0,2).join('.')).join(',')}`).catch(() => 'n/a');
    const tab = (p) => phone ? page.locator(`.mobile-tabbar button[data-panel="${p}"]`).click(FORCE).then(() => page.waitForTimeout(500)) : null;
    const escape = async () => { await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await page.waitForTimeout(300); };

    await capture(page, theme, width, '01-empty');

    // ---- 02-build (snap.mjs recipe) ----
    const addBtn = () => page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); return !!b; });
    const built = await tryStep(theme, width, '02-build', async () => {
      await page.selectOption('#army-faction-select', 'Chaos - Death Guard'); await page.waitForTimeout(1500);
      await tab('units');
      for (const name of ['Plague Marines', 'Typhus']) {
        await page.fill('#search-input', name); await page.waitForTimeout(800);
        await page.locator('#unit-grid .unit-card', { hasText: new RegExp(name, 'i') }).first().click(FORCE); await page.waitForTimeout(800);
        if (!(await addBtn())) throw new Error('add button missing'); await page.waitForTimeout(600);
      }
      await page.fill('#search-input', ''); await page.waitForTimeout(600);
      await tab('detail');
      return true;
    });
    if (built) {
      await capture(page, theme, width, '02-build');

      // 02h / 02s hover (units panel on phone)
      await tryStep(theme, width, '02h-card-hover', async () => { await tab('units'); await page.locator('#unit-grid .unit-card:not(.selected)').first().hover(FORCE); await capture(page, theme, width, '02h-card-hover'); });
      await tryStep(theme, width, '02s-selected-hover', async () => { await page.locator('#unit-grid .unit-card.selected').first().hover(FORCE); await capture(page, theme, width, '02s-selected-hover'); });
      await page.mouse.move(2, 2);
      // 02f focus-visible: click search then Tab
      await tryStep(theme, width, '02f-focus', async () => {
        await page.locator('#search-input').click(FORCE); await page.keyboard.press('Tab'); await capture(page, theme, width, '02f-focus');
        await page.evaluate(() => document.activeElement && document.activeElement.blur()); });
      // Export menu = the topbar's #topbar-export-btn (the in-panel .dropdown "Export ▾" and the
      // Tools/More dropdowns live in a `hidden` compat shelf and are unreachable by a person).
      await tryStep(theme, width, '02x-export-menu', async () => {
        await page.locator('#topbar-export-btn').click({ timeout: 4000 }); await page.waitForSelector('#topbar-export-menu:not([hidden])', { timeout: 3000 });
        await capture(page, theme, width, '02x-export-menu'); await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await page.waitForTimeout(300); });
      unreached.set(`${tag}-02t-tools-menu`, 'no visible Tools dropdown: #tools-dropdown sits in .toolbar-compat-shelf[hidden] (nothing a user can click)');
      await tryStep(theme, width, '02a-army-hover', async () => { await tab('army'); await page.locator('.army-entry').first().hover(FORCE); await capture(page, theme, width, '02a-army-hover'); await page.mouse.move(2, 2); });
      if (phone) await tryStep(theme, width, '03-army-phone', async () => { await tab('army'); await capture(page, theme, width, '03-army-phone'); });
      else unreached.set(`${tag}-03-army-phone`, 'phone only (n/a at desktop width)');

      // 11 glossary (detail pane), before leaving build mode
      await tryStep(theme, width, '11-glossary', async () => {
        await tab('detail');
        const t = page.locator('#detail-pane .weapon-kw-tag, #detail-pane .core-ability-tag, #detail-pane .glossary-term, .unit-detail-content .weapon-kw-tag, .unit-detail-content .core-ability-tag, .unit-detail-content .glossary-term').first();
        await t.click(FORCE); await page.waitForSelector('#glossary-pop:not([hidden])', { timeout: 3000 });
        await capture(page, theme, width, '11-glossary'); await escape(); });
      // 09 palette
      await tryStep(theme, width, '09-palette', async () => {
        await page.evaluate(() => { if (App.closeCommandPalette) App.closeCommandPalette(); });
        const ok = await page.evaluate(() => { if (!App.openCommandPalette) return false; App.openCommandPalette(); return true; });
        if (!ok) throw new Error('App.openCommandPalette missing');
        await page.waitForSelector('.cmdp-backdrop:not([hidden])', { timeout: 3000 });
        await capture(page, theme, width, '09-palette');
        await page.evaluate(() => App.closeCommandPalette && App.closeCommandPalette()); await page.waitForTimeout(300); });
      // 10 changelog
      await tryStep(theme, width, '10-changelog', async () => {
        await page.evaluate(() => { const b = document.querySelector('#yaab-btn-changelog'); if (!b) return; b.click(); });
        await page.waitForSelector('.changelog-modal, #changelog-modal, [class*="changelog"]:not([hidden])', { timeout: 3000 });
        await capture(page, theme, width, '10-changelog'); await escape(); });

      // ================= extra coverage states (signed out, local-only writes) =================
      const Q = { force: true, timeout: 4000 };
      const ex = (id, fn) => tryStep(theme, width, id, async () => { const r = await fn(); if (r === false) return false; await capture(page, theme, width, id); });
      const settle = async () => { await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await page.waitForTimeout(250); };
      const unitsTab = () => tab('units');
      await ex('12-kotc-on', async () => { await tab('army'); await page.locator('summary.kotc-summary').click(Q); await page.locator('#kotc-enabled').check(Q); await page.waitForTimeout(400); });
      await tryStep(theme, width, '_kotc-off', async () => { await page.locator('#kotc-enabled').uncheck(Q); });
      await ex('13-chip-include', async () => { await unitsTab(); await page.locator('.filter-chip:not(.ally-chip):not(.fav-chip):not(.recent-chip):not(.filter-chip-check)').nth(1).click(Q); });
      await ex('14-chip-exclude', async () => { await page.locator('.filter-chip:not(.ally-chip):not(.fav-chip):not(.recent-chip):not(.filter-chip-check)').nth(1).click(Q); if (!(await page.locator('.filter-chip.excluded').count())) return false; });
      await tryStep(theme, width, '_chip-off', async () => { await page.locator('.filter-chip:not(.ally-chip):not(.fav-chip):not(.recent-chip):not(.filter-chip-check)').nth(1).click(Q); });
      await ex('15-fits-budget', async () => { await page.locator('.fits-budget-chip input').check(Q); });
      await tryStep(theme, width, '_fits-off', async () => { await page.locator('.fits-budget-chip input').uncheck(Q); });
      // (the favourite star action is not registered in this build — hooks push is commented out — so only the empty Favorites chip state is reachable)
      await ex('16-fav-chip', async () => { await unitsTab(); await page.locator('.fav-chip').click(Q); await page.waitForTimeout(400); });
      await tryStep(theme, width, '_fav-off', async () => { if (await page.locator('.fav-chip.active').count()) await page.locator('.fav-chip').click(Q); });
      await ex('17-recent-chip', async () => { await page.locator('.recent-chip').click(Q); await page.waitForTimeout(400); });
      await tryStep(theme, width, '_recent-off', async () => { if (await page.locator('.recent-chip.active').count()) await page.locator('.recent-chip').click(Q); });
      await ex('18-ally-chip', async () => { await page.locator('.ally-chip').click(Q); await page.waitForTimeout(500); });
      await tryStep(theme, width, '_ally-off', async () => { if (await page.locator('.ally-chip.active').count()) await page.locator('.ally-chip').click(Q); });
      await ex('19-roster-empty', async () => { await page.fill('#search-input', 'zzzz'); await page.waitForTimeout(600); });
      await tryStep(theme, width, '_search-clear', async () => { await page.fill('#search-input', ''); await page.waitForTimeout(500); });
      await ex('20-reserves-view', async () => { await page.locator('.reserves-view-btn').nth(0).click(Q); await page.waitForTimeout(500); });
      await ex('21-requisitions-view', async () => { await page.locator('.reserves-view-btn').nth(1).click(Q); await page.waitForTimeout(500); });
      await tryStep(theme, width, '_view-all', async () => { await page.locator('.reserves-view-btn').nth(2).click(Q); await page.waitForTimeout(400); });
      await ex('22-legends-on', async () => {
        await page.evaluate(() => App.settingsDrawer.open()); await page.waitForTimeout(500);
        await page.locator('#set-toggle-yaab_show_legends').check(Q); await page.waitForTimeout(800);
        await page.evaluate(() => App.settingsDrawer.close && App.settingsDrawer.close()); await settle();
        await page.evaluate(() => { const d = document.getElementById('settings-drawer-root'); if (d && !d.hidden) document.getElementById('settings-drawer-close')?.click(); }); await page.waitForTimeout(400); await unitsTab(); });
      await ex('23-legends-unit-detail', async () => { await unitsTab(); const c = page.locator('#unit-grid .unit-card.unit-card-legends').first(); await c.click(Q); await tab('detail'); });
      await tryStep(theme, width, '_legends-off', async () => { await page.fill('#search-input', ''); await unitsTab(); await page.evaluate(() => App.settingsDrawer.open()); await page.waitForTimeout(400); await page.locator('#set-toggle-yaab_show_legends').uncheck(Q); await page.evaluate(() => document.getElementById('settings-drawer-close')?.click()); await page.waitForTimeout(500); });
      // detachment ticked -> detail pane detachment rules/stratagems; enhancement; wargear
      await ex('24-detachment-ticked', async () => { await tab('army'); await page.locator('.detachment-row-cb').first().check(Q); await page.waitForTimeout(600); await page.locator('.detachment-row').first().click(Q); await page.waitForTimeout(500); await tab('detail'); });
      await ex('25-enhancement-ticked', async () => {
        await unitsTab(); const n = await page.locator('#unit-grid .unit-card.role-character').count();
        for (let i = 0; i < Math.min(n, 15); i++) {
          await page.locator('#unit-grid .unit-card.role-character').nth(i).click(Q); await page.waitForTimeout(250);
          const cb = page.locator('.enhancement-cb-item:not(.enhancement-ineligible) input.enhancement-cb').first();
          if (await cb.count()) { await tab('detail'); await cb.check(Q); await page.waitForTimeout(400); return true; }
        }
        return false; });
      await ex('26-wargear-picker', async () => {
        await unitsTab(); await page.fill('#search-input', 'Defiler'); await page.waitForTimeout(600);
        await page.locator('#unit-grid .unit-card', { hasText: /Defiler/ }).first().click(Q); await tab('detail'); await page.waitForTimeout(400);
        const pick = page.locator('#detail-wargear-picker input, #detail-wargear-picker select, #detail-wargear-picker button').first();
        if (!(await pick.count())) return false;
        const tag = await pick.evaluate(e => e.tagName);
        if (tag === 'SELECT') await pick.selectOption({ index: 1 }); else await pick.click(Q);
        await page.waitForTimeout(400); });
      await tryStep(theme, width, '_search-clear2', async () => { await page.fill('#search-input', ''); await page.waitForTimeout(400); });
      // army list: count 2, rename, duplicate, over limit, toast
      await ex('27-army-qty2', async () => { await tab('army'); await page.locator('.army-qty-input').first().fill('2'); await page.keyboard.press('Tab'); await page.waitForTimeout(500); });
      await ex('28-army-entry-actions', async () => { await page.locator('.army-entry').first().hover(Q); const names = await page.evaluate(() => [...document.querySelectorAll('.army-entry-action')].map(b => b.title || b.getAttribute('aria-label') || b.textContent.trim())); console.log('  army actions:', JSON.stringify(names)); if (!names.length) return false; });
      await ex('29-custom-name', async () => { await unitsTab(); await page.fill('#search-input', 'Typhus'); await page.waitForTimeout(500);
        await page.locator('#unit-grid .unit-card', { hasText: /Typhus/ }).first().click(Q); await tab('detail'); await page.waitForTimeout(400);
        await page.locator('.stockpile-inc').first().click(Q); await page.waitForTimeout(500);
        const inp = page.locator('.custom-name-widget input').first(); if (!(await inp.count())) return false;
        await inp.fill("Nurgle's Chosen"); await page.locator('.custom-name-widget .cn-btn[data-action="set-entry"], .custom-name-widget .cn-btn-primary').first().click(Q); await page.waitForTimeout(500); });
      await tryStep(theme, width, '_search-clear3', async () => { await page.fill('#search-input', ''); await page.waitForTimeout(400); });
      await ex('30-army-duplicate', async () => { const b = page.locator('.army-entry-action[title*="uplicate" i], .army-entry-action[title*="opy" i], .army-entry-action[title*="plit" i]').first(); if (!(await b.count())) return false; await b.click(Q); await page.waitForTimeout(500); });
      await ex('31-points-over-limit', async () => { await page.locator('#points-limit-input').fill('50'); await page.locator('#points-limit-input').dispatchEvent('change'); await page.keyboard.press('Tab'); await page.waitForTimeout(600); });
      await tryStep(theme, width, '_limit-reset', async () => { await page.locator('#points-limit-input').fill('2000'); await page.locator('#points-limit-input').dispatchEvent('change'); await page.keyboard.press('Tab'); await page.waitForTimeout(400); });
      await tryStep(theme, width, '32-toast', async () => { await unitsTab(); await page.locator('#unit-grid .unit-card').first().click(Q); await tab('detail'); await addBtn();
        if (!(await page.locator('.toast, [class*="toast"]:not([hidden])').first().isVisible().catch(() => false))) throw new Error('no toast visible right after Add'); await capture(page, theme, width, '32-toast', 0); });
      await ex('32b-toast-types', async () => { await page.evaluate(() => { for (const t of ['info', 'success', 'warning', 'error', 'celebrate']) UI.toast('Sample ' + t, t, 60000); }); });
      // modals
      await ex('33-bug-modal', async () => { await page.locator('#yaab-btn-bug-report').click(Q); await page.waitForSelector('.modal-backdrop:not([hidden])', { timeout: 3000 }); });
      await settle();
      await ex('34-help-modal', async () => { await page.locator('#topbar-help').click(Q); await page.waitForSelector('.cmdp-help-backdrop:not([hidden])', { timeout: 3000 }); });
      await settle();
      await ex('35-export-modal', async () => { await page.locator('#topbar-export-btn').click({ timeout: 4000 }); await page.locator('#topbar-export-menu .auth-menu-item', { hasText: 'Copy army code' }).click(Q); await page.waitForSelector('#modal-export:not([hidden]), .modal-backdrop:not([hidden])', { timeout: 3000 }); });
      await settle(); await page.evaluate(() => { document.getElementById('btn-export-done')?.click(); }); await page.waitForTimeout(300);
      await ex('36-auth-modal', async () => { await page.locator('#yaab-btn-auth').click(Q); await page.locator('.auth-menu-item', { hasText: 'Sign in' }).first().click(Q); await page.waitForSelector('#modal-auth:not([hidden])', { timeout: 3000 }); });
      await settle(); await page.evaluate(() => { document.querySelectorAll('.modal-backdrop:not([hidden]) [data-close], .modal-backdrop:not([hidden]) .modal-close').forEach(b => b.click()); });
    }
    // modes + drawer (independent of 02 success)
    for (const [mode, id, wait] of [['cards', '04-cards', 3500], ['play', '05-play', 1500], ['waha', '06-waha', 1500]]) {
      await tryStep(theme, width, id, async () => {
        const ok = await page.evaluate((m) => { if (!App.setMode) return false; App.setMode(m); return true; }, mode);
        if (!ok) return false; await page.waitForTimeout(wait); await capture(page, theme, width, id); });

      if (id === '06-waha') {
        const Q2 = { force: true, timeout: 4000 };
        await tryStep(theme, width, '39-waha-unit', async () => { await page.locator('.waha-tile', { hasText: /Death Guard/ }).first().click(Q2); await page.waitForTimeout(1000); await page.locator('.waha-row').first().click(Q2); await page.waitForTimeout(700); await capture(page, theme, width, '39-waha-unit'); });
        await tryStep(theme, width, '40-waha-section', async () => { await page.locator('.waha-tab', { hasText: 'Stratagems' }).click(Q2); await page.waitForTimeout(700); await page.locator('.waha-row').first().click(Q2); await page.waitForTimeout(500); await page.locator('.waha-group-head').first().click(Q2).catch(() => {}); await capture(page, theme, width, '40-waha-section'); });
      }
      if (id === '04-cards') {
        const Q2 = { force: true, timeout: 4000 };
        for (const [sid, tabName] of [['41-cards-layout', 'Layout'], ['42-cards-display', 'Display']]) {
          await tryStep(theme, width, sid, async () => {
            await page.locator('.cards-subtab', { hasText: tabName }).click(Q2); await page.waitForTimeout(500);
            const cbs = page.locator('#cards-mode input[type=checkbox]:visible'); const n = Math.min(await cbs.count(), 6);
            for (let i = 0; i < n; i++) await cbs.nth(i).click(Q2).catch(() => {});
            const sel = page.locator('#cards-mode select:visible'); const m = Math.min(await sel.count(), 3);
            for (let i = 0; i < m; i++) { const c = await sel.nth(i).locator('option').count(); if (c > 1) await sel.nth(i).selectOption({ index: 1 }).catch(() => {}); }
            await page.waitForTimeout(800); await capture(page, theme, width, sid); });
        }
        for (const [sid, cat] of [['43-cards-rules', 'Army rules'], ['44-cards-strats', 'Stratagems']]) {
          await tryStep(theme, width, sid, async () => { await page.locator('.cards-subtab', { hasText: 'Pick cards' }).click(Q2); await page.locator('.cards-cat-tab', { hasText: cat }).click(Q2); await page.waitForTimeout(700); await capture(page, theme, width, sid); });
        }
        await tryStep(theme, width, '45-cards-print', async () => { await page.locator('.cards-subtab', { hasText: 'Pick cards' }).click(Q2); await page.locator('.cards-cat-tab', { hasText: 'Units' }).click(Q2); await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(600); await capture(page, theme, width, '45-cards-print'); await page.emulateMedia({ media: 'screen' }); });
      }
    }
    await page.evaluate(() => App.setMode && App.setMode('build')); await page.waitForTimeout(500);
    await tryStep(theme, width, '08-drawer', async () => {
      const ok = await page.evaluate(() => { if (!(App.settingsDrawer && App.settingsDrawer.open)) return false; App.settingsDrawer.open(); return true; });
      if (!ok) return false; await page.waitForTimeout(600); await capture(page, theme, width, '08-drawer'); });
    if (errs.length) console.log('page errors:', errs.length, errs.slice(0, 2));
    await ctx.close();
  }
  await browser.close();

  const selectors = {}; const elements = Array.from(matchElems.keys());
  for (const [s, set] of matchSets) selectors[s] = set === null ? null : Array.from(set).sort((a, b) => a - b);
  const mg = gzipSync(Buffer.from(JSON.stringify({ elements, selectors })), { level: 9 });
  writeFileSync(`${OUT}/matches.json.gz`, mg); totalBytes += mg.length;
  const nulls = Object.values(selectors).filter(v => v === null).length;
  console.log(`\nmatches.json.gz: ${Object.keys(selectors).length} selectors (${nulls} null), ${elements.length} elements, ${(mg.length / 1024).toFixed(0)} KB`);
  console.log(`TOTAL ${(totalBytes / 1048576).toFixed(2)} MB, ${totalEls} element records`);
  console.log('states reached:', [...reached.entries()].map(([k, v]) => `${k}×${v}`).join(' '));
  if (unreached.size) { console.log('NOT REACHED:'); for (const [k, v] of unreached) console.log(`  ${k}: ${v}`); }
  else console.log('every requested state reached');
}
await run();
