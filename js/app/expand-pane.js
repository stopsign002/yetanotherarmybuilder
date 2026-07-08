// app/expand-pane.js — click a panel header (Army / Units / Details) to
// expand that pane to fill the whole 3-pane area. Click again, click
// another header, or press Escape to restore the 3-pane layout.
//
// Animation is driven by CSS (css/expand-pane.css transitions
// grid-template-columns). This module only manages classes + the small
// expand/collapse toggle button injected into each panel header.
(function () {
  const App = window.App = window.App || {};

  const PANEL_IDS = ['panel-left', 'panel-center', 'panel-right'];
  const POSITION = { 'panel-left': 'left', 'panel-center': 'center', 'panel-right': 'right' };

  // Inline SVG icons — kept tiny and inherit currentColor so they pick up
  // the panel header's accent color.
  const ICON_EXPAND =
    '<svg class="expand-icon-expand" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M2 2h5v2H4v3H2V2zm12 0v5h-2V4H9V2h5zM2 14v-5h2v3h3v2H2zm12 0H9v-2h3V9h2v5z"/>' +
    '</svg>';
  const ICON_COLLAPSE =
    '<svg class="expand-icon-collapse" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M7 2v5H2V5h3V2h2zm7 3v2H9V2h2v3h3zM2 9h5v5H5v-3H2V9zm7 0h5v2h-3v3H9V9z"/>' +
    '</svg>';

  function ensureExpandButton(panel) {
    const header = panel.querySelector(':scope > .panel-header');
    if (!header) return;
    if (header.querySelector(':scope > .panel-expand-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-expand-btn';
    btn.title = 'Expand this pane';
    btn.setAttribute('aria-label', 'Expand pane');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = ICON_EXPAND + ICON_COLLAPSE;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      togglePanel(panel.id);
    });
    header.appendChild(btn);

    // Make the whole header (h2 + any badges) a click target too.
    header.addEventListener('click', e => {
      // Ignore clicks on existing interactive elements (load-status,
      // unit-count-badge are spans, but a future button child would be
      // surprising to swallow). The expand button stops propagation
      // itself; this is a fallback.
      if (e.target.closest('.panel-expand-btn')) return;
      // Only the H2 (and pseudo header surface) acts as the toggle so we
      // don't hijack future inline controls.
      if (e.target.closest('h2')) {
        togglePanel(panel.id);
      }
    });
  }

  function getMain() {
    return document.getElementById('app-main');
  }

  function isExpanded(panelId) {
    const main = getMain();
    if (!main) return false;
    // Units (center) expands to fullscreen on its own. The Army (left) and
    // Details (right) panes are not useful alone — they need each other — so
    // expanding EITHER enters a shared "build focus" that hides only the Units
    // pane and shows Army + Details together (main.pane-expanded-build).
    if (panelId === 'panel-center') return main.classList.contains('pane-expanded-center');
    return main.classList.contains('pane-expanded-build');
  }

  function setBtn(panel, expanded) {
    if (!panel) return;
    const btn = panel.querySelector('.panel-expand-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.title = expanded ? 'Restore 3-pane view' : 'Expand this pane';
    }
  }

  function clearExpanded() {
    const main = getMain();
    if (!main) return;
    main.classList.remove('pane-expanded-center', 'pane-expanded-build');
    PANEL_IDS.forEach(id => {
      const p = document.getElementById(id);
      if (p) {
        p.classList.remove('panel-expanded', 'panel-build-focus');
        setBtn(p, false);
      }
    });
    document.body.classList.remove('pane-is-expanded');
    // If we auto-opened the army rules collapsible on expand, restore
    // its previous closed state.
    const rules = document.getElementById('army-rules-collapsible');
    if (rules && rules.dataset.expandPaneAutoOpened === '1') {
      rules.open = false;
      delete rules.dataset.expandPaneAutoOpened;
    }
  }

  function expandPanel(panelId) {
    const main = getMain();
    const panel = document.getElementById(panelId);
    if (!main || !panel) return;
    clearExpanded();
    document.body.classList.add('pane-is-expanded');

    if (panelId === 'panel-center') {
      // Units: fullscreen, as before.
      main.classList.add('pane-expanded-center');
      panel.classList.add('panel-expanded');
      setBtn(panel, true);
      return;
    }

    // Army OR Details: hide only the Units pane; keep Army + Details side by
    // side. Both panes get the "collapse" affordance so either header restores
    // the 3-pane view.
    main.classList.add('pane-expanded-build');
    const left  = document.getElementById('panel-left');
    const right = document.getElementById('panel-right');
    if (left)  { left.classList.add('panel-build-focus');  setBtn(left, true); }
    if (right) { right.classList.add('panel-build-focus'); setBtn(right, true); }

    // Auto-open the rules+stratagems collapsible so the user sees their
    // detachment rules and strats next to the army list without a second click.
    const rules = document.getElementById('army-rules-collapsible');
    if (rules && !rules.open) {
      rules.dataset.expandPaneAutoOpened = '1';
      rules.open = true;
    }
  }

  function togglePanel(panelId) {
    if (isExpanded(panelId)) clearExpanded();
    else expandPanel(panelId);
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    const main = getMain();
    if (!main) return;
    const anyExpanded = main.classList.contains('pane-expanded-center')
      || main.classList.contains('pane-expanded-build');
    if (!anyExpanded) return;
    // Don't fight modal Escape handlers — only act when no modal is open.
    const openModal = document.querySelector('.modal-backdrop:not([hidden])');
    if (openModal) return;
    clearExpanded();
  }

  function init() {
    PANEL_IDS.forEach(id => {
      const p = document.getElementById(id);
      if (p) ensureExpandButton(p);
    });
    document.addEventListener('keydown', onKeyDown);
  }

  // Expose a small public surface so other modules (or tests) can drive
  // the expanded state programmatically.
  App.PaneExpand = {
    expand: expandPanel,
    collapse: clearExpanded,
    toggle: togglePanel,
    isExpanded: isExpanded,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
