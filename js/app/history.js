// app/history.js — undo/redo snapshot stack driven by armyChange hook.
//
// ONE ARMY AT A TIME. The stack belongs to the army that is open
// (`stackArmyId`) and is reset whenever App.state.currentArmy becomes a
// different object that history did not put there itself — loading another
// army, New army, a URL import, Save as…, a sync adoption, a deletion. It
// used to be one global stack: loading B pushed B on top of A's snapshots,
// so Ctrl+Z jumped back into A (stamped "now", so it overwrote newer cloud
// edits), and after deleting the open army Ctrl+Z brought the deleted army
// back and autosave re-saved and re-synced it — under a dialog that said
// "This cannot be undone". state.js fires `yaab:current-army` on every
// object change; that is what drives the reset.
//
// Deleted-army guard: once the stack's army has been seen in the saved
// list, an undo/redo while it is no longer there is refused (covers a
// delete that did not change currentArmy, e.g. "wipe all saved armies").
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MAX = 50;
  const DEBOUNCE_MS = 500;

  let undoStack = [];
  let redoStack = [];
  let stackArmyId = null;
  let seenPersisted = false;
  let lastUpdatedAt = null;
  let lastPushAt = 0;
  let suppress = false;

  function stackArmyPersisted() {
    const mgr = App.state && App.state.armyManager;
    return !!(stackArmyId && mgr && Array.isArray(mgr.armies) &&
      mgr.armies.some(a => a && a.id === stackArmyId));
  }

  // Start a fresh stack whose only entry is `army` as it is now.
  function resetFor(army) {
    undoStack = [];
    redoStack = [];
    stackArmyId = army ? army.id : null;
    lastUpdatedAt = army ? army.updatedAt : null;
    // 0, not now: the first edit after a reset must push a new entry, never
    // coalesce into (and overwrite) the baseline snapshot.
    lastPushAt = 0;
    seenPersisted = false;
    if (army) {
      const snap = snapshot(army);
      if (snap) undoStack.push(snap);
      if (stackArmyPersisted()) seenPersisted = true;
    }
    updateButtons();
  }

  // True when the stack may be replayed onto the current army.
  function stackUsable() {
    const cur = App.state && App.state.currentArmy;
    if (!cur || cur.id !== stackArmyId) {
      resetFor(cur || null);
      return false;
    }
    if (seenPersisted && !stackArmyPersisted()) {
      // The army was deleted; undo would re-create it via autosave + sync.
      resetFor(cur);
      if (window.UI && typeof UI.toast === 'function') UI.toast('That army was deleted — nothing to undo.', 'info');
      return false;
    }
    return true;
  }

  function snapshot(army) {
    try { return JSON.stringify(army.toJSON()); }
    catch (_) { return null; }
  }

  function updateButtons() {
    const undoBtn = document.getElementById('yaab-btn-undo');
    const redoBtn = document.getElementById('yaab-btn-redo');
    if (undoBtn) {
      const disabled = undoStack.length <= 1;
      undoBtn.disabled = disabled;
      undoBtn.classList.toggle('is-disabled', disabled);
      undoBtn.setAttribute('data-disabled', disabled ? '1' : '0');
    }
    if (redoBtn) {
      const disabled = redoStack.length === 0;
      redoBtn.disabled = disabled;
      redoBtn.classList.toggle('is-disabled', disabled);
      redoBtn.setAttribute('data-disabled', disabled ? '1' : '0');
    }
  }

  function restore(snap) {
    if (!snap) return;
    try {
      const data = JSON.parse(snap);
      const army = Army.fromJSON(data);
      // `fromJSON` faithfully restores the SNAPSHOT's `updatedAt` — which is
      // in the past. Undoing is a new edit, so stamp it now. Without this,
      // rendering fires armyChange('render') → autosave persists the army
      // with a backwards timestamp → sync's last-write-wins rejects the push
      // and pulls the cloud copy back down, silently undoing the undo.
      // Reverting a snapshot follows the same path.
      army.updatedAt = new Date().toISOString();
      suppress = true;
      App.state.currentArmy = army;
      if (App.state.armyManager) App.state.armyManager.currentArmy = army;
      if (window.UI && typeof UI.renderArmyList === 'function') {
        UI.renderArmyList(army);
      }
      lastUpdatedAt = army.updatedAt;
      suppress = false;
    } catch (e) {
      suppress = false;
    }
  }

  function doUndo() {
    if (undoStack.length <= 1) return;
    if (!stackUsable()) return;
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = undoStack[undoStack.length - 1];
    restore(prev);
    if (window.UI && typeof UI.toast === 'function') UI.toast('Undone', 'info');
    updateButtons();
  }

  function doRedo() {
    if (redoStack.length === 0) return;
    if (!stackUsable()) return;
    const next = redoStack.pop();
    undoStack.push(next);
    restore(next);
    if (window.UI && typeof UI.toast === 'function') UI.toast('Redone', 'info');
    updateButtons();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-undo',
    region: 'icon',
    label: '↶',
    ariaLabel: 'Undo',
    title: 'Undo (Cmd/Ctrl+Z)',
    onClick: doUndo,
  });
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-redo',
    region: 'icon',
    label: '↷',
    ariaLabel: 'Redo',
    title: 'Redo (Cmd/Ctrl+Shift+Z)',
    onClick: doRedo,
  });

  App.hooks.bootstrap.push(function (state) {
    resetFor((state && state.currentArmy) || null);
  });

  // A different army object became current without going through restore()
  // below: start a new stack for it.
  window.addEventListener('yaab:current-army', function (e) {
    if (suppress) return;
    const army = (e && e.detail && e.detail.army) || null;
    resetFor(army);
  });

  App.hooks.armyChange.push(function (army, kind) {
    if (suppress) { updateButtons(); return; }
    if (!App.state || !App.state.currentArmy) return;
    if (!army) return;
    // Only the open army's own mutations belong on its stack.
    if (army.id !== stackArmyId) {
      if (army === App.state.currentArmy) resetFor(army);
      else updateButtons();
      return;
    }
    if (!seenPersisted && stackArmyPersisted()) seenPersisted = true;
    const ua = army.updatedAt;
    if (ua === lastUpdatedAt) { updateButtons(); return; }

    const snap = snapshot(army);
    if (!snap) return;
    const now = Date.now();
    if (undoStack.length > 0 && (now - lastPushAt) < DEBOUNCE_MS) {
      undoStack[undoStack.length - 1] = snap;
    } else {
      undoStack.push(snap);
      if (undoStack.length > MAX) undoStack.shift();
    }
    redoStack.length = 0;
    lastUpdatedAt = ua;
    lastPushAt = now;
    updateButtons();
  });

  document.addEventListener('keydown', function (e) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = (e.key || '').toLowerCase();
    if (isTypingTarget(document.activeElement)) return;
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      doRedo();
    }
  });
})();
