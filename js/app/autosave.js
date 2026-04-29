// app/autosave.js — auto-persist the current army on any mutation.
//
// Hooks into App.hooks.armyChange. Every army-mutating event (add unit,
// remove unit, qty change, enhancement toggle, points-override edit, etc.)
// renders the army list, which fires armyChange('render') from
// js/ui/army-list.js. We catch that and call ArmyManager.saveArmy(...) on
// a small debounce so a burst of changes (typing in a qty input) collapses
// to a single localStorage write.
//
// Recursion guard: ArmyManager.saveArmy fires armyChange('save') on
// completion. Without filtering, that would re-trigger autosave forever.
// We ignore 'save' and 'delete' kinds — those paths already persist.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !Array.isArray(App.hooks.armyChange)) return;

  const DEBOUNCE_MS = 500;
  let saveTimer = null;
  let pending = null; // { armyId } — the army to save when timer fires

  function performSave() {
    saveTimer = null;
    const target = pending;
    pending = null;
    if (!target) return;
    const state = App.state;
    if (!state || !state.armyManager || !state.currentArmy) return;
    // Only save if the current army is still the one we queued for.
    // Switching to another army between schedule and fire is fine — the
    // new army's hook will queue its own save.
    if (state.currentArmy.id !== target.armyId) return;
    try {
      state.armyManager.saveArmy(state.currentArmy);
    } catch (e) {
      console.warn('[autosave] save failed:', e && e.message ? e.message : e);
    }
  }

  function schedule() {
    const state = App.state;
    if (!state || !state.armyManager || !state.currentArmy) return;
    pending = { armyId: state.currentArmy.id };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(performSave, DEBOUNCE_MS);
  }

  App.hooks.armyChange.push(function (army, kind) {
    // Don't recurse on the save we just performed, and skip delete (which
    // has already touched localStorage on its own path).
    if (kind === 'save' || kind === 'delete') return;
    schedule();
  });

  // Best-effort flush on tab close / hide so unsaved typing doesn't get
  // dropped if the user closes the tab mid-debounce.
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      performSave();
    }
  }
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
})();
