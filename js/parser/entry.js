/* entry.js — assembles one unit object from a selectionEntry DOM node. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function parseEntry(entryEl, entriesById, profilesById, rulesById) {
    if (I.getAttr(entryEl, 'hidden', 'false') === 'true') return null;

    const name = I.getAttr(entryEl, 'name', 'Unknown Unit');
    // Legacy: units tagged `[Legends]` used to be filtered out entirely.
    // Now we surface them with an opt-in flag so the Legends toggle can reveal them.
    // if (name.includes('[Legends]')) return null;
    const isLegends = name.includes('[Legends]');

    const id   = I.getAttr(entryEl, 'id') || Math.random().toString(36).slice(2, 9);
    const type = I.getAttr(entryEl, 'type', '');

    const stats        = I.findStats(entryEl, entriesById, profilesById);
    const weapons      = I.dedup(I.collectWeapons(entryEl, entriesById), 'name');
    const allAbilities = I.dedup(I.collectAbilities(entryEl, entriesById, profilesById, rulesById), 'name');
    const keywords     = I.parseKeywords(entryEl);
    const wargearOptions = I.collectWargearOptions(entryEl, entriesById);
    const { points, pointsOptions, squadOptions } = I.findCosts(entryEl, entriesById);
    const descEl = entryEl.querySelector(':scope > description');

    const rulesByName = new Map();
    for (const rule of rulesById.values()) {
      const n    = I.getAttr(rule, 'name', '').trim();
      const desc = rule.querySelector(':scope > description')?.textContent?.trim() || '';
      if (n) rulesByName.set(n.toLowerCase(), desc);
    }
    weapons.forEach(w => {
      if (!w.Keywords) return;
      const defs = {};
      String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
        const desc = I.findWeaponKeywordDesc(k, rulesByName);
        if (desc) defs[k] = desc;
      });
      if (Object.keys(defs).length) w._keywordDefs = defs;
    });

    const weaponKeywordNames = new Set();
    weapons.forEach(w => {
      if (w.Keywords) {
        String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean)
          .forEach(k => weaponKeywordNames.add(k.toLowerCase()));
      }
    });

    let invulnSave = stats['INV'] || stats['Invulnerable Save'] || null;
    if (!invulnSave) {
      const invAb = allAbilities.find(a => /invulnerable\s+save/i.test(a.name));
      if (invAb) {
        const m = invAb.description.match(/(\d\+)/);
        if (m) invulnSave = m[1];
        else if (/^\d\+$/.test(invAb.description.trim())) invulnSave = invAb.description.trim();
      }
    }

    const abilities = allAbilities
      .filter(a => !/invulnerable\s+save/i.test(a.name))
      .filter(a => !a.isCore || !weaponKeywordNames.has(a.name.toLowerCase()));

    return {
      id, name, type,
      stats,
      invulnSave,
      weapons,
      abilities,
      keywords,
      wargearOptions,
      points,
      pointsOptions,
      squadOptions,
      description: descEl ? I.cleanText(descEl.textContent) : '',
      isLegends
    };
  }

  I.parseEntry = parseEntry;
})();
