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
  //
  // Control characters are dropped FIRST. GW's dump sprinkles \x07 (BEL) into
  // stratagem secondary effects — invisible in a JSON viewer, but it reaches
  // the DOM as a stray glyph in some fonts and breaks a plain-text export. \r
  // is handled below as a line break, \n and \t are kept.
  function cleanMarkup(s) {
    return String(s == null ? '' : s)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .replace(/<k>([\s\S]*?)<\/k>/gi, (_m, x) => x.toUpperCase())
      .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1')  // strip single-* italics, keep ** bold
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  // Lowercase alphanumerics only — the same content-preserving comparison
  // dc-adapter's reconcileStrats uses. Two strings that squash equal differ
  // only in punctuation and whitespace, so "A squash-contains B" is a real
  // superset test rather than a formatting accident.
  function squashText(t) { return String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9]/g, ''); }

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
    // 11e stratagems can offer a SECOND, pricier effect on the same card
    // ("+1 CP — Or: …"). It lives in its own field, so a card rendered from
    // `effect` alone silently drops half the stratagem. The dump prefixes the
    // text with a BEL control char and an <u>Or:</u> label; cleanMarkup strips
    // the control char and the tags, and the leading "Or:" is re-supplied here
    // so the cost and the alternative read as one sentence.
    const secondary = cleanMarkup(pickText(s.secondary_effect))
      .replace(/^or\s*:\s*/i, '').trim();
    const secCost = (typeof s.secondary_effect_cost === 'number')
      ? s.secondary_effect_cost : (parseInt(s.secondary_effect_cost, 10) || 0);
    const parts = [];
    if (when)   parts.push('WHEN: ' + when);
    if (target) parts.push('TARGET: ' + target);
    if (effect) parts.push('EFFECT: ' + effect);
    if (restr)  parts.push('RESTRICTIONS: ' + restr);
    let description = parts.join('\n\n') || cleanMarkup(pickText(s.fluff));
    if (secondary) {
      description += (description ? '\n\n' : '')
        + (secCost ? '+' + secCost + ' CP — Or: ' : 'Or: ') + secondary;
    }
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
  // Cached GDC payloads are revalidated against the server on every load
  // instead of being served unconditionally forever (stopsign002/
  // yetanotherarmybuilder#58: the `?v=` deploy stamp does NOT move on a
  // GDC-only snapshot refresh — refresh-40kdc.sh commits `data/gdc` on its own
  // without re-stamping when the bundle md5 is unchanged, which is the common
  // case since the snapshot moves on GW's schedule, not 40kdc's — so a stamp
  // comparison alone would miss exactly the staleness this bug is about).
  // Instead we store the response's ETag / Last-Modified alongside the cached
  // payload and send it back as a conditional GET: a 304 costs one small
  // round-trip with no body (the "one cheap check" the fix must stay within),
  // and a real change comes back 200 with fresh bytes.
  async function fetchOne(edition, filename) {
    const cacheKey = edition + '/' + filename;
    const url = RAW_ROOT + edition + '/gdc/' + filename + '.json';
    let cached = null;
    if (window.YaabDB && window.YaabDB.getGdc) {
      try { cached = await window.YaabDB.getGdc(cacheKey); } catch (e) { cached = null; }
    }
    const condHeaders = {};
    if (cached && cached.etag) condHeaders['If-None-Match'] = cached.etag;
    else if (cached && cached.lastModified) condHeaders['If-Modified-Since'] = cached.lastModified;

    let resp;
    try {
      // no-store: this is our own conditional revalidation, so the browser's
      // HTTP cache must not short-circuit the round-trip.
      resp = await fetch(url, { cache: 'no-store', headers: condHeaders });
    } catch (e) {
      console.warn('[GDC] fetch failed for', cacheKey, e);
      return cached ? cached.payload : null;
    }
    if (resp.status === 304 && cached) {
      return cached.payload;
    }
    if (!resp.ok) {
      console.warn('[GDC] HTTP', resp.status, 'for', cacheKey);
      return cached ? cached.payload : null;
    }
    let payload;
    try {
      payload = await resp.json();
    } catch (e) {
      console.warn('[GDC] JSON parse failed for', cacheKey, e);
      return cached ? cached.payload : null;
    }
    if (window.YaabDB && window.YaabDB.putGdc) {
      const etag = resp.headers.get('ETag') || null;
      const lastModified = resp.headers.get('Last-Modified') || null;
      try { await window.YaabDB.putGdc(cacheKey, payload, { etag, lastModified }); } catch (e) { /* noop */ }
    }
    return payload;
  }

  // SM chapters with their own GDC file ship only chapter-specific datasheets;
  // the shared SM roster + generic-detachment prose lives in space_marines.json,
  // so we always consult it as a fallback for those chapters.
  const SM_CHAPTER_FILES = new Set([
    'blacktemplar', 'bloodangels', 'darkangels', 'deathwatch', 'spacewolves',
  ]);

  // Each chapter file's own ALL-CAPS keyword, as GW's prose names it (e.g.
  // Fervour of the Ancients: "…friendly **SPACE WOLVES** unit…"). Used ONLY by
  // buildAbilityIndex11's parent-sweep branch below to tell "this datasheet is
  // legitimately this chapter's own" from "this datasheet belongs to a
  // DIFFERENT chapter and must not be handed to the Space Marines parent."
  const CHAPTER_KEYWORDS = {
    spacewolves: 'SPACE WOLVES',
    bloodangels: 'BLOOD ANGELS',
    darkangels: 'DARK ANGELS',
    blacktemplar: 'BLACK TEMPLARS',
    deathwatch: 'DEATHWATCH',
  };

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
      // GDC-authoritative faction (dc-adapter's allowlist, keyed by 40kdc
      // faction id). For these, GW's app dump is the source of record: the
      // detachment RULE and the enhancement list are REPLACED, not filled.
      // 40kdc's copies are a codex behind — whole detachments carry the wrong
      // rule, and 26 index-era Ork enhancements were still listed, two of them
      // as free 0-pt duplicates. Fill-only cannot delete a row.
      const authoritative = !!((App && App.GDC_AUTHORITATIVE) || {})[faction._factionId];
      // detKeyToTargets also indexes the PARENT Space Marines faction for a
      // chapter, so a replace must only ever touch this faction's own rows.
      const ownDetachment = (d) => !d._factionId || d._factionId === faction._factionId;

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
          // Authoritative: GW names the RULE ("Unstoppable Momentum"), 40kdc
          // names the DETACHMENT ("Blitz Brigade") and attaches text from the
          // previous edition. Replace outright.
          if (authoritative && ownDetachment(d)) {
            d.rules = built.map(r => ({ ...r }));
            return;
          }
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
        const rawName = pickText(e.name);
        const enhKey = nameKey(rawName);
        if (!dName || !desc || !enhKey) return;
        const k = nameKey(dName);
        if (!enhByDet.has(k)) enhByDet.set(k, []);
        // `name`/`pts` are read only by the authoritative REPLACE path below.
        // The fill-only path uses key + desc exactly as before, and this list
        // is deliberately NOT deduped — nearestUnique's "strictly better than
        // the runner-up" test is calibrated against the list it has always had.
        enhByDet.get(k).push({ key: enhKey, desc, name: rawName,
                               pts: (typeof e.cost === 'number') ? e.cost : (parseInt(e.cost, 10) || 0) });
      });
      enhByDet.forEach((entries, detKey) => {
        const targets = detKeyToTargets.get(detKey);
        if (!targets || targets.length === 0) return;
        const byKey = new Map(entries.map(x => [x.key, x.desc]));
        targets.forEach(d => {
          if (authoritative && ownDetachment(d)) {
            // Authoritative: GW's rows ARE the list — same names, same points,
            // same text. The ONE thing 40kdc can still have that GDC does not
            // is the full text: three Ork enhancements carry a weapon profile
            // that GDC ships as an image (Da Gobshot Thunderbuss, Da Krunch,
            // 'Eadbanger). Keep ours only where it is a strict SUPERSET of
            // GW's — same words, more of them — which is provably
            // content-preserving and self-heals once the dump inlines them.
            const prevByKey = new Map();
            (d.enhancements || []).forEach(en => {
              const k = nameKey(en && en.name);
              if (k && !prevByKey.has(k)) prevByKey.set(k, en);
            });
            // One row per enhancement: a faction that reads more than one GDC
            // file (a Space Marines chapter + the parent) sees each generic
            // detachment's enhancements once per file.
            const seenEnh = new Set();
            d.enhancements = entries.filter(x => {
              if (seenEnh.has(x.key)) return false;
              seenEnh.add(x.key);
              return true;
            }).map(x => {
              const prev = prevByKey.get(x.key);
              const keepPrev = prev && prev.description
                && squashText(prev.description).includes(squashText(x.desc))
                && prev.description.length > x.desc.length;
              return { name: x.name, pts: x.pts,
                       description: keepPrev ? prev.description : x.desc };
            });
            return;
          }
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

  // GW sometimes RENAMES a datasheet in a new codex while 40kdc keeps the old
  // name. The two then stop matching and the unit silently loses every GDC
  // merge — weapons, prose, abilities — with nothing logged, because a miss is
  // indistinguishable from "this unit has no GDC sheet". Bridge our name to
  // GW's here. Keys and values are both nameKey()-normalized.
  // Delete an entry once 40kdc adopts GW's name (the keys stop matching, so a
  // stale entry is inert rather than harmful).
  const GDC_NAME_ALIASES = {
    // 2026-09-02 Ork codex pluralised both.
    wartrakk: 'wartrakks',
    rukkatrukksquigbuggy: 'rukkatrukksquigbuggies',
  };

  // nameKey for looking a OUR unit up in a GDC index.
  function dsKey(name) {
    const k = nameKey(name);
    return GDC_NAME_ALIASES[k] || k;
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
        const ds = idx.get(dsKey(unit && unit.name));
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

  // Every ability NAME GW prints on a datasheet, across every group — not
  // just `other` (project11Abilities' source): core, faction and special
  // carry real ability names too (often with no description of their own,
  // e.g. "Leader"/"Support"/"Oath of Moment" — a name is enough here, this
  // is a name-presence check, not a text fill), wargear abilities are full
  // {name, description} entries like `other`, and primarch sub-abilities /
  // the damaged block get their own constructed name. Used by
  // mergeUnitAbilitiesFromGdc's phantom-drop (#91): a 40kdc-linked ability
  // with NO description whose name matches nothing here, on ANY group, is
  // not a real ability on this printed datasheet at all — just checking
  // `other` missed core-shaped names and any group other than `other`.
  function project11AllNames(ds, abilities, primarchGroups, damaged) {
    const names = new Set();
    (abilities || []).forEach(a => a.name && names.add(nameKey(a.name)));
    (primarchGroups || []).forEach(grp =>
      (grp.abilities || []).forEach(a => a.name && names.add(nameKey(a.name))));
    if (damaged && damaged.name) names.add(nameKey(damaged.name));
    const ab = ds && ds.abilities;
    if (ab) {
      ['core', 'faction', 'special', 'wargear'].forEach(key => {
        (Array.isArray(ab[key]) ? ab[key] : []).forEach(a => {
          const n = pickText(a && a.name);
          if (n) names.add(nameKey(n));
        });
      });
    }
    return names;
  }

  // Build one ability entry for a datasheet, capturing exactly the projected
  // fields buildAbilityIndex11 has always indexed, plus `allNames` (every
  // ability name GW prints anywhere on the sheet — see project11AllNames).
  function project11AbilityEntry(ds) {
    const abilities = project11Abilities(ds);
    const primarch = project11PrimarchGroups(ds);
    const damaged = project11Damaged(ds);
    return { abilities, primarch, damaged,
             allNames: project11AllNames(ds, abilities, primarch, damaged) };
  }

  // Flatten the text buildAbilityIndex11's parent-sweep branch checks for a
  // foreign chapter keyword: projected ability names + descriptions, plus the
  // datasheet's own keyword list ({en,...} objects). Upper-cased defensively —
  // in practice GW already ships the keyword in caps ("**SPACE WOLVES**").
  function chapterKeywordSweepText(ds) {
    const abilBits = project11Abilities(ds).map(a => a.name + ' ' + a.description);
    const kwList = Array.isArray(ds && ds.keywords) ? ds.keywords : [];
    const kwBits = kwList.map(kw => pickText(kw));
    return abilBits.concat(kwBits).join(' \n ').toUpperCase();
  }

  function buildAbilityIndex11(files, opts) {
    const idx = new Map();
    const parentPrimaryFile = opts && opts.parentPrimaryFile;

    if (!parentPrimaryFile) {
      // Unchanged for every non-parent caller (a lone faction file, or a
      // chapter's own [chapter, space_marines] pair): first file wins.
      files.forEach(fn => {
        const p = rawCache.get(EDITION + '/' + fn);
        if (!p) return;
        (Array.isArray(p.datasheets) ? p.datasheets : []).forEach(ds => {
          const k = nameKey(pickText(ds && ds.name));   // 11th name is a { en } object
          if (!k || idx.has(k)) return;
          idx.set(k, project11AbilityEntry(ds));
        });
      });
      return idx;
    }

    // Space Marines PARENT sweep. datasheetFilesFor() hands us
    // [space_marines, blacktemplar, bloodangels, darkangels, deathwatch,
    // spacewolves] so a plain first-wins index would let whichever chapter
    // file happens to come first supply any name space_marines.json lacks.
    // Mirror the rule ~/sites/base/dump-audit.py already uses (~646-682):
    // the parent's own file wins outright, and a chapter file supplies a
    // gap-filling name only when EXACTLY ONE chapter file carries it AND it
    // names no OTHER chapter — two-or-more-siblings or a foreign-chapter
    // mention is AMBIGUOUS, skip and report, don't guess.
    //
    // A datasheet naming its OWN chapter is deliberately let through: 40kdc
    // gives its chapters zero units of their own, so chapter-unique units
    // (Emperor's Champion, Death Company, Grey Hunters, Logan Grimnar…) live
    // under this parent and their real GDC text legitimately names their own
    // chapter (Death Company's "Black Rage" says "BLOOD ANGELS"). Rejecting
    // on ANY chapter mention, own included, would regress 13 of those units.
    //
    // On the current snapshot this guards against a FUTURE genuine sibling
    // collision and skips nothing today (Venerable Dreadnought's only chapter
    // keyword, SPACE WOLVES, is its own file's — not foreign — so it is still
    // indexed). It is NOT what fixes the Venerable Dreadnought ability/weapon
    // leak reported in HANDOFF-faction-bleed.md: that text (Fervour of the
    // Ancients, Helfrost cannon, Fenrisian great axe) rides in via upstream
    // 40kdc's own adeptus-astartes unit (`ability_ids`/`weapon_ids`), not
    // through this GDC merge — see items A/C for that path.
    const ambiguousNames = [];

    // 1) The parent's own file wins outright for every name it carries.
    const primaryDoc = rawCache.get(EDITION + '/' + parentPrimaryFile);
    (Array.isArray(primaryDoc && primaryDoc.datasheets) ? primaryDoc.datasheets : []).forEach(ds => {
      const k = nameKey(pickText(ds && ds.name));
      if (!k || idx.has(k)) return;
      idx.set(k, project11AbilityEntry(ds));
    });

    // 2) Collect chapter-file candidates for names the primary file lacks.
    const candidates = new Map(); // nameKey -> [{ file, ds }]
    files.forEach(fn => {
      if (fn === parentPrimaryFile) return;
      const keyword = CHAPTER_KEYWORDS[fn];
      if (!keyword) return; // not a recognised SM chapter file — ignore
      const p = rawCache.get(EDITION + '/' + fn);
      if (!p) return;
      (Array.isArray(p.datasheets) ? p.datasheets : []).forEach(ds => {
        const k = nameKey(pickText(ds && ds.name));
        if (!k || idx.has(k)) return;
        if (!candidates.has(k)) candidates.set(k, []);
        candidates.get(k).push({ file: fn, ds });
      });
    });

    // 3) Resolve each candidate: exactly one sibling file, and no OTHER
    // chapter's keyword in its ability text/keywords, is required to index it.
    candidates.forEach((list, k) => {
      if (list.length !== 1) {
        ambiguousNames.push(pickText(list[0].ds && list[0].ds.name) || k);
        return;
      }
      const { file, ds } = list[0];
      const text = chapterKeywordSweepText(ds);
      const namesForeignChapter = Object.keys(CHAPTER_KEYWORDS).some(otherFile =>
        otherFile !== file && text.includes(CHAPTER_KEYWORDS[otherFile]));
      if (namesForeignChapter) {
        ambiguousNames.push(pickText(ds && ds.name) || k);
        return;
      }
      idx.set(k, project11AbilityEntry(ds));
    });

    if (ambiguousNames.length) {
      console.info('[gdc] ambiguous chapter datasheets: ' + ambiguousNames.join(', '));
    }
    return idx;
  }

  function mergeUnitAbilitiesFromGdc(factions) {
    factions.forEach(faction => {
      const files = datasheetFilesFor(faction.factionName);
      if (files.length === 0) return;
      const isSmParent = faction.factionName === 'Imperium - Adeptus Astartes - Space Marines';
      const idx = buildAbilityIndex11(files, isSmParent
        ? { parentPrimaryFile: gdcFilesFor(faction.factionName)[0] }
        : null);
      if (idx.size === 0) return;
      (faction.units || []).forEach(unit => {
        const entry = idx.get(dsKey(unit && unit.name));
        if (!entry) return;
        const gAbils = entry.abilities || [];
        const gGroups = entry.primarch || [];
        const gDamaged = entry.damaged || null;
        const abils = Array.isArray(unit.abilities) ? unit.abilities : (unit.abilities = []);

        // ── Phantom drop (#91) ──────────────────────────────────────────────
        // 40kdc sometimes links an ability id that has NO authored text
        // anywhere (abilities-index.json has no entry for it) AND that names
        // nothing GW actually prints on this datasheet — Cato Sicarius's
        // `captain-of-the-honour-guard` and Lord Calgar's `lord-calgar` (in
        // Armour of Antilochus) are both this: textless AND absent from GW's
        // own datasheet (GDC has "Knight Champion of Macragge" for Sicarius,
        // not "Captain of the Honour Guard"). Checked against EVERY GDC
        // ability group via `entry.allNames` (core/faction/other/special/
        // wargear/primarch sub-abilities/damaged) — not just `other` — so a
        // name that only lives under core/faction/special/wargear isn't
        // mistaken for a phantom. Only ever drops a NON-core, NON-injected,
        // description-less ability: a real (even textless) core rule or
        // anything this app itself injected is never a candidate, and
        // anything with prose is by definition not a nameless phantom.
        // Runs before hasNonCore below so a dropped phantom can also reopen
        // the fill gate it was wrongly holding shut.
        for (let i = abils.length - 1; i >= 0; i--) {
          const a = abils[i];
          if (a.isCore || a._injected || a.description) continue;
          if (entry.allNames && entry.allNames.has(nameKey(a.name))) continue;
          console.info('[gdc] dropped phantom ability "' + a.name + '" on ' + (unit && unit.name));
          abils.splice(i, 1);
        }

        if (gAbils.length === 0 && gGroups.length === 0 && !gDamaged) return;
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
        // ── Subset fill (#91) ────────────────────────────────────────────────
        // The hasNonCore gate above exists to avoid doubles when our ability
        // names don't line up with GW's — but a full-subset match is exactly
        // the case where no double is possible: if EVERY one of our
        // (post-phantom-drop) non-core abilities already name-matches one of
        // GW's `other` abilities, there is nothing of ours left unaccounted
        // for, so filling in the rest of GW's `other` list is safe. This is
        // what lets Cato Sicarius — left with only "Knight Champion of
        // Macragge" after the phantom drop above, which IS on GW's sheet —
        // receive GW's remaining "Honour or Death".
        const nonCoreOurs = abils.filter(a => !a.isCore && !a._injected);
        const gOtherKeys = new Set(gAbils.map(g => nameKey(g.name)));
        const isFullSubset = nonCoreOurs.length > 0
          && nonCoreOurs.every(a => gOtherKeys.has(nameKey(a.name)));
        const fillOpen = !hasNonCore || isFullSubset;
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
          } else if (fillOpen && g.description) {
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
    _dsKey: dsKey,
    // dc-adapter's GDC-authority pass rebuilds the leader graph and needs the
    // same prose parser mergeUnitDataIntoFactions uses.
    _leaderTargets: leaderTargets,
    _EDITION: EDITION,
  };
})();
