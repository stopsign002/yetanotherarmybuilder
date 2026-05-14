// app/search-clear.js — adds a small "×" clear button at the right edge
// of the unit-search box so it can be cleared with the mouse. Reuses the
// `.yaab-search-wrap` that hero-state.js puts around #search-input (it's
// already position:relative and pads the input on the right); if that
// wrap isn't present, wraps the input ourselves in `.search-input-wrap`.
// On click it empties the field, refocuses it, and dispatches an `input`
// event so the roster re-renders through the normal path (events.js).
//
// Loaded AFTER hero-state.js in index.html so its `.yaab-search-wrap`
// already exists by the time our bootstrap hook runs.
(function () {
  const App = window.App = window.App || {};

  function syncBtn(input, host) {
    if (host) host.classList.toggle('has-search-value', !!(input && input.value));
  }

  function ensureSearchClear() {
    const input = document.getElementById('search-input');
    if (!input || !input.parentNode) return;

    let host = input.closest('.yaab-search-wrap');
    if (!host) {
      host = input.parentElement;
      if (!host.classList.contains('search-input-wrap')) {
        const w = document.createElement('div');
        w.className = 'search-input-wrap';
        input.parentNode.insertBefore(w, input);
        w.appendChild(input);
        host = w;
      }
    }

    if (host.querySelector('.search-clear')) { syncBtn(input, host); return; }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-clear';
    btn.setAttribute('aria-label', 'Clear search');
    btn.title = 'Clear search';
    btn.tabIndex = -1;
    btn.textContent = '×'; // ×
    host.appendChild(btn);

    btn.addEventListener('mousedown', e => { e.preventDefault(); }); // keep focus path predictable
    btn.addEventListener('click', () => {
      if (input.value) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.focus();
      syncBtn(input, host);
    });
    input.addEventListener('input', () => syncBtn(input, host));
    syncBtn(input, host);
  }

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(ensureSearchClear);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSearchClear, { once: true });
  } else {
    ensureSearchClear();
  }
})();
