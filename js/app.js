/**
 * app.js - Application entry point
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Application State ─────────────────────────────────────────────────
  const state = {
    factions:       [],   // all loaded factions (from BSData)
    allUnits:       [],   // flat unit array
    currentArmy:    null,
    armyManager:    null,
    selectedUnit:   null,
    factionFilter:  'all',  // controlled from army panel faction select
    selectedChapter: null,  // selected chapter/supplement within a faction
    chaptersMap:    {},     // virtualParentName → [childFactionName, ...]
    chapterFactions: new Set(), // all factions hidden as children of a virtual parent
    virtualBase:    {},     // virtualParentName → base chapter factionName (for rules fallback)
  };

  // ── Virtual parent factions ───────────────────────────────────────────
  // These are hardcoded groupings that collapse related sub-factions under a
  // single dropdown entry. Any loaded faction whose name starts with
  // `<parent.name> - ` becomes a hidden child of that virtual parent, selectable
  // via the chapter sub-dropdown. `baseChapter` is the sibling whose rules and
  // generic units should always be shown alongside a specific chapter.
  const VIRTUAL_PARENTS = [
    {
      name: 'Imperium - Adeptus Astartes',
      baseChapter: 'Imperium - Adeptus Astartes - Space Marines',
    },
  ];

  UI.init(state);

  // ── Faction accent colors ─────────────────────────────────────────────
  // [accent, hover, dark, rgb]
  const FACTION_COLORS = {
    'Adeptus Astartes':    ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'Space Marines':       ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'Blood Angels':        ['#9b0000', '#be1a1a', '#6e0000', '155, 0, 0'],
    'Dark Angels':         ['#1a5c1a', '#267a26', '#124012', '26, 92, 26'],
    'Grey Knights':        ['#8888b8', '#a0a0d0', '#6060a0', '136, 136, 184'],
    'Space Wolves':        ['#4a6fa5', '#6088be', '#30508a', '74, 111, 165'],
    'Imperial Fists':      ['#c8a400', '#e0bc00', '#9b8000', '200, 164, 0'],
    'Black Templars':      ['#d0d0d0', '#eeeeee', '#a0a0a0', '208, 208, 208'],
    'Iron Hands':          ['#708090', '#909eb0', '#506070', '112, 128, 144'],
    'Salamanders':         ['#1a6b2a', '#268a38', '#104a1a', '26, 107, 42'],
    'Ultramarines':        ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'White Scars':         ['#d8d8d8', '#f0f0f0', '#b0b0b0', '216, 216, 216'],
    'Raven Guard':         ['#909090', '#b0b0b0', '#686868', '144, 144, 144'],
    'Chaos Space Marines': ['#9b1a00', '#be3210', '#6e1000', '155, 26, 0'],
    'Death Guard':         ['#5a6e3a', '#728c4a', '#3e4e28', '90, 110, 58'],
    'Thousand Sons':       ['#1a4a9b', '#2a62c8', '#0e3070', '26, 74, 155'],
    'World Eaters':        ['#aa1a00', '#cc2a10', '#7a1000', '170, 26, 0'],
    "Emperor's Children":  ['#9b1a9b', '#c028c0', '#6e1070', '155, 26, 155'],
    'Necrons':             ['#00cc00', '#20ee20', '#009800', '0, 204, 0'],
    "T'au Empire":         ['#00a0b0', '#10c0d2', '#007888', '0, 160, 176'],
    'Tyranids':            ['#8b0070', '#b0009a', '#600050', '139, 0, 112'],
    'Orks':                ['#5a8700', '#70a800', '#406000', '90, 135, 0'],
    'Aeldari':             ['#0080c8', '#10a0ee', '#005898', '0, 128, 200'],
    'Drukhari':            ['#7b00b8', '#9c10e0', '#580088', '123, 0, 184'],
    'Harlequins':          ['#d44000', '#f05010', '#a02800', '212, 64, 0'],
    'Adeptus Mechanicus':  ['#cc3300', '#ee4a10', '#982200', '204, 51, 0'],
    'Astra Militarum':     ['#6b6b3a', '#8a8a4a', '#4a4a28', '107, 107, 58'],
    'Adepta Sororitas':    ['#8b0020', '#ae1030', '#620010', '139, 0, 32'],
    'Adeptus Custodes':    ['#c8a000', '#e0bc00', '#9b8000', '200, 160, 0'],
    'Deathwatch':          ['#7080a0', '#8898c0', '#505870', '112, 128, 160'],
    'Genestealer Cults':   ['#7b00a8', '#9c10d0', '#580078', '123, 0, 168'],
    'Leagues of Votann':   ['#8b6b3a', '#aa844a', '#664e28', '139, 107, 58'],
    'Chaos Daemons':       ['#9b1a4a', '#c02860', '#6e1030', '155, 26, 74'],
    'Chaos Knights':       ['#6b2a9b', '#8a40c0', '#4a1870', '107, 42, 155'],
    'Imperial Knights':    ['#c8a000', '#e0bc00', '#9b8000', '200, 160, 0'],
  };
  const DEFAULT_ACCENT = ['#ffffff', '#cccccc', '#aaaaaa', '255, 255, 255'];

  function applyFactionColor(factionName) {
    const root = document.documentElement;
    const shortName = factionName && factionName.includes(' - ')
      ? factionName.split(' - ').pop().trim()
      : (factionName || '');
    const colors = FACTION_COLORS[shortName] || FACTION_COLORS[factionName] || DEFAULT_ACCENT;
    const [accent, hover, dark, rgb] = colors;
    root.style.setProperty('--accent',       accent);
    root.style.setProperty('--accent-hover', hover);
    root.style.setProperty('--accent-dark',  dark);
    root.style.setProperty('--accent-rgb',   rgb);
    // Compute a contrasting foreground color for elements that have accent as background
    const r = parseInt(accent.slice(1,3), 16);
    const g = parseInt(accent.slice(3,5), 16);
    const b = parseInt(accent.slice(5,7), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.style.setProperty('--accent-on', luminance > 0.35 ? '#111111' : '#ffffff');
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function bootstrap() {
    state.armyManager = new ArmyManager();

    // Create or restore active army
    if (state.armyManager.armies.length > 0) {
      const sorted = [...state.armyManager.armies].sort((a, b) =>
        new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
      );
      state.currentArmy = sorted[0];
      state.armyManager.currentArmy = state.currentArmy;
    } else {
      state.currentArmy = state.armyManager.newArmy();
    }

    applyFactionColor(null); // default white
    renderAll();
    setupResizablePanels();
    wireEvents();

    // Load all factions from BSData in the background
    autoLoadFromBSData();
  }

  // ── Render helpers ────────────────────────────────────────────────────
  function renderAll() {
    UI.updateFactionFilter(state.factions, {
      hide:   state.chapterFactions,
      extras: Object.keys(state.chaptersMap),
    });
    const { factionFilter, linkedFactions } = getEffectiveFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
    UI.renderArmyList(state.currentArmy);
  }

  function renderUnitRosterWithContext() {
    const { factionFilter, linkedFactions } = getEffectiveFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
  }

  function rebuildAllUnits() {
    state.allUnits = [];
    state.factions.forEach(faction => {
      (faction.units || []).forEach(unit => {
        state.allUnits.push({ ...unit, _factionName: faction.factionName });
      });
    });
  }

  function buildChaptersMap() {
    state.chaptersMap = {};
    state.virtualBase = {};
    state.chapterFactions = new Set();
    // For each virtual parent, find all loaded factions whose name starts with
    // "<parent> - " and collect them as hidden children.
    VIRTUAL_PARENTS.forEach(vp => {
      const prefix = vp.name + ' - ';
      const children = state.factions
        .filter(f => f.factionName.startsWith(prefix))
        .map(f => f.factionName);
      if (children.length === 0) return;
      state.chaptersMap[vp.name] = children;
      state.virtualBase[vp.name] = vp.baseChapter;
      children.forEach(c => state.chapterFactions.add(c));
    });
  }

  function getVirtualParentOf(chapterName) {
    for (const [vp, children] of Object.entries(state.chaptersMap)) {
      if (children.includes(chapterName)) return vp;
    }
    return null;
  }

  function getEffectiveFilter() {
    // Case 1: a specific chapter is selected from the sub-dropdown.
    // Show its own units plus the sibling "base" chapter (e.g. Space Marines)
    // so generic units from the base are always available.
    if (state.selectedChapter) {
      const linked = [];
      const vp = getVirtualParentOf(state.selectedChapter);
      if (vp && state.virtualBase[vp] && state.virtualBase[vp] !== state.selectedChapter) {
        linked.push(state.virtualBase[vp]);
      }
      return { factionFilter: state.selectedChapter, linkedFactions: linked };
    }
    // Case 2: the virtual parent itself is selected — show all its children combined.
    if (state.factionFilter !== 'all' && state.chaptersMap[state.factionFilter]) {
      return {
        factionFilter: state.factionFilter,
        linkedFactions: state.chaptersMap[state.factionFilter],
      };
    }
    // Case 3: a regular (non-virtual) faction is selected.
    if (state.factionFilter !== 'all') {
      return { factionFilter: state.factionFilter, linkedFactions: [] };
    }
    return { factionFilter: 'all', linkedFactions: [] };
  }

  function findUnit(unitId, factionName) {
    return state.allUnits.find(u => u.id === unitId && u._factionName === factionName)
        || state.allUnits.find(u => u.id === unitId)
        || null;
  }

  function getCurrentFaction() {
    const name = state.selectedChapter || (state.factionFilter !== 'all' ? state.factionFilter : null);
    if (!name) return null;
    const direct = state.factions.find(f => f.factionName === name);
    if (direct) return direct;
    // Virtual parent: fall back to its base chapter's data for rules/detachments
    if (state.virtualBase && state.virtualBase[name]) {
      return state.factions.find(f => f.factionName === state.virtualBase[name]) || null;
    }
    return null;
  }

  // ── BSData auto-load ──────────────────────────────────────────────────
  async function autoLoadFromBSData() {
    try {
      await BSData.loadAllFactions(
        (done, total) => {
          UI.setLoadProgress(done, total);
        },
        faction => {
          const exists = state.factions.some(f => f.factionName === faction.factionName);
          if (!exists) {
            state.factions.push(faction);
            rebuildAllUnits();
            buildChaptersMap();
            UI.updateFactionFilter(state.factions, {
              hide:   state.chapterFactions,
              extras: Object.keys(state.chaptersMap),
            });
            renderUnitRosterWithContext();
          }
        }
      );
    } catch (err) {
      console.error('[BSData] Auto-load failed:', err);
      UI.toast('Could not load BSData: ' + err.message, 'error', 6000);
    }
  }

  // ── Resizable panels ──────────────────────────────────────────────────
  function setupResizablePanels() {
    const root = document.documentElement;

    function makeResizable(handleId, cssVar, side) {
      const handle = document.getElementById(handleId);
      if (!handle) return;
      let startX, startWidth;

      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        handle.classList.add('dragging');
        startX = e.clientX;
        startWidth = parseInt(getComputedStyle(root).getPropertyValue(cssVar)) || 300;

        function onMove(e) {
          const delta = e.clientX - startX;
          const newW = side === 'left'
            ? Math.max(200, Math.min(600, startWidth + delta))
            : Math.max(250, Math.min(700, startWidth - delta));
          root.style.setProperty(cssVar, newW + 'px');
        }
        function onUp() {
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    }

    makeResizable('resize-left',  '--col-left',  'left');
    makeResizable('resize-right', '--col-right', 'right');
  }

  // ── Wire up all event listeners ───────────────────────────────────────
  function wireEvents() {

    // ---- Army faction selector ----
    document.getElementById('army-faction-select').addEventListener('change', e => {
      state.factionFilter = e.target.value;
      state.selectedChapter = null;
      applyFactionColor(state.factionFilter === 'all' ? null : state.factionFilter);
      updateChapterDropdown(state.factionFilter);
      renderUnitRosterWithContext();
      const faction = getCurrentFaction();
      UI.updateFactionRules(faction);
      updateDetachmentOptions(faction);
    });

    // ---- Chapter / Supplement selector ----
    document.getElementById('army-chapter-select').addEventListener('change', e => {
      state.selectedChapter = e.target.value || null;
      applyFactionColor(state.selectedChapter || state.factionFilter);
      renderUnitRosterWithContext();
      const faction = getCurrentFaction();
      UI.updateFactionRules(faction);
      updateDetachmentOptions(faction);
    });

    // ---- Detachment selector ----
    document.getElementById('army-detachment-select').addEventListener('change', () => {
      // Future: filter units by detachment requirements
    });

    // ---- Search ----
    document.getElementById('search-input').addEventListener('input', () => {
      renderUnitRosterWithContext();
    });

    // ---- Unit card click → show detail in right panel ----
    document.getElementById('unit-grid').addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card) return;
      const unit = findUnit(card.dataset.unitId, card.dataset.factionName);
      if (!unit) return;

      document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      state.selectedUnit = unit;
      UI.renderUnitDetail(unit);
    });

    // ---- Faction rule / stratagem click → show in details panel ----
    document.getElementById('army-rules-section').addEventListener('click', e => {
      const item = e.target.closest('.army-rule-item');
      if (!item) return;
      UI.renderRuleDetail({
        name:        item.dataset.ruleName,
        description: item.dataset.ruleDesc,
        type:        item.dataset.ruleType || 'rule',
        cp:          item.dataset.ruleCp   || null,
        when:        item.dataset.ruleWhen || null,
        target:      item.dataset.ruleTarget || null,
        effect:      item.dataset.ruleEffect || null,
      });
    });

    // ---- Add to Army (detail panel button) ----
    document.getElementById('unit-detail-panel').addEventListener('click', e => {
      if (!e.target.closest('#btn-detail-add')) return;
      if (!state.selectedUnit) return;

      const qty = parseInt(document.getElementById('detail-qty').value, 10) || 1;
      const squadSelect = document.getElementById('detail-squad-select');
      let squadOption = null;
      if (squadSelect) {
        const idx = parseInt(squadSelect.value, 10);
        const opts = state.selectedUnit.squadOptions || [];
        squadOption = opts[idx] || null;
      } else {
        const opts = state.selectedUnit.squadOptions || [];
        squadOption = opts[0] || null;
      }

      state.currentArmy.addUnit(state.selectedUnit, qty, squadOption);
      UI.renderArmyList(state.currentArmy);
      const label = squadOption && squadOption.models
        ? `${qty}× ${state.selectedUnit.name} (${squadOption.models} models)`
        : `${qty}× ${state.selectedUnit.name}`;
      UI.toast(`Added ${label}`, 'success');
    });

    // ---- Army name ----
    document.getElementById('army-name-input').addEventListener('input', e => {
      state.currentArmy.name = e.target.value || 'My Army';
    });

    // ---- Points limit ----
    document.getElementById('points-limit-input').addEventListener('input', e => {
      state.currentArmy.pointsLimit = parseInt(e.target.value, 10) || 0;
      UI.renderArmyList(state.currentArmy);
    });

    // ---- Army list: qty change + remove (delegation) ----
    document.getElementById('army-entry-list').addEventListener('change', e => {
      const input = e.target.closest('.army-qty-input');
      if (!input) return;
      const index = parseInt(input.dataset.index, 10);
      const val   = parseInt(input.value, 10);
      if (isNaN(val) || val < 0) return;
      state.currentArmy.updateCount(index, val);
      UI.renderArmyList(state.currentArmy);
    });

    document.getElementById('army-entry-list').addEventListener('click', e => {
      const btn = e.target.closest('.army-entry-remove');
      if (!btn) return;
      const index     = parseInt(btn.dataset.index, 10);
      const entryName = state.currentArmy.entries[index]?.unitName || 'unit';
      state.currentArmy.removeEntry(index);
      UI.renderArmyList(state.currentArmy);
      UI.toast(`Removed ${entryName}`, 'info');
    });

    // ---- Army toolbar ----
    document.getElementById('btn-new-army').addEventListener('click', () => {
      if (state.currentArmy.entries.length > 0 &&
          !confirm('Start a new army? Unsaved changes will be lost.')) return;
      state.currentArmy = state.armyManager.newArmy();
      UI.renderArmyList(state.currentArmy);
      UI.toast('New army created', 'info');
    });

    document.getElementById('btn-save-army').addEventListener('click', () => {
      state.currentArmy.name = document.getElementById('army-name-input').value || 'My Army';
      state.armyManager.saveArmy(state.currentArmy);
      UI.toast(`Saved "${state.currentArmy.name}"`, 'success');
    });

    document.getElementById('btn-load-army').addEventListener('click', () => {
      UI.showLoadModal(state.armyManager.armies);
    });

    document.getElementById('modal-load-close').addEventListener('click', UI.hideLoadModal);
    document.getElementById('modal-load').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideLoadModal();
    });

    document.getElementById('saved-army-list').addEventListener('click', e => {
      const loadBtn = e.target.closest('.btn-load-saved');
      const delBtn  = e.target.closest('.btn-delete-saved');

      if (loadBtn) {
        const army = state.armyManager.getArmy(loadBtn.dataset.id);
        if (army) {
          state.currentArmy = army;
          state.armyManager.currentArmy = army;
          UI.hideLoadModal();
          UI.renderArmyList(state.currentArmy);
          UI.toast(`Loaded "${army.name}"`, 'success');
        }
      }

      if (delBtn) {
        const army = state.armyManager.getArmy(delBtn.dataset.id);
        if (!army || !confirm(`Delete "${army.name}"? This cannot be undone.`)) return;
        state.armyManager.deleteArmy(army.id);
        if (state.currentArmy && state.currentArmy.id === army.id) {
          state.currentArmy = state.armyManager.newArmy();
          UI.renderArmyList(state.currentArmy);
        }
        UI.showLoadModal(state.armyManager.armies);
        UI.toast(`Deleted "${army.name}"`, 'info');
      }
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
      const json = Storage.exportArmyToJSON(state.currentArmy);
      const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
      Storage.downloadFile(json, `${name}.json`, 'application/json');
      UI.toast('Exported as JSON', 'success');
    });

    document.getElementById('btn-export-text').addEventListener('click', async () => {
      const text = Storage.exportArmyToText(state.currentArmy);
      try {
        await navigator.clipboard.writeText(text);
        UI.toast('Army list copied to clipboard', 'success');
      } catch (_) {
        const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
        Storage.downloadFile(text, `${name}.txt`, 'text/plain');
        UI.toast('Clipboard unavailable — downloaded instead', 'info');
      }
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const csv  = Storage.exportArmyToCSV(state.currentArmy);
      const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
      Storage.downloadFile(csv, `${name}.csv`, 'text/csv');
      UI.toast('Exported as CSV', 'success');
    });

    document.getElementById('btn-import-json').addEventListener('click', UI.showImportModal);
    document.getElementById('modal-import-close').addEventListener('click', UI.hideImportModal);
    document.getElementById('btn-import-cancel').addEventListener('click', UI.hideImportModal);
    document.getElementById('modal-import').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideImportModal();
    });

    document.getElementById('btn-import-confirm').addEventListener('click', () => {
      const raw = document.getElementById('import-json-textarea').value.trim();
      if (!raw) { UI.toast('Paste JSON first', 'warning'); return; }
      try {
        const army = Storage.importArmyFromJSON(raw);
        state.armyManager.saveArmy(army);
        state.currentArmy = army;
        state.armyManager.currentArmy = army;
        UI.hideImportModal();
        UI.renderArmyList(state.currentArmy);
        UI.toast(`Imported "${army.name}"`, 'success');
      } catch (err) {
        UI.toast('Import failed: ' + err.message, 'error', 5000);
      }
    });

    // ---- Keyboard: Escape closes modals ----
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        UI.hideLoadModal();
        UI.hideImportModal();
      }
    });
  }

  // ── Chapter dropdown ──────────────────────────────────────────────────
  function updateChapterDropdown(factionName) {
    const group  = document.getElementById('army-chapter-group');
    const select = document.getElementById('army-chapter-select');
    state.selectedChapter = null;
    const chapters = (factionName && factionName !== 'all')
      ? (state.chaptersMap[factionName] || [])
      : [];
    if (chapters.length === 0) {
      group.hidden = true;
      select.innerHTML = '<option value="">— All —</option>';
      return;
    }
    group.hidden = false;
    // Strip the virtual parent prefix so labels read e.g. "Blood Angels"
    // instead of "Imperium - Adeptus Astartes - Blood Angels".
    const prefix = factionName + ' - ';
    select.innerHTML = '<option value="">— All Chapters —</option>';
    chapters
      .slice()
      .sort()
      .forEach(c => {
        const label = c.startsWith(prefix) ? c.slice(prefix.length) : c;
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = label;
        select.appendChild(opt);
      });
  }

  // ── Detachment options ────────────────────────────────────────────────
  function updateDetachmentOptions(faction) {
    const select = document.getElementById('army-detachment-select');
    select.innerHTML = '';

    if (!faction) {
      select.innerHTML = '<option value="">— Select Faction First —</option>';
      return;
    }

    // Use explicitly-extracted detachments; fall back to armyRules with detachment keywords
    let detachments = (faction.detachments || []).slice();
    if (detachments.length === 0) {
      detachments = (faction.armyRules || []).filter(r =>
        /detachment|task\s*force|spearhead|assault\s*force|siege\s*force/i.test(r.name)
      );
    }

    if (detachments.length === 0) {
      select.innerHTML = '<option value="">— No Detachments Found —</option>';
      return;
    }

    detachments.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = d.name;
      select.appendChild(opt);
    });
  }

  // ── Start the app ─────────────────────────────────────────────────────
  bootstrap();
});
