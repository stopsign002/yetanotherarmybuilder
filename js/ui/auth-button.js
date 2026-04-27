// ui/auth-button.js — wires the inline #topbar-auth button (in index.html)
// to App.Auth + App.Sync. Does NOT register through App.hooks because we
// want the Sign-in control to share the .topbar-action-btn styling of
// Settings / Help, not the icon-shelf surface used by other features.
(function () {
  const App = window.App = window.App || {};
  const UI = window.UI = window.UI || {};

  let _btn = null;
  let _label = null;
  let _menu = null;

  function getUser() {
    return (App.Auth && App.Auth.getCurrentUser && App.Auth.getCurrentUser()) || null;
  }

  function setSignedOut() {
    if (!_btn || !_label) return;
    _btn.setAttribute('aria-label', 'Sign in');
    _btn.title = 'Sign in to sync armies';
    _label.textContent = 'Sign in';
    closeMenu();
  }

  function setSignedIn(username) {
    if (!_btn || !_label) return;
    _btn.setAttribute('aria-label', `Account menu for ${username}`);
    _btn.title = `Signed in as ${username}`;
    _label.textContent = username;
  }

  function render() {
    const user = getUser();
    if (user) setSignedIn(user.username);
    else setSignedOut();
  }

  // ── Dropdown menu (only shown when signed in) ────────────────────────
  function buildMenuItem(label, onClick) {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'topbar-auth-menu-item';
    it.setAttribute('role', 'menuitem');
    it.textContent = label;
    it.addEventListener('click', () => { closeMenu(); onClick(); });
    return it;
  }

  function rebuildMenu() {
    if (!_menu) return;
    _menu.replaceChildren(
      buildMenuItem('Sync now', () => {
        if (App.Sync && typeof App.Sync.pullAll === 'function') {
          App.Sync.pullAll().catch(() => {});
        }
        if (App.Sync && typeof App.Sync.drainQueue === 'function') {
          App.Sync.drainQueue();
        }
      }),
      buildMenuItem('Change password', () => {
        if (UI.showAuthModal) UI.showAuthModal('change-password');
      }),
      buildMenuItem('Sign out', async () => {
        const keep = confirm(
          'Sign out?\n\nClick OK to keep your synced data on this device. ' +
          'Click Cancel to also remove it from this device.'
        );
        try { if (App.Auth) await App.Auth.logout(); } catch (_) {}
        if (!keep) {
          try {
            ['yaab_armies', 'yaab_favorites', 'yaab_recents', 'yaab_collection',
              'yaab_crusade_rosters', 'yaab_deployments', 'yaab_points_overrides',
              'yaab_sync_known', 'yaab_sync_state_at']
              .forEach(k => localStorage.removeItem(k));
            if (App.state && App.state.armyManager) {
              App.state.armyManager.armies = [];
              App.state.currentArmy = App.state.armyManager.newArmy();
              if (typeof App.renderAll === 'function') App.renderAll();
            }
          } catch (_) {}
        }
        if (UI.toast) UI.toast('Signed out.', 'info', 2200);
      }),
    );
  }

  function openMenu() {
    if (!_btn || !_menu) return;
    rebuildMenu();
    _menu.hidden = false;
    _btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  }

  function closeMenu() {
    if (!_btn || !_menu) return;
    _menu.hidden = true;
    _btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (!_btn || !_menu) return;
    if (_btn.contains(e.target) || _menu.contains(e.target)) return;
    closeMenu();
  }

  // ── Click handler ────────────────────────────────────────────────────
  function onClick(e) {
    e.preventDefault();
    if (getUser()) {
      _menu && !_menu.hidden ? closeMenu() : openMenu();
    } else {
      if (UI.showAuthModal) UI.showAuthModal('login');
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────
  if (App.hooks && App.hooks.bootstrap) {
    App.hooks.bootstrap.push(function () {
      _btn   = document.getElementById('topbar-auth');
      _label = document.getElementById('topbar-auth-label');
      _menu  = document.getElementById('topbar-auth-menu');
      if (!_btn || !_label) return;

      _btn.addEventListener('click', onClick);

      if (App.Auth && typeof App.Auth.onChange === 'function') {
        App.Auth.onChange(() => render());
      }

      // Render once now (uses the cached hint if present), then kick init.
      if (App.Auth && typeof App.Auth.primeFromHint === 'function') {
        App.Auth.primeFromHint();
      }
      render();

      if (App.Auth && typeof App.Auth.init === 'function') {
        App.Auth.init().catch(() => {}).finally(() => {
          if (App.Sync && typeof App.Sync.init === 'function') App.Sync.init();
        });
      } else if (App.Sync && typeof App.Sync.init === 'function') {
        App.Sync.init();
      }
    });
  }
})();
