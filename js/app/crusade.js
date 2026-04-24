// app/crusade.js — Crusade campaign tracker: persistent rosters, XP, ranks, honours, scars, battle log.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // ── persistence keys ────────────────────────────────────────────────
  const LS_ROSTERS = 'yaab_crusade_rosters';

  // ── rank progression ────────────────────────────────────────────────
  // Thresholds chosen so XP awards from typical battles produce a steady
  // climb across a 6-10 game campaign.
  const RANKS = [
    {
      key: 'Battle-ready',
      threshold: 0,
      blurb: 'Default rank. Newly inducted into the crusade — has yet to truly earn their stripes.',
    },
    {
      key: 'Blooded',
      threshold: 6,
      blurb: 'Has tasted real battle and survived. May choose one minor Battle Honour.',
    },
    {
      key: 'Battle-hardened',
      threshold: 16,
      blurb: 'Veterans of the front line. Eligible for stronger Battle Honours.',
    },
    {
      key: 'Heroic',
      threshold: 31,
      blurb: 'A storied name in the crusade. Heroes inspire those around them.',
    },
    {
      key: 'Legendary',
      threshold: 51,
      blurb: 'Whispered of in awe across the warzone. Truly elite.',
    },
  ];

  function rankForXP(xp) {
    let chosen = RANKS[0];
    for (let i = 0; i < RANKS.length; i++) {
      if (xp >= RANKS[i].threshold) chosen = RANKS[i];
    }
    return chosen.key;
  }

  function nextRankInfo(xp) {
    for (let i = 0; i < RANKS.length; i++) {
      if (xp < RANKS[i].threshold) {
        return { name: RANKS[i].key, threshold: RANKS[i].threshold };
      }
    }
    return null; // already legendary
  }

  // ── battle honours catalog ─────────────────────────────────────────
  // 18 generic, non-copyrighted honours grouped by category.
  const HONOURS = [
    // Combat
    { category: 'Combat',   name: 'Killing Blow',     description: 'Once per battle, re-roll one wound roll in melee.', pts: 5 },
    { category: 'Combat',   name: 'Duellist',         description: 'Once per battle, fight first if charged.',          pts: 10 },
    { category: 'Combat',   name: 'Marksman',         description: 'Once per battle, ignore cover with one ranged attack.', pts: 5 },
    { category: 'Combat',   name: 'Brutal Strike',    description: 'Once per battle, one melee attack has Devastating Wounds.', pts: 10 },

    // Defence
    { category: 'Defence',  name: 'Hardened',         description: '+1 to armour saves vs. ranged attacks (S5 or less).', pts: 10 },
    { category: 'Defence',  name: 'Indomitable',      description: 'Once per battle, ignore one failed Battle-shock test.', pts: 5 },
    { category: 'Defence',  name: 'Stoic',            description: 'Once per battle, one model regains a single lost wound.', pts: 5 },
    { category: 'Defence',  name: 'Bulwark',          description: '+1 Toughness while contesting an objective.',         pts: 15 },

    // Tactical
    { category: 'Tactical', name: 'Recon Specialist', description: 'Counts as a Scouting unit (Scout 6").',               pts: 10 },
    { category: 'Tactical', name: 'Coordinator',      description: 'Once per battle, gain +1 CP at the start of a turn.', pts: 15 },
    { category: 'Tactical', name: 'Veteran Strategist', description: 'Reroll one Strategic Reserves arrival roll.',       pts: 5 },
    { category: 'Tactical', name: 'Forward Observer', description: 'Once per battle, redeploy this unit before the first turn.', pts: 10 },

    // Mobility
    { category: 'Mobility', name: 'Swift',            description: '+1" to Move characteristic.',                         pts: 10 },
    { category: 'Mobility', name: 'Pathfinder',       description: 'Ignore the effects of difficult terrain on movement.', pts: 5 },
    { category: 'Mobility', name: 'Tireless',         description: 'Always counts as having Advanced for charge purposes.', pts: 10 },

    // Leadership
    { category: 'Leadership', name: 'Inspiring',      description: 'Friendly units within 6" gain +1 Leadership.',         pts: 10 },
    { category: 'Leadership', name: 'Unbroken Will',  description: 'Auto-pass first Battle-shock test of the battle.',     pts: 5 },
    { category: 'Leadership', name: 'Champion',       description: 'Once per battle, this unit may issue an additional Stratagem for free.', pts: 20 },
  ];

  // ── battle scars catalog (suggested, user may also write custom) ───
  const SCARS = [
    { name: 'Shellshocked',     description: '-1 to Battle-shock tests until next victory.' },
    { name: 'Slow on the Draw', description: '-1" to Move until next victory.' },
    { name: 'Wary',             description: '-1 to charge rolls until next victory.' },
    { name: 'Wound-poisoned',   description: '-1 to wound rolls vs. T8+ until next victory.' },
    { name: 'Trauma',           description: 'Battle-shock on 8+ until next victory.' },
  ];

  // ── XP award presets (per-unit, per-battle) ─────────────────────────
  const XP_PRESETS = [
    { key: 'participation', label: 'Participation', delta: 3,
      tip: 'Was on the table for the whole game.' },
    { key: 'survived',      label: 'Survived',      delta: 1,
      tip: 'Still on the table at the end.' },
    { key: 'killed',        label: 'Killed a unit', delta: 2,
      tip: 'Destroyed at least one enemy unit.' },
    { key: 'killed_char',   label: 'Killed a Character', delta: 3,
      tip: 'Destroyed an enemy Character unit.' },
    { key: 'objective',     label: 'Held objective', delta: 1,
      tip: 'Held a primary objective at end of any turn.' },
    { key: 'marked',        label: 'Marked for Greatness', delta: 3,
      tip: 'Player-chosen single unit each battle.' },
  ];

  // ── module state ────────────────────────────────────────────────────
  let _rosters = [];           // array of roster objects
  let _modalEl = null;          // toolbar dashboard modal
  let _view    = 'list';        // 'list' | 'detail' | 'unit' | 'battle'
  let _activeRosterId = null;
  let _activeUnitCrusadeId = null;

  // ────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────

  function htmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  function toast(msg, type, dur) {
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast(msg, type || 'info', dur || 3000);
    }
  }

  // ── persistence ─────────────────────────────────────────────────────

  function loadRosters() {
    try {
      const raw = localStorage.getItem(LS_ROSTERS);
      if (!raw) { _rosters = []; return; }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _rosters = parsed.map(normalizeRoster);
      else _rosters = [];
    } catch (_) { _rosters = []; }
  }

  function persistRosters() {
    try { localStorage.setItem(LS_ROSTERS, JSON.stringify(_rosters)); }
    catch (_) { /* quota — ignore */ }
  }

  function normalizeRoster(r) {
    if (!r || typeof r !== 'object') return null;
    return {
      id:            r.id || uid('crusade-'),
      name:          r.name || 'Untitled Crusade',
      factionName:   r.factionName || '',
      supplyLimit:   typeof r.supplyLimit === 'number' ? r.supplyLimit : 1000,
      supplyUsed:    typeof r.supplyUsed  === 'number' ? r.supplyUsed  : 0,
      crusadePoints: typeof r.crusadePoints === 'number' ? r.crusadePoints : 0,
      battlesPlayed: typeof r.battlesPlayed === 'number' ? r.battlesPlayed : 0,
      battlesWon:    typeof r.battlesWon === 'number' ? r.battlesWon : 0,
      units:         Array.isArray(r.units)   ? r.units.map(normalizeUnit) : [],
      battles:       Array.isArray(r.battles) ? r.battles : [],
      createdAt:     r.createdAt || nowIso(),
      updatedAt:     r.updatedAt || nowIso(),
    };
  }

  function normalizeUnit(u) {
    if (!u || typeof u !== 'object') return null;
    const xp = typeof u.xp === 'number' ? u.xp : 0;
    return {
      crusadeId:     u.crusadeId || uid('cu-'),
      unitId:        u.unitId || '',
      unitName:      u.unitName || '',
      label:         u.label || '',
      basePts:       typeof u.basePts    === 'number' ? u.basePts    : 0,
      currentPts:    typeof u.currentPts === 'number' ? u.currentPts : (u.basePts || 0),
      xp:            xp,
      rank:          u.rank || rankForXP(xp),
      crusadePts:    typeof u.crusadePts === 'number' ? u.crusadePts : 0,
      battlesPlayed: typeof u.battlesPlayed === 'number' ? u.battlesPlayed : 0,
      battleHonours: Array.isArray(u.battleHonours) ? u.battleHonours : [],
      battleScars:   Array.isArray(u.battleScars)   ? u.battleScars   : [],
      notes:         u.notes || '',
    };
  }

  function findRoster(id) { return _rosters.find(r => r.id === id) || null; }
  function findUnit(roster, cid) {
    if (!roster) return null;
    return roster.units.find(u => u.crusadeId === cid) || null;
  }

  // ── supply recompute (sum of unit currentPts) ───────────────────────
  function recalcSupply(roster) {
    if (!roster) return;
    let used = 0;
    for (let i = 0; i < roster.units.length; i++) {
      used += roster.units[i].currentPts || 0;
    }
    roster.supplyUsed = used;
  }

  // ── XP / rank update with toast on rank-up ─────────────────────────
  function adjustUnitXP(roster, unit, delta) {
    if (!unit) return;
    const before = unit.rank;
    unit.xp = Math.max(0, (unit.xp || 0) + delta);
    const after = rankForXP(unit.xp);
    unit.rank = after;
    if (after !== before) {
      const display = unit.label || unit.unitName || 'Unit';
      toast(display + ' is now ' + after + '.', 'success', 4500);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // modal scaffolding
  // ────────────────────────────────────────────────────────────────────

  function ensureModal() {
    if (_modalEl) return _modalEl;
    const el = document.createElement('div');
    el.className = 'modal-backdrop crusade-modal-backdrop';
    el.hidden = true;
    el.innerHTML =
      '<div class="modal crusade-modal" role="dialog" aria-label="Crusade campaign">' +
        '<div class="modal-header crusade-modal-header">' +
          '<h3 class="crusade-modal-title">Crusade</h3>' +
          '<button class="modal-close" type="button" aria-label="Close" data-crus-close>&times;</button>' +
        '</div>' +
        '<div class="modal-body crusade-modal-body"></div>' +
        '<div class="modal-footer crusade-modal-footer"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', evt => {
      if (evt.target === el) closeModal();
      const closer = evt.target.closest('[data-crus-close]');
      if (closer) closeModal();
    });
    _modalEl = el;
    return el;
  }

  function openModal() {
    ensureModal();
    _modalEl.hidden = false;
    _view = 'list';
    _activeRosterId = null;
    _activeUnitCrusadeId = null;
    renderModal();
    document.addEventListener('keydown', onKey);
  }

  function closeModal() {
    if (!_modalEl) return;
    _modalEl.hidden = true;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      // Walk back through views before closing.
      if (_view === 'unit')        { _view = 'detail';  renderModal(); }
      else if (_view === 'battle') { _view = 'detail';  renderModal(); }
      else if (_view === 'detail') { _view = 'list';    _activeRosterId = null; renderModal(); }
      else { closeModal(); }
    }
  }

  function setBody(html) {
    const body = _modalEl.querySelector('.crusade-modal-body');
    if (body) body.innerHTML = html;
  }
  function setFooter(html) {
    const ft = _modalEl.querySelector('.crusade-modal-footer');
    if (ft) ft.innerHTML = html;
  }
  function setTitle(title) {
    const t = _modalEl.querySelector('.crusade-modal-title');
    if (t) t.textContent = title;
  }

  // ────────────────────────────────────────────────────────────────────
  // VIEW: roster list (dashboard)
  // ────────────────────────────────────────────────────────────────────

  function renderList() {
    setTitle('Crusade Rosters');
    let html = '';
    html +=
      '<div class="crusade-intro">' +
        '<p>Crusade is the persistent narrative campaign mode for 10th edition. ' +
        'Each unit gains XP and earns Battle Honours across multiple games.</p>' +
      '</div>';

    if (_rosters.length === 0) {
      html +=
        '<div class="crusade-empty">' +
          '<p>No Crusade Rosters yet.</p>' +
          '<p class="muted">Click <strong>New Crusade Roster</strong> below to start one.</p>' +
        '</div>';
    } else {
      html += '<ul class="crusade-roster-list">';
      _rosters.forEach(r => {
        const winRate = r.battlesPlayed > 0
          ? Math.round((r.battlesWon / r.battlesPlayed) * 100) + '%'
          : '—';
        html +=
          '<li class="crusade-roster-card" data-crus-roster="' + htmlEsc(r.id) + '">' +
            '<div class="crusade-roster-card-head">' +
              '<span class="crusade-roster-card-name">' + htmlEsc(r.name || 'Untitled') + '</span>' +
              '<span class="crusade-roster-card-faction muted">' + htmlEsc(r.factionName || '(no faction)') + '</span>' +
            '</div>' +
            '<div class="crusade-roster-card-stats">' +
              '<span><strong>' + r.supplyUsed + '</strong> / ' + r.supplyLimit + ' supply</span>' +
              '<span><strong>' + r.battlesPlayed + '</strong> battles</span>' +
              '<span>' + winRate + ' win</span>' +
              '<span><strong>' + r.crusadePoints + '</strong> CP</span>' +
            '</div>' +
            '<div class="crusade-roster-card-actions">' +
              '<button type="button" class="btn btn-sm btn-outline" data-crus-open="' + htmlEsc(r.id) + '">Open</button>' +
              '<button type="button" class="btn btn-sm btn-outline crusade-danger" data-crus-delete="' + htmlEsc(r.id) + '">Delete</button>' +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }

    setBody(html);
    setFooter(
      '<button type="button" class="btn btn-accent btn-sm" data-crus-new>New Crusade Roster</button>' +
      '<span class="crusade-spacer"></span>' +
      '<button type="button" class="btn btn-outline btn-sm" data-crus-close>Close</button>'
    );

    const body = _modalEl.querySelector('.crusade-modal-body');
    body.querySelectorAll('[data-crus-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeRosterId = btn.getAttribute('data-crus-open');
        _view = 'detail';
        renderModal();
      });
    });
    body.querySelectorAll('[data-crus-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-crus-delete');
        const r = findRoster(id);
        if (!r) return;
        if (!window.confirm('Delete crusade roster "' + (r.name || 'Untitled') + '"? This cannot be undone.')) return;
        _rosters = _rosters.filter(x => x.id !== id);
        persistRosters();
        toast('Crusade roster deleted.', 'info');
        renderModal();
      });
    });
    _modalEl.querySelector('.crusade-modal-footer')
      .querySelectorAll('[data-crus-new]').forEach(btn => {
        btn.addEventListener('click', createBlankRoster);
      });
  }

  function createBlankRoster() {
    const state = App.state || {};
    const fname = (state.currentArmy && state.currentArmy.factionName) || '';
    const r = normalizeRoster({
      id:          uid('crusade-'),
      name:        'New Crusade',
      factionName: fname,
      supplyLimit: 1000,
    });
    _rosters.push(r);
    persistRosters();
    _activeRosterId = r.id;
    _view = 'detail';
    renderModal();
    toast('New crusade roster created.', 'success');
  }

  // ────────────────────────────────────────────────────────────────────
  // VIEW: roster detail (units + battle log)
  // ────────────────────────────────────────────────────────────────────

  function renderDetail() {
    const r = findRoster(_activeRosterId);
    if (!r) { _view = 'list'; renderModal(); return; }

    setTitle(r.name || 'Crusade');
    const winRate = r.battlesPlayed > 0
      ? Math.round((r.battlesWon / r.battlesPlayed) * 100) + '%'
      : '—';

    let html = '';
    html +=
      '<div class="crusade-detail-head">' +
        '<div class="crusade-detail-row">' +
          '<label class="crusade-field">' +
            '<span>Roster name</span>' +
            '<input type="text" id="crus-name" value="' + htmlEsc(r.name) + '" />' +
          '</label>' +
          '<label class="crusade-field">' +
            '<span>Faction</span>' +
            '<input type="text" id="crus-faction" value="' + htmlEsc(r.factionName) + '" placeholder="e.g. Adeptus Astartes" />' +
          '</label>' +
          '<label class="crusade-field crusade-field-narrow">' +
            '<span>Supply Limit</span>' +
            '<input type="number" id="crus-supply" min="0" step="50" value="' + r.supplyLimit + '" />' +
          '</label>' +
        '</div>' +
        '<div class="crusade-detail-stats">' +
          '<div class="crusade-stat" title="Total points across all units in this roster.">' +
            '<span class="crusade-stat-num">' + r.supplyUsed + ' / ' + r.supplyLimit + '</span>' +
            '<span class="crusade-stat-lbl">Supply</span>' +
          '</div>' +
          '<div class="crusade-stat" title="Total battles played in this campaign.">' +
            '<span class="crusade-stat-num">' + r.battlesPlayed + '</span>' +
            '<span class="crusade-stat-lbl">Battles</span>' +
          '</div>' +
          '<div class="crusade-stat" title="Battles won / battles played.">' +
            '<span class="crusade-stat-num">' + r.battlesWon + ' (' + winRate + ')</span>' +
            '<span class="crusade-stat-lbl">Wins</span>' +
          '</div>' +
          '<div class="crusade-stat" title="Crusade Points earned across the campaign.">' +
            '<span class="crusade-stat-num">' + r.crusadePoints + '</span>' +
            '<span class="crusade-stat-lbl">CP</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Units list
    html += '<section class="crusade-section">' +
      '<div class="crusade-section-head">' +
        '<h4>Order of Battle <span class="muted">(' + r.units.length + ' units)</span></h4>' +
        '<div class="crusade-section-actions">' +
          '<button type="button" class="btn btn-sm btn-outline" data-crus-add-army>Add unit from current army</button>' +
        '</div>' +
      '</div>';

    if (r.units.length === 0) {
      html += '<div class="crusade-empty muted">No units yet. Add units from your current army or build one first.</div>';
    } else {
      html += '<ul class="crusade-unit-list">';
      r.units.forEach(u => {
        const next = nextRankInfo(u.xp);
        const pct = next
          ? Math.min(100, Math.round((u.xp / next.threshold) * 100))
          : 100;
        const xpLine = next
          ? (u.xp + ' XP · next: ' + next.name + ' @ ' + next.threshold)
          : (u.xp + ' XP · max rank');
        html +=
          '<li class="crusade-unit-row" data-crus-unit="' + htmlEsc(u.crusadeId) + '">' +
            '<div class="crusade-unit-head">' +
              '<span class="crusade-unit-name">' + htmlEsc(u.unitName || '(unnamed unit)') + '</span>' +
              (u.label
                ? '<span class="crusade-unit-label">"' + htmlEsc(u.label) + '"</span>'
                : '') +
              '<span class="crusade-unit-rank crusade-rank-' + htmlEsc(u.rank.toLowerCase()) + '" ' +
                'title="' + htmlEsc(rankBlurb(u.rank)) + '">' + htmlEsc(u.rank) + '</span>' +
            '</div>' +
            '<div class="crusade-unit-stats">' +
              '<span class="crusade-unit-pts">' + u.currentPts + ' pts</span>' +
              '<span class="crusade-unit-bp">' + u.battlesPlayed + ' battles</span>' +
              '<span class="crusade-unit-honours">' + u.battleHonours.length + ' honour' + (u.battleHonours.length === 1 ? '' : 's') + '</span>' +
              (u.battleScars.length
                ? '<span class="crusade-unit-scars">' + u.battleScars.length + ' scar' + (u.battleScars.length === 1 ? '' : 's') + '</span>'
                : '') +
            '</div>' +
            '<div class="crusade-xp-bar-wrap" title="' + htmlEsc(xpLine) + '">' +
              '<div class="crusade-xp-bar" style="width:' + pct + '%"></div>' +
              '<span class="crusade-xp-text">' + htmlEsc(xpLine) + '</span>' +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    // Battle log
    html += '<section class="crusade-section">' +
      '<div class="crusade-section-head">' +
        '<h4>Battle Log <span class="muted">(' + (r.battles ? r.battles.length : 0) + ' entries)</span></h4>' +
        '<div class="crusade-section-actions">' +
          '<button type="button" class="btn btn-sm btn-accent" data-crus-log>Log a battle</button>' +
          '<button type="button" class="btn btn-sm btn-outline" data-crus-build>Build Battle Army</button>' +
        '</div>' +
      '</div>';
    if (!r.battles || r.battles.length === 0) {
      html += '<div class="crusade-empty muted">No battles logged yet.</div>';
    } else {
      const recent = r.battles.slice().reverse().slice(0, 8);
      html += '<ul class="crusade-battle-log">';
      recent.forEach(b => {
        const verdict = b.won ? 'Victory' : 'Defeat';
        const verdictCls = b.won ? 'crusade-verdict-win' : 'crusade-verdict-loss';
        const date = (b.date || '').split('T')[0];
        html +=
          '<li class="crusade-battle-row">' +
            '<span class="crusade-battle-date">' + htmlEsc(date) + '</span>' +
            '<span class="crusade-battle-vs">vs ' + htmlEsc(b.opponentName || '(unknown)') + '</span>' +
            '<span class="crusade-battle-fac muted">' + htmlEsc(b.opponentFaction || '') + '</span>' +
            '<span class="crusade-battle-mission muted">' + htmlEsc(b.mission || '') + '</span>' +
            '<span class="crusade-battle-score">' + (b.ourScore | 0) + ' – ' + (b.theirScore | 0) + '</span>' +
            '<span class="crusade-battle-verdict ' + verdictCls + '">' + verdict + '</span>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    // Rank legend (tooltip-style explainers)
    html += '<section class="crusade-section">' +
      '<h4>Rank reference <span class="muted">(hover for details)</span></h4>' +
      '<ul class="crusade-rank-legend">';
    RANKS.forEach(rk => {
      html +=
        '<li class="crusade-rank-legend-row" title="' + htmlEsc(rk.blurb) + '">' +
          '<span class="crusade-rank-pip crusade-rank-' + htmlEsc(rk.key.toLowerCase()) + '"></span>' +
          '<span class="crusade-rank-name">' + htmlEsc(rk.key) + '</span>' +
          '<span class="crusade-rank-thresh muted">' + rk.threshold + '+ XP</span>' +
          '<span class="crusade-rank-blurb muted">' + htmlEsc(rk.blurb) + '</span>' +
        '</li>';
    });
    html += '</ul></section>';

    setBody(html);
    setFooter(
      '<button type="button" class="btn btn-outline btn-sm" data-crus-back>&larr; Back</button>' +
      '<span class="crusade-spacer"></span>' +
      '<button type="button" class="btn btn-outline btn-sm" data-crus-close>Close</button>'
    );

    const body = _modalEl.querySelector('.crusade-modal-body');

    // Header field listeners
    const nameEl = body.querySelector('#crus-name');
    if (nameEl) nameEl.addEventListener('input', () => {
      r.name = nameEl.value || 'Untitled';
      r.updatedAt = nowIso();
      persistRosters();
      setTitle(r.name);
    });
    const facEl = body.querySelector('#crus-faction');
    if (facEl) facEl.addEventListener('input', () => {
      r.factionName = facEl.value || '';
      r.updatedAt = nowIso();
      persistRosters();
    });
    const supplyEl = body.querySelector('#crus-supply');
    if (supplyEl) supplyEl.addEventListener('change', () => {
      const v = parseInt(supplyEl.value, 10);
      r.supplyLimit = isNaN(v) ? 1000 : Math.max(0, v);
      r.updatedAt = nowIso();
      persistRosters();
      renderModal();
    });

    // Unit row clicks
    body.querySelectorAll('[data-crus-unit]').forEach(row => {
      row.addEventListener('click', () => {
        _activeUnitCrusadeId = row.getAttribute('data-crus-unit');
        _view = 'unit';
        renderModal();
      });
    });

    // Add unit from current army
    const addBtn = body.querySelector('[data-crus-add-army]');
    if (addBtn) addBtn.addEventListener('click', () => openAddUnitPicker(r));

    // Log battle / build battle army
    const logBtn = body.querySelector('[data-crus-log]');
    if (logBtn) logBtn.addEventListener('click', () => {
      _view = 'battle';
      renderModal();
    });
    const buildBtn = body.querySelector('[data-crus-build]');
    if (buildBtn) buildBtn.addEventListener('click', () => buildBattleArmy(r));

    // Footer back
    const ft = _modalEl.querySelector('.crusade-modal-footer');
    const back = ft.querySelector('[data-crus-back]');
    if (back) back.addEventListener('click', () => {
      _view = 'list';
      _activeRosterId = null;
      renderModal();
    });
  }

  function rankBlurb(key) {
    const r = RANKS.find(x => x.key === key);
    return r ? r.blurb : '';
  }

  // ── Add-unit picker (from current army) ───────────────────────────
  function openAddUnitPicker(roster) {
    const army = App.state && App.state.currentArmy;
    if (!army || !Array.isArray(army.entries) || army.entries.length === 0) {
      toast('Current army is empty — add units there first.', 'warning', 4500);
      return;
    }
    if (roster.factionName && army.factionName &&
        roster.factionName !== army.factionName) {
      if (!window.confirm('Current army faction (' + (army.factionName || 'unknown') +
        ') does not match this Crusade roster (' + roster.factionName + '). Add anyway?')) return;
    }

    // Build a small picker overlay inside the modal body.
    setTitle('Add unit from current army');
    let html = '';
    html += '<div class="crusade-picker">';
    html += '<p class="muted">Pick a unit to import. Each entry adds one instance to your Order of Battle.</p>';
    html += '<ul class="crusade-picker-list">';
    army.entries.forEach((e, i) => {
      const pts = (e.selectedPts != null ? e.selectedPts : (e.unitData && e.unitData.points) || 0);
      const enhPts = (e.enhancements || []).reduce((s, x) => s + (x.pts || 0), 0);
      const totalEach = pts + enhPts;
      html +=
        '<li class="crusade-picker-row">' +
          '<div class="crusade-picker-head">' +
            '<span class="crusade-picker-name">' + htmlEsc(e.unitName || '(unit)') + '</span>' +
            '<span class="crusade-picker-pts muted">' + totalEach + ' pts</span>' +
            (e.count > 1
              ? '<span class="crusade-picker-count muted">×' + e.count + ' in army</span>'
              : '') +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-outline" data-crus-pick="' + i + '">Add</button>' +
        '</li>';
    });
    html += '</ul></div>';
    setBody(html);
    setFooter(
      '<button type="button" class="btn btn-outline btn-sm" data-crus-back>&larr; Back</button>' +
      '<span class="crusade-spacer"></span>' +
      '<button type="button" class="btn btn-outline btn-sm" data-crus-close>Close</button>'
    );

    const body = _modalEl.querySelector('.crusade-modal-body');
    body.querySelectorAll('[data-crus-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-crus-pick'), 10);
        const entry = army.entries[idx];
        if (!entry) return;
        addUnitFromArmyEntry(roster, entry);
        toast('Added "' + (entry.unitName || 'unit') + '" to ' + roster.name + '.', 'success');
        _view = 'detail';
        renderModal();
      });
    });
    const ft = _modalEl.querySelector('.crusade-modal-footer');
    const back = ft.querySelector('[data-crus-back]');
    if (back) back.addEventListener('click', () => {
      _view = 'detail';
      renderModal();
    });
  }

  function addUnitFromArmyEntry(roster, entry) {
    const pts = (entry.selectedPts != null ? entry.selectedPts : (entry.unitData && entry.unitData.points) || 0);
    const enhPts = (entry.enhancements || []).reduce((s, x) => s + (x.pts || 0), 0);
    const total = pts + enhPts;
    const u = normalizeUnit({
      crusadeId: uid('cu-'),
      unitId:    entry.unitId || (entry.unitData && entry.unitData.id) || '',
      unitName:  entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit',
      label:     '',
      basePts:   pts,
      currentPts: total,
      xp:        0,
    });
    roster.units.push(u);
    recalcSupply(roster);
    roster.updatedAt = nowIso();
    persistRosters();
  }

  // ────────────────────────────────────────────────────────────────────
  // VIEW: per-unit panel
  // ────────────────────────────────────────────────────────────────────

  function renderUnit() {
    const r = findRoster(_activeRosterId);
    const u = r ? findUnit(r, _activeUnitCrusadeId) : null;
    if (!r || !u) { _view = 'detail'; renderModal(); return; }

    setTitle(u.unitName + (u.label ? ' — "' + u.label + '"' : ''));

    const next = nextRankInfo(u.xp);
    const pctNext = next
      ? Math.min(100, Math.round((u.xp / next.threshold) * 100))
      : 100;

    let html = '';

    // Identity / label / pts / notes
    html += '<section class="crusade-section">' +
      '<div class="crusade-detail-row">' +
        '<label class="crusade-field crusade-field-grow">' +
          '<span>Custom name / squad title</span>' +
          '<input type="text" id="crus-u-label" value="' + htmlEsc(u.label) + '" placeholder="e.g. Squad Pyronus" />' +
        '</label>' +
        '<label class="crusade-field crusade-field-narrow">' +
          '<span>Base pts</span>' +
          '<input type="number" id="crus-u-base" min="0" step="5" value="' + u.basePts + '" />' +
        '</label>' +
        '<label class="crusade-field crusade-field-narrow">' +
          '<span>Current pts</span>' +
          '<input type="number" id="crus-u-cur" min="0" step="5" value="' + u.currentPts + '" title="Base + Battle Honour costs + upgrades." />' +
        '</label>' +
      '</div>' +
      '<label class="crusade-field crusade-field-grow">' +
        '<span>Notes (squad lore, kills, anecdotes)</span>' +
        '<textarea id="crus-u-notes" rows="3">' + htmlEsc(u.notes) + '</textarea>' +
      '</label>' +
    '</section>';

    // Rank + XP
    html += '<section class="crusade-section">' +
      '<h4>Rank &amp; XP</h4>' +
      '<div class="crusade-rank-display crusade-rank-' + htmlEsc(u.rank.toLowerCase()) + '" ' +
        'title="' + htmlEsc(rankBlurb(u.rank)) + '">' +
        '<span class="crusade-rank-name">' + htmlEsc(u.rank) + '</span>' +
        '<span class="crusade-rank-xp">' + u.xp + ' XP</span>' +
      '</div>' +
      '<div class="crusade-xp-bar-wrap crusade-xp-big">' +
        '<div class="crusade-xp-bar" style="width:' + pctNext + '%"></div>' +
        '<span class="crusade-xp-text">' +
          (next ? ('Next: ' + htmlEsc(next.name) + ' @ ' + next.threshold + ' XP')
                : 'Maximum rank reached.') +
        '</span>' +
      '</div>' +
      '<div class="crusade-xp-controls">' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-xp="-1">-1 XP</button>' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-xp="-3">-3 XP</button>' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-xp="1">+1 XP</button>' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-xp="3">+3 XP</button>' +
        '<button type="button" class="btn btn-sm btn-accent"  data-crus-xp="5">+5 XP</button>' +
      '</div>' +
      '<div class="crusade-xp-presets">' +
        '<span class="muted">Award after a battle:</span>' +
        XP_PRESETS.map(p =>
          '<button type="button" class="btn btn-sm btn-outline" data-crus-xp-preset="' + htmlEsc(p.key) + '" ' +
          'title="' + htmlEsc(p.tip) + '">' + htmlEsc(p.label) + ' +' + p.delta + '</button>'
        ).join('') +
      '</div>' +
    '</section>';

    // Battle Honours
    html += '<section class="crusade-section">' +
      '<h4>Battle Honours <span class="muted">(' + u.battleHonours.length + ')</span></h4>';
    if (u.battleHonours.length === 0) {
      html += '<div class="crusade-empty muted">No honours earned yet.</div>';
    } else {
      html += '<ul class="crusade-honour-list">';
      u.battleHonours.forEach((h, i) => {
        html +=
          '<li class="crusade-honour-row">' +
            '<div class="crusade-honour-head">' +
              '<span class="crusade-honour-name">' + htmlEsc(h.name) + '</span>' +
              (h.pts ? '<span class="crusade-honour-pts muted">+' + (h.pts | 0) + ' pts</span>' : '') +
              '<button type="button" class="crusade-row-remove" data-crus-honour-rm="' + i + '" title="Remove">&times;</button>' +
            '</div>' +
            '<div class="crusade-honour-desc muted">' + htmlEsc(h.description || '') + '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    // Add honour controls (catalog grouped + custom)
    const grouped = {};
    HONOURS.forEach(h => {
      if (!grouped[h.category]) grouped[h.category] = [];
      grouped[h.category].push(h);
    });
    html += '<div class="crusade-add-honour">' +
      '<label class="crusade-field">' +
        '<span>Add a Battle Honour</span>' +
        '<select id="crus-honour-pick">' +
          '<option value="">— Pick from catalog —</option>' +
          Object.keys(grouped).map(cat =>
            '<optgroup label="' + htmlEsc(cat) + '">' +
              grouped[cat].map((h, idx) =>
                '<option value="' + htmlEsc(cat) + '|' + idx + '">' + htmlEsc(h.name) + ' (+' + h.pts + ' pts)</option>'
              ).join('') +
            '</optgroup>'
          ).join('') +
        '</select>' +
      '</label>' +
      '<button type="button" class="btn btn-sm btn-outline" data-crus-honour-add>Add selected</button>' +
      '<button type="button" class="btn btn-sm btn-outline" data-crus-honour-custom>Add custom&hellip;</button>' +
    '</div>';
    html += '</section>';

    // Battle Scars
    html += '<section class="crusade-section">' +
      '<h4>Battle Scars <span class="muted">(' + u.battleScars.length + ')</span></h4>';
    if (u.battleScars.length === 0) {
      html += '<div class="crusade-empty muted">No scars. Long may it last.</div>';
    } else {
      html += '<ul class="crusade-scar-list">';
      u.battleScars.forEach((s, i) => {
        html +=
          '<li class="crusade-scar-row">' +
            '<div class="crusade-scar-head">' +
              '<span class="crusade-scar-name">' + htmlEsc(s.name) + '</span>' +
              '<button type="button" class="crusade-row-remove" data-crus-scar-rm="' + i + '" title="Remove">&times;</button>' +
            '</div>' +
            '<div class="crusade-scar-desc muted">' + htmlEsc(s.description || '') + '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '<div class="crusade-add-scar">' +
      '<label class="crusade-field">' +
        '<span>Add a Battle Scar</span>' +
        '<select id="crus-scar-pick">' +
          '<option value="">— Pick a scar —</option>' +
          SCARS.map((s, i) =>
            '<option value="' + i + '">' + htmlEsc(s.name) + '</option>'
          ).join('') +
        '</select>' +
      '</label>' +
      '<button type="button" class="btn btn-sm btn-outline" data-crus-scar-add>Add selected</button>' +
      '<button type="button" class="btn btn-sm btn-outline" data-crus-scar-custom>Add custom&hellip;</button>' +
    '</div>';
    html += '</section>';

    // Stats / progression sidebar info
    html += '<section class="crusade-section">' +
      '<h4>Career stats</h4>' +
      '<ul class="crusade-stat-list">' +
        '<li><span class="muted">Battles played</span><strong>' + u.battlesPlayed + '</strong></li>' +
        '<li><span class="muted">Crusade Pts earned</span><strong>' + u.crusadePts + '</strong></li>' +
      '</ul>' +
      '<div class="crusade-row-actions">' +
        '<button type="button" class="btn btn-sm btn-outline crusade-danger" data-crus-unit-rm>Remove from roster</button>' +
      '</div>' +
    '</section>';

    setBody(html);
    setFooter(
      '<button type="button" class="btn btn-outline btn-sm" data-crus-back>&larr; Back to roster</button>' +
      '<span class="crusade-spacer"></span>' +
      '<button type="button" class="btn btn-accent btn-sm"  data-crus-save>Save</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-crus-close>Close</button>'
    );

    wireUnitView(r, u);
  }

  function wireUnitView(r, u) {
    const body = _modalEl.querySelector('.crusade-modal-body');
    const ft   = _modalEl.querySelector('.crusade-modal-footer');

    function persistAndRerender() {
      recalcSupply(r);
      r.updatedAt = nowIso();
      persistRosters();
      renderModal();
    }

    body.querySelector('#crus-u-label').addEventListener('input', e => {
      u.label = e.target.value || '';
    });
    body.querySelector('#crus-u-base').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      u.basePts = isNaN(v) ? 0 : Math.max(0, v);
    });
    body.querySelector('#crus-u-cur').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      u.currentPts = isNaN(v) ? 0 : Math.max(0, v);
    });
    body.querySelector('#crus-u-notes').addEventListener('input', e => {
      u.notes = e.target.value || '';
    });

    // XP buttons
    body.querySelectorAll('[data-crus-xp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = parseInt(btn.getAttribute('data-crus-xp'), 10) || 0;
        adjustUnitXP(r, u, d);
        persistAndRerender();
      });
    });
    body.querySelectorAll('[data-crus-xp-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-crus-xp-preset');
        const p = XP_PRESETS.find(x => x.key === key);
        if (!p) return;
        adjustUnitXP(r, u, p.delta);
        persistAndRerender();
      });
    });

    // Honours add / remove
    const honourAdd = body.querySelector('[data-crus-honour-add]');
    if (honourAdd) honourAdd.addEventListener('click', () => {
      const sel = body.querySelector('#crus-honour-pick');
      if (!sel || !sel.value) return;
      const [cat, idxStr] = sel.value.split('|');
      const idx = parseInt(idxStr, 10);
      const grouped = HONOURS.filter(h => h.category === cat);
      const pick = grouped[idx];
      if (!pick) return;
      u.battleHonours.push({ name: pick.name, description: pick.description, pts: pick.pts });
      u.currentPts = (u.currentPts || 0) + (pick.pts || 0);
      persistAndRerender();
    });
    const honourCustom = body.querySelector('[data-crus-honour-custom]');
    if (honourCustom) honourCustom.addEventListener('click', () => {
      const name = window.prompt('Custom Battle Honour name:');
      if (!name) return;
      const desc = window.prompt('Description (effect):') || '';
      const ptsStr = window.prompt('Points cost (number, can be 0):', '0') || '0';
      const pts = Math.max(0, parseInt(ptsStr, 10) || 0);
      u.battleHonours.push({ name: name, description: desc, pts: pts });
      u.currentPts = (u.currentPts || 0) + pts;
      persistAndRerender();
    });
    body.querySelectorAll('[data-crus-honour-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-crus-honour-rm'), 10);
        const removed = u.battleHonours[i];
        if (!removed) return;
        u.battleHonours.splice(i, 1);
        u.currentPts = Math.max(0, (u.currentPts || 0) - (removed.pts || 0));
        persistAndRerender();
      });
    });

    // Scars add / remove
    const scarAdd = body.querySelector('[data-crus-scar-add]');
    if (scarAdd) scarAdd.addEventListener('click', () => {
      const sel = body.querySelector('#crus-scar-pick');
      if (!sel || !sel.value) return;
      const idx = parseInt(sel.value, 10);
      const pick = SCARS[idx];
      if (!pick) return;
      u.battleScars.push({ name: pick.name, description: pick.description });
      persistAndRerender();
    });
    const scarCustom = body.querySelector('[data-crus-scar-custom]');
    if (scarCustom) scarCustom.addEventListener('click', () => {
      const name = window.prompt('Custom Battle Scar name:');
      if (!name) return;
      const desc = window.prompt('Description (effect):') || '';
      u.battleScars.push({ name: name, description: desc });
      persistAndRerender();
    });
    body.querySelectorAll('[data-crus-scar-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-crus-scar-rm'), 10);
        u.battleScars.splice(i, 1);
        persistAndRerender();
      });
    });

    // Remove unit from roster
    const unitRm = body.querySelector('[data-crus-unit-rm]');
    if (unitRm) unitRm.addEventListener('click', () => {
      if (!window.confirm('Remove "' + (u.label || u.unitName) + '" from this roster?')) return;
      r.units = r.units.filter(x => x.crusadeId !== u.crusadeId);
      recalcSupply(r);
      r.updatedAt = nowIso();
      persistRosters();
      _activeUnitCrusadeId = null;
      _view = 'detail';
      renderModal();
    });

    // Footer
    const back = ft.querySelector('[data-crus-back]');
    if (back) back.addEventListener('click', () => {
      // Persist any pending text edits before going back.
      recalcSupply(r);
      r.updatedAt = nowIso();
      persistRosters();
      _view = 'detail';
      renderModal();
    });
    const save = ft.querySelector('[data-crus-save]');
    if (save) save.addEventListener('click', () => {
      recalcSupply(r);
      r.updatedAt = nowIso();
      persistRosters();
      toast('Saved.', 'success', 1500);
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // VIEW: Log a battle
  // ────────────────────────────────────────────────────────────────────

  function renderBattle() {
    const r = findRoster(_activeRosterId);
    if (!r) { _view = 'list'; renderModal(); return; }

    setTitle('Log a battle — ' + r.name);

    let html = '';
    html += '<section class="crusade-section">' +
      '<div class="crusade-detail-row">' +
        '<label class="crusade-field"><span>Date</span>' +
          '<input type="date" id="crus-b-date" value="' + nowIso().split('T')[0] + '" /></label>' +
        '<label class="crusade-field"><span>Mission</span>' +
          '<input type="text" id="crus-b-mission" placeholder="e.g. Take and Hold" /></label>' +
      '</div>' +
      '<div class="crusade-detail-row">' +
        '<label class="crusade-field"><span>Opponent name</span>' +
          '<input type="text" id="crus-b-opp-name" /></label>' +
        '<label class="crusade-field"><span>Opponent faction</span>' +
          '<input type="text" id="crus-b-opp-fac" /></label>' +
      '</div>' +
      '<div class="crusade-detail-row">' +
        '<label class="crusade-field crusade-field-narrow"><span>Our score</span>' +
          '<input type="number" id="crus-b-our" min="0" max="100" value="0" /></label>' +
        '<label class="crusade-field crusade-field-narrow"><span>Their score</span>' +
          '<input type="number" id="crus-b-their" min="0" max="100" value="0" /></label>' +
        '<label class="crusade-field crusade-field-narrow"><span>Result</span>' +
          '<select id="crus-b-result">' +
            '<option value="win">Victory</option>' +
            '<option value="loss">Defeat</option>' +
            '<option value="draw">Draw</option>' +
          '</select></label>' +
        '<label class="crusade-field crusade-field-narrow"><span>CP earned</span>' +
          '<input type="number" id="crus-b-cp" min="0" value="3" title="Crusade Points: typically 3 for a win, 1 for a loss." /></label>' +
      '</div>' +
      '<label class="crusade-field crusade-field-grow"><span>Notes</span>' +
        '<textarea id="crus-b-notes" rows="2" placeholder="Anything memorable from the game"></textarea>' +
      '</label>' +
    '</section>';

    html += '<section class="crusade-section">' +
      '<h4>Award XP per unit</h4>' +
      '<div class="crusade-xp-bulk">' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-bulk-xp="3">+3 to all</button>' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-bulk-xp="1">+1 to all (survived)</button>' +
        '<button type="button" class="btn btn-sm btn-outline" data-crus-bulk-xp="0">Reset</button>' +
      '</div>';

    if (r.units.length === 0) {
      html += '<div class="crusade-empty muted">No units in roster — XP awards will be skipped.</div>';
    } else {
      html += '<ul class="crusade-xp-grid">';
      r.units.forEach(u => {
        html +=
          '<li class="crusade-xp-grid-row" data-crus-bxp-row="' + htmlEsc(u.crusadeId) + '">' +
            '<div class="crusade-xp-grid-name">' +
              '<strong>' + htmlEsc(u.unitName) + '</strong>' +
              (u.label ? ' <span class="muted">"' + htmlEsc(u.label) + '"</span>' : '') +
              ' <span class="muted">(' + htmlEsc(u.rank) + ', ' + u.xp + ' XP)</span>' +
            '</div>' +
            '<div class="crusade-xp-grid-controls">' +
              '<label class="crusade-inline"><input type="checkbox" data-crus-bxp-played value="1" checked /> Played</label>' +
              '<label class="crusade-inline"><input type="number" data-crus-bxp-xp value="3" min="0" step="1" /> XP</label>' +
              '<label class="crusade-inline"><input type="number" data-crus-bxp-cp value="0" min="0" step="1" /> CP</label>' +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    setBody(html);
    setFooter(
      '<button type="button" class="btn btn-outline btn-sm" data-crus-back>&larr; Cancel</button>' +
      '<span class="crusade-spacer"></span>' +
      '<button type="button" class="btn btn-accent btn-sm" data-crus-submit>Log battle</button>'
    );

    const body = _modalEl.querySelector('.crusade-modal-body');
    const ft   = _modalEl.querySelector('.crusade-modal-footer');

    body.querySelectorAll('[data-crus-bulk-xp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.getAttribute('data-crus-bulk-xp'), 10) || 0;
        body.querySelectorAll('[data-crus-bxp-xp]').forEach(inp => { inp.value = v; });
      });
    });

    const back = ft.querySelector('[data-crus-back]');
    if (back) back.addEventListener('click', () => { _view = 'detail'; renderModal(); });

    const submit = ft.querySelector('[data-crus-submit]');
    if (submit) submit.addEventListener('click', () => {
      const date    = body.querySelector('#crus-b-date').value || nowIso().split('T')[0];
      const mission = body.querySelector('#crus-b-mission').value || '';
      const oppName = body.querySelector('#crus-b-opp-name').value || '';
      const oppFac  = body.querySelector('#crus-b-opp-fac').value || '';
      const ours    = parseInt(body.querySelector('#crus-b-our').value, 10) || 0;
      const theirs  = parseInt(body.querySelector('#crus-b-their').value, 10) || 0;
      const result  = body.querySelector('#crus-b-result').value;
      const cp      = parseInt(body.querySelector('#crus-b-cp').value, 10) || 0;
      const notes   = body.querySelector('#crus-b-notes').value || '';

      const won = result === 'win';
      r.battles = r.battles || [];
      r.battles.push({
        id: uid('b-'),
        date: date + 'T00:00:00.000Z',
        mission, opponentName: oppName, opponentFaction: oppFac,
        ourScore: ours, theirScore: theirs, won, draw: result === 'draw',
        notes, cpEarned: cp,
      });
      r.battlesPlayed += 1;
      if (won) r.battlesWon += 1;
      r.crusadePoints += cp;

      // Per-unit XP / CP awards
      body.querySelectorAll('[data-crus-bxp-row]').forEach(row => {
        const cid = row.getAttribute('data-crus-bxp-row');
        const u = findUnit(r, cid);
        if (!u) return;
        const playedEl = row.querySelector('[data-crus-bxp-played]');
        const xpEl     = row.querySelector('[data-crus-bxp-xp]');
        const cpEl     = row.querySelector('[data-crus-bxp-cp]');
        const played   = !!(playedEl && playedEl.checked);
        const xpDelta  = parseInt(xpEl && xpEl.value, 10) || 0;
        const cpDelta  = parseInt(cpEl && cpEl.value, 10) || 0;
        if (played) u.battlesPlayed += 1;
        if (xpDelta) adjustUnitXP(r, u, xpDelta);
        if (cpDelta) u.crusadePts += cpDelta;
      });

      r.updatedAt = nowIso();
      persistRosters();
      toast('Battle logged.', 'success', 3000);
      _view = 'detail';
      renderModal();
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Build Battle Army from Crusade Roster
  // ────────────────────────────────────────────────────────────────────

  function buildBattleArmy(roster) {
    if (!roster || roster.units.length === 0) {
      toast('Roster has no units to build a battle army from.', 'warning', 4000);
      return;
    }
    const armyMgr = App.state && App.state.armyManager;
    if (!armyMgr || typeof window.Army !== 'function') {
      toast('Army manager unavailable.', 'error', 4000);
      return;
    }

    // Try to enrich each crusade unit with its parser unitData by id+faction.
    const allUnits = (App.state && App.state.allUnits) || [];
    const factionName = roster.factionName || '';

    const entries = [];
    let totalPts = 0;
    roster.units.forEach(cu => {
      let unitData = null;
      for (let i = 0; i < allUnits.length; i++) {
        const au = allUnits[i];
        if (!au) continue;
        if (au.id === cu.unitId &&
            (!factionName || au._factionName === factionName)) {
          unitData = au;
          break;
        }
      }
      const stub = {
        id: cu.unitId || '',
        name: cu.unitName || 'Unit',
        points: cu.currentPts || 0,
      };
      const ud = unitData || stub;
      const pts = cu.currentPts || (ud.points || 0);
      totalPts += pts;
      entries.push({
        unitId:      ud.id,
        unitName:    ud.name,
        unitData:    ud,
        count:       1,
        selectedPts: pts,
        squadLabel:  cu.label || null,
        enhancements: [],
      });
    });

    const army = new window.Army({
      name: roster.name + ' (Battle Army)',
      factionName: factionName,
      pointsLimit: Math.max(roster.supplyLimit, totalPts),
      entries: entries,
    });

    armyMgr.armies.push(army);
    armyMgr.save();
    armyMgr.currentArmy = army;
    App.state.currentArmy = army;

    // Re-render the host UI and broadcast change.
    if (typeof App.renderAll === 'function') App.renderAll();
    if (typeof App.fireArmyChange === 'function') App.fireArmyChange('load');
    if (factionName && typeof App.applyFactionColor === 'function') {
      App.applyFactionColor(factionName);
    }

    toast('Battle Army built (' + totalPts + ' pts). Switch to it in the army panel.', 'success', 4500);
    closeModal();
  }

  // ────────────────────────────────────────────────────────────────────
  // top-level render dispatcher
  // ────────────────────────────────────────────────────────────────────

  function renderModal() {
    if (!_modalEl) return;
    if (_view === 'list')   { renderList();   return; }
    if (_view === 'detail') { renderDetail(); return; }
    if (_view === 'unit')   { renderUnit();   return; }
    if (_view === 'battle') { renderBattle(); return; }
    renderList();
  }

  function openDashboard() {
    loadRosters();
    openModal();
  }

  // ────────────────────────────────────────────────────────────────────
  // Hook registration
  // ────────────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-crusade',
    region: 'primary',
    label: 'Crusade',
    category: 'game',
    title: 'Crusade campaign tracker',
    onClick: openDashboard,
  });

  App.hooks.bootstrap.push(function () {
    loadRosters();
  });

  // Public surface for debugging / tests.
  App.crusade = {
    open: openDashboard,
    close: closeModal,
    rosters: () => _rosters.slice(),
    RANKS: RANKS.slice(),
    HONOURS: HONOURS.slice(),
    SCARS: SCARS.slice(),
    XP_PRESETS: XP_PRESETS.slice(),
    rankForXP,
  };
})();
