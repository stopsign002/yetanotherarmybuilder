// app/index.js — DOMContentLoaded bootstrap: init UI, restore army, kick off load.
(function () {
  const App = window.App;

  document.addEventListener('DOMContentLoaded', () => {
    const state = App.state;
    UI.init(state);

    state.armyManager = new ArmyManager();

    if (state.armyManager.armies.length > 0) {
      const sorted = [...state.armyManager.armies].sort((a, b) =>
        new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
      );
      state.currentArmy = sorted[0];
      state.armyManager.currentArmy = state.currentArmy;
    } else {
      state.currentArmy = state.armyManager.newArmy();
    }

    App.applyFactionColor(null);
    App.renderAll();
    App.setupResizablePanels();
    App.wireEvents();
    App.mountArmyToolbarActions();
    App.fireBootstrap(state);
    App.autoLoadFromBSData();
  });

  // Renders hook-registered buttons into the army-panel toolbar (bottom
  // of the left panel). Called once at bootstrap.
  App.mountArmyToolbarActions = function () {
    const actions = (App.hooks && App.hooks.armyToolbarActions) || [];
    if (actions.length === 0) return;
    const toolbar = document.querySelector('.army-toolbar');
    if (!toolbar) return;
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = a.className || 'btn btn-sm btn-outline';
      btn.textContent = a.label || '';
      if (a.title) btn.title = a.title;
      if (a.id)    btn.id = a.id;
      if (typeof a.onClick === 'function') btn.addEventListener('click', a.onClick);
      toolbar.appendChild(btn);
    });
  };
})();
