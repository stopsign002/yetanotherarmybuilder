// ui/roster.js — center-panel unit grid with capped render + scroll-append.
(function () {
  const UI = window.UI = window.UI || {};

  // Capped-render config: initial batch, then append more as we approach
  // the bottom. This keeps total DOM under ~2× PAGE cards (well under 200
  // typically) while playing nicely with CSS `grid-template-columns:auto-fill`.
  const INITIAL_PAGE = 120;
  const APPEND_PAGE  = 80;
  const SCROLL_APPEND_PX = 400;  // append when within this many px of bottom

  // Per-roster state held in a module-local object rather than on the grid
  // element — survives across re-renders and avoids DOM reads.
  const R = {
    filtered: [],
    rendered: 0,
    selectedId: null,
    scrollContainer: null,
    scrollHandler: null,
    scrollRaf: 0,
    // Active filter-chip keywords (lowercased). Each chip cycles through
    // three states on click: undefined → 'include' (green) → 'exclude'
    // (red) → undefined. Includes are AND-ed together; excludes filter
    // any unit carrying the matching keyword.
    chipState: Object.create(null),
    // Marker so we don't register the chip predicate more than once.
    _chipPredicateRegistered: false,
    // Last filter signature — used by renderUnitRoster to decide whether
    // to reset scrollTop. Re-renders driven by armyChange / autosave /
    // sync that don't actually change the filtered set should keep the
    // user where they were on the page; only an honest filter change
    // (search input, faction switch, role chip, points filter) snaps
    // back to the top.
    lastFilterSig: null,
  };

  // Chips: label shown to the user -> keyword matched against unit.keywords.
  const ROLE_CHIPS = [
    { label: 'Battleline', kw: 'battleline' },
    { label: 'Character',  kw: 'character'  },
    { label: 'Infantry',   kw: 'infantry'   },
    { label: 'Vehicle',    kw: 'vehicle'    },
    { label: 'Monster',    kw: 'monster'    },
    { label: 'Psyker',     kw: 'psyker'     },
  ];

  UI.renderStatCell = function (label, value) {
    return `<div class="stat-cell"><span class="stat-name">${label}</span><span class="stat-value">${UI.escapeHtml(String(value))}</span></div>`;
  };

  // Match: split search into whitespace tokens; every token must match the unit (AND).
  // A token matches if it's a substring of the unit name, any keyword, or the faction name.
  function fuzzyMatch(unit, tokens) {
    const name     = (unit.name || '').toLowerCase();
    const fac      = (unit._factionName || '').toLowerCase();
    const keywords = (unit.keywords || []).map(k => k.toLowerCase());
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (!tok) continue;
      const hit =
        name.indexOf(tok) !== -1 ||
        fac.indexOf(tok)  !== -1 ||
        keywords.some(k => k.indexOf(tok) !== -1);
      if (!hit) return false;
    }
    return true;
  }

  UI.createUnitCard = function (unit, isSelected, opts) {
    const esc = UI.escapeHtml;
    const card = document.createElement('div');
    const extraClasses = (window.App && App.hooks && App.hooks.cardClassContributors || [])
      .map(fn => { try { return fn(unit); } catch (_) { return null; } })
      .filter(Boolean).join(' ');
    const hideFaction = !!(opts && opts.hideFaction);
    card.className = 'unit-card'
      + (isSelected ? ' selected' : '')
      + (hideFaction ? ' faction-hidden' : '')
      + (extraClasses ? ' ' + extraClasses : '');
    card.dataset.unitId      = unit.id;
    card.dataset.factionName = unit._factionName || '';

    const stats    = unit.stats    || {};
    const keywords = unit.keywords || [];

    const resolvedStats = {};
    ['M', 'T', 'W'].forEach(k => { if (stats[k] != null) resolvedStats[k] = stats[k]; });
    Object.entries(UI._STAT_ALIASES).forEach(([canonical, aliases]) => {
      if (canonical === 'M' || canonical === 'T' || canonical === 'W') return;
      const found = aliases.find(a => stats[a] != null && stats[a] !== '');
      if (found) resolvedStats[canonical] = stats[found];
    });
    if (unit.invulnSave && resolvedStats['SV']) {
      resolvedStats['SV'] = resolvedStats['SV'] + '/' + unit.invulnSave;
    }
    const cardStats = UI._CARD_STAT_PREF
      .filter(k => resolvedStats[k] != null && resolvedStats[k] !== '')
      .slice(0, 6);

    const ptsOpts    = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const ptsDisplay = ptsOpts.length > 1
      ? ptsOpts.join(' / ') + ' pts'
      : ptsOpts.length === 1 ? ptsOpts[0] + ' pts' : '—';

    card.classList.add('unit-card-datasheet');
    card.innerHTML = `
      <div class="unit-card-header unit-card-banner">
        <div class="unit-card-name unit-card-name-primary">${esc(unit.name)}</div>
        <div class="unit-card-pts unit-card-pts-badge">${ptsDisplay}</div>
      </div>
      <div class="unit-card-faction unit-card-faction-tertiary">${esc(unit._factionName || '')}</div>
      <div class="unit-card-stats unit-card-stat-strip" style="grid-template-columns:repeat(${cardStats.length || 6},1fr)">
        ${cardStats.length > 0 ? cardStats.map(k => UI.renderStatCell(k, resolvedStats[k])).join('') : UI.renderStatCell('—','—')}</div>
      ${keywords.length > 0 ? `<div class="unit-card-keywords unit-card-keywords-muted">${
        keywords.slice(0, 4).map(k => `<span class="keyword-tag">${esc(k)}</span>`).join('')
        }${keywords.length > 4 ? `<span class="keyword-tag">+${keywords.length - 4}</span>` : ''
      }</div>` : ''}
    `;
    return card;
  };

  function getScrollContainer(grid) {
    if (R.scrollContainer && document.body.contains(R.scrollContainer)) return R.scrollContainer;
    let el = grid.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY)) { R.scrollContainer = el; return el; }
      el = el.parentElement;
    }
    R.scrollContainer = grid.parentElement;
    return R.scrollContainer;
  }

  function appendBatch(grid, n) {
    const end = Math.min(R.rendered + n, R.filtered.length);
    if (end <= R.rendered) return;
    const frag = document.createDocumentFragment();
    for (let i = R.rendered; i < end; i++) {
      const unit = R.filtered[i];
      frag.appendChild(UI.createUnitCard(unit, unit.id === R.selectedId, { hideFaction: R.hideFaction }));
    }
    grid.appendChild(frag);
    R.rendered = end;
  }

  function onScroll() {
    if (R.scrollRaf) return;
    R.scrollRaf = requestAnimationFrame(() => {
      R.scrollRaf = 0;
      const grid = document.getElementById('unit-grid');
      if (!grid) return;
      if (R.rendered >= R.filtered.length) return;
      const sc = getScrollContainer(grid);
      const remaining = sc.scrollHeight - (sc.scrollTop + sc.clientHeight);
      if (remaining < SCROLL_APPEND_PX) appendBatch(grid, APPEND_PAGE);
    });
  }

  function ensureScrollListener(grid) {
    const sc = getScrollContainer(grid);
    if (R.scrollHandler && sc === R._boundTo) return;
    if (R.scrollHandler && R._boundTo) R._boundTo.removeEventListener('scroll', R.scrollHandler);
    R.scrollHandler = onScroll;
    R._boundTo = sc;
    sc.addEventListener('scroll', R.scrollHandler, { passive: true });
  }

  // Inject chip row once, as the first child of the center panel's .panel-body.
  // Idempotent: subsequent calls just return the existing node.
  function ensureChipBar() {
    let bar = document.getElementById('roster-filter-chips');
    if (bar) return bar;
    const controls = document.querySelector('#panel-center .panel-controls')
                  || document.querySelector('.panel-controls');
    if (!controls) return null;
    bar = document.createElement('div');
    bar.id = 'roster-filter-chips';
    bar.className = 'filter-chips';
    ROLE_CHIPS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-chip';
      btn.dataset.chipKw = c.kw;
      btn.textContent = c.label;
      btn.title = 'Click to require ' + c.label + '; click again to exclude';
      btn.addEventListener('click', () => {
        const cur = R.chipState[c.kw];
        let next;
        if (!cur)              next = 'include';
        else if (cur === 'include') next = 'exclude';
        else                   next = null;
        if (next) R.chipState[c.kw] = next;
        else      delete R.chipState[c.kw];
        btn.classList.toggle('active',   next === 'include');
        btn.classList.toggle('excluded', next === 'exclude');
        btn.setAttribute('aria-pressed', next === 'include' ? 'true' : 'false');
        syncClearVisibility();
        if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      });
      bar.appendChild(btn);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'filter-chips-clear';
    clear.textContent = '×';
    clear.title = 'Clear role filters';
    clear.addEventListener('click', () => {
      Object.keys(R.chipState).forEach(k => delete R.chipState[k]);
      bar.querySelectorAll('.filter-chip').forEach(el => {
        el.classList.remove('active');
        el.classList.remove('excluded');
        el.setAttribute('aria-pressed', 'false');
      });
      syncClearVisibility();
      if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
        App.renderUnitRosterWithContext();
      }
    });
    bar.appendChild(clear);
    // Insert chip bar after the search input (still within .panel-controls).
    controls.appendChild(bar);
    syncClearVisibility();
    return bar;
  }

  function syncClearVisibility() {
    const bar = document.getElementById('roster-filter-chips');
    if (!bar) return;
    const clear = bar.querySelector('.filter-chips-clear');
    if (!clear) return;
    clear.style.display = Object.keys(R.chipState).length > 0 ? '' : 'none';
  }

  // Register a single chip predicate on App.hooks.rosterFilters (dedupe-safe).
  function ensureChipPredicate() {
    if (R._chipPredicateRegistered) return;
    if (!(window.App && App.hooks && Array.isArray(App.hooks.rosterFilters))) return;
    const pred = function chipFilterPredicate(unit) {
      const keys = Object.keys(R.chipState);
      if (keys.length === 0) return true;
      const kws = (unit.keywords || []).map(k => k.toLowerCase());
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const state = R.chipState[k];
        const has = kws.indexOf(k) !== -1;
        if (state === 'include' && !has) return false;
        if (state === 'exclude' && has)  return false;
      }
      return true;
    };
    pred._isChipPredicate = true;
    // Defensive dedupe if a previous bootstrap already pushed one.
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isChipPredicate);
    App.hooks.rosterFilters.push(pred);
    R._chipPredicateRegistered = true;
  }

  UI.renderUnitRoster = function (units, searchTerm, factionFilter, selectedUnitId, linkedFactions = []) {
    ensureChipBar();
    ensureChipPredicate();

    // Bump a per-render filter-pass id BEFORE any rosterFilters run. Dedupe
    // predicates (reserves.js) key their seen-set to this so each render gets
    // a fresh set — robust to two renders firing in the same synchronous tick
    // (boot cascade, renderUnitRosterWithContext → fireSelectionChange), which
    // a microtask-based reset could not distinguish and which made owned units
    // flash in then vanish until an unrelated later render.
    if (window.App) App._rosterFilterPass = (App._rosterFilterPass || 0) + 1;

    const grid  = document.getElementById('unit-grid');
    const badge = document.getElementById('unit-count-badge');
    const empty = document.getElementById('roster-empty');

    // Compute a signature of every input that actually changes which
    // units are shown. selectedUnitId is intentionally EXCLUDED — it
    // only affects card highlighting, never the filtered set. armyChange
    // hooks (autosave + sync notifications) re-call this function with
    // the same filter args after every army edit; without the signature
    // check below the unconditional `scrollTop = 0` at the end would
    // snap the user to the top of the roster every time they added a
    // unit, hovered something that touched state, or sync pulled in
    // the background — including mid-scroll, which is what surfaced
    // the "units pane keeps jumping to the top" bug.
    const chipSig = Object.keys(R.chipState).sort().map(k => k + ':' + R.chipState[k]).join(',');
    const filterSig = JSON.stringify({
      s: searchTerm || '',
      f: factionFilter || '',
      l: (linkedFactions || []).slice().sort(),
      c: chipSig,
      n: (units && units.length) || 0,
    });
    const filterChanged = filterSig !== R.lastFilterSig;
    R.lastFilterSig = filterSig;

    let filtered = units || [];
    if (factionFilter && factionFilter !== 'all') {
      filtered = filtered.filter(u =>
        u._factionName === factionFilter || linkedFactions.includes(u._factionName)
      );
    }
    if (searchTerm) {
      let tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
      // Drop points-comparator tokens (e.g. "<=200", "≥100") — they're owned
      // by the points filter hook, not by name/keyword matching.
      const ptsRe = window.App && App.PointsFilter && App.PointsFilter.TOKEN_RE;
      if (ptsRe) tokens = tokens.filter(t => !ptsRe.test(t));
      if (tokens.length > 0) filtered = filtered.filter(u => fuzzyMatch(u, tokens));
    }

    // Hook-registered extra filters (e.g. role/keyword chips).
    const extraFilters = (window.App && App.hooks && App.hooks.rosterFilters) || [];
    if (extraFilters.length > 0) {
      filtered = filtered.filter(u => extraFilters.every(fn => {
        try { return fn(u); } catch (_) { return true; }
      }));
    }

    // Sort: group by faction name, then alphabetically by unit name within
    // each faction. `.slice()` so we never mutate the caller's array
    // (state.allUnits). Locale-aware, case-insensitive.
    filtered = filtered.slice().sort((a, b) => {
      const fa = (a && a._factionName) || '';
      const fb = (b && b._factionName) || '';
      if (fa !== fb) return fa.localeCompare(fb, undefined, { sensitivity: 'base' });
      const na = (a && a.name) || '';
      const nb = (b && b.name) || '';
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });

    badge.textContent = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;

    // Clear old cards but preserve #roster-empty (a static child of the grid).
    [...grid.querySelectorAll('.unit-card')].forEach(c => c.remove());

    R.filtered   = filtered;
    R.rendered   = 0;
    R.selectedId = selectedUnitId || null;
    // When a specific faction/chapter is selected, suppress the faction line
    // on cards — it would just repeat the filter.
    R.hideFaction = !!(factionFilter && factionFilter !== 'all');

    if (filtered.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    // Reset scroll on filter change so the user sees the top of the new
    // set. Skip the reset when the filter hasn't actually changed (army
    // edits, autosave, sync pulls all hit this code path with the same
    // filter args) so mid-scroll re-renders don't yank the user back to
    // the top.
    const sc = getScrollContainer(grid);
    const savedScrollTop = (!filterChanged && sc) ? sc.scrollTop : 0;
    if (filterChanged && sc) sc.scrollTop = 0;

    appendBatch(grid, INITIAL_PAGE);
    // Same-filter re-render: keep appending batches until the rendered
    // content is tall enough to cover where the user was scrolled to.
    // Otherwise INITIAL_PAGE cards alone wouldn't reach the user's
    // cached scrollTop and the browser would clamp them to the bottom
    // of the (short) new grid — surfacing as "the roster jumped" on
    // any user scrolled past page 1. Cap iterations defensively so we
    // can't spin forever if scrollHeight stops growing.
    if (!filterChanged && sc && savedScrollTop > 0) {
      const targetBottom = savedScrollTop + sc.clientHeight;
      let guard = 0;
      while (R.rendered < R.filtered.length &&
             sc.scrollHeight < targetBottom &&
             guard < 20) {
        appendBatch(grid, APPEND_PAGE);
        guard++;
      }
      const max = sc.scrollHeight - sc.clientHeight;
      sc.scrollTop = Math.min(savedScrollTop, Math.max(0, max));
    }
    ensureScrollListener(grid);
  };
})();
