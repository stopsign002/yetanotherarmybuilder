// app/stratagems.js — Stratagem Browser modal: detachment + faction + core stratagems.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MODAL_ID = 'yaab-stratagems-modal';
  const BTN_ID   = 'yaab-btn-stratagems';
  const MATCH_LS_KEY = 'yaab_match_state';

  const PHASES = ['All', 'Command', 'Movement', 'Shooting', 'Charge', 'Fight', 'Any'];

  // ── Hardcoded core 10e stratagems (rulebook, every army) ────────────────
  // Original short descriptions — these are the well-known core strats.
  const CORE_STRATAGEMS = [
    {
      name: 'Command Re-roll',
      description: 'Use this Stratagem in any phase, just after you have made a Hit roll, a Wound roll, a Damage roll, a saving throw, an Advance roll, a Charge roll, a Battle-shock test or a roll to determine the number of attacks made with a weapon, for a unit from your army. Re-roll that roll.',
      cp: 1,
      phase: 'Any',
      type: 'core',
    },
    {
      name: 'Counter-Offensive',
      description: 'Use this Stratagem in your opponent’s Fight phase, just after an enemy unit has fought. Select one unit from your army that is within Engagement Range of one or more enemy units; that unit fights next.',
      cp: 2,
      phase: 'Fight',
      type: 'core',
    },
    {
      name: 'Tank Shock',
      description: 'Use this Stratagem in your Charge phase, after a Vehicle unit from your army ends a Charge move. Select one enemy unit within Engagement Range of that Vehicle and roll a number of D6 equal to that Vehicle’s Toughness. For each 5+, the enemy unit takes 1 mortal wound (to a maximum of 6).',
      cp: 1,
      phase: 'Charge',
      type: 'core',
    },
    {
      name: 'Heroic Intervention',
      description: 'Use this Stratagem in your opponent’s Charge phase, just after an enemy unit ends a Charge move. Select one Character unit from your army within 6" of that enemy unit and not within Engagement Range of any enemy units. That Character can move up to 6" in any direction, ignoring vertical distance, but must end the move within Engagement Range of that enemy unit.',
      cp: 2,
      phase: 'Charge',
      type: 'core',
    },
    {
      name: 'Insane Bravery',
      description: 'Use this Stratagem in any phase, just before taking a Battle-shock test for a unit from your army. That test is automatically passed. You can only use this Stratagem once per battle.',
      cp: 1,
      phase: 'Any',
      type: 'core',
    },
    {
      name: 'Go to Ground',
      description: 'Use this Stratagem in your opponent’s Shooting phase, just after an enemy unit has selected its targets. Select one Infantry unit from your army that was selected as a target. Until the end of the phase, all models in that unit have a 6+ invulnerable save and the Benefit of Cover, but the unit can only make Normal moves until the end of your next turn.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Smokescreen',
      description: 'Use this Stratagem in your opponent’s Shooting phase, just after an enemy unit has selected its targets. Select one unit from your army with the Smoke keyword that was selected as a target. Until the end of the phase, each time a ranged attack targets that unit, subtract 1 from the Hit roll and the target has the Benefit of Cover.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Fire Overwatch',
      description: 'Use this Stratagem in your opponent’s Movement or Charge phase, when an enemy unit is declared as moving, deploying or charging within 24" of and visible to a unit from your army. Until the end of the phase, that friendly unit can shoot the enemy unit as if it were your Shooting phase, but an unmodified Hit roll of 6 is required to score a hit, regardless of weapon Ballistic Skill.',
      cp: 1,
      phase: 'Movement',
      type: 'core',
    },
  ];

  // ── State ────────────────────────────────────────────────────────────────

  let modalEl = null;
  let listEl = null;
  let filterChipsEl = null;
  let searchEl = null;
  let lastFocused = null;
  let activePhase = 'All';
  let activeQuery = '';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function esc(s) {
    if (window.UI && UI.escapeHtml) return UI.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function toast(msg, kind, ms) {
    if (window.UI && UI.toast) UI.toast(msg, kind || 'info', ms || 2200);
  }

  function getCurrentFaction() {
    if (typeof App.getDetachmentFaction === 'function') {
      const f = App.getDetachmentFaction();
      if (f) return f;
    }
    if (typeof App.getCurrentFaction === 'function') {
      return App.getCurrentFaction() || null;
    }
    return null;
  }

  function gatherStratagems() {
    const state = App.state || {};
    const faction = getCurrentFaction();
    const det = state.selectedDetachment;

    // Detachment strats: BSData first (rare), then GDC layer.
    const detList = [];
    if (det && Array.isArray(det.stratagems))    det.stratagems.forEach(s => detList.push(s));
    if (det && Array.isArray(det.gdcStratagems)) det.gdcStratagems.forEach(s => detList.push(s));

    // Faction-wide strats: BSData first, then GDC.
    const factionList = [];
    if (faction && Array.isArray(faction.factionStratagems))     faction.factionStratagems.forEach(s => factionList.push(s));
    if (faction && Array.isArray(faction.gdcFactionStratagems))  faction.gdcFactionStratagems.forEach(s => factionList.push(s));

    const coreList = CORE_STRATAGEMS.slice();

    return {
      detachmentName: det ? det.name : null,
      factionName: faction ? faction.factionName : null,
      detachment: detList,
      faction: factionList,
      core: coreList,
    };
  }

  function passesFilters(strat) {
    if (activePhase !== 'All' && strat.phase !== activePhase) return false;
    if (activeQuery) {
      const q = activeQuery.toLowerCase();
      const hay = (strat.name + ' ' + strat.description).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  // ── Match-mode integration ───────────────────────────────────────────────

  function tryDeductCp(cost) {
    let raw = null;
    try { raw = localStorage.getItem(MATCH_LS_KEY); } catch (_) { raw = null; }
    if (!raw) return false;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { return false; }
    if (!obj || typeof obj.cp !== 'number') return false;
    // Match-mode is "active" when a turn has begun.
    if (!obj.turn || obj.turn < 1) return false;
    obj.cp = Math.max(0, obj.cp - cost);
    try { localStorage.setItem(MATCH_LS_KEY, JSON.stringify(obj)); } catch (_) { return false; }
    return true;
  }

  function onUseStratagem(name, cost) {
    if (tryDeductCp(cost)) {
      toast(`Used "${name}" — ${cost} CP deducted from match tracker.`, 'success', 2400);
    } else {
      toast(`${cost} CP used (Match mode not active).`, 'info', 2200);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function cardHtml(strat) {
    const phase = strat.phase || 'Any';
    const cost = (strat.cp == null) ? 1 : strat.cp;
    return ''
      + '<div class="strat-card" data-strat-phase="' + esc(phase) + '">'
      +   '<div class="strat-card-head">'
      +     '<div class="strat-name">' + esc(strat.name) + '</div>'
      +     '<div class="strat-cp" title="Command points">' + cost + ' CP</div>'
      +   '</div>'
      +   '<div class="strat-tags">'
      +     '<span class="strat-tag strat-tag-phase">' + esc(phase) + '</span>'
      +     '<span class="strat-tag strat-tag-type">' + esc(strat.type || 'core') + '</span>'
      +   '</div>'
      +   '<div class="strat-desc">' + esc(strat.description) + '</div>'
      +   '<div class="strat-foot">'
      +     '<button type="button" class="strat-use" '
      +       'data-strat-use="' + esc(strat.name) + '" '
      +       'data-strat-cp="' + cost + '">Use</button>'
      +   '</div>'
      + '</div>';
  }

  function sectionHtml(title, items, emptyHint) {
    let body;
    const filtered = items.filter(passesFilters);
    if (!items.length) {
      body = '<div class="strat-empty">' + esc(emptyHint || 'None available.') + '</div>';
    } else if (!filtered.length) {
      body = '<div class="strat-empty">No stratagems match the current filter.</div>';
    } else {
      body = '<div class="strat-grid">' + filtered.map(cardHtml).join('') + '</div>';
    }
    return ''
      + '<section class="strat-section">'
      +   '<h4 class="strat-section-title">' + esc(title)
      +     ' <span class="strat-section-count">(' + items.length + ')</span></h4>'
      +   body
      + '</section>';
  }

  function renderBody() {
    if (!listEl) return;
    const groups = gatherStratagems();
    const detTitle = groups.detachmentName
      ? 'Detachment: ' + groups.detachmentName
      : 'Detachment Stratagems';
    const factionTitle = groups.factionName
      ? 'Faction: ' + groups.factionName
      : 'Faction Stratagems';

    const detHint = groups.detachmentName
      ? 'No detachment-specific stratagems were extracted from BSData for this detachment. Use the Core list and your published rulebook.'
      : 'Select a detachment to see its stratagems.';
    const factionHint = 'No faction-wide stratagems were extracted from BSData. Use the Core list and your published rulebook.';

    listEl.innerHTML = ''
      + sectionHtml(detTitle, groups.detachment, detHint)
      + sectionHtml(factionTitle, groups.faction, factionHint)
      + sectionHtml('Core Stratagems', groups.core, 'No core stratagems available.');
  }

  function renderFilterChips() {
    if (!filterChipsEl) return;
    filterChipsEl.innerHTML = PHASES.map(p =>
      '<button type="button" class="strat-chip' + (p === activePhase ? ' is-on' : '') + '" '
      + 'data-strat-chip="' + esc(p) + '">' + esc(p) + '</button>'
    ).join('');
  }

  // ── Modal scaffold ───────────────────────────────────────────────────────

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'strat-backdrop';
    modalEl.id = MODAL_ID;
    modalEl.setAttribute('hidden', '');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Stratagem browser');

    modalEl.innerHTML = ''
      + '<div class="strat-modal" role="document">'
      +   '<header class="strat-head">'
      +     '<h3 class="strat-title">Stratagems</h3>'
      +     '<button type="button" class="strat-close" aria-label="Close">&times;</button>'
      +   '</header>'
      +   '<div class="strat-controls">'
      +     '<input type="text" class="strat-search" placeholder="Search stratagems…" aria-label="Search stratagems" />'
      +     '<div class="strat-chips" role="tablist" aria-label="Filter by phase"></div>'
      +   '</div>'
      +   '<div class="strat-list" id="yaab-strat-list"></div>'
      + '</div>';

    document.body.appendChild(modalEl);
    listEl = modalEl.querySelector('#yaab-strat-list');
    filterChipsEl = modalEl.querySelector('.strat-chips');
    searchEl = modalEl.querySelector('.strat-search');

    // Close on backdrop click.
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });
    modalEl.querySelector('.strat-close').addEventListener('click', close);

    // Filter chip clicks.
    filterChipsEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest('[data-strat-chip]');
      if (!btn) return;
      activePhase = btn.getAttribute('data-strat-chip') || 'All';
      renderFilterChips();
      renderBody();
    });

    // Search input.
    searchEl.addEventListener('input', () => {
      activeQuery = (searchEl.value || '').trim();
      renderBody();
    });

    // Use-button delegation.
    listEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest('[data-strat-use]');
      if (!btn) return;
      const name = btn.getAttribute('data-strat-use') || '';
      const cp = parseInt(btn.getAttribute('data-strat-cp') || '1', 10) || 1;
      onUseStratagem(name, cp);
    });

    return modalEl;
  }

  function open() {
    ensureModal();
    activePhase = 'All';
    activeQuery = '';
    if (searchEl) searchEl.value = '';
    renderFilterChips();
    renderBody();
    if (modalEl.hasAttribute('hidden')) {
      lastFocused = document.activeElement;
      modalEl.removeAttribute('hidden');
      document.body.classList.add('strat-modal-open');
      document.addEventListener('keydown', onKeydown, true);
      const closeBtn = modalEl.querySelector('.strat-close');
      if (closeBtn) { try { closeBtn.focus(); } catch (_) {} }
    }
  }

  function close() {
    if (!modalEl || modalEl.hasAttribute('hidden')) return;
    modalEl.setAttribute('hidden', '');
    document.body.classList.remove('strat-modal-open');
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) {}
    }
    lastFocused = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  // ── Public + hook registration ───────────────────────────────────────────

  App.openStratagems = open;
  // Expose the core list so other UI surfaces (e.g. the inline strategems
  // subsection in the Army-rules panel) can render it without duplicating
  // the data.
  App.CORE_STRATAGEMS = CORE_STRATAGEMS;

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'primary',
    label: 'Stratagems',
    category: 'game',
    title: 'Browse stratagems for your detachment',
    onClick: open,
  });
})();
