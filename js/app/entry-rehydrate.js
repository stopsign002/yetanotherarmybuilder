// app/entry-rehydrate.js — refresh army entries' unitData snapshots.
//
// Army entries embed a COPY of the unit object taken at add-time (and that
// snapshot round-trips through localStorage and cloud sync). Anything the
// data layer learns later — new core-ability flags, wargear abilities,
// wargearProfile, corrected points — never reaches old entries, so printed
// cards and the details pane can render a months-old view of the datasheet.
//
// This module swaps each entry's unitData for the freshly-built unit object
// (matched by unitId, preferring the snapshot's faction) once factions are
// loaded, and again whenever a saved army is loaded. In-place and silent:
// updatedAt is NOT touched, so sync never sees a phantom edit; the refreshed
// snapshot persists naturally with the army's next real save.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  function rehydrateArmy(army) {
    if (!army || !Array.isArray(army.entries)) return 0;
    if (typeof App.findUnit !== 'function') return 0;
    let swapped = 0;
    army.entries.forEach((e) => {
      if (!e || !e.unitId) return;
      const facName = (e.unitData && e.unitData._factionName) || '';
      const fresh = App.findUnit(e.unitId, facName);
      if (fresh && fresh !== e.unitData) {
        e.unitData = fresh;
        swapped++;
      }
    });
    return swapped;
  }

  App.rehydrateEntryUnitData = function () {
    const s = App.state;
    if (!s || !s.currentArmy) return;
    if (!Array.isArray(s.allUnits) || s.allUnits.length === 0) return; // factions not ready
    const n = rehydrateArmy(s.currentArmy);
    if (n > 0) console.info('[rehydrate] refreshed unitData on', n, 'army entries');
  };

  // A saved army being loaded carries whatever snapshots it was saved with —
  // refresh them as soon as it lands (factions are ready by then in every
  // normal flow; the guard above covers the boot race, where the post-load
  // call in bsdata-load.js picks it up instead).
  App.hooks.armyChange.push(function (_army, kind) {
    if (kind === 'load') App.rehydrateEntryUnitData();
  });
})();
