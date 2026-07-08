// gdc.js — game-datacards-eu data integration. Pulls per-faction JSON from
// game-datacards/datasources and merges it into the 40kdc-parsed faction
// objects. 40kdc ships structure (detachments, stratagem/enhancement ids,
// CP/phase/cost) but little prose; GDC fills the prose (stratagem + enhancement
// + army/detachment rule text).
//
// EDITIONS (two, on purpose):
//   - PROSE  = 11th : stratagem / enhancement / rule TEXT, matched to the 40kdc
//              11e structure. This is the authoritative wording.
//   - UNITDATA = 10th : datasheet loadout / wargear / composition / leadBy /
//              weapon profiles consumed by detail.js + attachments.js. Left on
//              10th because the 11th datasheet shape is different (localized
//              objects, prose leadBy) and migrating it is a separate task; the
//              app already prefers 40kdc 11e for the core datasheet.
//
// 11th text fields are localized objects ({en: "…"}) and carry inline markup
// (<k>keyword</k>, <b>bold</b>, **bold**, *italic*); pickText + cleanMarkup
// normalize them to the plain strings the renderers expect.
(function () {
  const App = window.App = window.App || {};

  const RAW_ROOT = 'https://raw.githubusercontent.com/game-datacards/datasources/main/';
  const PROSE_EDITION = '11th';     // stratagem / enhancement / rule prose
  const UNITDATA_EDITION = '10th';  // datasheet loadout/wargear/weapons/leadBy

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

  // In-memory cache of raw GDC payloads keyed by `<edition>/<filename>`.
  const rawCache = new Map();

  // ── 11th-schema helpers ────────────────────────────────────────────────────
  const cap = (s) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';

  // 11th text fields are { en, de, es, … }; 10th are plain strings. Return English.
  function pickText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.en || '';
    return String(v);
  }

  // Normalize GW datacard markup to the plain text the renderers expect:
  //   <k>keyword</k> → KEYWORD (uppercased — the card renderer bolds ALL-CAPS)
  //   <b>x</b>       → **x**    (bold markdown the renderers already handle)
  //   *title*        → title    (italic book titles: drop the markers)
  //   \r / <br>      → newline
  function cleanMarkup(s) {
    return String(s == null ? '' : s)
      .replace(/<k>([\s\S]*?)<\/k>/gi, (_m, x) => x.toUpperCase())
      .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1')  // strip single-* italics, keep ** bold
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  // Project a GDC stratagem to { name, cp, phase, description, … }. Handles both
  // the 11th localized/markup shape and the older plain-string shape.
  function projectStratagem(s) {
    const name = pickText(s && s.name);
    if (!name) return null;
    const phaseRaw = Array.isArray(s.phase) && s.phase.length > 0 ? s.phase[0] : '';
    const phase = phaseRaw ? cap(phaseRaw) : '';
    const cp = (typeof s.cost === 'number') ? s.cost : (parseInt(s.cost, 10) || 0);
    const when   = cleanMarkup(pickText(s.when));
    const target = cleanMarkup(pickText(s.target));
    const effect = cleanMarkup(pickText(s.effect));
    const restr  = cleanMarkup(pickText(s.restrictions));
    const parts = [];
    if (when)   parts.push('WHEN: ' + when);
    if (target) parts.push('TARGET: ' + target);
    if (effect) parts.push('EFFECT: ' + effect);
    if (restr)  parts.push('RESTRICTIONS: ' + restr);
    const description = parts.join('\n\n') || cleanMarkup(pickText(s.fluff));
    return {
      name,
      cp,
      phase,
      type: pickText(s.type) || '',
      turn: pickText(s.turn) || '',
      detachment: pickText(s.detachment) || '',
      description,
      source: 'gdc',
    };
  }

  // Flatten a rule's segmented body (rules[].rules — ordered { order, type, text }
  // chunks) into one description string. Handles localized text + markup.
  function composeRuleText(chunks) {
    if (!Array.isArray(chunks)) return '';
    return chunks
      .filter(c => c && c.type !== 'image')
      .map(c => ({ order: c.order || 0, title: pickText(c.title), text: cleanMarkup(pickText(c.text)) }))
      .filter(c => c.text && c.text !== '-')
      .sort((a, b) => a.order - b.order)
      .map(c => (c.title ? c.title.trim() + ': ' : '') + c.text)
      .join('\n\n');
  }

  // ── fetching ────────────────────────────────────────────────────────────────
  async function fetchOne(edition, filename) {
    const cacheKey = edition + '/' + filename;
    const url = RAW_ROOT + edition + '/gdc/' + filename + '.json';
    if (window.YaabDB && window.YaabDB.getGdc) {
      try {
        const cached = await window.YaabDB.getGdc(cacheKey);
        if (cached) return cached;
      } catch (e) { /* fall through to network */ }
    }
    let resp;
    try {
      resp = await fetch(url, { cache: 'no-cache' });
    } catch (e) {
      console.warn('[GDC] fetch failed for', cacheKey, e);
      return null;
    }
    if (!resp.ok) {
      console.warn('[GDC] HTTP', resp.status, 'for', cacheKey);
      return null;
    }
    let payload;
    try {
      payload = await resp.json();
    } catch (e) {
      console.warn('[GDC] JSON parse failed for', cacheKey, e);
      return null;
    }
    if (window.YaabDB && window.YaabDB.putGdc) {
      try { await window.YaabDB.putGdc(cacheKey, payload); } catch (e) { /* noop */ }
    }
    return payload;
  }

  // SM chapters with their own GDC file ship only chapter-specific datasheets;
  // the shared SM roster + generic-detachment prose lives in space_marines.json,
  // so we always consult it as a fallback for those chapters.
  const SM_CHAPTER_FILES = new Set([
    'blacktemplar', 'bloodangels', 'darkangels', 'deathwatch', 'spacewolves',
  ]);

  // Ordered list of GDC files for a faction. First wins on name collisions.
  function gdcFilesFor(factionName) {
    const primary = FACTION_TO_GDC[factionName];
    if (!primary) return [];
    if (SM_CHAPTER_FILES.has(primary)) return [primary, 'space_marines'];
    return [primary];
  }

  function uniqueFilenamesFor(factionNames) {
    const set = new Set();
    factionNames.forEach(name => gdcFilesFor(name).forEach(f => set.add(f)));
    return [...set];
  }

  // Fetch every referenced GDC payload — BOTH editions (prose=11th,
  // unit-data=10th). Defensive: failures are logged, never thrown.
  async function loadAll(factionNames) {
    const filenames = uniqueFilenamesFor(factionNames);
    if (filenames.length === 0) return;
    const fetches = [];
    filenames.forEach(fn => {
      fetches.push(fetchOne(PROSE_EDITION, fn).then(p => { if (p) rawCache.set(PROSE_EDITION + '/' + fn, p); }));
      fetches.push(fetchOne(UNITDATA_EDITION, fn).then(p => { if (p) rawCache.set(UNITDATA_EDITION + '/' + fn, p); }));
    });
    await Promise.all(fetches);
  }

  // Merge GDC PROSE (11th) into the parsed faction objects:
  //   detachment.gdcStratagems  — per-detachment strat text (by detachment name)
  //   detachment.enhancements[].description — filled where 40kdc left it empty
  //   detachment.rules          — filled where empty (fill-only)
  //   faction.armyRules[].description — filled where empty
  //   faction.gdcFactionStratagems — faction-wide/core strats
  //
  // For SM chapters we merge from BOTH the chapter file AND space_marines.json
  // (gdcFilesFor), so the ~15 generic codex detachments that repeat under every
  // chapter — whose prose lives only in space_marines.json — get their strat +
  // enhancement + rule text on the chapter's own detachment copies too (routed
  // via detKeyToTargets, which indexes this faction's AND the parent's detachments).
  function mergeIntoFactions(factions) {
    const CHAPTER_PARENTS = (App && App.CHAPTER_PARENTS) || {};
    const factionByName = new Map();
    factions.forEach(f => factionByName.set(f.factionName, f));

    factions.forEach(faction => {
      const files = gdcFilesFor(faction.factionName);
      if (files.length === 0) return;

      // Index the detachments prose can land on: this faction's + (for chapters)
      // the parent SM faction's. Relaxed name key folds curly/straight quotes etc.
      const detKeyToTargets = new Map();
      function indexDetachments(f) {
        if (!f || !Array.isArray(f.detachments)) return;
        f.detachments.forEach(d => {
          const k = nameKey(d.name);
          if (!k) return;
          if (!detKeyToTargets.has(k)) detKeyToTargets.set(k, []);
          detKeyToTargets.get(k).push(d);
        });
      }
      indexDetachments(faction);
      const parentName = CHAPTER_PARENTS[faction.factionName];
      if (parentName) indexDetachments(factionByName.get(parentName));

      // Accumulate across every file (chapter + space_marines fallback).
      const byDetachment = {};
      const factionWide = [];
      const armyRuleEntries = [];
      const detRuleEntries = [];
      const enhancementEntries = [];

      files.forEach(file => {
        const payload = rawCache.get(PROSE_EDITION + '/' + file);
        if (!payload) return;
        (Array.isArray(payload.stratagems) ? payload.stratagems : []).forEach(raw => {
          const proj = projectStratagem(raw);
          if (!proj) return;
          const dKey = nameKey(proj.detachment);
          if (dKey && detKeyToTargets.has(dKey)) {
            (byDetachment[dKey] = byDetachment[dKey] || []).push(proj);
          } else if (!proj.detachment || proj.detachment.toLowerCase() === 'core') {
            factionWide.push(proj);
          }
          // else: strat references a detachment this faction doesn't own → skip.
        });
        (Array.isArray(payload.enhancements) ? payload.enhancements : []).forEach(e => enhancementEntries.push(e));
        if (payload.rules) {
          (Array.isArray(payload.rules.army) ? payload.rules.army : []).forEach(a => armyRuleEntries.push(a));
          (Array.isArray(payload.rules.detachment) ? payload.rules.detachment : []).forEach(d => detRuleEntries.push(d));
        }
      });

      // Attach detachment strats (dedupe by name), concatenating with any existing.
      detKeyToTargets.forEach((targets, key) => {
        const list = byDetachment[key];
        if (!list || list.length === 0) return;
        targets.forEach(d => {
          const existing = Array.isArray(d.gdcStratagems) ? d.gdcStratagems : [];
          const seen = new Set(existing.map(s => (s && s.name || '').toLowerCase()));
          list.forEach(s => {
            const k = (s && s.name || '').toLowerCase();
            if (!k || seen.has(k)) return;
            seen.add(k);
            existing.push(s);
          });
          if (existing.length > 0) d.gdcStratagems = existing;
        });
      });

      // Faction-wide / core strats (dedupe by name).
      if (factionWide.length > 0) {
        const seen = new Set();
        const uniq = [];
        factionWide.forEach(s => {
          const k = (s.name || '').toLowerCase();
          if (k && !seen.has(k)) { seen.add(k); uniq.push(s); }
        });
        faction.gdcFactionStratagems = uniq;
      }

      // Army rule prose — fill a 40kdc-seeded rule's empty description, or add.
      if (armyRuleEntries.length > 0) {
        const existing = Array.isArray(faction.armyRules) ? faction.armyRules : (faction.armyRules = []);
        const byKey = new Map(existing.map(r => [nameKey(r.name), r]));
        armyRuleEntries.forEach(ar => {
          const nm = pickText(ar && ar.name);
          if (!nm) return;
          const desc = composeRuleText(ar.rules);
          const hit = byKey.get(nameKey(nm));
          if (hit) {
            if (!hit.description && desc) hit.description = desc;
          } else {
            const rule = { name: nm, description: desc, source: 'gdc' };
            existing.push(rule);
            byKey.set(nameKey(nm), rule);
          }
        });
      }

      // Detachment rule prose — one { name, description } per named sub-rule,
      // filled only where the detachment has no rule text yet.
      detRuleEntries.forEach(entry => {
        const dName = pickText(entry && entry.detachment);
        if (!dName) return;
        const targets = detKeyToTargets.get(nameKey(dName));
        if (!targets || targets.length === 0) return;
        const built = (Array.isArray(entry.rules) ? entry.rules : []).map(sr => ({
          name: pickText(sr && sr.name) || dName,
          description: composeRuleText(sr && sr.rules),
          source: 'gdc',
        })).filter(r => r.description);
        if (built.length === 0) return;
        targets.forEach(d => {
          const cur = Array.isArray(d.rules) ? d.rules : [];
          if (!cur.some(r => r && r.description)) d.rules = built.map(r => ({ ...r }));
        });
      });

      // Enhancement prose — fill a detachment enhancement's empty description,
      // matched by detachment name + enhancement name (relaxed key drops a
      // trailing "(Upgrade)" suffix GDC appends). 40kdc-first: never overrides.
      enhancementEntries.forEach(e => {
        const dName = pickText(e && e.detachment);
        if (!dName) return;
        const targets = detKeyToTargets.get(nameKey(dName));
        if (!targets || targets.length === 0) return;
        const desc = cleanMarkup(pickText(e.description));
        if (!desc) return;
        const enhKey = nameKey(pickText(e.name));
        if (!enhKey) return;
        targets.forEach(d => {
          (d.enhancements || []).forEach(en => {
            if (!en.description && nameKey(en.name) === enhKey) en.description = desc;
          });
        });
      });
    });
  }

  // Normalize a name for cross-source matching: lowercased, curly→straight
  // quotes, trailing parenthetical/[bracket] suffix stripped, non-alnum removed.
  function nameKey(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // ── Unit datasheet data (10th edition — unchanged) ──────────────────────────
  // Build a lookup: nameKey → datasheet, earlier files winning on collisions.
  function buildDatasheetIndex(filenames) {
    const idx = new Map();
    filenames.forEach(fn => {
      const payload = rawCache.get(UNITDATA_EDITION + '/' + fn);
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

  function projectUnitData(ds) {
    if (!ds) return null;
    const out = {};
    if (typeof ds.loadout === 'string' && ds.loadout.trim()) {
      out.loadout = ds.loadout.trim();
    }
    if (Array.isArray(ds.wargear)) {
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
    _cleanMarkup: cleanMarkup,
    _pickText: pickText,
    _nameKey: nameKey,
    _PROSE_EDITION: PROSE_EDITION,
    _UNITDATA_EDITION: UNITDATA_EDITION,
  };
})();
