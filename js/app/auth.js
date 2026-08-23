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

  let _user = null;             // { username } when signed in, null otherwise
  const _listeners = [];        // [(user) => void]

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

  function notify() {
    for (let i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_user); } catch (e) { console.warn('[Auth.onChange]', e); }
    }
  }

  function setUser(user) {
    const wasSignedIn = !!_user;
    const isSignedIn = !!user;
    _user = user || null;
    writeHint(_user);
    if (wasSignedIn !== isSignedIn || (user && (!_user || user.username !== _user.username))) {
      notify();
    } else if (isSignedIn) {
      // Username unchanged — still notify in case listeners care.
      notify();
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

  // Wipe every localStorage key that belonged to the account we just left and
  // reset the in-memory army list, so the UI stops showing armies that are no
  // longer on this device.
  //
  // The key list is App.Sync.ACCOUNT_LOCAL_KEYS and is NOT duplicated here —
  // read the comment on it in js/app/sync.js for the cross-account leak (issue
  // #51) that two hand-copied copies of this list caused.
  //
  // If App.Sync is somehow absent the sync layer never loaded, which means
  // there is no queue to drain and nothing can reach the cloud, so wiping
  // nothing is safe rather than fail-open.
  function forgetAccountData() {
    try {
      const keys = (App.Sync && App.Sync.ACCOUNT_LOCAL_KEYS) || [];
      for (let i = 0; i < keys.length; i++) {
        try { localStorage.removeItem(keys[i]); } catch (_) {}
      }
      if (App.state && App.state.armyManager) {
        App.state.armyManager.armies = [];
        App.state.currentArmy = App.state.armyManager.newArmy();
        if (typeof App.renderAll === 'function') App.renderAll();
      }
    } catch (_) {}
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
      Auth.primeFromHint();
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
          setUser(null);
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

    async logout() {
      try { await jsonFetch('/logout', { method: 'POST' }); }
      catch (_) {}
      setUser(null);
    },

    // The ONE sign-out flow. Two entry points call it: the topbar auth-button
    // menu (js/ui/auth-button.js) and the Settings drawer (js/app/
    // settings-drawer.js). They used to be two copies of these twenty lines,
    // hand-copied wipe list included, and the lists drifted — issue #51.
    // A new sign-out entry point calls this; it does not copy the body.
    //
    // "Also remove data" clears everything in App.Sync.ACCOUNT_LOCAL_KEYS,
    // which includes yaab_theme: the chosen theme is account-synced, so it
    // goes with the rest of the account's data and the app falls back to the
    // default theme on the next load.
    //
    // Returns { removedData } so a caller can tell which branch ran.
    async signOut() {
      const keep = confirm('Sign out?\n\nClick OK to keep your synced data on this device. Click Cancel to also remove it from this device.');
      try { await Auth.logout(); } catch (_) {}
      if (!keep) forgetAccountData();
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('Signed out.', 'info', 2200);
      }
      return { removedData: !keep };
    },

    async recover(username, recoveryCode, newPassword) {
      const data = await jsonFetch('/recover', {
        method: 'POST',
        body: { username, recoveryCode, newPassword },
      });
      return data;
    },

    async changePassword(oldPassword, newPassword) {
      const data = await jsonFetch('/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      });
      return data;
    },

    // Called by Sync when any /api/* request returns 401 mid-session.
    // Flips us to logged-out without an explicit logout call.
    handleSessionExpired() {
      if (_user) {
        setUser(null);
        if (window.UI && typeof UI.toast === 'function') {
          UI.toast('Your session expired — sign in again to keep syncing.', 'warning', 5000);
        }
      }
    },
  };

  App.Auth = Auth;
})();
