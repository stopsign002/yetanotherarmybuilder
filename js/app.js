/**
 * app.js - Application entry point
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Application State ─────────────────────────────────────────────────
  const state = {
    factions:     [],   // all loaded factions (manual + BSData)
    allUnits:     [],   // flat unit array
    currentArmy:  null,
    armyManager:  null,
    selectedUnit: null,
  };

  UI.init(state);

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function bootstrap() {
    state.armyManager = new ArmyManager();

    // Load any manually-uploaded factions from localStorage
    state.factions = Storage.loadFactionData();
    rebuildAllUnits();

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
    UI.setUploadDragDrop(handleFiles);
    wireEvents();

    // Start loading all factions from BSData in the background
    autoLoadFromBSData();
  }

  // ── Render helpers ────────────────────────────────────────────────────
  function renderAll() {
    UI.updateFactionFilter(state.factions);
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      document.getElementById('faction-filter').value,
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

  // ── BSData auto-load ──────────────────────────────────────────────────
  async function autoLoadFromBSData() {
    try {
      await BSData.loadAllFactions(
        // onProgress
        (done, total, lastName) => {
          UI.setLoadProgress(done, total);
        },
        // onFactionLoaded
        faction => {
          // Only add if we don't already have this faction (manual upload takes priority)
          const exists = state.factions.some(f => f.factionName === faction.factionName);
          if (!exists) {
            state.factions.push(faction);
            rebuildAllUnits();
            // Incrementally update the filter and roster
            UI.updateFactionFilter(state.factions);
            UI.renderUnitRoster(
              state.allUnits,
              document.getElementById('search-input').value,
              document.getElementById('faction-filter').value,
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

  // ── Manual file upload ────────────────────────────────────────────────
  async function handleFiles(files) {
    for (const file of files) {
      try {
        const text = await readFileAsText(file);
        const result = WahapediaParser.parse(text, file.name);
        if (result.units.length === 0) {
          UI.toast(`No units found in "${file.name}"`, 'warning');
          continue;
        }
        // Manual uploads go to localStorage AND override any BSData version
        state.factions = Storage.addFaction(result);
        // Also replace in-memory if BSData had loaded it
        const bsIdx = state.factions.findIndex(f => f.factionName === result.factionName);
        if (bsIdx === -1) state.factions.push(result);
        rebuildAllUnits();
        renderAll();
        UI.toast(`Loaded "${result.factionName}" (${result.units.length} units)`, 'success');
      } catch (err) {
        UI.toast(`Failed to parse "${file.name}": ${err.message}`, 'error', 5000);
      }
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ── Wire up all event listeners ───────────────────────────────────────
  function wireEvents() {

    // ---- Upload button ----
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFiles([...e.target.files]);
      e.target.value = '';
    });

    // ---- Faction filter ----
    document.getElementById('faction-filter').addEventListener('change', () => {
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        document.getElementById('faction-filter').value,
        state.selectedUnit ? state.selectedUnit.id : null
      );
    });

    // ---- Search ----
    document.getElementById('search-input').addEventListener('input', () => {
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        document.getElementById('faction-filter').value,
        state.selectedUnit ? state.selectedUnit.id : null
      );
    });

    // ---- Unit card click → show detail in right panel ----
    document.getElementById('unit-grid').addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card) return;
      const unit = findUnit(card.dataset.unitId, card.dataset.factionName);
      if (!unit) return;

      // Deselect previous card, select new one
      document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      state.selectedUnit = unit;
      UI.renderUnitDetail(unit);
    });

    // ---- Add to Army (right panel detail button) ----
    document.getElementById('unit-detail-panel').addEventListener('click', e => {
      if (!e.target.closest('#btn-detail-add')) return;
      if (!state.selectedUnit) return;
      const qty = parseInt(document.getElementById('detail-qty').value, 10) || 1;
      state.currentArmy.addUnit(state.selectedUnit, qty);
      UI.renderArmyList(state.currentArmy);
      UI.toast(`Added ${qty}× ${state.selectedUnit.name}`, 'success');
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
      const index    = parseInt(btn.dataset.index, 10);
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

  // ── Start the app ─────────────────────────────────────────────────────
  bootstrap();
});
