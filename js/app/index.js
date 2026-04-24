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

  // Renders hook-registered buttons into named toolbar regions.
  // Actions may specify { region: 'primary' | 'icon' | 'export-menu' } —
  // default 'primary'. Each region has a dedicated container.
  App.mountArmyToolbarActions = function () {
    const actions = (App.hooks && App.hooks.armyToolbarActions) || [];
    if (actions.length === 0) return;
    const targets = {
      primary:       document.getElementById('toolbar-extras'),
      icon:          document.getElementById('toolbar-icons'),
      'export-menu': document.getElementById('export-extras'),
    };
    actions.forEach(a => {
      const region = a.region || 'primary';
      const target = targets[region] || targets.primary;
      if (!target) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      if (region === 'export-menu') btn.setAttribute('role', 'menuitem');
      btn.className = a.className || (
        region === 'icon' ? 'btn btn-sm btn-outline btn-icon' :
        region === 'export-menu' ? '' :
        'btn btn-sm btn-outline'
      );
      btn.textContent = a.label || '';
      if (a.title) btn.title = a.title;
      if (a.ariaLabel) btn.setAttribute('aria-label', a.ariaLabel);
      if (a.id)    btn.id = a.id;
      if (typeof a.onClick === 'function') btn.addEventListener('click', a.onClick);
      target.appendChild(btn);
    });
  };
})();
