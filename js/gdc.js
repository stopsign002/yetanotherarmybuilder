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

  // Build the unique set of GDC filenames we need based on the faction list.
  function uniqueFilenamesFor(factionNames) {
    const set = new Set();
    factionNames.forEach(name => {
      const file = FACTION_TO_GDC[name];
      if (file) set.add(file);
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

  // ── Public API ────────────────────────────────────────────────
  App.GDC = {
    FACTION_TO_GDC,
    loadAll,
    mergeIntoFactions,
    // Exposed for tests / debugging:
    _rawCache: rawCache,
    _projectStratagem: projectStratagem,
  };
})();
