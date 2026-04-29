// gdc.js — game-datacards-eu data integration. Pulls per-faction JSON from
// game-datacards/datasources and merges stratagem data into the BSData-parsed
// faction objects. BSData wh40k-10e doesn't ship 10e stratagem rules in its
// catalogue XML; GDC provides them as structured JSON keyed by detachment.
//
// We do NOT replace BSData. Units, weapons, abilities, datasheets, detachments
// (the names + their BSData-side rules + enhancements) all stay BSData-driven.
// GDC contributes only the stratagem layer.
(function () {
  const App = window.App = window.App || {};

  const RAW_BASE = 'https://raw.githubusercontent.com/game-datacards/datasources/main/10th/gdc/';

  // BSData faction name → GDC filename (without .json).
  // 11 SM chapters all map to space_marines.json — they share the SM stratagem
  // pool for faction-wide strats. Their detachment-specific strats come from
  // whichever detachment the chapter player selects (chapter detachments are
  // all in the SM detachment list via App.CHAPTER_PARENTS / getDetachmentFaction).
  const FACTION_TO_GDC = {
    'Chaos - Chaos Daemons':                    'chaosdaemons',
    'Chaos - Chaos Knights':                    'chaosknights',
    'Chaos - Chaos Space Marines':              'chaos_spacemarines',
    'Chaos - Death Guard':                      'deathguard',
    "Chaos - Emperor's Children":               'emperors_children',
    'Chaos - Thousand Sons':                    'thousandsons',
    'Chaos - World Eaters':                     'worldeaters',
    'Imperium - Adepta Sororitas':              'adeptasororitas',
    'Imperium - Adeptus Astartes - Black Templars':  'blacktemplar',
    'Imperium - Adeptus Astartes - Blood Angels':    'bloodangels',
    'Imperium - Adeptus Astartes - Dark Angels':     'darkangels',
    'Imperium - Adeptus Astartes - Deathwatch':      'deathwatch',
    'Imperium - Adeptus Astartes - Imperial Fists':  'space_marines',
    'Imperium - Adeptus Astartes - Iron Hands':      'space_marines',
    'Imperium - Adeptus Astartes - Raven Guard':     'space_marines',
    'Imperium - Adeptus Astartes - Salamanders':     'space_marines',
    'Imperium - Adeptus Astartes - Space Marines':   'space_marines',
    'Imperium - Adeptus Astartes - Space Wolves':    'spacewolves',
    'Imperium - Adeptus Astartes - Ultramarines':    'space_marines',
    'Imperium - Adeptus Astartes - White Scars':     'space_marines',
    'Imperium - Adeptus Custodes':              'adeptuscustodes',
    'Imperium - Adeptus Mechanicus':            'adeptusmechanicus',
    'Imperium - Agents of the Imperium':        'agents',
    'Imperium - Astra Militarum':               'astramilitarum',
    'Imperium - Grey Knights':                  'greyknights',
    'Imperium - Imperial Knights':              'imperialknights',
    'Xenos - Aeldari':                          'aeldari',
    'Xenos - Drukhari':                         'drukhari',
    'Xenos - Genestealer Cults':                'gsc',
    'Xenos - Leagues of Votann':                'votann',
    'Xenos - Necrons':                          'necrons',
    'Xenos - Orks':                             'orks',
    "Xenos - T'au Empire":                      'tau',
    'Xenos - Tyranids':                         'tyranids',
    // Titans factions don't have their own GDC file — leave unmapped.
  };

  // In-memory cache of raw GDC payloads keyed by GDC filename. Populated by
  // loadAll(); consumed by mergeIntoFactions().
  const rawCache = new Map();

  // Project a GDC stratagem to the shape the faction-rules renderer expects:
  // { name, cp, phase, description, ...optional }. Drops most of GDC's bookkeeping.
  function projectStratagem(s) {
    if (!s || !s.name) return null;
    const phaseRaw = Array.isArray(s.phase) && s.phase.length > 0 ? s.phase[0] : '';
    const phase = phaseRaw ? phaseRaw.charAt(0).toUpperCase() + phaseRaw.slice(1) : '';
    const cp = (typeof s.cost === 'number') ? s.cost : (parseInt(s.cost, 10) || 0);
    // Compose a useful description: the printed cards are When/Target/Effect.
    const parts = [];
    if (s.when)         parts.push('WHEN: ' + s.when);
    if (s.target)       parts.push('TARGET: ' + s.target);
    if (s.effect)       parts.push('EFFECT: ' + s.effect);
    if (s.restrictions) parts.push('RESTRICTIONS: ' + s.restrictions);
    const description = parts.join('\n\n') || (s.fluff || '');
    return {
      name: s.name,
      cp,
      phase,
      type: s.type || '',
      turn: s.turn || '',
      detachment: s.detachment || '',
      description,
      source: 'gdc',
    };
  }

  // Fetch one GDC payload, with optional IndexedDB cache. Returns null on error.
  async function fetchOne(filename) {
    const url = RAW_BASE + filename + '.json';
    if (window.YaabDB && window.YaabDB.getGdc) {
      try {
        const cached = await window.YaabDB.getGdc(filename);
        if (cached) return cached;
      } catch (e) { /* fall through to network */ }
    }
    let resp;
    try {
      resp = await fetch(url, { cache: 'no-cache' });
    } catch (e) {
      console.warn('[GDC] fetch failed for', filename, e);
      return null;
    }
    if (!resp.ok) {
      console.warn('[GDC] HTTP', resp.status, 'for', filename);
      return null;
    }
    let payload;
    try {
      payload = await resp.json();
    } catch (e) {
      console.warn('[GDC] JSON parse failed for', filename, e);
      return null;
    }
    if (window.YaabDB && window.YaabDB.putGdc) {
      try { await window.YaabDB.putGdc(filename, payload); } catch (e) { /* noop */ }
    }
    return payload;
  }

  // SM chapters with their own GDC file ship only chapter-specific datasheets
  // (e.g. blacktemplar.json has 18 entries — Helbrecht, Crusader Squad, etc.).
  // The shared SM roster (Intercessor Squad, Lieutenants, Tactical Squad…)
  // lives only in space_marines.json. For unit-data merging we therefore
  // consult the chapter file FIRST (chapter-specific entries win on name
  // collisions) then fall back to space_marines.json.
  // Stratagem merging still uses the chapter file alone — chapter strats are
  // distinct and SM-pool strats already live in the parent SM file.
  const SM_CHAPTER_FILES = new Set([
    'blacktemplar', 'bloodangels', 'darkangels', 'deathwatch', 'spacewolves',
  ]);

  // Ordered list of GDC files to consult for a given faction's unit data.
  // First file wins on name collisions.
  function gdcFilesFor(factionName) {
    const primary = FACTION_TO_GDC[factionName];
    if (!primary) return [];
    if (SM_CHAPTER_FILES.has(primary)) return [primary, 'space_marines'];
    return [primary];
  }

  // Build the unique set of GDC filenames we need based on the faction list.
  // Includes the SM fallback file when any SM-chapter faction is loaded.
  function uniqueFilenamesFor(factionNames) {
    const set = new Set();
    factionNames.forEach(name => {
      gdcFilesFor(name).forEach(f => set.add(f));
    });
    return [...set];
  }

  // Fetch every GDC payload referenced by the loaded factions. Defensive:
  // failures are logged but don't throw; stratagems are nice-to-have, not
  // load-bearing.
  async function loadAll(factionNames) {
    const filenames = uniqueFilenamesFor(factionNames);
    if (filenames.length === 0) return;
    const fetches = filenames.map(async fn => {
      const payload = await fetchOne(fn);
      if (payload) rawCache.set(fn, payload);
    });
    await Promise.all(fetches);
  }

  // Merge GDC stratagems into the parsed faction objects. Attaches:
  //   detachment.gdcStratagems: per-detachment strats (matched by detachment name)
  //   faction.gdcFactionStratagems: faction-wide strats (no detachment field, or
  //     detachment field doesn't match any of this faction's detachments)
  //
  // We attach to a separate field instead of merging into detachment.stratagems
  // so that BSData-derived strats (rare but possible — Tyranids in particular)
  // remain identifiable.
  function mergeIntoFactions(factions) {
    factions.forEach(faction => {
      const file = FACTION_TO_GDC[faction.factionName];
      if (!file) return;
      const payload = rawCache.get(file);
      if (!payload) return;
      const strats = Array.isArray(payload.stratagems) ? payload.stratagems : [];
      const detNames = new Set((faction.detachments || []).map(d => d.name.toLowerCase()));
      const byDetachment = {};
      const factionWide = [];
      strats.forEach(raw => {
        const proj = projectStratagem(raw);
        if (!proj) return;
        const dKey = (proj.detachment || '').toLowerCase();
        if (dKey && detNames.has(dKey)) {
          (byDetachment[dKey] = byDetachment[dKey] || []).push(proj);
        } else if (!dKey || dKey === 'core') {
          factionWide.push(proj);
        } else {
          // The strat references a detachment this faction doesn't own.
          // Most common: subfaction-specific strats in the parent faction file
          // that don't apply when the parent itself is selected. Skip silently.
        }
      });
      (faction.detachments || []).forEach(d => {
        const list = byDetachment[d.name.toLowerCase()];
        if (list && list.length > 0) d.gdcStratagems = list;
      });
      if (factionWide.length > 0) faction.gdcFactionStratagems = factionWide;
    });
  }

  // Normalize a unit name for cross-source matching. GDC and BSData mostly
  // agree on names, but a stray apostrophe variant (’ vs ') or stray suffix
  // ([Legends], (...)) can break exact matches. We compare on a relaxed key:
  // lowercased, curly-quotes folded to ASCII, parenthetical/[bracket] suffixes
  // stripped, all non-alphanumerics removed.
  function nameKey(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // Build a lookup: nameKey → datasheet, with earlier files winning on
  // collisions (chapter-specific entries override the SM fallback).
  function buildDatasheetIndex(filenames) {
    const idx = new Map();
    filenames.forEach(fn => {
      const payload = rawCache.get(fn);
      if (!payload) return;
      const sheets = Array.isArray(payload.datasheets) ? payload.datasheets : [];
      sheets.forEach(ds => {
        const key = nameKey(ds && ds.name);
        if (!key) return;
        if (!idx.has(key)) idx.set(key, ds);
      });
    });
    return idx;
  }

  // Project a GDC datasheet's wargear / weapon data onto a unit. We attach
  // under `gdc*` fields so detail.js can prefer them when present without
  // disturbing the BSData-derived shape (which other code already consumes).
  function projectUnitData(ds) {
    if (!ds) return null;
    const out = {};
    if (typeof ds.loadout === 'string' && ds.loadout.trim()) {
      out.loadout = ds.loadout.trim();
    }
    if (Array.isArray(ds.wargear)) {
      // Filter out the placeholder "None" entries GDC uses for HQs with no
      // options — they'd render as a confusing empty bullet.
      const lines = ds.wargear
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(s => s && s.toLowerCase() !== 'none');
      if (lines.length > 0) out.wargear = lines;
    }
    if (Array.isArray(ds.composition)) {
      const lines = ds.composition
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
      if (lines.length > 0) out.composition = lines;
    }
    if (Array.isArray(ds.leadBy) && ds.leadBy.length > 0) {
      out.leadBy = ds.leadBy.slice();
    }
    if (Array.isArray(ds.meleeWeapons))  out.meleeWeapons  = ds.meleeWeapons;
    if (Array.isArray(ds.rangedWeapons)) out.rangedWeapons = ds.rangedWeapons;
    return Object.keys(out).length > 0 ? out : null;
  }

  // Merge GDC unit-level data (loadout text, wargear options, composition,
  // leadBy, weapon profiles) onto matching units in each faction. Attaches:
  //   unit.gdcLoadout       string  — "Every model is equipped with: …"
  //   unit.gdcWargear       string[] — printed Wargear Options bullet lines
  //   unit.gdcComposition   string[] — printed Unit Composition lines
  //   unit.gdcLeadBy        string[] — leader names this unit can be led by
  //   unit.gdcMeleeWeapons  GDC weapon objects (profiles inside)
  //   unit.gdcRangedWeapons same
  // Match is by relaxed name key (see nameKey). Misses are silent — units
  // without GDC entries (Imperial Knights, Titans, oddballs) just keep their
  // BSData-derived display.
  function mergeUnitDataIntoFactions(factions) {
    factions.forEach(faction => {
      const files = gdcFilesFor(faction.factionName);
      if (files.length === 0) return;
      const idx = buildDatasheetIndex(files);
      if (idx.size === 0) return;
      (faction.units || []).forEach(unit => {
        const ds = idx.get(nameKey(unit && unit.name));
        const data = projectUnitData(ds);
        if (!data) return;
        if (data.loadout)       unit.gdcLoadout       = data.loadout;
        if (data.wargear)       unit.gdcWargear       = data.wargear;
        if (data.composition)   unit.gdcComposition   = data.composition;
        if (data.leadBy)        unit.gdcLeadBy        = data.leadBy;
        if (data.meleeWeapons)  unit.gdcMeleeWeapons  = data.meleeWeapons;
        if (data.rangedWeapons) unit.gdcRangedWeapons = data.rangedWeapons;
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────
  App.GDC = {
    FACTION_TO_GDC,
    loadAll,
    mergeIntoFactions,
    mergeUnitDataIntoFactions,
    // Exposed for tests / debugging:
    _rawCache: rawCache,
    _projectStratagem: projectStratagem,
    _nameKey: nameKey,
  };
})();
