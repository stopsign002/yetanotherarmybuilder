/**
 * parser.js - Wahapedia/Battlescribe XML parser
 * Parses .cat and .xml files from Wahapedia data exports
 */

window.WahapediaParser = (() => {
  function getText(el, tagName) {
    const found = el.querySelector(tagName);
    return found ? found.textContent.trim() : '';
  }

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  function parseCharacteristics(profileEl) {
    const stats = {};
    profileEl.querySelectorAll('characteristic').forEach(c => {
      const name = getAttr(c, 'name').toUpperCase().replace(/\s+/g, '_');
      stats[name] = c.textContent.trim();
    });
    return stats;
  }

  function parseProfiles(entryEl) {
    const unitProfile = {};
    const weapons = [];
    const abilities = [];
    const otherProfiles = [];

    entryEl.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      const typeName = getAttr(profile, 'typeName', '').toLowerCase();
      const name = getAttr(profile, 'name');
      const chars = parseCharacteristics(profile);

      if (typeName === 'unit' || typeName === 'model') {
        Object.assign(unitProfile, chars);
        unitProfile._name = name;
      } else if (typeName.includes('weapon') || typeName.includes('ranged') || typeName.includes('melee')) {
        weapons.push({ name, type: typeName, ...chars });
      } else if (typeName.includes('abilit') || typeName.includes('psych') || typeName.includes('stratagem')) {
        const descEl = profile.querySelector('characteristic[name="Description"], characteristic[name="Effect"], characteristic[name="Ability"]');
        abilities.push({ name, description: descEl ? descEl.textContent.trim() : '' });
      } else {
        otherProfiles.push({ name, type: typeName, ...chars });
      }
    });

    return { unitProfile, weapons, abilities, otherProfiles };
  }

  function parseKeywords(entryEl) {
    const keywords = [];
    entryEl.querySelectorAll(':scope > categoryLinks > categoryLink').forEach(link => {
      const name = getAttr(link, 'name');
      if (name) keywords.push(name);
    });
    return keywords;
  }

  function parseCosts(entryEl) {
    let points = 0;
    entryEl.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = getAttr(cost, 'name', '').toLowerCase();
      if (name === 'pts' || name === 'points' || name === 'cp') {
        const val = parseFloat(getAttr(cost, 'value', '0'));
        if (!isNaN(val) && val > 0) points = val;
      }
    });
    return points;
  }

  function parseEntry(entryEl) {
    const id = getAttr(entryEl, 'id') || Math.random().toString(36).substr(2, 9);
    const name = getAttr(entryEl, 'name', 'Unknown Unit');
    const type = getAttr(entryEl, 'type', '');
    const hidden = getAttr(entryEl, 'hidden', 'false') === 'true';

    if (hidden) return null;

    const { unitProfile, weapons, abilities, otherProfiles } = parseProfiles(entryEl);
    const keywords = parseKeywords(entryEl);
    const points = parseCosts(entryEl);

    // Try to get description from infoLinks or description elements
    let description = '';
    const descEl = entryEl.querySelector(':scope > description');
    if (descEl) description = descEl.textContent.trim();

    return {
      id,
      name,
      type,
      stats: unitProfile,
      weapons,
      abilities,
      otherProfiles,
      keywords,
      points,
      description
    };
  }

  function parse(xmlString, filename) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'application/xml');

      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error('XML parse error: ' + parseError.textContent.substring(0, 200));
      }

      // Get root element - could be catalogue, gameSystem, roster, etc.
      const root = doc.documentElement;
      const factionName = getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml|json)$/i, '').replace(/[-_]/g, ' ');

      const units = [];
      const seenIds = new Set();

      // Parse top-level selectionEntries
      const selectionEntries = root.querySelectorAll(
        ':scope > selectionEntries > selectionEntry, ' +
        ':scope > sharedSelectionEntries > selectionEntry'
      );

      selectionEntries.forEach(entry => {
        const type = getAttr(entry, 'type', '');
        // Include units, models, and upgrades that represent playable entries
        if (type === 'unit' || type === 'model' || type === 'upgrade') {
          const unit = parseEntry(entry);
          if (unit && !seenIds.has(unit.id)) {
            seenIds.add(unit.id);
            units.push(unit);
          }
        }
      });

      // Also parse entryLinks that reference units
      const entryLinks = root.querySelectorAll(':scope > entryLinks > entryLink');
      entryLinks.forEach(link => {
        const name = getAttr(link, 'name');
        const id = getAttr(link, 'id') || getAttr(link, 'targetId');
        const type = getAttr(link, 'type', '');
        if (name && (type === 'unit' || type === 'model') && !seenIds.has(id)) {
          seenIds.add(id);
          // Parse costs/keywords from the link itself
          const points = parseCosts(link);
          const keywords = parseKeywords(link);
          units.push({
            id,
            name,
            type,
            stats: {},
            weapons: [],
            abilities: [],
            otherProfiles: [],
            keywords,
            points,
            description: ''
          });
        }
      });

      return {
        factionName,
        filename,
        unitCount: units.length,
        units
      };
    } catch (err) {
      console.error('Parser error:', err);
      throw err;
    }
  }

  return { parse };
})();
