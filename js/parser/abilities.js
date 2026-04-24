/* abilities.js — walks a unit entry collecting direct + linked abilities,
 * including profile and rule infoLinks plus recursion into model variants. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function collectAbilities(entryEl, entriesById, profilesById, rulesById, depth = 0, visited = new Set()) {
    if (depth > 3) return [];
    const id = entryEl.getAttribute('id');
    if (id) {
      if (visited.has(id)) return [];
      visited.add(id);
    }

    const abilities = [];

    I.parseDirectProfiles(entryEl).abilities.forEach(a => abilities.push(a));

    entryEl.querySelectorAll(':scope > infoLinks > infoLink').forEach(link => {
      const linkType = I.getAttr(link, 'type');
      const targetId = I.getAttr(link, 'targetId');

      if (linkType === 'profile') {
        const profile = profilesById.get(targetId);
        if (!profile || I.classifyProfile(profile) !== 'ability') return;
        const name = I.getAttr(profile, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        if (I.isCrusadeSection(name)) return;
        const descEl = profile.querySelector('characteristic[name="Description"]');
        abilities.push({ name, description: descEl ? I.cleanText(descEl.textContent) : '' });

      } else if (linkType === 'rule') {
        const rule = rulesById.get(targetId);
        if (!rule) return;
        let name = I.getAttr(rule, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        if (I.isCrusadeSection(name)) return;
        link.querySelectorAll(':scope > modifiers > modifier[field="name"]').forEach(mod => {
          if (I.getAttr(mod, 'type', '') === 'append') {
            const val = I.getAttr(mod, 'value', '').trim();
            if (val) name = name + ' ' + val;
          }
        });
        const descEl = rule.querySelector(':scope > description');
        abilities.push({ name, description: descEl ? I.cleanText(descEl.textContent) : '', isCore: true });
      }
    });

    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(child => {
      if (I.isCrusadeSection(I.getAttr(child, 'name', ''))) return;
      collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
      group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(child => {
        if (I.isCrusadeSection(I.getAttr(child, 'name', ''))) return;
        collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
          .forEach(a => abilities.push(a));
      });
      group.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        const target = entriesById.get(I.getAttr(link, 'targetId'));
        if (!target) return;
        if (I.isCrusadeSection(I.getAttr(target, 'name', ''))) return;
        collectAbilities(target, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
          .forEach(a => abilities.push(a));
      });
    });

    return abilities;
  }

  I.collectAbilities = collectAbilities;
})();
