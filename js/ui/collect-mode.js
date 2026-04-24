// ui/collect-mode.js — orchestrator for the Collect mode page (Painting / Crusade / Kill Team sub-tabs).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_COLL    = 'yaab_collection';
  const LS_CRUSADE = 'yaab_crusade_rosters';
  const LS_KT      = 'yaab_kt_mode';

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
  let _activeTab      = 'painting'; // 'painting' | 'crusade' | 'kill-team'
  let _activeFaction  = null;       // selected faction name (painting tab)
  let _activeRosterId = null;       // selected crusade roster (inline list)
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

  // Read crusade rosters from LS (crusade.js internal state isn't exposed for write).
  function readCrusadeRosters() {
    try {
      const raw = localStorage.getItem(LS_CRUSADE);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function readKtActive() {
    try { return localStorage.getItem(LS_KT) === '1'; }
    catch (_) { return false; }
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
    let root = host.querySelector('.collect-root');
    if (!root) {
      root = document.createElement('div');
      root.className = 'collect-root';
      root.innerHTML = ''
        + '<header class="collect-header">'
        +   '<h1 class="collect-title">Collection</h1>'
        +   '<nav class="collect-subtabs" role="tablist" aria-label="Collect sub-mode">'
        +     '<button type="button" class="collect-subtab" role="tab" data-tab="painting" aria-selected="true">Painting</button>'
        +     '<button type="button" class="collect-subtab" role="tab" data-tab="crusade" aria-selected="false">Crusade</button>'
        +     '<button type="button" class="collect-subtab" role="tab" data-tab="kill-team" aria-selected="false">Kill Team</button>'
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
    if (_activeTab === 'crusade')    { renderCrusadeTab(body);  return; }
    if (_activeTab === 'kill-team')  { renderKillTeamTab(body); return; }
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
      const palette = (App.FACTION_COLORS && (App.FACTION_COLORS[sn])) || App.DEFAULT_ACCENT;
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
              '<span class="collect-unit-name">' + htmlEsc(u.name || 'Unit') + '</span>' +
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

  // ── CRUSADE TAB ───────────────────────────────────────────────────────
  function renderCrusadeTab(body) {
    const rosters = readCrusadeRosters();
    if (!_activeRosterId || !rosters.find(r => r.id === _activeRosterId)) {
      _activeRosterId = rosters[0] ? rosters[0].id : null;
    }
    body.innerHTML = ''
      + '<div class="collect-crusade-layout">'
      +   '<aside class="collect-crusade-sidebar" id="collect-crusade-sidebar"></aside>'
      +   '<select class="collect-crusade-mobile-picker" id="collect-crusade-mobile-picker" aria-label="Choose roster"></select>'
      +   '<section class="collect-crusade-main" id="collect-crusade-main"></section>'
      + '</div>';
    renderCrusadeSidebar(rosters);
    renderCrusadeMobilePicker(rosters);
    renderCrusadeMain(rosters);
  }

  function renderCrusadeSidebar(rosters) {
    const side = _root.querySelector('#collect-crusade-sidebar');
    if (!side) return;
    let html = '<div class="collect-paint-sidebar-head">Crusade Rosters</div>';
    if (!rosters.length) {
      html += '<div class="collect-empty-text muted">No rosters yet.</div>';
    } else {
      html += '<ul class="collect-paint-faction-list">';
      rosters.forEach(r => {
        const isActive = r.id === _activeRosterId;
        const sn = shortFaction(r.factionName || '');
        html +=
          '<li>' +
            '<button type="button" class="collect-faction-row' + (isActive ? ' active' : '') +
                    '" data-roster="' + htmlEsc(r.id) + '">' +
              '<span class="collect-faction-dot" data-faction-color="' + htmlEsc(sn) + '"></span>' +
              '<span class="collect-faction-name">' + htmlEsc(r.name || 'Untitled') + '</span>' +
              '<span class="collect-faction-count">' + (r.battlesPlayed | 0) + ' bttl</span>' +
            '</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    html +=
      '<div class="collect-sidebar-actions">' +
        '<button type="button" class="btn btn-sm btn-accent" id="collect-crus-new">New Crusade Roster</button>' +
        '<button type="button" class="btn btn-sm btn-outline" id="collect-crus-open">Open Crusade Dashboard</button>' +
      '</div>';
    side.innerHTML = html;

    side.querySelectorAll('[data-faction-color]').forEach(el => {
      const sn = el.getAttribute('data-faction-color');
      const palette = (App.FACTION_COLORS && App.FACTION_COLORS[sn]) || App.DEFAULT_ACCENT;
      if (palette && palette[0]) el.style.background = palette[0];
    });
    side.querySelectorAll('.collect-faction-row').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeRosterId = btn.getAttribute('data-roster');
        renderCrusadeTab(_root.querySelector('#collect-body'));
      });
    });
    const newBtn = side.querySelector('#collect-crus-new');
    if (newBtn) newBtn.addEventListener('click', triggerCrusadeDashboard);
    const openBtn = side.querySelector('#collect-crus-open');
    if (openBtn) openBtn.addEventListener('click', triggerCrusadeDashboard);
  }

  function renderCrusadeMobilePicker(rosters) {
    const sel = _root.querySelector('#collect-crusade-mobile-picker');
    if (!sel) return;
    if (!rosters.length) { sel.style.display = 'none'; return; }
    sel.innerHTML = rosters.map(r =>
      '<option value="' + htmlEsc(r.id) + '"' + (r.id === _activeRosterId ? ' selected' : '') + '>' +
        htmlEsc(r.name || 'Untitled') +
      '</option>').join('');
    sel.addEventListener('change', () => {
      _activeRosterId = sel.value;
      renderCrusadeTab(_root.querySelector('#collect-body'));
    });
  }

  function renderCrusadeMain(rosters) {
    const main = _root.querySelector('#collect-crusade-main');
    if (!main) return;
    if (!rosters.length) {
      main.innerHTML =
        '<div class="collect-detail-empty">' +
          '<h2 class="collect-main-title">Crusade campaigns</h2>' +
          '<p class="muted">No Crusade rosters yet. Crusade is the persistent narrative campaign mode — units gain XP, ranks, honours, and scars across multiple battles.</p>' +
          '<p><button type="button" class="btn btn-accent" id="collect-crus-new-main">Create your first roster</button></p>' +
        '</div>';
      const btn = main.querySelector('#collect-crus-new-main');
      if (btn) btn.addEventListener('click', triggerCrusadeDashboard);
      return;
    }
    const r = rosters.find(x => x.id === _activeRosterId) || rosters[0];
    if (!r) return;
    const winRate = r.battlesPlayed > 0
      ? Math.round((r.battlesWon / r.battlesPlayed) * 100) + '%'
      : '—';

    let html = '';
    html +=
      '<div class="collect-main-head">' +
        '<h2 class="collect-main-title">' + htmlEsc(r.name || 'Untitled') + '</h2>' +
        '<div class="collect-main-summary muted">' +
          htmlEsc(r.factionName || '(no faction)') +
        '</div>' +
      '</div>';

    html +=
      '<div class="collect-crusade-stats">' +
        statBlock(r.supplyUsed + ' / ' + r.supplyLimit, 'Supply') +
        statBlock(String(r.battlesPlayed | 0), 'Battles') +
        statBlock((r.battlesWon | 0) + ' (' + winRate + ')', 'Wins') +
        statBlock(String(r.crusadePoints | 0), 'CP') +
      '</div>';

    const units = Array.isArray(r.units) ? r.units : [];
    html += '<section class="collect-crusade-section">' +
      '<h3 class="collect-section-title">Order of Battle <span class="muted">(' + units.length + ' units)</span></h3>';
    if (!units.length) {
      html += '<div class="collect-empty-text muted">No units yet. Open the Crusade Dashboard to add some.</div>';
    } else {
      html += '<ul class="collect-crusade-unit-list">';
      units.forEach(u => {
        const xp = u.xp | 0;
        html +=
          '<li class="collect-crusade-unit">' +
            '<div class="collect-crusade-unit-head">' +
              '<span class="collect-crusade-unit-name">' + htmlEsc(u.unitName || '(unit)') + '</span>' +
              (u.label ? '<span class="collect-crusade-unit-label">"' + htmlEsc(u.label) + '"</span>' : '') +
              '<span class="collect-crusade-unit-rank">' + htmlEsc(u.rank || 'Battle-ready') + '</span>' +
            '</div>' +
            '<div class="collect-crusade-unit-stats">' +
              '<span>' + (u.currentPts | 0) + ' pts</span>' +
              '<span>' + xp + ' XP</span>' +
              '<span>' + (u.battlesPlayed | 0) + ' battles</span>' +
              '<span>' + ((u.battleHonours || []).length) + ' honours</span>' +
              '<span>' + ((u.battleScars   || []).length) + ' scars</span>' +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    const battles = Array.isArray(r.battles) ? r.battles : [];
    html += '<section class="collect-crusade-section">' +
      '<h3 class="collect-section-title">Battle Log <span class="muted">(' + battles.length + ' entries)</span></h3>';
    if (!battles.length) {
      html += '<div class="collect-empty-text muted">No battles logged yet.</div>';
    } else {
      const recent = battles.slice().reverse().slice(0, 10);
      html += '<ul class="collect-crusade-battle-list">';
      recent.forEach(b => {
        const verdict = b.won ? 'Victory' : (b.draw ? 'Draw' : 'Defeat');
        const cls = b.won ? 'win' : (b.draw ? 'draw' : 'loss');
        const date = String(b.date || '').split('T')[0];
        html +=
          '<li class="collect-crusade-battle">' +
            '<span class="collect-battle-date">' + htmlEsc(date) + '</span>' +
            '<span class="collect-battle-vs">vs ' + htmlEsc(b.opponentName || '(unknown)') + '</span>' +
            '<span class="muted">' + htmlEsc(b.opponentFaction || '') + '</span>' +
            '<span class="muted">' + htmlEsc(b.mission || '') + '</span>' +
            '<span class="collect-battle-score">' + (b.ourScore | 0) + ' – ' + (b.theirScore | 0) + '</span>' +
            '<span class="collect-battle-verdict collect-battle-verdict-' + cls + '">' + verdict + '</span>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    html +=
      '<div class="collect-deferred-cta">' +
        '<p class="muted">Editing units, awarding XP, logging battles, and managing honours / scars happens in the full Crusade Dashboard.</p>' +
        '<button type="button" class="btn btn-accent" id="collect-crus-edit">Open Crusade Dashboard</button>' +
      '</div>';

    main.innerHTML = html;

    const editBtn = main.querySelector('#collect-crus-edit');
    if (editBtn) editBtn.addEventListener('click', triggerCrusadeDashboard);
  }

  function statBlock(num, label) {
    return '<div class="collect-stat">' +
      '<span class="collect-stat-num">' + htmlEsc(String(num)) + '</span>' +
      '<span class="collect-stat-lbl">' + htmlEsc(label) + '</span>' +
    '</div>';
  }

  // Defer to existing modal: prefer App.crusade.open(), fall back to clicking the
  // toolbar button (which lazy-loads + opens the modal).
  function triggerCrusadeDashboard() {
    if (App.crusade && typeof App.crusade.open === 'function') {
      try { App.crusade.open(); return; } catch (_) {}
    }
    const btn = document.getElementById('yaab-btn-crusade');
    if (btn) { btn.click(); return; }
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Crusade module not available yet.', 'warning', 3000);
    }
  }

  // After the deferred Crusade modal closes, the user may have changed
  // rosters — refresh our inline view if we're showing it.
  function pollCrusadeChanges() {
    if (_activeTab !== 'crusade' || !_root) return;
    renderCrusadeTab(_root.querySelector('#collect-body'));
  }

  // ── KILL TEAM TAB ─────────────────────────────────────────────────────
  function renderKillTeamTab(body) {
    const ktActive = readKtActive();
    body.innerHTML = ''
      + '<div class="collect-main-head">'
      +   '<h2 class="collect-main-title">Kill Team</h2>'
      +   '<div class="collect-main-summary muted">Small-format mode &mdash; cap 200 pts, hide oversized vehicles &amp; monsters.</div>'
      + '</div>'
      + '<section class="collect-kt-status">'
      +   '<div class="collect-kt-status-row">'
      +     '<div class="collect-kt-status-text">'
      +       '<div class="collect-kt-status-title">Mode</div>'
      +       '<div class="muted">' + (ktActive ? 'Currently <strong>active</strong>.' : 'Currently inactive.') + '</div>'
      +     '</div>'
      +     '<button type="button" class="kt-switch ' + (ktActive ? 'kt-switch-on' : '') + '" id="collect-kt-switch" role="switch" aria-checked="' + (ktActive ? 'true' : 'false') + '">'
      +       '<span class="kt-switch-knob"></span>'
      +       '<span class="kt-switch-label">' + (ktActive ? 'ON' : 'OFF') + '</span>'
      +     '</button>'
      +   '</div>'
      + '</section>'
      + '<section class="collect-kt-section">'
      +   '<h3 class="collect-section-title">Starter Kill Teams</h3>'
      +   '<p class="muted">Six pre-built 200-point lists. Loading a template replaces your current army.</p>'
      +   '<div class="collect-kt-templates" id="collect-kt-templates"></div>'
      + '</section>'
      + '<section class="collect-kt-section">'
      +   '<h3 class="collect-section-title">Mission generator</h3>'
      +   '<div class="collect-kt-mission-row">'
      +     '<button type="button" class="btn btn-accent" id="collect-kt-roll">Roll mission</button>'
      +     '<div class="collect-kt-mission-display" id="collect-kt-mission">'
      +       '<div class="muted">Click "Roll mission" to draw one.</div>'
      +     '</div>'
      +   '</div>'
      + '</section>'
      + '<div class="collect-deferred-cta">'
      +   '<p class="muted">Use the full Kill Team Dashboard for inline switch &amp; mission UX.</p>'
      +   '<button type="button" class="btn btn-outline" id="collect-kt-open">Open Kill Team Dashboard</button>'
      + '</div>';

    // Wire switch — defer to existing toggle if the module is loaded; else
    // load it via the toolbar click and let it handle activation.
    const sw = body.querySelector('#collect-kt-switch');
    if (sw) sw.addEventListener('click', () => {
      if (typeof App.toggleKillTeamMode === 'function') {
        try { App.toggleKillTeamMode(); }
        catch (_) {}
      } else {
        triggerKtDashboard();
      }
      // Re-render after a tick to reflect new state.
      setTimeout(() => renderKillTeamTab(body), 50);
    });

    // Mission roll: works inline if module is loaded; else defer.
    const rollBtn = body.querySelector('#collect-kt-roll');
    const display = body.querySelector('#collect-kt-mission');
    if (rollBtn) rollBtn.addEventListener('click', () => {
      const m = pickKtMission();
      if (m && display) {
        display.innerHTML =
          '<div class="collect-kt-mission-card">' +
            '<div class="collect-kt-mission-name">' + htmlEsc(m.name) + '</div>' +
            '<div class="collect-kt-mission-desc muted">' + htmlEsc(m.desc) + '</div>' +
          '</div>';
      }
    });

    // Templates list — read from kill-team module if loaded, else show a
    // generic "Load via dashboard" list.
    const tplHost = body.querySelector('#collect-kt-templates');
    if (tplHost) renderKtTemplates(tplHost);

    const openBtn = body.querySelector('#collect-kt-open');
    if (openBtn) openBtn.addEventListener('click', triggerKtDashboard);
  }

  // Mirror the mission catalog from kill-team.js — small enough to copy without
  // breaking the "don't modify other files" constraint, plus matches the
  // existing user expectation.
  const KT_MISSIONS = [
    { name: 'Recover Intel',  desc: 'Control the central objective at the end of turn 4 to win.' },
    { name: 'Sabotage',       desc: 'A single enemy unit is marked at deployment; destroy it to win.' },
    { name: 'Hold The Line',  desc: 'Score points for each enemy unit you eliminated over the game.' },
    { name: "Smoke 'em Out",  desc: 'Destroy 50% of the enemy units (rounded up) to win.' },
    { name: 'Vanguard Strike', desc: "Score points for each unit wholly within your opponent's deployment zone." },
  ];
  let _lastKtMission = null;
  function pickKtMission() {
    let m = KT_MISSIONS[Math.floor(Math.random() * KT_MISSIONS.length)];
    if (_lastKtMission && m.name === _lastKtMission.name && KT_MISSIONS.length > 1) {
      m = KT_MISSIONS[(KT_MISSIONS.indexOf(m) + 1) % KT_MISSIONS.length];
    }
    _lastKtMission = m;
    return m;
  }

  // Static list of starter Kill Team templates (mirrors kill-team.js TEMPLATES).
  // We don't write the army here — clicking "Load template" defers to the
  // dashboard so the existing module owns the army-mutation path.
  const KT_TEMPLATES = [
    { id: 'kt-sm',       title: 'Space Marines Strike Team',         faction: 'Imperium - Adeptus Astartes - Space Marines',
      description: 'Captain leads a Tactical fire-base with Eliminators on overwatch.' },
    { id: 'kt-tyranids', title: 'Tyranids Vanguard Brood',           faction: 'Tyranids',
      description: 'A Hive Tyrant directs a screen of Termagants and lurking Genestealers.' },
    { id: 'kt-necrons',  title: 'Necrons Awakened Patrol',           faction: 'Necrons',
      description: 'An Overlord oversees Warriors and Immortals in a re-animating phalanx.' },
    { id: 'kt-orks',     title: 'Orks Boyz Mob',                     faction: 'Orks',
      description: 'Warboss leads a green tide with Tankbustas hunting the heavy stuff.' },
    { id: 'kt-aeldari',  title: 'Aeldari Ranger Patrol',             faction: 'Aeldari',
      description: 'A Farseer guides Guardian Defenders and Rangers through quick strikes.' },
    { id: 'kt-admech',   title: 'Adeptus Mechanicus Reconnaissance', faction: 'Imperium - Adeptus Mechanicus',
      description: 'A Tech-Priest guides Skitarii Vanguard and Rangers across hostile ground.' },
  ];

  function renderKtTemplates(host) {
    host.innerHTML = KT_TEMPLATES.map(tpl =>
      '<div class="collect-kt-template" data-id="' + htmlEsc(tpl.id) + '">' +
        '<div class="collect-kt-template-head">' +
          '<div class="collect-kt-template-title">' + htmlEsc(tpl.title) + '</div>' +
          '<div class="collect-kt-template-pill">200 pt</div>' +
        '</div>' +
        '<div class="collect-kt-template-faction muted">' + htmlEsc(shortFaction(tpl.faction)) + '</div>' +
        '<div class="collect-kt-template-desc">' + htmlEsc(tpl.description) + '</div>' +
        '<div class="collect-kt-template-actions">' +
          '<button type="button" class="btn btn-sm btn-accent" data-kt-load="' + htmlEsc(tpl.id) + '">Load template</button>' +
        '</div>' +
      '</div>').join('');
    host.querySelectorAll('[data-kt-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        // The kill-team module owns army mutation; open its modal so the user
        // sees the load happen with proper validation/toast.
        triggerKtDashboard();
      });
    });
  }

  function triggerKtDashboard() {
    if (typeof App.openKillTeamModal === 'function') {
      try { App.openKillTeamModal(); return; } catch (_) {}
    }
    const btn = document.getElementById('yaab-btn-kill-team');
    if (btn) { btn.click(); return; }
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Kill Team module not available yet.', 'warning', 3000);
    }
  }

  // ── activation ───────────────────────────────────────────────────────
  // Lazy-render on first activation; reuse the DOM thereafter.
  function activate() {
    const root = ensureRoot();
    if (!root) return;
    if (!_rendered) {
      _rendered = true;
      renderTabs();
      renderActiveTab();
    } else {
      // Re-render the active tab on each activation — cheap, and
      // catches Collection / Crusade edits made elsewhere while away.
      renderActiveTab();
    }
  }

  // Install a poll for crusade modal close so our inline view refreshes.
  // The Crusade modal sets a `crusade-modal-backdrop` element; when it goes
  // hidden after being open, refresh.
  let _crusadeWasOpen = false;
  function watchCrusadeModal() {
    setInterval(() => {
      const m = document.querySelector('.crusade-modal-backdrop');
      const isOpen = !!(m && !m.hidden);
      if (_crusadeWasOpen && !isOpen) {
        _crusadeWasOpen = false;
        if (_activeTab === 'crusade') pollCrusadeChanges();
      }
      if (isOpen) _crusadeWasOpen = true;
    }, 600);
  }

  // ── hook registrations ────────────────────────────────────────────────
  // Listen for mode change. The shell agent registers App.hooks.modeChange;
  // it may not exist yet, so we add it defensively.
  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(function (mode) {
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
    // If the page already started in collect mode (deep-link future-proofing),
    // render now. Otherwise wait for modeChange.
    const host = document.getElementById('collect-mode');
    if (host && host.classList.contains('mode-active') && !host.hidden) {
      activate();
    }
    watchCrusadeModal();
  });

  // Public surface (debugging / manual refresh).
  App.collectMode = {
    activate,
    setTab: function (t) {
      if (['painting', 'crusade', 'kill-team'].indexOf(t) === -1) return;
      _activeTab = t;
      if (_rendered) { renderTabs(); renderActiveTab(); }
    },
    refresh: function () { if (_rendered) renderActiveTab(); },
  };
})();
