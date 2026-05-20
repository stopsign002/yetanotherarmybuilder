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

    // A selectionEntryGroup only contributes to the MODEL count when its
    // subtree actually selects models. Wargear/weapon-option groups carry
    // the same field="selections" constraints as composition groups — e.g.
    // the Ork Deff Dread's "Wargear Options" group forces exactly 4 weapons
    // (min=max=4) — so reading those as a model count made the Deff Dread
    // report "4 models" (and inflated many single-model vehicles/monsters).
    //
    // We test the WHOLE subtree (a descendant query, not just direct
    // children) so it stays correct whether the models sit directly in the
    // group, inside an upgrade composition-pick, or in a nested sub-group
    // (Necron Skorpekh Destroyers' "Unit Composition" → "Bodies").
    const _concernsCache = new WeakMap();
    function groupConcernsModels(group) {
      if (_concernsCache.has(group)) return _concernsCache.get(group);
      let result = false;
      // A model/unit selectionEntry ANYWHERE in this group's subtree means
      // the group governs a body count — whether the models are direct
      // children, wrapped in an upgrade composition-pick ("12 Models" →
      // Wolf Scout Pack Leader + Hunting Wolf + Wolf Scout), or nested in a
      // sub-group (Skorpekh "Unit Composition" → "Bodies"). Wargear groups
      // (Deff Dread "Wargear Options", every weapon-pick group) hold only
      // weapon/upgrade entries, so they match nothing here and are skipped.
      if (group.querySelector('selectionEntry[type="model"], selectionEntry[type="unit"]')) {
        result = true;
      } else {
        // …or an entryLink that resolves to a model/unit entry — squads
        // that reference a shared body by link (Burna Boyz' "Burna Boy").
        const links = group.querySelectorAll('entryLink');
        for (const link of links) {
          if (I.getAttr(link, 'type') !== 'selectionEntry') continue;
          const tgt = entriesById.get(I.getAttr(link, 'targetId'));
          const tt  = tgt && I.getAttr(tgt, 'type', '');
          if (tt === 'model' || tt === 'unit') { result = true; break; }
        }
      }
      _concernsCache.set(group, result);
      return result;
    }

    // Returns [groupMin, groupMax] for a selectionEntryGroup.
    // Tries Patterns F → A → B in order; recurses into child groups if all yield
    // nothing.  This handles factions like Necrons (Skorpekh Destroyers) that wrap
    // their "N-M Bodies" sub-group inside an outer "Unit Composition" group that
    // carries no constraints itself.
    function processGroup(group) {
      let groupMin = null, groupMax = null;

      // Wargear-only groups never contribute to the model count, and we must
      // NOT recurse into them either (their sub-groups are weapon mods, not
      // bodies). Bailing out here keeps single-model units (Deff Dread, every
      // battlesuit / vehicle with a "pick N weapons" group) from being read
      // as N-model squads, without disturbing real composition groups whose
      // models may sit in a nested sub-group.
      if (!groupConcernsModels(group)) return [null, null];

      // Pattern F (composition picks): group contains upgrade entries that each
      // represent a "unit comp" choice whose entryLinks target model/unit entries
      // and carry the real per-option min/max. Squighog Boyz / Gretchin pattern.
      //
      // We also sum any inner <selectionEntries><selectionEntry type="model">
      // children of the composition pick — Jakhals encode their large-size
      // options ("1 mauler chainblade, 7 chainblades", "2 mauler chainblades,
      // 15 chainblades", etc.) as an upgrade pick whose inner model entry
      // carries the mauler count and whose entryLink covers the rest. Without
      // walking the inner model the option dropped its mauler count and the
      // total composition came up short.
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
          opt.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(model => {
            model.querySelectorAll(':scope > constraints > constraint').forEach(c => {
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

      // Pattern A. When a constraint has automatic="true", its static value is
      // a placeholder that a sibling <modifier type="set" field="<constraintId>">
      // can override. Jakhals' "Dishonoured" group keeps a static max=1 and uses
      // a conditional set-modifier to bump max to 2 when one of the large
      // composition picks is selected; without honouring that we under-count by
      // 1 on the big-size variant. We take the larger reachable value for max
      // and the smaller for min so the final groupMin/groupMax span the actual
      // count range across modifier conditions.
      if (groupMin === null && groupMax === null) {
        group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
          const val = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (isNaN(val) || val <= 0) return;
          const cType = I.getAttr(c, 'type', '');
          const cId   = I.getAttr(c, 'id', '');
          let effective = val;
          if (cId && I.getAttr(c, 'automatic', 'false') === 'true') {
            group.querySelectorAll(':scope > modifiers > modifier[type="set"]').forEach(m => {
              if (I.getAttr(m, 'field', '') !== cId) return;
              const mv = Math.round(parseFloat(I.getAttr(m, 'value', '0')));
              if (isNaN(mv) || mv <= 0) return;
              if (cType === 'max') effective = Math.max(effective, mv);
              else if (cType === 'min') effective = Math.min(effective, mv);
            });
          }
          if (cType === 'min') groupMin = effective;
          if (cType === 'max') groupMax = effective;
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
      //
      // We scan both `:scope > modifiers > modifier` AND modifiers wrapped in
      // `:scope > modifierGroups > modifierGroup > modifiers > modifier`. Most
      // factions use the flat shape but Votann (and a couple of others) wrap
      // every per-unit modifier in modifierGroups; pre-fix, tier modifiers
      // for those units silently fell through. Also accepts `type="increment"`
      // for cumulative-tier shapes (e.g. Crucible-mode +5 / +5 / +5 ladders)
      // by adding the increment to the unit's base cost.
      const tiers = []; // [{ pts, threshold, exact }]
      const condGroupPrefixes = [
        ':scope > conditions > ',
        ':scope > conditionGroups > conditionGroup > conditions > ',
      ];
      const condTypes = ['atLeast', 'greaterThan', 'equalTo'];
      const modSelectors = [
        ':scope > modifiers > modifier',
        ':scope > modifierGroups > modifierGroup > modifiers > modifier',
      ];
      const seenMods = new Set();
      modSelectors.forEach(sel => entryEl.querySelectorAll(sel).forEach(mod => {
        if (seenMods.has(mod)) return;
        seenMods.add(mod);
        const modType = I.getAttr(mod, 'type');
        if (modType !== 'set' && modType !== 'increment') return;
        if (I.getAttr(mod, 'field') !== ptsTypeId) return;
        const val = parseFloat(I.getAttr(mod, 'value', '0'));
        if (isNaN(val) || val <= 0) return;
        const tierPts = (modType === 'increment') ? basePts + val : val;
        if (tierPts === basePts) return;
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
        tiers.push({ pts: tierPts, threshold, exact });
      }));
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
