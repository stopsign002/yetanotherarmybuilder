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

    // Collects weapon names from direct profiles + direct entryLink targets on a model
    // entry. These are the "always equipped" default weapons (not optional upgrades, which
    // live in selectionEntryGroups). Only follows one level deep — nested groups are
    // optional-upgrade territory, not defaults.
    function getDefaultWeaponNames(el) {
      const names = [];
      el.querySelectorAll(':scope > profiles > profile').forEach(p => {
        if (I.classifyProfile(p) !== 'weapon') return;
        const n = I.getAttr(p, 'name', '').trim();
        if (n && !I.isCrusadeSection(n)) names.push(n);
      });
      el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (I.getAttr(link, 'hidden', 'false') === 'true') return;
        const target = entriesById.get(I.getAttr(link, 'targetId'));
        if (!target) return;
        target.querySelectorAll(':scope > profiles > profile').forEach(p => {
          if (I.classifyProfile(p) !== 'weapon') return;
          const n = I.getAttr(p, 'name', '').trim();
          if (n && !I.isCrusadeSection(n)) names.push(n);
        });
      });
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
      modelEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
        if (I.getAttr(group, 'hidden', 'false') === 'true') return;
        const gName = I.getAttr(group, 'name', '').trim();
        if (!gName || /^new\s/i.test(gName)) return;
        if (I.isCrusadeSection(gName)) return;
        const choices = getChoices(group);
        if (choices.length === 0) return;
        subOptions.push({ name: gName, choices, max: getMaxConstraint(group) });
      });

      const ownModelMax = getMaxConstraint(modelEl);
      const ownModelMin = getMinConstraint(modelEl);
      const defaultWeapons = getDefaultWeaponNames(modelEl);
      if (subOptions.length === 0 && defaultWeapons.length === 0) return;
      if (modelId) seenIds.add(modelId);

      const modelMin = ownModelMin ?? squadGroupMin;
      const modelMax = ownModelMax ?? squadGroupMax;
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
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      if (!hasModelOrUnit || !hasSizeConstraint) return;
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
