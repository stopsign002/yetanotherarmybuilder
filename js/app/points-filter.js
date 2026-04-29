// app/points-filter.js — points filter inlined into the unit search bar.
// Comparator tokens in the search input filter units by buildable points cost:
//   <=200  ≤200    pts cost is at most N
//   <100             strictly less than N
//   >=100  ≥100    pts cost is at least N
//   >50              strictly greater than N
//   =150             exactly N pts
// Multiple comparators AND together. Example: ">=100 <=200 captain" finds
// captains with a variant in the 100–200 pt range. A unit passes a constraint
// if ANY of its squad/variant costs satisfies it. Use case: "≤40 — what fits
// in my last 40 points?"
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // A token is a comparator followed by a positive integer with no whitespace.
  // Exported so roster.js strips the same tokens before name/keyword matching.
  const TOKEN_RE = /^(<=|>=|≤|≥|<|>|=)(\d+)$/;

  // Constraints are recomputed lazily inside the predicate so we stay in sync
  // with the search input without depending on listener-registration order
  // (events.js's input listener triggers the re-render that calls us).
  let cachedQuery = null;
  let constraints = [];

  function parseQuery(value) {
    const out = [];
    const tokens = (value || '').split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const m = TOKEN_RE.exec(tok);
      if (!m) continue;
      const n = Number(m[2]);
      if (Number.isFinite(n) && n >= 0) out.push({ op: m[1], n });
    }
    return out;
  }

  function syncFromInput() {
    const input = document.getElementById('search-input');
    const value = input ? (input.value || '') : '';
    if (value === cachedQuery) return;
    cachedQuery = value;
    constraints = parseQuery(value);
  }

  function unitCosts(unit) {
    if (!unit) return [];
    const out = [];
    const opts = Array.isArray(unit.pointsOptions) ? unit.pointsOptions : [];
    for (const p of opts) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    const head = Number(unit.points);
    if (Number.isFinite(head) && head > 0) out.push(head);
    return out;
  }

  function satisfies(cost, c) {
    switch (c.op) {
      case '<=': case '≤': return cost <= c.n;
      case '>=': case '≥': return cost >= c.n;
      case '<':            return cost <  c.n;
      case '>':            return cost >  c.n;
      case '=':            return cost === c.n;
    }
    return true;
  }

  function pointsPredicate(unit) {
    syncFromInput();
    if (constraints.length === 0) return true;
    const costs = unitCosts(unit);
    // Unknown cost: let it pass — false-positives are harmless, false-negatives
    // would hide otherwise-valid picks.
    if (costs.length === 0) return true;
    for (const c of constraints) {
      if (!costs.some(cost => satisfies(cost, c))) return false;
    }
    return true;
  }
  pointsPredicate._isPointsFilter = true;

  function register() {
    const list = App.hooks.rosterFilters;
    if (list.some(fn => fn._isPointsFilter)) return;
    list.push(pointsPredicate);
  }

  // Exposed for roster.js so it can strip points tokens before name matching.
  App.PointsFilter = { TOKEN_RE };

  if (Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(register);
  } else {
    register();
  }
})();
