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

  // The set of ARMY-RULE ability ids — every faction's faction_rule_id(s). 40kdc
  // links the army rule (Oath of Moment, Reanimation Protocols, Waaagh!, For the
  // Greater Good, Mission Tactics, Voice of Command, …) onto individual
  // datasheets as an ability_type:'faction' ability, so it was rendering on unit
  // cards — usually with no text, since the prose lives at the army level. The
  // army rule already shows in the Army Rules section (buildArmyRules), so we
  // strip it from unit ability lists. Keyed by id (precise): this does NOT touch
  // genuine unit abilities that merely happen to be tagged 'faction' upstream
  // (e.g. "Super-heavy Walker", "Synapse") since those aren't faction_rule_ids.
  const ARMY_RULE_IDS = (function () {
    const s = new Set();
    (DC.factions && DC.factions.all || []).forEach((fv) => {
      const f = fv.raw || fv;
      if (f && f.faction_rule_id) s.add(f.faction_rule_id);
      if (f && Array.isArray(f.faction_rule_ids)) f.faction_rule_ids.forEach((x) => x && s.add(x));
    });
    return s;
  })();

  // The fixed GW datasheet CORE abilities. Matched by name (anchored, so a
  // unit ability that merely starts with one of these words doesn't false-hit)
  // with an optional trailing rating — "Feel No Pain 5+", "Scouts 9\"",
  // "Deadly Demise D6+2". "Leader" is intentionally absent: 40kdc's generic
  // leader ability is dropped upstream of this and surfaced via attachmentRole.
  const CORE_ABILITY_RE =
    /^(Deadly Demise|Deep Strike|Feel No Pain|Fights First|Firing Deck|Infiltrators|Lone Operative|Scouts|Stealth|Hover)\b/i;

  // Hand-patches for core abilities the upstream 40kdc dataset is missing on a
  // unit's datasheet. Keyed by unit id → core ability ids to inject. This is
  // SELF-HEALING: the inject is skipped if the unit already lists the ability,
  // so each entry no-ops automatically once 40kdc links it and the bundle is
  // refreshed — at which point the entry can be deleted. Keep each line tagged
  // with the upstream issue so it's auditable.
  //   nekrosor-ammentar / deep-strike → wn-mitch/40kdc-data#51
  //   land-speeder / deep-strike: the Land Speeder datasheet in 40kdc-data links
  //     ZERO abilities — an upstream data gap. Its printed card has the CORE
  //     "Deep Strike" ability, and deep-strike text IS in the store, so inject it.
  const MISSING_CORE_ABILITIES = {
    'nekrosor-ammentar': ['deep-strike'],
    'land-speeder': ['deep-strike'],
  };

  // Hand-patches for NON-core unit abilities (with prose) the upstream 40kdc
  // dataset fails to link on a unit's datasheet. Keyed by unit id → list of
  // abilities to inject. Each entry is EITHER a string ability-id (name +
  // prose pulled from the abilities-index store via textFor — only works when
  // that id already has authored text there) OR a fully hand-authored
  // { name, description } object (used when the store has NO entry for it).
  //
  // Same SELF-HEALING contract as MISSING_CORE_ABILITIES: injection is skipped
  // if the unit already lists an ability of that name, so each entry no-ops
  // automatically once 40kdc links it and the bundle is refreshed (at which
  // point the entry can be deleted). Keep each entry tagged with the upstream gap.
  //   eradicator-squad-with-heavy-bolters / Overlapping Detonations:
  //     the HB variant's datasheet in 40kdc-data links ZERO abilities — an
  //     upstream data gap. Its real datasheet ability is "Overlapping
  //     Detonations" (NOT the base melta squad's "Total Obliteration"), and the
  //     store has no text for it, so we hand-author from the printed card.
  //   land-speeder / Purgation Run:
  //     the Land Speeder datasheet in 40kdc-data links ZERO abilities — an
  //     upstream data gap. Its datasheet ability "Purgation Run" has no text in
  //     the store, so we hand-author it from the printed card. (Its CORE "Deep
  //     Strike" is injected separately via MISSING_CORE_ABILITIES above.)
  const MISSING_UNIT_ABILITIES = {
    'eradicator-squad-with-heavy-bolters': [{
      name: 'Overlapping Detonations',
      description:
        'In your Shooting phase, when this unit is selected to shoot, you can ' +
        'select one non-MONSTER/VEHICLE enemy unit visible to it. While making ' +
        "attacks, this unit's heavy bolters that targeted that selected unit " +
        'have the [BLAST] ability.',
    }],
    'land-speeder': [{
      name: 'Purgation Run',
      description:
        'In your Shooting phase, after this unit has shot, it can make a ' +
        'normal move of up to D6". If it does, until the end of the turn, ' +
        'this unit is not eligible to declare a charge.',
    }],
  };

  // Hand-patched army-rule prose the upstream 40kdc dataset names (via a
  // faction's faction_rule_id) but leaves without text — and which the GDC
  // overlay doesn't fill either — so the Army Rules card would render the name
  // with no rules text. Keyed by faction_rule_id → canonical current-edition
  // prose. SELF-HEALING: buildArmyRules only falls back to this when
  // textFor(id) is empty, so each entry no-ops automatically once 40kdc (or
  // GDC) authors the text, at which point the entry can be deleted.
  //   oath-of-moment: Space Marines' army rule; upstream 40kdc-data has no
  //     ability-text entry for it and GDC carries no SM army-rule prose.
  const MISSING_ARMY_RULE_TEXT = {
    'oath-of-moment':
      "If your Army Faction is ADEPTUS ASTARTES, at the start of your Command " +
      "phase, select one unit from your opponent's army. Until the start of your " +
      "next Command phase, that enemy unit is your Oath of Moment target. Each " +
      "time a model with this ability makes an attack that targets your Oath of " +
      "Moment target:\n" +
      "- You can re-roll the Hit roll.\n" +
      "- If you are using a Codex: Space Marines Detachment and your army does " +
      "not include one or more units with the BLACK TEMPLARS, BLOOD ANGELS, DARK " +
      "ANGELS, DEATHWATCH or SPACE WOLVES keywords, add 1 to the Wound roll as " +
      "well.",
  };

  // Space Marine chapter army rules. In 40kdc every SM chapter is emitted as its
  // own (unit-less) faction, but their `faction_rule_id` is unreliable: most
  // point at the shared `oath-of-moment`, while a few point at a MIScategorized
  // *detachment* rule (blood-angels→the-red-thirst, deathwatch→mission-tactics)
  // that carries no army-rule text and must NOT render as an army rule. So we
  // normalize per chapter instead of trusting faction_rule_id:
  //   - Default (Blood Angels, Dark Angels, Deathwatch, Imperial Fists, Iron
  //     Hands, Raven Guard, Salamanders, Ultramarines, White Scars, Crimson
  //     Fists): no distinct army rule — they share Oath of Moment.
  //   - black-templars: Templar Vows REPLACES Oath of Moment (Heirs of Sigismund).
  //   - space-wolves: Curse of the Wulfen IN ADDITION to Oath of Moment.
  // SELF-HEALING: remove an override once 40kdc authors a real faction rule +
  // text for that chapter and it flows through buildArmyRules normally.
  const SM_CHAPTER_IDS = new Set(
    Object.keys(FACTION_NAME).filter(
      (fid) => fid !== 'adeptus-astartes' &&
               /^Imperium - Adeptus Astartes - /.test(FACTION_NAME[fid])
    )
  );
  // Black Templars' Templar Vows: choose one vow army-wide for the whole battle.
  // Sourced from the official Warhammer Community article + New Recruit rules DB
  // (2025 Codex Supplement wording); verify exact punctuation against the codex.
  const TEMPLAR_VOWS_TEXT =
    "ADEPTUS ASTARTES units from your army lose the Oath of Moment army rule (if " +
    "they have it); it is replaced by the Templar Vows army rule. At the start of " +
    "the first battle round, select one of the following vows to be active for the " +
    "rest of the battle. While that vow is active, every ADEPTUS ASTARTES unit " +
    "from your army has the associated ability:\n\n" +
    "Suffer Not the Unclean to Live: This unit is eligible to declare a charge in " +
    "a turn in which it Fell Back, and each time a model in this unit makes a " +
    "Pile-in or Consolidation move, it does not need to end that move closer to " +
    "the closest enemy model, provided it ends as close as possible to the closest " +
    "enemy unit.\n\n" +
    "Uphold the Honour of the Emperor: While this unit is within range of an " +
    "objective marker you control, at the end of your Command phase that objective " +
    "marker remains under your control until your opponent controls it by more " +
    "than you do at the end of a phase (sticky objectives). In addition, this unit " +
    "is eligible to perform actions in a turn in which it Advanced.\n\n" +
    "Abhor the Witch, Destroy the Witch: Each time this unit declares a charge " +
    "against one or more units that have the PSYKER keyword, you can re-roll the " +
    "Charge roll. In addition, melee weapons equipped by models in this unit have " +
    "the [PRECISION] ability while targeting PSYKER units.\n\n" +
    "Accept Any Challenge, No Matter the Odds: Each time this unit makes a melee " +
    "attack, if the Strength characteristic of that attack is less than or equal " +
    "to the Toughness characteristic of the target, add 1 to the Wound roll.";
  // Space Wolves' Curse of the Wulfen (verbatim from the printed datacard).
  const CURSE_OF_THE_WULFEN_TEXT =
    'While this unit is within 6" of one or more friendly SPACE WOLVES CHARACTER ' +
    'models (excluding WULFEN models) or within 12" of one or more friendly WOLF ' +
    'PRIEST models, if it is not Battle-shocked, add 1 to the Objective Control ' +
    'characteristic of INFANTRY models in it and add 3 to the Objective Control ' +
    'characteristic of VEHICLE models in it.';
  // faction_id → { mode: 'add' | 'replace', rules: [{ name, description }] }
  const CHAPTER_ARMY_RULES = {
    'black-templars': { mode: 'replace', rules: [{ name: 'Templar Vows', description: TEMPLAR_VOWS_TEXT }] },
    'space-wolves':   { mode: 'add',     rules: [{ name: 'Curse of the Wulfen', description: CURSE_OF_THE_WULFEN_TEXT }] },
  };

  // ── Hand-authored DETACHMENT prose (fill-only, self-healing) ─────────────────
  // 40kdc ships the STRUCTURE of a detachment (name, enhancement ids + costs,
  // stratagem ids + CP + phase) before it authors the RULES PROSE — so a brand-new
  // detachment shows up selectable with the right strat/enhancement list but blank
  // rule/effect text. These three maps fill only that missing prose, sourced
  // verbatim from 40k.app, keyed by the stable 40kdc id.
  //
  // SELF-HEALING (same contract as MISSING_*_ABILITIES above): every wire-in below
  // is `textFor(id) || MISSING_…[id]`, so the override is consulted ONLY while the
  // 40kdc text is empty. Once the daily/weekly bundle refresh (refresh-40kdc.sh)
  // pulls upstream prose for one of these ids, textFor() wins and the manual entry
  // silently no-ops — delete the entry when that happens. Added 2026-07-08 for the
  // three Space Wolves detachments 40kdc had structured but not yet written up:
  //   Champions of Fenris, Legends of Saga and Song, Veterans of the Fang.
  const SW_RESTRICTION =
    'Restrictions: Your army can include SPACE WOLVES units, but it cannot ' +
    'include any ADEPTUS ASTARTES units drawn from any other Chapter.';
  // detachment_id → { name (the rule's own name), description }
  const MISSING_DETACHMENT_RULES = {
    'champions-of-fenris': {
      name: 'The Great Wolf Watches',
      description:
        'Friendly ADEPTUS ASTARTES INFANTRY CHARACTER units have the following ' +
        'ability:\n\n' +
        'Countercharge (Once per battle round, per unit): You can target this ' +
        'unit with the Heroic Intervention Stratagem, regardless of any other ' +
        'uses of that Stratagem this phase. If you do, that use does not prevent ' +
        'any uses of that Stratagem on other units this phase.\n\n' + SW_RESTRICTION,
    },
    'legends-of-saga-and-song': {
      name: 'Loping Charge',
      description:
        'Friendly ADEPTUS ASTARTES TERMINATOR units have +1 to Charge rolls.\n\n' +
        SW_RESTRICTION,
    },
    'veterans-of-the-fang': {
      name: 'Old Greymanes',
      description:
        'When a friendly GREY HUNTERS unit starts an action, that action does not ' +
        'prevent this unit from being eligible to shoot.\n\n' +
        'In the Declare Battle Formations step, you can split a friendly GREY ' +
        'HUNTERS unit into two units, each with a starting strength of 5.\n\n' +
        SW_RESTRICTION,
    },
  };
  // enhancement_id → verbatim enhancement text
  const MISSING_ENHANCEMENT_TEXT = {
    'a-giant-amongst-giants-champions-of-fenris':
      "This model has +2 W. This model's melee attacks have +1 S.",
    'preyslayer-champions-of-fenris':
      'This unit can re-roll Advance rolls and Countercharge rolls.',
    'fierce-example-legends-of-saga-and-song':
      'WOLF GUARD TERMINATORS unit only. This unit has +1 T.',
    'thirst-for-glory-legends-of-saga-and-song':
      'ADEPTUS ASTARTES TERMINATOR model only. This unit has +1 OC.',
    'eye-of-the-hunter-veterans-of-the-fang':
      "WOLF GUARD BATTLE LEADER model only. This unit's ranged attacks have " +
      '[ASSAULT] and [IGNORES COVER], and have +1 AP.',
    'weaver-of-sagas-veterans-of-the-fang':
      'WOLF PRIEST model only. Once per battle round, per army, in your Movement ' +
      "phase, at the start or end of this unit's move, you can select one friendly " +
      'ADEPTUS ASTARTES unit within 6" of this unit, or one friendly GREY HUNTERS ' +
      'unit within 18" of this unit. That unit is no longer Battle-shocked.',
  };
  // stratagem_id → verbatim WHEN/TARGET/EFFECT text (inline uppercase labels, the
  // shape the card renderer splits into stanzas — see js/ui/cards-mode.js).
  const MISSING_STRATAGEM_TEXT = {
    // Champions of Fenris
    'runes-of-claiming-champions-of-fenris':
      'WHEN: End of your Movement phase. TARGET: One friendly ADEPTUS ASTARTES ' +
      'INFANTRY CHARACTER unit. EFFECT: Select one objective your unit is ' +
      'controlling. That objective is secured.',
    'stalk-between-worlds-champions-of-fenris':
      "WHEN: Your opponent's Shooting phase, when an enemy unit targets a friendly " +
      'ADEPTUS ASTARTES INFANTRY CHARACTER unit. TARGET: That ADEPTUS ASTARTES ' +
      'INFANTRY CHARACTER unit. EFFECT: Your unit has Stealth.',
    'wolf-totems-champions-of-fenris':
      'WHEN: Any phase, when a friendly ADEPTUS ASTARTES INFANTRY CHARACTER unit ' +
      'suffers a mortal wound. TARGET: That ADEPTUS ASTARTES INFANTRY CHARACTER ' +
      'unit. EFFECT: Your unit has Feel No Pain 5+ against mortal wounds.',
    // Legends of Saga and Song
    'chilling-howl-legends-of-saga-and-song':
      "WHEN: Your opponent's Command phase. TARGET: One friendly WOLF GUARD " +
      'TERMINATORS unit. EFFECT: Select one enemy unit within 6" of your unit. ' +
      'That enemy unit makes a Battle-shock roll, with -1 to that Battle-shock ' +
      'roll if that enemy unit is at or below half-strength.',
    'wings-of-the-blizzard-legends-of-saga-and-song':
      "WHEN: End of your opponent's Fight phase. TARGET: One friendly unengaged " +
      'ADEPTUS ASTARTES TERMINATOR unit. EFFECT: Place your unit in Strategic ' +
      'Reserves.',
    'fangs-of-the-pack-legends-of-saga-and-song':
      'WHEN: Fight phase, when a friendly ADEPTUS ASTARTES TERMINATOR unit is ' +
      'selected to fight. TARGET: That ADEPTUS ASTARTES TERMINATOR unit. EFFECT: ' +
      "Your unit's melee attacks have [PRECISION].",
    // Veterans of the Fang
    'blade-keen-senses-veterans-of-the-fang':
      'WHEN: Start of your Shooting phase. TARGET: One friendly unengaged GREY ' +
      'HUNTERS unit. EFFECT: Select one visible enemy unit within 24" of your ' +
      'unit. That enemy unit has +6" detection range.',
    'icy-calm-veterans-of-the-fang':
      'WHEN: Your Movement phase, when a friendly GREY HUNTERS unit is selected to ' +
      'make an Advance or Fall Back move. TARGET: That GREY HUNTERS unit. EFFECT: ' +
      'That move does not prevent your unit from being eligible to start an action.',
    'grizzled-killers-veterans-of-the-fang':
      'WHEN: Fight phase, when a friendly GREY HUNTERS unit is selected to fight. ' +
      'TARGET: That GREY HUNTERS unit. EFFECT: Your unit\'s melee attacks have ' +
      '[SUSTAINED HITS 1] or [LETHAL HITS].',
  };

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
        // Compose the row name. For MULTI-profile weapons, 40kdc stores each
        // profile's `name` as the firing-MODE only ("Dispersed"/"Focused",
        // "Standard"/"Supercharge", "Krak"/"Frag") and keeps the real weapon
        // name one level up on `w.name`. The datasheet renderer prints each row
        // flat with no weapon-level grouping header, so a bare mode label loses
        // the weapon identity (Bjorn's "Helfrost cannon" showed as just
        // "Dispersed"/"Focused"). Compose "Weapon – Mode" for these. Guards:
        // only when the profile name differs from and isn't already contained in
        // the weapon name, so single-profile weapons (where 40kdc sets
        // profiles[0].name === w.name) don't become "Assault cannon – Assault
        // cannon".
        const pn = p.name || '', wn = w.name || '';
        const pl = pn.toLowerCase(), wl = wn.toLowerCase();
        const name = (w.profiles.length > 1 && pn && wn && pl !== wl && pl.indexOf(wl) === -1)
          ? `${wn} – ${pn}`
          : (pn || wn || '');
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
      .filter((a) => a && a.id !== 'leader' && !ARMY_RULE_IDS.has(a.id))
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
    // Inject any hand-patched core abilities the dataset omits for this unit.
    const patchIds = MISSING_CORE_ABILITIES[u.id];
    if (patchIds) {
      const have = new Set(abilities.map((a) => a.name.toLowerCase()));
      patchIds.forEach((aid) => {
        let av = null;
        try { av = DC.abilities.getAny ? DC.abilities.getAny(aid) : DC.abilities.get(aid); } catch (_) {}
        const name = (av && (av.name || (av.raw && av.raw.name))) || titleCase(String(aid).replace(/-/g, ' '));
        if (have.has(name.toLowerCase())) return;   // already present → no-op (self-heals post-upstream-fix)
        have.add(name.toLowerCase());
        abilities.push({ name, description: textFor(aid), isCore: true });
      });
    }
    // Inject any hand-patched NON-core unit abilities the dataset omits here.
    // Each patch entry is either a string ability-id (name + prose from the
    // store) or a hand-authored { name, description } object (store has none).
    const unitPatches = MISSING_UNIT_ABILITIES[u.id];
    if (unitPatches) {
      const have = new Set(abilities.map((a) => a.name.toLowerCase()));
      unitPatches.forEach((patch) => {
        let name, description;
        if (patch && typeof patch === 'object') {
          name = patch.name;
          description = patch.description || '';
        } else {
          const aid = patch;
          let av = null;
          try { av = DC.abilities.getAny ? DC.abilities.getAny(aid) : DC.abilities.get(aid); } catch (_) {}
          name = (av && (av.name || (av.raw && av.raw.name))) || titleCase(String(aid).replace(/-/g, ' '));
          description = textFor(aid);
        }
        if (!name || have.has(name.toLowerCase())) return;   // already present → no-op (self-heals post-upstream-fix)
        have.add(name.toLowerCase());
        abilities.push({ name, description, isCore: false });
      });
    }
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
  function toDetachment(d, enhById, parentDetRule) {
    const rule = d.detachment_rule_id;
    const ruleText = rule ? textFor(rule) : '';
    let rules = ruleText ? [{ name: d.name, description: ruleText }] : [];
    // SM chapter borrow: a chapter's copy of a generic codex detachment (Gladius,
    // Anvil Siege, …) has a NULL detachment_rule_id, but the Space Marines parent
    // authored the text. Borrow it by folded name so the chapter shows the same
    // detachment rule as vanilla Space Marines. Chapter-SPECIFIC detachments
    // (Saga of the Great Wolf, etc.) aren't in the parent — the GDC overlay fills
    // those (js/gdc.js). Fill-only; leaves non-chapter detachments untouched.
    if (parentDetRule && rules.length === 0) {
      const rid = parentDetRule.get(foldName(d.name));
      const borrowed = rid ? textFor(rid) : '';
      if (borrowed) rules = [{ name: d.name, description: borrowed }];
    }
    // Hand-authored fallback for detachments 40kdc structured but hasn't written
    // up yet (fill-only → self-heals once upstream authors detachment_rule_id).
    if (rules.length === 0) {
      const patch = MISSING_DETACHMENT_RULES[d.id];
      if (patch) rules = [{ name: patch.name, description: patch.description }];
    }
    const enhancements = (d.enhancement_ids || []).map((id) => {
      const e = enhById.get(id);
      if (!e) return null;
      return { name: e.name, pts: e.cost != null ? e.cost : 0,
               description: textFor(e.ability_id) || MISSING_ENHANCEMENT_TEXT[id] || '' };
    }).filter(Boolean);
    return { name: d.name, rules, enhancements,
             // 40kdc rates every detachment 1–3 "detachment points"; surface it
             // for the detachment picker (js/app/detachment-picker.js). Straight
             // passthrough — null if upstream ever drops the field.
             points: (d.detachment_points != null ? d.detachment_points : null),
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
      // Hand-authored fallback for strats 40kdc structured but hasn't written up
      // yet (fill-only → self-heals once upstream authors the ability_id text).
      const description = textFor(s.ability_id) || MISSING_STRATAGEM_TEXT[id] || '';
      return {
        name: s.name,
        cp: s.cp_cost != null ? s.cp_cost : null,
        phase: cap((s.phases || [])[0] || ''),
        type: s.type || '',
        description,
        source: '40kdc',
      };
    }).filter(Boolean);
  }

  // Reconcile 40kdc strats with the GDC-attached list on a detachment, in place.
  // 40kdc decides WHICH strats exist + CP/phase; GDC is a TEXT fallback only,
  // matched by folded name onto the 40kdc set. GDC-only strats (no 40kdc match)
  // are intentionally DROPPED when 40kdc supplied a strat set for this detachment:
  // GDC's Space Wolves/SM files still carry legacy prior-edition detachments under
  // the same names (e.g. an old "Champions of Fenris" whose strat list — Chilling
  // Howl, Stalking Wolves, even the core Armour of Contempt — has nothing to do
  // with the current 11e detachment of that name). Appending those leaked foreign
  // strats onto the wrong detachment. When 40kdc supplies NO strats for a
  // detachment (dcList empty — e.g. Librarius Conclave), we keep the full GDC list
  // as-is via the early return, since GDC is then the only source. Writes the
  // result back to `detachment.gdcStratagems` (the field faction-rules.js renders)
  // and returns coverage counts.
  function reconcileStrats(detachment) {
    const dcList  = dcStratsFor(detachment.stratagemIds);
    const gdcList = Array.isArray(detachment.gdcStratagems) ? detachment.gdcStratagems : [];
    if (dcList.length === 0) return { n40kdc: 0, nGdcFallback: 0, total: gdcList.length };
    const gdcByKey = new Map();
    gdcList.forEach((g) => { const k = foldName(g.name); if (k && !gdcByKey.has(k)) gdcByKey.set(k, g); });
    let nGdcFallback = 0;
    const out = dcList.map((d) => {
      const k = foldName(d.name);
      const g = gdcByKey.get(k);
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
    // SM chapters: normalize to Oath of Moment (+ optional distinct chapter
    // rule), ignoring 40kdc's unreliable per-chapter faction_rule_id (see
    // SM_CHAPTER_IDS / CHAPTER_ARMY_RULES above).
    if (f && SM_CHAPTER_IDS.has(f.id)) {
      const override = CHAPTER_ARMY_RULES[f.id];
      if (override && override.mode === 'replace') return override.rules.map((r) => ({ ...r }));
      const oath = { name: 'Oath of Moment',
        description: textFor('oath-of-moment') || MISSING_ARMY_RULE_TEXT['oath-of-moment'] || '' };
      const rules = [oath];
      if (override && override.mode === 'add') override.rules.forEach((r) => rules.push({ ...r }));
      return rules;
    }
    const id = f && f.faction_rule_id;
    if (!id) return [];
    let name = '';
    try {
      const av = DC.abilities.getAny ? DC.abilities.getAny(id) : DC.abilities.get(id);
      name = (av && (av.name || (av.raw && av.raw.name))) || '';
    } catch (_) { /* ambiguous/missing — fall back to the id */ }
    if (!name) name = titleCase(String(id).replace(/-/g, ' '));
    // Prefer the authored ability-text; fall back to a hand-patched string only
    // when the store has none (self-heals once upstream/GDC authors the prose).
    // GDC's mergeIntoFactions only fills an EMPTY description, so a non-empty
    // seed here is not clobbered by the runtime overlay.
    const description = textFor(id) || MISSING_ARMY_RULE_TEXT[id] || '';
    return [{ name, description }];
  }

  // ── build all yaab faction objects from 40kdc ──────────────────────────────
  function buildFactions() {
    const enhById = new Map();
    DC.enhancements.all.forEach((e) => enhById.set(e.id, e));
    // Parent Space Marines detachment-rule map (folded detachment name →
    // detachment_rule_id) for the SM chapter borrow in toDetachment. Only the
    // parent detachments that actually have authored text are borrowable.
    const smParentDetRule = new Map();
    (DC.detachments.byFaction ? DC.detachments.byFaction('adeptus-astartes') : []).forEach((dv) => {
      const d = dv.raw || dv;
      if (d && d.detachment_rule_id && textFor(d.detachment_rule_id)) {
        smParentDetRule.set(foldName(d.name), d.detachment_rule_id);
      }
    });
    const out = [];
    DC.factions.all.forEach((fv) => {
      const f = fv.raw || fv;
      const factionName = FACTION_NAME[f.id];
      if (!factionName) return; // unmapped (e.g. Titans) — skip in trial
      const units = (fv.units || []).map(toUnit);
      const dets = DC.detachments.byFaction(f.id).map((d) =>
        toDetachment(d, enhById, SM_CHAPTER_IDS.has(f.id) ? smParentDetRule : null));
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
        // Fill 40kdc datasheet ability gaps (units with no abilities / empty
        // ability text) from the 11th GDC datasheets.
        if (typeof App.GDC.mergeUnitAbilitiesFromGdc === 'function') {
          App.GDC.mergeUnitAbilitiesFromGdc(App.state.factions);
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
