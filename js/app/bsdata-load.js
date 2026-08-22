// app/bsdata-load.js — kicks off BSData.loadAllFactions and re-renders on each faction.
(function () {
  const App = window.App = window.App || {};

  App.autoLoadFromBSData = async function () {
    const state = App.state;

    // Snapshot the saved army's selections UP FRONT. applyImportedSelections
    // dispatches a 'change' on the faction <select>, whose handler WIPES
    // currentArmy.chapter + detachmentName (events.js). So the first restore
    // attempt destroys the very values we still need — if the detachment
    // options weren't populated yet at that moment, reading currentArmy
    // afterwards returns null and the picks are lost forever. Restore from
    // this immutable snapshot instead of from the (mutated) currentArmy.
    const cur0 = state.currentArmy;
    const want = cur0 ? {
      factionName:     cur0.factionName || '',
      chapter:         cur0.chapter || null,
      detachmentNames: Array.isArray(cur0.detachmentNames) ? cur0.detachmentNames.slice() : [],
    } : null;

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
            // Coalesced, not immediate. The live loader (dc-adapter.js) hands
            // us every faction in one synchronous forEach, so rendering here
            // repainted the roster ~34 times without the browser ever getting
            // a frame to paint any of them — 34 full filter passes over the
            // whole unit list, all but the last thrown away. The rAF gate in
            // render.js folds them into one. See App.scheduleRosterRender.
            App.scheduleRosterRender();
          }

          // Snappy first paint: restore the faction (and chapter/detachment if
          // their options happen to be ready) as soon as the army's faction
          // lands. This is best-effort — the authoritative restore below runs
          // once EVERYTHING is loaded and the detachment list is guaranteed
          // populated. Restoring here from `want` (not currentArmy) keeps the
          // snapshot intact even though this dispatch wipes currentArmy.
          if (!restoredSelections && want) {
            const wantTop = App.getVirtualParentOf(want.chapter || '') || want.factionName || '';
            if (wantTop && state.factions.some(f => f.factionName === wantTop)) {
              try {
                App.applyImportedSelections(want.factionName, want.chapter, want.detachmentNames);
                restoredSelections = true;
              } catch (_) { /* ignore — the final restore below covers it */ }
            }
          }
        }
      );

      // Authoritative restore: once every faction (and its detachments) is
      // loaded, re-apply the snapshot so the detachment dropdown — which may
      // not have been populated during the mid-load attempt — gets set. Skip
      // only if the user actively switched to a DIFFERENT faction while the
      // load was in flight, so we don't clobber a deliberate choice.
      if (want && want.factionName) {
        const facSel  = document.getElementById('army-faction-select');
        const wantTop = App.getVirtualParentOf(want.chapter || '') || want.factionName || '';
        const userSwitched = facSel && facSel.value && facSel.value !== 'all' && facSel.value !== wantTop;
        if (!userSwitched) {
          try {
            App.applyImportedSelections(want.factionName, want.chapter, want.detachmentNames);
          } catch (_) {}
        }
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
