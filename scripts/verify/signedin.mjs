// signedin.mjs — yaab signed-in + admin verification.
//
// WRITES TO THE LIVE DATABASE. Run SERIALLY, never alongside another writer.
// Everything it creates is named with a fixture tag and removed afterwards.
//
//   STAGE=register FIXTURE_USER=zz_verify_x FIXTURE_PASS=... \
//     BROWSE_ENV="STAGE FIXTURE_USER FIXTURE_PASS THEME" \
//     ~/sites/base/browse.sh run .../signedin.mjs <outdir>
//
// STAGE=register — create the fixture account, capture the pending-approval
//                  state (registration deliberately issues no cookie).
// STAGE=admin    — sign in as the (externally approved + promoted) fixture
//                  account and exercise the account menu + admin panel.
//
// It NEVER clicks approve/revoke on a row that is not the fixture user.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT   = process.env.OUT || '/out';
const STAGE = process.env.STAGE || 'register';
const THEME = process.env.THEME || 'grimdark';
const USER  = process.env.FIXTURE_USER;
const PASS  = process.env.FIXTURE_PASS;
const SITE  = 'https://yaab.thewheeliebois.com/';
if (!USER || !PASS) { console.log('FIXTURE_USER and FIXTURE_PASS are required'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const results = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  results.push({ label, ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 300) });
  ok ? pass++ : fail++;
};
async function until(page, fn, { timeout = 15000, step = 250, arg } = {}) {
  const d = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > d) return null;
    await page.waitForTimeout(step);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
await ctx.addInitScript(t => { try { localStorage.setItem('yaab_theme', t); } catch (_) {} }, THEME);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('EXCEPTION ' + e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'error' && !/401|auth\/me|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
page.on('dialog', async d => { await d.dismiss().catch(() => {}); });
const shot = n => page.screenshot({ path: `${OUT}/${STAGE}-${THEME}-${n}.png` }).catch(() => {});

await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 180000 });
await until(page, () => document.querySelectorAll('#unit-grid .unit-card').length > 0, { timeout: 240000, step: 1000 });

if (STAGE === 'register') {
  await page.evaluate(() => UI.showAuthModal('register'));
  await page.waitForSelector('#auth-reg-user', { timeout: 15000 });
  await shot('01-register-form');
  await page.fill('#auth-reg-user', USER);
  await page.fill('#auth-reg-pass', PASS);
  await page.fill('#auth-reg-pass2', PASS);
  await shot('02-register-filled');
  await page.click('#auth-form-register .auth-form-submit');
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => {
    const m = document.querySelector('#modal-auth .modal');
    const code = document.querySelector('.auth-recovery-code');
    const err = document.querySelector('.auth-error:not([hidden])');
    return {
      text: m ? m.textContent.slice(0, 400) : null,
      code: code ? code.textContent.trim() : null,
      error: err ? err.textContent.trim() : null,
    };
  });
  check('register succeeded', !!after.code, after.error || (after.text || '').slice(0, 120));
  check('register shows a recovery code', !!after.code && after.code.length > 6, after.code ? `${after.code.length} chars` : 'none');
  check('register states the account is PENDING approval', /pending|await/i.test(after.text || ''), (after.text || '').slice(0, 160));
  await shot('03-recovery-code');
  writeFileSync(`${OUT}/register.json`, JSON.stringify({ user: USER, recoveryCode: after.code, pendingText: after.text, results }, null, 2));

  // signing in while pending must be refused
  await page.evaluate(() => UI.showAuthModal('login'));
  await page.waitForSelector('#auth-login-user', { timeout: 10000 });
  await page.fill('#auth-login-user', USER);
  await page.fill('#auth-login-pass', PASS);
  await page.click('#auth-form-login .auth-form-submit');
  await page.waitForTimeout(3500);
  const denied = await page.evaluate(() => {
    const e = document.querySelector('.auth-error:not([hidden])');
    return { err: e ? e.textContent.trim() : null, signedIn: !!(window.App && App.Auth && App.Auth.user && App.Auth.user()) };
  });
  check('pending account cannot sign in', !denied.signedIn, denied.err || 'no error shown');
  check('pending sign-in explains WHY (not a generic failure)', /approv|pending/i.test(denied.err || ''), denied.err || 'none');
  await shot('04-pending-login-refused');

} else if (STAGE === 'admin') {
  await page.evaluate(() => UI.showAuthModal('login'));
  await page.waitForSelector('#auth-login-user', { timeout: 15000 });
  await page.fill('#auth-login-user', USER);
  await page.fill('#auth-login-pass', PASS);
  await page.click('#auth-form-login .auth-form-submit');
  await page.waitForTimeout(4500);
  const me = await page.evaluate(() => {
    const u = window.App && App.Auth && App.Auth.user && App.Auth.user();
    return u ? { username: u.username, is_admin: !!u.is_admin } : null;
  });
  check('fixture account signs in', !!me, me ? JSON.stringify(me) : 'not signed in');
  check('fixture account is admin', !!(me && me.is_admin));
  await shot('10-signed-in');

  // account button + dropdown
  await page.evaluate(() => { const b = document.getElementById('yaab-btn-auth'); if (b) b.click(); });
  await page.waitForTimeout(900);
  const menu = await page.evaluate(() => {
    const m = document.getElementById('yaab-auth-menu');
    return m ? Array.from(m.querySelectorAll('.auth-menu-item')).map(i => i.textContent.trim()) : null;
  });
  check('account menu opens when signed in', !!menu && menu.length > 0, menu ? menu.join(' | ') : 'none');
  check('account menu offers Admin', !!menu && menu.some(i => /admin/i.test(i)), menu ? menu.join(' | ') : '');
  await shot('11-account-menu');

  // admin panel
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#yaab-auth-menu .auth-menu-item'));
    const a = items.find(i => /admin/i.test(i.textContent));
    if (a) a.click();
  });
  await page.waitForTimeout(3500);
  const adminOpen = await page.evaluate(() => !!document.querySelector('.admin-modal'));
  check('admin panel opens', adminOpen);
  await shot('12-admin-open');

  if (adminOpen) {
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.admin-tab')).map(t => ({ tab: t.getAttribute('data-tab'), label: t.textContent.trim() })));
    check('admin panel has its tabs', tabs.length >= 3, tabs.map(t => t.tab).join(', '));
    for (const t of tabs) {
      await page.evaluate(tab => { const b = document.querySelector(`.admin-tab[data-tab="${tab}"]`); if (b) b.click(); }, t.tab);
      await page.waitForTimeout(2200);
      const body = await page.evaluate(() => {
        const b = document.getElementById('admin-body');
        return { has: !!b, empty: !!document.querySelector('.admin-empty'), len: b ? b.textContent.trim().length : 0 };
      });
      check(`admin tab "${t.tab}" renders content`, body.has && (body.len > 0), `${body.len} chars${body.empty ? ' (empty-state)' : ''}`);
      await shot(`13-admin-${t.tab}`);
    }
    // the fixture row must be listed — but do NOT act on any other row
    const rows = await page.evaluate(u => {
      const els = Array.from(document.querySelectorAll('#admin-body [data-act], #admin-body tr, #admin-body .admin-row'));
      return { total: els.length, mentionsFixture: document.getElementById('admin-body').textContent.includes(u) };
    }, USER);
    check('admin Users view lists the fixture account', rows.mentionsFixture, `${rows.total} row elements`);
  }

  // change password (fixture account only)
  await page.evaluate(() => { const b = document.querySelector('.admin-close'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => UI.showAuthModal('change-password'));
  await page.waitForSelector('#auth-cp-old', { timeout: 10000 }).catch(() => {});
  await shot('14-change-password');
  const cpOk = await page.evaluate(() => !!document.getElementById('auth-cp-old'));
  check('change-password form renders', cpOk);

  // sync now
  await page.evaluate(() => { const b = document.getElementById('yaab-btn-auth'); if (b) b.click(); });
  await page.waitForTimeout(700);
  const syncClicked = await page.evaluate(() => {
    const i = Array.from(document.querySelectorAll('#yaab-auth-menu .auth-menu-item')).find(x => /sync/i.test(x.textContent));
    if (i) { i.click(); return true; }
    return false;
  });
  await page.waitForTimeout(3000);
  check('"Sync now" is available and runs', syncClicked, syncClicked ? '' : 'menu item not found');
  await shot('15-after-sync');
}

writeFileSync(`${OUT}/${STAGE}.json`, JSON.stringify({ stage: STAGE, theme: THEME, user: USER, pass, fail, results, errors }, null, 2));
console.log(`\npassed ${pass}, failed ${fail}`);
if (fail) console.log('failed: ' + results.filter(r => !r.ok).map(r => r.label).join('; '));
console.log('errors: ' + (errors.length ? [...new Set(errors)].slice(0, 8).join(' | ') : '(none)'));
await ctx.close();
await browser.close();
