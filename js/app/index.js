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
    App.autoLoadFromBSData();
  });
})();
