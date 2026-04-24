/* weapons.js — recursive weapon collection + parameterized-keyword lookup. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function findWeaponKeywordDesc(keyword, rulesByName) {
    const lower = keyword.toLowerCase();
    let d = rulesByName.get(lower);
    if (d !== undefined) return d;
    const stripped = lower.replace(/\s+\d+\+?$/, '').trim();
    if (stripped !== lower) {
      d = rulesByName.get(stripped);
      if (d !== undefined) return d;
    }
    for (const [name, desc] of rulesByName) {
      if (name.endsWith('-') && lower.startsWith(name)) return desc;
    }
    return undefined;
  }

  function collectWeapons(el, entriesById, depth = 0, visited = new Set()) {
    if (depth > 6) return [];
    const id = el.getAttribute('id');
    if (id) {
      if (visited.has(id)) return [];
      visited.add(id);
    }

    const weapons = [];
    weapons.push(...I.parseDirectProfiles(el).weapons);

    el.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      if (I.isCrusadeSection(I.getAttr(child, 'name', ''))) return;
      weapons.push(...collectWeapons(child, entriesById, depth + 1, visited));
    });

    el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (!target) return;
      if (I.isCrusadeSection(I.getAttr(target, 'name', ''))) return;
      weapons.push(...collectWeapons(target, entriesById, depth + 1, new Set(visited)));
    });

    el.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
      weapons.push(...collectWeapons(group, entriesById, depth + 1, visited));
    });

    return weapons;
  }

  I.findWeaponKeywordDesc = findWeaponKeywordDesc;
  I.collectWeapons        = collectWeapons;
})();
