// app/points-filter.js — "what can I afford" roster filter.
// Numeric input next to the search box; only units whose minimum buyable
// points cost is ≤ the entered value pass through. Use case: "I have 40
// points left, what fits?"
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const STORAGE_KEY = 'yaab_points_filter_max';

  let maxPts = NaN; // NaN = filter inactive

  function unitMinCost(unit) {
    // Squad-able units carry one cost per buyable squad size in
    // `pointsOptions[]`. `points` is the headline cost (typically the smallest
    // squad). Use the minimum of either source so a 5-model option that costs
    // 80 doesn't hide the unit from a 40-pt budget when it has a smaller
    // variant. If neither is present we treat the cost as 0 (unknown) and let
    // the unit pass — false-positives are harmless, false-negatives hide
    // affordable picks.
    if (!unit) return 0;
    const opts = Array.isArray(unit.pointsOptions) ? unit.pointsOptions : [];
    const candidates = [];
    for (const p of opts) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) candidates.push(n);
    }
    const head = Number(unit.points);
    if (Number.isFinite(head) && head > 0) candidates.push(head);
    if (candidates.length === 0) return 0;
    return Math.min(...candidates);
  }

  function pointsPredicate(unit) {
    if (!Number.isFinite(maxPts)) return true; // filter off
    return unitMinCost(unit) <= maxPts;
  }
  // Tag the predicate so we can look it up / replace it idempotently.
  pointsPredicate._isPointsFilter = true;

  function ensurePredicateRegistered() {
    const list = App.hooks.rosterFilters;
    if (list.some(fn => fn._isPointsFilter)) return;
    list.push(pointsPredicate);
  }

  function readFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return NaN;
      const n = Number(raw);
      return (Number.isFinite(n) && n > 0) ? n : NaN;
    } catch (_) { return NaN; }
  }

  function writeToStorage(n) {
    try {
      if (Number.isFinite(n) && n > 0) localStorage.setItem(STORAGE_KEY, String(n));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function syncClearButton(input, clearBtn) {
    if (!clearBtn) return;
    const val = (input.value || '').trim();
    clearBtn.hidden = val === '';
  }

  function applyFromInput(input, clearBtn) {
    const raw = (input.value || '').trim();
    const n = raw === '' ? NaN : Number(raw);
    maxPts = (Number.isFinite(n) && n > 0) ? n : NaN;
    writeToStorage(maxPts);
    syncClearButton(input, clearBtn);
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  function wire() {
    const input = document.getElementById('points-filter-input');
    const clearBtn = document.getElementById('points-filter-clear');
    if (!input) return;
    ensurePredicateRegistered();

    // Restore last-used value across reloads so a user who set "≤ 40" doesn't
    // lose it on refresh.
    const saved = readFromStorage();
    if (Number.isFinite(saved)) {
      input.value = String(saved);
      maxPts = saved;
    }
    syncClearButton(input, clearBtn);

    input.addEventListener('input', () => applyFromInput(input, clearBtn));
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        applyFromInput(input, clearBtn);
        input.focus();
      });
    }
  }

  if (Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(wire);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
