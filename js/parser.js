/**
 * parser.js - BSData/wh40k Battlescribe XML parser
 *
 * Confirmed structure (from live file inspection):
 *
 * TOP LEVEL (what we show as army units):
 *   catalogue > selectionEntries > selectionEntry[type="unit"|"model"]
 *
 * SHARED LIBRARY (cross-reference targets, NOT shown as top-level units):
 *   catalogue > sharedSelectionEntries > selectionEntry[type="model"|"upgrade"]
 *   catalogue > sharedProfiles > profile  ← unit stat blocks referenced via infoLink
 *
 * UNIT STATS:
 *   - Sometimes directly in the unit entry's profiles (typeName="Unit")
 *   - Often on a model child entry (selectionEntries or selectionEntryGroups > entryLinks)
 *   - Often in sharedProfiles, referenced from the model via infoLink[type="profile"]
 *   - 9th ed keys: M, WS, BS, S, T, W, A, Ld, Save
 *   - 10th ed keys: M, T, SV, W, LD, OC
 *
 * WEAPON PROFILES:
 *   - In sharedSelectionEntries entries (type="upgrade", typeName="Weapon"|"Ranged Weapons"|"Melee Weapons")
 *   - Referenced from model entries via entryLinks > entryLink[targetId]
 *   - 9th ed characteristics: Range, Type, S, AP, D, Abilities
 *   - 10th ed characteristics: Range, A, BS, S, AP, D, Keywords
 *
 * POINTS:
 *   - Unit entry often has pts=0; real cost is on model child entries
 */

window.WahapediaParser = (() => {

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  function parseCharacteristics(profileEl) {
    const chars = {};
    profileEl.querySelectorAll('characteristic').forEach(c => {
      // Keep original capitalisation — field names vary between editions
      const key = getAttr(c, 'name');
      if (key) chars[key] = c.textContent.trim();
    });
    return chars;
  }

  // ── Build lookup indexes ─────────────────────────────────────────────────

  function buildIndexes(root) {
    const entriesById  = new Map();  // sharedSelectionEntries + sharedSelectionEntryGroups
    const profilesById = new Map();  // sharedProfiles

    root.querySelectorAll(
      ':scope > sharedSelectionEntries > selectionEntry, ' +
      ':scope > sharedSelectionEntryGroups > selectionEntryGroup'
    ).forEach(el => {
      const id = el.getAttribute('id');
      if (id) entriesById.set(id, el);
    });

    root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
      const id = p.getAttribute('id');
      if (id) profilesById.set(id, p);
    });

    return { entriesById, profilesById };
  }

  // ── Profile parsing ──────────────────────────────────────────────────────

  const WEAPON_TYPES = new Set(['weapon', 'ranged weapons', 'melee weapons', 'ranged', 'melee']);
  const UNIT_TYPES   = new Set(['unit', 'model']);

  function classifyProfile(profile) {
    const typeName = getAttr(profile, 'typeName', '').toLowerCase();
    if (UNIT_TYPES.has(typeName))   return 'stats';
    if (WEAPON_TYPES.has(typeName)) return 'weapon';
    if (typeName.includes('abilit') || typeName === 'abilities') return 'ability';
    return 'other';
  }

  function parseDirectProfiles(el) {
    const stats     = {};
    const weapons   = [];
    const abilities = [];

    el.querySelectorAll(':scope > profiles > profile').forEach(profile => {
      const kind = classifyProfile(profile);
      const name = getAttr(profile, 'name');
      const chars = parseCharacteristics(profile);

      if (kind === 'stats') {
        Object.assign(stats, chars);
      } else if (kind === 'weapon') {
        if (name) weapons.push({ name, _typeName: getAttr(profile, 'typeName', ''), ...chars });
      } else if (kind === 'ability') {
        const descEl = profile.querySelector('characteristic[name="Description"]');
        if (name) abilities.push({ name, description: descEl ? descEl.textContent.trim() : '' });
      }
    });

    return { stats, weapons, abilities };
  }

  // ── Stat resolution ──────────────────────────────────────────────────────

  // Resolve infoLinks[type="profile"] on an element to find stat profiles
  function statsFromInfoLinks(el, profilesById) {
    const stats = {};
    el.querySelectorAll(':scope > infoLinks > infoLink').forEach(link => {
      if (getAttr(link, 'type') !== 'profile') return;
      const profile = profilesById.get(getAttr(link, 'targetId'));
      if (!profile) return;
      if (classifyProfile(profile) === 'stats') {
        Object.assign(stats, parseCharacteristics(profile));
      }
    });
    return stats;
  }

  // Find unit stat block for an entry — checks several locations in priority order
  function findStats(entryEl, entriesById, profilesById, depth = 0) {
    if (depth > 4) return {};

    // 1. Direct profiles on this element
    const direct = parseDirectProfiles(entryEl).stats;
    if (Object.keys(direct).length > 0) return direct;

    // 2. infoLinks → sharedProfiles (common for 9th ed units)
    const linked = statsFromInfoLinks(entryEl, profilesById);
    if (Object.keys(linked).length > 0) return linked;

    // 3. Direct selectionEntry[type=model|unit] children
    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const s = findStats(child, entriesById, profilesById, depth + 1);
      if (Object.keys(s).length > 0) return s;
    }

    // 4. entryLinks in selectionEntryGroups → sharedSelectionEntries (e.g. Necron Warriors)
    for (const link of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    )) {
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (target) {
        const s = findStats(target, entriesById, profilesById, depth + 1);
        if (Object.keys(s).length > 0) return s;
      }
    }

    return {};
  }

  // ── Weapon collection ────────────────────────────────────────────────────

  function collectWeapons(el, entriesById, depth = 0, visited = new Set()) {
    if (depth > 6) return [];
    const id = el.getAttribute('id');
    if (id) {
      if (visited.has(id)) return [];
      visited.add(id);
    }

    const weapons = [];
    weapons.push(...parseDirectProfiles(el).weapons);

    // Inline child selectionEntries — include hidden entries (default/non-optional weapons)
    el.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      weapons.push(...collectWeapons(child, entriesById, depth + 1, visited));
    });

    // entryLinks → resolve from shared index — include hidden links (default weapons)
    el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (target) weapons.push(...collectWeapons(target, entriesById, depth + 1, new Set(visited)));
    });

    // selectionEntryGroups (inline)
    el.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      weapons.push(...collectWeapons(group, entriesById, depth + 1, visited));
    });

    return weapons;
  }

  // ── Cost resolution ──────────────────────────────────────────────────────

  function readCost(el) {
    let pts = 0;
    el.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = getAttr(cost, 'name', '').toLowerCase().trim();
      if (name === 'pts' || name === 'points') {
        const val = parseFloat(getAttr(cost, 'value', '0'));
        if (!isNaN(val) && val > 0) pts = Math.max(pts, val);
      }
    });
    return pts;
  }

  /**
   * Returns { points, pointsOptions, squadOptions } for a unit entry.
   * squadOptions: [{ pts, models }] — models is the model count for that cost tier (or null).
   * In 10th ed BSData, pts=90 is directly on the unit entry; modifier elements encode
   * alternative totals (e.g. pts=200 for ≥11 models). Constraints on the first
   * selectionEntryGroup give the min (base squad) and max (full squad) model counts.
   */
  function findCosts(entryEl, entriesById) {
    // 1. Direct cost + typeId on the unit entry (10th ed standard location)
    let basePts = 0;
    let ptsTypeId = null;
    entryEl.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = getAttr(cost, 'name', '').toLowerCase().trim();
      if (name === 'pts' || name === 'points') {
        basePts = parseFloat(getAttr(cost, 'value', '0')) || 0;
        ptsTypeId = getAttr(cost, 'typeId') || null;
      }
    });

    // 2. Model count from first selectionEntryGroup constraints (min=base, max=full)
    let minModels = null, maxModels = null;
    const firstGroup = entryEl.querySelector(':scope > selectionEntryGroups > selectionEntryGroup');
    if (firstGroup) {
      firstGroup.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        const val = Math.round(parseFloat(getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (getAttr(c, 'type') === 'min') minModels = val;
          if (getAttr(c, 'type') === 'max') maxModels = val;
        }
      });
    }

    const squadOptions = [];
    if (basePts > 0) squadOptions.push({ pts: basePts, models: minModels });

    // 3. Modifier elements for alternative squad-size costs
    if (ptsTypeId) {
      entryEl.querySelectorAll(':scope > modifiers > modifier').forEach(mod => {
        if (getAttr(mod, 'type') === 'set' && getAttr(mod, 'field') === ptsTypeId) {
          const val = parseFloat(getAttr(mod, 'value', '0'));
          if (!isNaN(val) && val > 0 && val !== basePts) {
            squadOptions.push({ pts: val, models: maxModels });
          }
        }
      });
    }

    if (squadOptions.length > 0) {
      squadOptions.sort((a, b) => a.pts - b.pts);
      return {
        points: squadOptions[0].pts,
        pointsOptions: squadOptions.map(o => o.pts),
        squadOptions,
      };
    }

    // 4. Fallback: entryLink targets in selectionEntryGroups (older patterns)
    for (const link of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    )) {
      const lc = readCost(link);
      if (lc > 0) return { points: lc, pointsOptions: [lc], squadOptions: [{ pts: lc, models: null }] };
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (target) {
        const tc = readCost(target);
        if (tc > 0) return { points: tc, pointsOptions: [tc], squadOptions: [{ pts: tc, models: null }] };
      }
    }

    return { points: 0, pointsOptions: [], squadOptions: [] };
  }

  // ── Keyword / category collection ────────────────────────────────────────

  function parseKeywords(entryEl) {
    const kws = [];
    entryEl.querySelectorAll(':scope > categoryLinks > categoryLink').forEach(link => {
      const name = getAttr(link, 'name', '').trim();
      // Skip empty names and BattleScribe editor default placeholder names
      if (!name || /^new\s+category/i.test(name)) return;
      kws.push(name);
    });
    return kws;
  }

  // ── Dedup helper ─────────────────────────────────────────────────────────

  function dedup(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
      const k = item[key];
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ── Parse one army unit entry ─────────────────────────────────────────────

  function parseEntry(entryEl, entriesById, profilesById) {
    if (getAttr(entryEl, 'hidden', 'false') === 'true') return null;

    const name = getAttr(entryEl, 'name', 'Unknown Unit');
    if (name.includes('[Legends]')) return null;

    const id   = getAttr(entryEl, 'id') || Math.random().toString(36).slice(2, 9);
    const type = getAttr(entryEl, 'type', '');

    const stats    = findStats(entryEl, entriesById, profilesById);
    const weapons  = dedup(collectWeapons(entryEl, entriesById), 'name');
    const abilities= dedup(parseDirectProfiles(entryEl).abilities, 'name');
    const keywords = parseKeywords(entryEl);
    const { points, pointsOptions, squadOptions } = findCosts(entryEl, entriesById);
    const descEl   = entryEl.querySelector(':scope > description');

    return {
      id, name, type,
      stats,
      weapons,
      abilities,
      keywords,
      points,
      pointsOptions,
      squadOptions,
      description: descEl ? descEl.textContent.trim() : ''
    };
  }

  // ── Main parse function ───────────────────────────────────────────────────

  function parse(xmlString, filename) {
    try {
      const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error('XML parse error: ' + parseError.textContent.slice(0, 200));
      }

      const root        = doc.documentElement;
      const factionName = getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml)$/i, '').replace(/[-_]/g, ' ');

      const { entriesById, profilesById } = buildIndexes(root);

      const units   = [];
      const seenIds = new Set();

      // Pattern A: units defined directly in selectionEntries (Space Marines style)
      root.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
        const t = getAttr(entry, 'type', '');
        if (t !== 'unit' && t !== 'model') return;
        const unit = parseEntry(entry, entriesById, profilesById);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Pattern B: units defined in sharedSelectionEntries, made selectable via
      // root-level entryLinks (Necrons style — selectionEntries is empty or absent,
      // all unit definitions sit in sharedSelectionEntries).
      // We only follow root entryLinks (NOT entryLinks inside unit entries, which
      // reference model variants / weapons and must not appear as top-level units).
      root.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (getAttr(link, 'hidden', 'false') === 'true') return;
        const targetId = getAttr(link, 'targetId');
        if (seenIds.has(targetId)) return;           // already added via Pattern A
        const target = entriesById.get(targetId);
        if (!target) return;
        const t = getAttr(target, 'type', '');
        if (t !== 'unit' && t !== 'model') return;  // skip weapon/upgrade links
        const unit = parseEntry(target, entriesById, profilesById);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Extract faction-level abilities / rules from sharedProfiles
      const factionAbilities = [];
      root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
        const typeName = getAttr(p, 'typeName', '').toLowerCase();
        if (!typeName.includes('abilit') && !typeName.includes('rule')) return;
        const name = getAttr(p, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        const descEl = p.querySelector('characteristic[name="Description"]');
        factionAbilities.push({
          name,
          description: descEl ? descEl.textContent.trim() : ''
        });
      });

      return { factionName, filename, unitCount: units.length, units, factionAbilities };

    } catch (err) {
      console.error('[Parser] Error in', filename, err);
      throw err;
    }
  }

  return { parse };
})();
