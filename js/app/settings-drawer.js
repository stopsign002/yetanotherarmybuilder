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
    {
      key:   'yaab_voice_enabled',
      label: 'Voice commands',
      help:  'Hands-free dictation. Chrome, Edge, and Safari only.',
      defaultOn: false,
      onChange(checked) {
        if (clickToolbarBtn('yaab-btn-voice')) return;
        lsWrite('yaab_voice_enabled', checked ? '1' : '0');
      },
      isOn() { return lsBool('yaab_voice_enabled', false); },
    },
  ];

  // ── Action rows ─────────────────────────────────────────────────────
  function pwaInstallAvailable() {
    // Already installed → hide. We can't reliably detect a captured
    // beforeinstallprompt event without an exported API, so otherwise
    // surface the action and let onInstallClick bail if no prompt.
    try {
      if (window.matchMedia &&
          window.matchMedia('(display-mode: standalone)').matches) return false;
    } catch (_) {}
    if (window.navigator && window.navigator.standalone === true) return false;
    return true;
  }

  // ── Account state helper ────────────────────────────────────────────
  function getAuthUser() {
    try {
      if (App.Auth && typeof App.Auth.getUser === 'function') return App.Auth.getUser();
      if (App.Auth && App.Auth.user) return App.Auth.user;
    } catch (_) {}
    return null;
  }

  function buildActions() {
    const user = getAuthUser();
    const signedIn = !!user;
    return [
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
        run: async function () {
          const keep = confirm('Sign out?\n\nClick OK to keep your synced data on this device. Click Cancel to also remove it from this device.');
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
          close();
          if (window.UI && UI.toast) UI.toast('Signed out.', 'info', 2200);
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
        id: 'print-army',
        label: 'Print datasheets',
        section: 'export',
        run() { close(); clickToolbarBtn('btn-print-army'); },
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

    // ACCOUNT — top of the sheet on mobile, where the topbar account button used to be.
    const accountActions = actions.filter(a => a.section === 'account' && visible(a));
    if (accountActions.length) {
      b.appendChild(renderSectionHeader('Account'));
      accountActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // EXPORT — desktop export-dropdown items, surfaced here for mobile.
    const exportActions = actions.filter(a => a.section === 'export' && visible(a));
    if (exportActions.length) {
      b.appendChild(renderSectionHeader('Export'));
      exportActions.forEach(a => b.appendChild(renderActionRow(a)));
    }

    // DISPLAY (toggles 0..3)
    b.appendChild(renderSectionHeader('Display'));
    [0, 1, 2, 3].forEach(i => b.appendChild(renderToggleRow(TOGGLES[i])));

    // AUDIO & INPUT (toggles 4..5)
    b.appendChild(renderSectionHeader('Audio & input'));
    [4, 5].forEach(i => b.appendChild(renderToggleRow(TOGGLES[i])));

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
    // focus the close button for keyboard users
    const close = document.getElementById('settings-drawer-close');
    setTimeout(() => { if (close) close.focus(); }, 30);
  }

  function close() {
    const r = root();
    if (!r) return;
    if (!isOpen()) return;
    r.setAttribute('hidden', '');
    document.body.classList.remove('settings-drawer-open');
    const sb = settingsBtn();
    if (sb) sb.setAttribute('aria-expanded', 'false');
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
      if (e.key === 'Escape' && isOpen()) close();
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
