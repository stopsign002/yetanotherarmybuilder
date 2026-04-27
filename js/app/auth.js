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
          setUser({ username: me.username });
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

    async register(username, password) {
      const data = await jsonFetch('/register', {
        method: 'POST',
        body: { username, password },
      });
      if (data && data.username) {
        setUser({ username: data.username });
      }
      return data; // { username, recoveryCode }
    },

    async login(username, password) {
      const data = await jsonFetch('/login', {
        method: 'POST',
        body: { username, password },
      });
      if (data && data.username) {
        setUser({ username: data.username });
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
