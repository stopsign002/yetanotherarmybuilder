/* classify.js — text helpers, Crusade-section filter, profile classifier. */

(function () {
  window.WahapediaParser = window.WahapediaParser || {};
  const P = window.WahapediaParser;
  P._internal = P._internal || {};

  function cleanText(str) {
    if (!str) return '';
    return str
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\^\^([^^]*)\^\^/g, '$1')
      .replace(/__([^_]*)__/g, '$1')
      .replace(/~~([^~]*)~~/g, '$1')
      .trim();
  }

  // Anchor on word boundaries for "enhancement(s)" so it catches BOTH
  //   "Enhancements"                                  (the canonical group)
  //   "Headhunter Task Force Enhancements"            (per-detachment subgroup)
  //   "Enhancement"                                   (singular variant)
  // without false-positive matching on unit/ability names that happen
  // to contain those substrings. The previous "^enhancement" anchor
  // only caught the canonical singular case at start-of-string, so a
  // unit-level entryLink to a per-detachment "X Enhancements" group
  // (Land Raider → "Headhunter Task Force Enhancements") slipped past
  // the walker — every enhancement inside got pulled in as if it were
  // a unit ability, surfacing "Precision" and "Lethal Hits" as core
  // abilities on Land Raider, Predator, etc.
  //
  // Individual enhancements (e.g. "Standard of the Emperor Ascendant")
  // don't contain the word "enhancement" in their own names, so the
  // detachment-enhancement extraction in catalogue.js still picks them
  // up correctly.
  //
  // "Weapon Modifications" is the GST's Crusade weapon-upgrade group
  // (Precise → grants Precision, Lethal → grants Lethal Hits, etc.).
  // Vehicle Wargear groups infoLink it from each weapon slot for
  // Crusade play; without filtering, every match-play Land Raider /
  // Predator / Repulsor inherited Precise / Precision / Lethal Hits /
  // … as core abilities just because the walker descended through the
  // weapon's modifications hook.
  const CRUSADE_RE = /crusade|battle\s+honour|battle\s+scar|battle\s+trait|\benhancements?\b|psychic\s+tradition|weapon\s+modifications?/i;
  function isCrusadeSection(name) {
    if (!name) return false;
    return CRUSADE_RE.test(name);
  }

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  // Strip BSData "display variant" prefix (e.g. "➤ Plasma pistol - supercharge").
  // Used when a single weapon entry exposes multiple profiles (krak/frag,
  // supercharge/standard, strike/sweep, …) and the profile names start with a
  // bullet glyph. The unstripped names render as ugly "➤ Bane - strike" rows
  // on the datasheet; stripping leaves "Bane - strike" which reads like a
  // proper multi-stance weapon profile.
  const VARIANT_PREFIX_RE = /^[➤▶►▸>]\s*/;
  function stripVariantPrefix(name) {
    if (!name) return '';
    return String(name).replace(VARIANT_PREFIX_RE, '').trim();
  }
  // Returns true when at least one profile in `list` carries the variant
  // glyph — caller uses this to decide whether to group them under the
  // parent selectionEntry name.
  function hasVariantPrefix(profiles) {
    for (const p of profiles) {
      if (VARIANT_PREFIX_RE.test(getAttr(p, 'name', ''))) return true;
    }
    return false;
  }

  // Fold diacritics + lowercase for fuzzy name keying. Used in catalogue.js
  // to match enhancement <comment> spellings against detachment names
  // (BSData spells "Needgaârd Oathband" on the detachment but plain
  // "Needgaard" on the enhancement comment — exact-match dropped 4
  // enhancements until this fold was added).
  function foldKey(s) {
    if (!s) return '';
    let out = String(s);
    if (typeof out.normalize === 'function') {
      try {
        // U+0300–U+036F is the Combining Diacritical Marks block;
        // NFD splits an accented character into base + combining mark, so
        // stripping the marks leaves the base ASCII / Latin letter.
        out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
      } catch (_) {}
    }
    return out.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const WEAPON_TYPES = new Set(['weapon', 'ranged weapons', 'melee weapons', 'ranged', 'melee']);
  const UNIT_TYPES   = new Set(['unit', 'model']);

  function classifyProfile(profile) {
    const typeName = getAttr(profile, 'typeName', '').toLowerCase();
    if (UNIT_TYPES.has(typeName))    return 'stats';
    if (WEAPON_TYPES.has(typeName))  return 'weapon';

    // 10e BSData encodes "regular" ability profiles with a
    // <characteristic name="Description">. Primarch sub-ability
    // profiles (Lion El'Jonson's three "Primarch of the First Legion"
    // toggles, Magnus / Mortarion equivalents) instead use a
    // <characteristic name="Effect"> and a typeName that's the parent
    // ability's name — e.g. typeName="Primarch of the First Legion".
    // Ork transport profiles (Battlewagon, Trukk, Stompa, …) carry the
    // capacity prose in a <characteristic name="Capacity"> instead.
    // Treat all three shapes as 'ability' so they reach the renderer.
    if (profile.querySelector('characteristic[name="Description"]')) return 'ability';
    if (profile.querySelector('characteristic[name="Effect"]'))      return 'ability';
    if (profile.querySelector('characteristic[name="Capacity"]'))    return 'ability';

    if (typeName.includes('abilit') || typeName === 'leader' ||
        typeName.includes('power') || typeName.includes('trait') ||
        typeName === 'invulnerable save' ||
        typeName === 'transport' ||
        typeName.startsWith('primarch of ')) return 'ability';

    return 'other';
  }

  P._internal.cleanText          = cleanText;
  P._internal.CRUSADE_RE         = CRUSADE_RE;
  P._internal.isCrusadeSection   = isCrusadeSection;
  P._internal.getAttr            = getAttr;
  P._internal.classifyProfile    = classifyProfile;
  P._internal.stripVariantPrefix = stripVariantPrefix;
  P._internal.hasVariantPrefix   = hasVariantPrefix;
  P._internal.foldKey            = foldKey;
})();
