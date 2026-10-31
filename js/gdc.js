// gdc.js — retired GDC fetch/merge layer, kept as a stub (pipeline v2).
//
// The dataset under data/dataset/ (docs/DATASET.md) already carries every GDC
// field the renderers read — stratagems, enhancements, loadout/wargear prose,
// Led By, statlines — so nothing fetches, merges or caches GDC in the browser
// any more. No live module calls App.GDC; the only caller left is the dormant
// js/bsdata.js loader, and these no-ops keep it from throwing if it ever runs.
(function () {
  const App = window.App = window.App || {};
  const noop = () => {};
  App.GDC = {
    loadAll: async () => {},
    mergeIntoFactions: noop,
    mergeUnitDataIntoFactions: noop,
    mergeUnitAbilitiesFromGdc: noop,
  };
})();
