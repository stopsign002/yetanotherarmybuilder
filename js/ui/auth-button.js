// ui/auth-button.js — top-bar icon for sign-in / signed-in user menu.
// Registers via App.hooks.armyToolbarActions with region:'icon', then keeps
// its own DOM ref so it can re-render label + dropdown on Auth.onChange
// without needing the toolbar mounter to re-run.
(function () {
  const App = window.App = window.App || {};
  const UI = window.UI = window.UI || {};
  if (!App.hooks) return;

  const BTN_ID = 'yaab-btn-auth';
  const MENU_ID = 'yaab-auth-menu';
  let _btnRef = null;

  function buildSignedOut() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'topbar-icon-btn auth-btn auth-btn-signed-out';
    btn.title = 'Sign in to sync armies';
    btn.setAttribute('aria-label', 'Sign in');
    btn.textContent = 'Sign in';
    btn.addEventListener('click', () => UI.showAuthModal && UI.showAuthModal('login'));
    return btn;
  }

  function buildSignedIn(username) {
    const wrap = document.createElement('div');
    wrap.className = 'auth-btn-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'topbar-icon-btn auth-btn auth-btn-signed-in';
    btn.title = `Signed in as ${username}`;
    btn.setAttribute('aria-label', `Account menu for ${username}`);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = username;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'auth-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    function mkItem(label, onClick) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'auth-menu-item';
      it.setAttribute('role', 'menuitem');
      it.textContent = label;
      it.addEventListener('click', () => { closeMenu(); onClick(); });
      return it;
    }

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    }
    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
      if (!wrap.contains(e.target)) closeMenu();
    }
    btn.addEventListener('click', () => { menu.hidden ? openMenu() : closeMenu(); });

    menu.appendChild(mkItem('Sync now', () => {
      if (App.Sync && typeof App.Sync.pullAll === 'function') {
        App.Sync.pullAll().catch(() => {});
      }
      if (App.Sync && typeof App.Sync.drainQueue === 'function') {
        App.Sync.drainQueue();
      }
    }));
    menu.appendChild(mkItem('Change password', () => {
      if (UI.showAuthModal) UI.showAuthModal('change-password');
    }));
    menu.appendChild(mkItem('Sign out', async () => {
      const keep = confirm('Sign out?\n\nClick OK to keep your synced data on this device. Click Cancel to also remove it from this device.');
      // confirm returns true on OK, false on Cancel. We invert: OK = keep.
      try {
        if (App.Auth) await App.Auth.logout();
      } catch (_) {}
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
    }));

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  function render() {
    if (!_btnRef || !_btnRef.parentNode) return;
    const user = (App.Auth && App.Auth.getCurrentUser && App.Auth.getCurrentUser()) || null;
    const fresh = user ? buildSignedIn(user.username) : buildSignedOut();
    _btnRef.parentNode.replaceChild(fresh, _btnRef);
    _btnRef = fresh;
  }

  // Register as a toolbar icon. We override className so the wrap div
  // / button is built by us, not the generic buildIconButton helper.
  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: 'Sign in',
    title: 'Sign in to sync armies',
    ariaLabel: 'Sign in',
    onClick: () => { /* swapped out by render() */ },
  });

  App.hooks.bootstrap.push(function () {
    // Replace the generic icon button with our managed element.
    const placeholder = document.getElementById(BTN_ID);
    if (placeholder && placeholder.parentNode) {
      const fresh = (App.Auth && App.Auth.isSignedIn && App.Auth.isSignedIn())
        ? buildSignedIn(App.Auth.getCurrentUser().username)
        : buildSignedOut();
      placeholder.parentNode.replaceChild(fresh, placeholder);
      _btnRef = fresh;
    }

    if (App.Auth && typeof App.Auth.onChange === 'function') {
      App.Auth.onChange(() => render());
    }

    // Kick off auth init + sync init now that DOM is ready.
    if (App.Auth && typeof App.Auth.init === 'function') {
      App.Auth.init().catch(() => {}).finally(() => {
        if (App.Sync && typeof App.Sync.init === 'function') App.Sync.init();
      });
    } else if (App.Sync && typeof App.Sync.init === 'function') {
      App.Sync.init();
    }
  });
})();
