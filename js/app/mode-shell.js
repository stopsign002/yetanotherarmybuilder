// app/mode-shell.js — Build/Collect/Play mode container switching + persistence.
(function () {
  const App = window.App = window.App || {};

  const LS_KEY = 'yaab_mode';
  const VALID = ['build', 'collect', 'play'];
  const DEFAULT_MODE = 'build';

  // Hook bus for cross-module mode-change notifications.
  App.hooks = App.hooks || {};
  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];

  let currentMode = DEFAULT_MODE;
  let initialized = false;

  function $(id) { return document.getElementById(id); }

  function reduceMotion() {
    if (document.body && document.body.classList.contains('reduce-motion')) return true;
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) { return false; }
  }

  function readPersisted() {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (VALID.indexOf(v) !== -1) return v;
    } catch (_) {}
    return DEFAULT_MODE;
  }

  function writePersisted(mode) {
    try { localStorage.setItem(LS_KEY, mode); } catch (_) {}
  }

  function getSection(mode) { return $(mode + '-mode'); }

  function fireHooks(mode) {
    const hooks = App.hooks.modeChange || [];
    for (let i = 0; i < hooks.length; i++) {
      try { hooks[i](mode); } catch (e) {
        console.warn('[mode-shell] modeChange hook threw:', e && e.message);
      }
    }
    // Belt-and-braces: also dispatch a DOM event so non-hook listeners
    // (or modules that loaded before App.hooks existed) can react.
    try {
      document.dispatchEvent(new CustomEvent('yaab:mode-change', { detail: { mode } }));
    } catch (_) {}
  }

  function applyMode(mode, opts) {
    if (VALID.indexOf(mode) === -1) mode = DEFAULT_MODE;
    const animate = !(opts && opts.silent) && !reduceMotion();

    // Section visibility ----------------------------------------------------
    VALID.forEach(m => {
      const sec = getSection(m);
      if (!sec) return;
      const isActive = (m === mode);
      sec.classList.toggle('mode-active', isActive);
      if (isActive) {
        sec.removeAttribute('hidden');
        if (animate) {
          sec.classList.remove('mode-enter');
          // force reflow to restart the animation
          // eslint-disable-next-line no-unused-expressions
          void sec.offsetWidth;
          sec.classList.add('mode-enter');
        }
      } else {
        sec.setAttribute('hidden', '');
        sec.classList.remove('mode-enter');
      }
    });

    // Tab aria state --------------------------------------------------------
    const tabs = document.querySelectorAll('.topbar-mode-tab');
    tabs.forEach(tab => {
      const isActive = (tab.getAttribute('data-mode') === mode);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });

    // Body data-mode attr (CSS hooks for mode-specific styling) ------------
    if (document.body) document.body.setAttribute('data-mode', mode);

    currentMode = mode;
    writePersisted(mode);
    fireHooks(mode);
  }

  // ── Public API ─────────────────────────────────────────────────────────
  App.setMode = function (mode) { applyMode(mode); };
  App.getMode = function () { return currentMode; };

  // ── Tab click + keyboard wiring ────────────────────────────────────────
  function bindTabs() {
    const list = document.querySelector('.topbar-modes');
    if (!list) return;

    list.addEventListener('click', e => {
      const tab = e.target.closest('.topbar-mode-tab');
      if (!tab) return;
      const mode = tab.getAttribute('data-mode');
      if (mode) applyMode(mode);
    });

    // Arrow-key navigation per WAI-ARIA tablist pattern.
    list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      const tabs = Array.from(list.querySelectorAll('.topbar-mode-tab'));
      if (!tabs.length) return;
      const idx = tabs.indexOf(document.activeElement);
      let next = idx;
      if (e.key === 'ArrowLeft')  next = (idx <= 0) ? tabs.length - 1 : idx - 1;
      if (e.key === 'ArrowRight') next = (idx >= tabs.length - 1) ? 0 : idx + 1;
      if (e.key === 'Home')       next = 0;
      if (e.key === 'End')        next = tabs.length - 1;
      if (next !== idx && tabs[next]) {
        e.preventDefault();
        tabs[next].focus();
        const m = tabs[next].getAttribute('data-mode');
        if (m) applyMode(m);
      }
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    bindTabs();

    // Restore persisted mode after the existing build content has rendered.
    const persisted = readPersisted();
    requestAnimationFrame(() => {
      applyMode(persisted, { silent: persisted === DEFAULT_MODE });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
