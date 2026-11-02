# Login gate — 2026-11-02 (contract)

Owner decision 2026-11-02: yaab is no longer publicly visible. Every request
to `yaab.thewheeliebois.com` needs a signed-in, approved yaab account, except
the sign-in page and the auth API routes it calls. Accounts are the existing
yaab accounts (register → owner approves in the admin panel → sign in).

## 1. Caddy (`~/sites/base/conf.d/yetanotherarmybuilder.caddy`, session)

- `handle_path /api/*` → yaab-api as today (the API keeps its own per-route
  auth; `/api/auth/login|register|recover|logout|me` are reachable signed out).
- `@public path /login /login/* /css/tokens.css /js/vendor/fonts/* /img/*`
  → served from `app/` with no auth (the sign-in page and what it needs).
- everything else → `forward_auth yaab-api:3000 { uri /auth/me }`; on 401/403
  `redir /login?next={uri} 302`. The `wb_session` strip applies to the
  forward_auth request too. The Cookie header (yaab's own session cookie) is
  forwarded, which is how `/auth/me` answers 200.
- `/sw.js`, `/data/dataset/*`, `index.html`, all JS/CSS are therefore gated.

## 2. Sign-in page (W-L) — `app/login/index.html`, `app/login/login.js`, `app/login/login.css`

Static, buildless, no framework. CSP is the site's: `script-src 'self'`
(so JS is the external file, no inline handlers), `style-src 'self'
'unsafe-inline'`. Loads `/css/tokens.css` and the Cinzel fonts from
`/js/vendor/fonts/` (see index.html `<link rel=preload>` lines for the
paths/@font-face in css/tokens.css or base.css); everything else is in
login.css, dark ground like the app (grimdark tokens; the page does not need
the theme switcher). Title "Sign in · YAAB". Phone-first, 16px side gutters.

Three panes, one visible at a time, switched by links (no page reloads):

1. **Sign in** (default): username, password, "Sign in" button (primary),
   links "Create account" and "Forgot password?".
   `POST /api/auth/login` JSON `{username, password}`, `credentials: 'same-origin'`.
   200 → `location.replace(next)`. 401 → "Wrong username or password."
   403 with `error: 'pending_approval'` → "Your account is waiting for
   approval. You'll be able to sign in once Alec approves it." 429 → "Too many
   attempts, wait a minute." Anything else → "Sign-in failed (HTTP n)."
2. **Create account**: username, password, confirm password, "Create account".
   `POST /api/auth/register` `{username, password}`. 200 `{pending: true,
   recoveryCode}` → replace the pane with: the recovery code in a large
   monospace box, a "Copy" button, the sentence "Write this down: it is the
   only way back in if you forget your password. It will not be shown again.",
   and "Your account now waits for approval; you'll be able to sign in once
   it is approved." 409/400 → show the API's `error` text (e.g. username
   taken, password rules). The username rule is the API's `USERNAME_RE` in
   `api/validate.js`; show it as hint text under the field.
3. **Recover**: username, recovery code, new password → `POST /api/auth/recover`
   `{username, recoveryCode, newPassword}`; 200 → the API set a session
   cookie, show the NEW recovery code the same way as pane 2, with a
   "Continue" button → `location.replace(next)`. 401 → "Username or recovery
   code not recognised."

`next` = the `next` query parameter if it is a same-origin path (starts
with `/`, not `//`, not `/login`), else `/`. Errors live in one `<p
role="alert">` per pane; buttons disable while a request is in flight; every
control is styled (no bare links styled as buttons; see `~/.claude/CLAUDE.md`
"Never ship an unstyled link or button"). Dark and light are NOT both needed;
the page uses the tokens' dark palette.

## 3. App edits (W-L)

- `js/app/auth.js` boot: when `/me` answers 401 (or no username), instead of
  anonymous mode do `location.replace('/login?next=' + encodeURIComponent(
  location.pathname + location.search + location.hash))`. Keep the network-
  error branch (offline) as is: a cached shell must still open offline.
- The existing "session-bearing call answered 401 → flip to signed out"
  path (`setUser(null, {reason:'expired'})` sites) → same redirect.
- `App.Auth.signOut()` / `logout()`: after the server logout and the local
  wipe, `location.replace('/login')`.
- `sw.js`: no change to caching rules; add a comment under the rules that the
  shell is gated by Caddy and a signed-out navigation is a 302 to /login, so
  rule "never cache-first" is what keeps a signed-out device from showing a
  stale shell forever.
- `scripts/verify/_lib.mjs` `boot()`: before `goto`, if `process.env.FIXTURE_USER`
  and `FIXTURE_PASS` are set, `await page.request.post(SITE + '/api/auth/login',
  {data:{username, password}})` (the context then holds the cookie); if after
  `goto` the URL starts with `/login`, print `FAIL boot: redirected to /login
  (set FIXTURE_USER/FIXTURE_PASS)` and return false. `scripts/play-e2e.mjs`
  uses `BASE` + its own goto: give it the same login step (import a helper
  `login(page)` from _lib.mjs).
- Docs: `docs/AUTH.md` gets a "Login gate" section (what is public, where
  the page lives, the fixture-account convention for suites), README's
  "public" wording fixed, `CLAUDE.md` in app/ notes the gate and that
  `browse.sh shot` now screenshots the sign-in page unless the script logs
  in.

## 4. Verification (session)

Signed-out: `/` → 302 → `/login?next=/`; `/data/dataset/current/manifest.json`
→ 302; `/login` 200 both widths and both PNGs read; wrong password → error
shown; `/api/auth/me` → 401. Signed-in: needs an approved fixture account —
the owner approves it (the session never creates or approves accounts).
