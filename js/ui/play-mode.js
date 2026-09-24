// ui/play-mode.js — Play mode: a fast-switching game-day reference.
//
// The whole design serves one goal: switching between datasheets, stratagems,
// rules and enhancements must be instant. Everything is rendered into the DOM
// ONCE per activation (armies are 10-25 entries — milliseconds); switching
// sheets, tabs or the sheet layout only toggles `hidden`/class state, never
// re-renders.
//
// Light tracking on top: a CP counter in the header and a per-entry destroyed
// toggle on each sheet. Deliberately NOT a cockpit — no phase tracker, no
// wound stepper (wounds are tracked on the board, not in the app), no
// scorepad (the old play mode was that, and was removed).
//
// Desktop Sheets tab also has a layout toggle: "One" (single sheet, switcher
// rail) or "All" (every datasheet lined up in one horizontal, sideways-
// scrolling row). Phones always get the single layout.
//
// Datasheet/stratagem/rule markup comes from App.CardRenderers, the shared
// facade cards-mode.js exposes over its print-card renderers, so Play mode
// shows the exact same corrected data as the printable cards.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_VIEW = 'yaab_play_view';   // { tab, layout: 'single'|'row', entryByArmy: {armyId: entryId} }
  const LS_GAME = 'yaab_play_game';   // { [armyId]: {cp, startedAt, touchedAt, units:{[entryId]:{dead}}} }
  const TABS = [
    ['sheets',  'Sheets'],
    ['strats',  'Stratagems'],
    ['rules',   'Rules'],
    ['enhance', 'Enhancements'],
  ];
  const MAX_TRACKED_ARMIES = 10;

  // ── module state ──────────────────────────────────────────────────────
  let _root       = null;
  let _mounted    = false;
  let _rendered   = false;   // renderAll has run at least once
  let _dirty      = true;    // army/selection changed while hidden
  let _activeTab  = 'sheets';
  let _activeEntry = null;   // virtual id of the visible sheet
  let _entryOrder = [];      // virtual ids in switcher order (for swipe prev/next)
  let _virtual = [];         // [{vid, entry, isLeader, copy}] from the last render
  let _saveTimer  = 0;
  let _mql        = null;    // matchMedia('(min-width: 821px)'), bound once

  // ── helpers ───────────────────────────────────────────────────────────
  function esc(s) {
    if (window.UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function CR() { return App.CardRenderers || null; }
  function getArmy() {
    const cr = CR();
    if (cr) return cr.getCurrentArmy();
    return (App.state && App.state.currentArmy) || null;
  }
  function isHidden() {
    const host = document.getElementById('play-mode');
    return !host || host.hidden || !host.classList.contains('mode-active');
  }

  // ── localStorage ──────────────────────────────────────────────────────
  function lsRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (_) { return fallback; }
  }
  function lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }
  let _view = null;
  function view() {
    if (!_view) _view = lsRead(LS_VIEW, { tab: 'sheets', layout: 'single', entryByArmy: {} });
    if (!_view.entryByArmy || typeof _view.entryByArmy !== 'object') _view.entryByArmy = {};
    if (_view.layout !== 'row') _view.layout = 'single';
    return _view;
  }
  function persistView() {
    const v = view();
    v.tab = _activeTab;
    const army = getArmy();
    if (army && army.id && _activeEntry) v.entryByArmy[army.id] = _activeEntry;
    lsWrite(LS_VIEW, v);
  }
  // Game-state bag. The in-memory cache is the source of truth once loaded —
  // the debounced localStorage flush only persists it. (Re-reading LS on every
  // interaction loses mutations still inside the debounce window.)
  let _gameAll = null;
  function readGameAll() {
    if (!_gameAll) _gameAll = lsRead(LS_GAME, {});
    return _gameAll;
  }
  function gameFor(armyId) {
    const all = readGameAll();
    let g = all[armyId];
    if (!g || typeof g !== 'object') g = {};
    if (typeof g.cp !== 'number' || g.cp < 0) g.cp = 0;
    if (!g.units || typeof g.units !== 'object') g.units = {};
    all[armyId] = g;
    return g;
  }
  function writeGame(armyId, mut) {
    const all = readGameAll();
    const g = gameFor(armyId);
    mut(g);
    g.touchedAt = Date.now();
    if (!g.startedAt) g.startedAt = new Date().toISOString();
    // GC: drop tracking for entries (or split copies) no longer in the army.
    const army = getArmy();
    if (army && army.id === armyId && Array.isArray(army.entries)) {
      const live = liveVids(army);
      Object.keys(g.units).forEach(id => { if (!live.has(id)) delete g.units[id]; });
    }
    all[armyId] = g;
    // Cap the bag at the most-recently-touched armies so it can't grow forever.
    const ids = Object.keys(all);
    if (ids.length > MAX_TRACKED_ARMIES) {
      ids.sort((a, b) => (all[b].touchedAt || 0) - (all[a].touchedAt || 0))
        .slice(MAX_TRACKED_ARMIES)
        .forEach(id => { delete all[id]; });
    }
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => lsWrite(LS_GAME, all), 150);
    return g;
  }
  function clearGame(armyId) {
    const all = readGameAll();
    delete all[armyId];
    clearTimeout(_saveTimer);
    lsWrite(LS_GAME, all);
  }
  // A cross-tab/cloud change to the key invalidates the cache.
  window.addEventListener('storage', e => {
    if (e && e.key === LS_GAME) _gameAll = null;
  });

  // ── army entry ordering ─────────────────────────────────────────────────
  // A stacked entry (count > 1) is N identical squads on the table, so play
  // mode ALWAYS splits it: one virtual sheet per copy, each with its own
  // destroyed tracking. Virtual ids are `entryId` for copy 1 and
  // `entryId::i` for the rest, so single-copy entries keep their stored
  // game state unchanged.
  function virtualId(entry, i) { return i === 0 ? entry.entryId : entry.entryId + '::' + i; }
  // Every live virtual id for the current army (for game-state GC).
  function liveVids(army) {
    const out = new Set();
    ((army && army.entries) || []).forEach(e => {
      if (!e || !e.entryId) return;
      const n = Math.max(1, e.count || 1);
      for (let i = 0; i < n; i++) out.add(virtualId(e, i));
    });
    return out;
  }
  // Attached leaders sit immediately after their bodyguard entry so the
  // switcher reads like the army list does ("who is this squad, who leads
  // it"); leaders follow the FIRST copy of a split squad, further copies
  // come after them.
  function orderedEntries(army) {
    const entries = (army && Array.isArray(army.entries)) ? army.entries : [];
    const byParent = new Map();   // parent entryId -> [leader entries]
    const roots = [];
    entries.forEach(e => {
      if (!e) return;
      const pid = e.attachedToEntryId;
      if (pid && entries.some(o => o && o.entryId === pid)) {
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid).push(e);
      } else {
        roots.push(e);
      }
    });
    const out = [];
    const pushCopies = (e, isLeader, only) => {
      const n = Math.max(1, e.count || 1);
      for (let i = 0; i < n; i++) {
        if (only != null && i !== only) continue;
        out.push({ entry: e, isLeader, vid: virtualId(e, i), copy: n > 1 ? { i: i + 1, n } : null });
      }
    };
    roots.forEach(e => {
      pushCopies(e, false, 0);
      (byParent.get(e.entryId) || []).forEach(l => pushCopies(l, true, null));
      const n = Math.max(1, e.count || 1);
      for (let i = 1; i < n; i++) {
        out.push({ entry: e, isLeader: false, vid: virtualId(e, i), copy: { i: i + 1, n } });
      }
    });
    return out;
  }
  // The switcher chip label for a virtual entry — the sheet head reuses the
  // exact same string so a player sees one name for a unit, not two.
  function sheetLabel(entry, copy) {
    const name = entry.customName || entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit';
    return name + (copy ? ' #' + copy.i : '');
  }

  // ── mount (skeleton, once) ────────────────────────────────────────────
  function ensureRoot() {
    const host = document.getElementById('play-mode');
    if (!host) return null;
    host.querySelectorAll('.mode-placeholder').forEach(el => el.remove());
    let root = host.querySelector('.play-root');
    if (!root) {
      root = document.createElement('div');
      root.className = 'play-root';
      root.dataset.activeTab = _activeTab;
      root.innerHTML = ''
        + '<header class="play-header">'
        +   '<div class="play-title"><span class="play-army-name"></span></div>'
        +   '<div class="play-cp" role="group" aria-label="Command points">'
        +     '<button type="button" class="play-cp-btn" data-cp="-1" aria-label="Spend a command point">&minus;</button>'
        +     '<span class="play-cp-val" aria-live="polite">0 CP</span>'
        +     '<button type="button" class="play-cp-btn" data-cp="1" aria-label="Gain a command point">+</button>'
        +   '</div>'
        +   '<div class="play-layout-toggle" role="group" aria-label="Sheet layout">'
        +     '<button type="button" class="play-layout-btn" data-layout="single" aria-pressed="true" title="One sheet at a time">One</button>'
        +     '<button type="button" class="play-layout-btn" data-layout="row" aria-pressed="false" title="All sheets in a row">All</button>'
        +   '</div>'
        +   '<button type="button" class="play-reset">Reset game</button>'
        +   '<button type="button" class="play-exit" title="Leave Play mode and return to the builder">Exit</button>'
        + '</header>'
        + '<nav class="play-tabs" role="tablist" aria-label="Play mode sections">'
        +   TABS.map(([id, label]) =>
              '<button type="button" class="play-tab" role="tab" data-tab="' + id + '"'
              + ' aria-selected="' + (id === _activeTab ? 'true' : 'false') + '">' + label + '</button>'
            ).join('')
        + '</nav>'
        + '<div class="play-layout">'
        +   '<aside class="play-switcher" role="tablist" aria-orientation="vertical" aria-label="Units"></aside>'
        +   '<main class="play-body">'
        +     '<div class="play-panel" data-panel="sheets"></div>'
        +     '<div class="play-panel" data-panel="strats" hidden></div>'
        +     '<div class="play-panel" data-panel="rules" hidden></div>'
        +     '<div class="play-panel" data-panel="enhance" hidden></div>'
        +   '</main>'
        + '</div>'
        + '<div class="play-empty" hidden>'
        +   '<h2>Nothing to play yet</h2>'
        +   '<p class="muted">Pick a faction and build an army first &mdash; Play mode is its game-day reference.</p>'
        +   '<button type="button" class="play-go-build">Go build an army</button>'
        + '</div>';
      host.appendChild(root);
      bindHandlers(root);
    }
    _root = root;
    return root;
  }

  function bindHandlers(root) {
    // Header: CP, layout toggle, reset, empty-state CTA.
    root.querySelector('.play-header').addEventListener('click', e => {
      const cp = e.target.closest('.play-cp-btn');
      if (cp) { onCp(parseInt(cp.dataset.cp, 10)); return; }
      const layoutBtn = e.target.closest('.play-layout-btn');
      if (layoutBtn) { onLayout(layoutBtn.dataset.layout); return; }
      if (e.target.closest('.play-reset')) { onReset(); return; }
      if (e.target.closest('.play-exit') && typeof App.setMode === 'function') App.setMode('build');
    });
    root.querySelector('.play-go-build').addEventListener('click', () => {
      if (typeof App.setMode === 'function') App.setMode('build');
    });
    // Tabs.
    root.querySelector('.play-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.play-tab');
      if (tab) setActiveTab(tab.dataset.tab);
    });
    // Unit switcher (delegated — chips are rebuilt by renderAll).
    root.querySelector('.play-switcher').addEventListener('click', e => {
      const chip = e.target.closest('.play-unit-chip');
      if (chip) setActiveEntry(chip.dataset.entryId);
    });
    // Body: per-sheet destroyed toggle + enhancement carrier jump-links.
    root.querySelector('.play-body').addEventListener('click', e => {
      const d = e.target.closest('.play-dead');
      if (d) { onDead(d.closest('[data-entry-id]').dataset.entryId); return; }
      const carrier = e.target.closest('.play-enh-carrier');
      if (carrier) {
        setActiveTab('sheets');
        setActiveEntry(carrier.dataset.entryId);
      }
    });
    // Swipe between sheets (phones). Skip touches that start inside a
    // weapon table so a horizontal table scroll doesn't page the sheet.
    const body = root.querySelector('.play-body');
    let touch = null;
    body.addEventListener('touchstart', e => {
      touch = null;
      if (_activeTab !== 'sheets') return;
      if (e.target.closest('.dcc-weapons, .detail-weapons-section, .play-sheet-head')) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (t) touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    body.addEventListener('touchend', e => {
      if (!touch) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepEntry(dx < 0 ? 1 : -1);
    }, { passive: true });
    // Arrow keys page sheets on desktop (and walk the row in row layout).
    document.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isHidden() || _activeTab !== 'sheets') return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      stepEntry(e.key === 'ArrowRight' ? 1 : -1);
    });
    // Desktop <-> phone crossing 820px re-applies the effective layout
    // without a re-render (row is desktop-only; phones always get single).
    if (typeof window.matchMedia === 'function') {
      _mql = window.matchMedia('(min-width: 821px)');
      const onMqChange = () => applyLayout();
      if (typeof _mql.addEventListener === 'function') _mql.addEventListener('change', onMqChange);
      else if (typeof _mql.addListener === 'function') _mql.addListener(onMqChange);
    }
  }

  function stepEntry(delta) {
    if (!_entryOrder.length) return;
    const idx = _entryOrder.indexOf(_activeEntry);
    const next = Math.min(_entryOrder.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + delta));
    if (_entryOrder[next] !== _activeEntry) setActiveEntry(_entryOrder[next]);
  }

  // ── switching (the hot path — class toggles only, no rendering) ───────
  function setActiveTab(id) {
    if (!TABS.some(([t]) => t === id)) return;
    _activeTab = id;
    if (_root) {
      _root.dataset.activeTab = id;
      _root.querySelectorAll('.play-tab').forEach(btn => {
        const on = btn.dataset.tab === id;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      _root.querySelectorAll('.play-panel').forEach(p => { p.hidden = p.dataset.panel !== id; });
    }
    persistView();
  }
  function setActiveEntry(entryId) {
    if (!entryId || _entryOrder.indexOf(entryId) === -1) return;
    _activeEntry = entryId;
    if (_root) {
      const row = _root.dataset.layout === 'row';
      _root.querySelectorAll('.play-sheet').forEach(s => {
        const on = s.dataset.entryId === entryId;
        s.classList.toggle('is-on', on);
        // Single: hidden toggle exactly as before. Row: every sheet stays
        // visible — the active one is marked and scrolled into the row.
        s.hidden = row ? false : !on;
        if (row && on) { try { s.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {} }
      });
      _root.querySelectorAll('.play-unit-chip').forEach(c => {
        const on = c.dataset.entryId === entryId;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) { try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {} }
      });
      if (!row) {
        const panel = _root.querySelector('.play-panel[data-panel="sheets"]');
        if (panel) panel.scrollTop = 0;
      }
    }
    persistView();
  }

  // Sheets-tab layout: 'single' (switcher rail, one sheet visible) or 'row'
  // (every sheet in one horizontal, sideways-scrolling strip — desktop only).
  // The stored preference and the EFFECTIVE layout can differ: phones always
  // render single regardless of what's stored. One function sets the
  // data-attribute, the toggle's pressed state, and re-runs setActiveEntry so
  // the active sheet's hidden/is-on state matches the layout that just
  // applied — called on toggle click, first render, and the media-query flip.
  function applyLayout() {
    if (!_root) return;
    const pref = view().layout;
    const wide = _mql ? _mql.matches : false;
    _root.dataset.layout = (pref === 'row' && wide) ? 'row' : 'single';
    _root.querySelectorAll('.play-layout-btn').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.layout === pref ? 'true' : 'false');
    });
    if (_activeEntry) setActiveEntry(_activeEntry);
  }
  function onLayout(pref) {
    if (pref !== 'single' && pref !== 'row') return;
    view().layout = pref;
    persistView();
    applyLayout();
  }

  // ── tracking ──────────────────────────────────────────────────────────
  function onCp(delta) {
    const army = getArmy(); if (!army || !army.id) return;
    writeGame(army.id, g => { g.cp = Math.max(0, (g.cp || 0) + delta); });
    applyGameState();
  }
  function onDead(vid) {
    const army = getArmy(); if (!army || !army.id) return;
    writeGame(army.id, g => {
      const u = g.units[vid] || (g.units[vid] = { dead: false });
      u.dead = !u.dead;
    });
    applyGameState();
  }
  function onReset() {
    const army = getArmy(); if (!army || !army.id) return;
    let ok = true;
    try { ok = window.confirm('Reset this game? CP and destroyed markers will be cleared.'); } catch (_) {}
    if (!ok) return;
    clearGame(army.id);
    applyGameState();
  }

  // Paint CP + per-sheet/chip dead state from stored game state. DOM-patch
  // only — never rebuilds innerHTML, so it's safe to call on every
  // tracker interaction.
  function applyGameState() {
    if (!_root) return;
    const army = getArmy();
    const g = (army && army.id) ? gameFor(army.id) : { cp: 0, units: {} };
    const cpEl = _root.querySelector('.play-cp-val');
    if (cpEl) cpEl.textContent = g.cp + ' CP';
    _virtual.forEach(({ vid }) => {
      if (!vid) return;
      const u = g.units[vid] || {};
      const dead = !!u.dead;
      const sheet = _root.querySelector('.play-sheet[data-entry-id="' + vid + '"]');
      if (sheet) {
        sheet.classList.toggle('is-dead', dead);
        const deadBtn = sheet.querySelector('.play-dead');
        if (deadBtn) {
          deadBtn.classList.toggle('is-on', dead);
          deadBtn.setAttribute('aria-pressed', dead ? 'true' : 'false');
          deadBtn.textContent = dead ? '☠ Destroyed' : '☠ Mark destroyed';
        }
      }
      const chip = _root.querySelector('.play-unit-chip[data-entry-id="' + vid + '"]');
      if (chip) chip.classList.toggle('is-dead', dead);
    });
  }

  // ── rendering (once per activation / army change) ─────────────────────
  function renderAll() {
    const root = ensureRoot();
    const cr = CR();
    if (!root || !cr) return;
    const army = getArmy();
    const faction = cr.getFaction();
    const layout = root.querySelector('.play-layout');
    const empty = root.querySelector('.play-empty');
    const header = root.querySelector('.play-header');

    // Nothing selected at all → full-page empty state.
    if (!army && !faction) {
      layout.hidden = true; header.hidden = true; empty.hidden = false;
      _rendered = true; _dirty = false;
      return;
    }
    layout.hidden = false; header.hidden = false; empty.hidden = true;

    // Header title. No points anywhere in play mode — game-day is rules
    // reference, not list-building.
    const nameEl = root.querySelector('.play-army-name');
    if (nameEl) nameEl.textContent = (army && army.name) || (faction && faction.factionName) || '';

    renderSheets(root, cr, army);
    renderStrats(root, cr);
    renderRules(root, cr, faction);
    renderEnhance(root, cr, army);

    // Restore the last-viewed sheet for this army (or fall back to first).
    const v = view();
    const remembered = army && army.id ? v.entryByArmy[army.id] : null;
    _activeEntry = (_entryOrder.indexOf(remembered) !== -1) ? remembered : (_entryOrder[0] || null);
    if (_activeEntry) setActiveEntry(_activeEntry);
    setActiveTab(_activeTab);
    applyLayout();
    applyGameState();
    _rendered = true; _dirty = false;
  }

  // Grouped Details-pane renders: emit group headers + one host div per
  // item, then call UI.renderRuleDetail into each host — the exact markup
  // build mode shows when a stratagem/rule/enhancement is clicked.
  // groups: [{label, items}]; render(item, host) fills one host.
  function renderRuleHosts(panel, groups, render) {
    panel.innerHTML = groups.map((g, gi) =>
      '<h2 class="play-group-head">' + esc(g.label) + '</h2>'
      + '<div class="play-card-list">'
      + g.items.map((_, ii) =>
          '<div class="play-detail-host play-rule-host" data-g="' + gi + '" data-i="' + ii + '"></div>'
        ).join('')
      + '</div>'
    ).join('');
    panel.querySelectorAll('.play-rule-host').forEach(host => {
      const item = groups[+host.dataset.g].items[+host.dataset.i];
      try { render(item, host); } catch (e) {
        host.innerHTML = '<p class="muted">Could not render this entry.</p>';
        try { console.warn('[play-mode] rule render failed:', e && e.message); } catch (_) {}
      }
    });
  }

  function renderSheets(root, cr, army) {
    const switcher = root.querySelector('.play-switcher');
    const panel = root.querySelector('.play-panel[data-panel="sheets"]');
    const ordered = orderedEntries(army);
    _virtual = ordered;
    _entryOrder = ordered.map(o => o.vid).filter(Boolean);
    if (!ordered.length) {
      switcher.innerHTML = '';
      panel.innerHTML = '<div class="play-panel-empty"><p class="muted">No units in this army yet.</p>'
        + '<button type="button" class="play-go-build">Go build an army</button></div>';
      const btn = panel.querySelector('.play-go-build');
      if (btn) btn.addEventListener('click', () => { if (App.setMode) App.setMode('build'); });
      return;
    }
    switcher.innerHTML = ordered.map(({ entry, isLeader, vid, copy }) => {
      const label = sheetLabel(entry, copy);
      return '<button type="button" class="play-unit-chip' + (isLeader ? ' is-leader' : '')
        + '" role="tab" aria-selected="false" data-entry-id="' + esc(vid) + '">'
        + (isLeader ? '<span class="play-chip-lead" aria-hidden="true">⤷</span>' : '')
        + '<span class="play-chip-name">' + esc(label) + '</span>'
        + '</button>';
    }).join('');
    panel.innerHTML = ordered.map(({ entry, vid, copy }) => {
      const label = sheetLabel(entry, copy);
      return '<div class="play-sheet" data-entry-id="' + esc(vid) + '" hidden>'
        + '<div class="play-sheet-head" data-entry-id="' + esc(vid) + '">'
        +   '<span class="play-sheet-name">' + esc(label) + '</span>'
        +   '<button type="button" class="play-dead" aria-pressed="false">☠ Mark destroyed</button>'
        + '</div>'
        + '<div class="play-detail-host"></div>'
        + '</div>';
    }).join('');
    // Datasheets are the build-mode Details pane, rendered into each sheet's
    // host (UI.renderUnitDetail with opts.host + gameView — no Add to Army,
    // no pickers; the entry's own enhancements render read-only).
    ordered.forEach(({ entry, vid }) => {
      const sheet = panel.querySelector('.play-sheet[data-entry-id="' + vid + '"]');
      const host = sheet && sheet.querySelector('.play-detail-host');
      if (!host) return;
      const unit = (typeof App.findUnit === 'function' && App.findUnit(entry.unitId, army.factionName))
        || entry.unitData || {};
      try {
        UI.renderUnitDetail(unit, [], entry.enhancements || [], { host, gameView: true });
      } catch (e) {
        host.innerHTML = '<p class="muted">Could not render this datasheet.</p>';
        try { console.warn('[play-mode] renderUnitDetail failed:', e && e.message); } catch (_) {}
      }
    });
  }

  function renderStrats(root, cr) {
    const panel = root.querySelector('.play-panel[data-panel="strats"]');
    const items = cr.gatherStratagems();
    if (!items.length) {
      panel.innerHTML = '<div class="play-panel-empty"><p class="muted">No stratagems &mdash; pick a detachment first.</p></div>';
      return;
    }
    // Flat list, grouped by source: each detachment first, then faction, core.
    const groups = [];   // [label, items[]] in insertion order
    const byLabel = new Map();
    function group(label) {
      if (!byLabel.has(label)) { const g = { label, items: [] }; byLabel.set(label, g); groups.push(g); }
      return byLabel.get(label);
    }
    items.forEach(item => {
      const label = item.type === 'detachment' ? ((item.detName || 'Detachment') + ' stratagems')
        : item.type === 'faction' ? 'Faction stratagems'
        : 'Core stratagems';
      group(label).items.push(item);
    });
    renderRuleHosts(panel, groups, (item, host) => {
      const s = item.strat || {};
      UI.renderRuleDetail({
        type: 'stratagem',
        name: s.name,
        description: s.description,
        cp: s.cp != null ? s.cp : null,
        phase: s.phase || null,
      }, { host, gameView: true });
    });
  }

  function renderRules(root, cr, faction) {
    const panel = root.querySelector('.play-panel[data-panel="rules"]');
    const groups = [];
    // Detachment rules first: they are the ones that change list to list
    // (and get forgotten); the army rule is the same every game.
    const seen = new Set();
    cr.getSelectedDetachments().forEach(det => {
      if (!det || !Array.isArray(det.rules)) return;
      const rules = det.rules.filter(r => r && r.name && !seen.has(r.name));
      rules.forEach(r => seen.add(r.name));
      if (!rules.length) return;
      groups.push({
        label: det.name || 'Detachment',
        items: rules.map(r => ({ rule: r, kindLabel: 'Detachment Rule' })),
      });
    });
    const armyRules = (faction && Array.isArray(faction.armyRules)) ? faction.armyRules.filter(r => r && r.name) : [];
    if (armyRules.length) {
      groups.push({ label: 'Army rules', items: armyRules.map(r => ({ rule: r, kindLabel: 'Army Rule' })) });
    }
    if (!groups.length) {
      panel.innerHTML = '<div class="play-panel-empty"><p class="muted">No rules to show &mdash; pick a faction and detachment first.</p></div>';
      return;
    }
    renderRuleHosts(panel, groups, (item, host) => {
      UI.renderRuleDetail({
        type: 'rule',
        kindLabel: item.kindLabel,
        name: item.rule.name,
        description: item.rule.description,
      }, { host, gameView: true });
    });
  }

  function renderEnhance(root, cr, army) {
    const panel = root.querySelector('.play-panel[data-panel="enhance"]');
    // The army's chosen enhancements first, each linked to its carrier.
    const taken = [];
    ((army && army.entries) || []).forEach(entry => {
      (entry && Array.isArray(entry.enhancements) ? entry.enhancements : []).forEach(e => {
        if (e && e.name) taken.push({ enh: e, entry });
      });
    });
    const takenNames = new Set(taken.map(t => t.enh.name));
    const groups = [];
    if (taken.length) {
      groups.push({ label: 'In this army', items: taken.map(t => ({ enh: t.enh, entry: t.entry, kind: 'taken' })) });
    }
    // Everything the selected detachments offer, for reference.
    cr.getSelectedDetachments().forEach(det => {
      const enhs = (det && Array.isArray(det.enhancements)) ? det.enhancements.filter(e => e && e.name) : [];
      if (!enhs.length) return;
      groups.push({
        label: (det.name || 'Detachment') + ' enhancements',
        items: enhs.map(e => ({ enh: e, kind: 'all' })),
      });
    });
    if (!groups.length) {
      panel.innerHTML = '<div class="play-panel-empty"><p class="muted">No enhancements &mdash; pick a detachment first.</p></div>';
      return;
    }
    renderRuleHosts(panel, groups, (item, host) => {
      UI.renderRuleDetail({
        type: 'enhancement',
        name: item.enh.name,
        description: item.enh.description,
      }, { host, gameView: true });
      const main = host.querySelector('.detail-header-main');
      if (item.kind === 'taken' && item.entry && main) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'play-enh-carrier';
        btn.dataset.entryId = item.entry.entryId;
        btn.textContent = 'On: ' + (item.entry.customName || item.entry.unitName || 'Unit');
        main.appendChild(btn);
      } else if (item.kind === 'all' && takenNames.has(item.enh.name)) {
        host.classList.add('is-taken');
        const eyebrow = host.querySelector('.detail-eyebrow');
        if (eyebrow) {
          const badge = document.createElement('span');
          badge.className = 'play-enh-taken-badge';
          badge.textContent = 'TAKEN';
          eyebrow.appendChild(badge);
        }
      }
    });
  }

  // ── activation + hooks ────────────────────────────────────────────────
  function activate() {
    const root = ensureRoot();
    if (!root) return;
    if (!_mounted) {
      _mounted = true;
      _activeTab = view().tab || 'sheets';
      if (!TABS.some(([t]) => t === _activeTab)) _activeTab = 'sheets';
    }
    if (_dirty || !_rendered) renderAll();
  }

  function onArmyMaybeChanged() {
    if (!isHidden()) renderAll();
    else _dirty = true;
  }

  if (!Array.isArray(App.hooks.modeChange)) App.hooks.modeChange = [];
  App.hooks.modeChange.push(mode => { if (mode === 'play') activate(); });
  document.addEventListener('yaab:mode-change', e => {
    if (e && e.detail && e.detail.mode === 'play') activate();
  });
  if (Array.isArray(App.hooks.armyChange)) App.hooks.armyChange.push(onArmyMaybeChanged);
  if (Array.isArray(App.hooks.selectionChange)) App.hooks.selectionChange.push(onArmyMaybeChanged);

  App.hooks.bootstrap.push(function () {
    // The old cockpit play mode's keys — nothing can read them anymore.
    try {
      localStorage.removeItem('yaab_match_state');
      localStorage.removeItem('yaab_play_tab');
    } catch (_) {}
    const host = document.getElementById('play-mode');
    if (host && (host.classList.contains('mode-active') ||
                 (document.body && document.body.getAttribute('data-mode') === 'play'))
              && !host.hidden) {
      activate();
    }
  });

  // Desktop entry: a top-bar shelf button (whitelisted in TOPBAR_SHELF_IDS,
  // js/app/index.js). The Settings-drawer GO row covers mobile (and desktop).
  App.hooks.armyToolbarActions.push({
    id: 'btn-play-mode',
    region: 'icon',
    glyph: '⚔',
    label: 'Play',
    title: 'Open Play mode — a fast-switching game-day reference for this army',
    onClick: function () { App.openPlayMode(); },
  });

  // ── public surface ────────────────────────────────────────────────────
  App.openPlayMode = function () {
    if (typeof App.setMode === 'function') App.setMode('play');
  };
  App.playMode = {
    activate,
    refresh: function () { if (_rendered) renderAll(); },
  };
})();
