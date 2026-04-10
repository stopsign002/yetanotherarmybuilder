/**
 * parser.js - BSData/wh40k-10e Battlescribe XML parser
 *
 * Cross-file resolution:
 *   Call WahapediaParser.addToSharedIndex(xmlString) with the game system .gst
 *   file before parsing catalogue files.  Shared profiles and rules are merged
 *   into every subsequent buildIndexes() call as a fallback lookup.
 */

window.WahapediaParser = (() => {

  // Strip BSData wiki-style markup from text (e.g. **bold**, ^^superscript^^, __underline__)
  function cleanText(str) {
    if (!str) return '';
    return str
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\^\^([^^]*)\^\^/g, '$1')
      .replace(/__([^_]*)__/g, '$1')
      .replace(/~~([^~]*)~~/g, '$1')
      .trim();
  }

  // ── Shared cross-file index (populated from .gst file) ───────────────────
  // DOM elements from the game system file are kept in memory; they cannot be
  // serialised to sessionStorage, so this is rebuilt each page load.
  const _sharedProfilesById = new Map();
  const _sharedRulesById    = new Map();
  const _sharedEntriesById  = new Map();

  /**
   * Parse a game-system or library XML string and add its shared definitions
   * to the cross-file index.  Call once before loading catalogues.
   */
  function addToSharedIndex(xmlString) {
    try {
      const doc  = new DOMParser().parseFromString(xmlString, 'application/xml');
      if (doc.querySelector('parsererror')) return;
      const root = doc.documentElement;

      root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
        const id = p.getAttribute('id');
        if (id) _sharedProfilesById.set(id, p);
      });
      root.querySelectorAll(':scope > sharedRules > rule, :scope > rules > rule').forEach(r => {
        const id = r.getAttribute('id');
        if (id) _sharedRulesById.set(id, r);
      });
      root.querySelectorAll(
        ':scope > sharedSelectionEntries > selectionEntry, ' +
        ':scope > sharedSelectionEntryGroups > selectionEntryGroup'
      ).forEach(el => {
        const id = el.getAttribute('id');
        if (id) _sharedEntriesById.set(id, el);
      });
    } catch (_) { /* ignore parse failures for the game system */ }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getAttr(el, attr, fallback = '') {
    return el.getAttribute(attr) || fallback;
  }

  function parseCharacteristics(profileEl) {
    const chars = {};
    profileEl.querySelectorAll('characteristic').forEach(c => {
      const key = getAttr(c, 'name');
      if (key) chars[key] = cleanText(c.textContent);
    });
    return chars;
  }

  // ── Build lookup indexes ──────────────────────────────────────────────────

  function buildIndexes(root) {
    // Start from shared (game-system) definitions; local catalogue overrides
    const entriesById  = new Map(_sharedEntriesById);
    const profilesById = new Map(_sharedProfilesById);
    const rulesById    = new Map(_sharedRulesById);

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

    root.querySelectorAll(':scope > sharedRules > rule, :scope > rules > rule').forEach(r => {
      const id = r.getAttribute('id');
      if (id) rulesById.set(id, r);
    });

    return { entriesById, profilesById, rulesById };
  }

  // ── Profile classification ────────────────────────────────────────────────

  const WEAPON_TYPES = new Set(['weapon', 'ranged weapons', 'melee weapons', 'ranged', 'melee']);
  const UNIT_TYPES   = new Set(['unit', 'model']);

  function classifyProfile(profile) {
    const typeName = getAttr(profile, 'typeName', '').toLowerCase();
    if (UNIT_TYPES.has(typeName))    return 'stats';
    if (WEAPON_TYPES.has(typeName))  return 'weapon';
    if (typeName === 'stratagems')   return 'stratagem'; // handled separately in parse()

    // Any remaining profile with a Description characteristic is an ability
    if (profile.querySelector('characteristic[name="Description"]')) return 'ability';

    // Fallback keyword match for profiles that lack a Description
    if (typeName.includes('abilit') || typeName === 'leader' ||
        typeName.includes('power') || typeName.includes('trait') ||
        typeName === 'invulnerable save') return 'ability';

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
        if (name) abilities.push({ name, description: descEl ? cleanText(descEl.textContent) : '' });
      }
    });

    return { stats, weapons, abilities };
  }

  // ── Stat resolution ───────────────────────────────────────────────────────

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

  function findStats(entryEl, entriesById, profilesById, depth = 0) {
    if (depth > 4) return {};

    const direct = parseDirectProfiles(entryEl).stats;
    if (Object.keys(direct).length > 0) return direct;

    const linked = statsFromInfoLinks(entryEl, profilesById);
    if (Object.keys(linked).length > 0) return linked;

    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const s = findStats(child, entriesById, profilesById, depth + 1);
      if (Object.keys(s).length > 0) return s;
    }

    for (const child of entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="model"], ' +
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="unit"]'
    )) {
      const s = findStats(child, entriesById, profilesById, depth + 1);
      if (Object.keys(s).length > 0) return s;
    }

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

  // ── Weapon collection ─────────────────────────────────────────────────────

  function collectWeapons(el, entriesById, depth = 0, visited = new Set()) {
    if (depth > 6) return [];
    const id = el.getAttribute('id');
    if (id) {
      if (visited.has(id)) return [];
      visited.add(id);
    }

    const weapons = [];
    weapons.push(...parseDirectProfiles(el).weapons);

    el.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(child => {
      weapons.push(...collectWeapons(child, entriesById, depth + 1, visited));
    });

    el.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (target) weapons.push(...collectWeapons(target, entriesById, depth + 1, new Set(visited)));
    });

    el.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      weapons.push(...collectWeapons(group, entriesById, depth + 1, visited));
    });

    return weapons;
  }

  // ── Ability collection ────────────────────────────────────────────────────

  /**
   * Collects abilities for a unit entry following both profile and rule infoLinks,
   * including from child model entries.
   */
  function collectAbilities(entryEl, entriesById, profilesById, rulesById, depth = 0, visited = new Set()) {
    if (depth > 3) return [];
    const id = entryEl.getAttribute('id');
    if (id) {
      if (visited.has(id)) return [];
      visited.add(id);
    }

    const abilities = [];

    // 1. Direct profiles
    parseDirectProfiles(entryEl).abilities.forEach(a => abilities.push(a));

    // 2. infoLinks → sharedProfiles (profile type)
    entryEl.querySelectorAll(':scope > infoLinks > infoLink').forEach(link => {
      const linkType = getAttr(link, 'type');
      const targetId = getAttr(link, 'targetId');

      if (linkType === 'profile') {
        const profile = profilesById.get(targetId);
        if (!profile || classifyProfile(profile) !== 'ability') return;
        const name = getAttr(profile, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        const descEl = profile.querySelector('characteristic[name="Description"]');
        abilities.push({ name, description: descEl ? cleanText(descEl.textContent) : '' });

      } else if (linkType === 'rule') {
        // Core abilities (e.g. Deep Strike, Deadly Demise) stored as rules
        const rule = rulesById.get(targetId);
        if (!rule) return;
        let name = getAttr(rule, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        // Apply name-appending modifiers from the infoLink itself (e.g. dice count on Deadly Demise)
        link.querySelectorAll(':scope > modifiers > modifier[field="name"]').forEach(mod => {
          if (getAttr(mod, 'type', '') === 'append') {
            const val = getAttr(mod, 'value', '').trim();
            if (val) name = name + ' ' + val;
          }
        });
        const descEl = rule.querySelector(':scope > description');
        abilities.push({ name, description: descEl ? cleanText(descEl.textContent) : '', isCore: true });
      }
    });

    // 3. Recurse into direct child model entries
    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(child => {
      collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    // 4. Recurse into model entries inside selectionEntryGroups
    entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > selectionEntries > selectionEntry[type="model"]'
    ).forEach(child => {
      collectAbilities(child, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    // 5. entryLinks → shared entries (e.g. Necrons pattern)
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink').forEach(link => {
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (!target) return;
      collectAbilities(target, entriesById, profilesById, rulesById, depth + 1, new Set(visited))
        .forEach(a => abilities.push(a));
    });

    return abilities;
  }

  // ── Wargear options collection ────────────────────────────────────────────

  /**
   * Collects wargear options for display.
   * Returns two types of entries:
   *   { type:'model', modelName, modelMax, subOptions:[{name, choices}] }
   *     — a model variant within the squad that carries specific weapon options
   *   { type:'choice', name, choices:[{name}], max }
   *     — a direct equipment-choice group at the unit level
   */
  function collectWargearOptions(entryEl, entriesById) {
    const options = [];
    const seenIds = new Set();

    function getChoices(group) {
      const choices = [];
      group.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
        if (getAttr(entry, 'hidden', 'false') === 'true') return;
        const t = getAttr(entry, 'type', '');
        if (t === 'model' || t === 'unit') return;
        const name = getAttr(entry, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        choices.push({ name });
      });
      group.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (getAttr(link, 'hidden', 'false') === 'true') return;
        const name = getAttr(link, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        choices.push({ name });
      });
      return choices;
    }

    function getMaxConstraint(el) {
      let maxVal = null;
      el.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        if (getAttr(c, 'type') === 'max') {
          const v = Math.round(parseFloat(getAttr(c, 'value', '0')));
          if (!isNaN(v) && v > 0) maxVal = v;
        }
      });
      return maxVal;
    }

    // ── Category B: direct equipment-choice groups at unit level ─────────────
    function processDirectGroup(group) {
      if (getAttr(group, 'hidden', 'false') === 'true') return;
      const groupId = group.getAttribute('id');
      if (groupId && seenIds.has(groupId)) return;

      const groupName = getAttr(group, 'name', '').trim();
      if (!groupName || /^new\s/i.test(groupName)) return;

      // Skip squad-size selectors: have model/unit children AND size constraints
      const hasModelOrUnit = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"]') ||
                             group.querySelector(':scope > selectionEntries > selectionEntry[type="unit"]');
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      if (hasModelOrUnit && hasSizeConstraint) return;
      if (groupId) seenIds.add(groupId);

      const choices = getChoices(group);
      if (choices.length === 0) return;
      options.push({ type: 'choice', name: groupName, choices, max: getMaxConstraint(group) });
    }

    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      processDirectGroup(group);
    });

    // Extract the minimum squad size from a squad-size group's constraints
    function getGroupMin(group) {
      let minVal = null;
      group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        if (getAttr(c, 'type') === 'min') {
          const v = Math.round(parseFloat(getAttr(c, 'value', '0')));
          if (!isNaN(v) && v > 0) minVal = v;
        }
      });
      return minVal;
    }

    // ── Category A: model variants inside squad groups ────────────────────────
    function processModelEntry(modelEl, squadGroupMin) {
      const modelId = modelEl.getAttribute('id');
      if (modelId && seenIds.has(modelId)) return;

      const modelName = getAttr(modelEl, 'name', '').trim();
      if (!modelName || /^new\s/i.test(modelName)) return;

      const subOptions = [];
      modelEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
        if (getAttr(group, 'hidden', 'false') === 'true') return;
        const gName = getAttr(group, 'name', '').trim();
        if (!gName || /^new\s/i.test(gName)) return;
        const choices = getChoices(group);
        if (choices.length === 0) return;
        subOptions.push({ name: gName, choices });
      });

      if (subOptions.length === 0) return;
      if (modelId) seenIds.add(modelId);

      const modelMax = getMaxConstraint(modelEl);
      // Compute "1 per N models" ratio from squad group minimum
      let perModels = null;
      if (modelMax && squadGroupMin && squadGroupMin > modelMax) {
        perModels = Math.round(squadGroupMin / modelMax);
      }
      options.push({ type: 'model', modelName, modelMax, perModels, subOptions });
    }

    // Walk squad-size groups to find model variants
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      const hasModelOrUnit = group.querySelector(':scope > selectionEntries > selectionEntry[type="model"]') ||
                             group.querySelector(':scope > selectionEntries > selectionEntry[type="unit"]');
      const hasSizeConstraint = group.querySelector(':scope > constraints > constraint[type="min"], :scope > constraints > constraint[type="max"]');
      if (!hasModelOrUnit || !hasSizeConstraint) return;
      const groupMin = getGroupMin(group);
      // This is a squad-size group — collect model variants within it
      group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"], ' +
                             ':scope > selectionEntries > selectionEntry[type="unit"]').forEach(modelEl => {
        processModelEntry(modelEl, groupMin);
      });
    });

    // Also handle inline ungrouped model entries
    entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(processModelEntry);

    // EntryLink-referenced entries
    entryEl.querySelectorAll(
      ':scope > selectionEntryGroups > selectionEntryGroup > entryLinks > entryLink'
    ).forEach(link => {
      const target = entriesById.get(getAttr(link, 'targetId'));
      if (!target) return;
      processModelEntry(target);
    });

    return options;
  }

  // ── Cost resolution ───────────────────────────────────────────────────────

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
   * Pattern A OR Pattern B per group — not both — to avoid double-counting.
   * Pattern A: constraints directly on the selectionEntryGroup.
   * Pattern B: sum child model selectionEntry constraints (used only if Pattern A finds nothing).
   */
  function findCosts(entryEl, entriesById) {
    let basePts = 0;
    let ptsTypeId = null;
    entryEl.querySelectorAll(':scope > costs > cost').forEach(cost => {
      const name = getAttr(cost, 'name', '').toLowerCase().trim();
      if (name === 'pts' || name === 'points') {
        basePts = parseFloat(getAttr(cost, 'value', '0')) || 0;
        ptsTypeId = getAttr(cost, 'typeId') || null;
      }
    });

    let minModels = null, maxModels = null;
    entryEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(group => {
      let groupMin = null, groupMax = null;

      // Pattern A
      group.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        const val = Math.round(parseFloat(getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (getAttr(c, 'type') === 'min') groupMin = val;
          if (getAttr(c, 'type') === 'max') groupMax = val;
        }
      });

      // Pattern B (only if Pattern A found nothing for this group)
      if (groupMin === null && groupMax === null) {
        group.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(model => {
          let mMin = null, mMax = null;
          model.querySelectorAll(':scope > constraints > constraint').forEach(c => {
            const val = Math.round(parseFloat(getAttr(c, 'value', '0')));
            if (!isNaN(val) && val > 0) {
              if (getAttr(c, 'type') === 'min') mMin = val;
              if (getAttr(c, 'type') === 'max') mMax = val;
            }
          });
          if (mMin !== null) groupMin = (groupMin || 0) + mMin;
          if (mMax !== null) groupMax = (groupMax || 0) + mMax;
        });
      }

      if (groupMin !== null) minModels = (minModels || 0) + groupMin;
      if (groupMax !== null) maxModels = (maxModels || 0) + groupMax;
    });

    // Pattern C: flat constraints directly on the selectionEntry itself
    if (minModels === null && maxModels === null) {
      entryEl.querySelectorAll(':scope > constraints > constraint').forEach(c => {
        const val = Math.round(parseFloat(getAttr(c, 'value', '0')));
        if (!isNaN(val) && val > 0) {
          if (getAttr(c, 'type') === 'min') minModels = val;
          if (getAttr(c, 'type') === 'max') maxModels = val;
        }
      });
    }

    // Pattern D: sum ungrouped child model entry constraints
    if (minModels === null && maxModels === null) {
      entryEl.querySelectorAll(':scope > selectionEntries > selectionEntry[type="model"]').forEach(model => {
        let mMin = null, mMax = null;
        model.querySelectorAll(':scope > constraints > constraint').forEach(c => {
          const val = Math.round(parseFloat(getAttr(c, 'value', '0')));
          if (!isNaN(val) && val > 0) {
            if (getAttr(c, 'type') === 'min') mMin = val;
            if (getAttr(c, 'type') === 'max') mMax = val;
          }
        });
        if (mMin !== null) minModels = (minModels || 0) + mMin;
        if (mMax !== null) maxModels = (maxModels || 0) + mMax;
      });
    }

    const squadOptions = [];
    if (basePts > 0) squadOptions.push({ pts: basePts, models: minModels });

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
      return { points: squadOptions[0].pts, pointsOptions: squadOptions.map(o => o.pts), squadOptions };
    }

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

  // ── Keyword / category collection ─────────────────────────────────────────

  function parseKeywords(entryEl) {
    const kws = [];
    entryEl.querySelectorAll(':scope > categoryLinks > categoryLink').forEach(link => {
      const name = getAttr(link, 'name', '').trim();
      if (!name || /^new\s+category/i.test(name)) return;
      kws.push(name);
    });
    return kws;
  }

  // ── Dedup ─────────────────────────────────────────────────────────────────

  function dedup(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
      const k = item[key];
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ── Parse one unit entry ──────────────────────────────────────────────────

  function parseEntry(entryEl, entriesById, profilesById, rulesById) {
    if (getAttr(entryEl, 'hidden', 'false') === 'true') return null;

    const name = getAttr(entryEl, 'name', 'Unknown Unit');
    if (name.includes('[Legends]')) return null;

    const id   = getAttr(entryEl, 'id') || Math.random().toString(36).slice(2, 9);
    const type = getAttr(entryEl, 'type', '');

    const stats       = findStats(entryEl, entriesById, profilesById);
    const weapons     = dedup(collectWeapons(entryEl, entriesById), 'name');
    const allAbilities= dedup(collectAbilities(entryEl, entriesById, profilesById, rulesById), 'name');
    const keywords    = parseKeywords(entryEl);
    const wargearOptions = collectWargearOptions(entryEl, entriesById);
    const { points, pointsOptions, squadOptions } = findCosts(entryEl, entriesById);
    const descEl = entryEl.querySelector(':scope > description');

    // Build name→description lookup for weapon keyword tooltips
    const rulesByName = new Map();
    for (const rule of rulesById.values()) {
      const n    = getAttr(rule, 'name', '').trim();
      const desc = rule.querySelector(':scope > description')?.textContent?.trim() || '';
      if (n) rulesByName.set(n.toLowerCase(), desc);
    }
    // Attach keyword descriptions to each weapon for tooltip display
    weapons.forEach(w => {
      if (!w.Keywords) return;
      const defs = {};
      String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
        const desc = rulesByName.get(k.toLowerCase());
        if (desc) defs[k] = desc;
      });
      if (Object.keys(defs).length) w._keywordDefs = defs;
    });

    // Weapon keyword names — used to filter these out of core abilities
    const weaponKeywordNames = new Set();
    weapons.forEach(w => {
      if (w.Keywords) {
        String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean)
          .forEach(k => weaponKeywordNames.add(k.toLowerCase()));
      }
    });

    // Extract invulnerable save from abilities (or directly from stats)
    let invulnSave = stats['INV'] || stats['Invulnerable Save'] || null;
    if (!invulnSave) {
      const invAb = allAbilities.find(a => /invulnerable\s+save/i.test(a.name));
      if (invAb) {
        // Description may be just "4+" or a sentence containing "X+ invulnerable save"
        const m = invAb.description.match(/(\d\+)/);
        if (m) invulnSave = m[1];
        else if (/^\d\+$/.test(invAb.description.trim())) invulnSave = invAb.description.trim();
      }
    }

    // Remove invuln save from abilities list; also filter weapon keywords out of core abilities
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
      description: descEl ? cleanText(descEl.textContent) : ''
    };
  }

  // ── Main parse function ───────────────────────────────────────────────────

  function parse(xmlString, filename) {
    try {
      const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('XML parse error');
      }

      const root        = doc.documentElement;
      const factionName = getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml)$/i, '').replace(/[-_]/g, ' ');

      // Linked catalogues (parent factions whose units this faction can use)
      const linkedCatalogues = [];
      root.querySelectorAll(':scope > catalogueLinks > catalogueLink[type="catalogue"]').forEach(lnk => {
        const n = getAttr(lnk, 'name', '').trim();
        if (n) linkedCatalogues.push(n);
      });

      const { entriesById, profilesById, rulesById } = buildIndexes(root);

      const units   = [];
      const seenIds = new Set();

      // Pattern A: units in selectionEntries
      root.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
        const t = getAttr(entry, 'type', '');
        if (t !== 'unit' && t !== 'model') return;
        const unit = parseEntry(entry, entriesById, profilesById, rulesById);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Pattern B: units via root entryLinks → sharedSelectionEntries
      root.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (getAttr(link, 'hidden', 'false') === 'true') return;
        const targetId = getAttr(link, 'targetId');
        if (seenIds.has(targetId)) return;
        const target = entriesById.get(targetId);
        if (!target) return;
        const t = getAttr(target, 'type', '');
        if (t !== 'unit' && t !== 'model') return;
        const unit = parseEntry(target, entriesById, profilesById, rulesById);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Army Rules: <rules> and <sharedRules> at root
      const armyRules = [];
      root.querySelectorAll(':scope > rules > rule, :scope > sharedRules > rule').forEach(rule => {
        if (getAttr(rule, 'hidden', 'false') === 'true') return;
        const name = getAttr(rule, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        const descEl = rule.querySelector(':scope > description');
        armyRules.push({ name, description: descEl ? cleanText(descEl.textContent) : '' });
      });

      // Detachments: live in sharedSelectionEntryGroups > selectionEntryGroup[name="Detachment"]
      const detachments = [];
      const detachGroup = root.querySelector(
        ':scope > sharedSelectionEntryGroups > selectionEntryGroup[name="Detachment"]'
      );
      if (detachGroup) {
        detachGroup.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
          if (getAttr(entry, 'hidden', 'false') === 'true') return;
          const name = getAttr(entry, 'name', '').trim();
          if (!name || /^new\s/i.test(name)) return;
          const rules = [];
          entry.querySelectorAll(':scope > rules > rule').forEach(r => {
            if (getAttr(r, 'hidden', 'false') === 'true') return;
            const rName = getAttr(r, 'name', '').trim();
            const descEl = r.querySelector(':scope > description');
            if (rName) rules.push({ name: rName, description: descEl ? cleanText(descEl.textContent) : '' });
          });
          detachments.push({ name, rules });
        });
      }

      // Stratagems: sharedProfiles with typeName="Stratagems"
      const stratagems = [];
      root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
        if (getAttr(p, 'typeName', '').toLowerCase() !== 'stratagems') return;
        const name = getAttr(p, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        const descEl  = p.querySelector('characteristic[name="Description"]');
        const cpEl    = p.querySelector('characteristic[name="CP Cost"]') ||
                        p.querySelector('characteristic[name="Cost"]');
        const whenEl  = p.querySelector('characteristic[name="When"]');
        const targetEl= p.querySelector('characteristic[name="Target"]');
        const effectEl= p.querySelector('characteristic[name="Effect"]');
        stratagems.push({
          name,
          description: descEl ? cleanText(descEl.textContent) : '',
          cp: cpEl ? cleanText(cpEl.textContent) : null,
          when: whenEl ? cleanText(whenEl.textContent) : null,
          target: targetEl ? cleanText(targetEl.textContent) : null,
          effect: effectEl ? cleanText(effectEl.textContent) : null,
        });
      });

      return { factionName, filename, unitCount: units.length, units, armyRules, stratagems, detachments, linkedCatalogues };

    } catch (err) {
      console.error('[Parser] Error in', filename, err);
      throw err;
    }
  }

  return { parse, addToSharedIndex };
})();
