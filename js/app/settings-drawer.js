// app/settings-drawer.js — labeled Settings drawer; routes to existing toggles + utilities.
(function () {
  const App = window.App = window.App || {};

  // ── localStorage helpers ─────────────────────────────────────────────
  function lsRead(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return (v === null || v === undefined) ? fallback : v;
    } catch (_) { return fallback; }
  }
  function lsWrite(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function lsBool(key, defaultOn) {
    const v = lsRead(key, null);
    if (v === null) return !!defaultOn;
    return v === '1' || v === 'true';
  }

  // ── DOM lookup ───────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function root()   { return $('settings-drawer-root'); }
  function drawer() { return $('settings-drawer'); }
  function body()   { return $('settings-drawer-body'); }
  function settingsBtn() { return $('topbar-settings'); }

  // ── Reduced-motion class toggle (for our own animations) ────────────
  function applyReduceMotion() {
    const on = lsBool('yaab_reduced_motion', false);
    if (!document.body) return;
    document.body.classList.toggle('reduce-motion', on);
  }

  // ── Painting badges flag (consumed by future collection UI) ─────────
  function applyCollectionBadges() {
    const on = lsBool('yaab_show_collection_badges', true);
    if (!document.body) return;
    document.body.classList.toggle('hide-collection-badges', !on);
  }

  // ── Toggle handlers ─────────────────────────────────────────────────
  // For toggles that have an existing toolbar-button companion (with a
  // working onClick), prefer that companion — it owns side effects
  // (re-rendering rosters, observers, etc). Two paths:
  //   1. If the legacy DOM button is mounted, click it.
  //   2. Otherwise, find the registered hook action by id and invoke its
  //      onClick directly (avoids dependence on the icon shelf, which
  //      this redesign removes).
  function clickToolbarBtn(id) {
    const btn = document.getElementById(id);
    if (btn && typeof btn.click === 'function') { btn.click(); return true; }
    const hooks = (App.hooks && App.hooks.armyToolbarActions) || [];
    for (let i = 0; i < hooks.length; i++) {
      if (hooks[i] && hooks[i].id === id && typeof hooks[i].onClick === 'function') {
        try { hooks[i].onClick(); return true; }
        catch (_) { return false; }
      }
    }
    return false;
  }

  const TOGGLES = [
    {
      key:   'yaab_show_legends',
      label: 'Show Legends units',
      help:  'Include units flagged as Legends in BSData.',
      defaultOn: false,
      onChange(checked) {
        // The toolbar button toggles itself + persists + re-renders.
        if (clickToolbarBtn('yaab-btn-legends')) return;
        // Fallback: write the flag directly. Roster filter will pick it up
        // on the next render.
        lsWrite('yaab_show_legends', checked ? '1' : '0');
        if (typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      },
      isOn() { return lsBool('yaab_show_legends', false); },
    },
    {
      key:   'yaab_show_allies',
      label: 'Show allied units',
      help:  'Include units borrowed from another codex (Imperial Agents, Daemonic Pact, Questoris Allies, …). Turn off to see only your own faction.',
      defaultOn: true,
      onChange(checked) {
        // The toolbar hook action owns the side effects (persist + re-render).
        // js/app/allies.js registers it with region:'icon', and the top-bar
        // shelf whitelist in js/app/index.js drops non-whitelisted icon
        // actions WITHOUT falling through to the Action Center — so this row
        // is the toggle's only surface. clickToolbarBtn's hook fallback
        // invokes the onClick even though no DOM button is ever mounted.
        if (clickToolbarBtn('yaab-btn-allies')) return;
        // Fallback: write the flag directly and re-render.
        lsWrite('yaab_show_allies', checked ? '1' : '0');
        if (typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      },
      isOn() { return lsBool('yaab_show_allies', true); },
    },
    {
      key:   'yaab_ork_math',
      label: 'Show points as Ork "teef"',
      help:  'Only takes effect while the Orks faction is active.',
      defaultOn: false,
      onChange(checked) {
        if (clickToolbarBtn('yaab-btn-teef')) return;
        lsWrite('yaab_ork_math', checked ? '1' : '0');
      },
      isOn() { return lsBool('yaab_ork_math', false); },
    },
    {
      key:   'yaab_show_collection_badges',
      label: 'Show painting status badges on cards',
      help:  'Display owned / painted indicators on unit cards.',
      defaultOn: true,
      onChange(checked) {
        lsWrite('yaab_show_collection_badges', checked ? '1' : '0');
        applyCollectionBadges();
      },
      isOn() { return lsBool('yaab_show_collection_badges', true); },
    },
    {
      key:   'yaab_reduced_motion',
      label: 'Reduced animations',
      help:  'Suppress UI transitions and effects (overrides system preference when on).',
      defaultOn: false,
      onChange(checked) {
        lsWrite('yaab_reduced_motion', checked ? '1' : '0');
        applyReduceMotion();
      },
      isOn() { return lsBool('yaab_reduced_motion', false); },
    },
    {
      key:   'yaab_sound_enabled',
      label: 'Sound effects',
      help:  'Subtle clicks and chimes during edits and saves.',
      defaultOn: true,
      onChange(checked) {
        if (clickToolbarBtn('yaab-btn-sound')) return;
        lsWrite('yaab_sound_enabled', checked ? '1' : '0');
      },
      isOn() { return lsBool('yaab_sound_enabled', true); },
    },
  ];

  // ── Action rows ─────────────────────────────────────────────────────
  function pwaInstallAvailable() {
    // pwa-install.js now exports this — it can see whether a
    // beforeinstallprompt was actually captured, which is the only way to know
    // the row will do anything when clicked. Prefer it.
    try {
      if (typeof App.pwaInstallAvailable === 'function') return App.pwaInstallAvailable();
    } catch (_) {}
    // Fallback for the load-order case where pwa-install.js hasn't run yet:
    // already installed → hide, otherwise surface it and let onInstallClick
    // bail if there is no prompt. (Also the honest answer on iOS, where
    // beforeinstallprompt never fires at all — see issue #60.)
    try {
      if (window.matchMedia &&
          window.matchMedia('(display-mode: standalone)').matches) return false;
    } catch (_) {}
    if (window.navigator && window.navigator.standalone === true) return false;
    return true;
  }

  // ── Account state helper ────────────────────────────────────────────
  // App.Auth's accessor is getCurrentUser() (js/app/auth.js). This used to
  // probe only for `getUser()` and `.user`, NEITHER of which App.Auth has ever
  // exposed, so it always returned null and the whole Account section of this
  // drawer was permanently stuck in its signed-out shape: a signed-in user was
  // offered "Sign in" and "Create account", and never "Sync now", "Change
  // password" or "Sign out". That matters most on mobile, where the topbar
  // (and with it the account menu in js/ui/auth-button.js) is display:none at
  // <=820px and this drawer is the ONLY account UI there — signed-in phone
  // users had no way to sign out at all. Found while proving issue #51, whose
  // leak this bug had been keeping latent.
  function getAuthUser() {
    try {
      if (App.Auth && typeof App.Auth.getCurrentUser === 'function') return App.Auth.getCurrentUser();
      if (App.Auth && typeof App.Auth.getUser === 'function') return App.Auth.getUser();
      if (App.Auth && App.Auth.user) return App.Auth.user;
    } catch (_) {}
    return null;
  }

  // Keep the drawer honest about the session: sign in / out from anywhere else
  // (the topbar menu, the auth modal, a 401 mid-session) must repaint the
  // Account rows, not leave a stale "Signed in as …" or a stale "Sign in".
  if (App.Auth && typeof App.Auth.onChange === 'function') {
    App.Auth.onChange(function () {
      try { if (isOpen()) render(); } catch (_) {}
    });
  }

  // The topbar is display:none at <=820px, so anything that only ever mounted
  // into the topbar shelf is unreachable on a phone unless it also appears
  // here. This sheet is the entire mobile navigation surface.
  function isMobileWidth() {
    try { return window.matchMedia && window.matchMedia('(max-width: 820px)').matches; }
    catch (_) { return false; }
  }

  function currentMode() {
    try { return (typeof App.getMode === 'function' && App.getMode()) || 'build'; }
    catch (_) { return 'build'; }
  }

  function goToMode(mode) {
    close();
    if (typeof App.setMode === 'function') App.setMode(mode);
  }

  function buildActions() {
    const user = getAuthUser();
    const signedIn = !!user;
    const mode = currentMode();
    return [
      // ── GO ───────────────────────────────────────────────────────────
      // Mode switching. The only other switcher is .topbar-modes, which is
      // display:none globally AND sits inside the topbar that's removed at
      // <=820px — so Collect and Play had no mobile entry point at all.
      {
        id: 'go-build',
        label: mode === 'build' ? 'Build ✓' : 'Build',
        section: 'go',
        visible: isMobileWidth,
        run() { goToMode('build'); },
      },
      {
        id: 'go-collect',
        label: mode === 'collect' ? 'Collect ✓' : 'Collect',
        section: 'go',
        visible: isMobileWidth,
        run() { goToMode('collect'); },
      },
      // Release notes. Mounted only into the topbar icon shelf, so phone users
      // could never read them.
      {
        id: 'go-changelog',
        label: 'What’s new',
        section: 'go',
        visible: isMobileWidth,
        run() {
          close();
          if (App.Changelog && typeof App.Changelog.open === 'function') App.Changelog.open();
        },
      },

      // ── ARMY ─────────────────────────────────────────────────────────
      // Mirrors the desktop panel-footer toolbar (which is hidden on mobile).
      {
        id: 'army-new',
        label: 'New army',
        section: 'army',
        run() { close(); clickToolbarBtn('btn-new-army'); },
      },
      {
        id: 'army-save',
        label: 'Save army',
        section: 'army',
        run() { close(); clickToolbarBtn('btn-save-army'); },
      },
      {
        id: 'army-load',
        label: 'Load army',
        section: 'army',
        run() { close(); clickToolbarBtn('btn-load-army'); },
      },
      {
        id: 'army-import',
        label: 'Import army code',
        section: 'army',
        run() { close(); clickToolbarBtn('btn-import-string'); },
      },
      {
        id: 'army-undo',
        label: 'Undo',
        section: 'army',
        run() { close(); clickToolbarBtn('yaab-btn-undo'); },
      },
      {
        id: 'army-redo',
        label: 'Redo',
        section: 'army',
        run() { close(); clickToolbarBtn('yaab-btn-redo'); },
      },

      // ── ACCOUNT ──────────────────────────────────────────────────────
      signedIn ? {
        id: 'account-status',
        label: 'Signed in as ' + user.username,
        section: 'account',
        run() { /* informational only */ },
      } : {
        id: 'sign-in',
        label: 'Sign in',
        section: 'account',
        run() {
          close();
          if (window.UI && UI.showAuthModal) UI.showAuthModal('login');
        },
      },
      signedIn ? {
        id: 'sync-now',
        label: 'Sync now',
        section: 'account',
        run() {
          close();
          if (App.Sync && typeof App.Sync.pullAll === 'function') {
            App.Sync.pullAll().catch(() => {});
          }
          if (App.Sync && typeof App.Sync.drainQueue === 'function') {
            App.Sync.drainQueue();
          }
          if (window.UI && UI.toast) UI.toast('Syncing…', 'info', 1500);
        },
      } : null,
      signedIn ? {
        id: 'change-password',
        label: 'Change password',
        section: 'account',
        run() {
          close();
          if (window.UI && UI.showAuthModal) UI.showAuthModal('change-password');
        },
      } : {
        id: 'register',
        label: 'Create account',
        section: 'account',
        run() {
          close();
          if (window.UI && UI.showAuthModal) UI.showAuthModal('register');
        },
      },
      signedIn ? {
        id: 'sign-out',
        label: 'Sign out',
        section: 'account',
        // Same implementation as the topbar auth button — App.Auth.signOut()
        // owns the confirm, the logout, the localStorage wipe and the toast.
        // This used to inline its own wipe list, and that list was missing
        // yaab_sync_queue plus four SYNCED_BAG_KEYS entries, which leaked one
        // user's pending sync ops into the next user's cloud account (issue
        // #51). Do not re-inline it here.
        run: async function () {
          if (App.Auth && typeof App.Auth.signOut === 'function') {
            await App.Auth.signOut();
          }
          close();
        },
      } : null,

      // ── EXPORT ───────────────────────────────────────────────────────
      // Mirror the desktop export dropdown by clicking its hidden buttons.
      {
        id: 'export-string',
        label: 'Copy army code',
        section: 'export',
        run() { close(); clickToolbarBtn('btn-export-string'); },
      },
      {
        id: 'export-text',
        label: 'Copy as text',
        section: 'export',
        run() { close(); clickToolbarBtn('btn-export-text'); },
      },
      {
        id: 'export-csv',
        label: 'Download CSV',
        section: 'export',
        run() { close(); clickToolbarBtn('btn-export-csv'); },
      },
      {
        id: 'data-cards',
        label: 'Data cards…',
        section: 'export',
        run() { close(); clickToolbarBtn('btn-data-cards'); },
      },

      // ── HELP ─────────────────────────────────────────────────────────
      {
        id: 'replay-tour',
        label: 'Replay onboarding tour',
        section: 'help',
        run() {
          close();
          if (typeof App.replayTour === 'function') App.replayTour();
        },
      },
      {
        id: 'kbd-shortcuts',
        label: 'Keyboard shortcuts',
        section: 'help',
        run() {
          close();
          if (typeof App.openKeyboardHelp === 'function') App.openKeyboardHelp();
          else if (typeof App.openCommandPalette === 'function') App.openCommandPalette();
        },
      },
      {
        id: 'report-bug',
        label: 'Report a bug',
        section: 'help',
        run() {
          close();
          clickToolbarBtn('yaab-btn-bug-report');
        },
      },
      {
        id: 'install-app',
        label: 'Install as desktop app',
        section: 'help',
        visible: pwaInstallAvailable,
        run() {
          if (typeof App.pwaInstall === 'function') {
            App.pwaInstall();
          } else {
            clickToolbarBtn('yaab-btn-install');
          }
          close();
        },
      },
      {
        id: 'about',
        label: 'About',
        section: 'help',
        run() { showAbout(); },
      },
      {
        id: 'clear-bsdata',
        label: 'Clear cached factions and refetch BSData',
        section: 'data',
        danger: false,
        run() {
          if (!confirm('Clear cached BSData? Faction data will be refetched on next reload.')) return;
          (async function () {
            try {
              if (window.BSData && typeof BSData.clearCache === 'function') {
                await BSData.clearCache();
              }
            } catch (_) {}
            try {
              if (window.YaabDB && typeof YaabDB.clearFactions === 'function') {
                await YaabDB.clearFactions();
              }
              if (window.YaabDB && typeof YaabDB.clearGst === 'function') {
                await YaabDB.clearGst();
              }
            } catch (_) {}
            if (window.UI && typeof UI.toast === 'function') {
              UI.toast('Faction cache cleared. Reloading…', 'info');
            }
            setTimeout(() => location.reload(), 600);
          }());
        },
      },
      {
        id: 'wipe-armies',
        label: 'Wipe all saved armies (irreversible)',
        section: 'data',
        danger: true,
        run() {
          if (!confirm('Delete ALL saved armies? This cannot be undone.')) return;
          if (!confirm('Are you absolutely sure? Saved armies will be gone forever.')) return;
          try { localStorage.removeItem('yaab_armies'); } catch (_) {}
          if (window.UI && typeof UI.toast === 'function') {
            UI.toast('All saved armies deleted. Reloading…', 'warn');
          }
          setTimeout(() => location.reload(), 600);
        },
      },
      {
        id: 'export-all',
        label: 'Export everything as JSON',
        section: 'data',
        run() { exportEverything(); },
      },
    ];
  }

  // ── Export-all helper ───────────────────────────────────────────────
  function exportEverything() {
    const dump = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('yaab') !== 0 && k.indexOf('yaab_') !== 0) continue;
        dump[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    const json = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      localStorage: dump,
    }, null, 2);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'yaab-export-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('Export downloaded.', 'success');
      }
    } catch (_) {
      // Fallback: copy JSON to clipboard
      try { navigator.clipboard.writeText(json); } catch (_) {}
    }
  }

  // ── About popover (small inline panel) ──────────────────────────────
  function showAbout() {
    const b = body();
    if (!b) return;
    const existing = b.querySelector('.settings-about-card');
    if (existing) { existing.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const card = document.createElement('div');
    card.className = 'settings-about-card';
    card.innerHTML =
      '<h3>About YAAB</h3>' +
      '<p>Yet Another Army Builder — a client-only Warhammer 40,000 (10e) army builder.</p>' +
      '<p class="muted">Faction data: BSData/wh40k-10e.</p>' +
      '<p><a href="https://github.com/BSData/wh40k-10e" target="_blank" rel="noopener">BSData repo</a></p>' +
      '<p class="muted">No affiliation with Games Workshop.</p>';
    b.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Render ──────────────────────────────────────────────────────────
  function renderToggleRow(t) {
    const id = 'set-toggle-' + t.key;
    const wrap = document.createElement('label');
    wrap.className = 'settings-toggle-row';
    wrap.setAttribute('for', id);

    const text = document.createElement('div');
    text.className = 'settings-toggle-text';
    const lab = document.createElement('div');
    lab.className = 'settings-toggle-label';
    lab.textContent = t.label;
    const help = document.createElement('div');
    help.className = 'settings-toggle-help';
    help.textContent = t.help;
    text.appendChild(lab);
    text.appendChild(help);

    const sw = document.createElement('span');
    sw.className = 'settings-toggle-switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.className = 'settings-toggle-input';
    cb.checked = !!t.isOn();
    cb.setAttribute('aria-label', t.label);
    const knob = document.createElement('span');
    knob.className = 'settings-toggle-knob';
    knob.setAttribute('aria-hidden', 'true');
    sw.appendChild(cb);
    sw.appendChild(knob);

    cb.addEventListener('change', () => {
      try { t.onChange(cb.checked); }
      catch (_) {}
      // Re-read to confirm state landed (toolbar-btn click may flip it).
      requestAnimationFrame(() => { cb.checked = !!t.isOn(); });
    });

    wrap.appendChild(text);
    wrap.appendChild(sw);
    return wrap;
  }

  // ── Theme picker rows ───────────────────────────────────────────────
  // A radiogroup rather than the toggle rows above: themes are mutually
  // exclusive and there are three of them, and a stack of switches would let
  // the user turn all of them off. Each row shows the theme's three-colour
  // swatch so the choice is visible without applying it.
  function renderThemeRow(theme, activeId) {
    const isActive = theme.id === activeId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-theme-row' + (isActive ? ' is-active' : '');
    btn.id = 'set-theme-' + theme.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');

    const sw = document.createElement('span');
    sw.className = 'settings-theme-swatch';
    sw.setAttribute('aria-hidden', 'true');
    (theme.swatch || []).forEach(c => {
      const i = document.createElement('i');
      i.style.background = c;
      sw.appendChild(i);
    });

    const text = document.createElement('span');
    text.className = 'settings-theme-text';
    const name = document.createElement('span');
    name.className = 'settings-theme-name';
    name.textContent = theme.name;
    const blurb = document.createElement('span');
    blurb.className = 'settings-theme-blurb';
    blurb.textContent = theme.blurb;
    text.appendChild(name);
    text.appendChild(blurb);

    const check = document.createElement('span');
    check.className = 'settings-theme-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = isActive ? '\u2713' : '';

    btn.appendChild(sw);
    btn.appendChild(text);
    btn.appendChild(check);

    btn.addEventListener('click', () => {
      if (theme.id === activeId) return;
      try { App.Themes.set(theme.id); } catch (_) { return; }
      // App.Themes.set re-renders this drawer, so the rows repaint themselves.
      if (window.UI && UI.toast) UI.toast('Theme: ' + theme.name, 'success', 1800);
    });
    return btn;
  }

  function renderActionRow(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-action-row' + (a.danger ? ' is-danger' : '');
    btn.id = 'set-action-' + a.id;
    btn.innerHTML = '<span class="settings-action-label"></span><span class="settings-action-arrow" aria-hidden="true">&rsaquo;</span>';
    btn.querySelector('.settings-action-label').textContent = a.label;
    btn.addEventListener('click', () => { try { a.run(); } catch (_) {} });
    return btn;
  }

  function renderSectionHeader(text) {
    const h = document.createElement('h3');
    h.className = 'settings-section-heading';
    h.textContent = text;
    return h;
  }

  function render() {
    const b = body();
    if (!b) return;
    b.replaceChildren();

    const actions = buildActions().filter(Boolean);
    const visible = a => typeof a.visible !== 'function' || a.visible();

    // GO — mode switching + the tools sheet. First, because on mobile this is
    // the app's only navigation between top-level sections.
    const goActions = actions.filter(a => a.section === 'go' && visible(a));
    if (goActions.length) {
      b.appendChild(renderSectionHeader('Go'));
      goActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // ARMY — primary actions (was the desktop panel-footer toolbar).
    const armyActions = actions.filter(a => a.section === 'army' && visible(a));
    if (armyActions.length) {
      b.appendChild(renderSectionHeader('Army'));
      armyActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // ACCOUNT — sign in/out, sync, change password.
    const accountActions = actions.filter(a => a.section === 'account' && visible(a));
    if (accountActions.length) {
      b.appendChild(renderSectionHeader('Account'));
      accountActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // APPEARANCE — theme picker. Directly after Account, because it is an
    // account-level preference (it cloud-syncs with the rest of the bag) and
    // because burying a whole-app restyle under Export and Display makes it
    // undiscoverable. Absent entirely if js/theme-boot.js failed to load,
    // in which case the app is on the default theme and there is nothing to
    // choose between.
    if (App.Themes && typeof App.Themes.list === 'function') {
      const themes = App.Themes.list();
      if (themes.length > 1) {
        b.appendChild(renderSectionHeader('Appearance'));
        const group = document.createElement('div');
        group.className = 'settings-theme-group';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', 'Theme');
        const activeId = App.Themes.get();
        themes.forEach(t => group.appendChild(renderThemeRow(t, activeId)));
        b.appendChild(group);
      }
    }

    // EXPORT — desktop export-dropdown items, surfaced here for mobile.
    const exportActions = actions.filter(a => a.section === 'export' && visible(a));
    if (exportActions.length) {
      b.appendChild(renderSectionHeader('Export'));
      exportActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // Sections name their toggles BY KEY, not by position in TOGGLES.
    // This used to be `[0,1,2,3,4]` / `[5,6]` index ranges with a comment
    // telling you to keep them in step; removing a toggle left a hole, and
    // renderToggleRow(undefined) threw on `t.key` — which took the whole
    // drawer down, and with it the mobile "More" tab, whose only job is to
    // open it. A missing key now drops that row and nothing else.
    const byKey = (k) => TOGGLES.filter(t => t && t.key === k);
    const renderToggles = (keys) => keys.forEach(
      k => byKey(k).forEach(t => b.appendChild(renderToggleRow(t))));

    b.appendChild(renderSectionHeader('Display'));
    renderToggles(['yaab_show_legends', 'yaab_show_allies', 'yaab_ork_math',
                   'yaab_show_collection_badges', 'yaab_reduced_motion']);

    b.appendChild(renderSectionHeader('Audio & input'));
    renderToggles(['yaab_sound_enabled']);

    // HELP & SUPPORT
    b.appendChild(renderSectionHeader('Help & support'));
    actions.filter(a => a.section === 'help' && visible(a))
           .forEach(a => b.appendChild(renderActionRow(a)));

    // DATA
    b.appendChild(renderSectionHeader('Data'));
    actions.filter(a => a.section === 'data' && visible(a))
           .forEach(a => b.appendChild(renderActionRow(a)));
  }

  // ── Open / close ────────────────────────────────────────────────────
  let lastFocus = null;

  function isOpen() {
    const r = root();
    return !!(r && !r.hasAttribute('hidden'));
  }

  function open() {
    const r = root();
    if (!r) return;
    if (isOpen()) return;
    lastFocus = document.activeElement;
    render();
    r.removeAttribute('hidden');
    document.body.classList.add('settings-drawer-open');
    const sb = settingsBtn();
    if (sb) sb.setAttribute('aria-expanded', 'true');
    if (typeof App._syncMobileTabActive === 'function') App._syncMobileTabActive(document.body.dataset.mobilePanel || 'units');
    // Back-trap the sheet so the hardware Back button closes it instead of
    // leaving the site. Announced from in here rather than wrapped from
    // outside, because every dismissal below calls the local close() and an
    // external wrapper on App.settingsDrawer.close would never see it.
    if (App.backTrap) App.backTrap.opened('settings-drawer', close);
    // focus the close button for keyboard users
    const closeBtn = document.getElementById('settings-drawer-close');
    setTimeout(() => { if (closeBtn) closeBtn.focus(); }, 30);
  }

  function close() {
    const r = root();
    if (!r) return;
    if (!isOpen()) return;
    r.setAttribute('hidden', '');
    document.body.classList.remove('settings-drawer-open');
    const sb = settingsBtn();
    if (sb) sb.setAttribute('aria-expanded', 'false');
    if (typeof App._syncMobileTabActive === 'function') App._syncMobileTabActive(document.body.dataset.mobilePanel || 'units');
    // Consume the history entry this sheet owns. Every dismissal path (X,
    // scrim, Escape, any action row) lands here, so the entry can't leak and
    // Back can never re-open a sheet the user already dismissed.
    if (App.backTrap) App.backTrap.closed('settings-drawer');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // Esc + scrim + close button -----------------------------------------
  function bindChrome() {
    const r = root();
    if (!r) return;
    const closeBtn = document.getElementById('settings-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const scrim = document.getElementById('settings-drawer-scrim');
    if (scrim) scrim.addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) { close(); return; }
      // Focus trap. The sheet declares role="dialog" aria-modal="true", but
      // without this Tab walks straight out into the page behind it — which on
      // mobile is content the user can't even see, since the sheet covers the
      // whole viewport.
      if (e.key !== 'Tab' || !isOpen()) return;
      const r = root();
      if (!r) return;
      const focusable = Array.prototype.filter.call(
        r.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
          ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
        el => el.offsetParent !== null || el === document.activeElement
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────────
  App.settingsDrawer = { open, close, toggle, isOpen, render };

  function init() {
    applyReduceMotion();
    applyCollectionBadges();
    bindChrome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
