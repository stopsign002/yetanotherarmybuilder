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
//
// Placeholder skip (narrowed by #113): an army still on the boot-time
// placeholder name ("New Army" — see Army constructor in js/army.js) is
// autosaved once it has at least one entry. Only an EMPTY placeholder is
// skipped, so browsing around does not seed blank rows in the saved list.
// It used to skip every "New Army", so a whole list built before naming it
// lived only in memory and a reload, crash or closed tab lost it.
// The explicit Save button still insists on a name (events.js) — that is a
// prompt, not a data-safety rule.
//
// beforeunload: the pending save is flushed synchronously first; the
// browser's "leave site?" prompt appears ONLY when that flush could not
// persist (storage full / blocked), i.e. when leaving really loses work.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !Array.isArray(App.hooks.armyChange)) return;

  const DEBOUNCE_MS = 500;
  let saveTimer = null;
  let pending = null; // { armyId } — the army to save when timer fires
  // True from a mutation until it is safely in localStorage. Stays true
  // after a FAILED save (quota), which is what arms the beforeunload prompt.
  let unsaved = false;

  function performSave() {
    saveTimer = null;
    const target = pending;
    pending = null;
    if (!target) return;
    const state = App.state;
    if (!state || !state.armyManager || !state.currentArmy) { unsaved = false; return; }
    // Only save if the current army is still the one we queued for.
    // Switching to another army between schedule and fire is fine — the
    // new army's hook will queue its own save.
    if (state.currentArmy.id !== target.armyId) { unsaved = false; return; }
    // Skip only an empty placeholder. Checked at fire time (not schedule
    // time) so a rename or a first unit between schedule and fire counts.
    const mgr = state.armyManager;
    const persistable = (window.ArmyManager && typeof ArmyManager.isPersistable === 'function')
      ? ArmyManager.isPersistable(state.currentArmy)
      : state.currentArmy.name !== 'New Army';
    if (!persistable) { unsaved = false; return; }
    try {
      mgr.saveArmy(state.currentArmy, { allowUnnamed: true });
      // ArmyManager.save() reports a storage failure itself (one toast) and
      // records it here rather than throwing.
      unsaved = mgr.lastSaveOk === false;
    } catch (e) {
      unsaved = true;
      console.warn('[autosave] save failed:', e && e.message ? e.message : e);
    }
  }

  function schedule() {
    const state = App.state;
    if (!state || !state.armyManager || !state.currentArmy) return;
    pending = { armyId: state.currentArmy.id };
    unsaved = true;
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
  window.addEventListener('beforeunload', function (e) {
    flush();
    // Any later successful save wrote every in-memory army (save() persists
    // the whole list), so an earlier failure no longer matters. Otherwise
    // try once more — space may have been freed since.
    const mgr = App.state && App.state.armyManager;
    if (unsaved && mgr && mgr.lastSaveOk !== false) unsaved = false;
    if (unsaved && mgr && typeof mgr.save === 'function') {
      try { if (mgr.save() !== false) unsaved = false; } catch (_) {}
    }
    // Prompt only while a mutation is still not on disk.
    if (!unsaved) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
})();
