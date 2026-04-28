# AUTH.md

Reference for the username+password auth system that gates the cloud sync features. Frontend lives in `app/js/app/auth.js`, `app/js/ui/auth-modal.js`, and `app/js/ui/auth-button.js`. Backend lives in `api/auth.js` and `api/sessions.js`. For exhaustive backend behavior (rate-limit internals, schema, error codes), defer to `api/CLAUDE.md`; this doc is the client-side-first reference.

## 1. Model

Username + password only. No email, no email-based password reset, no OAuth. At register time the server mints a one-time recovery code (18 random bytes, base64url) and returns it once — the user must save it themselves; lost code without password = lost account by design. After successful register/login/recover the server issues a 30-day session in an httpOnly Secure SameSite=Lax cookie named `yaab_sid` ([api/sessions.js](../../api/sessions.js#L4)). The cookie is the source of truth on the client; everything else (the localStorage hint, `App.Auth._user`) is cosmetic UI state derived from it.

## 2. Endpoints (frontend → backend)

All requests are same-origin to `/api/auth/*` from [App.Auth](../js/app/auth.js#L13), JSON in / JSON out, `credentials: 'same-origin'`.

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | `{ username, password }` | `{ username, recoveryCode }` | Rate-limited 5/min/IP; sets `yaab_sid` |
| POST | `/auth/login` | `{ username, password }` | `{ username }` | Rate-limited 5/min/IP; sets `yaab_sid` |
| POST | `/auth/logout` | (empty) | `204` | Deletes session row, clears cookie |
| GET  | `/auth/me` | — | `{ username }` or `401` | Used by `Auth.init()` |
| POST | `/auth/recover` | `{ username, recoveryCode, newPassword }` | `{ username, recoveryCode }` | Rate-limited 5/min/IP; nukes ALL sessions; mints fresh recovery code |
| POST | `/auth/change-password` | `{ oldPassword, newPassword }` | `{ ok: true }` | Auth required; keeps current session, kills all others |

Routes are mounted under `/auth/*` server-side ([api/auth.js](../../api/auth.js#L26)) and reached as `/api/auth/*` from the client because Caddy strips the `/api` prefix (see `~/sites/CLAUDE.md` routing).

## 3. Frontend surfaces

### `App.Auth` — [app/js/app/auth.js](../js/app/auth.js)

Module-scope state:

- `_user` — `{ username }` when signed in, `null` otherwise.
- `_listeners` — onChange callbacks; fired by `notify()` ([auth.js#L45](../js/app/auth.js#L45)).
- `HINT_KEY = 'yaab_auth_session_hint'` — localStorage cosmetic cache so the topbar doesn't flash logged-out on reload before `/me` answers ([auth.js#L16](../js/app/auth.js#L16)). The cookie is the source of truth; the hint is purely UI optimism.

Public API (`window.App.Auth`):

| Function | Behavior |
|---|---|
| `init()` | Calls `primeFromHint()` then `GET /auth/me`. On 401 → `setUser(null)`. On network error → keeps the hint so UI doesn't flap (Sync treats us as offline). ([auth.js#L106](../js/app/auth.js#L106)) |
| `getCurrentUser()` | Returns `_user` or `null`. ([auth.js#L94](../js/app/auth.js#L94)) |
| `isSignedIn()` | `!!_user`. ([auth.js#L96](../js/app/auth.js#L96)) |
| `register(u, p)` | `POST /auth/register`; on success returns `{ username, recoveryCode }` (caller must show the code immediately — it is never returned again). ([auth.js#L126](../js/app/auth.js#L126)) |
| `login(u, p)` | `POST /auth/login`; sets `_user` from response or re-fetches `/me`. ([auth.js#L137](../js/app/auth.js#L137)) |
| `logout()` | `POST /auth/logout` (errors swallowed) then `setUser(null)`. ([auth.js#L151](../js/app/auth.js#L151)) |
| `recover(u, code, newPw)` | `POST /auth/recover`; server invalidates every existing session and issues a fresh cookie + new recovery code. ([auth.js#L157](../js/app/auth.js#L157)) |
| `changePassword(oldPw, newPw)` | `POST /auth/change-password`; current session survives, all others are deleted. ([auth.js#L165](../js/app/auth.js#L165)) |
| `onChange(fn)` | Subscribe to user-state transitions. Returns unsubscribe. ([auth.js#L86](../js/app/auth.js#L86)) |
| `handleSessionExpired()` | Called by Sync's `apiFetch` when any `/api/*` request returns 401 mid-session. Flips to signed-out and toasts a warning. ([auth.js#L175](../js/app/auth.js#L175)) |
| `primeFromHint()` | Reads `yaab_auth_session_hint`; if present, sets `_user` from it WITHOUT firing `onChange`. Used internally by `init()`. ([auth.js#L100](../js/app/auth.js#L100)) |

Internals to know about:

- `jsonFetch(path, opts)` ([auth.js#L64](../js/app/auth.js#L64)) — wraps `fetch(API + path, …)`. Always sends `Content-Type: application/json` + `Accept: application/json`, `credentials: 'same-origin'`. JSON-stringifies non-string bodies. Throws an Error with `.status` and `.data` on non-2xx so callers can branch on `err.status === 401 / 409`.
- `setUser(user)` ([auth.js#L51](../js/app/auth.js#L51)) — single funnel for state changes; updates `_user`, mirrors to/clears the hint, fires `notify()`.

### `UI.showAuthModal(mode, opts)` — [app/js/ui/auth-modal.js](../js/ui/auth-modal.js)

Single backdrop element `#modal-auth` declared in `index.html`. The module renders the body for the active view into `.modal` inside that backdrop ([auth-modal.js#L47](../js/ui/auth-modal.js#L47)).

Modes:

| Mode | Renderer | Notes |
|---|---|---|
| `'login'` (default) | `renderLogin()` ([L84](../js/ui/auth-modal.js#L84)) | Username + password. Links to register and recover. |
| `'register'` | `renderRegister()` ([L159](../js/ui/auth-modal.js#L159)) | Username (`[A-Za-z0-9_.-]{3,32}`) + password ×2. On success transitions in-place to `renderRecoveryCode`. |
| `'recovery-code'` | `renderRecoveryCode(code, username)` ([L259](../js/ui/auth-modal.js#L259)) | One-time view. The code is rendered via `textContent` only — never `innerHTML`. Copy + Download-as-.txt buttons. "I have saved this" checkbox is required before the Done button enables. |
| `'recover'` | `renderRecover()` ([L323](../js/ui/auth-modal.js#L323)) | username + recovery code + new password. On success closes and re-opens the login modal. |
| `'change-password'` | `renderChangePassword()` ([L397](../js/ui/auth-modal.js#L397)) | Old password + new ×2. |

Two patterns the renderers all share — both exist because of bugs that have already cost a debug session:

1. **`form="<FORM_ID>"` on submit buttons.** The submit `<button>` is rendered into `.modal-footer` (a sibling of the `<form>`, not a child), because the footer is visually pinned at the bottom of the modal. A submit button outside its form is inert unless it has a matching `form` attribute. Every render function defines `const FORM_ID = 'auth-form-<view>'` and sets `form: FORM_ID` on the button ([auth-modal.js#L113](../js/ui/auth-modal.js#L113), [L202](../js/ui/auth-modal.js#L202), [L358](../js/ui/auth-modal.js#L358), [L431](../js/ui/auth-modal.js#L431)). If you copy a renderer, keep this wiring.
2. **`setBody()` unwraps the outer `.modal`.** Render functions return `<div class="modal">…</div>` (so they read like complete modal trees in isolation). `setBody()` detects this and replaces `inner.replaceChildren(...node.childNodes)` so we don't end up with `.modal` nested in `.modal` ([auth-modal.js#L47](../js/ui/auth-modal.js#L47)). Nesting was pushing the footer below the viewport on mobile because the inner `.modal` ignored the outer's `max-height`.

Password fields are zeroed (`input.value = ''`) BEFORE the await in every submit handler so the cleartext password doesn't sit in the DOM longer than the network request.

### Topbar button — [app/js/ui/auth-button.js](../js/ui/auth-button.js)

Registers via `App.hooks.armyToolbarActions` ([auth-button.js#L130](../js/ui/auth-button.js#L130)):

```js
{ id: 'yaab-btn-auth', region: 'icon', label: 'Sign in', … }
```

`region: 'icon'` is special-cased so this one button stays on the topbar shelf even after the icon-shelf cleanup that routes most icon-region buttons into Settings. The placeholder rendered by the generic toolbar mounter is replaced in the `bootstrap` hook ([auth-button.js#L139](../js/ui/auth-button.js#L139)) with a fully managed element built by `buildSignedOut()` ([L14](../js/ui/auth-button.js#L14)) or `buildSignedIn(username)` ([L29](../js/ui/auth-button.js#L29)).

The bootstrap hook ALSO kicks off the auth + sync init chain:

```js
App.Auth.init().catch(()=>{}).finally(() => App.Sync.init());
```

Sync depends on Auth's resolved state, so it runs only after `/me` settles (or fails).

Signed-in state:

- Button shows username + caret (`<span class="auth-btn-caret">▾</span>`).
- Click toggles `.auth-menu` (`hidden` attribute drives `display: none` — see CSS bug below).
- Menu items: **Sync now** (calls `App.Sync.pullAll()` + `drainQueue()`), **Change password** (`UI.showAuthModal('change-password')`), **Sign out** (`confirm()` whether to keep local data or wipe the YAAB localStorage keys, then `Auth.logout()`).

Re-render is driven by `App.Auth.onChange(() => render())` ([auth-button.js#L150](../js/ui/auth-button.js#L150)); it swaps the DOM ref in place rather than re-running the toolbar mounter.

The button uses `topbar-action-btn` class (NOT `topbar-icon-btn`) so it visually matches Settings/Help.

## 4. CSRF defense

Two layers, no anti-CSRF tokens:

1. **`Content-Type: application/json` on every state-changing request.** The backend rejects non-JSON bodies, and a cross-origin form POST from another site cannot set this content type without triggering a CORS preflight that the server will refuse. `jsonFetch()` enforces this on the client ([auth.js#L68](../js/app/auth.js#L68)).
2. **`SameSite=Lax` cookie** ([api/sessions.js](../../api/sessions.js#L48)). Cross-site top-level POSTs do not carry the cookie.

No tokens in localStorage. Nothing the page JS can read. Session is httpOnly so XSS that reads `document.cookie` doesn't leak it.

## 5. Recovery code flow

1. **Generate** — `randomBytes(18).toString('base64url')` server-side at register ([api/auth.js#L18](../../api/auth.js#L18)). Returned to the client ONCE in the `/auth/register` response.
2. **Hash** — argon2id, default params, stored in `users.recovery_code_hash`. The plaintext code is never round-tripped after register.
3. **Display** — [renderRecoveryCode](../js/ui/auth-modal.js#L259) shows the code via `textContent` only. The user must check "I have saved this" before the Done button enables.
4. **Verify (recover)** — `/auth/recover` argon2.verifies the supplied code against the stored hash ([api/auth.js#L132](../../api/auth.js#L132)). On match it: hashes the new password, generates a *new* recovery code (and hashes that), updates `users`, calls `deleteAllUserSessions(user.id)` to invalidate every existing session for that user, then issues a fresh cookie. The new recovery code is returned in the response.
5. **Lost recovery code without password** — account is unrecoverable. There is no email reset path. This is intentional (see `~/sites/sites/yetanotherarmybuilder/CLAUDE.md` "Auth surface").

## 6. Password rules

- Min 8 chars, max 256 chars ([api/auth.js#L14](../../api/auth.js#L14)).
- No complexity rules (no required symbol/digit/case mix).
- No password rotation.
- No email recovery.
- HTML inputs cap at `maxlength="128"` for input-side sanity; the server accepts up to 256.
- Username must match `/^[A-Za-z0-9_.-]{3,32}$/` ([api/auth.js#L13](../../api/auth.js#L13)).

## 7. Rate limit

`@fastify/rate-limit` config: 5 requests per minute per IP, applied via `authLimit` route option to `/auth/register`, `/auth/login`, and `/auth/recover` ([api/auth.js#L27](../../api/auth.js#L27)). `/auth/logout`, `/auth/me`, and `/auth/change-password` are NOT rate-limited at the auth level (the latter requires an existing session anyway).

`/auth/login` runs `argon2.verify()` against a fixed dummy hash when the username doesn't exist ([api/auth.js#L83](../../api/auth.js#L83)) so wall-clock time is roughly equal between missing-user and wrong-password — prevents trivially probing for valid usernames by timing. `/auth/recover` does the same for the recovery-code lookup ([api/auth.js#L127](../../api/auth.js#L127)).

## 8. Session lifecycle

- TTL: `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000` ([api/sessions.js#L5](../../api/sessions.js#L5)).
- Storage: `sessions` table — `session_id` (32 random bytes base64url), `user_id`, `expires_at`. Indexed on `user_id` and `expires_at`.
- Cookie: `yaab_sid`, httpOnly, Secure, SameSite=Lax, `maxAge` in seconds (`Math.floor(SESSION_TTL_MS / 1000)`) ([api/sessions.js#L43](../../api/sessions.js#L43)).
- `loadSession(sid)` joins `sessions` × `users` and gates on `expires_at > now()` ([api/sessions.js#L21](../../api/sessions.js#L21)). Expired rows are NOT auto-deleted by reads — they just stop loading. (Some background prune job is implied but not in this file.)
- `logout` → `deleteSession(sid)` then `clearCookie` (`maxAge: 0`).
- `change-password` keeps the current `session_id` and runs `DELETE FROM sessions WHERE user_id = $1 AND session_id <> $2` to kill the rest ([api/auth.js#L179](../../api/auth.js#L179)).
- `recover` calls `deleteAllUserSessions(user.id)` then mints one fresh session — every device must re-auth.

## 9. Frontend reactions to 401

`App.Auth.handleSessionExpired()` ([auth.js#L175](../js/app/auth.js#L175)) is the single funnel for "the server says my cookie is dead." It:

1. Returns early if we already think we're signed out (avoids spamming toasts).
2. `setUser(null)` — fires `onChange`, which makes the topbar button re-render to its signed-out state and the auth menu close itself.
3. Toasts "Your session expired — sign in again to keep syncing." (warning, 5s).

Sync's `apiFetch` wrapper calls this whenever any `/api/*` request returns 401, so the user doesn't have to interact with the auth UI to be told they've been logged out — a stale Sync push is enough.

## 10. Bug history

One-liners worth keeping in your head when touching this surface:

- **Auth menu was always visible** — `.auth-menu` had `display: flex` which beat the `[hidden]` HTML attribute. Fixed by adding `.auth-menu[hidden] { display: none; }` ([css/auth.css#L42](../css/auth.css#L42)). Keep that rule.
- **Sign-in / Create-account submit buttons did nothing** — the submit `<button>` is rendered into `.modal-footer` (a sibling of `<form>`, not a child), and a submit button outside its form is inert. Fixed by giving each form an `id` and setting `form="<id>"` on the button. Don't move the button inside the form, and don't drop the `form` attribute.
- **Modal footer pushed offscreen on mobile** — `setBody()` was nesting `.modal` inside `.modal`; the inner one ignored the outer's `max-height: 80vh` so the footer rendered below the viewport. Fixed by detecting the wrapper and replacing with `inner.replaceChildren(...node.childNodes)` ([auth-modal.js#L47](../js/ui/auth-modal.js#L47)).
- **iOS keyboard hid the footer** — `max-height: 80vh` measured the layout viewport, not the visual viewport, so when the soft keyboard came up the submit button sat behind it. Fixed by switching to `80dvh` (and a top-anchor on narrow viewports — commit `ab8ad55`).
- **Caret was a CSS pseudo-element on the wrong selector** — caret styling now lives on a real `.auth-btn-caret` `<span>` inside the button so it can be styled and hidden independently (commit `654fd25`).

## 11. Don't break

- Cookie name is `yaab_sid`. The backend reads it out of `req.cookies[COOKIE_NAME]` in three places ([api/auth.js#L102](../../api/auth.js#L102), [L178](../../api/auth.js#L178), and via `loadSession` in the auth decorator). Renaming requires touching all of them and invalidating every existing session.
- Every state-changing route requires `Content-Type: application/json`. If you add a route, keep this contract — it's load-bearing for the CSRF defense.
- Render functions wrap their tree in `<div class="modal">`; `setBody()` relies on detecting and unwrapping that. Don't return a bare body or you'll lose the unwrap path.
- Topbar button uses `topbar-action-btn` (not `topbar-icon-btn`). Matches Settings/Help styling.
- `region: 'icon'` is special-cased in the toolbar mounter to keep this button on the shelf while other icon-region buttons go to Settings. Don't move it to a different region "for consistency."
- `App.Auth.init()` is called from the auth-button bootstrap hook and gates `App.Sync.init()` via `.finally()`. Don't call `Sync.init` independently before Auth has resolved — Sync needs to know whether to hit the network.
- The recovery code is `textContent` only. Never `innerHTML`. Never log it server-side. Never round-trip the plaintext after register/recover.
- `_user` updates go through `setUser()` so the hint stays in sync and `onChange` fires consistently. Don't poke `_user` directly.
- `handleSessionExpired()` is the only correct response to a 401 from `/api/*`. Don't swallow 401s in feature modules; pipe them through Sync's `apiFetch` so this funnel runs.
