// app/reserves.js — "Reserves": the user's owned-units stockpile with
// per-unit quantities. Layers on top of collection.js (which tracks paint
// status, no quantities). The Build-mode unit pane defaults to a Reserves
// view that lists only units the user has at least one of, with an inline
// stepper to adjust the count. Toggle to "All Units" to browse the full
// roster and seed the Reserves from there. Soft-warns the army list when
// a unit's army count exceeds what the user owns.
//
// Storage:
//   yaab_reserves    : { unitId: qty }   — sparse; no key when qty is 0.
//   yaab_units_view  : 'reserves' | 'all' — last-active view in the unit pane.
//
// Mode gating: the Reserves predicate only filters in BUILD mode. In other
// modes (Collect / Play / Cards) the predicate is a no-op so toggling
// modes can't silently hide a roster.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_RESERVES = 'yaab_reserves';
  const LS_VIEW     = 'yaab_units_view';
  const VIEW_RESERVES     = 'reserves';
  const VIEW_REQUISITIONS = 'requisitions';
  const VIEW_ALL          = 'all';
  const ALLOWED_VIEWS = { reserves: 1, requisitions: 1, all: 1 };

  // In-memory mirror of localStorage. Missing keys = qty 0.
  const QTY = Object.create(null);

  let _view = VIEW_RESERVES;
  let _predicateRegistered = false;
  let _toggleObserver = null;
  let _gridObserver = null;
  let _armyObserver = null;
  let _emptyNote = null;
  let _gridScanRaf = 0;
  let _armyScanRaf = 0;

  // ────────────────────────────────────────────────────────────────────
  // mode helpers
  // ────────────────────────────────────────────────────────────────────
  function getMode() {
    if (typeof App.getMode === 'function') return App.getMode();
    if (document.body && document.body.getAttribute) {
      return document.body.getAttribute('data-mode') || 'build';
    }
    return 'build';
  }
  function isBuildMode() { return getMode() === 'build'; }

  // ────────────────────────────────────────────────────────────────────
  // persistence
  // ────────────────────────────────────────────────────────────────────
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_RESERVES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          Object.keys(parsed).forEach(k => {
            const v = parsed[k];
            if (Number.isFinite(v) && v > 0) QTY[k] = Math.floor(v);
          });
        }
      }
    } catch (_) { /* ignore */ }

    try {
      const v = localStorage.getItem(LS_VIEW);
      if (v && ALLOWED_VIEWS[v]) _view = v;
    } catch (_) { /* ignore */ }
    applyViewBodyAttr();
  }

  function persist() {
    try { localStorage.setItem(LS_RESERVES, JSON.stringify(QTY)); }
    catch (_) { /* quota — ignore */ }
  }

  function persistView() {
    try { localStorage.setItem(LS_VIEW, _view); } catch (_) {}
  }

  function applyViewBodyAttr() {
    if (!document.body) return;
    document.body.setAttribute('data-units-view', _view);
  }

  // ────────────────────────────────────────────────────────────────────
  // public API
  // ────────────────────────────────────────────────────────────────────
  function getQty(unitId) {
    if (!unitId) return 0;
    return QTY[unitId] || 0;
  }

  function setQty(unitId, qty) {
    if (!unitId) return;
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    const prev = QTY[unitId] || 0;
    if (qty === prev) return;
    if (qty === 0) delete QTY[unitId];
    else QTY[unitId] = qty;
    persist();
    refreshAllSteppers(unitId);
    refreshArmyWarnings();
    refreshEmptyNote();
    // If reserves view is active in BUILD and the qty just crossed 0,
    // re-render the roster so the card appears/disappears.
    const crossedZero = (prev === 0) !== (qty === 0);
    if (crossedZero && _view === VIEW_RESERVES && isBuildMode() &&
        typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  function incQty(unitId, delta) { setQty(unitId, getQty(unitId) + (delta || 1)); }

  // ────────────────────────────────────────────────────────────────────
  // view toggle (segmented control in #panel-center .panel-controls)
  // ────────────────────────────────────────────────────────────────────
  function ensureToggle() {
    let host = document.getElementById('reserves-view-toggle');
    if (host) return host;
    const controls = document.querySelector('#panel-center .panel-controls');
    if (!controls) return null;
    host = document.createElement('div');
    host.id = 'reserves-view-toggle';
    host.className = 'reserves-view-toggle';
    host.setAttribute('role', 'tablist');
    host.setAttribute('aria-label', 'Unit pane view');
    host.innerHTML =
      '<button type="button" class="reserves-view-btn" data-view="reserves" role="tab" ' +
        'title="Show only units in your Reserves (owned)">' +
        '<span class="reserves-view-icon" aria-hidden="true">✧</span>' +
        '<span class="reserves-view-label">Reserves</span>' +
        '<span class="reserves-view-count" data-reserves-count></span>' +
      '</button>' +
      '<button type="button" class="reserves-view-btn" data-view="requisitions" role="tab" ' +
        'title="Show units on your Requisition Requests (wishlist)">' +
        '<span class="reserves-view-icon" aria-hidden="true">✎</span>' +
        '<span class="reserves-view-label">Requisitions</span>' +
        '<span class="reserves-view-count" data-requisitions-count></span>' +
      '</button>' +
      '<button type="button" class="reserves-view-btn" data-view="all" role="tab" ' +
        'title="Show every unit in the selected faction">' +
        '<span class="reserves-view-icon" aria-hidden="true">▦</span>' +
        '<span class="reserves-view-label">All units</span>' +
      '</button>';
    // Insert before the search input so the toggle reads as the primary
    // selector. controls hosts: [search, chip-bar]. Insert at the very top.
    controls.insertBefore(host, controls.firstChild);
    host.addEventListener('click', evt => {
      const btn = evt.target.closest('.reserves-view-btn');
      if (!btn) return;
      const view = btn.dataset.view;
      if (!view || !ALLOWED_VIEWS[view]) return;
      setView(view);
    });
    syncToggleActive();
    return host;
  }

  function syncToggleActive() {
    const host = document.getElementById('reserves-view-toggle');
    if (!host) return;
    host.querySelectorAll('.reserves-view-btn').forEach(btn => {
      const active = btn.dataset.view === _view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const countEl = host.querySelector('[data-reserves-count]');
    if (countEl) {
      const total = totalOwnedUnitTypes();
      countEl.textContent = total > 0 ? String(total) : '';
      countEl.classList.toggle('is-empty', total === 0);
    }
    const reqCountEl = host.querySelector('[data-requisitions-count]');
    if (reqCountEl) {
      // Requisitions module fills this in itself; we just guarantee the
      // slot exists on every (re)render of the toggle.
      const total = (App.Requisitions && typeof App.Requisitions.totalRequestedUnitTypes === 'function')
        ? App.Requisitions.totalRequestedUnitTypes() : 0;
      reqCountEl.textContent = total > 0 ? String(total) : '';
      reqCountEl.classList.toggle('is-empty', total === 0);
    }
  }

  function setView(v) {
    if (!v || !ALLOWED_VIEWS[v]) return;
    if (v === _view) return;
    _view = v;
    persistView();
    applyViewBodyAttr();
    syncToggleActive();
    refreshEmptyNote();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  function totalOwnedUnitTypes() {
    let n = 0;
    for (const k in QTY) if (QTY[k] > 0) n++;
    return n;
  }

  // ────────────────────────────────────────────────────────────────────
  // roster filter predicate
  // ────────────────────────────────────────────────────────────────────
  function ensurePredicate() {
    if (_predicateRegistered) return;
    if (!Array.isArray(App.hooks.rosterFilters)) return;
    const pred = function reservesPredicate(unit) {
      // Only filter in BUILD + reserves view. In all other contexts the
      // predicate is a no-op so it can't silently hide units.
      if (!isBuildMode()) return true;
      if (_view !== VIEW_RESERVES) return true;
      return getQty(unit && unit.id) > 0;
    };
    pred._isReservesPredicate = true;
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isReservesPredicate);
    App.hooks.rosterFilters.push(pred);
    _predicateRegistered = true;
  }

  // ────────────────────────────────────────────────────────────────────
  // empty-state hint above the unit grid
  // ────────────────────────────────────────────────────────────────────
  function ensureEmptyNote() {
    if (_emptyNote && document.body.contains(_emptyNote)) return _emptyNote;
    const grid = document.getElementById('unit-grid');
    if (!grid || !grid.parentNode) return null;
    const note = document.createElement('div');
    note.id = 'reserves-empty-note';
    note.className = 'reserves-empty-note';
    note.hidden = true;
    note.innerHTML =
      '<div class="reserves-empty-title">Your Reserves are empty</div>' +
      '<div class="reserves-empty-body">' +
        'Switch to <button type="button" class="reserves-empty-link" data-reserves-switch="all">All units</button> ' +
        'and tap <span class="reserves-empty-plus">＋</span> on any card to add it to your Reserves.' +
      '</div>';
    grid.parentNode.insertBefore(note, grid);
    note.addEventListener('click', e => {
      const btn = e.target.closest('[data-reserves-switch]');
      if (btn) setView(btn.dataset.reservesSwitch);
    });
    _emptyNote = note;
    return note;
  }

  function refreshEmptyNote() {
    const note = ensureEmptyNote();
    if (!note) return;
    if (!isBuildMode() || _view !== VIEW_RESERVES) {
      note.hidden = true;
      return;
    }
    // Show only when the current faction filter would yield zero owned
    // units — i.e. the predicate has filtered everything out. Compute
    // against the same allUnits/factionFilter the roster sees.
    const state = App.state || {};
    const allUnits = state.allUnits || [];
    const faction = state.factionFilter || 'all';
    let hasMatch = false;
    for (let i = 0; i < allUnits.length; i++) {
      const u = allUnits[i];
      if (!u || !u.id) continue;
      if (faction !== 'all' && u._factionName !== faction) continue;
      if (getQty(u.id) > 0) { hasMatch = true; break; }
    }
    note.hidden = hasMatch;
  }

  // ────────────────────────────────────────────────────────────────────
  // per-card stepper (always present; in 'all' view it lets the user seed
  // their reserves; in 'reserves' view it's the management UI)
  // ────────────────────────────────────────────────────────────────────
  function decorateCard(card) {
    if (!card || card.dataset.reservesDone === '1') return;
    const unitId = card.dataset.unitId;
    if (!unitId) return;
    if (card.querySelector('.reserves-stepper')) {
      card.dataset.reservesDone = '1';
      return;
    }
    const qty = getQty(unitId);
    const wrap = document.createElement('div');
    wrap.className = 'reserves-stepper' + (qty > 0 ? ' has-qty' : '');
    wrap.dataset.unitId = unitId;
    wrap.innerHTML =
      '<button type="button" class="reserves-step-btn reserves-dec" tabindex="-1" ' +
        'aria-label="Remove one from Reserves" title="Remove one">−</button>' +
      '<span class="reserves-step-qty" data-reserves-qty>' + qty + '</span>' +
      '<button type="button" class="reserves-step-btn reserves-inc" tabindex="-1" ' +
        'aria-label="Add one to Reserves" title="Add one">+</button>';
    // Stop propagation so stepper clicks don't select the card / open detail.
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      const inc = e.target.closest('.reserves-inc');
      const dec = e.target.closest('.reserves-dec');
      if (inc) incQty(unitId, +1);
      else if (dec) incQty(unitId, -1);
    });
    wrap.addEventListener('dblclick', e => { e.stopPropagation(); });
    card.appendChild(wrap);
    card.dataset.reservesDone = '1';
    syncCardStepper(card, qty);
  }

  function syncCardStepper(card, qty) {
    if (qty == null) qty = getQty(card.dataset.unitId);
    const wrap = card.querySelector('.reserves-stepper');
    if (!wrap) return;
    wrap.classList.toggle('has-qty', qty > 0);
    const qEl = wrap.querySelector('[data-reserves-qty]');
    if (qEl) qEl.textContent = String(qty);
    const dec = wrap.querySelector('.reserves-dec');
    if (dec) dec.disabled = qty <= 0;
    card.classList.toggle('reserves-owned', qty > 0);
  }

  function refreshAllSteppers(unitId) {
    if (unitId) {
      const cards = document.querySelectorAll(
        '.unit-card[data-unit-id="' + cssEsc(unitId) + '"]'
      );
      cards.forEach(card => syncCardStepper(card, getQty(unitId)));
    } else {
      document.querySelectorAll('.unit-card').forEach(card => {
        syncCardStepper(card, getQty(card.dataset.unitId));
      });
    }
    syncToggleActive();
  }

  function cssEsc(s) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function scanGrid() {
    const grid = document.getElementById('unit-grid');
    if (!grid) return;
    grid.querySelectorAll('.unit-card').forEach(decorateCard);
  }

  function scheduleGridScan() {
    if (_gridScanRaf) return;
    _gridScanRaf = requestAnimationFrame(() => {
      _gridScanRaf = 0;
      scanGrid();
      refreshEmptyNote();
    });
  }

  function installGridObserver() {
    if (_gridObserver) return;
    const grid = document.getElementById('unit-grid');
    if (!grid) return;
    scheduleGridScan();
    _gridObserver = new MutationObserver(records => {
      for (let i = 0; i < records.length; i++) {
        if (records[i].addedNodes && records[i].addedNodes.length) {
          scheduleGridScan();
          return;
        }
      }
    });
    _gridObserver.observe(grid, { childList: true, subtree: false });
  }

  // ────────────────────────────────────────────────────────────────────
  // soft-warn on army entries: "owns N of M"
  // ────────────────────────────────────────────────────────────────────
  function totalArmyCount(army, unitId) {
    if (!army || !Array.isArray(army.entries)) return 0;
    let n = 0;
    for (let i = 0; i < army.entries.length; i++) {
      const e = army.entries[i];
      if (e && e.unitId === unitId) n += (e.count || 0);
    }
    return n;
  }

  function decorateArmyEntry(li) {
    if (!li) return;
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    const idx = parseInt(li.dataset.index, 10);
    const entry = isNaN(idx) ? null : (army.entries || [])[idx];
    if (!entry || !entry.unitId) return;
    const owned = getQty(entry.unitId);
    const inArmy = totalArmyCount(army, entry.unitId);
    let badge = li.querySelector('.reserves-warn');
    // Only warn when the user actually owns SOME of this unit (i.e. has
    // tracked it in Reserves). If owned === 0 we don't know whether the
    // user has any — they may simply not be tracking — so we stay quiet.
    const wantBadge = owned > 0 && inArmy > owned;
    if (!wantBadge) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'reserves-warn';
      badge.setAttribute('role', 'note');
      const title = li.querySelector('.army-entry-title') || li.querySelector('.army-entry-name');
      if (title) title.appendChild(badge); else li.appendChild(badge);
    }
    badge.textContent = '⚠ owns ' + owned;
    badge.title = 'Your Reserves only have ' + owned + ' of this unit (army uses ' + inArmy + ').';
  }

  function refreshArmyWarnings() {
    const list = document.getElementById('army-entry-list');
    if (!list) return;
    list.querySelectorAll('.army-entry').forEach(decorateArmyEntry);
  }

  function scheduleArmyScan() {
    if (_armyScanRaf) return;
    _armyScanRaf = requestAnimationFrame(() => {
      _armyScanRaf = 0;
      refreshArmyWarnings();
    });
  }

  function installArmyObserver() {
    if (_armyObserver) return;
    const list = document.getElementById('army-entry-list');
    if (!list) return;
    scheduleArmyScan();
    _armyObserver = new MutationObserver(() => scheduleArmyScan());
    _armyObserver.observe(list, { childList: true, subtree: false });
  }

  // ────────────────────────────────────────────────────────────────────
  // toggle re-injection observer (panel-center is rebuilt on mode flip)
  // ────────────────────────────────────────────────────────────────────
  function installToggleObserver() {
    if (_toggleObserver) return;
    const center = document.getElementById('panel-center') || document.body;
    ensureToggle();
    _toggleObserver = new MutationObserver(() => {
      // Re-ensure both the toggle and the empty-state slot if anything
      // ripped them out.
      ensureToggle();
      ensureEmptyNote();
    });
    _toggleObserver.observe(center, { childList: true, subtree: true });
  }

  // ────────────────────────────────────────────────────────────────────
  // hook registrations
  // ────────────────────────────────────────────────────────────────────
  ensurePredicate();

  App.hooks.bootstrap.push(function () {
    loadPersisted();
    ensurePredicate();
    installToggleObserver();
    installGridObserver();
    installArmyObserver();
    syncToggleActive();
    refreshEmptyNote();
    refreshArmyWarnings();
  });

  App.hooks.armyChange.push(function () {
    scheduleArmyScan();
  });

  App.hooks.selectionChange.push(function () {
    refreshEmptyNote();
  });

  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function () {
    // Re-render roster so the mode-aware predicate flips, and clear any
    // empty-state note when leaving BUILD.
    refreshEmptyNote();
    syncToggleActive();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  });

  // Cross-tab sync: another tab updated reserves via cloud sync.
  window.addEventListener('storage', function (e) {
    if (!e) return;
    if (e.key === LS_RESERVES) {
      // Reload from storage and refresh.
      Object.keys(QTY).forEach(k => delete QTY[k]);
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : null;
        if (parsed && typeof parsed === 'object') {
          Object.keys(parsed).forEach(k => {
            const v = parsed[k];
            if (Number.isFinite(v) && v > 0) QTY[k] = Math.floor(v);
          });
        }
      } catch (_) {}
      refreshAllSteppers();
      refreshArmyWarnings();
      refreshEmptyNote();
      if (_view === VIEW_RESERVES && isBuildMode() &&
          typeof App.renderUnitRosterWithContext === 'function') {
        App.renderUnitRosterWithContext();
      }
    } else if (e.key === LS_VIEW) {
      const v = e.newValue;
      if (v && ALLOWED_VIEWS[v] && v !== _view) {
        _view = v;
        applyViewBodyAttr();
        syncToggleActive();
        if (typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      }
    }
  });

  // Public API for debug + sibling modules (e.g. requisitions.js).
  App.Reserves = {
    getQty,
    setQty,
    incQty,
    getView: () => _view,
    setView,
    getAll: () => Object.assign({}, QTY),
    totalOwnedUnitTypes,
    // Re-render the toggle chips' counters. Used by requisitions.js when
    // its own count changes so the shared toggle stays in sync without
    // requisitions.js having to reach into the DOM directly.
    syncToggle: syncToggleActive,
  };
})();
