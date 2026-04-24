// app/bsdata-load.js — kicks off BSData.loadAllFactions and re-renders on each faction.
(function () {
  const App = window.App = window.App || {};

  App.autoLoadFromBSData = async function () {
    const state = App.state;
    try {
      await BSData.loadAllFactions(
        (done, total) => { UI.setLoadProgress(done, total); },
        faction => {
          const exists = state.factions.some(f => f.factionName === faction.factionName);
          if (!exists) {
            state.factions.push(faction);
            App.rebuildAllUnits();
            App.buildChaptersMap();
            UI.updateFactionFilter(state.factions, {
              hide:   state.chapterFactions,
              extras: Object.keys(state.chaptersMap),
            });
            App.renderUnitRosterWithContext();
          }
        }
      );
    } catch (err) {
      console.error('[BSData] Auto-load failed:', err);
      UI.toast('Could not load BSData: ' + err.message, 'error', 6000);
    }
  };
})();
