// gdc.js — game-datacards-eu data integration. Pulls per-faction JSON from
// game-datacards/datasources and merges it into the 40kdc-parsed faction
// objects. 40kdc ships structure (detachments, stratagem/enhancement ids,
// CP/phase/cost) but little prose; GDC fills the prose (stratagem + enhancement
// + army/detachment rule text).
//
// EDITION = 11th for everything: stratagem / enhancement / rule TEXT AND the
// datasheet loadout / wargear / composition / leadBy / weapon profiles consumed
// by detail.js + attachments.js. (Fully migrated off 10th.)
//
// 11th fields are localized objects ({en: "…"}) and carry inline markup
// (<k>keyword</k>, <b>bold</b>, **bold**, *italic*), and some datasheet fields
// are arrays of { en } (wargear/composition) or prose (leader). pickText,
// cleanMarkup, plainText, listLines, leaderTargets and normalizeWeapons
// normalize them into the plain strings / arrays the renderers expect.
(function () {
  const App = window.App = window.App || {};

  // Served from OUR origin, not github. `data/gdc/` is a committed snapshot of
  // game-datacards/datasources (same `<edition>/gdc/<file>.json` layout, so the
  // URL builder below is unchanged), refreshed by ~/sites/base/refresh-40kdc.sh
  // alongside the 40kdc bundle.
  //
  // Why this stopped being a live fetch: GDC is not a nice-to-have fallback.
  // 40kdc ships NO rules prose, and detail.js/cards-mode.js render weapon
  // statlines from the gdcRanged/gdcMelee rows — so a github outage or an
  // upstream reshuffle would blank ability text and swap the weapon numbers
  // users see. Pinning it also makes what's on screen reproducible: the app now
  // has ONE data origin we control, versioned in git with everything else.
  const RAW_ROOT = 'data/gdc/';
  const EDITION = '11th';   // single source of truth — stratagems/rules/
                            // enhancements PROSE and datasheet loadout/wargear/
                            // composition/leadBy/weapons all come from 11th now.

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

  // Like cleanMarkup but ALSO drops **bold** markers — for datasheet text fields
  // (loadout / wargear / composition) that render as plain esc()'d strings, where
  // literal "**" would show through.
  function plainText(v) {
    return cleanMarkup(pickText(v)).replace(/\*\*/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  // Split a localized datasheet list field (wargear / composition) — an array of
  // { en } items, or a single { en } with newline/bullet-separated lines — into
  // plain-text lines, dropping "None"/empty placeholders.
  function listLines(v) {
    let items = [];
    if (Array.isArray(v)) items = v.map(plainText);
    else items = plainText(v).split(/\n|(?:\s*■\s*)/);
    return items.map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none');
  }

  // Extract the bodyguard unit names from a 11th `leader` prose field, e.g.
  // "…attached to the following units: ■ **INTERCESSOR SQUAD** ■ **TACTICAL SQUAD**"
  // → ["INTERCESSOR SQUAD", "TACTICAL SQUAD"] (attachments.js folds case).
  function leaderTargets(v) {
    const s = pickText(v);
    if (!s) return [];
    const out = [];
    const re = /\*\*([^*]+?)\*\*/g;
    let m;
    while ((m = re.exec(s))) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name) out.push(name);
    }
    // Fallback: some entries bullet the names without bold.
    if (out.length === 0 && /■/.test(s)) {
      s.split(/\s*■\s*/).slice(1).forEach(x => { const t = x.replace(/\s+/g, ' ').trim(); if (t) out.push(t); });
    }
    return out;
  }

  // Normalize a 11th weapon array (each weapon → { profiles:[…] } with a
  // localized profile name) into the shape gdcProfilesToRows expects: a string
  // profile name; all other stat fields already match.
  function normalizeWeapons(arr) {
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter(w => w && Array.isArray(w.profiles))
      .map(w => ({
        active: w.active !== false,
        name: pickText(w.name),
        profiles: w.profiles.map(p => Object.assign({}, p, { name: pickText(p && p.name) })),
      }))
      .filter(w => w.profiles.length > 0);
    return out.length > 0 ? out : null;
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
  // Self-healing content patches for rule text GDC ships as IMAGES (dropped
  // by composeRuleText — nothing to extract). Keyed by an { anchor, insert }
  // pair: `insert` goes right after `anchor` in the composed text, and only
  // when the text doesn't already carry it (so the patch no-ops the moment
  // the datasource inlines the content as text).
  //   Nurgle's Gift: the per-round Contagion Range values are three graphics.
  const RULE_TEXT_PATCHES = {
    // key = nameKey(rule name): lowercased, "(Aura)" suffix + punctuation stripped
    'nurglesgift': {
      anchor: 'Contagion Range changes over the course of the battle:',
      already: 'First battle round',
      insert: '\n• First battle round: 3"\n• Second battle round: 6"\n• Third battle round onwards: 9"',
    },
  };
  function patchRuleText(name, text) {
    const p = RULE_TEXT_PATCHES[nameKey(name)];
    if (!p || !text) return text;
    if (text.indexOf(p.already) !== -1) return text;       // datasource fixed → no-op
    const i = text.indexOf(p.anchor);
    if (i === -1) return text;
    const at = i + p.anchor.length;
    return text.slice(0, at) + p.insert + text.slice(at);
  }

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
    const fetches = filenames.map(async fn => {
      const payload = await fetchOne(EDITION, fn);
      if (payload) rawCache.set(EDITION + '/' + fn, payload);
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
        const payload = rawCache.get(EDITION + '/' + file);
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
          const desc = patchRuleText(nm, composeRuleText(ar.rules));
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
      //
      // Exact key first, then the closest name among THAT detachment's GDC
      // entries. 40kdc misspells a handful of enhancements against GW's own
      // text — "Synaptic Lynchpin" vs GDC's "Synaptic Linchpin", "Stave of
      // Kurnos" vs "Kurnous", "Mask of the Nekrosor" vs "Mark of the" — and an
      // exact-only join leaves those with NO rules text at all, which is what a
      // user reported. Scoped to one detachment the candidate pool is ~4 names,
      // so a high-similarity unique match is safe. It self-heals too: once
      // upstream corrects a spelling the exact branch wins and this never runs.
      const enhByDet = new Map();
      enhancementEntries.forEach(e => {
        const dName = pickText(e && e.detachment);
        const desc = cleanMarkup(pickText(e.description));
        const enhKey = nameKey(pickText(e.name));
        if (!dName || !desc || !enhKey) return;
        const k = nameKey(dName);
        if (!enhByDet.has(k)) enhByDet.set(k, []);
        enhByDet.get(k).push({ key: enhKey, desc });
      });
      enhByDet.forEach((entries, detKey) => {
        const targets = detKeyToTargets.get(detKey);
        if (!targets || targets.length === 0) return;
        const byKey = new Map(entries.map(x => [x.key, x.desc]));
        targets.forEach(d => {
          (d.enhancements || []).forEach(en => {
            if (en.description) return;
            const k = nameKey(en.name);
            if (!k) return;
            const desc = byKey.get(k) || nearestUnique(k, entries);
            if (desc) en.description = desc;
          });
        });
      });
    });
  }

  // Closest candidate by edit distance — but ONLY when unambiguous: the best
  // match must clear the similarity floor AND be strictly better than the
  // runner-up. Anything else returns '' , because attaching the wrong rules
  // text to an enhancement is worse than showing none.
  function nearestUnique(key, entries) {
    let best = null, bestD = Infinity, secondD = Infinity;
    entries.forEach(e => {
      const d = editDistance(key, e.key);
      if (d < bestD) { secondD = bestD; bestD = d; best = e; }
      else if (d < secondD) secondD = d;
    });
    if (!best || bestD >= secondD) return '';
    const span = Math.max(key.length, best.key.length) || 1;
    return (1 - bestD / span) >= 0.85 ? best.desc : '';
  }

  // Levenshtein, two-row. Names are short (< 40 chars after nameKey) and this
  // only runs for the few enhancements an exact match missed.
  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return a.length || b.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(
          prev[j] + 1,
          row[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = row;
    }
    return prev[b.length];
  }

  // A trailing "(…)" on an ability name — GW's datacard convention for "(Aura)"
  // and for usage limits like "(Once per turn, per unit)". nameKey() strips it
  // for matching; this is how we tell whether a name still carries one.
  const QUALIFIED_NAME_RE = /\([^)]*\)\s*$/;

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

  // ── Unit datasheet data (11th) ──────────────────────────────────────────────
  // Build a lookup: nameKey → datasheet, earlier files winning on collisions.
  function buildDatasheetIndex(filenames) {
    const idx = new Map();
    filenames.forEach(fn => {
      const payload = rawCache.get(EDITION + '/' + fn);
      if (!payload) return;
      const sheets = Array.isArray(payload.datasheets) ? payload.datasheets : [];
      sheets.forEach(ds => {
        const key = nameKey(pickText(ds && ds.name));   // 11th name is a { en } object
        if (!key) return;
        if (!idx.has(key)) idx.set(key, ds);
      });
    });
    return idx;
  }

  function projectUnitData(ds) {
    if (!ds) return null;
    const out = {};
    const loadout = plainText(ds.loadout);
    if (loadout) out.loadout = loadout;
    const wargear = listLines(ds.wargear);
    if (wargear.length > 0) out.wargear = wargear;
    const composition = listLines(ds.composition);
    if (composition.length > 0) out.composition = composition;
    const leadBy = leaderTargets(ds.leader);
    if (leadBy.length > 0) out.leadBy = leadBy;
    const melee  = normalizeWeapons(ds.meleeWeapons);
    const ranged = normalizeWeapons(ds.rangedWeapons);
    if (melee)  out.meleeWeapons  = melee;
    if (ranged) out.rangedWeapons = ranged;
    return Object.keys(out).length > 0 ? out : null;
  }

  function mergeUnitDataIntoFactions(factions) {
    factions.forEach(faction => {
      const files = datasheetFilesFor(faction.factionName);
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

  // ── Unit ABILITIES from GDC (11th) — fills 40kdc datasheet gaps ─────────────
  // 40kdc leaves some datasheets with zero linked abilities (Emperor's Champion,
  // the generic Captain, The Red Terror, Commissar Yarrick, Wazdakka…) or with
  // an ability named but no text (Lord Calgar, Captain of the Honour Guard). The
  // 11th GDC datasheet carries the real abilities under abilities.other
  // [{ name, description }]. We use them to:
  //   - FILL an existing unit ability's empty description (matched by name), and
  //   - ADD missing abilities, but ONLY to units that currently have no non-core
  //     ability at all — so we precisely patch the empty datasheets without
  //     broadly injecting abilities across units 40kdc already covers.
  // SELF-HEALING + 40kdc-first: never overrides existing 40kdc ability text.
  function project11Abilities(ds) {
    if (!ds || !ds.abilities) return [];
    const other = Array.isArray(ds.abilities.other) ? ds.abilities.other : [];
    return other
      .map(a => ({ name: pickText(a && a.name), description: cleanMarkup(pickText(a && a.description)) }))
      .filter(a => a.name);
  }

  // 11e degrading statlines. GW carries them per datasheet as
  // abilities.damaged = { range: {en}, description: {en} } — e.g. range
  // "1-8 WOUNDS REMAINING". 40kdc links none of them (the bundle defines 5
  // damaged-* ability ids, all Titans, and no unit references one), so GDC is
  // the only source and every affected datasheet rendered without its Damaged
  // block. NOT the same thing as the deliberate drop in parser/entry.js
  // (DAMAGED_RE): that belongs to the dormant BSData/10e path, where these were
  // vestigial entries carrying no text. In 11e they are real rules.
  function project11Damaged(ds) {
    if (!ds || !ds.abilities || !ds.abilities.damaged) return null;
    const d = ds.abilities.damaged;
    const description = cleanMarkup(pickText(d.description));
    if (!description) return null;
    const range = pickText(d.range);
    // GW prints the range in caps ("1-8 WOUNDS REMAINING"); lowercase it so it
    // sits alongside the other ability names instead of shouting.
    return { name: range ? ('Damaged: ' + range.toLowerCase()) : 'Damaged', description };
  }

  // For the ability index, the SM PARENT faction needs every chapter's file too:
  // in 40kdc the chapters have zero units, so chapter-unique units (Emperor's
  // Champion, Grey Hunters, Death Company…) live under the parent — but their
  // GDC datasheets are in the chapter files. Those files are already fetched
  // (their chapter factions are loaded), so consulting them is free.
  function datasheetFilesFor(factionName) {
    const files = gdcFilesFor(factionName);
    if (factionName === 'Imperium - Adeptus Astartes - Space Marines') {
      return [...new Set([...files, ...SM_CHAPTER_FILES, 'space_marines'])];
    }
    return files;
  }

  // Primarch/hero choose-N groups (Guilliman, Mortarion's "Lord of the Death
  // Guard", Lion, Magnus, …) live under abilities.primarch as
  // [{ name, abilities: [{ name, description }] }]. Each sub-ability is
  // attached with _typeName = the GROUP name, which detail.js / cards-mode.js
  // already route into the gold-leaf "pick from these" section.
  function project11PrimarchGroups(ds) {
    if (!ds || !ds.abilities || !Array.isArray(ds.abilities.primarch)) return [];
    return ds.abilities.primarch.map(grp => ({
      group: pickText(grp && grp.name),
      abilities: (Array.isArray(grp && grp.abilities) ? grp.abilities : [])
        .map(a => ({ name: pickText(a && a.name), description: cleanMarkup(pickText(a && a.description)) }))
        .filter(a => a.name),
    })).filter(g => g.group && g.abilities.length);
  }

  function buildAbilityIndex11(files) {
    const idx = new Map();
    files.forEach(fn => {
      const p = rawCache.get(EDITION + '/' + fn);
      if (!p) return;
      (Array.isArray(p.datasheets) ? p.datasheets : []).forEach(ds => {
        const k = nameKey(pickText(ds && ds.name));   // 11th name is a { en } object
        if (!k || idx.has(k)) return;
        idx.set(k, { abilities: project11Abilities(ds), primarch: project11PrimarchGroups(ds),
                     damaged: project11Damaged(ds) });
      });
    });
    return idx;
  }

  function mergeUnitAbilitiesFromGdc(factions) {
    factions.forEach(faction => {
      const files = datasheetFilesFor(faction.factionName);
      if (files.length === 0) return;
      const idx = buildAbilityIndex11(files);
      if (idx.size === 0) return;
      (faction.units || []).forEach(unit => {
        const entry = idx.get(nameKey(unit && unit.name));
        if (!entry) return;
        const gAbils = entry.abilities || [];
        const gGroups = entry.primarch || [];
        const gDamaged = entry.damaged || null;
        if (gAbils.length === 0 && gGroups.length === 0 && !gDamaged) return;
        const abils = Array.isArray(unit.abilities) ? unit.abilities : (unit.abilities = []);
        const byKey = new Map(abils.map(a => [nameKey(a.name), a]));
        // Gate the datasheet fill on whether 40kdc ITSELF linked a non-core
        // ability — not on the merged list. dc-adapter tags everything it
        // appends from a hand-map / the consensus overlay / the attachment role
        // with `_injected`, and those used to count here: a unit whose 40kdc
        // datasheet links NOTHING (exactly the case this fill exists for) had
        // the gate slammed shut by one overlay-injected ability, and the rest of
        // its printed datasheet was silently dropped. Wazdakka Gutsmek lost both
        // "Fixit da Grot" and "Throttlerokkit Shokka Engine" to a single
        // textless `WAAAGH! WAZDAKKA` entry. Ignoring `_injected` can only ever
        // OPEN the gate, never close one that was open before.
        const hasNonCore = abils.some(a => !a.isCore && !a._injected);
        gAbils.forEach(g => {
          const hit = byKey.get(nameKey(g.name));
          if (hit) {
            if (!hit.description && g.description) hit.description = g.description;
            // GW prints a usage limit as a SUFFIX ON THE NAME — "Adaptive
            // Instincts (Once per turn, per unit)" — and nowhere in the body.
            // nameKey() strips that suffix so the two sides match, which is how
            // the description merges correctly; but it also means we render the
            // bare name and the player never learns the restriction exists.
            // Adopt GW's fuller name whenever ours carries no qualifier of its
            // own. 40kdc already ships "(Aura)" on 120 abilities, so downstream
            // renderers handle the shape; this only adds the once-per-X limits
            // it happens to omit. Self-healing — a no-op once 40kdc includes them.
            if (QUALIFIED_NAME_RE.test(g.name) && !QUALIFIED_NAME_RE.test(hit.name)) {
              hit.name = g.name;
            }
          } else if (!hasNonCore && g.description) {
            const na = { name: g.name, description: g.description, isCore: false };
            abils.push(na);
            byKey.set(nameKey(g.name), na);
          }
        });
        // Primarch choose-N sub-abilities are ALWAYS added when missing
        // (unlike the hasNonCore-gated fill above): the parent ability's text
        // says "see below", so the options are part of the printed datasheet
        // — 40kdc just doesn't model them. _typeName = group name routes them
        // into the choose-N section. Self-healing: the name-dedupe no-ops if
        // 40kdc ever links them natively.
        gGroups.forEach(grp => {
          grp.abilities.forEach(g => {
            const hit = byKey.get(nameKey(g.name));
            if (hit) {
              if (!hit.description && g.description) hit.description = g.description;
              if (!hit._typeName) hit._typeName = grp.group;
              return;
            }
            if (!g.description) return;
            const na = { name: g.name, description: g.description, isCore: false, _typeName: grp.group };
            abils.push(na);
            byKey.set(nameKey(g.name), na);
          });
        });
        // Damaged profile — ALWAYS added when missing, like the primarch
        // groups and unlike the hasNonCore-gated fill: it is part of every
        // affected printed datasheet and 40kdc never links it, so gating it
        // behind "this unit has no abilities" would hide it on exactly the
        // vehicles and monsters that have one. `_typeName: 'damaged'` is
        // already in detail.js's and cards-mode.js's standard-typename sets,
        // so it renders in the normal Abilities section rather than being
        // mistaken for a choose-N sub-ability. Self-healing name dedupe.
        if (gDamaged && !byKey.has(nameKey(gDamaged.name))) {
          const na = { name: gDamaged.name, description: gDamaged.description,
                       isCore: false, _typeName: 'damaged' };
          abils.push(na);
          byKey.set(nameKey(gDamaged.name), na);
        }
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────
  App.GDC = {
    FACTION_TO_GDC,
    loadAll,
    mergeIntoFactions,
    mergeUnitDataIntoFactions,
    mergeUnitAbilitiesFromGdc,
    // Exposed for tests / debugging:
    _rawCache: rawCache,
    _projectStratagem: projectStratagem,
    _cleanMarkup: cleanMarkup,
    _pickText: pickText,
    _nameKey: nameKey,
    _EDITION: EDITION,
  };
})();
