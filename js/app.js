/**
 * app.js - Application entry point: wires up all events and manages state
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Application State ─────────────────────────────────────────────────
  const state = {
    factions: [],        // Array of parsed faction objects
    allUnits: [],        // Flat array of all units from all factions
    currentArmy: null,   // Active Army instance
    armyManager: null,   // ArmyManager instance
    selectedUnit: null,  // Unit currently shown in detail modal
  };

  UI.init(state);

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function bootstrap() {
    // Load army manager (persisted armies)
    state.armyManager = new ArmyManager();

    // Load faction data from localStorage
    state.factions = Storage.loadFactionData();
    rebuildAllUnits();

    // Create or load a current army
    if (state.armyManager.armies.length > 0) {
      // Load the most-recently-updated army
      const sorted = [...state.armyManager.armies].sort((a, b) => {
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });
      state.currentArmy = sorted[0];
      state.armyManager.currentArmy = state.currentArmy;
    } else {
      state.currentArmy = state.armyManager.newArmy();
    }

    renderAll();
    UI.setUploadDragDrop(handleFiles);
    wireEvents();
  }

  // ── Render all panels ─────────────────────────────────────────────────
  function renderAll() {
    UI.renderFactionList(state.factions);
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      document.getElementById('faction-filter').value
    );
    UI.renderArmyList(state.currentArmy);
  }

  function rebuildAllUnits() {
    state.allUnits = [];
    state.factions.forEach(faction => {
      (faction.units || []).forEach(unit => {
        // Tag each unit with its source faction
        state.allUnits.push({ ...unit, _factionName: faction.factionName });
      });
    });
  }

  function findUnit(unitId, factionName) {
    return state.allUnits.find(u => u.id === unitId && u._factionName === factionName) ||
           state.allUnits.find(u => u.id === unitId) || null;
  }

  // ── File upload handling ──────────────────────────────────────────────
  async function handleFiles(files) {
    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        const text = await readFileAsText(file);
        const result = WahapediaParser.parse(text, file.name);

        if (result.units.length === 0) {
          UI.toast(`No units found in "${file.name}". Is it a valid Battlescribe file?`, 'warning');
          continue;
        }

        state.factions = Storage.addFaction(result);
        successCount++;
        UI.toast(`Loaded "${result.factionName}" (${result.units.length} units)`, 'success');
      } catch (err) {
        console.error('File parse error:', err);
        UI.toast(`Failed to parse "${file.name}": ${err.message}`, 'error', 5000);
        errorCount++;
      }
    }

    if (successCount > 0) {
      state.factions = Storage.loadFactionData();
      rebuildAllUnits();
      renderAll();
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ── Wire up all event listeners ───────────────────────────────────────
  function wireEvents() {

    // ---- Upload button ----
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
    document.getElementById('upload-area').addEventListener('click', e => {
      if (e.target.id !== 'btn-upload') fileInput.click();
    });
    fileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFiles([...e.target.files]);
      e.target.value = ''; // reset so same file can be re-uploaded
    });

    // ---- Faction list: delete faction via event delegation ----
    document.getElementById('faction-list').addEventListener('click', e => {
      const btn = e.target.closest('.faction-item-del');
      if (!btn) return;
      const factionName = btn.dataset.faction;
      if (confirm(`Remove faction "${factionName}"?\nThis will not affect saved armies.`)) {
        state.factions = Storage.removeFaction(factionName);
        rebuildAllUnits();
        renderAll();
        UI.toast(`Removed "${factionName}"`, 'info');
      }
    });

    // ---- Faction filter dropdown ----
    document.getElementById('faction-filter').addEventListener('change', () => {
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        document.getElementById('faction-filter').value
      );
    });

    // ---- Search input ----
    document.getElementById('search-input').addEventListener('input', () => {
      UI.renderUnitRoster(
        state.allUnits,
        document.getElementById('search-input').value,
        document.getElementById('faction-filter').value
      );
    });

    // ---- Unit card click: show detail modal ----
    document.getElementById('unit-grid').addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card) return;
      const unitId = card.dataset.unitId;
      const factionName = card.dataset.factionName;
      const unit = findUnit(unitId, factionName);
      if (!unit) return;
      state.selectedUnit = unit;
      UI.showUnitModal(unit);
    });

    // ---- Unit modal: Add to army ----
    document.getElementById('btn-add-unit-confirm').addEventListener('click', () => {
      if (!state.selectedUnit) return;
      const qty = parseInt(document.getElementById('unit-modal-qty').value, 10) || 1;
      state.currentArmy.addUnit(state.selectedUnit, qty);
      UI.renderArmyList(state.currentArmy);
      UI.hideUnitModal();
      UI.toast(`Added ${qty}x ${state.selectedUnit.name} to army`, 'success');
    });

    // ---- Unit modal: Cancel ----
    document.getElementById('btn-unit-modal-cancel').addEventListener('click', UI.hideUnitModal);
    document.getElementById('modal-unit-close').addEventListener('click', UI.hideUnitModal);

    // ---- Modal backdrop clicks ----
    document.getElementById('modal-unit').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideUnitModal();
    });
    document.getElementById('modal-load').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideLoadModal();
    });
    document.getElementById('modal-import').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideImportModal();
    });

    // ---- Army name input ----
    document.getElementById('army-name-input').addEventListener('input', e => {
      state.currentArmy.name = e.target.value || 'My Army';
    });

    // ---- Points limit input ----
    document.getElementById('points-limit-input').addEventListener('input', e => {
      state.currentArmy.pointsLimit = parseInt(e.target.value, 10) || 0;
      UI.renderArmyList(state.currentArmy);
    });

    // ---- Army list: qty change + remove via delegation ----
    document.getElementById('army-entry-list').addEventListener('change', e => {
      const input = e.target.closest('.army-qty-input');
      if (!input) return;
      const index = parseInt(input.dataset.index, 10);
      const val = parseInt(input.value, 10);
      if (isNaN(val) || val < 0) return;
      state.currentArmy.updateCount(index, val);
      UI.renderArmyList(state.currentArmy);
    });

    document.getElementById('army-entry-list').addEventListener('click', e => {
      const btn = e.target.closest('.army-entry-remove');
      if (!btn) return;
      const index = parseInt(btn.dataset.index, 10);
      const entryName = state.currentArmy.entries[index]?.unitName || 'unit';
      state.currentArmy.removeEntry(index);
      UI.renderArmyList(state.currentArmy);
      UI.toast(`Removed ${entryName}`, 'info');
    });

    // ---- Toolbar buttons ----

    // New Army
    document.getElementById('btn-new-army').addEventListener('click', () => {
      if (state.currentArmy.entries.length > 0) {
        if (!confirm('Start a new army? Unsaved changes will be lost.')) return;
      }
      state.currentArmy = state.armyManager.newArmy();
      UI.renderArmyList(state.currentArmy);
      UI.toast('New army created', 'info');
    });

    // Save Army
    document.getElementById('btn-save-army').addEventListener('click', () => {
      state.currentArmy.name = document.getElementById('army-name-input').value || 'My Army';
      state.armyManager.saveArmy(state.currentArmy);
      UI.toast(`Army "${state.currentArmy.name}" saved`, 'success');
    });

    // Load Army
    document.getElementById('btn-load-army').addEventListener('click', () => {
      UI.showLoadModal(state.armyManager.armies);
    });

    // Load modal: close
    document.getElementById('modal-load-close').addEventListener('click', UI.hideLoadModal);

    // Load modal: load / delete buttons (delegation)
    document.getElementById('saved-army-list').addEventListener('click', e => {
      const loadBtn = e.target.closest('.btn-load-saved');
      const delBtn = e.target.closest('.btn-delete-saved');

      if (loadBtn) {
        const id = loadBtn.dataset.id;
        const army = state.armyManager.getArmy(id);
        if (army) {
          state.currentArmy = army;
          state.armyManager.currentArmy = army;
          UI.hideLoadModal();
          UI.renderArmyList(state.currentArmy);
          UI.toast(`Loaded "${army.name}"`, 'success');
        }
      }

      if (delBtn) {
        const id = delBtn.dataset.id;
        const army = state.armyManager.getArmy(id);
        if (!army) return;
        if (!confirm(`Delete army "${army.name}"? This cannot be undone.`)) return;
        state.armyManager.deleteArmy(id);
        if (state.currentArmy && state.currentArmy.id === id) {
          state.currentArmy = state.armyManager.newArmy();
          UI.renderArmyList(state.currentArmy);
        }
        UI.showLoadModal(state.armyManager.armies);
        UI.toast(`Deleted "${army.name}"`, 'info');
      }
    });

    // Export JSON
    document.getElementById('btn-export-json').addEventListener('click', () => {
      const json = Storage.exportArmyToJSON(state.currentArmy);
      const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
      Storage.downloadFile(json, `${name}.json`, 'application/json');
      UI.toast('Army exported as JSON', 'success');
    });

    // Export Text
    document.getElementById('btn-export-text').addEventListener('click', () => {
      const text = Storage.exportArmyToText(state.currentArmy);
      const name = (state.currentArmy.name || 'army').replace(/[^a-z0-9_-]/gi, '_');
      Storage.downloadFile(text, `${name}.txt`, 'text/plain');
      UI.toast('Army exported as text', 'success');
    });

    // Import JSON: show modal
    document.getElementById('btn-import-json').addEventListener('click', UI.showImportModal);
    document.getElementById('modal-import-close').addEventListener('click', UI.hideImportModal);
    document.getElementById('btn-import-cancel').addEventListener('click', UI.hideImportModal);

    // Import JSON: confirm
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
        UI.hideUnitModal();
        UI.hideLoadModal();
        UI.hideImportModal();
      }
      // Enter in unit modal qty triggers add
      if (e.key === 'Enter' && !document.getElementById('modal-unit').hasAttribute('hidden')) {
        document.getElementById('btn-add-unit-confirm').click();
      }
    });
  }

  // ── Start the app ─────────────────────────────────────────────────────
  bootstrap();
});
