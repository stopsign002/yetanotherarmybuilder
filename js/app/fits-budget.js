// app/fits-budget.js — "Fits budget" checkbox chip in the roster filter bar.
//
// When checked, the unit roster shows only datasheets whose cheapest priced
// size fits in the points the current army has left (pointsLimit − total).
// It is a real <input type="checkbox"> inside a .filter-chip label, so it
// inherits the chip styling and the shared × clear button (docs/UI.md
// "Roster filter chips"). Session-only: it is not persisted, because a
// filter that silently hides most of the roster on reload is a support
// ticket, not a convenience. BUILD mode only — the predicate is a no-op and
// the chip is hidden elsewhere (collection.js gates the same way).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  let active = false;
  let chipObserver = null;

  function army() { return App.state && App.state.currentArmy; }
  function inBuild() { return (document.body.getAttribute('data-mode') || 'build') === 'build'; }

  // pointsLimit 0/blank = no budget set → null (chip disabled, filter off).
  function remaining() {
    const a = army();
    const limit = Number(a && a.pointsLimit) || 0;
    if (!a || limit <= 0) return null;
    const total = typeof a.getTotalPoints === 'function' ? a.getTotalPoints() : 0;
    return limit - total;
  }

  function cheapest(unit) {
    const costs = (App.PointsFilter && App.PointsFilter.unitCosts) ? App.PointsFilter.unitCosts(unit) : [];
    return costs.length ? Math.min.apply(null, costs) : null;
  }

  function predicate(unit) {
    if (!active || !inBuild()) return true;
    const left = remaining();
    if (left === null) return true;
    const cost = cheapest(unit);
    // Unknown cost passes: hiding a possibly-valid pick is the worse error
    // (same rule as points-filter.js).
    return cost === null || cost <= left;
  }
  predicate._isFitsBudget = true;

  function rerender() {
    if (typeof App.renderUnitRosterWithContext === 'function') App.renderUnitRosterWithContext();
  }

  function syncChip() {
    const label = document.querySelector('.fits-budget-chip');
    if (!label) return;
    const input = label.querySelector('input');
    const text  = label.querySelector('[data-fits-left]');
    const left  = remaining();
    label.hidden = !inBuild();
    input.disabled = left === null;
    input.checked = active;
    label.classList.toggle('active', active && left !== null);
    label.title = left === null
      ? 'Set a points limit on the army to filter by what still fits'
      : 'Show only units whose cheapest size fits in the ' + left + ' pts you have left';
    text.textContent = left === null ? '' : ' (≤ ' + left + ')';
    if (window.UI && typeof UI.syncChipClearVisibility === 'function') UI.syncChipClearVisibility();
  }

  function injectChip(bar) {
    if (!bar || bar.querySelector('.fits-budget-chip')) { syncChip(); return; }
    const label = document.createElement('label');
    label.className = 'filter-chip filter-chip-check fits-budget-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', 'Only units that fit the remaining points');
    input.addEventListener('change', () => {
      active = input.checked;
      syncChip();
      rerender();
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode('Fits budget'));
    const span = document.createElement('span');
    span.setAttribute('data-fits-left', '');
    label.appendChild(span);
    const clearBtn = bar.querySelector('.filter-chips-clear');
    if (clearBtn) bar.insertBefore(label, clearBtn); else bar.appendChild(label);
    syncChip();
  }

  // roster.js builds the bar on first render, after bootstrap.
  function installChipObserver() {
    if (chipObserver) { chipObserver.disconnect(); chipObserver = null; }
    const existing = document.getElementById('roster-filter-chips');
    if (existing) { injectChip(existing); return; }
    const center = document.getElementById('panel-center') || document.body;
    chipObserver = new MutationObserver(() => {
      const bar = document.getElementById('roster-filter-chips');
      if (!bar) return;
      injectChip(bar);
      chipObserver.disconnect(); chipObserver = null;
    });
    chipObserver.observe(center, { childList: true, subtree: true });
  }

  App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isFitsBudget);
  App.hooks.rosterFilters.push(predicate);

  if (!Array.isArray(App.hooks.chipClearers)) App.hooks.chipClearers = [];
  if (!Array.isArray(App.hooks.chipActive))   App.hooks.chipActive   = [];
  if (!Array.isArray(App.hooks.modeChange))   App.hooks.modeChange   = [];
  App.hooks.chipClearers.push(function () { active = false; syncChip(); });
  App.hooks.chipActive.push(function () { return active && remaining() !== null; });
  App.hooks.modeChange.push(function () { syncChip(); });

  // The budget moves with every add/remove/limit edit; the label always
  // follows it and the roster re-filters only while the chip is on.
  App.hooks.armyChange.push(function () {
    syncChip();
    if (active && inBuild()) rerender();
  });

  App.hooks.bootstrap.push(installChipObserver);
})();
