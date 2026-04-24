/* costs.js — points/cost resolution. Handles Patterns A/B/C/D and squad-size
 * variants via modifier "set" on the pts typeId. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function readCost(el) {
    let pts = 0;
    el.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = I.getAttr(cost, 'name', '').toLowerCase().trim();
      if (name === 'pts' || name === 'points') {
        const val = parseFloat(I.getAttr(cost, 'value', '0'));
        if (!isNaN(val) && val > 0) pts = Math.max(pts, val);
      }
    });
    return pts;
  }

  function findCosts(entryEl, entriesById) {
    let basePts = 0;
    let ptsTypeId = null;
    entryEl.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = I.getAttr(cost, 'name', '').toLowerCase().trim();
      if (name === 'pts' || name === 'points') {
        basePts = parseFloat(I.getAttr(cost, 'value', '0')) || 0;
        ptsTypeId = I.getAttr(cost, 'typeId') || null;
      }
    });

    let minModels = null, maxModels = null;
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      let groupMin = null, groupMax = null;

      // Pattern A
      group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (I.getAttr(c, 'type') === 'min') groupMin = val;
          if (I.getAttr(c, 'type') === 'max') groupMax = val;
        }
      });

      // Pattern B
      if (groupMin === null && groupMax === null) {
        group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(model => {
          let mMin = null, mMax = null;
          model.querySelectorAll(':scope > constraints > constraint').forEach(c => {
            const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
            if (!isNaN(val) && val > 0) {
              if (I.getAttr(c, 'type') === 'min') mMin = val;
              if (I.getAttr(c, 'type') === 'max') mMax = val;
            }
          });
          if (mMin !== null) groupMin = (groupMin || 0) + mMin;
          if (mMax !== null) groupMax = (groupMax || 0) + mMax;
        });
      }

      if (groupMin !== null) minModels = (minModels || 0) + groupMin;
      if (groupMax !== null) maxModels = (maxModels || 0) + groupMax;
    });

    // Pattern C
    if (minModels === null && maxModels === null) {
      entryEl.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (I.getAttr(c, 'type') === 'min') minModels = val;
          if (I.getAttr(c, 'type') === 'max') maxModels = val;
        }
      });
    }

    // Pattern D
    if (minModels === null && maxModels === null) {
      entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(model => {
        let mMin = null, mMax = null;
        model.querySelectorAll(':scope > constraints > constraint').forEach(c => {
          const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (!isNaN(val) && val > 0) {
            if (I.getAttr(c, 'type') === 'min') mMin = val;
            if (I.getAttr(c, 'type') === 'max') mMax = val;
          }
        });
        if (mMin !== null) minModels = (minModels || 0) + mMin;
        if (mMax !== null) maxModels = (maxModels || 0) + mMax;
      });
    }

    const squadOptions = [];
    if (basePts > 0) squadOptions.push({ pts: basePts, models: minModels });

    if (ptsTypeId) {
      entryEl.querySelectorAll(':scope > modifiers > modifier').forEach(mod => {
        if (I.getAttr(mod, 'type') === 'set' && I.getAttr(mod, 'field') === ptsTypeId) {
          const val = parseFloat(I.getAttr(mod, 'value', '0'));
          if (!isNaN(val) && val > 0 && val !== basePts) {
            squadOptions.push({ pts: val, models: maxModels });
          }
        }
      });
    }

    if (squadOptions.length > 0) {
      squadOptions.sort((a, b) => a.pts - b.pts);
      return { points: squadOptions[0].pts, pointsOptions: squadOptions.map(o => o.pts), squadOptions };
    }

    for (const link of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    )) {
      const lc = readCost(link);
      if (lc > 0) return { points: lc, pointsOptions: [lc], squadOptions: [{ pts: lc, models: null }] };
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (target) {
        const tc = readCost(target);
        if (tc > 0) return { points: tc, pointsOptions: [tc], squadOptions: [{ pts: tc, models: null }] };
      }
    }

    return { points: 0, pointsOptions: [], squadOptions: [] };
  }

  I.readCost  = readCost;
  I.findCosts = findCosts;
})();
