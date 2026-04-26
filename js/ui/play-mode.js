// ui/play-mode.js — game-day cockpit: 5 sub-tabs (match/strats/calc/opponent/deploy) + quick stratagems drawer.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};

  const ROOT_ID        = 'play-mode';
  const TAB_LS_KEY     = 'yaab_play_tab';
  const MATCH_LS_KEY   = 'yaab_match_state';
  const VALID_TABS     = ['match', 'stratagems', 'calc', 'opponent', 'deploy'];
  const DEFAULT_TAB    = 'match';

  // Cockpit state
  let rootEl = null;
  let bodyEl = null;
  let heroEl = null;
  let tabsNavEl = null;
  let drawerEl = null;
  const tabPanels = {};       // tab id -> panel element
  const tabBuilt  = {};       // tab id -> bool (was content built)
  let activeTab = null;
  let drawerCollapsed = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function readTabPref() {
    try {
      const v = localStorage.getItem(TAB_LS_KEY);
      if (v && VALID_TABS.indexOf(v) !== -1) return v;
    } catch (_) {}
    return DEFAULT_TAB;
  }

  function writeTabPref(t) {
    try { localStorage.setItem(TAB_LS_KEY, t); } catch (_) {}
  }

  function readMatchState() {
    try {
      const raw = localStorage.getItem(MATCH_LS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch (_) { return null; }
  }

  function writeMatchState(obj) {
    try { localStorage.setItem(MATCH_LS_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  function currentArmy() {
    return (App.state && App.state.currentArmy) || null;
  }

  function currentFaction() {
    if (typeof App.getDetachmentFaction === 'function') {
      const f = App.getDetachmentFaction();
      if (f) return f;
    }
    if (App.state && App.state.detachmentFaction) return App.state.detachmentFaction;
    return null;
  }

  function currentDetachment() {
    return (App.state && App.state.selectedDetachment) || null;
  }

  function isMatchActive() {
    const m = readMatchState();
    return !!(m && typeof m.turn === 'number' && m.turn >= 1);
  }

  function clickToolbarBtn(id) {
    const btn = document.getElementById(id);
    if (btn && typeof btn.click === 'function') { btn.click(); return true; }
    return false;
  }

  function toast(msg, kind, ms) {
    if (UI && UI.toast) UI.toast(msg, kind || 'info', ms || 2200);
  }

  // ── Mount root scaffold ──────────────────────────────────────────────────

  function mount() {
    rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return false;
    if (rootEl.dataset.playMounted === '1') return true;

    // Wipe any placeholder content so we own the inside.
    rootEl.innerHTML = '';
    rootEl.classList.add('play-root');

    rootEl.innerHTML = ''
      + '<div class="play-shell">'
      +   '<header class="play-hero" id="play-hero"></header>'
      +   '<nav class="play-tabs" role="tablist" aria-label="Game-day sections" id="play-tabs"></nav>'
      +   '<div class="play-body" id="play-body"></div>'
      +   '<aside class="play-drawer" id="play-drawer" aria-label="Quick stratagems"></aside>'
      + '</div>';

    heroEl    = rootEl.querySelector('#play-hero');
    tabsNavEl = rootEl.querySelector('#play-tabs');
    bodyEl    = rootEl.querySelector('#play-body');
    drawerEl  = rootEl.querySelector('#play-drawer');

    buildTabsNav();
    buildPanelStubs();
    activeTab = readTabPref();
    activateTab(activeTab, /*persist*/ false);
    renderHero();
    renderDrawer();

    // Refresh hero/drawer when army or selection changes
    if (App.hooks) {
      try { App.hooks.armyChange.push(onArmyChange); } catch (_) {}
      try { App.hooks.selectionChange.push(onSelectionChange); } catch (_) {}
    }

    rootEl.dataset.playMounted = '1';
    return true;
  }

  // ── Tabs nav ─────────────────────────────────────────────────────────────

  const TAB_DEFS = [
    { id: 'match',      label: 'Match'      },
    { id: 'stratagems', label: 'Stratagems' },
    { id: 'calc',       label: 'Calc'       },
    { id: 'opponent',   label: 'Opponent'   },
    { id: 'deploy',     label: 'Deploy'     },
  ];

  function buildTabsNav() {
    tabsNavEl.innerHTML = ''
      + '<div class="play-tabs-title">GAME DAY</div>'
      + '<div class="play-tabs-strip" role="tablist">'
      +   TAB_DEFS.map(t =>
            '<button type="button" class="play-tab" '
            + 'role="tab" data-play-tab="' + esc(t.id) + '" '
            + 'aria-selected="false" aria-controls="play-panel-' + esc(t.id) + '">'
            + esc(t.label)
            + '</button>'
          ).join('')
      + '</div>';

    tabsNavEl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-tab]');
      if (!btn) return;
      activateTab(btn.dataset.playTab, true);
    });
  }

  function buildPanelStubs() {
    bodyEl.innerHTML = TAB_DEFS.map(t =>
      '<section class="play-panel" id="play-panel-' + esc(t.id) + '" '
      + 'data-play-panel="' + esc(t.id) + '" role="tabpanel" hidden></section>'
    ).join('');
    TAB_DEFS.forEach(t => {
      tabPanels[t.id] = bodyEl.querySelector('#play-panel-' + t.id);
      tabBuilt[t.id] = false;
    });
  }

  function activateTab(id, persist) {
    if (VALID_TABS.indexOf(id) === -1) id = DEFAULT_TAB;
    activeTab = id;
    if (persist) writeTabPref(id);

    Array.prototype.forEach.call(tabsNavEl.querySelectorAll('[data-play-tab]'), btn => {
      const on = btn.dataset.playTab === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    TAB_DEFS.forEach(t => {
      const pnl = tabPanels[t.id];
      if (!pnl) return;
      if (t.id === id) {
        if (!tabBuilt[t.id]) {
          buildTabContent(t.id, pnl);
          tabBuilt[t.id] = true;
        } else {
          // Refresh dynamic bits on re-show
          refreshTabContent(t.id, pnl);
        }
        pnl.removeAttribute('hidden');
      } else {
        pnl.setAttribute('hidden', '');
      }
    });
  }

  // ── Hero (top of cockpit) ────────────────────────────────────────────────

  function renderHero() {
    if (!heroEl) return;
    const army = currentArmy();
    const det  = currentDetachment();
    const faction = currentFaction();
    const detName = det ? det.name : null;
    const factionName = (faction && faction.factionName)
      || (army && army.factionName)
      || null;
    let total = 0;
    try { if (army && typeof army.getTotalPoints === 'function') total = army.getTotalPoints(); } catch (_) { total = 0; }
    const limit = (army && army.pointsLimit) || 2000;
    const armyName = (army && army.name) || 'Untitled Army';

    const bits = [];
    if (factionName) bits.push(esc(factionName));
    if (detName) bits.push(esc(detName));
    bits.push(esc(total + ' / ' + limit));
    const sub = bits.join(' &middot; ');

    heroEl.innerHTML = ''
      + '<div class="play-hero-title">GAME DAY</div>'
      + '<div class="play-hero-meta">'
      +   '<span class="play-hero-army">' + esc(armyName) + '</span>'
      +   (sub ? ('<span class="play-hero-sub">' + sub + '</span>') : '')
      + '</div>';
  }

  // ── Tab content builders ─────────────────────────────────────────────────

  function buildTabContent(id, pnl) {
    switch (id) {
      case 'match':       buildMatchTab(pnl); break;
      case 'stratagems':  buildStratagemsTab(pnl); break;
      case 'calc':        buildCalcTab(pnl); break;
      case 'opponent':    buildOpponentTab(pnl); break;
      case 'deploy':      buildDeployTab(pnl); break;
    }
  }

  function refreshTabContent(id, pnl) {
    if (id === 'match') renderMatchSummary();
    if (id === 'opponent') renderOpponentStatus();
  }

  // ── Empty-state helper ───────────────────────────────────────────────────

  function emptyArmyPanel(message) {
    return ''
      + '<div class="play-empty">'
      +   '<h3>Build an army first</h3>'
      +   '<p>' + esc(message || 'Switch to BUILD mode to create or load an army before stepping into Game Day.') + '</p>'
      +   '<button type="button" class="play-btn play-btn-primary" data-play-act="goto-build">Go to Build mode</button>'
      + '</div>';
  }

  function bindGotoBuild(scope) {
    scope.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act="goto-build"]');
      if (!btn) return;
      if (typeof App.setMode === 'function') App.setMode('build');
      else {
        const tab = document.getElementById('topbar-mode-build');
        if (tab) tab.click();
      }
    });
  }

  // ── Match tab ────────────────────────────────────────────────────────────

  function buildMatchTab(pnl) {
    pnl.innerHTML = ''
      + '<div class="play-section play-match-section">'
      +   '<div class="play-section-head">'
      +     '<h3>Match Tracker</h3>'
      +     '<div class="play-section-actions">'
      +       '<button type="button" class="play-btn play-btn-primary" data-play-act="open-match">Open match overlay</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="play-match-summary" id="play-match-summary"></div>'
      +   '<p class="play-help">'
      +     'The full match cockpit (CP, turn, phase, VP, per-unit wounds) opens as a focused overlay. '
      +     'It saves automatically — close it any time to return to this tab.'
      +   '</p>'
      + '</div>';

    pnl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act]');
      if (!btn) return;
      const act = btn.dataset.playAct;
      if (act === 'open-match') {
        if (typeof App.openMatchMode === 'function') App.openMatchMode();
        else clickToolbarBtn('yaab-btn-match');
      } else if (act === 'reset-match') {
        if (confirm('Discard the active match tracker?')) {
          try { localStorage.removeItem(MATCH_LS_KEY); } catch (_) {}
          renderMatchSummary();
          renderDrawer();
        }
      }
    });

    bindGotoBuild(pnl);
    renderMatchSummary();
  }

  function cpDots(cp, max) {
    const total = Math.max(10, max || 10);
    const filled = Math.max(0, Math.min(total, cp || 0));
    let out = '';
    for (let i = 0; i < total; i++) {
      out += '<span class="play-cp-dot' + (i < filled ? ' is-on' : '') + '" aria-hidden="true"></span>';
    }
    return out;
  }

  function renderMatchSummary() {
    const el = rootEl && rootEl.querySelector('#play-match-summary');
    if (!el) return;
    const army = currentArmy();
    const m = readMatchState();

    if (!army || !Array.isArray(army.entries) || !army.entries.length) {
      el.innerHTML = emptyArmyPanel('Add at least one unit to your army before starting a match.');
      return;
    }

    if (!m || !m.turn || m.turn < 1) {
      el.innerHTML = ''
        + '<div class="play-cta">'
        +   '<div class="play-cta-icon" aria-hidden="true">&#9876;</div>'
        +   '<h4>No active match</h4>'
        +   '<p>Start a Match to track CP, turns, phases, victory points, and wounds.</p>'
        +   '<button type="button" class="play-btn play-btn-primary" data-play-act="open-match">Start a Match</button>'
        + '</div>';
      return;
    }

    const PHASES = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight', 'Morale'];
    const phaseName = PHASES[m.phase] || 'Command';
    const turnText  = (m.turn > 5) ? 'Game over' : ('Turn ' + m.turn + ' of 5');
    const cp        = (typeof m.cp === 'number') ? m.cp : 0;
    const youVP     = (m.vp && typeof m.vp.you === 'number') ? m.vp.you : 0;
    const oppVP     = (m.vp && typeof m.vp.opp === 'number') ? m.vp.opp : 0;
    const secYou    = Array.isArray(m.secondaries) ? m.secondaries.reduce((s, x) => s + (x.you || 0), 0) : 0;
    const secOpp    = Array.isArray(m.secondaries) ? m.secondaries.reduce((s, x) => s + (x.opp || 0), 0) : 0;
    const totalYou  = youVP + secYou;
    const totalOpp  = oppVP + secOpp;

    // Wound summary
    let modelsAlive = 0, modelsTotal = 0;
    const wbei = m.woundsByEntryIndex || {};
    army.entries.forEach((entry, idx) => {
      const arr = wbei[idx];
      if (Array.isArray(arr) && arr.length) {
        modelsTotal += arr.length;
        modelsAlive += arr.filter(v => (v || 0) > 0).length;
      } else {
        const opts = (entry.unitData && entry.unitData.squadOptions) || [];
        let mps = 1;
        if (opts.length) {
          const chosen = opts.find(o => o.pts === entry.selectedPts) || opts[0];
          mps = (chosen && chosen.models) || 1;
        }
        const total = (entry.count || 1) * mps;
        modelsTotal += total;
        modelsAlive += total;
      }
    });

    el.innerHTML = ''
      + '<div class="play-match-grid">'
      +   '<div class="play-match-cp">'
      +     '<div class="play-match-label">CP</div>'
      +     '<div class="play-match-cp-row">'
      +       '<div class="play-match-cp-val">' + cp + '</div>'
      +       '<div class="play-match-cp-dots">' + cpDots(cp, 10) + '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="play-match-turn">'
      +     '<div class="play-match-label">Turn</div>'
      +     '<div class="play-match-turn-val">' + esc(turnText) + '</div>'
      +     '<div class="play-match-phase">' + esc(phaseName) + ' phase</div>'
      +   '</div>'
      +   '<div class="play-match-vp">'
      +     '<div class="play-match-label">Score</div>'
      +     '<div class="play-match-vp-row">'
      +       '<span class="play-match-vp-you">You ' + totalYou + '</span>'
      +       '<span class="play-match-vp-sep">|</span>'
      +       '<span class="play-match-vp-opp">Opp ' + totalOpp + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div class="play-match-wounds">'
      +     '<div class="play-match-label">Models alive</div>'
      +     '<div class="play-match-wounds-val">' + modelsAlive + ' / ' + modelsTotal + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="play-match-actions">'
      +   '<button type="button" class="play-btn play-btn-primary" data-play-act="open-match">Open match overlay</button>'
      +   '<button type="button" class="play-btn play-btn-ghost" data-play-act="reset-match">Reset match</button>'
      + '</div>';
  }

  // ── Stratagems tab ───────────────────────────────────────────────────────

  function buildStratagemsTab(pnl) {
    pnl.innerHTML = ''
      + '<div class="play-section">'
      +   '<div class="play-section-head"><h3>Stratagems</h3></div>'
      +   '<p class="play-help">Browse the full stratagem library — your detachment, faction, and 10e core stratagems — with phase filters and search.</p>'
      +   '<div class="play-section-actions">'
      +     '<button type="button" class="play-btn play-btn-primary" data-play-act="open-strats">Open Stratagems</button>'
      +   '</div>'
      +   '<p class="play-hint-quiet">The Quick Stratagems drawer at the bottom keeps your detachment’s strats one click away during a match.</p>'
      + '</div>';
    pnl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act="open-strats"]');
      if (!btn) return;
      if (typeof App.openStratagems === 'function') App.openStratagems();
      else clickToolbarBtn('yaab-btn-stratagems');
    });
  }

  // ── Calc tab ─────────────────────────────────────────────────────────────

  function buildCalcTab(pnl) {
    pnl.innerHTML = ''
      + '<div class="play-section">'
      +   '<div class="play-section-head"><h3>Damage Calculator</h3></div>'
      +   '<p class="play-help">Simulate a 10e attack: hit, wound, save, and damage rolls. Uses your loaded army’s weapons.</p>'
      +   '<div class="play-section-actions">'
      +     '<button type="button" class="play-btn play-btn-primary" data-play-act="open-calc">Open Calc</button>'
      +   '</div>'
      + '</div>';
    pnl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act="open-calc"]');
      if (!btn) return;
      if (UI && typeof UI.openDamageCalc === 'function') UI.openDamageCalc();
      else if (App && typeof App.openDamageCalc === 'function') App.openDamageCalc();
      else clickToolbarBtn('yaab-btn-dmgcalc');
    });
  }

  // ── Opponent tab ─────────────────────────────────────────────────────────

  function buildOpponentTab(pnl) {
    pnl.innerHTML = ''
      + '<div class="play-section">'
      +   '<div class="play-section-head"><h3>Opponent</h3></div>'
      +   '<div class="play-opponent-grid">'
      +     '<div class="play-opponent-col">'
      +       '<h4>Paste an army</h4>'
      +       '<p class="play-help">Paste your opponent’s list (YAAB1 code, BattleScribe text, or GW app export) to enable matchup analysis.</p>'
      +       '<button type="button" class="play-btn play-btn-primary" data-play-act="open-paste">Paste opponent army</button>'
      +     '</div>'
      +     '<div class="play-opponent-col">'
      +       '<h4>Matchup viewer</h4>'
      +       '<p class="play-help">Side-by-side stat strips, keyword overlap, and threat callouts.</p>'
      +       '<div class="play-opponent-status" id="play-opp-status"></div>'
      +       '<button type="button" class="play-btn" data-play-act="open-matchup">Open matchup</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    pnl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act]');
      if (!btn) return;
      const act = btn.dataset.playAct;
      if (act === 'open-paste') {
        if (typeof App.openOpponentPaste === 'function') App.openOpponentPaste();
        else clickToolbarBtn('yaab-btn-opponent');
      } else if (act === 'open-matchup') {
        if (typeof App.openMatchup === 'function') App.openMatchup();
        else clickToolbarBtn('yaab-btn-matchup');
      }
    });

    renderOpponentStatus();
  }

  function renderOpponentStatus() {
    const el = rootEl && rootEl.querySelector('#play-opp-status');
    if (!el) return;
    let opp = null;
    try {
      const raw = localStorage.getItem('yaab_opponent');
      if (raw) opp = JSON.parse(raw);
    } catch (_) { opp = null; }
    if (!opp) {
      el.innerHTML = '<div class="play-empty-mini">No opponent loaded yet.</div>';
      return;
    }
    const name = (opp && (opp.name || opp.factionName)) || 'Opponent army';
    el.innerHTML = '<div class="play-pill">Loaded: ' + esc(name) + '</div>';
  }

  // ── Deploy tab ───────────────────────────────────────────────────────────

  function buildDeployTab(pnl) {
    pnl.innerHTML = ''
      + '<div class="play-section">'
      +   '<div class="play-section-head"><h3>Deployment Planner</h3></div>'
      +   '<p class="play-help">Drag your units onto a battlefield to plan the opening turn. Saved per army.</p>'
      +   '<div class="play-section-actions">'
      +     '<button type="button" class="play-btn play-btn-primary" data-play-act="open-deploy">Open Deploy</button>'
      +   '</div>'
      + '</div>';
    pnl.addEventListener('click', e => {
      const btn = e.target && e.target.closest('[data-play-act="open-deploy"]');
      if (!btn) return;
      if (typeof App.openDeploymentPlanner === 'function') App.openDeploymentPlanner();
      else clickToolbarBtn('yaab-btn-deploy');
    });
  }

  // ── Quick Stratagems drawer (always visible at the bottom) ───────────────

  function gatherDrawerStrats() {
    const det = currentDetachment();
    const faction = currentFaction();
    const detList = (det && Array.isArray(det.stratagems)) ? det.stratagems.slice() : [];
    const factionList = (faction && Array.isArray(faction.factionStratagems)) ? faction.factionStratagems.slice() : [];

    // Augment with App.STRATAGEMS_DATA samples if available
    const sample = App.STRATAGEMS_DATA;
    if (sample) {
      if (faction && faction.factionName && sample.factions) {
        const fs = sample.factions[faction.factionName];
        if (Array.isArray(fs)) fs.forEach(s => factionList.push(Object.assign({ type: 'sample' }, s)));
      }
      if (det && det.name && sample.detachments) {
        const ds = sample.detachments[det.name];
        if (Array.isArray(ds)) ds.forEach(s => detList.push(Object.assign({ type: 'sample' }, s)));
      }
    }

    return detList.concat(factionList);
  }

  function renderDrawer() {
    if (!drawerEl) return;
    const strats = gatherDrawerStrats();
    const m = readMatchState();
    const cp = (m && typeof m.cp === 'number') ? m.cp : null;
    const cpLabel = (cp == null)
      ? '<span class="play-drawer-cp play-drawer-cp-idle">CP —</span>'
      : '<span class="play-drawer-cp"><strong>' + cp + '</strong> CP</span>';

    const collapsedCls = drawerCollapsed ? ' is-collapsed' : '';

    let body;
    if (!strats.length) {
      body = '<div class="play-drawer-empty">'
        + 'Pick a detachment in BUILD mode to populate quick stratagems here.'
        + '</div>';
    } else {
      body = '<ul class="play-drawer-list">'
        + strats.map((s, i) => {
            const cost = (s.cp == null) ? 1 : (s.cp | 0);
            const phase = s.phase || 'Any';
            return ''
              + '<li class="play-drawer-chip" data-strat-idx="' + i + '">'
              +   '<button type="button" class="play-chip-head" data-play-act="toggle-chip" data-play-idx="' + i + '" aria-expanded="false">'
              +     '<span class="play-chip-name">' + esc(s.name || 'Stratagem') + '</span>'
              +     '<span class="play-chip-cost">' + cost + ' CP</span>'
              +     '<span class="play-chip-phase">' + esc(phase) + '</span>'
              +   '</button>'
              +   '<div class="play-chip-body" hidden>'
              +     '<div class="play-chip-desc">' + esc(s.description || '') + '</div>'
              +     '<div class="play-chip-foot">'
              +       '<button type="button" class="play-chip-use" data-play-act="use-strat" data-play-idx="' + i + '" data-play-cp="' + cost + '" data-play-name="' + esc(s.name || '') + '">Use</button>'
              +     '</div>'
              +   '</div>'
              + '</li>';
          }).join('')
        + '</ul>';
    }

    drawerEl.className = 'play-drawer' + collapsedCls;
    drawerEl.innerHTML = ''
      + '<header class="play-drawer-head">'
      +   '<button type="button" class="play-drawer-toggle" data-play-act="toggle-drawer" aria-expanded="' + (drawerCollapsed ? 'false' : 'true') + '">'
      +     '<span class="play-drawer-caret" aria-hidden="true">' + (drawerCollapsed ? '▲' : '▼') + '</span>'
      +     '<span class="play-drawer-title">Quick Stratagems</span>'
      +     '<span class="play-drawer-count">' + strats.length + '</span>'
      +   '</button>'
      +   cpLabel
      + '</header>'
      + '<div class="play-drawer-body">' + body + '</div>';

    // Cache drawer-strats for click handler resolution
    drawerEl._stratCache = strats;

    if (!drawerEl._wired) {
      drawerEl.addEventListener('click', onDrawerClick);
      drawerEl._wired = true;
    }
  }

  function onDrawerClick(e) {
    const btn = e.target && e.target.closest('[data-play-act]');
    if (!btn) return;
    const act = btn.dataset.playAct;
    if (act === 'toggle-drawer') {
      drawerCollapsed = !drawerCollapsed;
      renderDrawer();
      return;
    }
    if (act === 'toggle-chip') {
      const li = btn.closest('.play-drawer-chip');
      if (!li) return;
      const body = li.querySelector('.play-chip-body');
      if (!body) return;
      const open = body.hasAttribute('hidden');
      // Close other chips for tidiness
      Array.prototype.forEach.call(drawerEl.querySelectorAll('.play-chip-body'), b => b.setAttribute('hidden', ''));
      Array.prototype.forEach.call(drawerEl.querySelectorAll('.play-chip-head'), h => h.setAttribute('aria-expanded', 'false'));
      if (open) {
        body.removeAttribute('hidden');
        const head = li.querySelector('.play-chip-head');
        if (head) head.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    if (act === 'use-strat') {
      const cost = parseInt(btn.dataset.playCp || '1', 10) || 1;
      const name = btn.dataset.playName || 'Stratagem';
      tryUseStrat(name, cost);
    }
  }

  function tryUseStrat(name, cost) {
    const m = readMatchState();
    if (!m || typeof m.cp !== 'number' || !m.turn || m.turn < 1) {
      toast(cost + ' CP used (no active match — start one to track CP).', 'info', 2400);
      return;
    }
    m.cp = Math.max(0, m.cp - cost);
    writeMatchState(m);
    toast('Used "' + name + '" — ' + cost + ' CP deducted.', 'success', 2400);
    renderDrawer();
    if (activeTab === 'match') renderMatchSummary();
  }

  // ── Hook callbacks ───────────────────────────────────────────────────────

  function onArmyChange() {
    if (!rootEl) return;
    renderHero();
    if (activeTab === 'match') renderMatchSummary();
    renderDrawer();
  }

  function onSelectionChange() {
    if (!rootEl) return;
    renderHero();
    renderDrawer();
  }

  // ── Mode-shell integration ───────────────────────────────────────────────

  // Best-effort: re-render whenever the play mode tab is shown. The shell
  // agent may dispatch a `yaab:mode-change` event or set classes — we listen
  // for both, plus the topbar mode-tab click as a final fallback.
  function onModeShown() {
    if (!rootEl) return;
    if (rootEl.hasAttribute('hidden')) return;
    renderHero();
    if (activeTab && tabBuilt[activeTab]) refreshTabContent(activeTab, tabPanels[activeTab]);
    else activateTab(activeTab || readTabPref(), false);
    renderDrawer();
  }

  function wireModeListeners() {
    document.addEventListener('yaab:mode-change', e => {
      const mode = e && e.detail && e.detail.mode;
      if (mode === 'play') onModeShown();
    });
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest && e.target.closest('[data-mode="play"]');
      if (!t) return;
      // Defer: shell may need to flip hidden first
      setTimeout(onModeShown, 0);
    });
    // MutationObserver fallback: react when our root's hidden attr flips off.
    if (rootEl && typeof MutationObserver === 'function') {
      const mo = new MutationObserver(muts => {
        for (let i = 0; i < muts.length; i++) {
          const mu = muts[i];
          if (mu.type === 'attributes' && mu.attributeName === 'hidden') {
            if (!rootEl.hasAttribute('hidden')) onModeShown();
          }
        }
      });
      mo.observe(rootEl, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  function boot() {
    if (!mount()) return;
    wireModeListeners();
    // Periodically refresh the match summary + drawer CP while on match tab —
    // match-mode overlay writes to localStorage and we want to reflect that
    // when the user returns. Lightweight: 2s tick, only while play-mode is
    // visible.
    setInterval(() => {
      if (!rootEl || rootEl.hasAttribute('hidden')) return;
      if (activeTab === 'match') renderMatchSummary();
      // Cheap CP-only refresh of the drawer
      const m = readMatchState();
      const cpEl = drawerEl && drawerEl.querySelector('.play-drawer-cp');
      if (cpEl) {
        const cp = (m && typeof m.cp === 'number') ? m.cp : null;
        if (cp == null) {
          cpEl.outerHTML = '<span class="play-drawer-cp play-drawer-cp-idle">CP —</span>';
        } else {
          cpEl.outerHTML = '<span class="play-drawer-cp"><strong>' + cp + '</strong> CP</span>';
        }
      }
    }, 2000);
  }

  // Register via bootstrap hook so the shell + state are ready.
  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(boot);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public hooks
  App.openPlayMode = function () {
    if (typeof App.setMode === 'function') {
      App.setMode('play');
    } else {
      const tab = document.getElementById('topbar-mode-play');
      if (tab) tab.click();
    }
    setTimeout(onModeShown, 0);
  };
})();
