// app/pwa-install.js — beforeinstallprompt handler + mobile tab-bar wiring; registers a hook-driven install button.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const DISMISS_KEY = 'yaab_pwa_dismissed';
  const PANEL_KEY = 'yaab_mobile_panel';
  const BTN_ID = 'yaab-btn-install';
  // iOS never fires beforeinstallprompt (issue #60) — the only install route
  // there is Share → Add to Home Screen, done by hand. These back a small
  // instruction sheet, built entirely in JS (index.html is off-limits).
  const SHEET_BACKDROP_ID = 'ios-install-backdrop';
  const SHEET_ID = 'ios-install-sheet';
  const CLOSE_BTN_ID = 'ios-install-close';
  const NOT_NOW_BTN_ID = 'ios-install-not-now';

  let deferredPrompt = null;
  let uiBuilt = false;
  let escHandler = null;

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

  // Safari never implements beforeinstallprompt, so it's the only signal
  // this check can use. MacIntel + multi-touch catches iPadOS 13+, which
  // masquerades as a Mac in its UA string.
  function isIOS() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent)
          || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch (_) { return false; }
  }

  // The FAB was showing on every desktop Chrome/Edge load (deferredPrompt
  // fires there too) and the owner asked for it gone on desktop
  // (2026-09-14). Gated on the same ≤820px cutoff mobile.css uses for its
  // other mobile-only chrome. iOS stays exempt below — an iPad in
  // landscape is wider than 820px and never fires beforeinstallprompt, so
  // it needs the FAB regardless. Desktop still gets the Settings drawer's
  // "Install app" row (App.pwaInstallAvailable, unchanged).
  function mobileLayout() {
    try { return window.matchMedia && window.matchMedia('(max-width: 820px)').matches; }
    catch (_) { return false; }
  }

  // Inline SVGs (24x24, currentColor, stroke-based) — same house style as the
  // tab-bar ICONS below. No emoji: iOS renders the Share glyph in its own
  // colour, which fights every theme here.
  const SHARE_GLYPH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></g></svg>';
  const INSTALL_GLYPH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></g></svg>';

  function buildFabButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'btn btn-accent yaab-install-fab';
    btn.hidden = true;
    btn.style.display = 'none';
    btn.setAttribute('aria-label', 'Install app');
    btn.innerHTML =
      '<span class="yaab-install-fab-icon" aria-hidden="true">' + INSTALL_GLYPH + '</span>' +
      '<span class="yaab-install-fab-label">Install</span>';
    btn.addEventListener('click', onInstallClick);
    return btn;
  }

  function buildIosSheet() {
    const backdrop = document.createElement('div');
    backdrop.id = SHEET_BACKDROP_ID;
    backdrop.className = 'modal-backdrop ios-install-backdrop';
    backdrop.hidden = true;
    // Click the scrim (never a click that bubbled from the panel) to
    // dismiss — same convention as ui/auth-modal.js.
    backdrop.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeIosSheet();
    });

    const panel = document.createElement('div');
    panel.id = SHEET_ID;
    panel.className = 'modal ios-install-sheet';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'ios-install-title');

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('h3');
    title.id = 'ios-install-title';
    title.textContent = 'Install YAAB';
    header.appendChild(title);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-body';
    const ol = document.createElement('ol');
    ol.className = 'ios-install-steps';
    [
      { glyph: SHARE_GLYPH, text: 'Tap the Share button in Safari’s toolbar.' },
      { glyph: '', text: 'Scroll down and tap “Add to Home Screen.”' },
      { glyph: '', text: 'Tap “Add” in the top-right corner.' },
    ].forEach(function (step) {
      const li = document.createElement('li');
      if (step.glyph) {
        const g = document.createElement('span');
        g.className = 'ios-install-step-glyph';
        g.innerHTML = step.glyph;
        li.appendChild(g);
      }
      const t = document.createElement('span');
      t.textContent = step.text;
      li.appendChild(t);
      ol.appendChild(li);
    });
    bodyEl.appendChild(ol);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const notNow = document.createElement('button');
    notNow.type = 'button';
    notNow.id = NOT_NOW_BTN_ID;
    notNow.className = 'btn btn-outline';
    notNow.textContent = 'Not now';
    notNow.addEventListener('click', closeIosSheet);

    const gotIt = document.createElement('button');
    gotIt.type = 'button';
    gotIt.id = CLOSE_BTN_ID;
    gotIt.className = 'btn btn-accent';
    gotIt.textContent = 'Got it';
    gotIt.addEventListener('click', dismissAndCloseIosSheet);

    footer.appendChild(notNow);
    footer.appendChild(gotIt);

    panel.appendChild(header);
    panel.appendChild(bodyEl);
    panel.appendChild(footer);
    backdrop.appendChild(panel);
    return backdrop;
  }

  // Mounted once, lazily — a non-iOS load never shows either node (both
  // start `hidden`), so building them eagerly at bootstrap costs nothing
  // visible but keeps the button's first `updateInstallBtn()` call correct.
  function ensureInstallUi() {
    if (uiBuilt || !document.body) return;
    uiBuilt = true;
    document.body.appendChild(buildFabButton());
    document.body.appendChild(buildIosSheet());
  }

  function closeIosSheet() {
    const bd = document.getElementById(SHEET_BACKDROP_ID);
    if (bd) bd.hidden = true;
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  }

  function dismissAndCloseIosSheet() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
    closeIosSheet();
    updateInstallBtn();
  }

  function openIosSheet() {
    ensureInstallUi();
    const bd = document.getElementById(SHEET_BACKDROP_ID);
    if (!bd) return;
    bd.hidden = false;
    // Bound only while the sheet is open, per the house rule for one-off
    // dialogs — removed again in closeIosSheet().
    escHandler = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeIosSheet();
    };
    document.addEventListener('keydown', escHandler);
    const gotIt = document.getElementById(CLOSE_BTN_ID);
    if (gotIt && typeof gotIt.focus === 'function') gotIt.focus();
  }

  function updateInstallBtn() {
    ensureInstallUi();
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const show = !isStandalone() && !isDismissed()
        && (isIOS() || (!!deferredPrompt && mobileLayout()));
    btn.hidden = !show;
    btn.style.display = show ? '' : 'none';
  }

  async function onInstallClick() {
    if (!deferredPrompt) {
      // No captured prompt: Safari never fires beforeinstallprompt, so this
      // is the iOS path — show the manual Share sheet instead of no-op'ing.
      if (isIOS()) openIosSheet();
      return;
    }
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
    try {
      // Resizing (or rotating) across the 820px cutoff should update the
      // FAB immediately, not just on next load.
      window.matchMedia('(max-width: 820px)').addEventListener('change', updateInstallBtn);
    } catch (_) { /* older Safari */ }
  }


  // pwaInstallAvailable() is the honest version of the drawer's own check: the
  // row should appear only when clicking it will actually do something, which
  // needs a captured prompt — not merely "we aren't already installed".
  App.pwaInstall = onInstallClick;
  App.pwaInstallAvailable = function () {
    return (!!deferredPrompt || isIOS()) && !isStandalone() && !isDismissed();
  };

  // ── Mobile tab bar injection + wiring ──────────────────────────────────
  // Four tabs: Army | Units | Details | More. "More" opens the existing
  // Settings drawer (which already aggregates feature actions and toggles).
  // Active tab is marked via aria-current="page" so CSS can style it.
  // Panes are switched with display:none, which destroys their layout box and
  // resets scrollTop to 0. Without this, scrolling deep into a ~1000-unit
  // roster, tapping a card (which auto-switches to Details) and coming back
  // dumped the user at the top of the list every time.
  const PANE_FOR = { army: '.panel-left', units: '.panel-center', detail: '.panel-right' };
  const scrollMemory = {};

  function paneBody(panel) {
    const sel = PANE_FOR[panel];
    if (!sel) return null;
    const pane = document.querySelector(sel);
    return pane ? pane.querySelector('.panel-body') : null;
  }

  function rememberScroll(panel) {
    const el = paneBody(panel);
    if (el) scrollMemory[panel] = el.scrollTop;
  }

  function restoreScroll(panel) {
    const el = paneBody(panel);
    if (!el) return;
    const y = scrollMemory[panel];
    if (!y) return;
    // The pane was display:none until the attribute flip above, so it has no
    // scroll height yet this frame — wait one frame before restoring.
    requestAnimationFrame(() => { el.scrollTop = y; });
  }

  function setPanel(name) {
    const valid = (name === 'army' || name === 'units' || name === 'detail') ? name : 'units';
    const prev = document.body.dataset.mobilePanel;
    if (prev && prev !== valid) rememberScroll(prev);
    document.body.dataset.mobilePanel = valid;
    try { localStorage.setItem(PANEL_KEY, valid); } catch (_) {}
    if (prev !== valid) restoreScroll(valid);
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
    // First-time default: land on the Army panel, not the Units grid.
    // Dropping a new user straight into the unit picker (with no army
    // context yet) reads as confusing; the Army tab is the friendlier
    // starting point. Returning users keep their last-active tab above.
    return 'army';
  }

  function syncActiveTab(panel) {
    const nav = document.querySelector('.mobile-tabbar');
    if (!nav) return;
    const moreOpen = !!(App.settingsDrawer && typeof App.settingsDrawer.isOpen === 'function'
                        && App.settingsDrawer.isOpen());
    nav.querySelectorAll('button[data-panel]').forEach(b => {
      if (!moreOpen && b.getAttribute('data-panel') === panel) {
        b.setAttribute('aria-current', 'page');
      } else {
        b.removeAttribute('aria-current');
      }
    });
    const moreBtn = nav.querySelector('button[data-action="more"]');
    if (moreBtn) {
      if (moreOpen) moreBtn.setAttribute('aria-current', 'page');
      else moreBtn.removeAttribute('aria-current');
      // settings-drawer calls us from both open() and close(), so this is the
      // one place the disclosure state can stay honest.
      moreBtn.setAttribute('aria-expanded', moreOpen ? 'true' : 'false');
    }
  }
  // Expose so settings-drawer can call us when it opens/closes.
  App._syncMobileTabActive = syncActiveTab;

  // Inline SVGs (24×24, currentColor) — keeps everything in one file, no
  // sprite asset to wire up. Stroke-based glyphs to read well at 22px.
  const ICONS = {
    army: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10"/></svg>',
    units: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></g></svg>',
    detail: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="3.4"/><path d="M5 20c1-3.4 3.8-5.2 7-5.2S18 16.6 19 20"/></g></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></g></svg>',
  };

  function makeTab(panel, label, iconKey) {
    // "More" is a disclosure for the settings sheet, not a panel tab, so it
    // needs the expanded/controls pair. Without it a screen-reader user gets a
    // button called "More" with no indication it opens anything or that it is
    // currently open — and on mobile this tab bar is the only chrome there is.
    const disclosure = panel
      ? ''
      : ' aria-haspopup="dialog" aria-expanded="false" aria-controls="settings-drawer-root"';
    return '<button type="button"' +
           (panel ? ' data-panel="' + panel + '"' : ' data-action="more"') +
           disclosure +
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
        // Tapping the tab you're already on scrolls that pane to the top —
        // the standard bottom-nav gesture, and previously a dead tap.
        const drawerShut = !(App.settingsDrawer && typeof App.settingsDrawer.isOpen === 'function'
                             && App.settingsDrawer.isOpen());
        if (drawerShut && document.body.dataset.mobilePanel === panel) {
          const body = paneBody(panel);
          if (body) {
            scrollMemory[panel] = 0;
            body.scrollTo ? body.scrollTo({ top: 0, behavior: 'smooth' }) : (body.scrollTop = 0);
          }
          return;
        }
        // Tapping a panel tab while the More sheet is open closes it
        // first — gives the user "navigate away" semantics without
        // forcing them to find the X button.
        if (App.settingsDrawer && typeof App.settingsDrawer.isOpen === 'function'
            && App.settingsDrawer.isOpen()
            && typeof App.settingsDrawer.close === 'function') {
          App.settingsDrawer.close();
        }
        setPanel(panel);
        return;
      }
      // More: toggle the settings drawer. If already open, close it
      // (re-tapping More acts as a close/back affordance).
      if (App.settingsDrawer && typeof App.settingsDrawer.toggle === 'function') {
        App.settingsDrawer.toggle();
      } else if (App.settingsDrawer && typeof App.settingsDrawer.open === 'function') {
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
