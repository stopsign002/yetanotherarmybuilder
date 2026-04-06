/**
 * app.js - Application entry point
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Application State ─────────────────────────────────────────────────
  const state = {
    factions:     [],   // all loaded factions (from BSData)
    allUnits:     [],   // flat unit array
    currentArmy:  null,
    armyManager:  null,
    selectedUnit: null,
    factionFilter: 'all',  // controlled from army panel faction select
  };

  UI.init(state);

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

    renderAll();
    setupResizablePanels();
    wireEvents();

    // Load all factions from BSData in the background
    autoLoadFromBSData();
  }

  // ── Render helpers ────────────────────────────────────────────────────
  function renderAll() {
    UI.updateFactionFilter(state.factions);
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      state.factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null
    );
    UI.renderArmyList(state.currentArmy);
  }

  function rebuildAllUnits() {
    state.allUnits = [];
    state.factions.forEach(faction => {
      (faction.units || []).forEach(unit => {
        state.allUnits.push({ ...unit, _factionName: faction.factionName });
      });
    });
  }

  function findUnit(unitId, factionName) {
    return state.allUnits.find(u => u.id === unitId && u._factionName === factionName)
        || state.allUnits.find(u => u.id === unitId)
        || null;
  }

  function getCurrentFaction() {
    if (state.factionFilter === 'all') return null;
    return state.factions.find(f => f.factionName === state.factionFilter) || null;
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
            UI.updateFactionFilter(state.factions);
            UI.renderUnitRoster(
              state.allUnits,
              document.getElementById('search-input').value,
              state.factionFilter,
              state.selectedUnit ? state.selectedUnit.id : null
            );
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

    // ---- Army faction selector (drives unit panel filter) ----
    document.getElementById('army-faction-select').addEventListener('change', e => {
      state.factionFilter = e.target.value;
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        state.factionFilter,
        state.selectedUnit ? state.selectedUnit.id : null
      );
      // Show faction rules in army panel
      const faction = getCurrentFaction();
      UI.updateFactionRules(faction);
      // Update detachment dropdown for this faction
      updateDetachmentOptions(faction);
    });

    // ---- Detachment selector (placeholder — filters units in future) ----
    document.getElementById('army-detachment-select').addEventListener('change', () => {
      // Future: filter units by detachment requirements
    });

    // ---- Search ----
    document.getElementById('search-input').addEventListener('input', () => {
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        state.factionFilter,
        state.selectedUnit ? state.selectedUnit.id : null
      );
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

    // ---- Faction rule click → show rule in details panel ----
    document.getElementById('army-rules-list').addEventListener('click', e => {
      const item = e.target.closest('.army-rule-item');
      if (!item) return;
      UI.renderRuleDetail(item.dataset.ruleName, item.dataset.ruleDesc);
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
        // Single cost option
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

    document.getElementById('btn-export-text').addEventListener('click', () => {
      const text = Storage.exportArmyToText(state.currentArmy);
      const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
      Storage.downloadFile(text, `${name}.txt`, 'text/plain');
      UI.toast('Exported as text', 'success');
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

  // ── Detachment options ────────────────────────────────────────────────
  // Populated from faction data — currently parses rules named like "Detachment:"
  // from faction abilities; can be enhanced as BSData detachment structure is known.
  function updateDetachmentOptions(faction) {
    const select = document.getElementById('army-detachment-select');
    select.innerHTML = '';

    if (!faction) {
      select.innerHTML = '<option value="">— Select Faction First —</option>';
      return;
    }

    // Look for abilities whose names suggest they are detachment rules
    const detachments = (faction.factionAbilities || [])
      .filter(a => /detachment/i.test(a.name))
      .map(a => ({ name: a.name.replace(/detachment[:\s]*/i, '').trim() || a.name, ability: a }));

    if (detachments.length === 0) {
      select.innerHTML = '<option value="">— Custom / No Detachment —</option>';
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
