// app/collection.js — owned/painted tracker for every unit; LS-persisted, hook-driven.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_collection';
  const LS_SHOW_BADGES_IN_BUILD = 'yaab_show_collection_badges';

  const STATUSES = ['none', 'unpainted', 'primed', 'painting', 'done'];
  const STATUS_LABELS = {
    none:      'None',
    unpainted: 'Unpainted',
    primed:    'Primed',
    painting:  'WIP',
    done:      'Done',
  };

  // In-memory mirror of localStorage. Missing keys = 'none'.
  const STATE = Object.create(null);

  // Roster-chip active flags; combined into a single rosterFilters predicate.
  let _chipOwnedActive   = false;
  let _chipNeedsActive   = false;
  let _chipPaintedActive = false;

  let _predicateRegistered = false;
  let _chipsInjected       = false;
  let _chipObserver        = null;
  let _detailObserver      = null;
  let _armyPanelObserver   = null;
  let _dashboardEl         = null;
  let _dashFactionFilter   = 'all';
  let _dashStatusFilter    = 'all';

  // ────────────────────────────────────────────────────────────────────
  // mode gating
  // ────────────────────────────────────────────────────────────────────
  //
  // Collection UI bleeds into BUILD-mode DOM by default because this module
  // injects its chips/notes/progress bar into elements that live inside
  // #build-mode (#panel-center, #panel-left, #unit-grid). Gate those by mode
  // so BUILD stays clean and COLLECT mode owns the tracker surface.
  //
  // Mode-aware decisions are split between:
  //   - JS gating (skip chip injection, skip ownership-hint rendering, make
  //     the rosterFilters predicate a no-op when not in COLLECT).
  //   - CSS gating (`body[data-mode="build"] …`) for visual elements that
  //     have already been injected (card status dots, chips that may already
  //     be in the DOM from an older mount). See css/collection.css.

  function getMode() {
    if (window.App && typeof App.getMode === 'function') return App.getMode();
    if (document.body && document.body.getAttribute) {
      return document.body.getAttribute('data-mode') || 'build';
    }
    return 'build';
  }
  function isBuildMode() { return getMode() === 'build'; }

  // Per spec: painting status DOTS are hidden in BUILD by default. The user
  // can re-enable via Settings drawer's "Show painting status badges" toggle
  // (yaab_show_collection_badges). Treat a missing/null LS value as OFF so
  // BUILD starts clean for users who never touched the toggle.
  function showBadgesInBuild() {
    try {
      return localStorage.getItem(LS_SHOW_BADGES_IN_BUILD) === '1';
    } catch (_) { return false; }
  }

  // Reflect the build-badge opt-in as a body class so CSS can override the
  // default-hide rule without re-rendering cards.
  function applyBuildBadgesBodyClass() {
    if (!document.body) return;
    const want = showBadgesInBuild();
    const has  = document.body.classList.contains('yaab-build-badges-on');
    if (want !== has) document.body.classList.toggle('yaab-build-badges-on', want);
  }

  // ────────────────────────────────────────────────────────────────────
  // persistence
  // ────────────────────────────────────────────────────────────────────

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.keys(parsed).forEach(k => {
        const v = parsed[k];
        if (typeof v === 'string' && STATUSES.indexOf(v) !== -1 && v !== 'none') {
          STATE[k] = v;
        }
      });
    } catch (_) { /* ignore */ }
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); }
    catch (_) { /* quota — ignore */ }
  }

  function getStatus(unitId) {
    if (!unitId) return 'none';
    return STATE[unitId] || 'none';
  }

  // Single source of truth for status transitions.
  function setStatus(unitId, newStatus) {
    if (!unitId) return;
    if (STATUSES.indexOf(newStatus) === -1) newStatus = 'none';
    if (newStatus === 'none') delete STATE[unitId];
    else STATE[unitId] = newStatus;
    persist();
    // Propagate to all affected views.
    refreshCardBadge(unitId);
    refreshDetailWidget(unitId);
    refreshArmyProgress();
    refreshDashboardIfOpen();
    refreshSelectionBacklog();
    // If a status-based chip is active, re-render the roster so the filter applies.
    if ((_chipOwnedActive || _chipNeedsActive || _chipPaintedActive) &&
        window.App && typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // card badge — dot in top-right corner of each roster card
  // ────────────────────────────────────────────────────────────────────

  function cardClassContributor(unit) {
    if (!unit || !unit.id) return null;
    return 'collection-' + getStatus(unit.id);
  }

  // In-place update: flip the class on any currently-rendered card for this
  // unitId, so changing status updates the badge without a full re-render.
  function refreshCardBadge(unitId) {
    if (!unitId) return;
    const cards = document.querySelectorAll(
      '.unit-card[data-unit-id="' + cssEsc(unitId) + '"]'
    );
    if (!cards.length) return;
    const next = 'collection-' + getStatus(unitId);
    cards.forEach(card => {
      STATUSES.forEach(s => card.classList.remove('collection-' + s));
      card.classList.add(next);
    });
  }

  function cssEsc(s) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // ────────────────────────────────────────────────────────────────────
  // detail-panel status widget
  // ────────────────────────────────────────────────────────────────────

  function getSelectedUnit() {
    return (window.UI && UI._state && UI._state.selectedUnit) || null;
  }

  function buildDetailWidget(unit) {
    const wrap = document.createElement('div');
    wrap.className = 'collection-detail-widget';
    wrap.dataset.unitId = unit.id;
    const status = getStatus(unit.id);
    const title = document.createElement('div');
    title.className = 'collection-detail-title';
    title.textContent = 'Collection status';
    wrap.appendChild(title);
    const row = document.createElement('div');
    row.className = 'collection-detail-row';
    STATUSES.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collection-status-btn collection-status-' + s +
        (status === s ? ' active' : '');
      btn.dataset.status = s;
      btn.textContent = STATUS_LABELS[s];
      btn.addEventListener('click', () => {
        setStatus(unit.id, s);
      });
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    return wrap;
  }

  // Inject (or update) the widget inside #unit-detail-panel. Idempotent.
  function injectDetailWidget() {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const content = panel.querySelector('.unit-detail-content');
    const unit = getSelectedUnit();
    const existing = panel.querySelector('.collection-detail-widget');
    if (!content || !unit || !unit.id) {
      if (existing) existing.remove();
      return;
    }
    // If the widget exists and is for the same unit, just sync the active state.
    if (existing && existing.dataset.unitId === unit.id) {
      const status = getStatus(unit.id);
      existing.querySelectorAll('.collection-status-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === status);
      });
      return;
    }
    if (existing) existing.remove();
    const widget = buildDetailWidget(unit);
    // Try to place just after the "Add to Army" section; fall back to top.
    const addSection = content.querySelector('.detail-add-section');
    if (addSection && addSection.parentNode === content) {
      addSection.insertAdjacentElement('afterend', widget);
    } else {
      content.insertBefore(widget, content.firstChild);
    }
  }

  // Public-ish hook for the single-source-of-truth setStatus path.
  function refreshDetailWidget(unitId) {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const widget = panel.querySelector('.collection-detail-widget');
    if (!widget) return;
    if (unitId && widget.dataset.unitId !== unitId) return;
    const status = getStatus(widget.dataset.unitId);
    widget.querySelectorAll('.collection-status-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
  }

  function installDetailObserver() {
    if (_detailObserver) { _detailObserver.disconnect(); _detailObserver = null; }
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    // Initial attempt in case the panel already has content.
    injectDetailWidget();
    _detailObserver = new MutationObserver(muts => {
      // Only act on structural changes (new content injected by detail.js).
      for (let i = 0; i < muts.length; i++) {
        if (muts[i].type === 'childList') { injectDetailWidget(); return; }
      }
    });
    _detailObserver.observe(panel, { childList: true, subtree: false });
  }

  // ────────────────────────────────────────────────────────────────────
  // roster filter chips
  // ────────────────────────────────────────────────────────────────────

  function ensurePredicate() {
    if (_predicateRegistered) return;
    if (!Array.isArray(App.hooks.rosterFilters)) return;
    const pred = function collectionStatusPredicate(unit) {
      // Collection chips only filter the BUILD-mode roster when the user is
      // actually in COLLECT mode. In BUILD this predicate is a no-op so an
      // accidentally-active chip can't silently hide build-mode units.
      if (isBuildMode()) return true;
      if (!_chipOwnedActive && !_chipNeedsActive && !_chipPaintedActive) return true;
      const status = getStatus(unit && unit.id);
      if (_chipOwnedActive   && status === 'none') return false;
      if (_chipNeedsActive   && !(status === 'unpainted' || status === 'primed' || status === 'painting')) return false;
      if (_chipPaintedActive && status !== 'done') return false;
      return true;
    };
    pred._isCollectionPredicate = true;
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isCollectionPredicate);
    App.hooks.rosterFilters.push(pred);
    _predicateRegistered = true;
  }

  function injectChips(bar) {
    if (!bar) return;
    // Suppress collection chips in BUILD mode — they belong in the COLLECT
    // surface. The roster-filter-chips bar lives inside #panel-center which
    // is a BUILD-mode-only element today; removing/re-adding here also
    // cleans up if the user toggles to BUILD with chips already mounted.
    if (isBuildMode()) {
      removeInjectedChips(bar);
      return;
    }
    if (bar.querySelector('.collection-chip')) {
      _chipsInjected = true;
      return;
    }
    const clearBtn = bar.querySelector('.filter-chips-clear');
    const chips = [
      { cls: 'collection-chip collection-chip-owned',   label: 'Owned',       title: 'Show only units you own',
        onToggle: active => { _chipOwnedActive = active; _chipPaintedActive = false; _chipNeedsActive = false; syncChipActiveClasses(bar); } },
      { cls: 'collection-chip collection-chip-needs',   label: 'Needs paint', title: 'Show only units that still need painting',
        onToggle: active => { _chipNeedsActive = active; _chipOwnedActive = false; _chipPaintedActive = false; syncChipActiveClasses(bar); } },
      { cls: 'collection-chip collection-chip-painted', label: 'Painted',     title: 'Show only units fully painted',
        onToggle: active => { _chipPaintedActive = active; _chipOwnedActive = false; _chipNeedsActive = false; syncChipActiveClasses(bar); } },
    ];
    chips.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-chip ' + c.cls;
      btn.title = c.title;
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        const willActivate = !btn.classList.contains('active');
        c.onToggle(willActivate);
        if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      });
      if (clearBtn) bar.insertBefore(btn, clearBtn); else bar.appendChild(btn);
    });
    _chipsInjected = true;
    syncChipActiveClasses(bar);
  }

  function removeInjectedChips(bar) {
    if (!bar) return;
    const existing = bar.querySelectorAll('.filter-chip.collection-chip');
    existing.forEach(el => el.parentNode && el.parentNode.removeChild(el));
    // Also reset any active-state flags so a stale active chip doesn't hide
    // BUILD units when re-entering COLLECT.
    _chipOwnedActive = _chipNeedsActive = _chipPaintedActive = false;
    _chipsInjected = false;
  }

  function syncChipActiveClasses(bar) {
    if (!bar) bar = document.getElementById('roster-filter-chips');
    if (!bar) return;
    const o = bar.querySelector('.collection-chip-owned');
    const n = bar.querySelector('.collection-chip-needs');
    const p = bar.querySelector('.collection-chip-painted');
    if (o) o.classList.toggle('active', _chipOwnedActive);
    if (n) n.classList.toggle('active', _chipNeedsActive);
    if (p) p.classList.toggle('active', _chipPaintedActive);
  }

  function installChipObserver() {
    if (_chipObserver) { _chipObserver.disconnect(); _chipObserver = null; }
    const existing = document.getElementById('roster-filter-chips');
    if (existing) {
      injectChips(existing);
      // If we're in BUILD now, leave the observer wiring alone; the
      // modeChange handler re-runs injectChips on entry to COLLECT.
      if (_chipsInjected) return;
    }
    const center = document.getElementById('panel-center') || document.body;
    _chipObserver = new MutationObserver(() => {
      const bar = document.getElementById('roster-filter-chips');
      if (bar) {
        injectChips(bar);
        // Only disconnect once chips were actually injected (i.e. we were
        // in COLLECT). In BUILD, leave the observer running so a later
        // mode flip + DOM rebuild still gets the chips.
        if (_chipsInjected && _chipObserver) {
          _chipObserver.disconnect();
          _chipObserver = null;
        }
      }
    });
    _chipObserver.observe(center, { childList: true, subtree: true });
  }

  // ────────────────────────────────────────────────────────────────────
  // army-panel painting progress bar
  // ────────────────────────────────────────────────────────────────────

  // Pull model count for a single army entry. Prefer the matching squadOption;
  // fall back to parsing the squadLabel ("10 models") or to 1.
  function modelsPerEntry(entry) {
    const sq = entry && entry.unitData && entry.unitData.squadOptions;
    if (Array.isArray(sq) && entry.selectedPts != null) {
      for (let i = 0; i < sq.length; i++) {
        if (sq[i] && sq[i].pts === entry.selectedPts && sq[i].models) return sq[i].models;
      }
    }
    if (entry && entry.squadLabel) {
      const m = String(entry.squadLabel).match(/(\d+)/);
      if (m) return parseInt(m[1], 10) || 1;
    }
    return 1;
  }

  function computeArmyProgress(army) {
    let painted = 0;
    let total = 0;
    if (!army || !Array.isArray(army.entries)) return { painted: 0, total: 0, pct: 0 };
    for (let i = 0; i < army.entries.length; i++) {
      const e = army.entries[i];
      if (!e) continue;
      const count = e.count || 0;
      const models = modelsPerEntry(e) * count;
      total += models;
      if (e.unitId && getStatus(e.unitId) === 'done') painted += models;
    }
    const pct = total > 0 ? Math.round((painted / total) * 100) : 0;
    return { painted, total, pct };
  }

  function ensureArmyProgressNode() {
    const panelBody = document.querySelector('#panel-left .panel-body');
    if (!panelBody) return null;
    const summary = panelBody.querySelector('.points-summary');
    if (!summary) return null;
    let node = panelBody.querySelector('.collection-progress');
    if (!node) {
      node = document.createElement('div');
      node.className = 'collection-progress';
      node.innerHTML =
        '<div class="collection-progress-head">' +
          '<span class="collection-progress-label">Painted</span>' +
          '<span class="collection-progress-count" data-count>0 / 0 models</span>' +
          '<span class="collection-progress-pct" data-pct>0%</span>' +
        '</div>' +
        '<div class="collection-progress-bar-wrap">' +
          '<div class="collection-progress-bar" data-bar></div>' +
        '</div>';
      summary.insertAdjacentElement('afterend', node);
    }
    return node;
  }

  function refreshArmyProgress() {
    // Painted-progress bar belongs to COLLECT mode. Don't inject it into
    // BUILD's left panel, and clean up any stale node on mode change.
    if (isBuildMode()) {
      const panelBody = document.querySelector('#panel-left .panel-body');
      const stale = panelBody && panelBody.querySelector('.collection-progress');
      if (stale) stale.remove();
      return;
    }
    const node = ensureArmyProgressNode();
    if (!node) return;
    const army = App.state && App.state.currentArmy;
    const { painted, total, pct } = computeArmyProgress(army);
    const countEl = node.querySelector('[data-count]');
    const pctEl   = node.querySelector('[data-pct]');
    const barEl   = node.querySelector('[data-bar]');
    if (countEl) countEl.textContent = painted + ' / ' + total + ' models';
    if (pctEl)   pctEl.textContent   = pct + '%';
    if (barEl)   barEl.style.width   = pct + '%';
    node.classList.toggle('is-empty', total === 0);
    node.classList.toggle('is-complete', total > 0 && painted === total);
  }

  function installArmyPanelObserver() {
    if (_armyPanelObserver) { _armyPanelObserver.disconnect(); _armyPanelObserver = null; }
    const panelBody = document.querySelector('#panel-left .panel-body');
    if (!panelBody) return;
    // Initial inject + render.
    refreshArmyProgress();
    _armyPanelObserver = new MutationObserver(() => {
      // points-summary may be re-created; make sure our node still exists.
      const exists = panelBody.querySelector('.collection-progress');
      if (!exists) refreshArmyProgress();
    });
    _armyPanelObserver.observe(panelBody, { childList: true, subtree: true });
  }

  // ────────────────────────────────────────────────────────────────────
  // selection-change backlog note (on roster)
  // ────────────────────────────────────────────────────────────────────

  function ensureBacklogNode() {
    const grid = document.getElementById('unit-grid');
    if (!grid) return null;
    let note = document.getElementById('collection-backlog-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'collection-backlog-note';
      note.className = 'collection-backlog-note';
      grid.parentNode.insertBefore(note, grid);
    }
    return note;
  }

  function refreshSelectionBacklog() {
    // "You own X of Y units in this faction" is collection telemetry — only
    // surface it in COLLECT mode. In BUILD, suppress (and tear down any
    // existing node) so the roster header stays clean.
    if (isBuildMode()) {
      const existing = document.getElementById('collection-backlog-note');
      if (existing) existing.remove();
      return;
    }
    const note = ensureBacklogNode();
    if (!note) return;
    const state = App.state || {};
    const filter = state.factionFilter || 'all';
    const allUnits = state.allUnits || [];
    if (!filter || filter === 'all') {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    let total = 0;
    let owned = 0;
    for (let i = 0; i < allUnits.length; i++) {
      const u = allUnits[i];
      if (!u || !u._factionName) continue;
      if (u._factionName !== filter) continue;
      total++;
      if (getStatus(u.id) !== 'none') owned++;
    }
    if (total === 0) {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    note.hidden = false;
    note.textContent = 'You own ' + owned + ' of ' + total + ' units in this faction.';
  }

  // ────────────────────────────────────────────────────────────────────
  // collection dashboard modal
  // ────────────────────────────────────────────────────────────────────

  function ensureDashboard() {
    if (_dashboardEl) return _dashboardEl;
    const el = document.createElement('div');
    el.className = 'modal-backdrop collection-modal-backdrop';
    el.hidden = true;
    el.innerHTML =
      '<div class="modal collection-modal" role="dialog" aria-label="Collection tracker">' +
        '<div class="modal-header">' +
          '<h3>Your Collection</h3>' +
          '<button class="modal-close" type="button" aria-label="Close" data-coll-close>&times;</button>' +
        '</div>' +
        '<div class="modal-body collection-modal-body"></div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-outline btn-sm" type="button" data-coll-close>Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', evt => {
      if (evt.target === el) closeDashboard();
      if (evt.target.closest('[data-coll-close]')) closeDashboard();
    });
    _dashboardEl = el;
    return el;
  }

  function htmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function computeDashboardStats() {
    const state = App.state || {};
    const allUnits = state.allUnits || [];
    const factions = state.factions || [];

    let ownedTotal = 0;
    let paintedTotal = 0;
    const perFaction = Object.create(null); // name -> { total, owned, painted }

    for (let i = 0; i < allUnits.length; i++) {
      const u = allUnits[i];
      if (!u) continue;
      const fname = u._factionName || '(unknown)';
      if (!perFaction[fname]) perFaction[fname] = { total: 0, owned: 0, painted: 0 };
      perFaction[fname].total++;
      const status = getStatus(u.id);
      if (status !== 'none') { ownedTotal++; perFaction[fname].owned++; }
      if (status === 'done') { paintedTotal++; perFaction[fname].painted++; }
    }

    // Make sure every known faction appears (even with 0 units loaded).
    for (let i = 0; i < factions.length; i++) {
      const fn = factions[i] && factions[i].name;
      if (fn && !perFaction[fn]) perFaction[fn] = { total: 0, owned: 0, painted: 0 };
    }

    return { ownedTotal, paintedTotal, perFaction };
  }

  function renderDashboard() {
    const el = ensureDashboard();
    const body = el.querySelector('.collection-modal-body');
    if (!body) return;
    const state = App.state || {};
    const allUnits = state.allUnits || [];
    const stats = computeDashboardStats();
    const totalUnitsKnown = allUnits.length;
    const ownedPct = stats.ownedTotal > 0
      ? Math.round((stats.paintedTotal / stats.ownedTotal) * 100)
      : 0;

    // Faction filter options (always include 'all' + each known faction).
    const factionNames = Object.keys(stats.perFaction).sort();
    if (_dashFactionFilter !== 'all' && factionNames.indexOf(_dashFactionFilter) === -1) {
      _dashFactionFilter = 'all';
    }

    let html = '';
    html +=
      '<section class="collection-dash-section collection-dash-totals">' +
        '<div class="collection-dash-total-line">' +
          '<strong>' + stats.ownedTotal + '</strong> units owned, ' +
          '<strong>' + stats.paintedTotal + '</strong> painted ' +
          '<span class="muted">(' + ownedPct + '% of owned)</span>' +
        '</div>' +
        '<div class="collection-dash-total-sub muted">' +
          'Out of ' + totalUnitsKnown + ' units in loaded factions.' +
        '</div>' +
      '</section>';

    html += '<section class="collection-dash-section">' +
      '<h4>Progress per faction</h4>' +
      '<ul class="collection-dash-faction-list">';
    factionNames.forEach(fn => {
      const s = stats.perFaction[fn];
      const pct = s.total > 0 ? Math.round((s.owned / s.total) * 100) : 0;
      html +=
        '<li class="collection-dash-faction">' +
          '<span class="collection-dash-faction-name">' + htmlEsc(fn) + '</span>' +
          '<span class="collection-dash-faction-count">' + s.owned + ' / ' + s.total + ' owned</span>' +
          '<span class="collection-dash-faction-bar-wrap"><span class="collection-dash-faction-bar" style="width:' + pct + '%"></span></span>' +
          '<span class="collection-dash-faction-painted muted">' + s.painted + ' painted</span>' +
        '</li>';
    });
    html += '</ul></section>';

    // Filter controls + owned-unit list
    html += '<section class="collection-dash-section">' +
      '<h4>Owned units</h4>' +
      '<div class="collection-dash-filters">' +
        '<label class="collection-dash-filter">' +
          '<span>Faction</span>' +
          '<select id="collection-dash-faction">' +
            '<option value="all"' + (_dashFactionFilter === 'all' ? ' selected' : '') + '>All factions</option>' +
            factionNames.map(fn =>
              '<option value="' + htmlEsc(fn) + '"' + (_dashFactionFilter === fn ? ' selected' : '') + '>' + htmlEsc(fn) + '</option>'
            ).join('') +
          '</select>' +
        '</label>' +
        '<label class="collection-dash-filter">' +
          '<span>Status</span>' +
          '<select id="collection-dash-status">' +
            ['all'].concat(STATUSES.filter(s => s !== 'none')).map(s =>
              '<option value="' + s + '"' + (_dashStatusFilter === s ? ' selected' : '') + '>' +
                (s === 'all' ? 'Any' : STATUS_LABELS[s]) + '</option>'
            ).join('') +
          '</select>' +
        '</label>' +
      '</div>';

    // Build filtered list of owned (status != none) units.
    const rows = [];
    for (let i = 0; i < allUnits.length; i++) {
      const u = allUnits[i];
      if (!u || !u.id) continue;
      const status = getStatus(u.id);
      if (status === 'none') continue;
      if (_dashFactionFilter !== 'all' && (u._factionName || '') !== _dashFactionFilter) continue;
      if (_dashStatusFilter  !== 'all' && status !== _dashStatusFilter) continue;
      rows.push({ unit: u, status });
    }
    rows.sort((a, b) => {
      const fa = a.unit._factionName || '';
      const fb = b.unit._factionName || '';
      if (fa !== fb) return fa.localeCompare(fb);
      return (a.unit.name || '').localeCompare(b.unit.name || '');
    });

    if (rows.length === 0) {
      html += '<div class="collection-dash-empty muted">No units match the current filters.</div>';
    } else {
      html += '<ul class="collection-dash-unit-list">';
      rows.forEach(r => {
        html +=
          '<li class="collection-dash-unit" data-unit-id="' + htmlEsc(r.unit.id) + '">' +
            '<div class="collection-dash-unit-head">' +
              '<span class="collection-dash-unit-name">' + htmlEsc(r.unit.name) + '</span>' +
              '<span class="collection-dash-unit-faction muted">' + htmlEsc(r.unit._factionName || '') + '</span>' +
            '</div>' +
            '<div class="collection-dash-unit-controls">' +
              STATUSES.map(s =>
                '<button type="button" class="collection-status-btn collection-status-' + s +
                  (r.status === s ? ' active' : '') +
                  '" data-dash-unit="' + htmlEsc(r.unit.id) + '" data-dash-status="' + s + '">' +
                  STATUS_LABELS[s] +
                '</button>'
              ).join('') +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    body.innerHTML = html;

    const facSel = body.querySelector('#collection-dash-faction');
    if (facSel) facSel.addEventListener('change', evt => {
      _dashFactionFilter = evt.target.value || 'all';
      renderDashboard();
    });
    const stSel = body.querySelector('#collection-dash-status');
    if (stSel) stSel.addEventListener('change', evt => {
      _dashStatusFilter = evt.target.value || 'all';
      renderDashboard();
    });
    body.querySelectorAll('[data-dash-unit]').forEach(btn => {
      btn.addEventListener('click', () => {
        setStatus(btn.dataset.dashUnit, btn.dataset.dashStatus);
      });
    });
  }

  function openDashboard() {
    ensureDashboard();
    _dashboardEl.hidden = false;
    renderDashboard();
    document.addEventListener('keydown', onDashKey);
  }

  function closeDashboard() {
    if (!_dashboardEl) return;
    _dashboardEl.hidden = true;
    document.removeEventListener('keydown', onDashKey);
  }

  function onDashKey(e) {
    if (e.key === 'Escape') closeDashboard();
  }

  function refreshDashboardIfOpen() {
    if (_dashboardEl && !_dashboardEl.hidden) renderDashboard();
  }

  // ────────────────────────────────────────────────────────────────────
  // hook registrations
  // ────────────────────────────────────────────────────────────────────

  App.hooks.cardClassContributors.push(cardClassContributor);

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-collection',
    region: 'primary',
    label: 'Collection',
    title: 'Your model collection + painting tracker',
    onClick: openDashboard,
  });

  App.hooks.bootstrap.push(function (/* state */) {
    loadPersisted();
    applyBuildBadgesBodyClass();
    ensurePredicate();
    installChipObserver();
    installDetailObserver();
    installArmyPanelObserver();
    refreshArmyProgress();
    refreshSelectionBacklog();
  });

  // Mode change: re-evaluate every gated surface so toggling between modes
  // adds/removes chips, the ownership hint, and the painted-progress bar.
  // mode-shell.js loads after collection.js — initialize the array here if
  // it's not yet present so we still register cleanly.
  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function (/* mode */) {
    applyBuildBadgesBodyClass();
    // Chip bar may need to gain or lose chips depending on the new mode.
    const bar = document.getElementById('roster-filter-chips');
    if (bar) injectChips(bar);
    refreshArmyProgress();
    refreshSelectionBacklog();
    // Re-render roster so the predicate result (now mode-aware) takes effect.
    if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  });

  // The Settings drawer flips `yaab_show_collection_badges` in localStorage
  // from another tab/path; mirror it into a body class so CSS picks up the
  // change without a page reload.
  window.addEventListener('storage', function (e) {
    if (e && e.key === LS_SHOW_BADGES_IN_BUILD) applyBuildBadgesBodyClass();
  });

  // Same-tab updates: the Settings drawer writes its own body class
  // `hide-collection-badges` whenever its toggle changes. Mirror that signal
  // into our `yaab-build-badges-on` class so a click in the drawer reflects
  // immediately in BUILD without needing a `storage` event.
  if (typeof MutationObserver === 'function' && document.body) {
    new MutationObserver(applyBuildBadgesBodyClass)
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  App.hooks.armyChange.push(function () {
    refreshArmyProgress();
  });

  App.hooks.selectionChange.push(function () {
    refreshSelectionBacklog();
    // Detail panel may have been re-rendered; try to re-inject widget.
    injectDetailWidget();
  });

  // Expose for debugging / tests.
  App.collection = {
    getStatus,
    setStatus,
    STATUSES,
    openDashboard,
    closeDashboard,
  };
})();
