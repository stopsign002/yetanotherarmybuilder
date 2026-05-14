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

    // Returns [groupMin, groupMax] for a selectionEntryGroup.
    // Tries Patterns F → A → B in order; recurses into child groups if all yield
    // nothing.  This handles factions like Necrons (Skorpekh Destroyers) that wrap
    // their "N-M Bodies" sub-group inside an outer "Unit Composition" group that
    // carries no constraints itself.
    function processGroup(group) {
      let groupMin = null, groupMax = null;

      // Pattern F (composition picks): group contains upgrade entries that each
      // represent a "unit comp" choice whose entryLinks target model/unit entries
      // and carry the real per-option min/max. Squighog Boyz / Gretchin pattern.
      const compEntries = group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="upgrade"]');
      if (compEntries.length > 0) {
        const compSizes = [];
        compEntries.forEach(opt => {
          let oMin = null, oMax = null;
          opt.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
            const tgt = entriesById.get(I.getAttr(link, 'targetId'));
            if (!tgt) return;
            const tt = I.getAttr(tgt, 'type', '');
            if (tt !== 'model' && tt !== 'unit') return;
            link.querySelectorAll(':scope > constraints > constraint').forEach(c => {
              const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
              if (!isNaN(val) && val > 0) {
                if (I.getAttr(c, 'type') === 'min') oMin = (oMin || 0) + val;
                if (I.getAttr(c, 'type') === 'max') oMax = (oMax || 0) + val;
              }
            });
          });
          if (oMin !== null || oMax !== null) compSizes.push({ min: oMin, max: oMax });
        });
        if (compSizes.length > 0) {
          const mins = compSizes.map(s => s.min).filter(v => v !== null);
          const maxs = compSizes.map(s => s.max).filter(v => v !== null);
          if (mins.length) groupMin = Math.min(...mins);
          if (maxs.length) groupMax = Math.max(...maxs);
        }
      }

      // Pattern A
      if (groupMin === null && groupMax === null) {
        group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
          const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (!isNaN(val) && val > 0) {
            if (I.getAttr(c, 'type') === 'min') groupMin = val;
            if (I.getAttr(c, 'type') === 'max') groupMax = val;
          }
        });
      }

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

      // Recurse into child selectionEntryGroups when this level yields nothing.
      if (groupMin === null && groupMax === null) {
        group.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(subGroup => {
          const [subMin, subMax] = processGroup(subGroup);
          if (subMin !== null) groupMin = (groupMin || 0) + subMin;
          if (subMax !== null) groupMax = (groupMax || 0) + subMax;
        });
      }

      return [groupMin, groupMax];
    }

    let minModels = null, maxModels = null;
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      const [groupMin, groupMax] = processGroup(group);
      if (groupMin !== null) minModels = (minModels || 0) + groupMin;
      if (groupMax !== null) maxModels = (maxModels || 0) + groupMax;
    });

    // Always add any direct type="model" children of the unit entry. These are mandatory
    // leader/sergeant models (Ranger Alpha, Plague Champion, Shas'ui, Aspiring Sorcerer,
    // Exarch, etc.) that live at the unit level alongside the body group. Previously this
    // ran only when groups produced nothing (Pattern D), so those mandatory models were
    // silently dropped whenever a body group had already set minModels/maxModels — causing
    // e.g. Skitarii Rangers to report 9 models instead of 10.
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

    // Pattern C — fallback for single-model units / characters that express their count
    // as entry-level constraints when groups and direct model children both yield nothing.
    // Restrict to field="selections" to avoid Crusade constraints (Battle Honours, etc.).
    // Skip scope="roster" / scope="force" — those are army-/force-wide caps
    // (Rule of Three style), not per-unit model counts. Imperial Knights' Armigers
    // carry a scope="force" max=3 cap that previously made composition show "3 models"
    // instead of "1 model".
    if (minModels === null && maxModels === null) {
      entryEl.querySelectorAll(':scope > constraints > constraint[field="selections"]').forEach(c => {
        const scope = I.getAttr(c, 'scope', '');
        if (scope === 'roster' || scope === 'force') return;
        const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (I.getAttr(c, 'type') === 'min') minModels = val;
          if (I.getAttr(c, 'type') === 'max') maxModels = val;
        }
      });
    }

    const squadOptions = [];
    if (basePts > 0) squadOptions.push({ pts: basePts, models: minModels ?? maxModels });

    if (ptsTypeId) {
      // First pass: collect modifier tiers, each with its lower-threshold T
      // and whether the tier represents an exact count (equalTo) or a range
      // (atLeast / greaterThan). BSData uses all three condition types
      // depending on faction (Necrons all-atLeast; Tyranids mix
      // atLeast/equalTo/greaterThan; Orks lean greaterThan). Previously the
      // selector matched only `atLeast`, so non-atLeast tiers had threshold
      // NaN and fell through to maxModels — Ripper Swarms (basePts=25,
      // equalTo=2 → 40, atLeast=3 → 50, max=3) surfaced as "1 / 3 / 3".
      const tiers = []; // [{ pts, threshold, exact }]
      const condGroupPrefixes = [
        ':scope > conditions > ',
        ':scope > conditionGroups > conditionGroup > conditions > ',
      ];
      const condTypes = ['atLeast', 'greaterThan', 'equalTo'];
      entryEl.querySelectorAll(':scope > modifiers > modifier').forEach(mod => {
        if (I.getAttr(mod, 'type') !== 'set' || I.getAttr(mod, 'field') !== ptsTypeId) return;
        const val = parseFloat(I.getAttr(mod, 'value', '0'));
        if (isNaN(val) || val <= 0 || val === basePts) return;
        let threshold = NaN;
        let exact = false;
        outer: for (const prefix of condGroupPrefixes) {
          for (const ct of condTypes) {
            const cond = mod.querySelector(`${prefix}condition[type="${ct}"][field="selections"][childId="model"]`);
            if (!cond) continue;
            const n = parseFloat(I.getAttr(cond, 'value', '0'));
            if (isNaN(n) || n <= 0) continue;
            if (ct === 'atLeast')          { threshold = n;     exact = false; }
            else if (ct === 'greaterThan') { threshold = n + 1; exact = false; }
            else /* equalTo */             { threshold = n;     exact = true;  }
            break outer;
          }
        }
        tiers.push({ pts: val, threshold, exact });
      });
      // Second pass: convert each tier into its displayed model count. Range
      // tiers (atLeast / greaterThan) cover threshold..(next-1) — display
      // the upper bound, matching Lokhust's flat-priced 4-6 = "6 models".
      // Exact tiers (equalTo) display the threshold itself. Tiers with no
      // detected condition fall back to maxModels.
      const sortedThresholds = tiers
        .map(t => t.threshold)
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);
      tiers.forEach(tier => {
        let models = maxModels;
        if (Number.isFinite(tier.threshold)) {
          if (tier.exact) {
            models = tier.threshold;
          } else {
            const next = sortedThresholds.find(t => t > tier.threshold);
            models = Number.isFinite(next) ? next - 1 : maxModels;
          }
        }
        squadOptions.push({ pts: tier.pts, models });
      });
    }

    if (squadOptions.length > 0) {
      squadOptions.sort((a, b) => a.pts - b.pts);
      return { points: squadOptions[0].pts, pointsOptions: squadOptions.map(o => o.pts), squadOptions };
    }

    // Fallback E: unit entry has 0 pts but a child model entry carries the cost.
    // Collect model-level pts from direct or grouped model/unit children, then scale
    // by min/max model counts. Covers Biovores, Beast of Nurgle, Sydonian Dragoons, Mek Gunz.
    const modelCosts = [];
    entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"], ' +
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="unit"]'
    ).forEach(m => {
      const c = readCost(m);
      if (c > 0) modelCosts.push(c);
    });
    if (modelCosts.length > 0) {
      const perModel = Math.min(...modelCosts);
      const opts = [];
      if (minModels && maxModels) {
        for (let count = minModels; count <= maxModels; count++) {
          opts.push({ pts: perModel * count, models: count });
        }
      } else if (minModels) {
        opts.push({ pts: perModel * minModels, models: minModels });
      } else if (maxModels) {
        opts.push({ pts: perModel * maxModels, models: maxModels });
      } else {
        opts.push({ pts: perModel, models: null });
      }
      opts.sort((a, b) => a.pts - b.pts);
      return { points: opts[0].pts, pointsOptions: opts.map(o => o.pts), squadOptions: opts };
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
