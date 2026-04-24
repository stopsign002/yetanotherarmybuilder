// ui/scanline.js — tactical-display scanline sweep on faction switch + body classes for active-panel accent stripes.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const REDUCED = (function () {
    try {
      const m = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      return m && m.matches;
    } catch (e) { return false; }
  })();

  let lastFaction = null;   // tracks the last-seen faction filter for diff
  let lastDetach  = null;
  let activeNode  = null;   // the in-flight scanline element (for cancellation)

  function currentFactionKey(state) {
    if (!state) return '';
    const f = state.factionFilter || '';
    const c = state.selectedChapter || '';
    return f === 'all' ? '' : (c ? c : f);
  }

  function spawnScanline() {
    if (REDUCED) return;
    if (activeNode) {
      // Cancel the previous sweep — drop it immediately.
      try { activeNode.remove(); } catch (e) { /* noop */ }
      activeNode = null;
    }
    const el = document.createElement('div');
    el.className = 'atmosphere-scanline';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    activeNode = el;
    el.addEventListener('animationend', function () {
      if (el === activeNode) activeNode = null;
      try { el.remove(); } catch (e) { /* noop */ }
    });
  }

  // ── body classes for the active-panel accent stripe ────────────────
  function syncBodyClasses(state) {
    const body = document.body;
    if (!body) return;
    const hasFaction = !!(state && state.factionFilter && state.factionFilter !== 'all');
    body.classList.toggle('has-selected-faction', hasFaction);

    // Selected unit: detail panel showing a unit means #unit-detail-empty is hidden.
    const empty = document.getElementById('unit-detail-empty');
    const panel = document.getElementById('unit-detail-panel');
    const hasUnit = !!(state && state.selectedUnit) ||
      (panel && !!panel.querySelector('.unit-detail-content')) ||
      (empty && empty.style.display === 'none');
    body.classList.toggle('has-selected-unit', !!hasUnit);
  }

  // ── selectionChange: detect faction switch, fire scanline ──────────
  App.hooks.selectionChange.push(function (state) {
    syncBodyClasses(state);
    const key = currentFactionKey(state);
    const detach = (state && state.selectedDetachment) || '';
    if (lastFaction === null && lastDetach === null) {
      // First call after bootstrap — seed without animating.
      lastFaction = key;
      lastDetach = detach;
      return;
    }
    if (key !== lastFaction) {
      lastFaction = key;
      lastDetach = detach;
      // Defer one frame so the new --accent-rgb is applied first.
      requestAnimationFrame(function () { spawnScanline(); });
    } else if (detach !== lastDetach) {
      lastDetach = detach;
    }
  });

  // ── armyChange: a unit may have just been selected/cleared ─────────
  App.hooks.armyChange.push(function () { syncBodyClasses(App.state); });

  // ── bootstrap: prime body classes & seed faction key ───────────────
  App.hooks.bootstrap.push(function (state) {
    lastFaction = currentFactionKey(state);
    lastDetach  = (state && state.selectedDetachment) || '';
    syncBodyClasses(state);

    // Watch the detail panel for content swaps — covers cases where a
    // unit selection isn't reflected in App.state.selectedUnit yet.
    const panel = document.getElementById('unit-detail-panel');
    if (panel && typeof MutationObserver === 'function') {
      const obs = new MutationObserver(function () { syncBodyClasses(App.state); });
      obs.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
  });
})();
