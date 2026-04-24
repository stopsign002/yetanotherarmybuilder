// app/history.js — undo/redo snapshot stack driven by armyChange hook.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MAX = 50;
  const DEBOUNCE_MS = 500;

  const undoStack = [];
  const redoStack = [];
  let lastUpdatedAt = null;
  let lastPushAt = 0;
  let suppress = false;

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
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = undoStack[undoStack.length - 1];
    restore(prev);
    if (window.UI && typeof UI.toast === 'function') UI.toast('Undone', 'info');
    updateButtons();
  }

  function doRedo() {
    if (redoStack.length === 0) return;
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
    if (!state || !state.currentArmy) { updateButtons(); return; }
    const snap = snapshot(state.currentArmy);
    if (snap) {
      undoStack.push(snap);
      lastUpdatedAt = state.currentArmy.updatedAt;
      lastPushAt = Date.now();
    }
    updateButtons();
  });

  App.hooks.armyChange.push(function (army, kind) {
    if (suppress) { updateButtons(); return; }
    if (!App.state || !App.state.currentArmy) return;
    if (!army) return;
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
