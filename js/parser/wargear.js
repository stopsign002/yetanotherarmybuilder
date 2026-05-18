/* wargear.js — builds the two-flavour wargear-options list (model variants
 * inside squad-size groups, and direct equipment-choice groups). */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function collectWargearOptions(entryEl, entriesById) {
    const options = [];
    const seenIds = new Set();

    function getChoices(group) {
      const choices = [];
      group.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
        if (I.getAttr(entry, 'hidden', 'false') === 'true') return;
        const t = I.getAttr(entry, 'type', '');
        if (t === 'model' || t === 'unit') return;
        const name = I.getAttr(entry, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        if (I.isCrusadeSection(name)) return;
        choices.push({ name });
      });
      group.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (I.getAttr(link, 'hidden', 'false') === 'true') return;
        const name = I.getAttr(link, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        if (I.isCrusadeSection(name)) return;
        choices.push({ name });
      });
      return choices;
    }

    function getMaxConstraint(el) {
      let maxVal = null;
      el.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        if (I.getAttr(c, 'type') === 'max') {
          const v = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (!isNaN(v) && v > 0) maxVal = v;
        }
      });
      return maxVal;
    }

    function getMinConstraint(el) {
      let minVal = null;
      el.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        if (I.getAttr(c, 'type') === 'min') {
          const v = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (!isNaN(v) && v > 0) minVal = v;
        }
      });
      return minVal;
    }

    // stripVariantPrefix moved to classify.js so weapons.js can share it.
    const stripVariantPrefix = I.stripVariantPrefix;

    // Returns true iff the resolved entry has at least one weapon-typed profile,
    // either directly on it or one of its profile children. We walk only the entry
    // itself (not nested groups) because nested groups are upgrade territory.
    function entryHasWeaponProfile(entry) {
      const profs = entry.querySelectorAll(':scope > profiles > profile');
      for (const p of profs) {
        if (I.classifyProfile(p) === 'weapon') return true;
      }
      return false;
    }

    // True if the entryLink represents a mandatory ("always equipped") weapon —
    // either it has no constraints (BSData treats unbounded entryLinks as min 1),
    // or it explicitly carries a min constraint >= 1. Links with only a max
    // constraint and no min (e.g. Tactical Sergeant's optional Twin lightning
    // claws) are optional upgrades, not defaults.
    function isMandatoryEntryLink(link) {
      const constraints = link.querySelectorAll(':scope > constraints > constraint');
      if (constraints.length === 0) return true;
      let hasMin = false;
      let hasMaxOnly = false;
      for (const c of constraints) {
        const t = I.getAttr(c, 'type', '');
        const v = parseFloat(I.getAttr(c, 'value', '0'));
        if (t === 'min' && !isNaN(v) && v >= 1) hasMin = true;
        if (t === 'max') hasMaxOnly = true;
      }
      // Has a real min ⇒ default. Otherwise (only max, or min=0) ⇒ optional.
      if (hasMin) return true;
      if (hasMaxOnly) return false;
      return true;
    }

    // Resolve a single "weapon-bearing" name from an entry. Prefers the entry's own
    // name when its profiles classify as weapons (so multi-profile weapons like
    // "Astartes grenade launcher" surface once instead of as krak/frag sub-variants).
    // Returns null if the entry doesn't carry any weapon profile.
    function nameForWeaponEntry(entry) {
      if (!entry) return null;
      if (!entryHasWeaponProfile(entry)) return null;
      const entryName = I.getAttr(entry, 'name', '').trim();
      if (entryName && !I.isCrusadeSection(entryName)) return entryName;
      // Fall back to first weapon profile name.
      const prof = entry.querySelector(':scope > profiles > profile');
      const pName = prof ? I.getAttr(prof, 'name', '').trim() : '';
      return pName ? stripVariantPrefix(pName) : null;
    }

    // Looks up the default weapon name for a `selectionEntryGroup` that has
    // `defaultSelectionEntryId` set. The id refers to a child entryLink or
    // selectionEntry of the group; we resolve it to the underlying weapon entry.
    function getGroupDefaultWeaponName(group) {
      const defaultId = I.getAttr(group, 'defaultSelectionEntryId', '');
      if (!defaultId) return null;
      // Search the group's own entryLinks first.
      const linkSelector = `:scope > entryLinks > entryLink[id="${defaultId}"]`;
      const link = group.querySelector(linkSelector);
      if (link) {
        if (I.getAttr(link, 'hidden', 'false') === 'true') return null;
        const targetId = I.getAttr(link, 'targetId', '');
        const target = targetId ? entriesById.get(targetId) : null;
        const resolved = nameForWeaponEntry(target);
        if (resolved) return resolved;
        // Fall back to the entryLink's own name if the target lookup fails.
        const linkName = I.getAttr(link, 'name', '').trim();
        return linkName && !I.isCrusadeSection(linkName) ? linkName : null;
      }
      // Or a direct child selectionEntry.
      const entry = group.querySelector(`:scope > selectionEntries > selectionEntry[id="${defaultId}"]`);
      if (entry) {
        if (I.getAttr(entry, 'hidden', 'false') === 'true') return null;
        const direct = nameForWeaponEntry(entry);
        if (direct) return direct;
        const eName = I.getAttr(entry, 'name', '').trim();
        return eName && !I.isCrusadeSection(eName) ? eName : null;
      }
      return null;
    }

    // Collects weapon names that ship "by default" on a model. Three sources:
    //   (a) direct weapon profiles on the model entry (rare in 10e — usually
    //       just the unit stat profile lives here);
    //   (b) entryLinks on the model entry whose target is a weapon-bearing
    //       selectionEntry — these are the BSData way of bolting standard
    //       weapons (Bolt Rifle, Bolt pistol, Close combat weapon) onto a
    //       Marine without making the user pick;
    //   (c) `defaultSelectionEntryId` on weapon-option groups under the model
    //       — when present, this names the pre-selected choice for that slot
    //       (e.g. Intercessor Sergeant's Weapon 1 defaults to Bolt Rifle).
    // The third source is the one BSData uses for the Sergeant's "default kit"
    // and was previously missed entirely.
    function getDefaultWeaponNames(el) {
      const names = [];

      // (a) Direct weapon profiles on the model entry.
      el.querySelectorAll(':scope > profiles > profile').forEach(p => {
        if (I.classifyProfile(p) !== 'weapon') return;
        const n = stripVariantPrefix(I.getAttr(p, 'name', '').trim());
        if (n && !I.isCrusadeSection(n)) names.push(n);
      });

      // (b) entryLinks on the model that target weapon-bearing selectionEntries.
      // Only treat mandatory links (min >= 1, or unconstrained) as defaults — links
      // with just a max ceiling (e.g. Tactical Sergeant's optional Twin Lightning
      // Claws) are optional upgrades, not defaults.
      el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (I.getAttr(link, 'hidden', 'false') === 'true') return;
        if (!isMandatoryEntryLink(link)) return;
        const target = entriesById.get(I.getAttr(link, 'targetId'));
        const resolved = nameForWeaponEntry(target);
        if (resolved) names.push(resolved);
      });

      // (c) defaultSelectionEntryId on weapon-option groups under the model —
      // recursive across nested selectionEntryGroups so a "Wargear" wrapper
      // containing inner groups ("Weapon", "Crest", "Main weapon", …) still
      // surfaces each inner group's default. The Hearthkyn Theyn's
      // pre-selected Autoch-pattern bolter lived one nesting level deeper
      // than the single-level walk reached and was therefore being lost.
      function walkGroupsForDefault(parentEl) {
        parentEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
          if (I.getAttr(group, 'hidden', 'false') === 'true') return;
          if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
          const defaultName = getGroupDefaultWeaponName(group);
          if (defaultName) names.push(defaultName);
          walkGroupsForDefault(group);
        });
      }
      walkGroupsForDefault(el);

      return [...new Set(names)];
    }

    function processDirectGroup(group) {
      if (I.getAttr(group, 'hidden', 'false') === 'true') return;
      const groupId = group.getAttribute('id');
      if (groupId && seenIds.has(groupId)) return;

      const groupName = I.getAttr(group, 'name', '').trim();
      if (!groupName || /^new\s/i.test(groupName)) return;
      if (I.isCrusadeSection(groupName)) return;

      const hasModelOrUnit = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"]') ||
                             group.querySelector(':scope > selectionEntries > selectionEntry[type="unit"]');
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      if (hasModelOrUnit && hasSizeConstraint) return;
      if (groupId) seenIds.add(groupId);

      const choices = getChoices(group);
      if (choices.length === 0) return;
      options.push({ type: 'choice', name: groupName, choices, max: getMaxConstraint(group) });
    }

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      processDirectGroup(group);
    });

    function getGroupMin(group) {
      let minVal = null;
      group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        if (I.getAttr(c, 'type') === 'min') {
          const v = Math.round(parseFloat(I.getAttr(c, 'value', '0')));
          if (!isNaN(v) && v > 0) minVal = v;
        }
      });
      return minVal;
    }

    // squadGroupMin/Max: constraints from the parent selectionEntryGroup (null for direct
    // children of the unit entry).  ownModelMax: the model entry's own max constraint,
    // used for perModels ratio.  modelMin/Max: effective display counts, falling back to
    // the group bounds when the model entry has no own constraints.
    function processModelEntry(modelEl, squadGroupMin, squadGroupMax) {
      const modelId = modelEl.getAttribute('id');
      if (modelId && seenIds.has(modelId)) return;

      const modelName = I.getAttr(modelEl, 'name', '').trim();
      if (!modelName || /^new\s/i.test(modelName)) return;
      if (I.isCrusadeSection(modelName)) return;

      const subOptions = [];
      // Walk every wargear sub-group, including INNER sub-groups nested under
      // a wrapper. Many character entries put their actual weapon-pickers
      // (Crest / Melee weapon / Ranged weapon / Main weapon) one level deeper
      // than the visible "Wargear" wrapper — without this recursion the
      // wrapper appears empty and the user sees no pickers at all.
      function walkGroupsForOptions(parentEl) {
        parentEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
          if (I.getAttr(group, 'hidden', 'false') === 'true') return;
          const gName = I.getAttr(group, 'name', '').trim();
          if (!gName || /^new\s/i.test(gName)) return;
          if (I.isCrusadeSection(gName)) return;
          const choices = getChoices(group);
          if (choices.length > 0) {
            subOptions.push({ name: gName, choices, max: getMaxConstraint(group) });
          }
          // Recurse — inner sub-groups commonly carry the real pickers when
          // the outer group is just a wrapper. BSData generally uses one OR
          // the other, so producing both is rare; when it does happen the
          // outer's choices and the inner groups are both legitimate.
          walkGroupsForOptions(group);
        });
      }
      walkGroupsForOptions(modelEl);

      const ownModelMax = getMaxConstraint(modelEl);
      const ownModelMin = getMinConstraint(modelEl);
      const defaultWeapons = getDefaultWeaponNames(modelEl);
      if (subOptions.length === 0 && defaultWeapons.length === 0) return;
      if (modelId) seenIds.add(modelId);

      // Resolve display min/max for this model entry:
      //   - Both own constraints set (sergeant, mandatory leader): use them verbatim.
      //   - Only own max (optional weapon variant like "Intercessor w/ Grenade Launcher"):
      //     min is 0 (the variant is optional); avoid falling back to squadGroupMin which
      //     would produce nonsense like "5–2 models".
      //   - Only own min: keep it; cap at squad max if available.
      //   - No own constraints (purely structural model entry under a sized squad group):
      //     fall back to the squad bounds.
      let modelMin, modelMax;
      if (ownModelMin != null && ownModelMax != null) {
        modelMin = ownModelMin;
        modelMax = ownModelMax;
      } else if (ownModelMax != null) {
        modelMin = 0;
        modelMax = ownModelMax;
      } else if (ownModelMin != null) {
        modelMin = ownModelMin;
        modelMax = squadGroupMax;
      } else {
        modelMin = squadGroupMin;
        modelMax = squadGroupMax;
      }
      let perModels = null;
      // Only derive "1 per N" for optional model variants (no own min = can have zero).
      // Mandatory models (ownModelMin >= 1, e.g. sergeant) are never "1 per N".
      if (ownModelMax && squadGroupMin && squadGroupMin > ownModelMax && !ownModelMin) {
        perModels = Math.round(squadGroupMin / ownModelMax);
      }
      options.push({ type: 'model', modelName, modelMin, modelMax, perModels, defaultWeapons, subOptions });
    }

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
      const hasModelOrUnit = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"]') ||
                             group.querySelector(':scope > selectionEntries > selectionEntry[type="unit"]');
      if (!hasModelOrUnit) return;
      // Squad-size groups usually carry their own min/max constraints, but some
      // (e.g. Aggressor Squad) leave them on the child model entries instead. We
      // accept either flavour: if the group has no direct constraints but its
      // children are constrained model entries, treat it as a squad group with
      // null group bounds and let the per-model fallback rules apply.
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      const hasModelConstraint = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"] > constraints > constraint, ' +
                                                     ':scope > selectionEntries > selectionEntry[type="unit"] > constraints > constraint');
      if (!hasSizeConstraint && !hasModelConstraint) return;
      const groupMin = getGroupMin(group);
      const groupMax = getMaxConstraint(group);
      group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"], ' +
                             ':scope > selectionEntries > selectionEntry[type="unit"]').forEach(modelEl => {
        processModelEntry(modelEl, groupMin, groupMax);
      });
    });

    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]')
      .forEach(m => processModelEntry(m, null, null));

    entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    ).forEach(link => {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (!target) return;
      processModelEntry(target, null, null);
    });

    return options;
  }

  I.collectWargearOptions = collectWargearOptions;
})();
