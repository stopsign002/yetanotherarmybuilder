// app/filters.js — faction/chapter resolution + rebuildAllUnits (by reference).
(function () {
  const App = window.App = window.App || {};

  App.rebuildAllUnits = function () {
    // Stamp _factionName directly on the parser's unit object and push
    // references (not spread copies) to avoid per-unit allocation spikes.
    const state = App.state;
    const arr = [];
    for (let i = 0; i < state.factions.length; i++) {
      const faction = state.factions[i];
      const units = faction.units || [];
      for (let j = 0; j < units.length; j++) {
        const unit = units[j];
        if (unit._factionName !== faction.factionName) unit._factionName = faction.factionName;
        arr.push(unit);
      }
    }
    state.allUnits = arr;
    state.factionsVersion = (state.factionsVersion || 0) + 1;
  };

  App.getEffectiveFilter = function () {
    const state = App.state;
    if (state.selectedChapter) {
      return { factionFilter: state.selectedChapter, linkedFactions: [] };
    }
    // Space Marine chapter inheritance: pull in generic SM units alongside the
    // chapter-specific roster. See App.CHAPTER_PARENTS in state.js for the map.
    if (state.factionFilter !== 'all' && App.CHAPTER_PARENTS && App.CHAPTER_PARENTS[state.factionFilter]) {
      return {
        factionFilter:  state.factionFilter,
        linkedFactions: [App.CHAPTER_PARENTS[state.factionFilter]],
      };
    }
    if (state.factionFilter !== 'all') {
      return { factionFilter: state.factionFilter, linkedFactions: [] };
    }
    return { factionFilter: 'all', linkedFactions: [] };
  };

  App.findUnit = function (unitId, factionName) {
    const units = App.state.allUnits;
    return units.find(u => u.id === unitId && u._factionName === factionName)
        || units.find(u => u.id === unitId)
        || null;
  };

  App.getCurrentFaction = function () {
    const state = App.state;
    const name = state.selectedChapter || (state.factionFilter !== 'all' ? state.factionFilter : null);
    if (!name) return null;
    return state.factions.find(f => f.factionName === name) || null;
  };

  App.getDetachmentFaction = function () {
    const state = App.state;
    const faction = App.getCurrentFaction();
    if (!faction) return null;
    if (faction.detachments && faction.detachments.length > 0) return faction;
    // Fall back to the chapter's parent faction's detachments. BSData ships
    // each Space Marines chapter as its own catalogue with zero detachments
    // (Blood Angels/Space Wolves/etc. inherit the generic SM detachment list
    // by reference). Without this fallback the chapter dropdown is empty.
    const parents = App.CHAPTER_PARENTS || {};
    const childName = state.selectedChapter || (state.factionFilter !== 'all' ? state.factionFilter : null);
    if (childName && parents[childName]) {
      const parent = state.factions.find(f => f.factionName === parents[childName]);
      if (parent && parent.detachments && parent.detachments.length > 0) return parent;
    }
    return faction;
  };
})();
