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

    // Walk type="upgrade" selectionEntries at the unit's top level too.
    // 10e BSData encodes some "choose-one-of-N" hero abilities here —
    // notably Lion El'Jonson's three "Primarch of the First Legion"
    // sub-abilities, which are upgrade-type sibling entries the player
    // picks from at the start of each Command phase. The earlier walk
    // only recursed into type="model", so these went missing on the
    // unit cards even though the parent rule (also reached via the
    // entry's infoLinks) was present. Dedup-by-name in entry.js
    // catches duplicates if a unit links the same ability through
    // multiple paths.
    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="upgrade"]').forEach(child => {
      if (I.isCrusadeSection(I.getAttr(child, 'name', ''))) return;
      collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    // Top-level entryLinks at the unit entry (not inside a
    // selectionEntryGroup) — point to shared/upgrade entries that
    // carry abilities. Same Lion El'Jonson pattern: BSData wraps the
    // primarch toggles as shared upgrades referenced by entryLink
    // here. Without this walk, those abilities never reach the parser.
    entryEl.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (!target) return;
      if (I.isCrusadeSection(I.getAttr(target, 'name', ''))) return;
      collectAbilities(target, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
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
      // Composition-pick pattern: entryLinks nested inside upgrade children (Squighog Boyz).
      group.querySelectorAll(':scope > selectionEntries > selectionEntry > entryLinks > entryLink').forEach(link => {
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
