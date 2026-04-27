// app/bsdata-load.js — kicks off BSData.loadAllFactions and re-renders on each faction.
(function () {
  const App = window.App = window.App || {};

  App.autoLoadFromBSData = async function () {
    const state = App.state;
    let restoredSelections = false;
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

          // Restore the active army's faction / chapter / detachment selectors
          // as soon as its faction lands in the dropdown. Without this the
          // selections panel boots empty even though state.currentArmy has
          // the picks — confusing on reload, and gets in the way of editing.
          if (!restoredSelections) {
            const cur = state.currentArmy;
            const wantTop = cur && (App.getVirtualParentOf(cur.chapter || '') || cur.factionName || '');
            if (cur && wantTop && state.factions.some(f => f.factionName === wantTop)) {
              try {
                App.applyImportedSelections(cur.factionName, cur.chapter, cur.detachmentName);
                restoredSelections = true;
              } catch (_) { /* ignore — try again next faction */ }
            }
          }
        }
      );

      // Final safety net: if the army's faction never matched anything that
      // came in (stale data, faction renamed in BSData, etc.), still try
      // once more after the load completes — at minimum it sets the army
      // name + points-limit inputs and clears the detachment placeholder.
      if (!restoredSelections && state.currentArmy && state.currentArmy.factionName) {
        try {
          App.applyImportedSelections(
            state.currentArmy.factionName,
            state.currentArmy.chapter,
            state.currentArmy.detachmentName
          );
        } catch (_) {}
      }
    } catch (err) {
      console.error('[BSData] Auto-load failed:', err);
      UI.toast('Could not load BSData: ' + err.message, 'error', 6000);
    }
  };
})();
