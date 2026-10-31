// app/pending-approval-banner.js — admin-only banner that fires when
// one or more accounts are waiting for approval. Click → opens the
// admin panel directly to the Pending tab.
//
// Polls `/api/admin/users/pending-count` (lightweight endpoint that
// returns `{ count }`); falls back to fetching the full `/users` list
// if the count endpoint isn't there yet. Both are documented in
// docs/ADMIN_API.md.
//
// Visibility rules:
//   - Hidden for unauthenticated users.
//   - Hidden for non-admins.
//   - Hidden when count === 0.
//   - Re-checks on Auth.onChange (sign in / out) and every 60 s while
//     the page is open AND visible (a hidden tab does not poll; it
//     re-checks when it becomes visible again).
//   - A 401/403 stops the poll until the next auth change (a 401 also flips
//     the app to signed out, like every other session-bearing call). It used
//     to keep polling a dead session every minute, forever.
//   - Re-checks shortly after an admin approves / revokes / reinstates
//     someone in the admin panel, so the banner does not lag a minute.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};

  const POLL_MS = 60 * 1000;
  let pollTimer = null;
  let bannerEl  = null;
  let lastCount = 0;
  // Set by a 401/403; cleared by the next Auth.onChange.
  let denied = false;


  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = 'admin-pending-banner';
    bannerEl.className = 'admin-pending-banner';
    bannerEl.hidden = true;
    bannerEl.setAttribute('role', 'status');
    bannerEl.innerHTML =
      '<span class="admin-pending-banner-text" id="admin-pending-banner-text"></span>' +
      '<button type="button" class="admin-pending-banner-btn" id="admin-pending-banner-btn">Review</button>' +
      '<button type="button" class="admin-pending-banner-close" id="admin-pending-banner-close" aria-label="Hide">&times;</button>';
    // Insert above the topbar so it pushes content down rather than overlapping.
    const topbar = document.getElementById('topbar');
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(bannerEl, topbar);
    } else {
      document.body.insertBefore(bannerEl, document.body.firstChild);
    }
    bannerEl.querySelector('#admin-pending-banner-btn').addEventListener('click', () => {
      if (App.Admin && typeof App.Admin.open === 'function') App.Admin.open('pending');
    });
    bannerEl.querySelector('#admin-pending-banner-close').addEventListener('click', () => {
      bannerEl.hidden = true;
    });
    return bannerEl;
  }

  function hide() {
    if (bannerEl) bannerEl.hidden = true;
  }

  function show(count) {
    ensureBanner();
    const txt = bannerEl.querySelector('#admin-pending-banner-text');
    const noun = count === 1 ? 'account is' : 'accounts are';
    txt.textContent = count + ' ' + noun + ' waiting for approval.';
    bannerEl.hidden = false;
  }

  // 401 = the session is gone: tell Auth (it flips to signed out and
  // toasts). 403 = not an admin (any more). Either way stop polling.
  function onDenied(status) {
    denied = true;
    stopPolling();
    hide();
    if (status === 401 && App.Auth && typeof App.Auth.handleSessionExpired === 'function') {
      App.Auth.handleSessionExpired();
    }
  }

  async function fetchPendingCount() {
    // Try the lightweight endpoint first.
    try {
      const resp = await fetch('/api/admin/users/pending-count', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' },
      });
      if (resp.status === 401 || resp.status === 403) { onDenied(resp.status); return null; }
      if (resp.ok) {
        const data = await resp.json();
        if (data && typeof data.count === 'number') return data.count;
      }
    } catch (_) { /* fall through */ }
    // Fallback: count from /users.
    try {
      const resp = await fetch('/api/admin/users', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' },
      });
      if (resp.status === 401 || resp.status === 403) { onDenied(resp.status); return null; }
      if (!resp.ok) return null;
      const list = await resp.json();
      if (!Array.isArray(list)) return null;
      return list.filter(u => !u.approved && !u.revoked).length;
    } catch (_) { return null; }
  }

  function isAdmin() {
    return !!(App.Auth && typeof App.Auth.isAdmin === 'function' && App.Auth.isAdmin());
  }

  async function check() {
    if (!isAdmin()) { hide(); return; }
    if (denied) return;
    if (document.hidden) return;   // the visibilitychange handler re-checks
    const count = await fetchPendingCount();
    if (count == null) return; // network blip — leave previous state
    lastCount = count;
    if (count > 0) show(count);
    else hide();
  }

  function startPolling() {
    stopPolling();
    if (denied) return;
    pollTimer = setInterval(() => { check(); }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function init() {
    // Re-evaluate whenever auth state changes — sign-in flips visibility.
    if (App.Auth && typeof App.Auth.onChange === 'function') {
      App.Auth.onChange(() => {
        // A new auth state gets a fresh chance: re-arm after a 401/403.
        denied = false;
        if (isAdmin()) { startPolling(); check(); }
        else { stopPolling(); hide(); }
      });
    }
    // First check after the initial Auth.init() resolves; bootstrap runs
    // after auth-button.js queues the Auth.init() promise so we just
    // wait one tick and then poll.
    setTimeout(check, 1500);
    startPolling();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
    // The admin panel (js/app/admin.js) changes the pending count; re-check
    // once its request has had time to land. Delegated so admin.js needs no
    // hook for it.
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest
        ? e.target.closest('#yaab-admin-modal [data-act="approve"], #yaab-admin-modal [data-act="revoke"]')
        : null;
      if (!t) return;
      setTimeout(check, 1500);
    }, true);
  }

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(init);
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }

  App.PendingApprovalBanner = { check, hide };
})();
