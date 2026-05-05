/* entry.js — assembles one unit object from a selectionEntry DOM node. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  // Detect the "choose-from-N" pattern in a single ability whose entire
  // mechanic was inlined into one description string (Guilliman's
  // "Author of the Codex" shape) and split it into a parent ability +
  // synthetic child sub-abilities. The children get _typeName="Primarch"
  // so cards-mode subAbilitySectionKey() routes them to the PRIMARCH
  // section, matching how Lion / Angron / Silent King already render.
  //
  // Conservative match: the parent paragraph must explicitly mention
  // "select <number/word> ... abilit(y/ies)" so flowing rule prose that
  // happens to use "Foo: bar" sub-headers (e.g. some stratagem-like
  // abilities) doesn't get accidentally split. All paragraphs after the
  // first must be `Heading: body` form, and we need at least 2 of them.
  function splitMultiParagraphChooseFromN(ability) {
    if (!ability || ability.isCore) return [ability];
    const desc = String(ability.description || '');
    // BSData uses straight or curly apostrophes interchangeably; both
    // can appear at the parent paragraph end (see "abilities.'\n\n…").
    if (!desc.includes('\n\n')) return [ability];

    const paras = desc.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    if (paras.length < 3) return [ability];

    // Parent must announce the choose mechanic.
    if (!/\bselect\s+\w+\s+[\w '’\-(),]*?\babilit/i.test(paras[0])) return [ability];

    const HEADING_RE = /^([A-Z][A-Za-z0-9 '’()\-]*?):\s+([\s\S]+)$/;
    const children = [];
    for (let i = 1; i < paras.length; i++) {
      const m = paras[i].match(HEADING_RE);
      if (!m) return [ability];   // any non-matching paragraph → bail entirely
      const name = m[1].trim();
      const body = m[2].trim();
      if (!name || !body) return [ability];
      children.push({
        name,
        description: body,
        // Synthetic typeName routes through subAbilitySectionKey →
        // "PRIMARCH" (matches the alias for typeName starting "Primarch").
        _typeName: 'Primarch',
      });
    }
    if (children.length < 2) return [ability];

    // Replace the bundled ability with: parent (only the first
    // paragraph) + synthetic children.
    return [
      { name: ability.name, description: paras[0], _typeName: ability._typeName || 'Abilities' },
      ...children,
    ];
  }

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
    // Weapons dedup keys on name + classification (typeName) so a unit
    // with both a ranged and a melee weapon of the same name keeps both
    // profiles. Plasmancer / Technomancer (Necron) each carry a ranged
    // and melee "Staff of Light" — single-key dedup dropped the melee.
    const weapons      = I.dedup(I.collectWeapons(entryEl, entriesById), w => {
      const cls = (w._typeName || '').toLowerCase().includes('melee') ? 'melee' : 'ranged';
      return (w.name || '') + '|' + cls;
    });
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
      if (!w.Keywords) return;
      String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
        const lc = k.toLowerCase();
        weaponKeywordNames.add(lc);
        // Strip the trailing arity suffix common in 10e weapon
        // keywords — "Rapid Fire 1" / "Sustained Hits D3" /
        // "Anti-Infantry 4+" all collapse to their bare base name so
        // the abilities filter below catches them. Without this the
        // base-name core ability ("Rapid Fire") slipped through and
        // showed up under CORE on the unit card (Guilliman regression).
        const stripped = lc.replace(/\s+\S*\d\S*\s*$/i, '').trim();
        if (stripped && stripped !== lc) weaponKeywordNames.add(stripped);
      });
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
      .filter(a => !a.isCore || !weaponKeywordNames.has(a.name.toLowerCase()))
      // Some heroes (Roboute Guilliman is the canonical case) ship their
      // choose-from-N toggles as ONE ability profile whose description
      // is a multi-paragraph string — parent paragraph + N "Heading:
      // body" sub-options separated by blank lines. Other heroes (Lion
      // El'Jonson, Angron, Silent King) get separate child profiles
      // with non-standard typeNames. The renderer only knows how to
      // section the latter shape, so the inline-paragraph form ends up
      // as one wall of text. Detect that pattern and synthesise the
      // separate-profiles shape so both encodings render identically.
      .flatMap(splitMultiParagraphChooseFromN);

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
