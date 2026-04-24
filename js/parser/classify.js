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

  const CRUSADE_RE = /crusade|battle\s+honour|battle\s+scar|battle\s+trait|^enhancement|psychic\s+tradition/i;
  function isCrusadeSection(name) {
    if (!name) return false;
    return CRUSADE_RE.test(name);
  }

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  const WEAPON_TYPES = new Set(['weapon', 'ranged weapons', 'melee weapons', 'ranged', 'melee']);
  const UNIT_TYPES   = new Set(['unit', 'model']);

  function classifyProfile(profile) {
    const typeName = getAttr(profile, 'typeName', '').toLowerCase();
    if (UNIT_TYPES.has(typeName))    return 'stats';
    if (WEAPON_TYPES.has(typeName))  return 'weapon';

    if (profile.querySelector('characteristic[name="Description"]')) return 'ability';

    if (typeName.includes('abilit') || typeName === 'leader' ||
        typeName.includes('power') || typeName.includes('trait') ||
        typeName === 'invulnerable save') return 'ability';

    return 'other';
  }

  P._internal.cleanText        = cleanText;
  P._internal.CRUSADE_RE       = CRUSADE_RE;
  P._internal.isCrusadeSection = isCrusadeSection;
  P._internal.getAttr          = getAttr;
  P._internal.classifyProfile  = classifyProfile;
})();
