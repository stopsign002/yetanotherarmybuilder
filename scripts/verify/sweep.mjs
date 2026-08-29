// sweep.mjs — yaab full-surface verification sweep.
//
//   THEME=grimdark WIDTH=desktop \
//   ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yetanotherarmybuilder/app/scripts/verify/sweep.mjs \
//     ~/sites/base/browser/out/yaab-sweep-grimdark-desktop
//
// READ-ONLY. Touches localStorage in a throwaway profile only. No account,
// nothing server-side, no writes to any DB.
//
// Opens every surface in one theme/width, screenshots it, asserts it actually
// MOUNTED (a modal that failed to open still screenshots fine as the page
// behind it), and runs the styling probes. Emits report.json.
//
// browse.sh copies this file into browser/ as .run-$$.mjs, so it must stay a
// single file with no relative imports.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT   = process.env.OUT || '/out';
const THEME = process.env.THEME || 'grimdark';
const WIDTH = process.env.WIDTH || 'desktop';
const SITE  = 'https://yaab.thewheeliebois.com/';
const VP    = WIDTH === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const R = { theme: THEME, width: WIDTH, surfaces: [], notes: [], counts: {} };
let attempted = 0, opened = 0, shot = 0;

// DO NOT use page.waitForFunction — yaab's CSP is script-src 'self' with no
// 'unsafe-eval', so it rejects instantly instead of waiting. page.evaluate is
// fine (CDP, not subject to page CSP).
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
const ctx = await browser.newContext({
  viewport: VP, ignoreHTTPSErrors: true, reducedMotion: 'reduce', deviceScaleFactor: 1,
});
await ctx.addInitScript((t) => {
  try { localStorage.setItem('yaab_theme', t); } catch (_) {}
}, THEME);
const page = await ctx.newPage();

// Per-surface error ledger.
let bucket = 'boot';
const errors = [];
page.on('pageerror', e => errors.push({ surface: bucket, kind: 'exception', text: String(e.message).slice(0, 300) }));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/401|auth\/me|favicon/.test(t)) return;   // expected while signed out
  errors.push({ surface: bucket, kind: 'console', text: t.slice(0, 300) });
});
page.on('requestfailed', r => {
  const u = r.url();
  if (/\/api\//.test(u)) return;
  errors.push({ surface: bucket, kind: 'requestfailed', text: `${u} ${r.failure()?.errorText || ''}`.slice(0, 300) });
});
// Native confirm()/alert() would hang the run. Auto-dismiss (= cancel), so no
// destructive settings row can actually fire.
page.on('dialog', async d => { R.notes.push(`dialog dismissed: ${d.type()} ${d.message().slice(0,120)}`); await d.dismiss().catch(() => {}); });

// ── styling probes ────────────────────────────────────────────────────────
const PROBE = () => {
  const out = { contrast: [], overflow: [], collision: [], unstyled: [], invisible: [], covered: [] };
  const vis = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
    return true;
  };
  const path = el => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      let b = n.tagName.toLowerCase();
      if (n.id) { bits.unshift(b + '#' + n.id); break; }
      if (n.className && typeof n.className === 'string') b += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      bits.unshift(b);
    }
    return bits.join('>');
  };
  const parse = c => {
    const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  // Returns null when a background IMAGE or gradient sits between the text and
  // the first solid colour — the computed colour is then not what the eye sees
  // (cards-mode paints parchment as an image over a dark panel, which would
  // otherwise report ~70 phantom contrast failures per screen).
  const effBg = el => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.92) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  // contrast — only elements holding their own visible text
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (!vis(el)) continue;
    const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) continue;
    const bg = effBg(el);
    if (!bg) continue;                       // background image — not measurable
    const c  = fg.a < 1 ? over(fg, bg) : fg;
    const L1 = lum(c), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize) || 16;
    const bold = (parseInt(s.fontWeight, 10) || 400) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3.0 : 4.5;
    if (ratio < need) {
      out.contrast.push({
        sel: path(el), ratio: +ratio.toFixed(2), need, px: +px.toFixed(1),
        color: s.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        text: (el.textContent || '').trim().slice(0, 60),
      });
    }
  }

  // horizontal overflow
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) out.overflow.push({ sel: 'html', scroll: de.scrollWidth, client: de.clientWidth });
  for (const el of all) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;   // intentional
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
      out.overflow.push({ sel: path(el), scroll: el.scrollWidth, client: el.clientWidth });
  }

  // interactive controls: collision, unstyled, invisible
  const CTRL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"]';
  const ctrls = Array.from(document.querySelectorAll(CTRL));
  const live = [];
  for (const el of ctrls) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (el.closest('[hidden]')) continue;
    if (r.width < 1 || r.height < 1) {
      if (el.offsetParent !== null || s.position === 'fixed')
        out.invisible.push({ sel: path(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), text: (el.textContent||'').trim().slice(0,40) });
      continue;
    }
    if (parseFloat(s.opacity) < 0.05) continue;
    // Hit-test at the control's own centre. If the topmost element there is
    // unrelated, this control sits UNDER something — either legitimately
    // behind an open overlay, or blocked by an invisible one. Either way it
    // must not be compared against controls in a different layer, which is
    // what produced 16 phantom "collisions" per modal.
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    const hittable = !!top && (top === el || el.contains(top) || top.contains(el));
    if (!hittable) { out.covered.push({ sel: path(el), by: top ? path(top) : 'none', text: (el.textContent||'').trim().slice(0,40) }); continue; }
    live.push({ el, r, s });

    // unstyled control: performs an action but has no background AND no border
    // AND no box-shadow. Genuine inline text links are excluded.
    const tag = el.tagName.toLowerCase();
    const isLinkish = tag === 'a' && el.closest('p, li, .detail-ability, .lore-modal, .changelog-body');
    if (isLinkish) continue;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') continue;
    const bgc = parse(s.backgroundColor);
    const noBg = !bgc || bgc.a < 0.04;
    const bw = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth']
      .reduce((a, k) => a + (parseFloat(s[k]) || 0), 0);
    const noBorder = bw < 0.5;
    const noShadow = !s.boxShadow || s.boxShadow === 'none';
    const label = (el.textContent || '').trim();
    if (noBg && noBorder && noShadow && label.length > 0 && label.length < 40) {
      out.unstyled.push({
        sel: path(el), text: label.slice(0, 40), underline: s.textDecorationLine || s.textDecoration,
        color: s.color, w: +r.width.toFixed(0), h: +r.height.toFixed(0),
      });
    }
  }

  // collision — overlapping interactive controls that are not ancestors
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (ox > 3 && oy > 3) {
        const area = ox * oy, sm = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
        if (sm > 0 && area / sm > 0.18)
          out.collision.push({ a: path(A.el), b: path(B.el), overlap: +(area / sm).toFixed(2) });
      }
    }
  }
  const cap = (a, n) => a.slice(0, n);
  return {
    contrast: cap(out.contrast, 40), overflow: cap(out.overflow, 20),
    collision: cap(out.collision, 20), unstyled: cap(out.unstyled, 25), invisible: cap(out.invisible, 20),
    covered: cap(out.covered, 20),
    totals: { contrast: out.contrast.length, overflow: out.overflow.length, collision: out.collision.length,
              unstyled: out.unstyled.length, invisible: out.invisible.length, covered: out.covered.length },
  };
};

async function capture(name, assertSel, how) {
  attempted++;
  bucket = name;
  const mounted = assertSel
    ? await until(page, (s) => {
        if (!s) return false;
        const e = document.querySelector(s);
        if (!e) return false;
        if (e.hasAttribute('hidden') || e.closest('[hidden]')) return false;
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = e.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      }, { timeout: 8000, arg: assertSel }).then(v => !!v).catch(() => false)
    : true;
  if (mounted) opened++;
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
  const file = `${THEME}-${WIDTH}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` }).then(() => shot++).catch(e => R.notes.push(`shot failed ${name}: ${e.message}`));
  const probe = await page.evaluate(PROBE).catch(e => ({ error: e.message }));
  R.surfaces.push({ name, how, mounted, assertSel: assertSel || null, file, probe });
  console.log(`${mounted ? 'ok  ' : 'MISS'}  ${name}  (${how})  c:${probe?.totals?.contrast ?? '?'} o:${probe?.totals?.overflow ?? '?'} x:${probe?.totals?.collision ?? '?'} u:${probe?.totals?.unstyled ?? '?'}`);
  return mounted;
}

const dismiss = async () => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const sels = ['.modal-close', '.mm-close', '[data-mm-act="close"]', '.lore-close', '.strat-close',
      '.cmdp-help-close', '#settings-drawer-close', '[data-yaab-dp-close]', '[data-yaab-an-close]',
      '[data-yaab-dc-close]', '[data-yaab-syn-close]', '[data-yaab-opp-close]', '[data-yaab-mu-close]',
      '[data-crus-close]', '[data-coll-close]', '#kt-close', '#diff-close', '#al-close', '#community-close',
      '#starter-close', '#points-override-close', '#qr-share-close', '#tp-close', '#changelog-close',
      '#bug-report-close', '.admin-close', '#modal-load-close', '#modal-import-close', '#modal-export-close'];
    for (const s of sels) {
      const b = document.querySelector(s);
      if (b && b.offsetParent !== null) { b.click(); return; }
    }
  }).catch(() => {});
  await page.waitForTimeout(250);
};

// ── boot ──────────────────────────────────────────────────────────────────
console.log(`\n=== yaab sweep — theme=${THEME} width=${WIDTH} ===`);
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
const booted = await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 240000, step: 1000 });
if (!booted) { R.notes.push('BOOT FAILED — no .unit-card after 240s'); console.log('!! boot failed'); }

// Theme must actually be applied, or every screenshot below is a false pass.
const t = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-yaab-theme'),
  link: !!document.getElementById('yaab-theme-css'),
  stored: localStorage.getItem('yaab_theme'),
  meta: (document.querySelector('meta[name="theme-color"]') || {}).content || null,
}));
const themeOk = THEME === 'grimdark' ? (t.attr === null && t.link === false) : (t.attr === THEME && t.link === true);
R.themeApplied = { ...t, ok: themeOk };
console.log(`theme applied: ${themeOk ? 'ok' : 'FAIL'}  ${JSON.stringify(t)}`);

// Negative control: this element does not exist. If it reports mounted, the
// mount check is broken and every 'ok' below is meaningless.
const ctrlMounted = await capture('zz-negative-control', '#definitely-not-a-real-element-xyz', 'negative control');
R.negativeControl = { mounted: ctrlMounted, ok: ctrlMounted === false };
console.log(`negative control: ${ctrlMounted === false ? 'ok (correctly reported MISS)' : 'BROKEN — checker reports phantom mounts'}`);

await capture('00-boot-empty', '#unit-grid', 'load');
await capture('01-empty-detail', '#unit-detail-empty', 'initial');

// ── seed real content ─────────────────────────────────────────────────────
bucket = 'seed';
const factionSet = await page.evaluate(() => {
  const sel = document.getElementById('army-faction-select');
  if (!sel) return null;
  const opt = Array.from(sel.options).find(o => /Blood Angels/i.test(o.value)) ||
              Array.from(sel.options).find(o => /Space Marines/i.test(o.value)) ||
              Array.from(sel.options).filter(o => o.value && o.value !== 'all')[0];
  if (!opt) return null;
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
});
R.faction = factionSet;
console.log(`faction: ${factionSet}`);
await page.waitForTimeout(3500);

// a detachment, so rules/enhancements/stratagems populate
await page.evaluate(() => {
  const cb = document.querySelector('#detachments-body input.detachment-row-cb');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(1800);

// a CHARACTER, so leader / enhancement UI has something to render
await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll('.filter-chip')).find(c => /character/i.test(c.textContent));
  if (chip) chip.click();
});
await page.waitForTimeout(1200);
const card = await page.$('#unit-grid .unit-card');
if (card) { await card.click().catch(() => {}); await page.waitForTimeout(1200); }
await capture('02-unit-detail', '.unit-detail-content', 'click .unit-card');

// add it to the army
await page.evaluate(() => {
  const b = document.querySelector('#btn-detail-add, #btn-add-to-army, .detail-add-section .btn-accent');
  if (b) b.click();
});
await page.waitForTimeout(1500);
// clear the role filter so the roster is full again
await page.evaluate(() => { const c = document.querySelector('.filter-chips-clear'); if (c) c.click(); });
await page.waitForTimeout(1000);
await capture('03-build-populated', '#army-entry-list', 'after add');

// open the rules accordion
await page.evaluate(() => {
  ['army-rules-collapsible', 'detachments-section', 'army-setup-section'].forEach(id => {
    const d = document.getElementById(id); if (d) d.setAttribute('open', '');
  });
});
await page.waitForTimeout(900);
await capture('04-build-rules-open', '#army-rules-section', 'details[open]');

// roster empty state (zero search results)
await page.evaluate(() => {
  const s = document.getElementById('search-input');
  if (s) { s.value = 'zzzznomatchzzzz'; s.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.waitForTimeout(900);
await capture('05-roster-empty', '#roster-empty', 'search no-match');
await page.evaluate(() => {
  const s = document.getElementById('search-input');
  if (s) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.waitForTimeout(800);

// ── static modals ─────────────────────────────────────────────────────────
const STATIC = [
  ['10-modal-load',   '#btn-load-army',     '#modal-load .modal'],
  ['11-modal-import', '#btn-import-string', '#modal-import .modal'],
];
for (const [name, btn, sel] of STATIC) {
  await page.evaluate(id => { const b = document.querySelector(id); if (b) b.click(); }, btn);
  await page.waitForTimeout(700);
  await capture(name, sel, `click ${btn}`);
  await dismiss();
}
// export modal needs the dropdown
await page.evaluate(() => { const b = document.querySelector('#btn-export-string'); if (b) b.click(); });
await page.waitForTimeout(800);
await capture('12-modal-export', '#modal-export .modal', 'click #btn-export-string');
// grab the YAAB1 string while we are here — it is the fixture seed
const yaab1 = await page.evaluate(() => {
  const t = document.getElementById('export-string-textarea');
  return t ? t.value : null;
});
if (yaab1) { R.exportString = yaab1.slice(0, 4000); R.exportStringLen = yaab1.length; }
await dismiss();

await page.evaluate(() => window.UI && UI.showAuthModal && UI.showAuthModal('login'));
await page.waitForTimeout(800);
await capture('13-modal-auth-login', '#modal-auth .modal', 'UI.showAuthModal');
await page.evaluate(() => window.UI && UI.showAuthModal && UI.showAuthModal('register'));
await page.waitForTimeout(700);
await capture('14-modal-auth-register', '#modal-auth .modal', 'UI.showAuthModal');
await dismiss();

// ── settings drawer ───────────────────────────────────────────────────────
await page.evaluate(() => {
  if (window.App && App.settingsDrawer && App.settingsDrawer.open) App.settingsDrawer.open();
  else { const b = document.getElementById('topbar-settings'); if (b) b.click(); }
});
await page.waitForTimeout(900);
await capture('20-settings-top', '#settings-drawer', 'App.settingsDrawer.open');
await page.evaluate(() => { const g = document.querySelector('.settings-theme-group'); if (g) g.scrollIntoView({ block: 'center' }); });
await page.waitForTimeout(500);
await capture('21-settings-appearance', '.settings-theme-group', 'scrollIntoView');
await page.evaluate(() => { const b = document.querySelector('#settings-drawer-body'); if (b) b.scrollTop = b.scrollHeight; });
await page.waitForTimeout(500);
await capture('22-settings-bottom', '#settings-drawer', 'scroll end');
await dismiss();

// ── palette + help ────────────────────────────────────────────────────────
await page.keyboard.press('Control+k');
await page.waitForTimeout(700);
await capture('23-command-palette', '.cmdp-modal', 'Ctrl+K');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.keyboard.press('?');
await page.waitForTimeout(700);
await capture('24-keyboard-help', '.cmdp-help-modal', '? key');
await dismiss();

// ── topbar menus ──────────────────────────────────────────────────────────
await page.evaluate(() => { const b = document.getElementById('yaab-btn-auth'); if (b) b.click(); });
await page.waitForTimeout(500);
await capture('25-account-menu', '#yaab-auth-menu', 'click #yaab-btn-auth');
await page.keyboard.press('Escape'); await page.mouse.click(700, 400).catch(()=>{}); await page.waitForTimeout(400);
await page.evaluate(() => { const b = document.getElementById('topbar-export-btn'); if (b) b.click(); });
await page.waitForTimeout(500);
await capture('26-topbar-export-menu', '#topbar-export-menu', 'click #topbar-export-btn');
await page.mouse.click(700, 400).catch(()=>{}); await page.waitForTimeout(400);
await page.evaluate(() => { const t = document.querySelector('#export-dropdown .dropdown-trigger'); if (t) t.click(); });
await page.waitForTimeout(500);
await capture('27-export-dropdown', '#export-dropdown-menu', 'click .dropdown-trigger');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// ── topbar shelf modals ───────────────────────────────────────────────────
await page.evaluate(() => { const b = document.getElementById('yaab-btn-changelog'); if (b) b.click(); });
await page.waitForTimeout(900);
await capture('28-changelog', '.changelog-modal', 'click #yaab-btn-changelog');
await dismiss();
await page.evaluate(() => { const b = document.getElementById('yaab-btn-bug-report'); if (b) b.click(); });
await page.waitForTimeout(900);
await capture('29-bug-report', '.bug-report-modal', 'click #yaab-btn-bug-report');
await dismiss();

// ── the 16 dropped 'primary' actions — measure reachability ───────────────
// Each has NO toolbar button (UI.actionCenter is undefined). Fire the hook
// directly and record that the DOM route was missing.
const HOOKED = [
  ['30-match-mode',    'yaab-btn-match',           '.mm-shell'],
  ['31-analytics',     'yaab-btn-analytics',       '.yaab-an-modal'],
  ['32-damage-calc',   'yaab-btn-dmgcalc',         '.yaab-dc-modal'],
  ['33-stratagems',    'yaab-btn-stratagems',      '.strat-modal'],
  ['34-crusade',       'yaab-btn-crusade',         '.crusade-modal'],
  ['35-kill-team',     'yaab-btn-kill-team',       '#modal-kill-team .modal, #modal-kill-team'],
  ['36-deployment',    'yaab-btn-deploy',          '.yaab-dp-modal'],
  ['37-synergy',       'yaab-btn-synergy',         '.yaab-syn-modal'],
  ['38-opponent',      'yaab-btn-opponent',        '.yaab-opp-modal'],
  ['39-matchup',       'yaab-btn-matchup',         '.yaab-mu-modal'],
  ['40-army-diff',     'yaab-btn-history',         '#modal-army-diff .modal, #modal-army-diff'],
  ['41-activity-log',  'yaab-btn-activity-log',    '#modal-activity-log'],
  ['42-community',     'yaab-btn-community-feed',  '#modal-community-feed'],
  ['43-starter-lists', 'yaab-btn-starter-lists',   '#modal-starter-lists'],
  ['44-collection',    'yaab-btn-collection',      '.collection-modal'],
  ['45-points-override','yaab-btn-points-override','#modal-points-override'],
  ['46-tournament',    'yaab-btn-tournament',      '#modal-tp .tp-modal, #modal-tp'],
  ['47-list-coach',    'yaab-btn-list-coach',      '.list-coach-backdrop'],
  ['48-qr-share',      'yaab-btn-qr-share',        '#modal-qr-share'],
];
for (const [name, id, sel] of HOOKED) {
  bucket = name;
  const how = await page.evaluate((btnId) => {
    const el = document.getElementById(btnId);
    if (el && el.offsetParent !== null) { el.click(); return 'dom-button'; }
    if (el) { el.click(); return 'dom-hidden'; }
    const hooks = (window.App && App.hooks && App.hooks.armyToolbarActions) || [];
    for (const h of hooks) {
      if (h && h.id === btnId && typeof h.onClick === 'function') { try { h.onClick(); } catch (e) { return 'hook-threw:' + e.message.slice(0,80); } return 'hook-only'; }
    }
    return 'MISSING';
  }, id);
  await page.waitForTimeout(3200);   // lazy module fetch + mount
  await capture(name, sel, how);
  await dismiss();
}

// ── modes ─────────────────────────────────────────────────────────────────
for (const [name, mode, sel] of [
  ['50-mode-collect', 'collect', '#collect-mode'],
  ['51-mode-play',    'play',    '#play-mode'],
]) {
  bucket = name;
  const how = await page.evaluate((m) => {
    const tab = document.getElementById('topbar-mode-' + m);
    if (tab && tab.offsetParent !== null) { tab.click(); return 'mode-tab'; }
    if (window.App && App.setMode) { App.setMode(m); return 'App.setMode'; }
    return 'MISSING';
  }, mode);
  await page.waitForTimeout(2500);
  await capture(name, sel, how);
}

// collect sub-tabs
await page.evaluate(() => window.App && App.setMode && App.setMode('collect'));
await page.waitForTimeout(2000);
for (const tab of ['painting', 'crusade', 'kill-team']) {
  await page.evaluate(t => { const b = document.querySelector(`.collect-subtab[data-tab="${t}"]`); if (b) b.click(); }, tab);
  await page.waitForTimeout(1600);
  await capture(`52-collect-${tab}`, '#collect-body', `.collect-subtab[data-tab=${tab}]`);
}
// play sub-tabs
await page.evaluate(() => window.App && App.setMode && App.setMode('play'));
await page.waitForTimeout(2000);
for (const tab of ['match', 'stratagems', 'calc', 'opponent', 'deploy']) {
  await page.evaluate(t => { const b = document.querySelector(`.play-tab[data-play-tab="${t}"]`); if (b) b.click(); }, tab);
  await page.waitForTimeout(1500);
  await capture(`53-play-${tab}`, `#play-panel-${tab}`, `.play-tab[data-play-tab=${tab}]`);
}
await page.evaluate(() => window.App && App.setMode && App.setMode('build'));
await page.waitForTimeout(1500);

// cards mode
bucket = '54-cards';
const cardsHow = await page.evaluate(() => {
  const b = document.getElementById('btn-data-cards');
  if (b) { b.click(); return 'btn-data-cards'; }
  if (window.App && App.setMode) { App.setMode('cards'); return 'App.setMode'; }
  return 'MISSING';
});
await page.waitForTimeout(3500);
await capture('54-cards-mode', '#cards-mode .cards-shell, #cards-mode', cardsHow);
for (const st of ['cards', 'layout', 'display']) {
  await page.evaluate(s => { const b = document.querySelector(`.cards-subtab[data-subtab="${s}"]`); if (b) b.click(); }, st);
  await page.waitForTimeout(1200);
  await capture(`55-cards-${st}`, '#cards-side-body', `.cards-subtab[data-subtab=${st}]`);
}
await page.evaluate(() => window.App && App.setMode && App.setMode('build'));
await page.waitForTimeout(1500);

// ── done ──────────────────────────────────────────────────────────────────
R.errors = errors;
R.counts = { attempted, opened, shot, missed: attempted - opened };
writeFileSync(`${OUT}/report.json`, JSON.stringify(R, null, 2));
console.log(`\nsurfaces attempted=${attempted} opened=${opened} missed=${attempted - opened} screenshots=${shot}`);
const missed = R.surfaces.filter(s => !s.mounted).map(s => `${s.name}(${s.how})`);
console.log(`MISSED: ${missed.length ? missed.join(', ') : '(none)'}`);
console.log(`errors: ${errors.length}`);
console.log(`report: ${OUT}/report.json`);
await ctx.close();
await browser.close();
