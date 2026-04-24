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

    function processModelEntry(modelEl, squadGroupMin) {
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
        subOptions.push({ name: gName, choices });
      });

      if (subOptions.length === 0) return;
      if (modelId) seenIds.add(modelId);

      const modelMax = getMaxConstraint(modelEl);
      let perModels = null;
      if (modelMax && squadGroupMin && squadGroupMin > modelMax) {
        perModels = Math.round(squadGroupMin / modelMax);
      }
      options.push({ type: 'model', modelName, modelMax, perModels, subOptions });
    }

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
      const hasModelOrUnit = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"]') ||
                             group.querySelector(':scope > selectionEntries > selectionEntry[type="unit"]');
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      if (!hasModelOrUnit || !hasSizeConstraint) return;
      const groupMin = getGroupMin(group);
      group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"], ' +
                             ':scope > selectionEntries > selectionEntry[type="unit"]').forEach(modelEl => {
        processModelEntry(modelEl, groupMin);
      });
    });

    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(processModelEntry);

    entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    ).forEach(link => {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (!target) return;
      processModelEntry(target);
    });

    return options;
  }

  I.collectWargearOptions = collectWargearOptions;
})();
