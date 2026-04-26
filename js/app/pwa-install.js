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
  function setPanel(name) {
    const valid = (name === 'army' || name === 'units' || name === 'detail') ? name : 'units';
    document.body.dataset.mobilePanel = valid;
    try { localStorage.setItem(PANEL_KEY, valid); } catch (_) {}
  }

  function initialPanel() {
    try {
      const saved = localStorage.getItem(PANEL_KEY);
      if (saved === 'army' || saved === 'units' || saved === 'detail') return saved;
    } catch (_) {}
    return 'units';
  }

  function injectTabBar() {
    if (document.querySelector('.mobile-tabbar')) return;
    const nav = document.createElement('nav');
    nav.className = 'mobile-tabbar';
    nav.setAttribute('aria-label', 'Panel navigation');
    nav.innerHTML =
      '<button type="button" data-panel="army">Army</button>' +
      '<button type="button" data-panel="units">Units</button>' +
      '<button type="button" data-panel="detail">Details</button>';
    nav.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-panel]');
      if (!btn) return;
      setPanel(btn.getAttribute('data-panel'));
    });
    document.body.appendChild(nav);
  }

  App.hooks.bootstrap.push(function () {
    injectTabBar();
    setPanel(initialPanel());
    updateInstallBtn();
  });
})();
