// ui/play-mode.js — Play mode: a fast-switching game-day reference.
//
// The whole design serves one goal: switching between datasheets, stratagems,
// rules and enhancements must be instant. Everything is rendered into the DOM
// ONCE per activation (armies are 10-25 entries — milliseconds); switching
// sheets or tabs only toggles `hidden`/class state, never re-renders.
//
// Light tracking on top: a CP counter in the header and a per-entry dead
// toggle + wounds stepper on each sheet. Deliberately NOT a cockpit — no
// phase tracker, no scorepad (the old play mode was that, and was removed).
//
// Datasheet/stratagem/rule markup comes from App.CardRenderers, the shared
// facade cards-mode.js exposes over its print-card renderers, so Play mode
// shows the exact same corrected data as the printable cards.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_VIEW = 'yaab_play_view';   // { tab, entryByArmy: {armyId: entryId} }
  const LS_GAME = 'yaab_play_game';   // { [armyId]: {cp, startedAt, touchedAt, units:{[entryId]:{w,dead}}} }
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
  let _activeEntry = null;   // entryId of the visible sheet
  let _entryOrder = [];      // entryIds in switcher order (for swipe prev/next)
  let _saveTimer  = 0;

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
    if (!_view) _view = lsRead(LS_VIEW, { tab: 'sheets', entryByArmy: {} });
    if (!_view.entryByArmy || typeof _view.entryByArmy !== 'object') _view.entryByArmy = {};
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
    // GC: drop tracking for entries no longer in the army.
    const army = getArmy();
    if (army && army.id === armyId && Array.isArray(army.entries)) {
      const live = new Set(army.entries.map(e => e.entryId).filter(Boolean));
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

  // ── army entry ordering + wound math ──────────────────────────────────
  // Attached leaders sit immediately after their bodyguard entry so the
  // switcher reads like the army list does ("who is this squad, who leads it").
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
    roots.forEach(e => {
      out.push({ entry: e, isLeader: false });
      (byParent.get(e.entryId) || []).forEach(l => out.push({ entry: l, isLeader: true }));
    });
    return out;
  }
  // {models, perModelW, maxW} for the wounds stepper. Per-entry, not
  // per-model, on purpose: max = models × first-profile W. Non-numeric W
  // (e.g. "—") → maxW 0, which hides the stepper but keeps the dead toggle.
  function unitMeta(entry) {
    const unit = entry.unitData || {};
    let models = null;
    (unit.squadOptions || []).forEach(o => {
      if (models == null && o && o.pts === entry.selectedPts) models = o.models;
    });
    if (models == null) {
      const n = parseInt(String(entry.squadLabel || '').replace(/[^\d]/g, ''), 10);
      if (n > 0) models = n;
    }
    if (models == null) models = 1;
    const stats = (Array.isArray(unit.modelStats) && unit.modelStats[0]) || unit.stats || {};
    const perModelW = parseInt(String(stats.W != null ? stats.W : ''), 10);
    const maxW = (perModelW > 0) ? perModelW * models : 0;
    return { models, perModelW: perModelW > 0 ? perModelW : 0, maxW };
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
        +   '<div class="play-title"><span class="play-army-name"></span><span class="play-army-pts"></span></div>'
        +   '<div class="play-cp" role="group" aria-label="Command points">'
        +     '<button type="button" class="play-cp-btn" data-cp="-1" aria-label="Spend a command point">&minus;</button>'
        +     '<span class="play-cp-val" aria-live="polite">0 CP</span>'
        +     '<button type="button" class="play-cp-btn" data-cp="1" aria-label="Gain a command point">+</button>'
        +   '</div>'
        +   '<button type="button" class="play-reset">Reset game</button>'
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
    // Header: CP, reset, empty-state CTA.
    root.querySelector('.play-header').addEventListener('click', e => {
      const cp = e.target.closest('.play-cp-btn');
      if (cp) { onCp(parseInt(cp.dataset.cp, 10)); return; }
      if (e.target.closest('.play-reset')) onReset();
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
    // Body: per-sheet trackers + enhancement carrier jump-links.
    root.querySelector('.play-body').addEventListener('click', e => {
      const w = e.target.closest('.play-w-btn');
      if (w) { onWounds(w.closest('[data-entry-id]').dataset.entryId, parseInt(w.dataset.w, 10)); return; }
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
      if (e.target.closest('.dcc-weapons, .play-tracker')) return;
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
    // Arrow keys page sheets on desktop.
    document.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isHidden() || _activeTab !== 'sheets') return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      stepEntry(e.key === 'ArrowRight' ? 1 : -1);
    });
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
      _root.querySelectorAll('.play-sheet').forEach(s => { s.hidden = s.dataset.entryId !== entryId; });
      _root.querySelectorAll('.play-unit-chip').forEach(c => {
        const on = c.dataset.entryId === entryId;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) { try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {} }
      });
      const panel = _root.querySelector('.play-panel[data-panel="sheets"]');
      if (panel) panel.scrollTop = 0;
    }
    persistView();
  }

  // ── tracking ──────────────────────────────────────────────────────────
  function onCp(delta) {
    const army = getArmy(); if (!army || !army.id) return;
    writeGame(army.id, g => { g.cp = Math.max(0, (g.cp || 0) + delta); });
    applyGameState();
  }
  function onWounds(entryId, delta) {
    const army = getArmy(); if (!army || !army.id) return;
    const entry = (army.entries || []).find(e => e && e.entryId === entryId);
    if (!entry) return;
    const meta = unitMeta(entry);
    if (!meta.maxW) return;
    writeGame(army.id, g => {
      const u = g.units[entryId] || (g.units[entryId] = { w: meta.maxW, dead: false });
      if (typeof u.w !== 'number') u.w = meta.maxW;
      u.w = Math.min(meta.maxW, Math.max(0, u.w + delta));
      // Single models: 0 wounds IS dead (and healing back revives). Squads
      // lose models, not the unit, so the skull stays manual there.
      if (meta.models === 1) u.dead = u.w === 0;
    });
    applyGameState();
  }
  function onDead(entryId) {
    const army = getArmy(); if (!army || !army.id) return;
    const entry = (army.entries || []).find(e => e && e.entryId === entryId);
    if (!entry) return;
    const meta = unitMeta(entry);
    writeGame(army.id, g => {
      const u = g.units[entryId] || (g.units[entryId] = { w: meta.maxW, dead: false });
      u.dead = !u.dead;
    });
    applyGameState();
  }
  function onReset() {
    const army = getArmy(); if (!army || !army.id) return;
    let ok = true;
    try { ok = window.confirm('Reset this game? CP and all wound/dead tracking will be cleared.'); } catch (_) {}
    if (!ok) return;
    clearGame(army.id);
    applyGameState();
  }

  // Paint CP + per-sheet trackers + chip dim/badges from stored game state.
  // DOM-patch only — never rebuilds innerHTML, so it's safe to call on every
  // tracker interaction.
  function applyGameState() {
    if (!_root) return;
    const army = getArmy();
    const g = (army && army.id) ? gameFor(army.id) : { cp: 0, units: {} };
    const cpEl = _root.querySelector('.play-cp-val');
    if (cpEl) cpEl.textContent = g.cp + ' CP';
    const entries = (army && army.entries) || [];
    entries.forEach(entry => {
      if (!entry || !entry.entryId) return;
      const meta = unitMeta(entry);
      const u = g.units[entry.entryId] || {};
      const w = (typeof u.w === 'number') ? Math.min(meta.maxW, Math.max(0, u.w)) : meta.maxW;
      const dead = !!u.dead;
      const sheet = _root.querySelector('.play-sheet[data-entry-id="' + entry.entryId + '"]');
      if (sheet) {
        sheet.classList.toggle('is-dead', dead);
        const wVal = sheet.querySelector('.play-w-val');
        if (wVal) wVal.textContent = String(w);
        const deadBtn = sheet.querySelector('.play-dead');
        if (deadBtn) {
          deadBtn.classList.toggle('is-on', dead);
          deadBtn.setAttribute('aria-pressed', dead ? 'true' : 'false');
          deadBtn.textContent = dead ? '☠ Destroyed' : '☠ Mark destroyed';
        }
      }
      const chip = _root.querySelector('.play-unit-chip[data-entry-id="' + entry.entryId + '"]');
      if (chip) {
        chip.classList.toggle('is-dead', dead);
        const badge = chip.querySelector('.play-chip-w');
        if (badge) {
          const show = meta.maxW > 0 && w < meta.maxW && !dead;
          badge.hidden = !show;
          if (show) badge.textContent = w + '/' + meta.maxW;
        }
      }
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

    // Header title.
    const nameEl = root.querySelector('.play-army-name');
    const ptsEl = root.querySelector('.play-army-pts');
    if (nameEl) nameEl.textContent = (army && army.name) || (faction && faction.factionName) || '';
    let pts = 0;
    try { pts = army && army.getTotalPoints ? army.getTotalPoints() : 0; } catch (_) {}
    if (ptsEl) ptsEl.textContent = pts ? (pts + ' pts') : '';

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
    applyGameState();
    _rendered = true; _dirty = false;
  }

  function cardArticle(kind, html) {
    return '<article class="dcc-card dcc-card-' + kind + ' dcc-tpl-classic">' + html + '</article>';
  }

  function renderSheets(root, cr, army) {
    const switcher = root.querySelector('.play-switcher');
    const panel = root.querySelector('.play-panel[data-panel="sheets"]');
    const ordered = orderedEntries(army);
    _entryOrder = ordered.map(o => o.entry.entryId).filter(Boolean);
    if (!ordered.length) {
      switcher.innerHTML = '';
      panel.innerHTML = '<div class="play-panel-empty"><p class="muted">No units in this army yet.</p>'
        + '<button type="button" class="play-go-build">Go build an army</button></div>';
      const btn = panel.querySelector('.play-go-build');
      if (btn) btn.addEventListener('click', () => { if (App.setMode) App.setMode('build'); });
      return;
    }
    switcher.innerHTML = ordered.map(({ entry, isLeader }) => {
      const name = entry.customName || entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit';
      const count = entry.count > 1 ? ' ×' + entry.count : '';
      let epts = 0;
      try { epts = army.getEntryPoints ? army.getEntryPoints(army.entries.indexOf(entry)) : 0; } catch (_) {}
      return '<button type="button" class="play-unit-chip' + (isLeader ? ' is-leader' : '')
        + '" role="tab" aria-selected="false" data-entry-id="' + esc(entry.entryId) + '">'
        + (isLeader ? '<span class="play-chip-lead" aria-hidden="true">⤷</span>' : '')
        + '<span class="play-chip-name">' + esc(name + count) + '</span>'
        + '<span class="play-chip-side">'
        +   '<span class="play-chip-w" hidden></span>'
        +   (epts ? '<span class="play-chip-pts">' + epts + '</span>' : '')
        + '</span>'
        + '</button>';
    }).join('');
    panel.innerHTML = ordered.map(({ entry }) => {
      const meta = unitMeta(entry);
      const wounds = meta.maxW
        ? '<div class="play-wounds" role="group" aria-label="Wounds remaining">'
          + '<button type="button" class="play-w-btn" data-w="-1" aria-label="Lose a wound">&minus;</button>'
          + '<span class="play-w-num"><span class="play-w-val">' + meta.maxW + '</span>/' + meta.maxW + ' W</span>'
          + '<button type="button" class="play-w-btn" data-w="1" aria-label="Heal a wound">+</button>'
          + '</div>'
        : '';
      return '<div class="play-sheet" data-entry-id="' + esc(entry.entryId) + '" hidden>'
        + '<div class="play-tracker" data-entry-id="' + esc(entry.entryId) + '">'
        +   '<button type="button" class="play-dead" aria-pressed="false">☠ Mark destroyed</button>'
        +   wounds
        + '</div>'
        + cardArticle('unit', cr.renderUnitCard(entry))
        + '</div>';
    }).join('');
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
    panel.innerHTML = groups.map(g =>
      '<h2 class="play-group-head">' + esc(g.label) + '</h2>'
      + '<div class="play-card-list">'
      + g.items.map(item => cardArticle('strat', cr.renderStratagemCard(item))).join('')
      + '</div>'
    ).join('');
  }

  function renderRules(root, cr, faction) {
    const panel = root.querySelector('.play-panel[data-panel="rules"]');
    let html = '';
    const armyRules = (faction && Array.isArray(faction.armyRules)) ? faction.armyRules.filter(r => r && r.name) : [];
    if (armyRules.length) {
      html += '<h2 class="play-group-head">Army rules</h2><div class="play-card-list">'
        + armyRules.map(r => cardArticle('rule', cr.renderRuleCard({ kind: 'army', rule: r, label: r.name }))).join('')
        + '</div>';
    }
    const seen = new Set();
    cr.getSelectedDetachments().forEach(det => {
      if (!det || !Array.isArray(det.rules)) return;
      const rules = det.rules.filter(r => r && r.name && !seen.has(r.name));
      rules.forEach(r => seen.add(r.name));
      if (!rules.length) return;
      html += '<h2 class="play-group-head">' + esc(det.name || 'Detachment') + '</h2><div class="play-card-list">'
        + rules.map(r => cardArticle('rule', cr.renderRuleCard({ kind: 'detachment', rule: r, label: r.name }))).join('')
        + '</div>';
    });
    panel.innerHTML = html
      || '<div class="play-panel-empty"><p class="muted">No rules to show &mdash; pick a faction and detachment first.</p></div>';
  }

  function renderEnhance(root, cr, army) {
    const panel = root.querySelector('.play-panel[data-panel="enhance"]');
    let html = '';
    // The army's chosen enhancements first, each linked to its carrier.
    const taken = [];
    ((army && army.entries) || []).forEach(entry => {
      (entry && Array.isArray(entry.enhancements) ? entry.enhancements : []).forEach(e => {
        if (e && e.name) taken.push({ enh: e, entry });
      });
    });
    const takenNames = new Set(taken.map(t => t.enh.name));
    if (taken.length) {
      html += '<h2 class="play-group-head">In this army</h2><div class="play-card-list">'
        + taken.map(({ enh, entry }) => {
          const carrier = entry.customName || entry.unitName || 'Unit';
          return '<article class="dcc-card dcc-card-rule dcc-tpl-classic play-enh-card">'
            + '<header class="dcc-head dcc-head-rule"><div class="dcc-name-line">'
            +   '<h1 class="dcc-name">' + esc(enh.name) + '</h1>'
            +   (enh.pts ? '<span class="dcc-pts">+' + esc(String(enh.pts)) + ' pts</span>' : '')
            + '</div>'
            + '<div class="dcc-sub-line"><span class="dcc-role">ENHANCEMENT</span>'
            +   '<button type="button" class="play-enh-carrier" data-entry-id="' + esc(entry.entryId) + '">'
            +     'On: ' + esc(carrier) + '</button>'
            + '</div></header>'
            + '<div class="dcc-section dcc-rule-body"><div class="dcc-rule-text">' + cr.descHtml(enh.description) + '</div></div>'
            + '</article>';
        }).join('')
        + '</div>';
    }
    // Everything the selected detachments offer, for reference.
    cr.getSelectedDetachments().forEach(det => {
      const enhs = (det && Array.isArray(det.enhancements)) ? det.enhancements.filter(e => e && e.name) : [];
      if (!enhs.length) return;
      html += '<h2 class="play-group-head">' + esc(det.name || 'Detachment') + ' enhancements</h2>'
        + '<div class="play-card-list play-enh-all">'
        + enhs.map(e =>
            '<article class="dcc-card dcc-card-rule dcc-tpl-classic play-enh-card'
            + (takenNames.has(e.name) ? ' is-taken' : '') + '">'
            + '<header class="dcc-head dcc-head-rule"><div class="dcc-name-line">'
            +   '<h1 class="dcc-name">' + esc(e.name) + '</h1>'
            +   '<span class="play-enh-side">'
            +     (takenNames.has(e.name) ? '<span class="play-enh-taken-badge">TAKEN</span>' : '')
            +     (e.pts ? '<span class="dcc-pts">+' + esc(String(e.pts)) + ' pts</span>' : '')
            +   '</span>'
            + '</div></header>'
            + '<div class="dcc-section dcc-rule-body"><div class="dcc-rule-text">' + cr.descHtml(e.description) + '</div></div>'
            + '</article>'
          ).join('')
        + '</div>';
    });
    panel.innerHTML = html
      || '<div class="play-panel-empty"><p class="muted">No enhancements &mdash; pick a detachment first.</p></div>';
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
