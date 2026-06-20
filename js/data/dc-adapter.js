// dc-adapter.js — TRIAL: source yaab's faction data from the 40kdc 11th-edition
// dataset (window.DC, bundled by build/dc-entry.mjs) instead of BattleScribe XML.
//
// It maps 40kdc's linked objects into the EXACT shape WahapediaParser.parse()
// emitted (see docs/PARSER.md), so every downstream renderer keeps working, and
// it overrides BSData.loadAllFactions as a drop-in. The GDC overlay (gdc.js) is
// kept for stratagem/enhancement/detachment-rule prose, which 40kdc's
// pre-launch dataslate hasn't authored yet (hybrid strategy).
(function () {
  const DC = window.DC;
  if (!DC) { console.error('[DC] window.DC missing — bundle not loaded'); return; }

  // 40kdc faction_id → yaab BSData-style faction name. These names are the
  // contract GDC (FACTION_TO_GDC) and App.CHAPTER_PARENTS key on.
  const FACTION_NAME = {
    'adepta-sororitas':       'Imperium - Adepta Sororitas',
    'adeptus-astartes':       'Imperium - Adeptus Astartes - Space Marines',
    'adeptus-custodes':       'Imperium - Adeptus Custodes',
    'adeptus-mechanicus':     'Imperium - Adeptus Mechanicus',
    'agents-of-the-imperium': 'Imperium - Agents of the Imperium',
    'astra-militarum':        'Imperium - Astra Militarum',
    'grey-knights':           'Imperium - Grey Knights',
    'imperial-knights':       'Imperium - Imperial Knights',
    'aeldari':                'Xenos - Aeldari',
    'drukhari':               'Xenos - Drukhari',
    'genestealer-cults':      'Xenos - Genestealer Cults',
    'leagues-of-votann':      'Xenos - Leagues of Votann',
    'necrons':                'Xenos - Necrons',
    'orks':                   'Xenos - Orks',
    'tau-empire':             "Xenos - T'au Empire",
    'tyranids':               'Xenos - Tyranids',
    'chaos-daemons':          'Chaos - Chaos Daemons',
    'chaos-knights':          'Chaos - Chaos Knights',
    'chaos-space-marines':    'Chaos - Chaos Space Marines',
    'death-guard':            'Chaos - Death Guard',
    'emperors-children':      "Chaos - Emperor's Children",
    'thousand-sons':          'Chaos - Thousand Sons',
    'world-eaters':           'Chaos - World Eaters',
    // SM chapters: 0 datasheets in 40kdc yet, but they own detachments. Emit as
    // chapter factions so they're selectable; units inherit from SM parent via
    // App.CHAPTER_PARENTS.
    'black-templars':  'Imperium - Adeptus Astartes - Black Templars',
    'blood-angels':    'Imperium - Adeptus Astartes - Blood Angels',
    'dark-angels':     'Imperium - Adeptus Astartes - Dark Angels',
    'deathwatch':      'Imperium - Adeptus Astartes - Deathwatch',
    'imperial-fists':  'Imperium - Adeptus Astartes - Imperial Fists',
    'iron-hands':      'Imperium - Adeptus Astartes - Iron Hands',
    'raven-guard':     'Imperium - Adeptus Astartes - Raven Guard',
    'salamanders':     'Imperium - Adeptus Astartes - Salamanders',
    'space-wolves':    'Imperium - Adeptus Astartes - Space Wolves',
    'ultramarines':    'Imperium - Adeptus Astartes - Ultramarines',
    'white-scars':     'Imperium - Adeptus Astartes - White Scars',
    'crimson-fists':   'Imperium - Adeptus Astartes - Imperial Fists',
  };

  // ability_id → display text from the separate 40kdc-abilities store.
  function textFor(id) {
    const e = id && DC.abilityText[id];
    if (!e) return '';
    return e.raw_text || e.effect || '';
  }
  // resolve an AbilityView/raw ability's name
  const abilityName = (a) => a && (a.name || (a.raw && a.raw.name)) || '';

  // The fixed GW datasheet CORE abilities. Matched by name (anchored, so a
  // unit ability that merely starts with one of these words doesn't false-hit)
  // with an optional trailing rating — "Feel No Pain 5+", "Scouts 9\"",
  // "Deadly Demise D6+2". "Leader" is intentionally absent: 40kdc's generic
  // leader ability is dropped upstream of this and surfaced via attachmentRole.
  const CORE_ABILITY_RE =
    /^(Deadly Demise|Deep Strike|Feel No Pain|Fights First|Firing Deck|Infiltrators|Lone Operative|Scouts|Stealth|Hover)\b/i;

  // ── stat formatting (BSData rendered M as 6", Sv as 3+, Ld as 6+) ──────────
  const sv  = (v) => (v == null ? '' : `${v}+`);
  const mv  = (v) => (v == null ? '' : `${v}"`);
  const num = (v) => (v == null ? '' : String(v));
  function profileStats(p) {
    return { name: p.name || '', M: mv(p.M), T: num(p.T), SV: sv(p.Sv),
             W: num(p.W), LD: sv(p.Ld), OC: num(p.OC) };
  }

  // ── weapons: 40kdc weapon profiles → flat rows the weapon table renders ────
  function weaponRows(weaponViews) {
    const rows = [];
    const seen = new Set();
    (weaponViews || []).forEach((wv) => {
      const w = wv.raw || wv;
      if (!w || !Array.isArray(w.profiles)) return;
      const melee = w.type === 'melee';
      w.profiles.forEach((p) => {
        const st = p.stats || {};
        const name = p.name || w.name || '';
        const key = (melee ? 'm:' : 'r:') + name + JSON.stringify(st);
        if (seen.has(key)) return; seen.add(key);
        const row = {
          name,
          _typeName: melee ? 'Melee' : 'Ranged',
          Range: melee ? 'Melee' : (p.range != null ? `${p.range}"` : '—'),
          A: num(st.A), S: num(st.S), AP: num(st.AP), D: num(st.D),
        };
        if (melee) row.WS = sv(st.WS != null ? st.WS : st.BS);
        else       row.BS = sv(st.BS);
        const kws = (p.keywords || []).map((k) => k.keyword_id || k).filter(Boolean);
        if (kws.length) row.Keywords = kws.map(prettyKw).join(', ');
        rows.push(row);
      });
    });
    return rows;
  }
  const prettyKw = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // ── one 40kdc unit → one yaab Unit ─────────────────────────────────────────
  function toUnit(uv) {
    const u = uv.raw || uv;
    const profiles = u.profiles && u.profiles.length ? u.profiles : [{ name: u.name }];
    const modelStats = profiles.map(profileStats);
    const first = profiles[0] || {};
    // 11e points have two independent dimensions in points[]:
    //   - squad size (`models`): 5 for X, 10 for Y
    //   - per-army-ordinal (`unit_count_min/max`): your 1st-2nd cost base, 3rd+
    //     cost more. Absent (the common case) = cost applies to every copy.
    // Split them: squadOptions carries one BASE cost per distinct size; the
    // ordinal surcharge (flat per unit across sizes) goes in `ordinal`.
    const { squadOptions, pointsOptions, ordinal } = parsePoints(u.points || []);
    // Drop 40kdc's generic "leader" ability. Every leader datasheet (230 units
    // across every faction) carries the SAME ability_id "leader", and the flat
    // ability-text store (abilities-index.json) holds a single entry for it —
    // the Tyranids' "…can be attached to: RAVENERS" text. Rendering it made
    // EVERY leader show a bogus "Leader" ability claiming it leads Raveners, and
    // poisoned the leader/bodyguard reverse-index (attachments.js) so every
    // leader appeared under Raveners' "Led By". The real attach relationships
    // come from the GDC `gdcLeadBy` overlay; the Leader keyword itself is now
    // recorded on `attachmentRole` for the UI. (Same root cause — ability ids
    // are faction-scoped in 40kdc, but the text store keys them globally — also
    // mis-keys faction-specific prose like "Fervour of the Ancients"; that
    // broader fix is tracked separately.)
    const abilities = (uv.abilities || [])
      .filter((a) => a && a.id !== 'leader')
      .map((a) => {
        const raw = a.raw || a;
        const name = abilityName(a);
        // Flag core abilities (Deep Strike, Scouts, Feel No Pain, …) so the
        // card renders them as a compact inline "CORE:" list instead of full
        // ability blocks. Two signals because 40kdc's `ability_type` tagging is
        // uneven: it's authoritative when set to "core", but some datasheet
        // copies of a core rule are mis-typed "unit" (e.g. Fights First is
        // never tagged core anywhere), so we also match the fixed GW core-rule
        // names (with their trailing rating, e.g. "Feel No Pain 5+").
        const isCore = raw.ability_type === 'core' || CORE_ABILITY_RE.test(name);
        return { name, description: textFor(a.id), isCore };
      })
      .filter((a) => a.name);
    return {
      id: u.id,
      name: u.name,
      type: 'unit',
      stats: { M: modelStats[0].M, T: modelStats[0].T, SV: modelStats[0].SV,
               W: modelStats[0].W, LD: modelStats[0].LD, OC: modelStats[0].OC },
      modelStats: modelStats.length > 1 ? modelStats : [{ name: '', ...modelStats[0] }],
      invulnSave: first.invuln_sv != null ? sv(first.invuln_sv) : null,
      weapons: weaponRows(uv.weapons),
      abilities,
      keywords: (u.keywords || []).concat(u.faction_keywords || []),
      wargearOptions: [],
      points: pointsOptions.length ? pointsOptions[0] : 0,
      pointsOptions,
      squadOptions,
      ordinal,                       // { fromCount, surcharge } or null
      description: '',
      isLegends: !!u.is_legend,
      attachmentRole: u.attachment_role || null,   // 'leader' | 'support' | null
      _provisional: !!u.points_provisional,
    };
  }

  // Parse 40kdc points[] into { squadOptions (base cost per size), pointsOptions
  // (sorted unique base costs), ordinal: {fromCount, surcharge}|null }.
  function parsePoints(rawPts) {
    const bySize = new Map(); // models -> { base, surcharged }
    let fromCount = null;
    for (const p of rawPts) {
      if (p.cost == null) continue;
      const isBase = p.unit_count_min == null || p.unit_count_min === 1;
      const cur = bySize.get(p.models) || { base: null, surcharged: null };
      if (isBase) cur.base = (cur.base == null) ? p.cost : Math.min(cur.base, p.cost);
      else        cur.surcharged = (cur.surcharged == null) ? p.cost : Math.min(cur.surcharged, p.cost);
      bySize.set(p.models, cur);
      if (p.unit_count_min != null && p.unit_count_min > 1 && fromCount == null) {
        fromCount = p.unit_count_min;     // start of the pricier band
      }
    }
    const squadOptions = [...bySize.entries()]
      .map(([models, c]) => ({ models: models || null, pts: c.base != null ? c.base : c.surcharged }))
      .filter((o) => o.pts != null)
      .sort((a, b) => a.pts - b.pts);
    // Flat per-unit surcharge = surcharged - base (same across squad sizes in the data)
    let ordinal = null;
    if (fromCount != null) {
      let surcharge = 0;
      for (const c of bySize.values()) {
        if (c.base != null && c.surcharged != null) { surcharge = c.surcharged - c.base; break; }
      }
      if (surcharge > 0) ordinal = { fromCount, surcharge };
    }
    const pointsOptions = [...new Set(squadOptions.map((o) => o.pts))].sort((a, b) => a - b);
    return { squadOptions, pointsOptions, ordinal };
  }

  // ── detachment: 40kdc detachment → yaab detachment {name, rules, enhancements}
  function toDetachment(d, enhById) {
    const rule = d.detachment_rule_id;
    const rules = rule ? [{ name: d.name, description: textFor(rule) }] : [];
    const enhancements = (d.enhancement_ids || []).map((id) => {
      const e = enhById.get(id);
      if (!e) return null;
      return { name: e.name, pts: e.cost != null ? e.cost : 0, description: textFor(e.ability_id) };
    }).filter(Boolean);
    return { name: d.name, rules, enhancements,
             stratagemIds: d.stratagem_ids || [] };
  }

  // ── stratagems: 40kdc structure + text, GDC as text fallback ───────────────
  const cap = (s) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
  const titleCase = (s) => String(s || '').toLowerCase().split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  const foldName = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9]/g, '');

  // Build this detachment's stratagems from 40kdc (authoritative 11e structure +
  // CP/phase), with text from the 40kdc-abilities store where it's authored.
  function dcStratsFor(stratagemIds) {
    return (stratagemIds || []).map((id) => {
      const s = DC.stratagems.get(id);
      if (!s) return null;
      return {
        name: s.name,
        cp: s.cp_cost != null ? s.cp_cost : null,
        phase: cap((s.phases || [])[0] || ''),
        type: s.type || '',
        description: textFor(s.ability_id),
        source: '40kdc',
      };
    }).filter(Boolean);
  }

  // Reconcile 40kdc strats with the GDC-attached list on a detachment, in place.
  // 40kdc decides which strats exist + CP/phase; text is 40kdc-where-authored,
  // GDC-where-not; GDC-only strats (no 40kdc match) are appended so we never lose
  // text GDC has. Writes the union back to `detachment.gdcStratagems` (the field
  // faction-rules.js already renders), and returns coverage counts.
  function reconcileStrats(detachment) {
    const dcList  = dcStratsFor(detachment.stratagemIds);
    const gdcList = Array.isArray(detachment.gdcStratagems) ? detachment.gdcStratagems : [];
    if (dcList.length === 0) return { n40kdc: 0, nGdcFallback: 0, total: gdcList.length };
    const gdcByKey = new Map();
    gdcList.forEach((g) => { const k = foldName(g.name); if (k && !gdcByKey.has(k)) gdcByKey.set(k, g); });
    const usedGdc = new Set();
    let nGdcFallback = 0;
    const out = dcList.map((d) => {
      const k = foldName(d.name);
      const g = gdcByKey.get(k);
      if (g) usedGdc.add(k);
      const description = d.description || (g ? g.description : '');
      if (!d.description && g && g.description) nGdcFallback++;
      return {
        name: g ? g.name : titleCase(d.name),
        cp:   d.cp != null ? d.cp : (g ? g.cp : null),
        phase: d.phase || (g ? g.phase : ''),
        type:  d.type  || (g ? g.type  : ''),
        description,
        source: d.description ? '40kdc' : (g && g.description ? 'gdc' : '40kdc'),
      };
    });
    gdcList.forEach((g) => { if (!usedGdc.has(foldName(g.name))) out.push(g); });
    detachment.gdcStratagems = out;
    return { n40kdc: dcList.length, nGdcFallback, total: out.length };
  }

  // Faction army rule. 40kdc names the rule via `faction_rule_id` but omits the
  // prose for IP, so we seed { name, description } here (name from the abilities
  // collection, text from the ability-text store if it's authored — usually
  // empty) and let the GDC overlay fill the real rules text in
  // App.GDC.mergeIntoFactions (40kdc-first, GDC fallback — same model as
  // stratagems). Without this the Army Rules subsection was always empty.
  function buildArmyRules(f) {
    const id = f && f.faction_rule_id;
    if (!id) return [];
    let name = '';
    try {
      const av = DC.abilities.getAny ? DC.abilities.getAny(id) : DC.abilities.get(id);
      name = (av && (av.name || (av.raw && av.raw.name))) || '';
    } catch (_) { /* ambiguous/missing — fall back to the id */ }
    if (!name) name = titleCase(String(id).replace(/-/g, ' '));
    return [{ name, description: textFor(id) }];
  }

  // ── build all yaab faction objects from 40kdc ──────────────────────────────
  function buildFactions() {
    const enhById = new Map();
    DC.enhancements.all.forEach((e) => enhById.set(e.id, e));
    const out = [];
    DC.factions.all.forEach((fv) => {
      const f = fv.raw || fv;
      const factionName = FACTION_NAME[f.id];
      if (!factionName) return; // unmapped (e.g. Titans) — skip in trial
      const units = (fv.units || []).map(toUnit);
      const dets = DC.detachments.byFaction(f.id).map((d) => toDetachment(d, enhById));
      if (units.length === 0 && dets.length === 0) return;
      out.push({
        factionName,
        filename: factionName,
        unitCount: units.length,
        units,
        armyRules: buildArmyRules(f),
        detachments: dets,
        linkedCatalogues: [],
        _source: '40kdc',
      });
    });
    return out;
  }

  // ── drop-in BSData replacement ─────────────────────────────────────────────
  async function loadAllFactions(onProgress, onFactionLoaded /*, signal */) {
    let factions;
    try { factions = buildFactions(); }
    catch (e) { console.error('[DC] buildFactions failed:', e); throw e; }
    const total = factions.length;
    console.info(`[DC] built ${total} factions from 40kdc 11e (`,
      factions.reduce((n, f) => n + f.units.length, 0), 'units )');
    factions.forEach((faction, i) => {
      if (onProgress) onProgress(i + 1, total, faction.factionName);
      if (onFactionLoaded) onFactionLoaded(faction);
    });

    // Phase 3: GDC overlay for stratagem text (hybrid). Defensive — never fatal.
    try {
      if (window.App && App.GDC && App.state && Array.isArray(App.state.factions)) {
        const names = App.state.factions.map((f) => f.factionName);
        await App.GDC.loadAll(names);
        App.GDC.mergeIntoFactions(App.state.factions);
        if (typeof App.GDC.mergeUnitDataIntoFactions === 'function') {
          App.GDC.mergeUnitDataIntoFactions(App.state.factions);
        }

        // Reconcile: prefer 40kdc strat text, fall back to GDC. Runs AFTER the
        // GDC merge so detachment.gdcStratagems is populated. Self-improving —
        // GDC reliance shrinks as 40kdc authors more ability_id text.
        let agg = { n40kdc: 0, nGdcFallback: 0, total: 0 };
        App.state.factions.forEach((f) => (f.detachments || []).forEach((d) => {
          const c = reconcileStrats(d);
          agg.n40kdc += c.n40kdc; agg.nGdcFallback += c.nGdcFallback; agg.total += c.total;
        }));
        console.info(`[DC] stratagems: ${agg.total} shown across detachments — ` +
          `${agg.n40kdc} from 40kdc (${agg.nGdcFallback} using GDC text fallback)`);

        try {
          if (window.UI && typeof UI.updateFactionRules === 'function') {
            const cf = (typeof App.getCurrentFaction === 'function') ? App.getCurrentFaction() : null;
            UI.updateFactionRules(cf, App.state.selectedDetachment || null);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[DC] GDC overlay failed (non-fatal):', e && e.message ? e.message : e);
    }
  }

  // Override the data source. Keep the same public surface bsdata.js exposed.
  window.BSData = {
    loadAllFactions,
    fetchFileList: async () => [],
    fetchFile: async () => { throw new Error('40kdc trial: no XML fetch'); },
    clearCache: () => {},
    clearFactionCache: async () => { try { await window.YaabDB.clearFactions(); } catch (_) {} },
    _build: buildFactions,
    _dcStratsFor: dcStratsFor,
    _reconcileStrats: reconcileStrats,
  };

  // attachments.js reaches into WahapediaParser._internal.foldKey. Provide a stub
  // matching its name-normalization so the leader-attachment graph keeps working.
  window.WahapediaParser = window.WahapediaParser || {};
  window.WahapediaParser._internal = window.WahapediaParser._internal || {};
  if (!window.WahapediaParser._internal.foldKey) {
    window.WahapediaParser._internal.foldKey = (s) => String(s || '')
      .toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9]/g, '');
  }

  console.info('[DC] 40kdc adapter active — BSData overridden.');
})();
