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

  App.buildChaptersMap = function () {
    const state = App.state;
    state.chaptersMap = {};
    state.virtualBase = {};
    state.chapterFactions = new Set();
    App.VIRTUAL_PARENTS.forEach(vp => {
      const prefix = vp.name + ' - ';
      const children = state.factions
        .filter(f => f.factionName.startsWith(prefix))
        .map(f => f.factionName);
      if (children.length === 0) return;
      state.chaptersMap[vp.name]   = children;
      state.virtualBase[vp.name]   = vp.baseChapter;
      children.forEach(c => state.chapterFactions.add(c));
    });
  };

  App.getVirtualParentOf = function (chapterName) {
    const map = App.state.chaptersMap;
    for (const vp in map) {
      if (map[vp].includes(chapterName)) return vp;
    }
    return null;
  };

  App.getEffectiveFilter = function () {
    const state = App.state;
    if (state.selectedChapter) {
      const linked = [];
      const vp = App.getVirtualParentOf(state.selectedChapter);
      if (vp && state.virtualBase[vp] && state.virtualBase[vp] !== state.selectedChapter) {
        linked.push(state.virtualBase[vp]);
      }
      return { factionFilter: state.selectedChapter, linkedFactions: linked };
    }
    if (state.factionFilter !== 'all' && state.chaptersMap[state.factionFilter]) {
      return {
        factionFilter:  state.factionFilter,
        linkedFactions: state.chaptersMap[state.factionFilter],
      };
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
    const direct = state.factions.find(f => f.factionName === name);
    if (direct) return direct;
    if (state.virtualBase && state.virtualBase[name]) {
      return state.factions.find(f => f.factionName === state.virtualBase[name]) || null;
    }
    return null;
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
    const vp = state.selectedChapter
      ? App.getVirtualParentOf(state.selectedChapter)
      : (state.factionFilter !== 'all' ? App.getVirtualParentOf(state.factionFilter) : null);
    if (vp && state.virtualBase[vp]) {
      return state.factions.find(f => f.factionName === state.virtualBase[vp]) || faction;
    }
    return faction;
  };
})();
