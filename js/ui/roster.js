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
  };

  UI.renderStatCell = function (label, value) {
    return `<div class="stat-cell"><span class="stat-name">${label}</span><span class="stat-value">${UI.escapeHtml(String(value))}</span></div>`;
  };

  UI.createUnitCard = function (unit, isSelected) {
    const esc = UI.escapeHtml;
    const card = document.createElement('div');
    card.className = 'unit-card' + (isSelected ? ' selected' : '');
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

    card.innerHTML = `
      <div class="unit-card-header">
        <div class="unit-card-name">${esc(unit.name)}</div>
        <div class="unit-card-pts">${ptsDisplay}</div>
      </div>
      <div class="unit-card-faction">${esc(unit._factionName || '')}</div>
      <div class="unit-card-stats" style="grid-template-columns:repeat(${cardStats.length || 6},1fr)">
        ${cardStats.length > 0 ? cardStats.map(k => UI.renderStatCell(k, resolvedStats[k])).join('') : UI.renderStatCell('—','—')}</div>
      ${keywords.length > 0 ? `<div class="unit-card-keywords">${
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
      frag.appendChild(UI.createUnitCard(unit, unit.id === R.selectedId));
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

  UI.renderUnitRoster = function (units, searchTerm, factionFilter, selectedUnitId, linkedFactions = []) {
    const grid  = document.getElementById('unit-grid');
    const badge = document.getElementById('unit-count-badge');
    const empty = document.getElementById('roster-empty');

    let filtered = units || [];
    if (factionFilter && factionFilter !== 'all') {
      filtered = filtered.filter(u =>
        u._factionName === factionFilter || linkedFactions.includes(u._factionName)
      );
    }
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(s) ||
        (u.keywords || []).some(k => k.toLowerCase().includes(s)) ||
        (u._factionName || '').toLowerCase().includes(s)
      );
    }

    badge.textContent = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;

    // Clear old cards but preserve #roster-empty (a static child of the grid).
    [...grid.querySelectorAll('.unit-card')].forEach(c => c.remove());

    R.filtered   = filtered;
    R.rendered   = 0;
    R.selectedId = selectedUnitId || null;

    if (filtered.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    // Reset scroll on filter change so the user sees the top of the new set.
    const sc = getScrollContainer(grid);
    if (sc) sc.scrollTop = 0;

    appendBatch(grid, INITIAL_PAGE);
    ensureScrollListener(grid);
  };
})();
