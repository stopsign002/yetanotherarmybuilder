// app/bsdata-load.js — kicks off BSData.loadAllFactions and re-renders on each faction.
(function () {
  const App = window.App = window.App || {};

  App.autoLoadFromBSData = async function () {
    const state = App.state;

    // The selections to restore, read from the army that is open NOW.
    // applyImportedSelections dispatches a 'change' on the faction <select>,
    // whose handler WIPES currentArmy.chapter + detachments (events.js), so
    // the values are copied out before each call rather than read afterwards.
    //
    // This used to be one snapshot taken before the load started. But the
    // cloud pull (sync.js) can swap or replace the open army while the data
    // is still loading — a fresh device opens on an empty placeholder and the
    // pull promotes a real army into its place — and the stale snapshot then
    // restored nothing, or restored this device's older detachments over the
    // newer cloud copy (bug #37).
    const wanted = () => {
      const cur = state.currentArmy;
      return cur ? {
        factionName:     cur.factionName || '',
        chapter:         cur.chapter || null,
        detachmentNames: Array.isArray(cur.detachmentNames) ? cur.detachmentNames.slice() : [],
      } : null;
    };

    let restoredSelections = false;
    try {
      await BSData.loadAllFactions(
        (done, total) => { UI.setLoadProgress(done, total); },
        faction => {
          const exists = state.factions.some(f => f.factionName === faction.factionName);
          if (!exists) {
            state.factions.push(faction);
            App.rebuildAllUnits();
            UI.updateFactionFilter(state.factions);
            // Coalesced, not immediate. The live loader (dc-adapter.js) hands
            // us every faction in one synchronous forEach, so rendering here
            // repainted the roster ~34 times without the browser ever getting
            // a frame to paint any of them — 34 full filter passes over the
            // whole unit list, all but the last thrown away. The rAF gate in
            // render.js folds them into one. See App.scheduleRosterRender.
            App.scheduleRosterRender();
          }

          // Snappy first paint: restore the faction (and detachments if they
          // are ready) as soon as the army's faction lands. Best-effort — the
          // authoritative restore below runs once EVERYTHING is loaded.
          if (!restoredSelections) {
            const want = wanted();
            const wantTop = (want && want.factionName) || '';
            if (wantTop && state.factions.some(f => f.factionName === wantTop)) {
              try {
                App.applyImportedSelections(want.factionName, want.chapter, want.detachmentNames);
                restoredSelections = true;
              } catch (_) { /* ignore — the final restore below covers it */ }
            }
          }
        }
      );

      // Authoritative restore: every faction (and its detachments) is loaded,
      // so the names can finally be checked against the real list. From here
      // on restores filter normally (state.factionsLoaded). If the user picked
      // a different faction while the load was in flight, the change handler
      // already wrote that choice onto the army, so this re-applies it as is.
      state.factionsLoaded = true;
      const want = wanted();
      if (want && want.factionName) {
        try {
          App.applyImportedSelections(want.factionName, want.chapter, want.detachmentNames);
        } catch (_) {}
      }
      // All factions loaded — refresh the current army's entry snapshots so
      // cards/details render current datasheet data, not add-time copies.
      if (typeof App.rehydrateEntryUnitData === 'function') {
        try { App.rehydrateEntryUnitData(); } catch (_) {}
      }
      // Boot is done — if the coalescing gate still has a frame queued (it
      // will if nothing above rendered directly, and rAF never fires at all
      // in a background tab), turn it into a render now.
      if (typeof App.flushRosterRender === 'function') App.flushRosterRender();
    } catch (err) {
      console.error('[BSData] Auto-load failed:', err);
      UI.toast('Could not load BSData: ' + err.message, 'error', 6000);
    }
  };
})();
