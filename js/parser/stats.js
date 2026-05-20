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
      const rawName = I.getAttr(profile, 'name');
      const chars = parseCharacteristics(profile);

      if (kind === 'stats') {
        Object.assign(stats, chars);
      } else if (kind === 'weapon') {
        // BSData multi-profile weapons (Buri Aegnirssen's "Bane", a chunk of
        // 10e strike/sweep weapons, plasma supercharge/standard variants)
        // prefix each variant with "➤ " so they sort under the parent
        // entry in the editor. The glyph reads as line noise on the
        // datasheet — strip it so the row says "Bane - strike" instead.
        const name = I.stripVariantPrefix(rawName);
        if (name) weapons.push({ name, _typeName: I.getAttr(profile, 'typeName', ''), ...chars });
      } else if (kind === 'ability') {
        // 10e BSData uses several characteristic names for ability prose:
        // <characteristic name="Description"> for vanilla abilities,
        // <characteristic name="Effect"> for primarch sub-abilities and
        // some warlord-trait-style profiles, and
        // <characteristic name="Capacity"> for Ork transport profiles
        // (Battlewagon, Trukk, Stompa, …). Fall through all three so
        // those reach the renderer.
        const descEl = profile.querySelector('characteristic[name="Description"]')
                    || profile.querySelector('characteristic[name="Effect"]')
                    || profile.querySelector('characteristic[name="Capacity"]');
        // Capture typeName too — primarch sub-ability profiles ship with
        // typeName like "Primarch of the First Legion" instead of the
        // generic "Abilities", which is the only way to tell them apart
        // from regular abilities at render time.
        const tn = I.getAttr(profile, 'typeName', '');
        if (rawName) abilities.push({
          name: rawName,
          description: descEl ? I.cleanText(descEl.textContent) : '',
          _typeName: tn,
        });
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

  // Same as parseDirectProfiles but returns every stats profile as a
  // separate `{ name, ...chars }` object instead of merging them into one
  // dict. Multi-statline units (Marneus Calgar + Victrix Honour Guard,
  // Wardens of Ultramar Sergeant vs body, Terminator Assault Squad
  // TH/SS vs Lightning Claws) lose data when the second profile is
  // Object.assigned over the first.
  function parseDirectStatProfiles(el) {
    const profs = [];
    el.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      if (I.classifyProfile(profile) !== 'stats') return;
      const name  = I.getAttr(profile, 'name', '');
      const chars = parseCharacteristics(profile);
      if (Object.keys(chars).length > 0) profs.push({ name, ...chars });
    });
    return profs;
  }

  function statProfilesFromInfoLinks(el, profilesById) {
    const profs = [];
    el.querySelectorAll(':scope > infoLinks > infoLink').forEach(link => {
      if (I.getAttr(link, 'type') !== 'profile') return;
      const profile = profilesById.get(I.getAttr(link, 'targetId'));
      if (!profile || I.classifyProfile(profile) !== 'stats') return;
      const name  = I.getAttr(profile, 'name', '');
      const chars = parseCharacteristics(profile);
      if (Object.keys(chars).length > 0) profs.push({ name, ...chars });
    });
    return profs;
  }

  // Returns ALL distinct stat profiles for a unit. Multi-statline units
  // (different stats per model in the same unit) come through with N
  // entries. Two collection strategies, in priority order:
  //   1. If the entry (or a shared profile it infoLinks) declares stat
  //      profiles directly, those win outright — a unit/model that
  //      describes its own statline(s) is self-contained (Marneus
  //      Calgar + Victrix Honour Guard ship two inline Unit profiles).
  //   2. Otherwise AGGREGATE every model/unit child + every group's
  //      models. A squad routinely splits its statlines across sibling
  //      model entries or per-model groups — Beast Snagga Boyz keep a
  //      "Boy" group AND a "Nob" group, Kommandos add a "Bomb Squig",
  //      etc. The pre-fix code returned only the FIRST sibling that
  //      had stats, silently dropping every other statline. Aggregating
  //      is safe: identical statlines (same characteristics, different
  //      model name) collapse downstream via the signature-dedup in
  //      entry.js, and non-Unit-typed profiles (weapons, abilities) are
  //      filtered out by parseDirectStatProfiles, so resolving wargear
  //      entryLinks contributes nothing spurious.
  function findStatProfiles(entryEl, entriesById, profilesById, depth = 0) {
    if (depth > 4) return [];

    const direct = parseDirectStatProfiles(entryEl);
    if (direct.length > 0) return direct;

    const linked = statProfilesFromInfoLinks(entryEl, profilesById);
    if (linked.length > 0) return linked;

    const collected = [];

    entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"]'
    ).forEach(child => {
      const s = findStatProfiles(child, entriesById, profilesById, depth + 1);
      for (let i = 0; i < s.length; i++) collected.push(s[i]);
    });

    function searchGroups(groupEl) {
      const out = [];
      const groupDirect = parseDirectStatProfiles(groupEl);
      for (let i = 0; i < groupDirect.length; i++) out.push(groupDirect[i]);
      groupEl.querySelectorAll(
        ':scope > selectionEntries > selectionEntry[type="model"], ' +
        ':scope > selectionEntries > selectionEntry[type="unit"]'
      ).forEach(child => {
        const s = findStatProfiles(child, entriesById, profilesById, depth + 1);
        for (let i = 0; i < s.length; i++) out.push(s[i]);
      });
      groupEl.querySelectorAll(
        ':scope > entryLinks > entryLink, ' +
        ':scope > selectionEntries > selectionEntry > entryLinks > entryLink'
      ).forEach(link => {
        const target = entriesById.get(I.getAttr(link, 'targetId'));
        if (target) {
          const s = findStatProfiles(target, entriesById, profilesById, depth + 1);
          for (let i = 0; i < s.length; i++) out.push(s[i]);
        }
      });
      groupEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(sub => {
        const s = searchGroups(sub);
        for (let i = 0; i < s.length; i++) out.push(s[i]);
      });
      return out;
    }
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      const s = searchGroups(group);
      for (let i = 0; i < s.length; i++) collected.push(s[i]);
    });

    return collected;
  }

  // Route the legacy flat-dict findStats through findStatProfiles so the
  // FIRST profile wins, not the last one. Object.assign-style merging
  // silently corrupted multi-statline units (Marneus Calgar showed
  // Victrix Honour Guard's T=4 W=3 instead of his own T=6 W=6).
  function findStats(entryEl, entriesById, profilesById, depth = 0) {
    const profs = findStatProfiles(entryEl, entriesById, profilesById, depth);
    if (profs.length === 0) return {};
    const { name: _name, ...rest } = profs[0];
    return rest;
  }

  I.parseCharacteristics      = parseCharacteristics;
  I.parseDirectProfiles       = parseDirectProfiles;
  I.statsFromInfoLinks        = statsFromInfoLinks;
  I.findStats                 = findStats;
  I.parseDirectStatProfiles   = parseDirectStatProfiles;
  I.statProfilesFromInfoLinks = statProfilesFromInfoLinks;
  I.findStatProfiles          = findStatProfiles;
})();
