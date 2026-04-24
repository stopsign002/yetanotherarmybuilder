// app/render.js — top-level render pipelines that combine filter + UI calls.
(function () {
  const App = window.App = window.App || {};

  App.renderAll = function () {
    const state = App.state;
    UI.updateFactionFilter(state.factions, {
      hide:   state.chapterFactions,
      extras: Object.keys(state.chaptersMap),
    });
    const { factionFilter, linkedFactions } = App.getEffectiveFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
    UI.renderArmyList(state.currentArmy);
  };

  App.renderUnitRosterWithContext = function () {
    const state = App.state;
    const { factionFilter, linkedFactions } = App.getEffectiveFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
    if (typeof App.fireSelectionChange === 'function') App.fireSelectionChange();
  };
})();
