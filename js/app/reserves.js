// app/reserves.js — "Reserves": the user's owned-units stockpile with
// per-unit quantities. Layers on top of collection.js (which tracks paint
// status, no quantities). The Build-mode unit pane defaults to a Reserves
// view that lists only units the user has at least one of; the controls
// to actually adjust quantities live in the right-hand Details pane via
// a combined "stockpile" widget shared with requisitions.js.
//
// Soft-warns the army list when a unit's army count exceeds owned qty.
//
// Storage:
//   yaab_reserves    : { unitId: qty }
//   yaab_units_view  : 'reserves' | 'requisitions' | 'all'
//
// Mode gating: the Reserves predicate only filters in BUILD mode. In
// other modes the predicate is a no-op so toggling modes can't silently
// hide a roster.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_RESERVES = 'yaab_reserves';
  const LS_VIEW     = 'yaab_units_view';
  const VIEW_RESERVES     = 'reserves';
  const VIEW_REQUISITIONS = 'requisitions';
  const VIEW_ALL          = 'all';
  const ALLOWED_VIEWS = { reserves: 1, requisitions: 1, all: 1 };

  const QTY = Object.create(null);

  let _view = VIEW_RESERVES;
  let _predicateRegistered = false;
  let _toggleObserver = null;
  let _detailObserver = null;
  let _armyObserver = null;
  let _emptyNote = null;
  let _armyScanRaf = 0;

  // ── mode helpers ──────────────────────────────────────────────────────
  function getMode() {
    if (typeof App.getMode === 'function') return App.getMode();
    if (document.body && document.body.getAttribute) {
      return document.body.getAttribute('data-mode') || 'build';
    }
    return 'build';
  }
  function isBuildMode() { return getMode() === 'build'; }

  // ── persistence ──────────────────────────────────────────────────────
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

  // ── public API ───────────────────────────────────────────────────────
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
    syncToggleActive();
    refreshDetailWidget(unitId);
    refreshArmyWarnings();
    refreshEmptyNote();
    // If reserves view is active and we crossed 0, re-render the roster
    // so the unit appears or disappears.
    const crossedZero = (prev === 0) !== (qty === 0);
    if (crossedZero && _view === VIEW_RESERVES && isBuildMode() &&
        typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  function incQty(unitId, delta) { setQty(unitId, getQty(unitId) + (delta || 1)); }

  // ── view toggle (segmented control in #panel-center .panel-controls) ─
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

  // ── roster filter predicate ──────────────────────────────────────────
  function ensurePredicate() {
    if (_predicateRegistered) return;
    if (!Array.isArray(App.hooks.rosterFilters)) return;
    const pred = function reservesPredicate(unit) {
      if (!isBuildMode()) return true;
      if (_view !== VIEW_RESERVES) return true;
      return getQty(unit && unit.id) > 0;
    };
    pred._isReservesPredicate = true;
    App.hooks.rosterFilters = App.hooks.rosterFilters
      .filter(fn => !fn._isReservesPredicate);
    App.hooks.rosterFilters.push(pred);
    _predicateRegistered = true;
  }

  // ── empty-state hint above the unit grid ─────────────────────────────
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
        'Switch to <button type="button" class="reserves-empty-link" data-reserves-switch="all">All units</button>, ' +
        'pick a unit, and use the +/− stepper in the Details pane to add it to your Reserves.' +
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

  // ── stockpile widget injected into the Details pane ─────────────────
  // Combined Reserves + Requisitions stepper. Reserves owns the widget;
  // requisitions.js feeds it via App.Requisitions.{getQty, setQty}.
  function getSelectedUnit() {
    const s = App.state;
    if (!s) return null;
    if (s.selectedUnit) return s.selectedUnit;
    // Fall back to the army-entry the user clicked (events.js sets
    // selectedArmyEntryIndex AND clears selectedUnit when reading from
    // the army list). Use the entry's unitData so the widget still
    // tracks a unitId in that case.
    if (s.currentArmy && s.selectedArmyEntryIndex != null) {
      const entry = s.currentArmy.entries[s.selectedArmyEntryIndex];
      return entry && entry.unitData ? entry.unitData : null;
    }
    return null;
  }

  function buildDetailWidget(unit) {
    const wrap = document.createElement('div');
    wrap.className = 'stockpile-detail-widget';
    wrap.dataset.unitId = unit.id;
    const ownQty = getQty(unit.id);
    const reqQty = (App.Requisitions && typeof App.Requisitions.getQty === 'function')
      ? App.Requisitions.getQty(unit.id) : 0;
    wrap.innerHTML =
      '<div class="stockpile-detail-title">Your stockpile</div>' +
      '<div class="stockpile-detail-rows">' +
        '<div class="stockpile-row stockpile-row-reserves">' +
          '<span class="stockpile-row-label">' +
            '<span class="stockpile-row-icon" aria-hidden="true">✧</span>' +
            '<span>Reserves</span>' +
            '<span class="stockpile-row-hint">owned</span>' +
          '</span>' +
          '<span class="stockpile-stepper">' +
            '<button type="button" class="stockpile-step stockpile-dec" ' +
              'data-action="reserves-dec" aria-label="Remove one from Reserves" ' +
              'title="Remove one">−</button>' +
            '<span class="stockpile-qty" data-role="reserves-qty">' + ownQty + '</span>' +
            '<button type="button" class="stockpile-step stockpile-inc" ' +
              'data-action="reserves-inc" aria-label="Add one to Reserves" ' +
              'title="Add one">+</button>' +
          '</span>' +
        '</div>' +
        '<div class="stockpile-row stockpile-row-requisitions">' +
          '<span class="stockpile-row-label">' +
            '<span class="stockpile-row-icon" aria-hidden="true">♥</span>' +
            '<span>Requisitions</span>' +
            '<span class="stockpile-row-hint">wishlist</span>' +
          '</span>' +
          '<span class="stockpile-stepper">' +
            '<button type="button" class="stockpile-step stockpile-dec" ' +
              'data-action="requisitions-dec" aria-label="Remove one from Requisitions" ' +
              'title="Remove one">−</button>' +
            '<span class="stockpile-qty" data-role="requisitions-qty">' + reqQty + '</span>' +
            '<button type="button" class="stockpile-step stockpile-inc" ' +
              'data-action="requisitions-inc" aria-label="Add one to Requisitions" ' +
              'title="Add one">+</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    wrap.addEventListener('click', evt => {
      const btn = evt.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'reserves-inc') incQty(unit.id, +1);
      else if (action === 'reserves-dec') incQty(unit.id, -1);
      else if (action === 'requisitions-inc' && App.Requisitions) App.Requisitions.incQty(unit.id, +1);
      else if (action === 'requisitions-dec' && App.Requisitions) App.Requisitions.incQty(unit.id, -1);
    });
    syncWidgetState(wrap, unit.id);
    return wrap;
  }

  function syncWidgetState(wrap, unitId) {
    if (!wrap) return;
    const ownQty = getQty(unitId);
    const reqQty = (App.Requisitions && typeof App.Requisitions.getQty === 'function')
      ? App.Requisitions.getQty(unitId) : 0;
    const ownEl = wrap.querySelector('[data-role="reserves-qty"]');
    const reqEl = wrap.querySelector('[data-role="requisitions-qty"]');
    if (ownEl) ownEl.textContent = String(ownQty);
    if (reqEl) reqEl.textContent = String(reqQty);
    wrap.classList.toggle('reserves-has-qty', ownQty > 0);
    wrap.classList.toggle('requisitions-has-qty', reqQty > 0);
    const decRes = wrap.querySelector('[data-action="reserves-dec"]');
    const decReq = wrap.querySelector('[data-action="requisitions-dec"]');
    if (decRes) decRes.disabled = ownQty <= 0;
    if (decReq) decReq.disabled = reqQty <= 0;
  }

  function injectDetailWidget() {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const content = panel.querySelector('.unit-detail-content');
    // Only inject for unit detail (not rule detail); detail.js stamps
    // data-detail-kind="unit" on the unit content wrapper.
    if (!content || content.getAttribute('data-detail-kind') !== 'unit') {
      const stale = panel.querySelector('.stockpile-detail-widget');
      if (stale) stale.remove();
      return;
    }
    const unit = getSelectedUnit();
    if (!unit || !unit.id) {
      const stale = panel.querySelector('.stockpile-detail-widget');
      if (stale) stale.remove();
      return;
    }
    const existing = panel.querySelector('.stockpile-detail-widget');
    if (existing && existing.dataset.unitId === unit.id) {
      syncWidgetState(existing, unit.id);
      return;
    }
    if (existing) existing.remove();
    const widget = buildDetailWidget(unit);
    // Anchor right after .detail-add-section so the stockpile controls
    // sit next to "Add to Army" — same conceptual neighbourhood
    // (deciding what goes into your army or your shelf).
    const addSection = content.querySelector('.detail-add-section');
    if (addSection && addSection.parentNode) {
      addSection.parentNode.insertBefore(widget, addSection.nextSibling);
    } else {
      content.appendChild(widget);
    }
  }

  function refreshDetailWidget(unitId) {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const widget = panel.querySelector('.stockpile-detail-widget');
    if (!widget) return;
    if (unitId && widget.dataset.unitId !== unitId) return;
    syncWidgetState(widget, widget.dataset.unitId);
  }

  function installDetailObserver() {
    if (_detailObserver) return;
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    injectDetailWidget();
    _detailObserver = new MutationObserver(records => {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && records[i].addedNodes &&
            records[i].addedNodes.length) {
          injectDetailWidget();
          return;
        }
      }
    });
    _detailObserver.observe(panel, { childList: true, subtree: false });
  }

  // ── soft-warn on army entries: "owns N" ───────────────────────────────
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

  // ── toggle re-injection observer ─────────────────────────────────────
  function installToggleObserver() {
    if (_toggleObserver) return;
    const center = document.getElementById('panel-center') || document.body;
    ensureToggle();
    _toggleObserver = new MutationObserver(() => {
      ensureToggle();
      ensureEmptyNote();
    });
    _toggleObserver.observe(center, { childList: true, subtree: true });
  }

  // ── hook registrations ───────────────────────────────────────────────
  ensurePredicate();

  App.hooks.bootstrap.push(function () {
    loadPersisted();
    ensurePredicate();
    installToggleObserver();
    installDetailObserver();
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
    // Selection change can fire after detail.js re-renders; re-inject
    // in case the observer missed the swap.
    injectDetailWidget();
  });

  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function () {
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
      syncToggleActive();
      refreshDetailWidget();
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
    syncToggle: syncToggleActive,
    // Called by requisitions.js after it mutates wishlist qty so the
    // shared detail widget refreshes its requisitions row.
    refreshDetailWidget,
  };
})();
