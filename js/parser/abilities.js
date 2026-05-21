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
        // Honour modifier-driven hide. Many shared aura profiles
        // (e.g. Votann's "Firebase Control (Aura)") carry a
        // `<modifier type="set" field="hidden" value="true">` whose
        // condition gates visibility on a specific detachment. The
        // parser can't evaluate the condition (it's force/roster-scoped
        // BSData expressions referencing detachment childIds), but the
        // intent is clearly "don't surface me unless that detachment is
        // picked". Default to skipping — the alternative was the aura
        // leaking onto every unit that referenced the profile.
        if (profile.querySelector(':scope > modifiers > modifier[type="set"][field="hidden"][value="true"]')) return;
        // Match the parseDirectProfiles fallback: prefer Description,
        // fall back to Effect for primarch / warlord-trait shapes, and
        // Capacity for Ork transport profiles.
        const descEl = profile.querySelector('characteristic[name="Description"]')
                    || profile.querySelector('characteristic[name="Effect"]')
                    || profile.querySelector('characteristic[name="Capacity"]');
        const tn = I.getAttr(profile, 'typeName', '');
        abilities.push({
          name,
          description: descEl ? I.cleanText(descEl.textContent) : '',
          _typeName: tn,
        });

      } else if (linkType === 'rule') {
        const rule = rulesById.get(targetId);
        if (!rule) return;
        // Detachment-gated rule. Same shape as the aura profiles above:
        // BSData ships a shared "Detachment Rules" infoGroup (linked by
        // ~every unit) that lists every detachment's rule as a rule
        // infoLink carrying `<modifier set hidden=true>` whose condition
        // is "this detachment isn't selected" — a force-scoped expression
        // the parser can't evaluate. Without this guard all of them leak
        // onto every unit as Core Abilities (the "core abilities infected
        // by detachment rules" bug). Default to skipping, matching the
        // profile branch; the rule still surfaces in the detachment panel.
        // The modifier rides on the infoLink (`link`) here, not the target
        // rule, but check both to cover either encoding.
        const HIDE_SEL = ':scope > modifiers > modifier[type="set"][field="hidden"][value="true"]';
        if (link.querySelector(HIDE_SEL) || rule.querySelector(HIDE_SEL)) return;
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

      } else if (linkType === 'infoGroup') {
        // Resolve to a shared <infoGroup> (Votann + a couple of other
        // factions use these for detachment-gated aura bundles).
        // collectAbilities already supports an `<infoGroup>` node kind
        // via the inline `:scope > infoGroups > infoGroup` walker
        // below, so we just route the resolved element through the
        // same recursion.
        const sharedInfoGroupsById = I.sharedInfoGroupsById || new Map();
        const group = sharedInfoGroupsById.get(targetId);
        if (!group) return;
        if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
        collectAbilities(group, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
          .forEach(a => abilities.push(a));
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

    // <infoGroups>/<infoGroup> wraps a named bundle of <profiles>
    // and <infoLinks> (Orks: Ghazghkull, Warboss-class characters'
    // "Leader" block; Tau: bounty-hunting / pilot blocks). The
    // recursive call resolves the inner profiles+infoLinks via the
    // same :scope queries used at the entry level. Without this,
    // Ghazghkull Thraka was missing his entire Leader block (the
    // list of units he can be attached to).
    entryEl.querySelectorAll(':scope > infoGroups > infoGroup').forEach(ig => {
      if (I.isCrusadeSection(I.getAttr(ig, 'name', ''))) return;
      collectAbilities(ig, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
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
      walkSelectionEntryGroup(group);
    });

    // Walks a <selectionEntryGroup>: pulls abilities from its direct
    // selectionEntries + entryLinks, and recurses into any NESTED
    // <selectionEntryGroups> chain. The recursion matters for units
    // like Big Mek in Mega Armour, where the top-level "Wargear" group
    // has no direct selectionEntries — it contains nested groups
    // ("Grot Oiler", "Additional Options", "Kustom-mega Blaster", …)
    // whose selectionEntries hold the ability profiles ("Grot Oiler"
    // grants its model an ability via wargear, not via a direct
    // profile on the unit). The pre-fix walker stopped at one level
    // of group and missed every wargear-granted ability.
    function walkSelectionEntryGroup(group) {
      if (I.isCrusadeSection(I.getAttr(group, 'name', ''))) return;
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
      // Recurse one level deeper: nested wargear sub-groups (Big Mek
      // in Mega Armour's "Wargear" wraps a "Grot Oiler" sub-group whose
      // entry profile is the ability we need to surface).
      group.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(sub => {
        walkSelectionEntryGroup(sub);
      });
    }

    return abilities;
  }

  I.collectAbilities = collectAbilities;
})();
