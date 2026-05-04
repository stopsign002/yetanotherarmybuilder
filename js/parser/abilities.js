/* abilities.js — walks a unit entry collecting direct + linked abilities,
 * including profile and rule infoLinks plus recursion into model variants. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function collectAbilities(entryEl, entriesById, profilesById, rulesById, depth = 0, visited = new Set()) {
    // Depth 3 was tight — Lion El'Jonson's primarch sub-abilities sit
    // 4 levels deep through the nested selectionEntries chain in the
    // Dark Angels catalog. Bumping to 5 gives headroom without
    // unbounded recursion (the visited-set still guards against cycles).
    if (depth > 5) return [];
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
        // Match the parseDirectProfiles fallback: prefer Description,
        // fall back to Effect for primarch / warlord-trait shapes.
        const descEl = profile.querySelector('characteristic[name="Description"]')
                    || profile.querySelector('characteristic[name="Effect"]');
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

    // Recurse into EVERY selectionEntry child of the unit entry,
    // regardless of `type`. Lion El'Jonson's three "Primarch of the
    // First Legion" sub-abilities don't surface with a type="model"
    // OR type="upgrade" filter — the BSData encoding for some hero
    // primarch abilities uses a different (or absent) type attribute.
    // The dedup-by-name in entry.js handles any units that happen to
    // link the same ability through multiple paths. Crusade-section
    // names are still skipped.
    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      if (I.isCrusadeSection(I.getAttr(child, 'name', ''))) return;
      collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    // Top-level entryLinks at the unit entry — point to shared/upgrade
    // entries that carry abilities (also Lion's encoding).
    entryEl.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(I.getAttr(link, 'targetId'));
      if (!target) return;
      if (I.isCrusadeSection(I.getAttr(target, 'name', ''))) return;
      collectAbilities(target, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
      // Same widening as above — walk every selectionEntry inside the
      // group regardless of `type`.
      group.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
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
