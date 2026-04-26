// ui/animated-crest.js — injects a stylized rotating hex crest into the empty unit-detail panel when a faction is selected.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Crest design: a hex frame (static), an inner rotating ring of six
  // dashes (rotor), and a central chevron + dot (pulse). All currentColor
  // so the accent variable drives the tint. ~80x80 viewport.
  const CREST_SVG =
    '<svg class="atmosphere-crest" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        // Outer hex frame (static)
        '<path d="M50 6 L86 26 L86 74 L50 94 L14 74 L14 26 Z" stroke-opacity="0.85"/>' +
        // Inner hex outline (static, lighter)
        '<path d="M50 22 L72 35 L72 65 L50 78 L28 65 L28 35 Z" stroke-opacity="0.45"/>' +
        // Rotor: six tick marks around a 30-radius circle
        '<g class="atmosphere-crest-rotor" stroke-opacity="0.7">' +
          '<line x1="50" y1="14" x2="50" y2="22"/>' +
          '<line x1="80" y1="32" x2="73" y2="36"/>' +
          '<line x1="80" y1="68" x2="73" y2="64"/>' +
          '<line x1="50" y1="86" x2="50" y2="78"/>' +
          '<line x1="20" y1="68" x2="27" y2="64"/>' +
          '<line x1="20" y1="32" x2="27" y2="36"/>' +
        '</g>' +
        // Pulse: central chevron + dot
        '<g class="atmosphere-crest-pulse">' +
          '<path d="M38 56 L50 44 L62 56" stroke-opacity="0.95"/>' +
          '<circle cx="50" cy="62" r="2.4" fill="currentColor" stroke="none"/>' +
        '</g>' +
      '</g>' +
    '</svg>';

  const CREST_HTML =
    '<div class="atmosphere-crest-wrap" data-atmosphere-crest="1">' +
      CREST_SVG +
      '<div class="atmosphere-crest-tagline">Select a unit to view its datasheet.</div>' +
    '</div>';

  function factionSelected() {
    const s = App.state;
    return !!(s && s.factionFilter && s.factionFilter !== 'all');
  }

  function emptyVisible(empty) {
    if (!empty) return false;
    if (empty.hasAttribute('hidden')) return false;
    const display = empty.style && empty.style.display;
    if (display === 'none') return false;
    return true;
  }

  function syncCrest() {
    const empty = document.getElementById('unit-detail-empty');
    if (!empty) return;
    const visible = emptyVisible(empty);
    const existing = empty.querySelector('[data-atmosphere-crest="1"]');
    if (visible && factionSelected()) {
      if (!existing) empty.insertAdjacentHTML('beforeend', CREST_HTML);
    } else if (existing) {
      existing.remove();
    }
  }

  App.hooks.selectionChange.push(syncCrest);
  App.hooks.armyChange.push(syncCrest);

  App.hooks.bootstrap.push(function () {
    const panel = document.getElementById('unit-detail-panel');
    syncCrest();
    if (panel && typeof MutationObserver === 'function') {
      // Detail panel content is replaced when a unit is selected; observe
      // the panel and re-sync (which removes the crest if needed).
      const obs = new MutationObserver(function () { syncCrest(); });
      obs.observe(panel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'hidden', 'class'],
      });
    }
  });
})();
