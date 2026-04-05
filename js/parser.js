/**
 * parser.js - Wahapedia/Battlescribe XML parser
 *
 * BSData/wh40k structure (10th edition):
 *   selectionEntry[type="unit"]
 *     profiles > profile[typeName="Unit"]       ← stats (sometimes)
 *     selectionEntries
 *       selectionEntry[type="model"]
 *         profiles > profile[typeName="Unit"]   ← stats (usually here)
 *         selectionEntries
 *           selectionEntry[type="upgrade"]
 *             profiles > profile[typeName="Ranged Weapons"|"Melee Weapons"]
 *       selectionEntry[type="upgrade"]          ← also direct weapon options
 *         profiles > profile[typeName="Ranged Weapons"|...]
 */

window.WahapediaParser = (() => {

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  function parseCharacteristics(profileEl) {
    const stats = {};
    profileEl.querySelectorAll('characteristic').forEach(c => {
      const key = getAttr(c, 'name').toUpperCase().replace(/\s+/g, '_');
      stats[key] = c.textContent.trim();
    });
    return stats;
  }

  // ── Parse profiles directly on one element (no recursion) ───────────────
  function parseDirectProfiles(entryEl) {
    const unitProfile = {};
    const weapons     = [];
    const abilities   = [];

    entryEl.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      const typeName = getAttr(profile, 'typeName', '').toLowerCase();
      const name     = getAttr(profile, 'name');
      const chars    = parseCharacteristics(profile);

      if (typeName === 'unit' || typeName === 'model') {
        Object.assign(unitProfile, chars);
      } else if (
        typeName.includes('weapon') ||
        typeName.includes('ranged') ||
        typeName.includes('melee')
      ) {
        weapons.push({ name, type: typeName, ...chars });
      } else if (
        typeName.includes('abilit') ||
        typeName.includes('psych')  ||
        typeName.includes('stratagem')
      ) {
        const descEl = profile.querySelector(
          'characteristic[name="Description"], characteristic[name="Effect"], characteristic[name="Ability"]'
        );
        abilities.push({ name, description: descEl ? descEl.textContent.trim() : '' });
      }
    });

    return { unitProfile, weapons, abilities };
  }

  // ── Collect weapon profiles from an element and its children (2 levels) ──
  function collectWeapons(entryEl, depth = 0) {
    const weapons = [];
    const { weapons: direct } = parseDirectProfiles(entryEl);
    weapons.push(...direct);

    if (depth < 2) {
      entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
        if (getAttr(child, 'hidden', 'false') === 'true') return;
        weapons.push(...collectWeapons(child, depth + 1));
      });
      // Also check selectionEntryGroups → selectionEntries
      entryEl.querySelectorAll(
        ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry'
      ).forEach(child => {
        if (getAttr(child, 'hidden', 'false') === 'true') return;
        weapons.push(...collectWeapons(child, depth + 1));
      });
    }

    return weapons;
  }

  function parseKeywords(entryEl) {
    const kws = [];
    entryEl.querySelectorAll(':scope > categoryLinks > categoryLink').forEach(link => {
      const name = getAttr(link, 'name');
      if (name) kws.push(name);
    });
    return kws;
  }

  function parseCosts(entryEl) {
    let points = 0;
    entryEl.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = getAttr(cost, 'name', '').toLowerCase();
      if (name === 'pts' || name === 'points') {
        const val = parseFloat(getAttr(cost, 'value', '0'));
        if (!isNaN(val) && val > 0) points = val;
      }
    });
    return points;
  }

  // ── Parse a unit-level selectionEntry ────────────────────────────────────
  function parseEntry(entryEl) {
    const id     = getAttr(entryEl, 'id') || Math.random().toString(36).slice(2, 9);
    const name   = getAttr(entryEl, 'name', 'Unknown Unit');
    const type   = getAttr(entryEl, 'type', '');
    const hidden = getAttr(entryEl, 'hidden', 'false') === 'true';
    if (hidden) return null;

    // 1. Start with profiles directly on the unit entry
    const { unitProfile, weapons, abilities } = parseDirectProfiles(entryEl);

    // 2. Recurse into child model entries — they often carry the actual stats
    //    and their own nested weapon upgrades
    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      if (getAttr(child, 'hidden', 'false') === 'true') return;
      const childType = getAttr(child, 'type', '');
      const { unitProfile: childStats, weapons: childWeapons, abilities: childAbilities } =
        parseDirectProfiles(child);

      if (childType === 'model') {
        // Prefer model-level stats if we don't already have them
        if (Object.keys(unitProfile).length === 0) {
          Object.assign(unitProfile, childStats);
        }
        weapons.push(...childWeapons);
        abilities.push(...childAbilities);

        // Weapons nested inside the model (upgrade children + entry groups)
        weapons.push(...collectWeapons(child));
      } else if (childType === 'upgrade') {
        // Direct upgrade child — grab weapon profiles
        weapons.push(...childWeapons);
        weapons.push(...collectWeapons(child));
      }
    });

    // 3. Also check selectionEntryGroups directly on the unit entry
    entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry'
    ).forEach(child => {
      if (getAttr(child, 'hidden', 'false') === 'true') return;
      weapons.push(...collectWeapons(child));
    });

    // 4. Deduplicate weapons by name
    const seenW   = new Set();
    const uniqueW = weapons.filter(w => {
      if (!w.name || seenW.has(w.name)) return false;
      seenW.add(w.name);
      return true;
    });

    // 5. Deduplicate abilities by name
    const seenA   = new Set();
    const uniqueA = abilities.filter(a => {
      if (!a.name || seenA.has(a.name)) return false;
      seenA.add(a.name);
      return true;
    });

    const keywords = parseKeywords(entryEl);
    const points   = parseCosts(entryEl);
    const descEl   = entryEl.querySelector(':scope > description');

    return {
      id,
      name,
      type,
      stats:    unitProfile,
      weapons:  uniqueW,
      abilities:uniqueA,
      keywords,
      points,
      description: descEl ? descEl.textContent.trim() : ''
    };
  }

  // ── Main parse function ───────────────────────────────────────────────────
  function parse(xmlString, filename) {
    try {
      const parser = new DOMParser();
      const doc    = parser.parseFromString(xmlString, 'application/xml');

      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error('XML parse error: ' + parseError.textContent.slice(0, 200));
      }

      const root       = doc.documentElement;
      const factionName = getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml)$/i, '').replace(/[-_]/g, ' ');

      const units   = [];
      const seenIds = new Set();

      // Top-level selectionEntries — only "unit" type are real army units.
      // "upgrade" at catalogue level = weapons/wargear shared library; skip them.
      // "model" at top level = standalone model entry; include it.
      const topEntries = root.querySelectorAll(
        ':scope > selectionEntries > selectionEntry, ' +
        ':scope > sharedSelectionEntries > selectionEntry'
      );

      topEntries.forEach(entry => {
        const type = getAttr(entry, 'type', '');
        if (type !== 'unit' && type !== 'model') return; // skip upgrade/mount/etc.

        const unit = parseEntry(entry);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      return { factionName, filename, unitCount: units.length, units };

    } catch (err) {
      console.error('Parser error:', err);
      throw err;
    }
  }

  return { parse };
})();
