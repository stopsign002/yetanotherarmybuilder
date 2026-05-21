// app/rehydrate.js — refresh saved armies' embedded unit snapshots against
// the freshly-parsed faction data.
//
// Why this exists: when a unit is added to an army, the full parsed unit
// object is snapshotted onto the entry as `entry.unitData` and persisted in
// localStorage (`yaab_armies`). The unit detail card for an army entry renders
// from that snapshot (see events.js → UI.renderUnitDetail(entry.unitData, …)).
// So any parser/data fix (e.g. dropping detachment rules that leaked into a
// unit's Core Abilities) is invisible for units already in a saved army — the
// IndexedDB faction cache and DB_VERSION bump only refresh what the *roster*
// reads, never the frozen snapshot inside the army. The fix used to require
// removing and re-adding the unit.
//
// This module re-points each entry's `unitData` at the current parser object
// (matched by unitId) whenever the parsed data changes. Only the parsed
// payload is swapped — every user choice lives on the ENTRY (count,
// selectedPts, squadLabel, enhancements, entryId, attachedToEntryId), so those
// are preserved untouched. Entries whose unit no longer exists in BSData keep
// their stored snapshot rather than being blanked.
//
// It runs in place (no re-render, no save, no updatedAt bump — so it never
// triggers sync churn or marks the local copy "newer" than cloud) on the
// armyChange + selectionChange hooks, guarded by `state.factionsVersion` so it
// only does work after the unit set actually changes.
(function () {
  const App = window.App = window.App || {};

  let _indexVersion = -1;
  let _byId = null;

  // id → parser unit, rebuilt only when filters.js bumps factionsVersion.
  function unitIndex() {
    const state = App.state;
    if (!state) return null;
    const ver = state.factionsVersion || 0;
    const units = state.allUnits || [];
    if (_byId && _indexVersion === ver) return _byId;
    if (!units.length) return null; // factions not parsed yet — try later
    const map = new Map();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u && u.id != null && !map.has(u.id)) map.set(u.id, u);
    }
    _byId = map;
    _indexVersion = ver;
    return _byId;
  }

  // Refresh one army's entries in place. Returns the number of entries whose
  // snapshot was swapped for a fresher parser object.
  App.rehydrateArmy = function (army) {
    if (!army || !Array.isArray(army.entries)) return 0;
    const idx = unitIndex();
    if (!idx) return 0;
    let refreshed = 0;
    for (let i = 0; i < army.entries.length; i++) {
      const entry = army.entries[i];
      if (!entry || !entry.unitId) continue;
      const fresh = idx.get(entry.unitId);
      // Only swap when we found a current object that isn't already the one
      // on the entry — keeps the stale snapshot for units dropped from BSData.
      if (fresh && fresh !== entry.unitData) {
        entry.unitData = fresh;
        refreshed++;
      }
    }
    // Stamp so repeat hook fires at the same data version are no-ops.
    if (army.entries.length) army._rehydratedVersion = _indexVersion;
    return refreshed;
  };

  function maybeRehydrateCurrent() {
    const state = App.state;
    const army = state && state.currentArmy;
    if (!army) return;
    if (army._rehydratedVersion === (state.factionsVersion || 0)) return;
    App.rehydrateArmy(army);
  }

  // armyChange fires at the TOP of UI.renderArmyList (before entries are read)
  // and on every army load/import/mutation, so rehydrating here feeds fresh
  // data straight into that render and any subsequent detail-card click.
  // selectionChange covers the case where the army loads before its faction
  // has finished parsing — the unit set arrives later and we refresh then.
  App.hooks.armyChange.push(maybeRehydrateCurrent);
  App.hooks.selectionChange.push(maybeRehydrateCurrent);
})();
