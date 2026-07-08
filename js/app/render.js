// app/render.js — top-level render pipelines that combine filter + UI calls.
(function () {
  const App = window.App = window.App || {};

  // The units-pane "All factions" view (reserves.js view switcher) bypasses
  // the faction filter entirely so a unit can be searched across every army
  // even while a faction/chapter is selected.
  function effectiveRosterFilter() {
    if (App.Reserves && typeof App.Reserves.getView === 'function'
        && App.Reserves.getView() === 'everything') {
      return { factionFilter: 'all', linkedFactions: [] };
    }
    return App.getEffectiveFilter();
  }

  App.renderAll = function () {
    const state = App.state;
    UI.updateFactionFilter(state.factions, {
      hide:   state.chapterFactions,
      extras: Object.keys(state.chaptersMap),
    });
    const { factionFilter, linkedFactions } = effectiveRosterFilter();
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
    const { factionFilter, linkedFactions } = effectiveRosterFilter();
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
