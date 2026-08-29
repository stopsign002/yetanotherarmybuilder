// ui/collect-mode.js — orchestrator for the Collect mode page (Painting).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Optional debug logging toggle — `localStorage.yaab_collect_debug = '1'`
  // turns on verbose console output for tracking down the "Collect is empty"
  // bug class.
  function dbg() {
    try {
      if (localStorage.getItem('yaab_collect_debug') !== '1') return;
    } catch (_) { return; }
    try { console.log.apply(console, ['[collect-mode]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  const LS_COLL    = 'yaab_collection';

  const STATUSES = ['none', 'unpainted', 'primed', 'painting', 'done'];
  const STATUS_LABELS = {
    none:      'None',
    unpainted: 'Unpainted',
    primed:    'Primed',
    painting:  'WIP',
    done:      'Done',
  };

  // ── module state ──────────────────────────────────────────────────────
  let _root           = null;       // the root node we render INTO
  let _rendered       = false;      // first-time render flag
  let _activeTab      = 'painting'; // only tab that remains
  let _activeFaction  = null;       // selected faction name (painting tab)
  let _searchTerm     = '';         // painting tab search
  let _statusFilter   = 'all';      // 'all' | 'owned' | 'painted' | 'needs'
  let _sidebarObs     = null;       // poll for late-arriving factions

  // ── helpers ───────────────────────────────────────────────────────────
  function htmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  // Read collection status — prefer App.collection if present, else direct LS.
  function readStatus(unitId) {
    if (!unitId) return 'none';
    if (App.collection && typeof App.collection.getStatus === 'function') {
      return App.collection.getStatus(unitId);
    }
    try {
      const raw = localStorage.getItem(LS_COLL);
      if (!raw) return 'none';
      const parsed = JSON.parse(raw);
      const s = parsed && parsed[unitId];
      return (typeof s === 'string' && STATUSES.indexOf(s) !== -1) ? s : 'none';
    } catch (_) { return 'none'; }
  }

  function writeStatus(unitId, newStatus) {
    if (!unitId) return;
    if (STATUSES.indexOf(newStatus) === -1) newStatus = 'none';
    if (App.collection && typeof App.collection.setStatus === 'function') {
      App.collection.setStatus(unitId, newStatus);
      return;
    }
    // Fallback: write LS directly.
    let parsed = {};
    try {
      const raw = localStorage.getItem(LS_COLL);
      if (raw) parsed = JSON.parse(raw) || {};
    } catch (_) {}
    if (newStatus === 'none') delete parsed[unitId];
    else parsed[unitId] = newStatus;
    try { localStorage.setItem(LS_COLL, JSON.stringify(parsed)); } catch (_) {}
  }

  // Aggregate per-faction stats from state.allUnits + collection LS.
  function computePerFaction() {
    const state = App.state || {};
    const all = state.allUnits || [];
    const factions = state.factions || [];
    const byName = Object.create(null); // name -> { total, owned, painted }
    for (let i = 0; i < all.length; i++) {
      const u = all[i];
      if (!u) continue;
      const fn = u._factionName || '(unknown)';
      if (!byName[fn]) byName[fn] = { total: 0, owned: 0, painted: 0 };
      byName[fn].total++;
      const s = readStatus(u.id);
      if (s !== 'none') byName[fn].owned++;
      if (s === 'done') byName[fn].painted++;
    }
    // Make sure all known factions appear (even with 0 units yet).
    for (let i = 0; i < factions.length; i++) {
      const fn = factions[i] && factions[i].factionName;
      if (fn && !byName[fn]) byName[fn] = { total: 0, owned: 0, painted: 0 };
    }
    return byName;
  }

  // ── root scaffolding ──────────────────────────────────────────────────
  function ensureRoot() {
    const host = document.getElementById('collect-mode');
    if (!host) return null;
    // Strip the static "Collection mode loading…" placeholder added by the
    // shell agent in index.html. Without this, the placeholder sat as a
    // sibling of our root and the user saw a stuck "loading" message.
    host.querySelectorAll('.mode-placeholder').forEach(el => el.remove());
    let root = host.querySelector('.collect-root');
    if (!root) {
      root = document.createElement('div');
      root.className = 'collect-root';
      root.innerHTML = ''
        + '<header class="collect-header">'
        +   '<h1 class="collect-title">Collection</h1>'
        +   '<nav class="collect-subtabs" role="tablist" aria-label="Collect sub-mode">'
        +     '<button type="button" class="collect-subtab" role="tab" data-tab="painting" aria-selected="true">Painting</button>'
        +   '</nav>'
        + '</header>'
        + '<div class="collect-body" id="collect-body" role="tabpanel"></div>';
      host.appendChild(root);

      // Sub-tab clicks.
      root.querySelectorAll('.collect-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          if (!tab || tab === _activeTab) return;
          _activeTab = tab;
          renderTabs();
          renderActiveTab();
        });
      });
    }
    _root = root;
    return root;
  }

  function renderTabs() {
    if (!_root) return;
    _root.querySelectorAll('.collect-subtab').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === _activeTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function renderActiveTab() {
    const body = _root && _root.querySelector('#collect-body');
    if (!body) return;
    body.innerHTML = '';
    if (_activeTab === 'painting')   { renderPaintingTab(body); return; }
  }

  // ── empty / loading state ─────────────────────────────────────────────
  function renderEmpty(body, msg) {
    body.innerHTML =
      '<div class="collect-empty">' +
        '<div class="collect-empty-spinner" aria-hidden="true"></div>' +
        '<div class="collect-empty-text">' + htmlEsc(msg) + '</div>' +
      '</div>';
  }

  // ── PAINTING TAB ──────────────────────────────────────────────────────
  function renderPaintingTab(body) {
    const state = App.state || {};
    const factions = state.factions || [];
    if (!factions.length) {
      renderEmpty(body, 'Loading collection… (factions still parsing)');
      // Try again once factions arrive.
      schedulePaintingRetry();
      return;
    }

    const stats = computePerFaction();
    const factionNames = Object.keys(stats).sort();
    if (!_activeFaction || factionNames.indexOf(_activeFaction) === -1) {
      _activeFaction = factionNames[0] || null;
    }

    body.innerHTML = ''
      + '<div class="collect-paint-layout">'
      +   '<aside class="collect-paint-sidebar" id="collect-paint-sidebar"></aside>'
      +   '<select class="collect-paint-mobile-picker" id="collect-paint-mobile-picker" aria-label="Choose faction"></select>'
      +   '<section class="collect-paint-main" id="collect-paint-main"></section>'
      + '</div>';

    renderFactionSidebar(stats, factionNames);
    renderFactionMobilePicker(stats, factionNames);
    renderFactionMain();
  }

  function schedulePaintingRetry() {
    if (_sidebarObs) return;
    const target = document.getElementById('panel-center') || document.body;
    let lastVer = (App.state && App.state.factionsVersion) || 0;
    _sidebarObs = new MutationObserver(() => {
      const cur = (App.state && App.state.factionsVersion) || 0;
      if (cur !== lastVer && _activeTab === 'painting') {
        lastVer = cur;
        renderActiveTab();
      }
    });
    try { _sidebarObs.observe(target, { childList: true, subtree: true }); }
    catch (_) {}
    // Also: poll briefly because faction loads happen via fetch, not DOM.
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const got = (App.state && App.state.factions && App.state.factions.length) || 0;
      if (got > 0) {
        clearInterval(iv);
        if (_activeTab === 'painting' && _root) renderActiveTab();
      } else if (tries > 60) {
        clearInterval(iv);
      }
    }, 500);
  }

  function renderFactionSidebar(stats, factionNames) {
    const side = _root.querySelector('#collect-paint-sidebar');
    if (!side) return;
    let html = '<div class="collect-paint-sidebar-head">Factions</div>';
    html += '<ul class="collect-paint-faction-list">';
    factionNames.forEach(fn => {
      const s = stats[fn];
      const pct = s.total > 0 ? Math.round((s.owned / s.total) * 100) : 0;
      const isActive = fn === _activeFaction;
      const sn = shortFaction(fn);
      html +=
        '<li>' +
          '<button type="button" class="collect-faction-row' + (isActive ? ' active' : '') +
                  '" data-faction="' + htmlEsc(fn) + '">' +
            '<span class="collect-faction-dot" data-faction-color="' + htmlEsc(sn) + '"></span>' +
            '<span class="collect-faction-name" title="' + htmlEsc(fn) + '">' + htmlEsc(sn) + '</span>' +
            '<span class="collect-faction-count">' + s.owned + '/' + s.total + '</span>' +
            '<span class="collect-faction-bar-wrap"><span class="collect-faction-bar" style="width:' + pct + '%"></span></span>' +
          '</button>' +
        '</li>';
    });
    html += '</ul>';
    side.innerHTML = html;

    // Apply faction-color dot via inline style (FACTION_COLORS lookup).
    side.querySelectorAll('[data-faction-color]').forEach(el => {
      const sn = el.getAttribute('data-faction-color');
      const palette = (typeof App.factionPalette === 'function')
        ? App.factionPalette(sn)
        : ((App.FACTION_COLORS && App.FACTION_COLORS[sn]) || App.DEFAULT_ACCENT);
      if (palette && palette[0]) el.style.background = palette[0];
    });

    side.querySelectorAll('.collect-faction-row').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeFaction = btn.getAttribute('data-faction');
        renderFactionSidebar(stats, factionNames);
        const picker = _root.querySelector('#collect-paint-mobile-picker');
        if (picker) picker.value = _activeFaction;
        renderFactionMain();
      });
    });
  }

  function renderFactionMobilePicker(stats, factionNames) {
    const sel = _root.querySelector('#collect-paint-mobile-picker');
    if (!sel) return;
    sel.innerHTML = factionNames.map(fn => {
      const s = stats[fn];
      return '<option value="' + htmlEsc(fn) + '"' +
        (fn === _activeFaction ? ' selected' : '') + '>' +
        htmlEsc(shortFaction(fn)) + ' (' + s.owned + '/' + s.total + ')' +
        '</option>';
    }).join('');
    sel.addEventListener('change', () => {
      _activeFaction = sel.value;
      const stats2 = computePerFaction();
      renderFactionSidebar(stats2, Object.keys(stats2).sort());
      renderFactionMain();
    });
  }

  function renderFactionMain() {
    const main = _root.querySelector('#collect-paint-main');
    if (!main) return;
    if (!_activeFaction) {
      main.innerHTML = '<div class="collect-empty-text muted">No factions loaded.</div>';
      return;
    }

    const state = App.state || {};
    const all = state.allUnits || [];
    const factionUnits = all.filter(u => u && u._factionName === _activeFaction);

    // Apply search + status filter.
    const q = _searchTerm.trim().toLowerCase();
    const filtered = factionUnits.filter(u => {
      if (q && !(u.name || '').toLowerCase().includes(q)) return false;
      const s = readStatus(u.id);
      if (_statusFilter === 'owned'   && s === 'none') return false;
      if (_statusFilter === 'painted' && s !== 'done') return false;
      if (_statusFilter === 'needs'   && !(s === 'unpainted' || s === 'primed' || s === 'painting')) return false;
      return true;
    });

    let owned = 0, painted = 0;
    factionUnits.forEach(u => {
      const s = readStatus(u.id);
      if (s !== 'none') owned++;
      if (s === 'done') painted++;
    });
    const ownedPct = factionUnits.length ? Math.round((owned / factionUnits.length) * 100) : 0;

    let html = '';
    html +=
      '<div class="collect-main-head">' +
        '<h2 class="collect-main-title">' + htmlEsc(shortFaction(_activeFaction)) + '</h2>' +
        '<div class="collect-main-summary">' +
          'Owned: <strong>' + owned + '</strong> of <strong>' + factionUnits.length + '</strong> units ' +
          '<span class="muted">(' + ownedPct + '%)</span>' +
          ' &middot; Painted: <strong>' + painted + '</strong>' +
        '</div>' +
      '</div>';

    html +=
      '<div class="collect-main-toolbar">' +
        '<input type="search" class="collect-search" id="collect-paint-search" ' +
          'placeholder="Search units…" value="' + htmlEsc(_searchTerm) + '" />' +
        '<div class="collect-filter-chips" role="group" aria-label="Status filter">' +
          renderFilterChip('all',     'All') +
          renderFilterChip('owned',   'Owned') +
          renderFilterChip('painted', 'Painted') +
          renderFilterChip('needs',   'Needs paint') +
        '</div>' +
        '<div class="collect-bulk-actions">' +
          '<button type="button" class="btn btn-sm btn-outline" data-bulk="own-visible">Mark visible owned</button>' +
          '<button type="button" class="btn btn-sm btn-outline" data-bulk="paint-visible">Mark visible painted</button>' +
          '<button type="button" class="btn btn-sm btn-outline" data-bulk="clear-visible">Clear visible</button>' +
        '</div>' +
      '</div>';

    if (!filtered.length) {
      html += '<div class="collect-empty-text muted">' +
        (factionUnits.length === 0
          ? 'No units known for this faction yet.'
          : 'No units match the current filter.') +
        '</div>';
    } else {
      html += '<div class="collect-unit-grid">';
      filtered.forEach(u => {
        const status = readStatus(u.id);
        const pts = (typeof u.points === 'number' && u.points > 0)
          ? (u.points + ' pts')
          : ((u.pointsOptions && u.pointsOptions[0] && u.pointsOptions[0].pts != null)
              ? (u.pointsOptions[0].pts + ' pts')
              : '—');
        html +=
          '<div class="unit-card collect-unit-card collection-' + status + '" data-unit-id="' + htmlEsc(u.id) + '">' +
            '<div class="collect-unit-card-head">' +
              '<span class="collect-unit-name" title="' + htmlEsc(u.name || 'Unit') + '">' +
                htmlEsc(u.name || 'Unit') + '</span>' +
              '<span class="collect-unit-pts">' + htmlEsc(pts) + '</span>' +
            '</div>' +
            '<div class="collect-unit-status-row">' +
              STATUSES.map(s =>
                '<button type="button" class="collection-status-btn collection-status-' + s +
                  (status === s ? ' active' : '') +
                  '" data-coll-set="' + s + '" data-unit-id="' + htmlEsc(u.id) +
                  '" title="' + htmlEsc(STATUS_LABELS[s]) + '">' +
                  htmlEsc(STATUS_LABELS[s]) +
                '</button>'
              ).join('') +
            '</div>' +
          '</div>';
      });
      html += '</div>';
    }

    main.innerHTML = html;

    // Wire search.
    const searchEl = main.querySelector('#collect-paint-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        _searchTerm = searchEl.value || '';
        renderFactionMain();
        // Restore focus + caret position.
        const refocus = _root.querySelector('#collect-paint-search');
        if (refocus) {
          refocus.focus();
          try { refocus.setSelectionRange(refocus.value.length, refocus.value.length); }
          catch (_) {}
        }
      });
    }
    // Filter chips.
    main.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        _statusFilter = btn.getAttribute('data-filter') || 'all';
        renderFactionMain();
      });
    });
    // Status buttons per card.
    main.querySelectorAll('[data-coll-set]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-unit-id');
        const next = btn.getAttribute('data-coll-set');
        writeStatus(id, next);
        // Re-render main + sidebar (counts move).
        const stats = computePerFaction();
        renderFactionSidebar(stats, Object.keys(stats).sort());
        renderFactionMain();
      });
    });
    // Bulk actions.
    main.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.addEventListener('click', () => {
        const op = btn.getAttribute('data-bulk');
        filtered.forEach(u => {
          if (op === 'own-visible') {
            if (readStatus(u.id) === 'none') writeStatus(u.id, 'unpainted');
          } else if (op === 'paint-visible') {
            writeStatus(u.id, 'done');
          } else if (op === 'clear-visible') {
            writeStatus(u.id, 'none');
          }
        });
        const stats = computePerFaction();
        renderFactionSidebar(stats, Object.keys(stats).sort());
        renderFactionMain();
      });
    });
  }

  function renderFilterChip(value, label) {
    const isActive = _statusFilter === value;
    return '<button type="button" class="collect-filter-chip' + (isActive ? ' active' : '') +
      '" data-filter="' + value + '">' + htmlEsc(label) + '</button>';
  }

  // ── activation ───────────────────────────────────────────────────────
  // Lazy-render on first activation; reuse the DOM thereafter.
  function activate() {
    const root = ensureRoot();
    if (!root) {
      dbg('activate: no #collect-mode host element found');
      return;
    }
    dbg('activate, rendered=', _rendered, 'activeTab=', _activeTab,
        'factions=', (App.state && App.state.factions && App.state.factions.length) | 0);
    if (!_rendered) {
      _rendered = true;
      renderTabs();
      renderActiveTab();
    } else {
      // Re-render the active tab on each activation — cheap, and
      // catches Collection edits made elsewhere while away.
      renderActiveTab();
    }
  }

  // Trigger activate when the body data-mode attribute switches to "collect".
  // This is a belt-and-braces backup for App.hooks.modeChange — if some other
  // code path calls applyMode without firing hooks (or hooks isn't initialised
  // when this module loads), the body attribute MutationObserver still catches it.
  function watchBodyDataMode() {
    if (!document.body) return;
    try {
      const obs = new MutationObserver(() => {
        if (document.body.getAttribute('data-mode') === 'collect') {
          dbg('body[data-mode=collect] observed');
          activate();
        }
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
    } catch (e) {
      console.warn('[collect-mode] MutationObserver attach failed:', e && e.message);
    }
  }

  // Also expose a custom DOM event for any future trigger pathway.
  document.addEventListener('yaab:mode-change', function (e) {
    const mode = e && e.detail && e.detail.mode;
    dbg('yaab:mode-change event', mode);
    if (mode === 'collect') activate();
  });

  // ── hook registrations ────────────────────────────────────────────────
  // Listen for mode change. The shell agent registers App.hooks.modeChange;
  // it may not exist yet, so we add it defensively.
  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function (mode) {
    dbg('App.hooks.modeChange fired:', mode);
    if (mode === 'collect') activate();
  });

  // Also re-render when the army or collection state changes (counts move).
  App.hooks.armyChange.push(function () {
    if (_activeTab === 'painting' && _rendered && _root && !isHidden()) {
      const stats = computePerFaction();
      const side = _root.querySelector('#collect-paint-sidebar');
      if (side) renderFactionSidebar(stats, Object.keys(stats).sort());
      renderFactionMain();
    }
  });

  function isHidden() {
    const host = document.getElementById('collect-mode');
    return !host || host.hidden || !host.classList.contains('mode-active');
  }

  App.hooks.bootstrap.push(function () {
    dbg('bootstrap');
    // If the page already started in collect mode (deep-link future-proofing),
    // render now. Otherwise wait for modeChange.
    const host = document.getElementById('collect-mode');
    if (host && (host.classList.contains('mode-active') ||
                 (document.body && document.body.getAttribute('data-mode') === 'collect'))
              && !host.hidden) {
      activate();
    }
    watchBodyDataMode();
  });

  // Public surface (debugging / manual refresh).
  App.collectMode = {
    activate,
    setTab: function (t) {
      if (t !== 'painting') return;
      _activeTab = t;
      if (_rendered) { renderTabs(); renderActiveTab(); }
    },
    refresh: function () { if (_rendered) renderActiveTab(); },
  };
})();
