// app/kill-team.js — small-format game mode: cap points, filter roster, mission roller, faction templates.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_kt_mode';
  const KT_POINTS = 200;
  const KT_SUGGEST_THRESHOLD = 250;

  let active = false;
  let modalEl = null;
  let bannerEl = null;
  let lastMission = null;

  // ── Templates ──────────────────────────────────────────────────────────
  // Each entry mirrors the shape used in starter-lists.js: nameMatches is a
  // case-insensitive substring test against unit.name within the faction.
  const TEMPLATES = [
    {
      id: 'kt-sm',
      title: 'Space Marines Strike Team',
      faction: 'Imperium - Adeptus Astartes - Space Marines',
      description: 'Captain leads a Tactical fire-base with Eliminators on overwatch.',
      units: [
        { nameMatches: 'Captain', count: 1 },
        { nameMatches: 'Tactical Squad', count: 1 },
        { nameMatches: 'Eliminator Squad', count: 1 },
      ],
    },
    {
      id: 'kt-tyranids',
      title: 'Tyranids Vanguard Brood',
      faction: 'Tyranids',
      description: 'A Hive Tyrant directs a screen of Termagants and lurking Genestealers.',
      units: [
        { nameMatches: 'Hive Tyrant', count: 1 },
        { nameMatches: 'Termagants', count: 1 },
        { nameMatches: 'Genestealers', count: 1 },
      ],
    },
    {
      id: 'kt-necrons',
      title: 'Necrons Awakened Patrol',
      faction: 'Necrons',
      description: 'An Overlord oversees Warriors and Immortals in a re-animating phalanx.',
      units: [
        { nameMatches: 'Overlord', count: 1 },
        { nameMatches: 'Necron Warriors', count: 1 },
        { nameMatches: 'Immortals', count: 1 },
      ],
    },
    {
      id: 'kt-orks',
      title: 'Orks Boyz Mob',
      faction: 'Orks',
      description: 'Warboss leads a green tide with Tankbustas hunting the heavy stuff.',
      units: [
        { nameMatches: 'Warboss', count: 1 },
        { nameMatches: 'Boyz', count: 1 },
        { nameMatches: 'Tankbustas', count: 1 },
      ],
    },
    {
      id: 'kt-aeldari',
      title: 'Aeldari Ranger Patrol',
      faction: 'Aeldari',
      description: 'A Farseer guides Guardian Defenders and Rangers through quick strikes.',
      units: [
        { nameMatches: 'Farseer', count: 1 },
        { nameMatches: 'Guardian Defenders', count: 1 },
        { nameMatches: 'Rangers', count: 1 },
      ],
    },
    {
      id: 'kt-admech',
      title: 'Adeptus Mechanicus Reconnaissance',
      faction: 'Imperium - Adeptus Mechanicus',
      description: 'A Tech-Priest guides Skitarii Vanguard and Rangers across hostile ground.',
      units: [
        { nameMatches: 'Tech-Priest', count: 1 },
        { nameMatches: 'Skitarii Vanguard', count: 1 },
        { nameMatches: 'Skitarii Rangers', count: 1 },
      ],
    },
  ];

  // ── Missions ───────────────────────────────────────────────────────────
  const MISSIONS = [
    { name: 'Recover Intel',  desc: 'Control the central objective at the end of turn 4 to win.' },
    { name: 'Sabotage',       desc: 'A single enemy unit is marked at deployment; destroy it to win.' },
    { name: 'Hold The Line',  desc: 'Score points for each enemy unit you eliminate over the game.' },
    { name: "Smoke 'em Out",  desc: 'Destroy 50% of the enemy units (rounded up) to win.' },
    { name: 'Vanguard Strike', desc: "Score points for each unit wholly within your opponent's deployment zone." },
  ];

  // ── Helpers (local copies; no shared deps) ─────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function findFaction(name) {
    const facs = (App.state && App.state.factions) || [];
    if (!name) return null;
    const direct = facs.find(f => f.factionName === name);
    if (direct) return direct;
    const t = shortFaction(name).toLowerCase();
    return facs.find(f => shortFaction(f.factionName).toLowerCase() === t) || null;
  }

  function factionUnits(faction) {
    if (!faction) return [];
    return (faction.units || []).filter(u => u && u.name);
  }

  function findUnitByName(units, needle) {
    const n = (needle || '').toLowerCase();
    if (!n) return null;
    const exact = units.find(u => u.name && u.name.toLowerCase() === n);
    if (exact) return exact;
    return units.find(u => u.name && u.name.toLowerCase().includes(n)) || null;
  }

  function unitBasePoints(u) {
    if (typeof u.points === 'number' && u.points > 0) return u.points;
    const sq = u.squadOptions || [];
    if (sq.length && typeof sq[0].pts === 'number') return sq[0].pts;
    const po = u.pointsOptions || [];
    if (po.length && typeof po[0].pts === 'number') return po[0].pts;
    return 0;
  }

  function hasKw(unit, kw) {
    const k = (kw || '').toLowerCase();
    return (unit.keywords || []).some(x => {
      const s = typeof x === 'string' ? x : (x && (x.name || x.keyword)) || '';
      return s.toLowerCase() === k;
    });
  }

  function statW(unit) {
    const stats = unit && unit.stats;
    if (!stats) return 0;
    const raw = stats['W'] != null ? stats['W'] : stats['w'];
    const m = String(raw || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function isSingleModel(u) {
    const sq = u.squadOptions || [];
    if (sq.length === 0) return true;
    return sq.every(o => (o.models || 1) <= 1);
  }

  // ── Roster filter heuristic ─────────────────────────────────────────────
  // Conservative: keep if Infantry, OR points <= 150,
  // OR (single-model AND points <= 200). Always cull big Vehicles/Monsters
  // (W > 10) regardless. Default-allow if we can't tell.
  function filterForKt(unit) {
    if (!active || !unit) return true;
    const pts = unitBasePoints(unit);
    const w   = statW(unit);
    const isVehicle = hasKw(unit, 'Vehicle');
    const isMonster = hasKw(unit, 'Monster');
    const isInfantry = hasKw(unit, 'Infantry');

    // Hard-cull oversize Vehicles/Monsters.
    if ((isVehicle || isMonster) && w > 10) return false;
    if (pts > 200 && !isInfantry) return false;

    if (isInfantry) return true;
    if (pts > 0 && pts <= 150) return true;
    if (isSingleModel(unit) && pts > 0 && pts <= 200) return true;

    // Unknown points or other types: default-keep so we don't accidentally
    // hide everything when data is partial.
    if (pts === 0) return true;
    return false;
  }
  filterForKt._isKtPredicate = true;

  function ensureFilterRegistered() {
    if (!App.hooks || !Array.isArray(App.hooks.rosterFilters)) return;
    // Dedupe-strip any stale predicate before pushing.
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isKtPredicate);
    App.hooks.rosterFilters.push(filterForKt);
  }

  function unregisterFilter() {
    if (!App.hooks || !Array.isArray(App.hooks.rosterFilters)) return;
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isKtPredicate);
  }

  // ── Banner ─────────────────────────────────────────────────────────────
  function updateBanner() {
    const host = document.querySelector('#panel-center .panel-controls');
    if (!host) return;
    if (!bannerEl || !host.contains(bannerEl)) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'yaab-kt-banner';
      bannerEl.className = 'kt-banner';
      host.insertBefore(bannerEl, host.firstChild);
    }
    if (!active) { bannerEl.hidden = true; bannerEl.innerHTML = ''; return; }

    const limitInput = document.getElementById('points-limit-input');
    const cur = limitInput ? Number(limitInput.value) : 0;
    const overCap = cur > KT_SUGGEST_THRESHOLD;

    bannerEl.hidden = false;
    bannerEl.innerHTML =
      '<span class="kt-banner-tag">Kill Team</span>' +
      '<span class="kt-banner-text">Small-format mode active &mdash; list scaled to ' +
        KT_POINTS + 'pts, big units filtered.' +
        (overCap ? ' <button type="button" class="kt-banner-action" data-kt-act="set-cap">Set ' + KT_POINTS + 'pt cap</button>' : '') +
      '</span>' +
      '<button type="button" class="kt-banner-close" aria-label="Turn off Kill Team mode">&times;</button>';

    const closeBtn = bannerEl.querySelector('.kt-banner-close');
    if (closeBtn) closeBtn.addEventListener('click', () => setActive(false));
    const act = bannerEl.querySelector('[data-kt-act="set-cap"]');
    if (act) act.addEventListener('click', applyPointsCap);
  }

  function applyPointsCap() {
    const limitInput = document.getElementById('points-limit-input');
    if (!limitInput) return;
    limitInput.value = KT_POINTS;
    limitInput.dispatchEvent(new Event('change'));
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Points limit set to ' + KT_POINTS + ' for Kill Team', 'success');
    }
    updateBanner();
  }

  // ── State toggle ───────────────────────────────────────────────────────
  function setActive(next) {
    active = !!next;
    try { localStorage.setItem(LS_KEY, active ? '1' : '0'); } catch (_) {}

    if (active) {
      document.body.classList.add('kt-mode');
      ensureFilterRegistered();
    } else {
      document.body.classList.remove('kt-mode');
      unregisterFilter();
    }

    updateBanner();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
    renderModal();

    if (active && window.UI && typeof UI.toast === 'function') {
      const limitInput = document.getElementById('points-limit-input');
      const cur = limitInput ? Number(limitInput.value) : 0;
      if (cur > KT_SUGGEST_THRESHOLD) {
        UI.toast('Kill Team mode on. Tip: drop your points limit to ' + KT_POINTS + '.', 'info', 5000);
      } else {
        UI.toast('Kill Team mode on.', 'success');
      }
    }
  }

  // ── Templates: prepare + apply ─────────────────────────────────────────
  function prepareTemplate(tpl) {
    const faction = findFaction(tpl.faction);
    if (!faction) return { ok: false, reason: 'Faction "' + shortFaction(tpl.faction) + '" not loaded yet.' };
    const units = factionUnits(faction);
    const pairs = [];
    const missing = [];
    tpl.units.forEach(req => {
      const u = findUnitByName(units, req.nameMatches);
      if (u) pairs.push({ unit: u, count: req.count || 1 });
      else missing.push(req.nameMatches);
    });
    return { ok: true, prepared: { tpl, faction, pairs, missing } };
  }

  function applyTemplate(prepared) {
    const state = App.state;
    if (!state || !state.armyManager) return;
    const { tpl, faction, pairs, missing } = prepared;

    const army = state.armyManager.newArmy(faction.factionName || '');
    army.name = tpl.title;
    army.pointsLimit = KT_POINTS;
    army.factionName = faction.factionName || '';

    let added = 0;
    pairs.forEach(p => {
      if (!p.unit) return;
      const squadOpt = (p.unit.squadOptions && p.unit.squadOptions[0]) || null;
      army.addUnit(p.unit, p.count || 1, squadOpt);
      added++;
    });

    state.armyManager.saveArmy(army);
    state.currentArmy = army;
    state.armyManager.currentArmy = army;

    const factionSelect = document.getElementById('army-faction-select');
    if (factionSelect && faction.factionName) {
      const topLevel = App.getVirtualParentOf
        ? (App.getVirtualParentOf(faction.factionName) || faction.factionName)
        : faction.factionName;
      const exists = [...factionSelect.options].some(o => o.value === topLevel);
      if (exists) {
        factionSelect.value = topLevel;
        factionSelect.dispatchEvent(new Event('change'));
        if (topLevel !== faction.factionName) {
          const chapterSelect = document.getElementById('army-chapter-select');
          if (chapterSelect && [...chapterSelect.options].some(o => o.value === faction.factionName)) {
            chapterSelect.value = faction.factionName;
            chapterSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    }

    const nameInput = document.getElementById('army-name-input');
    if (nameInput) nameInput.value = army.name;
    const pointsInput = document.getElementById('points-limit-input');
    if (pointsInput) {
      pointsInput.value = army.pointsLimit;
      pointsInput.dispatchEvent(new Event('change'));
    }
    if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);

    const missingMsg = missing && missing.length ? ' (skipped: ' + missing.join(', ') + ')' : '';
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Loaded ' + tpl.title + ' (' + added + ' units)' + missingMsg,
        missing.length ? 'info' : 'success', missing.length ? 5000 : 3000);
    }
  }

  function loadTemplateById(id) {
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    const res = prepareTemplate(tpl);
    if (!res.ok) {
      if (window.UI && typeof UI.toast === 'function') UI.toast(res.reason, 'error', 4000);
      return;
    }
    applyTemplate(res.prepared);
    closeModal();
  }

  // ── Mission roll ───────────────────────────────────────────────────────
  function rollMission() {
    const next = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    // Avoid back-to-back repeats when possible.
    if (lastMission && next.name === lastMission.name && MISSIONS.length > 1) {
      lastMission = MISSIONS[(MISSIONS.indexOf(next) + 1) % MISSIONS.length];
    } else {
      lastMission = next;
    }
    renderMissionDisplay();
  }

  function renderMissionDisplay() {
    if (!modalEl) return;
    const out = modalEl.querySelector('#kt-mission-display');
    if (!out) return;
    if (!lastMission) {
      out.innerHTML = '<div class="kt-mission-empty">Click "Roll mission" to draw one.</div>';
      return;
    }
    out.innerHTML =
      '<div class="kt-mission-card">' +
        '<div class="kt-mission-name">' + esc(lastMission.name) + '</div>' +
        '<div class="kt-mission-desc">' + esc(lastMission.desc) + '</div>' +
      '</div>';
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-kill-team';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal kt-modal">' +
        '<div class="modal-header">' +
          '<h3>Kill Team</h3>' +
          '<button class="modal-close" id="kt-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<section class="kt-section kt-section-status">' +
            '<div class="kt-status-row">' +
              '<div class="kt-status-text">' +
                '<div class="kt-status-title">Small-format mode</div>' +
                '<div class="kt-status-sub muted">Cap ' + KT_POINTS + 'pts, hide oversized vehicles &amp; monsters.</div>' +
              '</div>' +
              '<button class="kt-switch" id="kt-switch" type="button" role="switch" aria-checked="false">' +
                '<span class="kt-switch-knob"></span>' +
                '<span class="kt-switch-label" id="kt-switch-label">OFF</span>' +
              '</button>' +
            '</div>' +
          '</section>' +
          '<section class="kt-section">' +
            '<h4 class="kt-section-title">Templates</h4>' +
            '<p class="muted kt-section-help">Six starter Kill Teams. Click "Load" to replace your current army.</p>' +
            '<div class="kt-templates" id="kt-templates"></div>' +
          '</section>' +
          '<section class="kt-section">' +
            '<h4 class="kt-section-title">Mission generator</h4>' +
            '<div class="kt-mission-row">' +
              '<button class="btn btn-accent" id="kt-roll-mission" type="button">Roll mission</button>' +
              '<div class="kt-mission-display" id="kt-mission-display">' +
                '<div class="kt-mission-empty">Click "Roll mission" to draw one.</div>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<span class="toolbar-spacer" style="flex:1"></span>' +
          '<button class="btn btn-accent" id="kt-done" type="button">Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#kt-close').addEventListener('click', closeModal);
    backdrop.querySelector('#kt-done').addEventListener('click', closeModal);
    backdrop.querySelector('#kt-switch').addEventListener('click', () => setActive(!active));
    backdrop.querySelector('#kt-roll-mission').addEventListener('click', rollMission);

    modalEl = backdrop;
    return modalEl;
  }

  function renderModal() {
    if (!modalEl) return;
    const sw = modalEl.querySelector('#kt-switch');
    const swLabel = modalEl.querySelector('#kt-switch-label');
    if (sw) {
      sw.classList.toggle('kt-switch-on', active);
      sw.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    if (swLabel) swLabel.textContent = active ? 'ON' : 'OFF';

    const tplHost = modalEl.querySelector('#kt-templates');
    if (tplHost) {
      const factionsLoaded = !!(App.state && App.state.factions && App.state.factions.length);
      if (!factionsLoaded) {
        tplHost.innerHTML = '<div class="kt-empty">Faction data still loading&hellip;</div>';
      } else {
        tplHost.innerHTML = TEMPLATES.map(tpl => {
          const faction = findFaction(tpl.faction);
          const ok = !!faction;
          const tip = ok ? 'Load this Kill Team' : 'Faction "' + shortFaction(tpl.faction) + '" not loaded yet.';
          return (
            '<div class="kt-template' + (ok ? '' : ' disabled') + '" data-id="' + esc(tpl.id) + '">' +
              '<div class="kt-template-head">' +
                '<div class="kt-template-title">' + esc(tpl.title) + '</div>' +
                '<div class="kt-template-pill">' + KT_POINTS + ' pt</div>' +
              '</div>' +
              '<div class="kt-template-faction">' + esc(shortFaction(tpl.faction)) + '</div>' +
              '<div class="kt-template-desc">' + esc(tpl.description) + '</div>' +
              '<div class="kt-template-actions">' +
                '<button type="button" class="btn btn-sm btn-accent kt-template-load" ' +
                  'data-id="' + esc(tpl.id) + '" title="' + esc(tip) + '"' + (ok ? '' : ' disabled') + '>Load template</button>' +
              '</div>' +
            '</div>'
          );
        }).join('');
        tplHost.querySelectorAll('.kt-template-load').forEach(btn => {
          btn.addEventListener('click', () => loadTemplateById(btn.getAttribute('data-id')));
        });
      }
    }
    renderMissionDisplay();
  }

  function openModal() {
    const el = ensureModal();
    renderModal();
    el.hidden = false;
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── Toolbar registration + bootstrap ───────────────────────────────────
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-kill-team',
    region: 'primary',
    label: 'Kill Team',
    category: 'game',
    title: 'Toggle small-format game mode',
    onClick: openModal,
  });

  App.hooks.bootstrap.push(function () {
    let saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (_) {}
    if (saved === '1') setActive(true);
    else updateBanner();

    // Banner host is created/recreated by UI.init; re-mount on changes.
    const center = document.getElementById('panel-center') || document.body;
    new MutationObserver(() => {
      const host = document.querySelector('#panel-center .panel-controls');
      if (host && (!bannerEl || !host.contains(bannerEl))) updateBanner();
    }).observe(center, { childList: true, subtree: true });
  });

  // Expose for command-palette integration.
  App.toggleKillTeamMode = () => setActive(!active);
  App.openKillTeamModal = openModal;
})();
