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

  // Click the original (now-hidden) panel-footer button, so the existing
  // event-listener path (events.js + activity-log + army-diff + command-
  // palette delegation) all keep firing without modification.
  function clickHidden(id) {
    const el = document.getElementById(id);
    if (el && typeof el.click === 'function') el.click();
  }

  function buildAuthButton(user) {
    const signedIn = !!user;
    const wrap = document.createElement('div');
    wrap.className = 'auth-btn-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'topbar-action-btn auth-btn ' +
      (signedIn ? 'auth-btn-signed-in' : 'auth-btn-signed-out');
    btn.title = signedIn ? `Signed in as ${user.username}` : 'Account menu';
    btn.setAttribute('aria-label', signedIn ? `Account menu for ${user.username}` : 'Account menu');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'topbar-action-label' + (signedIn ? ' auth-btn-username' : '');
    label.textContent = signedIn ? user.username : 'Account';
    btn.appendChild(label);

    const caret = document.createElement('span');
    caret.className = 'auth-btn-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    btn.appendChild(caret);

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'auth-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    function mkItem(textLabel, onClick) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'auth-menu-item';
      it.setAttribute('role', 'menuitem');
      it.textContent = textLabel;
      it.addEventListener('click', () => { closeMenu(); onClick(); });
      return it;
    }
    function mkDivider() {
      const d = document.createElement('div');
      d.className = 'auth-menu-divider';
      d.setAttribute('role', 'separator');
      return d;
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

    // ── Army actions (always available, signed-in or not) ────────────
    menu.appendChild(mkItem('New army',  () => clickHidden('btn-new-army')));
    menu.appendChild(mkItem('Save army', () => clickHidden('btn-save-army')));
    menu.appendChild(mkItem('Load army', () => clickHidden('btn-load-army')));
    menu.appendChild(mkItem('Import…',   () => clickHidden('btn-import-string')));
    menu.appendChild(mkDivider());

    // ── Auth actions ─────────────────────────────────────────────────
    if (!signedIn) {
      menu.appendChild(mkItem('Sign in', () => UI.showAuthModal && UI.showAuthModal('login')));
    } else {
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
        try {
          if (App.Auth) await App.Auth.logout();
        } catch (_) {}
        if (!keep) {
          try {
            // yaab_sync_queue MUST be in this list — otherwise pending ops
            // queued under user A drain to user B's cloud bag if A signs
            // out (with "remove data") and B signs in on the same device.
            ['yaab_armies', 'yaab_favorites', 'yaab_recents', 'yaab_collection',
              'yaab_crusade_rosters', 'yaab_deployments', 'yaab_points_overrides',
              'yaab_sync_known', 'yaab_sync_state_at', 'yaab_sync_queue']
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
    }

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  // Backwards-compat aliases — keep tests / other modules that reference
  // these names from breaking.
  function buildSignedOut() { return buildAuthButton(null); }
  function buildSignedIn(username) { return buildAuthButton({ username: username }); }

  function render() {
    if (!_btnRef || !_btnRef.parentNode) return;
    const user = (App.Auth && App.Auth.getCurrentUser && App.Auth.getCurrentUser()) || null;
    const fresh = buildAuthButton(user);
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
