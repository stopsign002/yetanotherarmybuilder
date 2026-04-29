// app/pwa-install.js — beforeinstallprompt handler + mobile tab-bar wiring; registers a hook-driven install button.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const DISMISS_KEY = 'yaab_pwa_dismissed';
  const PANEL_KEY = 'yaab_mobile_panel';
  const BTN_ID = 'yaab-btn-install';

  let deferredPrompt = null;

  // ── Install-prompt capture + button visibility ─────────────────────────
  function isStandalone() {
    try {
      return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone === true;
    } catch (_) { return false; }
  }

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; }
    catch (_) { return false; }
  }

  function updateInstallBtn() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const show = !!deferredPrompt && !isStandalone() && !isDismissed();
    btn.hidden = !show;
    btn.style.display = show ? '' : 'none';
  }

  async function onInstallClick() {
    if (!deferredPrompt) return;
    const evt = deferredPrompt;
    deferredPrompt = null;
    try {
      evt.prompt();
      const choice = await evt.userChoice;
      if (choice && choice.outcome === 'dismissed') {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
      }
    } catch (_) {}
    updateInstallBtn();
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallBtn();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
    updateInstallBtn();
  });

  if (window.matchMedia) {
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallBtn);
    } catch (_) { /* older Safari */ }
  }

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: '⬇',
    ariaLabel: 'Install as app',
    title: 'Install to home screen',
    onClick: onInstallClick,
  });

  // ── Mobile tab bar injection + wiring ──────────────────────────────────
  // Four tabs: Army | Units | Details | More. "More" opens the existing
  // Settings drawer (which already aggregates feature actions and toggles).
  // Active tab is marked via aria-current="page" so CSS can style it.
  function setPanel(name) {
    const valid = (name === 'army' || name === 'units' || name === 'detail') ? name : 'units';
    document.body.dataset.mobilePanel = valid;
    try { localStorage.setItem(PANEL_KEY, valid); } catch (_) {}
    syncActiveTab(valid);
    // Notify listeners (mobile-shell.js binds to this for page-title updates).
    try {
      document.dispatchEvent(new CustomEvent('yaab:mobile-panel-change', { detail: { panel: valid } }));
    } catch (_) {}
  }
  App.setMobilePanel = setPanel;

  function initialPanel() {
    try {
      const saved = localStorage.getItem(PANEL_KEY);
      if (saved === 'army' || saved === 'units' || saved === 'detail') return saved;
    } catch (_) {}
    return 'units';
  }

  function syncActiveTab(panel) {
    const nav = document.querySelector('.mobile-tabbar');
    if (!nav) return;
    nav.querySelectorAll('button[data-panel]').forEach(b => {
      if (b.getAttribute('data-panel') === panel) {
        b.setAttribute('aria-current', 'page');
      } else {
        b.removeAttribute('aria-current');
      }
    });
  }

  // Inline SVGs (24×24, currentColor) — keeps everything in one file, no
  // sprite asset to wire up. Stroke-based glyphs to read well at 22px.
  const ICONS = {
    army: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10"/></svg>',
    units: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></g></svg>',
    detail: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="3.4"/><path d="M5 20c1-3.4 3.8-5.2 7-5.2S18 16.6 19 20"/></g></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></g></svg>',
  };

  function makeTab(panel, label, iconKey) {
    return '<button type="button"' +
           (panel ? ' data-panel="' + panel + '"' : ' data-action="more"') +
           ' aria-label="' + label + '">' +
           '<span class="mtab-icon">' + ICONS[iconKey] + '</span>' +
           '<span class="mtab-label">' + label + '</span>' +
           '<span class="mtab-badge" data-badge="' + (panel || 'more') + '"></span>' +
           '</button>';
  }

  function injectTabBar() {
    if (document.querySelector('.mobile-tabbar')) return;
    const nav = document.createElement('nav');
    nav.className = 'mobile-tabbar';
    nav.setAttribute('aria-label', 'Panel navigation');
    nav.innerHTML =
      makeTab('army',   'Army',    'army') +
      makeTab('units',  'Units',   'units') +
      makeTab('detail', 'Details', 'detail') +
      makeTab(null,     'More',    'more');

    nav.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-panel], button[data-action="more"]');
      if (!btn) return;
      const panel = btn.getAttribute('data-panel');
      if (panel) {
        setPanel(panel);
        return;
      }
      // More: open the settings drawer (it has sync-now, change-pwd, sign-out,
      // bug-report, feature toggles, BSData clear, etc.).
      if (App.settingsDrawer && typeof App.settingsDrawer.open === 'function') {
        App.settingsDrawer.open();
      } else {
        // Fallback: click the topbar settings button.
        const sb = document.getElementById('topbar-settings');
        if (sb) sb.click();
      }
    });
    document.body.appendChild(nav);
  }

  // ── Badge updates from armyChange hook ─────────────────────────────────
  function setBadge(target, text) {
    const el = document.querySelector('.mobile-tabbar [data-badge="' + target + '"]');
    if (!el) return;
    el.textContent = text || '';
  }
  function updateBadges() {
    try {
      const army = window.App && App.state && App.state.currentArmy;
      if (!army) return;
      const entries = army.entries || [];
      const total = entries.reduce((acc, e) => acc + (e.qty || 0), 0);
      setBadge('army', total > 0 ? String(total) : '');
      // Units badge: leave blank for now (could show roster count later).
    } catch (_) {}
  }

  App.hooks.bootstrap.push(function () {
    injectTabBar();
    setPanel(initialPanel());
    updateInstallBtn();
    updateBadges();
  });

  if (App.hooks.armyChange && Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(updateBadges);
  }
})();
