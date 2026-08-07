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
// loaded, and again whenever the current army changes. In-place and silent:
// updatedAt is NOT touched, so sync never sees a phantom edit; the refreshed
// snapshot persists naturally with the army's next real save.
//
// Swapping unitData is not enough on its own for POINTS, because the cost an
// army actually bills lives on the entry itself (`selectedPts`, copied from
// the chosen squad option at add-time) and never looked at the datasheet
// again. `repairSelectedPts` below closes that gap.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Does the user have a manual dataslate override on this unit? If so its
  // squadOptions are deliberately shifted off the official cost and we must
  // not "correct" the entry back — that price is the user's, not data.
  function hasOverride(unitId) {
    return typeof App.getPointsOverride === 'function'
      && App.getPointsOverride(unitId) != null;
  }

  // Re-read the entry's price off the current datasheet when the stored one no
  // longer exists there.
  //
  // Why this is needed: `selectedPts` is a snapshot of a squad option's cost,
  // taken once when the unit was added, and every later data correction slid
  // past it. Orks Trukk shipped at 65 pts from 2026-07-09 to 2026-07-28 (the
  // MFM scrape had captured only its 4th-copy surcharge band and not the 55 pt
  // base), so armies built in that window kept billing 65 for a lone Trukk
  // long after the data itself was fixed.
  //
  // The rule is deliberately narrow. We only act when the stored price matches
  // NO option on the fresh datasheet, and only when we can still tell which
  // squad SIZE the user picked. Size is the user's choice; the price attached
  // to that size is data. Re-reading the price for the same size is a
  // correction — it can never silently re-pick a different unit size.
  function repairSelectedPts(entry, prevUnit, fresh) {
    if (entry.selectedPts == null) return false;
    const opts = (fresh && Array.isArray(fresh.squadOptions)) ? fresh.squadOptions : null;
    if (!opts || !opts.length) return false;
    if (opts.some((o) => o.pts === entry.selectedPts)) return false;  // still a real price
    if (hasOverride(entry.unitId)) return false;

    // Which size? Prefer the saved label, then the pre-refresh snapshot's own
    // option list, then the case where there is only one size to begin with.
    let models = null;
    const m = /^(\d+)\s+model/.exec(entry.squadLabel || '');
    if (m) models = parseInt(m[1], 10);
    if (models == null && prevUnit && Array.isArray(prevUnit.squadOptions)) {
      const prev = prevUnit.squadOptions.find((o) => o.pts === entry.selectedPts);
      if (prev && prev.models != null) models = prev.models;
    }

    let pick = null;
    if (models != null) pick = opts.find((o) => o.models === models) || null;
    else if (opts.length === 1) pick = opts[0];
    if (!pick || pick.pts === entry.selectedPts) return false;       // can't tell — leave it alone

    entry.selectedPts = pick.pts;
    if (pick.models) entry.squadLabel = `${pick.models} models`;
    return true;
  }

  function rehydrateArmy(army) {
    if (!army || !Array.isArray(army.entries)) return { swapped: 0, repriced: 0 };
    if (typeof App.findUnit !== 'function') return { swapped: 0, repriced: 0 };
    let swapped = 0, repriced = 0;
    army.entries.forEach((e) => {
      if (!e || !e.unitId) return;
      const facName = (e.unitData && e.unitData._factionName) || '';
      const fresh = App.findUnit(e.unitId, facName);
      if (!fresh) return;
      const prevUnit = e.unitData;
      if (fresh !== prevUnit) {
        e.unitData = fresh;
        swapped++;
      }
      if (repairSelectedPts(e, prevUnit, fresh)) repriced++;
    });
    return { swapped, repriced };
  }

  // Returns the number of entries whose price was corrected, so callers can
  // decide whether the army list needs redrawing.
  App.rehydrateEntryUnitData = function () {
    const s = App.state;
    if (!s || !s.currentArmy) return 0;
    if (!Array.isArray(s.allUnits) || s.allUnits.length === 0) return 0; // factions not ready
    const { swapped, repriced } = rehydrateArmy(s.currentArmy);
    if (swapped > 0) console.info('[rehydrate] refreshed unitData on', swapped, 'army entries');
    if (repriced > 0) console.info('[rehydrate] re-read current points on', repriced, 'army entries');
    return repriced;
  };

  // Any army landing in state carries whatever snapshots it was saved with —
  // refresh them as soon as it appears. `armyChange('load')` is fired by very
  // few callers, so this listens to every kind: loading a saved army mid-session
  // only fires `'render'`, and that is exactly the path a months-old army takes.
  // The re-entrancy flag is what makes redrawing from inside a `'render'` hook
  // safe; the pass is idempotent (a repaired price matches a squad option, so
  // the second pass is a no-op) and only redraws when something actually moved.
  let busy = false;
  App.hooks.armyChange.push(function () {
    if (busy) return;
    busy = true;
    try {
      const repriced = App.rehydrateEntryUnitData();
      if (repriced > 0 && window.UI && typeof UI.renderArmyList === 'function'
          && App.state && App.state.currentArmy) {
        UI.renderArmyList(App.state.currentArmy);
      }
    } finally {
      busy = false;
    }
  });
})();
