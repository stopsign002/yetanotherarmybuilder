// app/requisitions.js — "Requisition Requests": the user's wishlist of
// units they want to acquire (or paint) next. Sibling to reserves.js
// (which tracks owned quantity). Reserves owns the unit-pane view toggle
// (Reserves / Requisitions / All units); this module:
//   - tracks per-unit requested quantity in localStorage
//   - registers a roster predicate that activates only in BUILD mode
//     when the requisitions view is selected
//   - decorates each unit-card with a small heart-stepper alongside the
//     reserves stepper
//   - shows an inline empty-state when the requisitions view has no
//     matching units in the current faction filter
//
// Storage:
//   yaab_requisitions : { unitId: qty } — sparse; no key when qty is 0.
//
// The shared view state (yaab_units_view) is owned by reserves.js. We
// read it via App.Reserves.getView() and listen for the storage event
// to react to cross-tab changes.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_requisitions';
  const VIEW_REQUISITIONS = 'requisitions';

  const QTY = Object.create(null);

  let _predicateRegistered = false;
  let _gridObserver = null;
  let _gridScanRaf = 0;
  let _emptyNote = null;

  // ── helpers ─────────────────────────────────────────────────────────
  function getMode() {
    if (typeof App.getMode === 'function') return App.getMode();
    if (document.body && document.body.getAttribute) {
      return document.body.getAttribute('data-mode') || 'build';
    }
    return 'build';
  }
  function isBuildMode() { return getMode() === 'build'; }
  function getView() {
    if (App.Reserves && typeof App.Reserves.getView === 'function') {
      return App.Reserves.getView();
    }
    return document.body && document.body.getAttribute('data-units-view');
  }

  // ── persistence ─────────────────────────────────────────────────────
  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.keys(parsed).forEach(k => {
        const v = parsed[k];
        if (Number.isFinite(v) && v > 0) QTY[k] = Math.floor(v);
      });
    } catch (_) { /* ignore */ }
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(QTY)); }
    catch (_) { /* quota — ignore */ }
  }

  // ── public API ──────────────────────────────────────────────────────
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
    refreshEmptyNote();
    // Refresh the toggle's counter chip on the Reserves side.
    if (App.Reserves && typeof App.Reserves.syncToggle === 'function') {
      App.Reserves.syncToggle();
    } else {
      // Best-effort fallback: poke the count node directly.
      const el = document.querySelector('[data-requisitions-count]');
      if (el) {
        const total = totalRequestedUnitTypes();
        el.textContent = total > 0 ? String(total) : '';
        el.classList.toggle('is-empty', total === 0);
      }
    }
    // If requisitions view is active and the qty crossed 0, re-render
    // the roster so the card appears or disappears.
    const crossedZero = (prev === 0) !== (qty === 0);
    if (crossedZero && getView() === VIEW_REQUISITIONS && isBuildMode() &&
        typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }
  function incQty(unitId, delta) { setQty(unitId, getQty(unitId) + (delta || 1)); }
  function totalRequestedUnitTypes() {
    let n = 0;
    for (const k in QTY) if (QTY[k] > 0) n++;
    return n;
  }

  // ── predicate ──────────────────────────────────────────────────────
  function ensurePredicate() {
    if (_predicateRegistered) return;
    if (!Array.isArray(App.hooks.rosterFilters)) return;
    const pred = function requisitionsPredicate(unit) {
      if (!isBuildMode()) return true;
      if (getView() !== VIEW_REQUISITIONS) return true;
      return getQty(unit && unit.id) > 0;
    };
    pred._isRequisitionsPredicate = true;
    App.hooks.rosterFilters = App.hooks.rosterFilters
      .filter(fn => !fn._isRequisitionsPredicate);
    App.hooks.rosterFilters.push(pred);
    _predicateRegistered = true;
  }

  // ── empty-state hint ───────────────────────────────────────────────
  function ensureEmptyNote() {
    if (_emptyNote && document.body.contains(_emptyNote)) return _emptyNote;
    const grid = document.getElementById('unit-grid');
    if (!grid || !grid.parentNode) return null;
    const note = document.createElement('div');
    note.id = 'requisitions-empty-note';
    note.className = 'requisitions-empty-note';
    note.hidden = true;
    note.innerHTML =
      '<div class="requisitions-empty-title">Your Requisition Requests are empty</div>' +
      '<div class="requisitions-empty-body">' +
        'Switch to <button type="button" class="requisitions-empty-link" data-requisitions-switch="all">All units</button> ' +
        'and click the <span class="requisitions-empty-heart" aria-hidden="true">♥</span> on any card to add it to your wishlist.' +
      '</div>';
    grid.parentNode.insertBefore(note, grid);
    note.addEventListener('click', e => {
      const btn = e.target.closest('[data-requisitions-switch]');
      if (btn && App.Reserves && typeof App.Reserves.setView === 'function') {
        App.Reserves.setView(btn.dataset.requisitionsSwitch);
      }
    });
    _emptyNote = note;
    return note;
  }

  function refreshEmptyNote() {
    const note = ensureEmptyNote();
    if (!note) return;
    if (!isBuildMode() || getView() !== VIEW_REQUISITIONS) {
      note.hidden = true;
      return;
    }
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

  // ── per-card heart stepper ─────────────────────────────────────────
  function decorateCard(card) {
    if (!card || card.dataset.requisitionsDone === '1') return;
    const unitId = card.dataset.unitId;
    if (!unitId) return;
    if (card.querySelector('.requisitions-stepper')) {
      card.dataset.requisitionsDone = '1';
      return;
    }
    const qty = getQty(unitId);
    const wrap = document.createElement('div');
    wrap.className = 'requisitions-stepper' + (qty > 0 ? ' has-qty' : '');
    wrap.dataset.unitId = unitId;
    wrap.innerHTML =
      '<button type="button" class="requisitions-step-btn requisitions-dec" tabindex="-1" ' +
        'aria-label="Remove one from Requisitions" title="Remove one">−</button>' +
      '<span class="requisitions-step-icon" aria-hidden="true">♥</span>' +
      '<span class="requisitions-step-qty" data-requisitions-qty>' + qty + '</span>' +
      '<button type="button" class="requisitions-step-btn requisitions-inc" tabindex="-1" ' +
        'aria-label="Add one to Requisitions" title="Add one">+</button>';
    wrap.addEventListener('click', e => {
      e.stopPropagation();
      const inc = e.target.closest('.requisitions-inc');
      const dec = e.target.closest('.requisitions-dec');
      const icon = e.target.closest('.requisitions-step-icon');
      if (inc) incQty(unitId, +1);
      else if (dec) incQty(unitId, -1);
      // Click on the heart toggles 0 ↔ 1 — quick "add to wishlist" affordance.
      else if (icon) setQty(unitId, getQty(unitId) > 0 ? 0 : 1);
    });
    wrap.addEventListener('dblclick', e => { e.stopPropagation(); });
    card.appendChild(wrap);
    card.dataset.requisitionsDone = '1';
    syncCardStepper(card, qty);
  }

  function syncCardStepper(card, qty) {
    if (qty == null) qty = getQty(card.dataset.unitId);
    const wrap = card.querySelector('.requisitions-stepper');
    if (!wrap) return;
    wrap.classList.toggle('has-qty', qty > 0);
    const qEl = wrap.querySelector('[data-requisitions-qty]');
    if (qEl) qEl.textContent = String(qty);
    const dec = wrap.querySelector('.requisitions-dec');
    if (dec) dec.disabled = qty <= 0;
    card.classList.toggle('requisitions-wanted', qty > 0);
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

  // ── hook registrations ─────────────────────────────────────────────
  ensurePredicate();

  App.hooks.bootstrap.push(function () {
    loadPersisted();
    ensurePredicate();
    installGridObserver();
    refreshEmptyNote();
    // Nudge the Reserves toggle so its requisitions count chip renders.
    if (App.Reserves && typeof App.Reserves.syncToggle === 'function') {
      App.Reserves.syncToggle();
    }
  });

  App.hooks.selectionChange.push(function () {
    refreshEmptyNote();
  });

  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function () {
    refreshEmptyNote();
  });

  // Cross-tab sync for the requisitions list.
  window.addEventListener('storage', function (e) {
    if (!e || e.key !== LS_KEY) return;
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
    refreshEmptyNote();
    if (App.Reserves && typeof App.Reserves.syncToggle === 'function') {
      App.Reserves.syncToggle();
    }
    if (getView() === VIEW_REQUISITIONS && isBuildMode() &&
        typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  });

  App.Requisitions = {
    getQty,
    setQty,
    incQty,
    getAll: () => Object.assign({}, QTY),
    totalRequestedUnitTypes,
  };
})();
