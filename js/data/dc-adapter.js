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
    const costs = (u.points || []).map((p) => p.cost).filter((c) => c != null);
    const squadOptions = (u.points || [])
      .map((p) => ({ pts: p.cost, models: p.models || null }))
      .sort((a, b) => a.pts - b.pts);
    const abilities = (uv.abilities || []).map((a) => ({
      name: abilityName(a), description: textFor(a.id), isCore: false,
    })).filter((a) => a.name);
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
      points: costs.length ? Math.min.apply(null, costs) : 0,
      pointsOptions: costs.slice().sort((a, b) => a - b),
      squadOptions,
      description: '',
      isLegends: !!u.is_legend,
      _provisional: !!u.points_provisional,
    };
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
        armyRules: [],
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
