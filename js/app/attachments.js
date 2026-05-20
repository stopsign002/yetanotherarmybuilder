// app/attachments.js — leader / bodyguard attachment rule logic.
//
// Centralises the lookup that powers BOTH the right-panel "Led By" badge
// in `js/ui/detail.js` AND the drag-to-attach drop-target highlight in
// `js/ui/flip-animations.js`. Soft enforcement: callers can ask
// `canAttach(source, target)` and decide what to do with the result —
// validators block, drag-and-drop just colours the outline.
//
// Two complementary data sources, queried in order:
//   1. `target.gdcLeadBy` — a structured `string[]` of valid bodyguard
//      unit names. Attached by `js/gdc.js` during faction merge from
//      the Game-Datacards layer. Most reliable when present.
//      Wait — the data lives on the LEADER pointing at its valid
//      bodyguard targets, not on the bodyguard. So we query the SOURCE's
//      gdcLeadBy when checking source-leads-target. See gdc.js:306–308.
//   2. The prose reverse-index — scans every loaded unit's `abilities`
//      array for "can be attached to" strings, exactly the way
//      `detail.js:29–51` used to do inline. Catches units the GDC layer
//      missed and faction quirks the data hasn't caught up with yet.
//
// `gdcLeadBy` semantics: each leader unit carries an array of unit-NAME
// strings naming the bodyguards it can attach to. So the forward
// direction (does `source` lead `target`?) reads `source.gdcLeadBy`;
// the reverse direction (which leaders can attach to `target`?) walks
// every loaded unit's `gdcLeadBy` and collects those that list
// `target.name`. Both directions are case-insensitive + diacritic-folded
// via the parser-internal `I.foldKey` helper, so spelling drift between
// the BSData unit name and the GDC enum value doesn't drop matches.
(function () {
  const App = window.App = window.App || {};

  // The parser exposes a `foldKey` on `WahapediaParser._internal` for
  // diacritic+case normalisation. Defensive shim: if it isn't loaded yet
  // (early bootstrap order, smoke tests), fall back to a plain lowercase
  // so the module still functions — just without diacritic folding.
  function foldName(s) {
    const P = window.WahapediaParser;
    if (P && P._internal && typeof P._internal.foldKey === 'function') {
      return P._internal.foldKey(s);
    }
    return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Memoised prose reverse-index, rebuilt when state.factionsVersion
  // advances (new faction loaded). Map<foldedTargetName, Set<leaderUnit>>.
  let _proseCache    = null;
  let _proseVersion  = -1;

  function buildProseIndex(allUnits) {
    const idx = new Map();
    if (!Array.isArray(allUnits)) return idx;
    for (let i = 0; i < allUnits.length; i++) {
      const leader = allUnits[i];
      const abilities = (leader && leader.abilities) || [];
      for (let j = 0; j < abilities.length; j++) {
        const a = abilities[j];
        const desc = a && a.description;
        if (!desc || !/can be attached to/i.test(desc)) continue;
        const attachText = desc.replace(/^.*?can be attached to[^:]*:/i, '').trim();
        const names = attachText.split(/[,■\n●•]+/);
        for (let k = 0; k < names.length; k++) {
          const folded = foldName(names[k]);
          if (!folded) continue;
          let bucket = idx.get(folded);
          if (!bucket) { bucket = new Set(); idx.set(folded, bucket); }
          bucket.add(leader);
        }
      }
    }
    return idx;
  }

  function ensureProseIndex() {
    const state = App.state || {};
    const version = state.factionsVersion || 0;
    if (_proseCache === null || _proseVersion !== version) {
      _proseCache   = buildProseIndex(state.allUnits || []);
      _proseVersion = version;
    }
    return _proseCache;
  }

  // Primary check used by drag-and-drop. `source` is the unit being
  // dragged, `target` is the host it's being dropped onto.
  //
  // Returns `{ ok: bool, source: 'gdc' | 'prose' | 'unknown' }`:
  //   · ok = true & source = 'gdc'   → GDC explicitly lists target as a
  //                                    valid bodyguard.
  //   · ok = true & source = 'prose' → BSData "can be attached to" text
  //                                    lists target (or list-of-things
  //                                    matching target's name).
  //   · ok = false & source = 'unknown'
  //                                  → neither source matched. Caller
  //                                    decides whether to allow the
  //                                    attachment anyway (drag-and-drop
  //                                    does, with an amber outline +
  //                                    toast).
  //
  // Caller is responsible for self-attach / cycle guards — those need
  // entry-graph awareness this module doesn't have.
  function canAttach(sourceUnit, targetUnit) {
    if (!sourceUnit || !targetUnit) return { ok: false, source: 'unknown' };
    const targetFolded = foldName(targetUnit.name);
    if (!targetFolded) return { ok: false, source: 'unknown' };

    // 1. GDC structured list on the source.
    const leadBy = Array.isArray(sourceUnit.gdcLeadBy) ? sourceUnit.gdcLeadBy : null;
    if (leadBy && leadBy.length) {
      for (let i = 0; i < leadBy.length; i++) {
        if (foldName(leadBy[i]) === targetFolded) return { ok: true, source: 'gdc' };
      }
    }

    // 2. Prose reverse-index. The index is keyed by target name → set of
    //    leader units; check if `sourceUnit` is in the bucket for this
    //    target. `sourceUnit` here is identity-compared, which works
    //    because the index stores references to the same loaded unit
    //    objects callers pass in.
    const proseIdx = ensureProseIndex();
    const bucket = proseIdx.get(targetFolded);
    if (bucket && bucket.has(sourceUnit)) return { ok: true, source: 'prose' };

    return { ok: false, source: 'unknown' };
  }

  // Forward lookup: every unit the `source` could attach to, drawn from
  // the GDC list first and the prose index as a backup. Used as a
  // future hook for an "auto-suggest valid bodyguards" affordance in
  // the detail panel. Returns plain `[{ name, factionName }]`.
  function candidateTargetsFor(sourceUnit) {
    if (!sourceUnit) return [];
    const seen = new Set();
    const out  = [];
    const leadBy = Array.isArray(sourceUnit.gdcLeadBy) ? sourceUnit.gdcLeadBy : [];
    for (let i = 0; i < leadBy.length; i++) {
      const key = foldName(leadBy[i]);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ name: leadBy[i], factionName: sourceUnit._factionName || null });
      }
    }
    // Prose-side enrichment: also look at the source unit's own
    // abilities for "can be attached to" lists.
    const abilities = sourceUnit.abilities || [];
    for (let i = 0; i < abilities.length; i++) {
      const desc = abilities[i] && abilities[i].description;
      if (!desc || !/can be attached to/i.test(desc)) continue;
      const attachText = desc.replace(/^.*?can be attached to[^:]*:/i, '').trim();
      const names = attachText.split(/[,■\n●•]+/);
      for (let k = 0; k < names.length; k++) {
        const nm = names[k].trim();
        const key = foldName(nm);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ name: nm, factionName: sourceUnit._factionName || null });
      }
    }
    return out;
  }

  // Reverse lookup: every leader unit that lists `target` as a valid
  // bodyguard. Used by the right-panel "Led By" badge — this REPLACES
  // the inlined `buildLedByIndex` / `getLedByFor` in detail.js so both
  // the panel and drag-and-drop hit the same data.
  function candidateLeadersFor(targetUnit) {
    if (!targetUnit || !targetUnit.name) return [];
    const targetFolded = foldName(targetUnit.name);
    if (!targetFolded) return [];
    const seenIds = new Set([targetUnit.id]);
    const out = [];
    const state = App.state || {};
    const allUnits = state.allUnits || [];

    // 1. Walk every loaded unit's gdcLeadBy.
    for (let i = 0; i < allUnits.length; i++) {
      const leader = allUnits[i];
      if (!leader || seenIds.has(leader.id)) continue;
      const leadBy = Array.isArray(leader.gdcLeadBy) ? leader.gdcLeadBy : null;
      if (!leadBy) continue;
      for (let j = 0; j < leadBy.length; j++) {
        if (foldName(leadBy[j]) === targetFolded) {
          seenIds.add(leader.id);
          out.push({ name: leader.name, factionName: leader._factionName || null });
          break;
        }
      }
    }

    // 2. Prose index for anything GDC didn't cover.
    const proseIdx = ensureProseIndex();
    const bucket = proseIdx.get(targetFolded);
    if (bucket) {
      bucket.forEach(leader => {
        if (!leader || seenIds.has(leader.id)) return;
        seenIds.add(leader.id);
        out.push({ name: leader.name, factionName: leader._factionName || null });
      });
    }
    return out;
  }

  // Invalidate the prose-index cache. Hooked into bootstrap so a fresh
  // faction load after sync rebuilds on next query.
  function invalidate() {
    _proseCache   = null;
    _proseVersion = -1;
  }

  App.Attachments = {
    canAttach,
    candidateTargetsFor,
    candidateLeadersFor,
    invalidate,
  };
})();
