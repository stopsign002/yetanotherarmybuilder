/**
 * parser.js - BSData/wh40k Battlescribe XML parser (10th edition)
 *
 * Key structural facts (confirmed from live files):
 *   - Weapons are in sharedSelectionEntries at catalogue root, referenced
 *     from units via <entryLinks><entryLink targetId="..."> — NOT inline.
 *   - Unit stats (typeName="Unit") live on nested model selectionEntries,
 *     sometimes inside selectionEntryGroups > selectionEntries.
 *   - Legends units have "[Legends]" in their name.
 *   - Profile typeName values: "Unit", "Ranged Weapons", "Melee Weapons", "Abilities"
 */

window.WahapediaParser = (() => {

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  function parseCharacteristics(profileEl) {
    const chars = {};
    profileEl.querySelectorAll('characteristic').forEach(c => {
      const key = getAttr(c, 'name').toUpperCase().replace(/\s+/g, '_');
      chars[key] = c.textContent.trim();
    });
    return chars;
  }

  // ── Build shared-entry index (id → element) ───────────────────────────────
  // Weapons and other shared entries live here; units reference them by targetId.
  function buildIndex(root) {
    const index = new Map();
    root.querySelectorAll(
      ':scope > sharedSelectionEntries > selectionEntry, ' +
      ':scope > sharedSelectionEntryGroups > selectionEntryGroup'
    ).forEach(el => {
      const id = el.getAttribute('id');
      if (id) index.set(id, el);
    });
    return index;
  }

  // ── Parse profiles directly on one element ────────────────────────────────
  function parseDirectProfiles(el) {
    const stats     = {};
    const weapons   = [];
    const abilities = [];

    el.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      const typeName = getAttr(profile, 'typeName', '').toLowerCase();
      const name     = getAttr(profile, 'name');
      const chars    = parseCharacteristics(profile);

      if (typeName === 'unit' || typeName === 'model') {
        Object.assign(stats, chars);
      } else if (typeName.includes('ranged') || typeName.includes('melee') || typeName.includes('weapon')) {
        weapons.push({ name, type: typeName, ...chars });
      } else if (typeName.includes('abilit') || typeName.includes('psych') || typeName === 'abilities') {
        const descEl = profile.querySelector('characteristic[name="Description"]');
        if (name) abilities.push({ name, description: descEl ? descEl.textContent.trim() : '' });
      }
    });

    return { stats, weapons, abilities };
  }

  // ── Collect all weapon profiles within a subtree, following entryLinks ─────
  function collectWeapons(el, index, depth = 0, visited = new Set()) {
    if (depth > 6) return [];
    const id = el.getAttribute('id');
    if (id && visited.has(id)) return [];   // guard against cycles
    if (id) visited.add(id);

    const weapons = [];

    // Direct profiles on this element
    weapons.push(...parseDirectProfiles(el).weapons);

    // Inline selectionEntries
    el.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      if (child.getAttribute('hidden') === 'true') return;
      weapons.push(...collectWeapons(child, index, depth + 1, visited));
    });

    // entryLinks → look up targets in sharedSelectionEntries
    el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      if (link.getAttribute('hidden') === 'true') return;
      const targetId = link.getAttribute('targetId');
      const target   = targetId && index.get(targetId);
      if (target) weapons.push(...collectWeapons(target, index, depth + 1, new Set(visited)));
    });

    // selectionEntryGroups (inline groups containing more weapon options)
    el.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      weapons.push(...collectWeapons(group, index, depth + 1, visited));
    });

    return weapons;
  }

  // ── Find unit stat profile anywhere in the subtree (breadth-friendly) ─────
  // Stats can be on direct profiles OR on nested model selectionEntries (common in 10e)
  function findUnitStats(entryEl) {
    // 1. Direct profiles first
    const { stats } = parseDirectProfiles(entryEl);
    if (Object.keys(stats).length > 0) return stats;

    // 2. Model children in direct selectionEntries
    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const { stats: s } = parseDirectProfiles(child);
      if (Object.keys(s).length > 0) return s;
    }

    // 3. Model children nested one level deeper in selectionEntryGroups
    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const { stats: s } = parseDirectProfiles(child);
      if (Object.keys(s).length > 0) return s;
    }

    return {};
  }

  // ── Find abilities in the entry's direct profiles ─────────────────────────
  function findAbilities(entryEl) {
    return parseDirectProfiles(entryEl).abilities;
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

  function isLegends(entry) {
    return entry.getAttribute('name').includes('[Legends]');
  }

  function dedup(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
      const k = item[key];
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ── Parse a single unit-level selectionEntry ──────────────────────────────
  function parseEntry(entryEl, index) {
    if (getAttr(entryEl, 'hidden', 'false') === 'true') return null;
    if (isLegends(entryEl)) return null;

    const id   = getAttr(entryEl, 'id') || Math.random().toString(36).slice(2, 9);
    const name = getAttr(entryEl, 'name', 'Unknown Unit');
    const type = getAttr(entryEl, 'type', '');

    const stats     = findUnitStats(entryEl);
    const abilities = findAbilities(entryEl);
    const weapons   = dedup(collectWeapons(entryEl, index), 'name');
    const keywords  = parseKeywords(entryEl);
    const points    = parseCosts(entryEl);
    const descEl    = entryEl.querySelector(':scope > description');

    return {
      id, name, type,
      stats,
      weapons,
      abilities,
      keywords,
      points,
      description: descEl ? descEl.textContent.trim() : ''
    };
  }

  // ── Main parse function ───────────────────────────────────────────────────
  function parse(xmlString, filename) {
    try {
      const domParser = new DOMParser();
      const doc = domParser.parseFromString(xmlString, 'application/xml');

      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error('XML parse error: ' + parseError.textContent.slice(0, 200));
      }

      const root        = doc.documentElement;
      const factionName = getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml)$/i, '').replace(/[-_]/g, ' ');

      const index   = buildIndex(root);
      const units   = [];
      const seenIds = new Set();

      // Only type="unit" and type="model" at the top level are army units.
      // type="upgrade" entries are weapons/wargear — excluded deliberately.
      root.querySelectorAll(
        ':scope > selectionEntries > selectionEntry, ' +
        ':scope > sharedSelectionEntries > selectionEntry'
      ).forEach(entry => {
        const t = getAttr(entry, 'type', '');
        if (t !== 'unit' && t !== 'model') return;

        const unit = parseEntry(entry, index);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      return { factionName, filename, unitCount: units.length, units };

    } catch (err) {
      console.error('[Parser] Error:', err);
      throw err;
    }
  }

  return { parse };
})();
