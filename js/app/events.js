// app/events.js — all event listeners (toolbar, dropdowns, unit grid, modals).
(function () {
  const App = window.App = window.App || {};

  App.wireEvents = function () {
    const state = App.state;

    document.getElementById('army-faction-select').addEventListener('change', e => {
      state.factionFilter = e.target.value;
      state.selectedChapter = null;
      state.selectedDetachment = null;
      state.selectedDetachments = [];
      state.detachmentFaction  = null;
      state.selectedArmyEntryIndex = null;
      if (state.currentArmy) {
        state.currentArmy.factionName = state.factionFilter === 'all' ? '' : state.factionFilter;
        state.currentArmy.chapter     = null;
        state.currentArmy.setDetachments([], { touch: false });
      }
      App.applyFactionColor(state.factionFilter === 'all' ? null : state.factionFilter);
      App.updateChapterDropdown(state.factionFilter);
      App.renderUnitRosterWithContext();
      const faction = App.getCurrentFaction();
      UI.updateFactionRules(faction);
      App.renderDetachmentPicker();
    });

    document.getElementById('army-chapter-select').addEventListener('change', e => {
      state.selectedChapter = e.target.value || null;
      state.selectedDetachment = null;
      state.selectedDetachments = [];
      state.detachmentFaction  = null;
      state.selectedArmyEntryIndex = null;
      if (state.currentArmy) {
        state.currentArmy.chapter = state.selectedChapter;
        state.currentArmy.setDetachments([], { touch: false });
      }
      App.applyFactionColor(state.selectedChapter || state.factionFilter);
      App.renderUnitRosterWithContext();
      const faction = App.getCurrentFaction();
      UI.updateFactionRules(faction);
      App.renderDetachmentPicker();
    });

    // The detachment selection is driven by the Detachments box
    // (js/app/detachment-picker.js), which owns its own click handling and
    // re-renders the Army Rules union + open detail. No dropdown handler here.

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
      const detEnhancements = App.getActiveEnhancements ? App.getActiveEnhancements() : [];
      UI.renderUnitDetail(unit, detEnhancements, []);
      if (App.setMobilePanel) App.setMobilePanel('detail');
    });

    // Double-click on a unit card adds 1× to the army with the default
    // squad option and no enhancements — a quick path that skips the
    // detail panel for users who know what they want.
    document.getElementById('unit-grid').addEventListener('dblclick', e => {
      const card = e.target.closest('.unit-card');
      if (!card) return;
      const unit = App.findUnit(card.dataset.unitId, card.dataset.factionName);
      if (!unit) return;
      const squadOption = (unit.squadOptions && unit.squadOptions[0]) || null;
      state.currentArmy.addUnit(unit, 1, squadOption, []);
      UI.renderArmyList(state.currentArmy);
      const label = squadOption && squadOption.models
        ? `${unit.name} (${squadOption.models} models)`
        : unit.name;
      UI.toast(`Added ${label}`, 'success');
    });

    document.getElementById('army-rules-section').addEventListener('click', e => {
      const item = e.target.closest('.army-rule-item');
      if (!item) return;
      UI.renderRuleDetail({
        name:        item.dataset.ruleName,
        description: item.dataset.ruleDesc,
        type:        item.dataset.ruleType || 'rule',
        pts:         item.dataset.rulePts  ? parseInt(item.dataset.rulePts) : null,
        cp:          item.dataset.ruleCp   != null && item.dataset.ruleCp !== '' ? item.dataset.ruleCp : null,
        phase:       item.dataset.rulePhase || null,
      });
      // Mobile: show the detail panel where renderRuleDetail just wrote.
      // Without this, the rule body lands in an off-screen panel and the
      // tap looks like it did nothing.
      if (App.setMobilePanel) App.setMobilePanel('detail');
    });

    document.getElementById('unit-detail-panel').addEventListener('change', e => {
      const cb = e.target.closest('.enhancement-cb');
      if (!cb) return;
      if (state.selectedArmyEntryIndex == null) return;
      const entry = state.currentArmy.entries[state.selectedArmyEntryIndex];
      if (!entry) return;
      const detEnhs = App.getActiveEnhancements ? App.getActiveEnhancements() : [];
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
      // Persist immediately. Without saveArmy the change only lives in
      // memory — reload would drop it and sync would never push it. The
      // saveArmy path also writes localStorage and notifies sync.
      state.armyManager.saveArmy(state.currentArmy);
      UI.renderArmyList(state.currentArmy);
    });

    document.getElementById('unit-detail-panel').addEventListener('click', e => {
      if (!e.target.closest('#btn-detail-add')) return;
      if (!state.selectedUnit) return;

      // Quantity box removed — Add always adds one; click again for more.
      const qtyEl = document.getElementById('detail-qty');
      const qty = qtyEl ? (parseInt(qtyEl.value, 10) || 1) : 1;
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

      const detEnhs = App.getActiveEnhancements ? App.getActiveEnhancements() : [];
      const selectedEnhancements = Array.from(
        document.querySelectorAll('#detail-enhancements-section .enhancement-cb:checked')
      ).map(cb => detEnhs.find(e => e.name === cb.value)).filter(Boolean);

      // Wargear picker: snapshot the configured loadout onto the new entry.
      const wargearSel = (App.WargearPicker && App.WargearPicker.takeSelections)
        ? App.WargearPicker.takeSelections(state.selectedUnit) : [];

      state.currentArmy.addUnit(state.selectedUnit, qty, squadOption, selectedEnhancements, wargearSel);
      UI.renderArmyList(state.currentArmy);
      const label = squadOption && squadOption.models
        ? `${qty}× ${state.selectedUnit.name} (${squadOption.models} models)`
        : `${qty}× ${state.selectedUnit.name}`;
      UI.toast(`Added ${label}`, 'success');
      if (App.setMobilePanel) App.setMobilePanel('units');
    });

    document.getElementById('army-name-input').addEventListener('input', e => {
      state.currentArmy.name = e.target.value || 'My Army';
      // touch() + an armyChange are BOTH required. Without the stamp, sync's
      // `known[id] !== updatedAt` diff never enqueues the rename, so it stays
      // on this device forever; without the hook, nothing schedules the
      // debounced autosave, so it never even reaches localStorage. This
      // handler previously did neither — renaming an army was a memory-only
      // edit that a pull from another browser would silently undo.
      state.currentArmy.touch();
      App.fireArmyChange('rename');
    });

    document.getElementById('points-limit-input').addEventListener('input', e => {
      state.currentArmy.pointsLimit = parseInt(e.target.value, 10) || 0;
      // Same reason as the rename above. renderArmyList fires armyChange
      // ('render'), which is what schedules the autosave, so only the stamp
      // was missing here — the new limit was written to localStorage under an
      // unchanged updatedAt and therefore never pushed.
      state.currentArmy.touch();
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
      const detEnhs = App.getActiveEnhancements ? App.getActiveEnhancements() : [];
      UI.renderUnitDetail(entry.unitData, detEnhs, entry.enhancements || []);
      if (App.setMobilePanel) App.setMobilePanel('detail');
    });

    document.getElementById('btn-new-army').addEventListener('click', () => {
      if (state.currentArmy.entries.length > 0 &&
          !confirm('Start a new army? Unsaved changes will be lost.')) return;
      state.currentArmy = state.armyManager.newArmy();
      UI.renderArmyList(state.currentArmy);
      UI.toast('New army created', 'info');
    });

    document.getElementById('btn-save-army').addEventListener('click', () => {
      const nameInput = document.getElementById('army-name-input');
      state.currentArmy.name = nameInput.value;
      if (!state.armyManager.saveArmy(state.currentArmy)) {
        // ArmyManager rejected the save because the army is still using
        // the default placeholder name. Tell the user explicitly and
        // focus the name field so they can fix it without hunting.
        alert('Please give your army a name before saving.\n\n"New Army" is the default placeholder — change it to something like "My Custodes 2k" first.');
        nameInput.focus();
        nameInput.select();
        return;
      }
      UI.toast(`Saved "${state.currentArmy.name}"`, 'success');
    });

    document.getElementById('btn-load-army').addEventListener('click', async () => {
      const btn = document.getElementById('btn-load-army');
      // If signed in, pull cloud state before opening the modal so the
      // listing — and getArmy() on click — reflects saves made on other
      // devices since this tab was last in the foreground. Race against a
      // 2s timeout so a slow network can't hold the modal closed; the user
      // still gets the local list as a fallback.
      const signedIn = App.Auth && App.Auth.isSignedIn && App.Auth.isSignedIn();
      if (signedIn && App.Sync && typeof App.Sync.pullAll === 'function') {
        btn.disabled = true;
        try {
          await Promise.race([
            App.Sync.pullAll().catch(() => {}),
            new Promise(r => setTimeout(r, 2000)),
          ]);
        } finally {
          btn.disabled = false;
        }
      }
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
          App.applyImportedSelections(army.factionName, army.chapter, army.detachmentNames);
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
          factionName:     state.factionFilter !== 'all' ? state.factionFilter : '',
          chapter:         state.selectedChapter,
          detachmentNames: (state.selectedDetachments || []).map(d => d.name),
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
        detachmentNames: (state.selectedDetachments || []).map(d => d.name),
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

    // Static Data-cards button — switches to the full-page Cards mode.
    const cardsBtn = document.getElementById('btn-data-cards');
    if (cardsBtn) {
      cardsBtn.addEventListener('click', () => {
        if (window.App && typeof App.setMode === 'function') {
          App.setMode('cards');
        } else if (window.UI && typeof UI.toast === 'function') {
          UI.toast('Cards mode unavailable', 'warning');
        }
      });
    }
  };
})();
