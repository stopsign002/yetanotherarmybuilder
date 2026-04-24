// app/events.js — all event listeners (toolbar, dropdowns, unit grid, modals).
(function () {
  const App = window.App = window.App || {};

  App.wireEvents = function () {
    const state = App.state;

    document.getElementById('army-faction-select').addEventListener('change', e => {
      state.factionFilter = e.target.value;
      state.selectedChapter = null;
      state.selectedDetachment = null;
      state.detachmentFaction  = null;
      state.selectedArmyEntryIndex = null;
      document.getElementById('army-detachment-select').value = '';
      App.applyFactionColor(state.factionFilter === 'all' ? null : state.factionFilter);
      App.updateChapterDropdown(state.factionFilter);
      App.renderUnitRosterWithContext();
      const faction = App.getCurrentFaction();
      UI.updateFactionRules(faction);
      App.updateDetachmentOptions();
    });

    document.getElementById('army-chapter-select').addEventListener('change', e => {
      state.selectedChapter = e.target.value || null;
      state.selectedDetachment = null;
      state.detachmentFaction  = null;
      state.selectedArmyEntryIndex = null;
      document.getElementById('army-detachment-select').value = '';
      App.applyFactionColor(state.selectedChapter || state.factionFilter);
      App.renderUnitRosterWithContext();
      const faction = App.getCurrentFaction();
      UI.updateFactionRules(faction);
      App.updateDetachmentOptions();
    });

    document.getElementById('army-detachment-select').addEventListener('change', e => {
      const detName = e.target.value;
      const dets = (state.detachmentFaction && state.detachmentFaction.detachments) || [];
      state.selectedDetachment = detName ? (dets.find(d => d.name === detName) || null) : null;
      UI.updateFactionRules(App.getCurrentFaction(), state.selectedDetachment);
    });

    document.getElementById('search-input').addEventListener('input', () => {
      App.renderUnitRosterWithContext();
    });

    document.getElementById('unit-grid').addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card) return;
      const unit = App.findUnit(card.dataset.unitId, card.dataset.factionName);
      if (!unit) return;

      document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      state.selectedUnit = unit;
      state.selectedArmyEntryIndex = null;
      const detEnhancements = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
      UI.renderUnitDetail(unit, detEnhancements, []);
    });

    document.getElementById('army-rules-section').addEventListener('click', e => {
      const item = e.target.closest('.army-rule-item');
      if (!item) return;
      UI.renderRuleDetail({
        name:        item.dataset.ruleName,
        description: item.dataset.ruleDesc,
        type:        item.dataset.ruleType || 'rule',
        pts:         item.dataset.rulePts  ? parseInt(item.dataset.rulePts) : null,
      });
    });

    document.getElementById('unit-detail-panel').addEventListener('change', e => {
      const cb = e.target.closest('.enhancement-cb');
      if (!cb) return;
      if (state.selectedArmyEntryIndex == null) return;
      const entry = state.currentArmy.entries[state.selectedArmyEntryIndex];
      if (!entry) return;
      const detEnhs = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
      const enh = detEnhs.find(e => e.name === cb.value);
      if (!enh) return;
      const enhs = [...(entry.enhancements || [])];
      if (cb.checked) {
        if (!enhs.some(e => e.name === enh.name)) enhs.push(enh);
      } else {
        const i = enhs.findIndex(e => e.name === enh.name);
        if (i >= 0) enhs.splice(i, 1);
      }
      state.currentArmy.setEnhancements(state.selectedArmyEntryIndex, enhs);
      UI.renderArmyList(state.currentArmy);
    });

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

      const detEnhs = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
      const selectedEnhancements = Array.from(
        document.querySelectorAll('#detail-enhancements-section .enhancement-cb:checked')
      ).map(cb => detEnhs.find(e => e.name === cb.value)).filter(Boolean);

      state.currentArmy.addUnit(state.selectedUnit, qty, squadOption, selectedEnhancements);
      UI.renderArmyList(state.currentArmy);
      const label = squadOption && squadOption.models
        ? `${qty}× ${state.selectedUnit.name} (${squadOption.models} models)`
        : `${qty}× ${state.selectedUnit.name}`;
      UI.toast(`Added ${label}`, 'success');
    });

    document.getElementById('army-name-input').addEventListener('input', e => {
      state.currentArmy.name = e.target.value || 'My Army';
    });

    document.getElementById('points-limit-input').addEventListener('input', e => {
      state.currentArmy.pointsLimit = parseInt(e.target.value, 10) || 0;
      UI.renderArmyList(state.currentArmy);
    });

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
      if (btn) {
        const index     = parseInt(btn.dataset.index, 10);
        const entryName = state.currentArmy.entries[index]?.unitName || 'unit';
        state.currentArmy.removeEntry(index);
        if (state.selectedArmyEntryIndex === index) {
          state.selectedArmyEntryIndex = null;
          UI.clearUnitDetail();
        }
        UI.renderArmyList(state.currentArmy);
        UI.toast(`Removed ${entryName}`, 'info');
        return;
      }
      const li = e.target.closest('.army-entry');
      if (!li) return;
      const index = parseInt(li.dataset.index, 10);
      const entry = state.currentArmy.entries[index];
      if (!entry) return;
      state.selectedArmyEntryIndex = index;
      state.selectedUnit = null;
      document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
      const detEnhs = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
      UI.renderUnitDetail(entry.unitData, detEnhs, entry.enhancements || []);
    });

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

    document.getElementById('btn-export-string').addEventListener('click', async () => {
      try {
        const code = await Storage.exportArmyToString(state.currentArmy, {
          factionName:    state.factionFilter !== 'all' ? state.factionFilter : '',
          chapter:        state.selectedChapter,
          detachmentName: state.selectedDetachment ? state.selectedDetachment.name : null,
        });
        UI.showExportModal(code);
      } catch (err) {
        UI.toast('Export failed: ' + err.message, 'error', 5000);
      }
    });

    document.getElementById('btn-export-copy').addEventListener('click', async () => {
      const ta = document.getElementById('export-string-textarea');
      try {
        await navigator.clipboard.writeText(ta.value);
        UI.toast('Copied to clipboard', 'success');
      } catch (_) {
        ta.select();
        document.execCommand && document.execCommand('copy');
        UI.toast('Copied (select-and-copy fallback)', 'info');
      }
    });

    document.getElementById('btn-export-done').addEventListener('click', UI.hideExportModal);
    document.getElementById('modal-export-close').addEventListener('click', UI.hideExportModal);
    document.getElementById('modal-export').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideExportModal();
    });

    document.getElementById('btn-export-text').addEventListener('click', async () => {
      const text = Storage.exportArmyToText(state.currentArmy, {
        detachmentName: state.selectedDetachment ? state.selectedDetachment.name : null,
      });
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

    document.getElementById('btn-import-string').addEventListener('click', UI.showImportModal);
    document.getElementById('modal-import-close').addEventListener('click', UI.hideImportModal);
    document.getElementById('btn-import-cancel').addEventListener('click', UI.hideImportModal);
    document.getElementById('modal-import').addEventListener('click', e => {
      if (e.target === e.currentTarget) UI.hideImportModal();
    });

    document.getElementById('btn-import-confirm').addEventListener('click', async () => {
      const raw = document.getElementById('import-json-textarea').value.trim();
      if (!raw) { UI.toast('Paste an army code first', 'warning'); return; }
      try {
        const { army, chapter, detachment } = await Storage.importArmyFromString(raw, {
          factions: state.factions,
        });
        state.armyManager.saveArmy(army);
        state.currentArmy = army;
        state.armyManager.currentArmy = army;
        App.applyImportedSelections(army.factionName, chapter, detachment);
        UI.hideImportModal();
        UI.renderArmyList(state.currentArmy);
        UI.toast(`Imported "${army.name}"`, 'success');
      } catch (err) {
        UI.toast('Import failed: ' + err.message, 'error', 5000);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        UI.hideLoadModal();
        UI.hideImportModal();
        UI.hideExportModal();
      }
    });
  };
})();
