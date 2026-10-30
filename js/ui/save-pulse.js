// ui/save-pulse.js — pulses the Save button while the current army has unsaved mutations.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // armyChange kinds that actually fire (hooks.js / army.js / army-list.js):
  //   'render'  every mutation-driven rerender (also fires on load/new, which
  //             is handled by the army-id check below)  -> dirty if sig moved
  //   'rename'  name typed                              -> dirty if sig moved
  //   'save'    ArmyManager.saveArmy succeeded (explicit Save AND autosave)
  //             -> clean. A REJECTED save never fires it, so it stays dirty.
  //   'delete'  the saved list changed                  -> resync only
  // There is no 'load' kind; a different army id means a load / New / import.
  const CLEAN_KINDS = { save: true };

  let dirty = false;
  // Snapshot used to suppress the very first armyChange (the initial
  // render at boot, before the user has touched anything).
  let lastSig = null;
  let booted  = false;
  let lastArmyId = null;

  function entriesSig(army) {
    if (!army || !army.entries) return '|';
    const parts = [];
    army.entries.forEach(function (e) {
      const enh = (e.enhancements || []).map(x => (x && x.name) || '').sort().join(',');
      parts.push((e.unitId || e.unitName || '') + ':' + (e.count || 0) + ':' + enh + ':' + (e.selectedPts || ''));
    });
    parts.sort();
    return (army.name || '') + '#' + (army.pointsLimit || 0) + '#' + parts.join('|');
  }

  function setDirty(next) {
    if (dirty === next) return;
    dirty = next;
    const btn = document.getElementById('btn-save-army');
    if (!btn) return;
    btn.classList.toggle('has-unsaved', !!dirty);
    if (dirty) btn.setAttribute('aria-label', 'Save army (unsaved changes)');
    else       btn.removeAttribute('aria-label');
  }

  App.hooks.armyChange.push(function (army, kind) {
    const sig = entriesSig(army);
    if (!booted) {
      booted  = true;
      lastSig = sig;
      lastArmyId = army ? army.id : null;
      return;
    }
    if (CLEAN_KINDS[kind]) {
      // A save of some OTHER army (e.g. Save-as persisting the original first)
      // says nothing about the one on screen.
      const cur = App.state && App.state.currentArmy;
      if (army && cur && army.id !== cur.id) return;
      lastSig = sig;
      lastArmyId = army ? army.id : lastArmyId;
      setDirty(false);
      return;
    }
    // Swapping to another army (load / new / import / save-as copy) is not an
    // unsaved edit of that army.
    if (army && army.id !== lastArmyId) {
      lastArmyId = army.id;
      lastSig = sig;
      setDirty(false);
      return;
    }
    if (kind === 'delete') { lastSig = sig; return; }
    if (sig !== lastSig) {
      lastSig = sig;
      setDirty(true);
    }
  });

  App.hooks.bootstrap.push(function (state) {
    lastSig = entriesSig(state && state.currentArmy);
    lastArmyId = state && state.currentArmy ? state.currentArmy.id : null;
    booted  = true;
    // No click handler: the Save button's own handler may reject the save
    // (unnamed army), and only armyChange('save') proves it was persisted.
  });
})();
