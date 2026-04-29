// app/details-persist.js — remember which collapsible <details> boxes the
// user has open or collapsed across page reloads. Targets the army-setup
// section and the army-rules-and-stratagems collapsible by default.
(function () {
  const App = window.App = window.App || {};

  const STORAGE_KEY = 'yaab_details_state';

  // Element IDs we manage. Each is a <details> with a default open state in
  // the markup; localStorage overrides that default when present.
  const TARGET_IDS = [
    'army-setup-section',
    'army-rules-collapsible',
  ];

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }

  function writeState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function applyAndWire(id) {
    const el = document.getElementById(id);
    if (!el || el.tagName !== 'DETAILS') return;
    const state = readState();
    if (Object.prototype.hasOwnProperty.call(state, id)) {
      // Apply the saved open/closed state, overriding the default markup.
      el.open = !!state[id];
    }
    el.addEventListener('toggle', function () {
      const cur = readState();
      cur[id] = !!el.open;
      writeState(cur);
    });
  }

  function applyAll() {
    TARGET_IDS.forEach(applyAndWire);
  }

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(applyAll);
  } else {
    // Defensive fallback: bootstrap hook not yet defined when this module
    // loads (script-order issue). Wait for DOMContentLoaded.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyAll, { once: true });
    } else {
      applyAll();
    }
  }
})();
