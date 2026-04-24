/* stats.js — extract unit stats + direct profiles (stats/weapons/abilities). */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function parseCharacteristics(profileEl) {
    const chars = {};
    profileEl.querySelectorAll(':scope > characteristics > characteristic').forEach(c => {
      const key = I.getAttr(c, 'name');
      if (key) chars[key] = I.cleanText(c.textContent);
    });
    return chars;
  }

  function parseDirectProfiles(el) {
    const stats     = {};
    const weapons   = [];
    const abilities = [];

    el.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      const kind  = I.classifyProfile(profile);
      const name  = I.getAttr(profile, 'name');
      const chars = parseCharacteristics(profile);

      if (kind === 'stats') {
        Object.assign(stats, chars);
      } else if (kind === 'weapon') {
        if (name) weapons.push({ name, _typeName: I.getAttr(profile, 'typeName', ''), ...chars });
      } else if (kind === 'ability') {
        const descEl = profile.querySelector('characteristic[name="Description"]');
        if (name) abilities.push({ name, description: descEl ? I.cleanText(descEl.textContent) : '' });
      }
    });

    return { stats, weapons, abilities };
  }

  function statsFromInfoLinks(el, profilesById) {
    const stats = {};
    el.querySelectorAll(':scope > infoLinks > infoLink').forEach(link => {
      if (I.getAttr(link, 'type') !== 'profile') return;
      const profile = profilesById.get(I.getAttr(link, 'targetId'));
      if (!profile) return;
      if (I.classifyProfile(profile) === 'stats') {
        Object.assign(stats, parseCharacteristics(profile));
      }
    });
    return stats;
  }

  function findStats(entryEl, entriesById, profilesById, depth = 0) {
    if (depth > 4) return {};

    const direct = parseDirectProfiles(entryEl).stats;
    if (Object.keys(direct).length > 0) return direct;

    const linked = statsFromInfoLinks(entryEl, profilesById);
    if (Object.keys(linked).length > 0) return linked;

    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const s = findStats(child, entriesById, profilesById, depth + 1);
      if (Object.keys(s).length > 0) return s;
    }

    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const s = findStats(child, entriesById, profilesById, depth + 1);
      if (Object.keys(s).length > 0) return s;
    }

    for (const link of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink, ' +
      // Composition-pick pattern (Squighog Boyz): entryLinks live inside upgrade entries
      // that sit in the squad-size group, not directly under the group.
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry > entryLinks > entryLink'
    )) {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (target) {
        const s = findStats(target, entriesById, profilesById, depth + 1);
        if (Object.keys(s).length > 0) return s;
      }
    }

    return {};
  }

  I.parseCharacteristics = parseCharacteristics;
  I.parseDirectProfiles  = parseDirectProfiles;
  I.statsFromInfoLinks   = statsFromInfoLinks;
  I.findStats            = findStats;
})();
