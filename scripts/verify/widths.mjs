// widths.mjs — sweep the viewport width range looking for layout breakage that
// neither 1440 nor 390 would find. yaab declares ~22 distinct breakpoints, and
// the known open issue #66 (topbar hero colliding with the ACCOUNT button)
// lives at 820-1100px — invisible at both standard widths.
//
//   THEME=brutalist ~/sites/base/browser/browse.sh run \
//     ~/sites/sites/yetanotherarmybuilder/app/scripts/verify/widths.mjs \
//     ~/sites/base/browser/out/yaab-widths-brutalist
//
// READ-ONLY.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT   = process.env.OUT || '/out';
const THEME = process.env.THEME || 'grimdark';
const SITE  = 'https://yaab.thewheeliebois.com/';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [360, 390, 480, 600, 700, 760, 820, 860, 900, 960, 1024, 1100, 1200, 1440, 1600];

const PROBE = () => {
  const out = { overflow: [], collision: [], clipped: [] };
  const path = el => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 3; n = n.parentElement) {
      let b = n.tagName.toLowerCase();
      if (n.id) { bits.unshift(b + '#' + n.id); break; }
      if (n.className && typeof n.className === 'string') b += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      bits.unshift(b);
    }
    return bits.join('>');
  };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) out.overflow.push({ sel: 'html', scroll: de.scrollWidth, client: de.clientWidth });

  const CTRL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="menuitem"]';
  const live = [];
  for (const el of document.querySelectorAll(CTRL)) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue;
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (!(top && (top === el || el.contains(top) || top.contains(el)))) continue;
    live.push({ el, r });
    // clipped off the right edge of the viewport
    if (r.left < de.clientWidth && r.right > de.clientWidth + 2)
      out.clipped.push({ sel: path(el), right: +r.right.toFixed(0), vw: de.clientWidth, text: (el.textContent||'').trim().slice(0,30) });
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
    const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (ox > 3 && oy > 3) {
      const area = ox * oy, sm = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      if (sm > 0 && area / sm > 0.18) out.collision.push({ a: path(A.el), b: path(B.el), overlap: +(area / sm).toFixed(2) });
    }
  }
  return out;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
await ctx.addInitScript(t => { try { localStorage.setItem('yaab_theme', t); } catch (_) {} }, THEME);
const page = await ctx.newPage();
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const n = await page.evaluate(() => document.querySelectorAll('#unit-grid .unit-card').length).catch(() => 0);
  if (n > 0) break;
  await page.waitForTimeout(1000);
}
// seed content so the hero, points bar and army panel are all populated
await page.evaluate(() => {
  const s = document.getElementById('army-faction-select');
  if (!s) return;
  const o = Array.from(s.options).find(x => /Blood Angels/i.test(x.value)) || Array.from(s.options).filter(x => x.value && x.value !== 'all')[0];
  if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const cb = document.querySelector('#detachments-body input.detachment-row-cb');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  const c = document.querySelector('#unit-grid .unit-card');
  if (c) c.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => { const b = document.querySelector('#btn-detail-add, #btn-add-to-army'); if (b) b.click(); });
await page.waitForTimeout(1500);

const rows = [];
for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(1200);
  const p = await page.evaluate(PROBE).catch(e => ({ error: e.message }));
  const n = { w, overflow: p.overflow?.length || 0, collision: p.collision?.length || 0, clipped: p.clipped?.length || 0 };
  rows.push({ ...n, detail: p });
  console.log(`w=${String(w).padStart(4)}  overflow:${n.overflow}  collision:${n.collision}  clipped:${n.clipped}` +
    (p.collision?.length ? `  e.g. ${p.collision[0].a} × ${p.collision[0].b}` : ''));
  if (n.overflow || n.collision || n.clipped) await page.screenshot({ path: `${OUT}/${THEME}-w${w}.png`, fullPage: false }).catch(() => {});
}
writeFileSync(`${OUT}/widths.json`, JSON.stringify({ theme: THEME, rows }, null, 2));
console.log(`\nreport: ${OUT}/widths.json`);
await ctx.close();
await browser.close();
