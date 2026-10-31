// _lib.mjs — shared Playwright boilerplate for yaab's hand-run browser scripts.
// browse.sh copies this beside the `.run-$$.mjs` copy of whichever script it
// runs, so `import ... from './_lib.mjs'` works from scripts/ and scripts/verify/.
// NEVER use page.waitForFunction here or in a script: it needs eval and yaab's
// CSP has no 'unsafe-eval', so it throws instantly. Poll via page.evaluate
// (`until`) or use waitForSelector.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const SITE = process.env.SITE || 'https://yaab.thewheeliebois.com';
export const BASE = SITE;
export const OUT = process.env.OUT || '/out';
mkdirSync(OUT, { recursive: true });

export const launch = () => chromium.launch();

// Context + page. `theme` seeds localStorage yaab_theme before any script runs.
export async function newPage(browser, { viewport = { width: 1440, height: 900 }, theme, reducedMotion, ...rest } = {}) {
  const ctx = await browser.newContext({
    viewport, ignoreHTTPSErrors: true, ...(reducedMotion ? { reducedMotion } : {}), ...rest,
  });
  if (theme) await ctx.addInitScript(t => { try { localStorage.setItem('yaab_theme', t); } catch (_) {} }, theme);
  return { ctx, page: await ctx.newPage() };
}

// Poll a page.evaluate until truthy (null on timeout).
export async function until(page, fn, { timeout = 15000, step = 250, arg } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(step);
  }
}

// Collectors. Always: pageerror + console errors (401/auth-me/favicon noise
// filtered unless `all`). Opt in with {requests:true} / {responses:true}.
export function wire(page, tag = '', { all = false, requests = false, responses = false } = {}) {
  const errors = [];
  const t = s => (tag ? `${tag} ` : '') + s;
  page.on('pageerror', e => errors.push(t('EXCEPTION ' + e.message.slice(0, 200))));
  page.on('console', m => {
    if (m.type() === 'error' && (all || !/401|auth\/me|favicon/.test(m.text()))) errors.push(t('console: ' + m.text().slice(0, 200)));
  });
  if (requests) page.on('requestfailed', r => errors.push(t(`requestfailed: ${r.url()} ${r.failure()?.errorText || ''}`.slice(0, 200))));
  if (responses) page.on('response', r => { if (r.status() >= 400) errors.push(t(`http ${r.status()}: ${r.url()}`.slice(0, 200))); });
  return errors;
}

// `ok  label  [detail]` / `FAIL  label  [detail]`. `strict` prints a falsy but
// defined detail (0, '') too; default prints only truthy ones.
export function makeChecker({ strict = false } = {}) {
  let pass = 0, fail = 0;
  const results = [], fails = [];
  function check(label, ok, detail) {
    const show = strict ? detail !== undefined : !!detail;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${show ? `  [${detail}]` : ''}`);
    results.push({ label, ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 300) });
    if (ok) pass++; else { fail++; fails.push(label); }
  }
  // Prints `\n<prefix>N passed, M failed[:\n  - fail...]`, returns fail count.
  function summary({ prefix = '', list = false } = {}) {
    console.log(`\n${prefix}${pass} passed, ${fail} failed${list && fail ? ':\n  - ' + fails.join('\n  - ') : ''}`);
    return fail;
  }
  return { check, results, fails, summary, get pass() { return pass; }, get fail() { return fail; } };
}

// goto + wait for the roster + short settle. Returns false if it never booted.
export async function boot(page, { state = 'attached', url = SITE, timeout = 240000, settle = 300 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  try { await page.waitForSelector('#unit-grid .unit-card', { state, timeout }); }
  catch (_) { return false; }
  await page.waitForTimeout(settle);
  return true;
}
