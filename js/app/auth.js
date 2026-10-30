// app/auth.js — App.Auth: user session state + auth API calls.
//
// All requests are same-origin to /api/auth/*. The session is a server-issued
// httpOnly cookie; we never see it from JS. The combination of:
//   - SameSite=Lax cookie (server-set)
//   - Content-Type: application/json on every state-changing request
// is the CSRF defense — cross-origin attackers can't send a JSON content-type
// without triggering CORS preflight that the server will reject.
//
// We also mirror a tiny non-sensitive hint into localStorage so the UI can
// show "Signed in as <name>" instantly on reload, before /me responds.
// The cookie is the source of truth — the hint is purely cosmetic.
(function () {
  const App = window.App = window.App || {};

  const HINT_KEY = 'yaab_auth_session_hint';
  const API = '/api/auth';
  // A toast to show after a deliberate page reload (sign-out → remove data
  // reloads so every module drops its in-memory copy). sessionStorage, read
  // and cleared once by init().
  const FLASH_KEY = 'yaab_flash_toast';

  let _user = null;             // { username } when signed in, null otherwise
  const _listeners = [];        // [(user, meta) => void]

  function readHint() {
    try {
      const raw = localStorage.getItem(HINT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.username === 'string') return parsed;
    } catch (_) {}
    return null;
  }

  function writeHint(user) {
    try {
      if (user) {
        localStorage.setItem(HINT_KEY, JSON.stringify({
          username: user.username,
          sessionStartedAt: Date.now(),
        }));
      } else {
        localStorage.removeItem(HINT_KEY);
      }
    } catch (_) {}
  }

  // `meta` is optional context about WHY the user changed, passed as the
  // listener's second argument. Today only sign-out paths set it:
  // { reason: 'expired' } (the server dropped our session — 401) or
  // { reason: 'logout' } (the user asked). Listeners that don't care ignore it.
  function notify(meta) {
    for (let i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_user, meta); } catch (e) { console.warn('[Auth.onChange]', e); }
    }
  }

  function setUser(user, meta) {
    const wasSignedIn = !!_user;
    const isSignedIn = !!user;
    _user = user || null;
    writeHint(_user);
    if (wasSignedIn !== isSignedIn || (user && (!_user || user.username !== _user.username))) {
      notify(meta);
    } else if (isSignedIn) {
      // Username unchanged — still notify in case listeners care.
      notify(meta);
    }
  }

  async function jsonFetch(path, opts) {
    const init = Object.assign({
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    }, opts || {});
    if (init.body && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
    }
    const resp = await fetch(API + path, init);
    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }
    if (!resp.ok) {
      const err = new Error((data && data.error) || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Wipe every localStorage key that belonged to the account we just left,
  // then RELOAD the page.
  //
  // The key list is App.Sync.ACCOUNT_LOCAL_KEYS and is NOT duplicated here —
  // read the comment on it in js/app/sync.js for the cross-account leak (issue
  // #51) that two hand-copied copies of this list caused. App.Sync
  // .wipeAccountData() removes those keys and resets the in-memory army list.
  //
  // Why the reload: removing keys does not touch the copies other modules
  // hold in memory (reserves/requisitions QTY, favorites, collection, custom
  // names…). Their next write restored the removed data, and the next
  // account to sign in here received it. A reload is the one reset that
  // covers every module, including ones written later.
  //
  // If App.Sync is somehow absent the sync layer never loaded, which means
  // there is no queue to drain and nothing can reach the cloud, so wiping
  // nothing is safe rather than fail-open.
  function forgetAccountData(flashMsg) {
    try {
      if (App.Sync && typeof App.Sync.wipeAccountData === 'function') {
        App.Sync.wipeAccountData();
      } else {
        const keys = (App.Sync && App.Sync.ACCOUNT_LOCAL_KEYS) || [];
        for (let i = 0; i < keys.length; i++) {
          try { localStorage.removeItem(keys[i]); } catch (_) {}
        }
        if (App.state && App.state.armyManager) {
          App.state.armyManager.armies = [];
          App.state.currentArmy = App.state.armyManager.newArmy();
        }
      }
    } catch (_) {}
    try {
      if (flashMsg) sessionStorage.setItem(FLASH_KEY, JSON.stringify(flashMsg));
    } catch (_) {}
    try { window.location.reload(); } catch (_) {}
  }

  function showFlash() {
    let msg = null;
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) { sessionStorage.removeItem(FLASH_KEY); msg = JSON.parse(raw); }
    } catch (_) { msg = null; }
    if (!msg || typeof msg.text !== 'string') return;
    setTimeout(() => {
      if (window.UI && typeof UI.toast === 'function') UI.toast(msg.text, msg.type || 'info', msg.ms || 4000);
    }, 300);
  }

  const Auth = {
    onChange(fn) {
      if (typeof fn === 'function') _listeners.push(fn);
      return () => {
        const i = _listeners.indexOf(fn);
        if (i >= 0) _listeners.splice(i, 1);
      };
    },

    getCurrentUser() { return _user; },

    isSignedIn() { return !!_user; },

    // Show a stale hint immediately so UI doesn't flash logged-out on reload.
    // Real source of truth comes from init() → GET /me.
    primeFromHint() {
      const hint = readHint();
      if (hint) _user = { username: hint.username };
      return _user;
    },

    async init() {
      showFlash();
      const primed = Auth.primeFromHint();
      try {
        const me = await jsonFetch('/me');
        if (me && me.username) {
          // Carry over `is_admin` (and any other server-set flags) so the
          // admin UI can light up without an extra round trip. Server is
          // the source of truth — never trust a localStorage hint for it.
          setUser({ username: me.username, is_admin: !!me.is_admin });
        } else {
          setUser(null);
        }
      } catch (err) {
        if (err.status === 401) {
          // Only a device that THOUGHT it was signed in (a hint was present)
          // has an expired session to report; an anonymous visitor gets no
          // notification, as before.
          setUser(null, primed ? { reason: 'expired' } : undefined);
        } else {
          // Network error / server down — keep the hint so the UI doesn't
          // flap. Sync will treat us as offline.
        }
      }
      return _user;
    },

    isAdmin() {
      return !!(_user && _user.is_admin);
    },

    async register(username, password) {
      const data = await jsonFetch('/register', {
        method: 'POST',
        body: { username, password },
      });
      // When admin-approval is enabled, server returns { username,
      // recoveryCode, pending: true } and does NOT issue a session
      // cookie. Skip the auto-sign-in; the UI shows a pending notice.
      if (data && data.username && !data.pending) {
        setUser({ username: data.username, is_admin: !!data.is_admin });
      }
      return data; // { username, recoveryCode, pending? }
    },

    async login(username, password) {
      const data = await jsonFetch('/login', {
        method: 'POST',
        body: { username, password },
      });
      if (data && data.username) {
        setUser({ username: data.username, is_admin: !!data.is_admin });
      } else {
        // Server didn't echo username; trust the cookie + re-fetch /me
        await Auth.init();
      }
      return _user;
    },

    // The body is `{}` on purpose. jsonFetch always declares
    // Content-Type: application/json (the CSRF defence above), and Fastify
    // rejects a JSON content-type with an EMPTY body (FST_ERR_CTP_EMPTY_JSON
    // _BODY → 400) before the route runs. Bodyless, every browser sign-out
    // 400'd: the server session was never deleted and the cookie never
    // cleared, so the next reload's /me signed the browser straight back in
    // (seen in the Caddy access log, 2026-10-30).
    async logout() {
      try { await jsonFetch('/logout', { method: 'POST', body: {} }); }
      catch (_) {}
      setUser(null, { reason: 'logout' });
    },

    // The ONE sign-out flow. Two entry points call it: the topbar auth-button
    // menu (js/ui/auth-button.js) and the Settings drawer (js/app/
    // settings-drawer.js). They used to be two copies of these twenty lines,
    // hand-copied wipe list included, and the lists drifted — issue #51.
    // A new sign-out entry point calls this; it does not copy the body.
    //
    // A styled three-button dialog (UI.showAuthChoice) replaced a confirm()
    // whose Cancel was the DESTRUCTIVE choice and which could not be backed
    // out of at all. Now:
    //   Keep local data   → sign out; everything stays on this device. The
    //                       data stays tagged with this account (sync's
    //                       yaab_sync_owner), so a different account signing
    //                       in here is asked what to do with it instead of
    //                       absorbing it.
    //   Remove local data → while still signed in, drain the sync queue
    //                       (so unsynced edits reach the cloud first), then
    //                       sign out, wipe App.Sync.ACCOUNT_LOCAL_KEYS and
    //                       reload. Includes yaab_theme: the theme is
    //                       account-synced, so it goes with the account.
    //   Cancel (×, Escape, backdrop) → nothing happens, still signed in.
    //
    // Returns { removedData, cancelled } so a caller can tell which ran. On
    // "remove" the page reloads, so a caller's code after the await may not
    // get to run.
    async signOut() {
      const pending = (App.Sync && typeof App.Sync.queueLength === 'function') ? App.Sync.queueLength() : 0;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = [
        'Keep local data: your armies, collection and settings stay on this device. They will not sync while you are signed out.',
        'Remove local data: they are deleted from this device. Everything already synced stays in your account.',
      ];
      if (pending) {
        message.push(offline
          ? `${pending} change${pending === 1 ? ' has' : 's have'} not synced yet and you are offline — removing local data would lose ${pending === 1 ? 'it' : 'them'}.`
          : `${pending} change${pending === 1 ? ' has' : 's have'} not synced yet — they are uploaded first if you remove local data.`);
      }
      let choice = 'keep';
      if (window.UI && typeof UI.showAuthChoice === 'function') {
        choice = await UI.showAuthChoice({
          title: 'Sign out?',
          message,
          cancelId: 'cancel',
          dismissible: true,
          choices: [
            { id: 'keep',   label: 'Keep local data',   className: 'btn btn-accent' },
            { id: 'remove', label: 'Remove local data', className: 'btn btn-danger' },
            { id: 'cancel', label: 'Cancel',            className: 'btn btn-outline' },
          ],
        });
      }
      if (choice !== 'keep' && choice !== 'remove') return { removedData: false, cancelled: true };

      if (choice === 'remove') {
        let drained = true;
        if (App.Sync && typeof App.Sync.drainNow === 'function') {
          try { drained = await App.Sync.drainNow(8000); } catch (_) { drained = false; }
        }
        const left = (App.Sync && typeof App.Sync.queueLength === 'function') ? App.Sync.queueLength() : 0;
        try { await Auth.logout(); } catch (_) {}
        forgetAccountData({
          text: (!drained && left)
            ? `Signed out and removed local data. ${left} unsynced change${left === 1 ? '' : 's'} could not be uploaded first.`
            : 'Signed out and removed local data from this device.',
          type: (!drained && left) ? 'warning' : 'info',
          ms: 5000,
        });
        return { removedData: true, cancelled: false };
      }

      try { await Auth.logout(); } catch (_) {}
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('Signed out.', 'info', 2200);
      }
      return { removedData: false, cancelled: false };
    },

    // POST /auth/recover rotates the password AND the recovery code, ends
    // every other session and signs this browser in. The response carries
    // the NEW code ({ username, recoveryCode }); the caller must show it —
    // the old one is dead the moment this returns.
    async recover(username, recoveryCode, newPassword) {
      const data = await jsonFetch('/recover', {
        method: 'POST',
        body: { username, recoveryCode, newPassword },
      });
      if (data && data.username) {
        setUser({ username: data.username, is_admin: false });
        // The response has no is_admin; learn it from /me in the background.
        jsonFetch('/me').then((me) => {
          if (me && me.username && _user && me.username === _user.username && !!me.is_admin !== !!_user.is_admin) {
            setUser({ username: me.username, is_admin: !!me.is_admin });
          }
        }).catch(() => {});
      }
      return data;
    },

    // change-password answers 401 both for "not signed in" and for "old
    // password is incorrect". Ask /me which it was: a dead session is
    // handled like every other 401 on a session-bearing call (flip to
    // signed out) and the error is tagged `sessionExpired` so the modal says
    // so, instead of "Current password is incorrect".
    async changePassword(oldPassword, newPassword) {
      try {
        return await jsonFetch('/change-password', {
          method: 'POST',
          body: { oldPassword, newPassword },
        });
      } catch (err) {
        if (err && err.status === 401) {
          let expired = false;
          try { await jsonFetch('/me'); }
          catch (e2) { expired = !!(e2 && e2.status === 401); }
          if (expired) {
            err.sessionExpired = true;
            Auth.handleSessionExpired();
          }
        }
        throw err;
      }
    },

    // Called by Sync when any /api/* request returns 401 mid-session.
    // Flips us to logged-out without an explicit logout call.
    handleSessionExpired() {
      if (_user) {
        setUser(null, { reason: 'expired' });
        if (window.UI && typeof UI.toast === 'function') {
          UI.toast('Your session expired — sign in again to keep syncing.', 'warning', 5000);
        }
      }
    },
  };

  App.Auth = Auth;
})();
