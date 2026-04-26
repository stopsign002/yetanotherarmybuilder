// ui/save-pulse.js — pulses the Save button while the current army has unsaved mutations.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Mutation-kind allowlist. armyChange currently fires with 'render' for
  // any mutation-driven rerender and 'load' when a saved army is loaded.
  // 'load' is NOT a user mutation, so we clear-not-set on it. We treat
  // any other kind that signals an actual change as dirty — including
  // 'add' / 'qty' / 'remove' if/when those get added later.
  const CLEAN_KINDS = { load: true };

  let dirty = false;
  // Snapshot used to suppress the very first armyChange (the initial
  // render at boot, before the user has touched anything).
  let lastSig = null;
  let booted  = false;

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
      return;
    }
    if (CLEAN_KINDS[kind]) {
      lastSig = sig;
      setDirty(false);
      return;
    }
    if (sig !== lastSig) {
      lastSig = sig;
      setDirty(true);
    }
  });

  App.hooks.bootstrap.push(function (state) {
    lastSig = entriesSig(state && state.currentArmy);
    booted  = true;
    const btn = document.getElementById('btn-save-army');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Save handler runs synchronously elsewhere; clear immediately.
      setDirty(false);
      lastSig = entriesSig(App.state && App.state.currentArmy);
    });
  });
})();
