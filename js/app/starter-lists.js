// app/starter-lists.js — curated starter-army gallery + "Surprise me" random generator.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Curated starter lists. Each entry is intentionally loose — nameMatches is a
  // case-insensitive substring test against unit.name within the target faction.
  // Edit freely to tweak or add more lists.
  const STARTER_LISTS = [
    {
      id: 'sm-gladius-1000',
      title: 'Space Marines — Gladius Intro',
      points: 1000,
      faction: 'Imperium - Adeptus Astartes - Space Marines',
      detachment: 'Gladius Task Force',
      description: 'A balanced intro list for new Space Marine players. Teaches Oath of Moment and basic squad roles.',
      units: [
        { nameMatches: 'Captain in Terminator Armour', count: 1 },
        { nameMatches: 'Lieutenant with Combi-weapon', count: 1 },
        { nameMatches: 'Intercessor Squad', count: 2 },
        { nameMatches: 'Assault Intercessor Squad', count: 1 },
        { nameMatches: 'Hellblaster Squad', count: 1 },
        { nameMatches: 'Terminator Squad', count: 1 },
        { nameMatches: 'Redemptor Dreadnought', count: 1 },
      ],
    },
    {
      id: 'sm-ultra-2000',
      title: 'Ultramarines Strong',
      points: 2000,
      faction: 'Imperium - Adeptus Astartes - Ultramarines',
      detachment: 'Gladius Task Force',
      description: 'Roboute-led Codex-compliant force showcasing combined arms at 2000 points.',
      units: [
        { nameMatches: 'Roboute Guilliman', count: 1 },
        { nameMatches: 'Captain', count: 1 },
        { nameMatches: 'Lieutenant', count: 1 },
        { nameMatches: 'Tactical Squad', count: 2 },
        { nameMatches: 'Intercessor Squad', count: 2 },
        { nameMatches: 'Hellblaster Squad', count: 1 },
        { nameMatches: 'Terminator Squad', count: 1 },
        { nameMatches: 'Redemptor Dreadnought', count: 1 },
        { nameMatches: 'Repulsor', count: 1 },
      ],
    },
    {
      id: 'necrons-awakened-1000',
      title: 'Necrons — Awakened Dynasty',
      points: 1000,
      faction: 'Necrons',
      detachment: 'Awakened Dynasty',
      description: 'Classic Necron reanimation battleline with a Overlord anchor and Lychguard bodyguard.',
      units: [
        { nameMatches: 'Overlord', count: 1 },
        { nameMatches: 'Royal Warden', count: 1 },
        { nameMatches: 'Necron Warriors', count: 2 },
        { nameMatches: 'Immortals', count: 1 },
        { nameMatches: 'Lychguard', count: 1 },
        { nameMatches: 'Canoptek Scarab Swarms', count: 1 },
        { nameMatches: 'Doomstalker', count: 1 },
      ],
    },
    {
      id: 'tyranids-invasion-2000',
      title: 'Tyranids — Invasion Fleet',
      points: 2000,
      faction: 'Tyranids',
      detachment: 'Invasion Fleet',
      description: 'Swarm-heavy Tyranid list built around synapse and big monsters at 2000pt.',
      units: [
        { nameMatches: 'Hive Tyrant', count: 1 },
        { nameMatches: 'Neurotyrant', count: 1 },
        { nameMatches: 'Termagants', count: 2 },
        { nameMatches: 'Hormagaunts', count: 2 },
        { nameMatches: 'Tyranid Warriors with Melee', count: 1 },
        { nameMatches: 'Genestealers', count: 1 },
        { nameMatches: 'Carnifex', count: 2 },
        { nameMatches: 'Exocrine', count: 1 },
      ],
    },
    {
      id: 'orks-bigwaaagh-2000',
      title: 'Orks — Da Big Waaagh',
      points: 2000,
      faction: 'Orks',
      detachment: 'War Horde',
      description: 'Green tide with warbosses up front and a Mek backline. Call da Waaagh and charge!',
      units: [
        { nameMatches: 'Warboss', count: 1 },
        { nameMatches: 'Big Mek', count: 1 },
        { nameMatches: 'Weirdboy', count: 1 },
        { nameMatches: 'Boyz', count: 2 },
        { nameMatches: 'Gretchin', count: 1 },
        { nameMatches: 'Nobz', count: 1 },
        { nameMatches: 'Meganobz', count: 1 },
        { nameMatches: 'Deff Dread', count: 1 },
        { nameMatches: 'Trukk', count: 1 },
      ],
    },
    {
      id: 'admech-cybernetica-1000',
      title: 'Adeptus Mechanicus — Cohort Cybernetica',
      points: 1000,
      faction: 'Imperium - Adeptus Mechanicus',
      detachment: 'Cohort Cybernetica',
      description: 'Robot-heavy AdMech cohort — Kataphrons and Kastelans anchor the battleline.',
      units: [
        { nameMatches: 'Tech-Priest Dominus', count: 1 },
        { nameMatches: 'Skitarii Rangers', count: 1 },
        { nameMatches: 'Skitarii Vanguard', count: 1 },
        { nameMatches: 'Kataphron Breachers', count: 1 },
        { nameMatches: 'Kataphron Destroyers', count: 1 },
        { nameMatches: 'Kastelan Robots', count: 1 },
      ],
    },
    {
      id: 'csm-pactbound-2000',
      title: 'Chaos Space Marines — Pactbound',
      points: 2000,
      faction: 'Chaos - Chaos Space Marines',
      detachment: 'Pactbound Zealots',
      description: 'Heretic Astartes zealots — Cultists to tarpit, Terminators and Possessed to strike.',
      units: [
        { nameMatches: 'Chaos Lord in Terminator Armour', count: 1 },
        { nameMatches: 'Master of Possession', count: 1 },
        { nameMatches: 'Dark Apostle', count: 1 },
        { nameMatches: 'Legionaries', count: 2 },
        { nameMatches: 'Cultist Mob', count: 2 },
        { nameMatches: 'Possessed', count: 1 },
        { nameMatches: 'Chaos Terminator Squad', count: 1 },
        { nameMatches: 'Helbrute', count: 1 },
        { nameMatches: 'Forgefiend', count: 1 },
      ],
    },
    {
      id: 'aeldari-battlehost-1500',
      title: 'Aeldari — Battle Host',
      points: 1500,
      faction: 'Aeldari',
      detachment: 'Battle Host',
      description: 'Fast mobile Craftworld skirmish force with a Farseer directing fire.',
      units: [
        { nameMatches: 'Farseer', count: 1 },
        { nameMatches: 'Autarch', count: 1 },
        { nameMatches: 'Guardian Defenders', count: 2 },
        { nameMatches: 'Dire Avengers', count: 1 },
        { nameMatches: 'Rangers', count: 1 },
        { nameMatches: 'Fire Dragons', count: 1 },
        { nameMatches: 'Wraithguard', count: 1 },
        { nameMatches: 'Wave Serpent', count: 1 },
      ],
    },
    {
      id: 'tau-montka-2000',
      title: "T'au Empire — Mont'ka Strike",
      points: 2000,
      faction: "T'au Empire",
      detachment: "Mont'ka",
      description: 'Firepower-focused T\'au gunline anchored by a Coldstar Commander and heavy suits.',
      units: [
        { nameMatches: 'Commander in Coldstar', count: 1 },
        { nameMatches: 'Cadre Fireblade', count: 1 },
        { nameMatches: 'Ethereal', count: 1 },
        { nameMatches: 'Strike Team', count: 2 },
        { nameMatches: 'Breacher Team', count: 1 },
        { nameMatches: 'Crisis Battlesuits', count: 1 },
        { nameMatches: 'Broadside', count: 1 },
        { nameMatches: 'Hammerhead', count: 1 },
        { nameMatches: 'Riptide', count: 1 },
      ],
    },
    {
      id: 'sisters-flame-1500',
      title: 'Adepta Sororitas — Bringers of Flame',
      points: 1500,
      faction: 'Imperium - Adepta Sororitas',
      detachment: 'Bringers of Flame',
      description: 'Flamer-heavy Sisters of Battle list built around Acts of Faith and Miracle dice.',
      units: [
        { nameMatches: 'Canoness', count: 1 },
        { nameMatches: 'Palatine', count: 1 },
        { nameMatches: 'Battle Sisters Squad', count: 2 },
        { nameMatches: 'Dominion Squad', count: 1 },
        { nameMatches: 'Seraphim Squad', count: 1 },
        { nameMatches: 'Retributor Squad', count: 1 },
        { nameMatches: 'Immolator', count: 1 },
      ],
    },
  ];

  const RANDOM_NAMES = [
    'The Quick Draft', 'Dice Said So', 'Roll-a-List', 'Random Muster',
    'Chaos at the Table', 'A Fistful of Randos', 'Untested Theory', 'Surprise Detachment',
    'One-Shot Wonders', 'Whatever Works',
  ];

  const esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function accentFor(factionName) {
    const colors = App.FACTION_COLORS || {};
    const short = shortFaction(factionName);
    const tuple = colors[short] || colors[factionName] || App.DEFAULT_ACCENT || ['#666'];
    return tuple[0];
  }

  function findFaction(name) {
    const facs = (App.state && App.state.factions) || [];
    if (!name) return null;
    const direct = facs.find(f => f.factionName === name);
    if (direct) return direct;
    const shortTarget = shortFaction(name).toLowerCase();
    return facs.find(f => shortFaction(f.factionName).toLowerCase() === shortTarget) || null;
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

  function hasKw(unit, kw) {
    const k = (kw || '').toLowerCase();
    return (unit.keywords || []).some(x => {
      const s = typeof x === 'string' ? x : (x && (x.name || x.keyword)) || '';
      return s.toLowerCase() === k;
    });
  }

  function isCharacter(u)  { return hasKw(u, 'Character'); }
  function isBattleline(u) { return hasKw(u, 'Battleline'); }

  function unitBasePoints(u) {
    if (typeof u.points === 'number' && u.points > 0) return u.points;
    const opts = u.squadOptions || [];
    if (opts.length && typeof opts[0].pts === 'number') return opts[0].pts;
    const pts = u.pointsOptions || [];
    if (pts.length && typeof pts[0].pts === 'number') return pts[0].pts;
    return 0;
  }

  function randomName() {
    const base = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    const n = Math.floor(Math.random() * 99) + 1;
    return /#|\d/.test(base) ? base + ' #' + n : (Math.random() < 0.4 ? base + ' #' + n : base);
  }

  function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickFactionForRandom() {
    const facs = (App.state && App.state.factions) || [];
    if (facs.length === 0) return null;
    const current = App.state && App.state.factionFilter;
    if (current && current !== 'all') {
      const f = findFaction(current);
      if (f && factionUnits(f).length > 0) return f;
    }
    const eligible = facs.filter(f => factionUnits(f).length >= 4);
    return pickRandom(eligible.length ? eligible : facs);
  }

  // Greedy weighted fill: pick a target mix (chars/battleline/other), then
  // fill up to the points target within a 10% tolerance. Keeps algorithm
  // simple — no detachment composition validation.
  function buildRandomArmy(faction, pointsTarget) {
    const units = factionUnits(faction).filter(u => unitBasePoints(u) > 0);
    if (units.length === 0) return [];

    const chars       = units.filter(isCharacter);
    const battlelines = units.filter(u => isBattleline(u) && !isCharacter(u));
    const others      = units.filter(u => !isCharacter(u) && !isBattleline(u));

    const result = [];
    let total = 0;
    const tolerance = pointsTarget * 1.10;

    function tryAdd(pool, minCount, maxCount) {
      if (pool.length === 0) return;
      const want = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
      let added = 0;
      let attempts = 0;
      while (added < want && attempts < want * 6 && total < pointsTarget) {
        attempts++;
        const u = pickRandom(pool);
        const pts = unitBasePoints(u);
        if (total + pts > tolerance) continue;
        result.push({ unit: u, count: 1 });
        total += pts;
        added++;
      }
    }

    tryAdd(chars,       1, 2);
    tryAdd(battlelines, 2, 4);
    tryAdd(others,      2, 4);

    // Greedy top-up with any units that still fit.
    let guard = 0;
    while (total < pointsTarget * 0.9 && guard < 50) {
      guard++;
      const candidates = units.filter(u => total + unitBasePoints(u) <= tolerance);
      if (candidates.length === 0) break;
      const u = pickRandom(candidates);
      const pts = unitBasePoints(u);
      result.push({ unit: u, count: 1 });
      total += pts;
    }

    return result;
  }

  // Applies a prepared army to state + UI. Works for both curated and random.
  // `prepared` = { title, points, factionName, detachment, pairs: [{unit, count}], missing: [] }
  function applyPreparedArmy(prepared) {
    const state = App.state;
    if (!state || !state.armyManager) return;

    const army = state.armyManager.newArmy(prepared.factionName || '');
    army.name = prepared.title;
    army.pointsLimit = prepared.points || 2000;
    army.factionName = prepared.factionName || '';

    let added = 0;
    prepared.pairs.forEach(p => {
      if (!p.unit) return;
      const squadOpt = (p.unit.squadOptions && p.unit.squadOptions[0]) || null;
      army.addUnit(p.unit, p.count || 1, squadOpt);
      added++;
    });

    state.armyManager.saveArmy(army);
    state.currentArmy = army;
    state.armyManager.currentArmy = army;

    const factionSelect    = document.getElementById('army-faction-select');
    const detachmentSelect = document.getElementById('army-detachment-select');

    if (factionSelect && prepared.factionName) {
      const topLevel = App.getVirtualParentOf
        ? (App.getVirtualParentOf(prepared.factionName) || prepared.factionName)
        : prepared.factionName;
      const exists = [...factionSelect.options].some(o => o.value === topLevel);
      if (exists) {
        factionSelect.value = topLevel;
        factionSelect.dispatchEvent(new Event('change'));
        if (topLevel !== prepared.factionName) {
          const chapterSelect = document.getElementById('army-chapter-select');
          if (chapterSelect && [...chapterSelect.options].some(o => o.value === prepared.factionName)) {
            chapterSelect.value = prepared.factionName;
            chapterSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    }

    if (detachmentSelect && prepared.detachment) {
      const match = [...detachmentSelect.options].find(o =>
        o.value.toLowerCase() === prepared.detachment.toLowerCase()
      );
      if (match) {
        detachmentSelect.value = match.value;
        detachmentSelect.dispatchEvent(new Event('change'));
      }
    }

    document.getElementById('army-name-input').value = army.name;
    document.getElementById('points-limit-input').value = army.pointsLimit;

    if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);

    const missingMsg = prepared.missing && prepared.missing.length
      ? ' (skipped: ' + prepared.missing.join(', ') + ')'
      : '';
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Loaded ' + prepared.title + ' (' + added + ' units)' + missingMsg,
        prepared.missing && prepared.missing.length ? 'info' : 'success',
        prepared.missing && prepared.missing.length ? 5000 : 3000);
    }
  }

  function prepareCurated(list) {
    const faction = findFaction(list.faction);
    if (!faction) {
      return { ok: false, reason: 'Faction "' + shortFaction(list.faction) + '" not loaded yet.' };
    }
    const units = factionUnits(faction);
    const pairs = [];
    const missing = [];
    list.units.forEach(req => {
      const u = findUnitByName(units, req.nameMatches);
      if (u) pairs.push({ unit: u, count: req.count || 1 });
      else missing.push(req.nameMatches);
    });
    return {
      ok: true,
      prepared: {
        title:       list.title,
        points:      list.points,
        factionName: faction.factionName,
        detachment:  list.detachment,
        pairs, missing,
      },
    };
  }

  function prepareRandom() {
    const faction = pickFactionForRandom();
    if (!faction) return { ok: false, reason: 'No faction data loaded yet.' };
    const points = Math.random() < 0.5 ? 1000 : 2000;
    const pairs = buildRandomArmy(faction, points);
    if (pairs.length === 0) return { ok: false, reason: 'Not enough unit data to roll a list.' };
    return {
      ok: true,
      prepared: {
        title:       randomName(),
        points,
        factionName: faction.factionName,
        detachment:  null,
        pairs,
        missing:     [],
      },
    };
  }

  // ── Modal rendering ────────────────────────────────────────
  let modalEl = null;
  let searchTerm = '';

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-starter-lists';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal starter-modal">' +
        '<div class="modal-header">' +
          '<h3>Starter Lists</h3>' +
          '<button class="modal-close" id="starter-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="starter-toolbar">' +
            '<div class="starter-toolbar-left">' +
              '<input type="text" id="starter-search" class="starter-search" placeholder="Filter by faction or points..." />' +
            '</div>' +
            '<button class="btn btn-accent starter-btn-surprise" id="starter-btn-surprise" type="button">Surprise me</button>' +
          '</div>' +
          '<div id="starter-content"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeGallery();
    });
    backdrop.querySelector('#starter-close').addEventListener('click', closeGallery);
    backdrop.querySelector('#starter-btn-surprise').addEventListener('click', onSurpriseClick);
    backdrop.querySelector('#starter-search').addEventListener('input', e => {
      searchTerm = (e.target.value || '').trim().toLowerCase();
      renderContent();
    });

    modalEl = backdrop;
    return modalEl;
  }

  function factionsLoaded() {
    return App.state && Array.isArray(App.state.factions) && App.state.factions.length > 0;
  }

  function listMatchesSearch(list) {
    if (!searchTerm) return true;
    const hay = (list.title + ' ' + list.faction + ' ' + shortFaction(list.faction) + ' ' + list.points + 'pt').toLowerCase();
    return hay.indexOf(searchTerm) !== -1;
  }

  function renderContent() {
    if (!modalEl) return;
    const container = modalEl.querySelector('#starter-content');
    if (!container) return;

    if (!factionsLoaded()) {
      container.innerHTML =
        '<div class="starter-empty">Loading faction data&hellip; starter lists will be available shortly.</div>';
      return;
    }

    const visible = STARTER_LISTS.filter(listMatchesSearch);
    if (visible.length === 0) {
      container.innerHTML = '<div class="starter-empty">No starter lists match your filter.</div>';
      return;
    }

    const cards = visible.map(list => {
      const faction = findFaction(list.faction);
      const available = !!faction;
      const accent = accentFor(list.faction);
      const shortFac = shortFaction(list.faction);
      const disabledAttr = available ? '' : 'disabled';
      const disabledClass = available ? '' : ' disabled';
      const tooltip = available
        ? 'Load this starter list'
        : 'Faction "' + shortFac + '" is not loaded yet. Wait for faction data or switch online.';
      return (
        '<div class="starter-card' + disabledClass + '" style="--starter-accent:' + accent + '" data-id="' + esc(list.id) + '">' +
          '<div class="starter-card-header">' +
            '<div class="starter-card-title">' + esc(list.title) + '</div>' +
            '<div class="starter-card-pill">' + list.points + ' pt</div>' +
          '</div>' +
          '<div class="starter-card-faction">' + esc(shortFac) + '</div>' +
          (list.detachment ? '<div class="starter-card-detachment">' + esc(list.detachment) + '</div>' : '') +
          '<div class="starter-card-desc">' + esc(list.description) + '</div>' +
          '<div class="starter-card-actions">' +
            '<button type="button" class="btn btn-sm btn-accent starter-card-load" data-id="' + esc(list.id) + '" title="' + esc(tooltip) + '" ' + disabledAttr + '>Load</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    container.innerHTML = '<div class="starter-grid">' + cards + '</div>';

    container.querySelectorAll('.starter-card-load').forEach(btn => {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-id');
        const list = STARTER_LISTS.find(l => l.id === id);
        if (!list) return;
        loadCurated(list);
      });
    });
  }

  function loadCurated(list) {
    const res = prepareCurated(list);
    if (!res.ok) {
      if (window.UI && typeof UI.toast === 'function') UI.toast(res.reason, 'error', 4000);
      return;
    }
    applyPreparedArmy(res.prepared);
    closeGallery();
  }

  function onSurpriseClick() {
    if (!factionsLoaded()) {
      if (window.UI && typeof UI.toast === 'function') UI.toast('Faction data still loading…', 'info');
      return;
    }
    const res = prepareRandom();
    if (!res.ok) {
      if (window.UI && typeof UI.toast === 'function') UI.toast(res.reason, 'error', 4000);
      return;
    }
    applyPreparedArmy(res.prepared);
    closeGallery();
  }

  function openGallery() {
    const el = ensureModal();
    searchTerm = '';
    const searchInput = el.querySelector('#starter-search');
    if (searchInput) searchInput.value = '';
    renderContent();
    el.hidden = false;
    setTimeout(() => { if (searchInput) searchInput.focus(); }, 50);
  }

  function closeGallery() {
    if (modalEl) modalEl.hidden = true;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeGallery();
  });

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-starter-lists',
    region: 'primary',
    label: 'Starter Lists',
    title: 'Browse curated starter armies or roll a random one',
    onClick: openGallery,
  });
})();
