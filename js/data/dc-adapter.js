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
  // GW's own data groups these as CORE abilities, so they belong on the core
  // tag row rather than in the named-ability list. Super-heavy Walker (Ta'unar)
  // and Titanic Walker (Seraptek) are the SAME rule — identical text, "move
  // over models and terrain 4\" or less in height" — that 40kdc names
  // differently per faction; BSData names them the same way we do, so the names
  // stay and only the classification changes. Deliberately NOT Heavy Walker
  // (Stormsurge): same text again, but GW files that one under `other`, so it
  // is correctly not core.
  const CORE_ABILITY_RE =
    /^(Deadly Demise|Deep Strike|Feel No Pain|Fights First|Firing Deck|Infiltrators|Lone Operative|Scouts|Stealth|Hover|Super-heavy Walker|Titanic Walker)\b/i;

  // 11e prints LEADER and SUPPORT as CORE abilities on the datasheet, but 40kdc
  // models them as `unit.attachment_role` and NOT as an ability link (the shared
  // `leader` ability id is dropped below — its one global text wrongly named
  // Raveners). Until this map existed, `attachmentRole` was read only by the
  // detail pane, so every card / print / export view showed a Captain with no
  // LEADER and a Cryptek with no SUPPORT — 287 units missing a core rule their
  // printed datasheet carries. The prose is OURS: upstream ships `effect: null`
  // for every `unitKeywords` entry (all 13 of them, not just these two), so
  // there is no rule text to borrow, and the ability store's "leader" text is
  // the poisoned one. Wording is kept identical to the detail pane's empty-list
  // fallback so the same rule never reads two ways.
  const ATTACH_ROLE_ABILITY = {
    leader:  { name: 'Leader',
               description: 'This model is a Leader and can be attached to a Bodyguard unit.' },
    support: { name: 'Support',
               description: 'This model has Support and can be attached to a unit.' },
  };

  // Hand-patches for core abilities the upstream 40kdc dataset is missing on a
  // unit's datasheet. Keyed by unit id → core ability ids to inject. This is
  // SELF-HEALING: the inject is skipped if the unit already lists the ability,
  // so each entry no-ops automatically once 40kdc links it and the bundle is
  // refreshed — at which point the entry can be deleted. Keep each line tagged
  // with the upstream issue so it's auditable.
  //   land-speeder / deep-strike: the Land Speeder datasheet in 40kdc-data links
  //     ZERO abilities — an upstream data gap. Its printed card has the CORE
  //     "Deep Strike" ability, and deep-strike text IS in the store, so inject it.
  // (nekrosor-ammentar's deep-strike patch retired 2026-07-14 — fixed upstream
  //  in 40kdc-data #51, shipped in release 1.0.27; it now links deep-strike.)
  const MISSING_CORE_ABILITIES = {
    'land-speeder': ['deep-strike'],
    // GW Chaos Daemons faction pack (2026) — Skull Altar's printed datasheet
    // lists CORE: Infiltrators; upstream 40kdc omits it. Verified against the
    // official PDF (fortifications can deploy via Infiltrators).
    'skull-altar': ['infiltrators'],
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
    // (big-mek-in-mega-armour's More Dakka patch retired 2026-07-09 — fixed
    // upstream in 40kdc-data PR #72.)
  };

  // Self-healing manual links for wargear abilities the upstream 40kdc dataset
  // omits from a datasheet's DEFAULT equipment — cases the item/bearer scans
  // can't reach because there's no reference to follow. Keyed by unit id → the
  // ability/item ids whose prose already lives in the ability-text store; each
  // is surfaced in the unit's Wargear Abilities section. SELF-HEALING: skipped
  // when the same-named ability is already present (via the item scan, the
  // bearer-pattern route, or a genuine ability_id), so an entry no-ops the
  // moment 40kdc links it and can then be deleted.
  // (wulfen's Death Totem patch retired 2026-07-09 — fixed upstream in
  // 40kdc-data PR #73; the totem now arrives via ability_ids and the
  // bearer-pattern route.)
  const MISSING_WARGEAR_ABILITIES = {};

  // Per-faction datasheet ability corrections for upstream data errors that
  // can't be fixed by the generic scans (e.g. sibling-legion abilities leaking
  // onto a shared datasheet). Keyed `${faction_id}::${unit_id}` →
  // { remove: [ability ids], add: [ids] }. Self-healing: removes only strip
  // ids actually present; adds dedupe by name.
  // (The CSM/DG/TS Defiler union-leak entries retired 2026-07-09 — fixed
  // upstream in 40kdc-data PR #76.)
  const UNIT_ABILITY_FIXES = {};

  // Expect-gated STATLINE corrections. `expect` pins the upstream (wrong)
  // values on the FIRST profile; the fix applies only while upstream still
  // matches, so the entry no-ops the moment 40kdc ships corrected (or GW
  // re-changed) stats and can then be deleted. The special expect key `INV`
  // pins the CURRENT invulnerable save ('5+' form, '' = none).
  //   'faction_id::unit_id': {
  //     expect: { T: '10', W: '14', INV: '5+' },
  //     set: {
  //       profiles: [{ name: '', M: '12"', T: '11', SV: '3+', W: '18', LD: '6+', OC: '5' }],
  //       invuln: '5+',        // optional; null clears
  //       invulnNote: 'Against ranged attacks only',  // optional conditional-
  //                            // invuln note (null clears); shown as `5+*`
  //     },
  //   },
  // Two sources, same shape and gating:
  //   1. This hand-authored map (wins on key collision).
  //   2. window.DC.statFixes — the consensus overlay appended to the bundle by
  //      the weekly stat checker (~/sites/base/wahapedia-audit.py): fixes where
  //      wahapedia AND New Recruit (BSData wh40k-11e) agree against our data.
  const UNIT_STAT_FIXES = {
    // ── GW official faction-pack corrections (2026) ────────────────────────
    // These break consensus "blind spots": cases where our data and wahapedia
    // share the SAME error, so the weekly two-source checker can't catch them.
    // Each is verified against the official GW PDF datasheet.
    //
    // Mutilators (CSM faction pack): printed M5" W5; upstream 40kdc AND
    // wahapedia both had M4"/W4 (New Recruit had the correct M5"/W5).
    'chaos-space-marines::mutilators': {
      expect: { M: '4"', W: '4' },
      set: { profiles: [{ name: '', M: '5"', T: '7', SV: '2+', W: '5', LD: '6+', OC: '2' }] },
    },
    // World Eaters Heldrake: upstream ships it as a NON-Aircraft at M12", while
    // the identical CSM / Emperor's Children / Thousand Sons Heldrakes are all
    // Aircraft at M20" (and the Heldrake has always been an Aircraft — 20+"
    // minimum move). Our WE copy + New Recruit share the M12" error; wahapedia
    // has the correct M20". Move corrected here; the missing Aircraft KEYWORD
    // is a separate upstream bug flagged for the 40kdc PR.
  };

  // ── 11th-edition AIRCRAFT reconciliation (GW errata-driven) ────────────────
  // 11e reworked flyers, and GW applied it via the faction-pack RULES-UPDATES
  // *text* (authoritative over the datasheet cards, which are often stale).
  // Two treatments:
  //   1. KEPT Aircraft → "Change M and OC to '-'" + Hover removed. They no
  //      longer make normal moves (Ingress instead). This is the DEFAULT for
  //      any AIRCRAFT-keyword unit not listed in AIRCRAFT_ERRATA below.
  //   2. DE-AIRCRAFTED → keyword AIRCRAFT removed, given a real Move, and
  //      Hover added/kept. These are listed explicitly (their exact Move comes
  //      from the errata, and matches New Recruit — which tracked the patches;
  //      40kdc + wahapedia stayed on the stale 10e M20").
  // Keyed by unit id. Fields: M / OC (set on every profile), deAircraft
  // (drop the AIRCRAFT keyword so it renders/plays as a normal flyer),
  // addHover, removeHover.
  // (The de-aircrafting + Move for heldrake / night-scythe / stormraven-gunship /
  //  lord-discordant-on-helstalker was absorbed by 40kdc in release 1.0.27
  //  (PR #85) on 2026-07-14, so those Move/keyword overrides retired. Two
  //  residuals upstream did NOT take stay below: heldrake's OC (upstream ships
  //  0; GW errata is '-') and night-scythe's Hover ability.)
  const AIRCRAFT_ERRATA = {
    // De-aircrafted upstream; GW errata OC is '-' but 40kdc ships OC 0:
    'heldrake':               { OC: '-' },
    // (night-scythe's addHover retired 2026-07-28 — upstream now links `hover`
    //  in its ability_ids, alongside the M14 + de-aircrafting it already had.)
    // Kept Aircraft with an explicit "remove Hover" note (the blanket rule also
    // blanks M/strips Hover, but listing makes the source auditable). Upstream
    // (1.0.27) still ships these as Aircraft at M20", so these stay active:
    'stormtalon-gunship':     { M: '-', OC: '-', removeHover: true },
    'stormhawk-interceptor':  { M: '-', OC: '-', removeHover: true },
    'doom-scythe':            { M: '-', OC: '-' },

    // ── De-aircrafted hover flyers, per GW's OWN app data (2026-07-28) ────────
    // Found by ~/sites/base/dump-audit.py comparing us against GW's app dump
    // (via the Game Datacards extraction, data_version 912): GW ships these with
    // a REAL Move, no AIRCRAFT keyword, and the Hover ability. Upstream 40kdc
    // still has them as AIRCRAFT at M20", so our blanket kept-Aircraft rule was
    // blanking a Move GW actually publishes — and stripping the `hover` that
    // upstream already links. Listing them here suppresses the blanket rule, so
    // Hover survives on its own; only Move and the keyword need overriding.
    // BSData independently agrees on 6 of these (and on Manta 40" / Harridan
    // 14", both previously open in errata-uncertainty-report.md).
    // NB no OC override: GW ships OC 0 for these, same as upstream.
    'corvus-blackstar':               { M: '14"', deAircraft: true },
    'orion-assault-dropship':         { M: '14"', deAircraft: true },
    'archaeopter-transvector':        { M: '14"', deAircraft: true },
    'valkyrie':                       { M: '14"', deAircraft: true },
    'harridan':                       { M: '14"', deAircraft: true },
    'thunderhawk-gunship':            { M: '20+"', deAircraft: true },
    'grey-knights-thunderhawk-gunship': { M: '20"', deAircraft: true },
    // Manta stays AIRCRAFT in GW's data but still has a real Move and Hover:
    'manta':                          { M: '40"' },
    // Avenger Strike Fighter is deliberately ABSENT: GW's app data says 20+",
    // but the user (game authority) confirmed the faction pack gives it M '-',
    // and BSData agrees with '-'. The blanket kept-Aircraft rule handles it.
  };
  const isAircraft = (u) =>
    (u.keywords || []).concat(u.faction_keywords || [])
      .some((k) => /^aircraft$/i.test(String(k).trim()));

  // GW 11e added the FRAME keyword to most vehicles (faction-pack RULES-UPDATES
  // "Keywords Section: Add 'FRAME'"). Self-healing: injection is skipped when the
  // keyword is already present, so this no-ops if upstream ever ships it.
  //
  // RE-ADDED 2026-07-28 with the full 132 units, from GW's OWN app data (found by
  // ~/sites/base/dump-audit.py, data_version 912 — it was 153 of the audit's
  // findings, all one root cause). History worth knowing before touching this:
  // the original 53-unit list was retired 2026-07-14 because 40kdc had shipped
  // FRAME in release 1.0.27 (via our PR #85) — but upstream then DELETED it again
  // in commit 3aac909, "drop the non-game 'Frame' build tag from unit keywords".
  // Upstream now has it on ZERO units while GW has it on 132, so this is a
  // standing editorial disagreement, not a temporary gap: expect to keep this
  // list. User ruled 2026-07-28 to follow GW.
  // GW 11e MOBILE keyword, missing from 40kdc on these six. Found by
  // ~/sites/base/dump-audit.py against GW's own app data (data_version 912) and
  // confirmed by the user 2026-07-28. Same self-healing contract as FRAME_UNITS:
  // injection is skipped when the keyword is already present, so this no-ops if
  // upstream starts shipping it.
  const MOBILE_UNITS = new Set([
    'belisarius-cawl', 'fulgrim', 'lion-eljonson',
    'roboute-guilliman', 'the-red-terror', 'thulia-ghuld'
  ]);

  const FRAME_UNITS = new Set([
    'acastus-knight-asterius', 'acastus-knight-porphyrion', 'aegis-defence-line',
    'agamatus-custodians', 'anathema-psykana-rhino', 'annihilation-barge', 'astraeus',
    'baal-predator', 'baneblade', 'banehammer', 'banesword', 'basilisk', 'battlewagon',
    'caladius-grav-tank', 'castigator', 'catacomb-command-barge',
    'chaos-acastus-knight-asterius', 'chaos-acastus-knight-porphyrion', 'chaos-land-raider',
    'chaos-predator-annihilator', 'chaos-predator-destructor', 'chaos-rhino',
    'chaos-vindicator', 'chimera', 'convergence-of-dominion', 'coronus-grav-carrier',
    'corvus-blackstar', 'd-cannon-platform', 'deathstrike', 'devilfish', 'doomhammer',
    'doomsday-ark', 'drop-pod', 'exorcist', 'falcon', 'feculent-gnarlmaw', 'fire-prism',
    'gargantuan-squiggoth', 'ghost-ark', 'gladiator-lancer', 'gladiator-reaper',
    'gladiator-valiant', 'goliath-rockgrinder', 'goliath-truck', 'hammerfall-bunker',
    'hammerhead-gunship', 'harridan', 'hekaton-land-fortress', 'hellhammer', 'hellhound',
    'hierophant', 'hydra', 'immolator', 'imperial-rhino', 'impulsor',
    'inquisitorial-chimera', 'invader-atv', 'khorne-lord-of-skulls', 'land-raider',
    'land-raider-crusader', 'land-raider-redeemer', 'land-speeder',
    'land-speeder-vengeance', 'leman-russ-battle-tank', 'leman-russ-commander',
    'leman-russ-demolisher', 'leman-russ-eradicator', 'leman-russ-executioner',
    'leman-russ-exterminator', 'leman-russ-punisher', 'leman-russ-vanquisher', 'manta',
    'manticore', 'miasmic-malignifier', 'monolith', 'night-scythe', 'night-spinner',
    'noctilith-crown', 'obelisk', 'pallas-grav-attack', 'piranhas', 'plagueburst-crawler',
    'predator-annihilator', 'predator-destructor', 'raider', 'ravager',
    'ravenwing-darkshroud', 'razorback', 'repulsor', 'repulsor-executioner', 'rhino',
    'rogal-dorn-battle-tank', 'rogal-dorn-commander', 'sagitaur', 'sammael',
    'seraptek-heavy-construct', 'shadow-weaver-platform', 'shadowsword',
    'sisters-of-battle-immolator', 'skorpius-disintegrator', 'skorpius-dunerider',
    'skull-altar', 'sky-ray-gunship', 'sororitas-rhino', 'starweaver', 'stompa',
    'storm-speeder-hailstrike', 'storm-speeder-hammerstrike', 'storm-speeder-thunderstrike',
    'stormlord', 'taunar-supremacy-armour', 'taurox', 'taurox-prime', 'tesseract-vault',
    'tidewall-droneport', 'tidewall-gunrig', 'tidewall-shieldline', 'toxicrene',
    'triarch-stalker', 'trukk', 'tyrannocyte', 'tyrannofex', 'venerable-land-raider',
    'venom', 'vibro-cannon-platform', 'vindicator', 'voidweaver', 'wave-serpent',
    'whirlwind', 'wyvern', 'ynnari-raider', 'ynnari-venom'
  ]);

  // Self-healing corrections to upstream wargear-option/composition data that
  // the picker consumes. Keyed by unit id:
  //   optionReplaces: wgo id → the item ids the swap ACTUALLY replaces
  //     (applied when the wgo exists; harmless once upstream matches).
  //   addDefaults: item ids missing from the default loadout, added at one
  //     per model for every squad size (skipped if upstream starts listing it).
  //   andOptions: wgo ids whose multi-item `replaces` is a TRUE "and" — the
  //     swap gives up every listed item — overriding the picker's default
  //     reading of multi-replaces + single-item choice as "or, first item".
  //   wolf-guard-terminators: the Pack Leader's twin lightning claws /
  //     relic greataxe replace BOTH the storm bolter and the master-crafted
  //     power weapon (official wording is "and" — 40kdc's schema can't
  //     distinguish and/or in `replaces`, so this one stays local).
  // (wulfen's totem-defaults + swap-target entries retired 2026-07-09 —
  // fixed upstream in 40kdc-data PR #73.)
  const WARGEAR_PROFILE_FIXES = {
    'wolf-guard-terminators': {
      andOptions: ['wolf-guard-terminators-wgo-mfm-3'],
    },
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

  // Conditional invulnerable saves. 40kdc carries these as first-class profile
  // fields — `invuln_sv_ranged` / `invuln_sv_melee` — separate from the
  // unconditional `invuln_sv`. Returns {value, note} for the UI's `5+* INV`
  // + footnote treatment, or null when the save is unconditional/absent.
  // Prefer this over hand-authored overlay notes: it covers every unit upstream
  // knows about and can't drift out of sync with the value.
  function condInvuln(p) {
    if (!p) return null;
    if (p.invuln_sv_ranged != null) {
      return { value: sv(p.invuln_sv_ranged), note: 'Against ranged attacks only' };
    }
    if (p.invuln_sv_melee != null) {
      return { value: sv(p.invuln_sv_melee), note: 'Against melee attacks only' };
    }
    return null;
  }
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
      const meleeWeapon = w.type === 'melee';
      w.profiles.forEach((p) => {
        const st = p.stats || {};
        // Melee-ness is a property of the PROFILE, not the weapon. 40kdc gives
        // ranged weapons melee profiles — pistols and combi-weapons carry
        // { name: 'Melee', range: 'Melee', stats: { WS } } alongside their
        // ranged profile. Keying off `w.type` alone read st.BS (absent on those
        // profiles) and emitted a BLANK skill, plus a Range of `Melee"` from
        // interpolating the string 'Melee' into `${p.range}"`. Cypher's bolt and
        // plasma pistols showed no melee skill at all; GW's data says 2+.
        const melee = meleeWeapon || st.WS != null
          || String(p.range == null ? '' : p.range).trim().toLowerCase() === 'melee';
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
        if (kws.length) {
          row.Keywords = kws.map(prettyKw).join(', ');
          // Attach weapon-keyword rule text so the datasheet tooltip lights up.
          // 40kdc keeps the core weapon-ability prose in the ability-text store
          // (lethal-hits, blast, torrent, sustained-hits, melta, …). Keyed by the
          // DISPLAYED keyword token (prettyKw) so the renderer's per-token lookup
          // (detail.js renderWeaponTable) matches, and so buildWeaponKwGlossary
          // picks these up for GDC-rendered rows too. Fills the gap left when the
          // BSData parser (which used to harvest _keywordDefs) went dormant.
          const defs = {};
          kws.forEach((kid) => {
            const t = weaponKwText(kid);
            if (t) defs[prettyKw(kid)] = t;
          });
          if (Object.keys(defs).length) row._keywordDefs = defs;
        }
        rows.push(row);
      });
    });
    return rows;
  }
  const prettyKw = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // Resolve a weapon keyword id to its rule text from the 40kdc ability-text
  // store, trying the full id then the base form with the trailing rating
  // stripped ("sustained-hits-1" → "sustained-hits", "anti-infantry-4" →
  // "anti-infantry", "melta-2" → "melta").
  function weaponKwText(kid) {
    let t = textFor(kid);
    if (t) return t;
    const base = String(kid).replace(/-\d+$/, '');
    if (base !== kid) { t = textFor(base); if (t) return t; }
    // ANTI-X N: the store has no generic "anti" entry (it's parameterized per
    // target keyword), so synthesize the core-rules text.
    const anti = /^anti-([a-z][a-z-]*?)(?:-(\d+))?$/.exec(String(kid));
    if (anti) {
      const target = prettyKw(anti[1]).toUpperCase();
      const roll = anti[2] ? anti[2] + '+' : 'the listed value or more';
      const art = /^[aeiou]/i.test(target) ? 'an' : 'a';
      return 'Each time an attack is made with this weapon against ' + art + ' ' + target
        + ' unit, an unmodified Wound roll of ' + roll + ' scores a Critical Wound.';
    }
    return '';
  }

  // ── one 40kdc unit → one yaab Unit ─────────────────────────────────────────
  // Leader → eligible-bodyguard NAME list, sourced from 40kdc's OFFICIAL
  // `leaderAttachments` table (data/core/<faction>/leader-attachments.json,
  // embedded per-faction in `ds`). The "Led By" reverse-index (attachments.js)
  // is driven by each leader's `gdcLeadBy` NAME array. GDC prose is the primary
  // source of that array, but GDC ships NO leader field for whole factions
  // (every Necrons Cryptek/Overlord, etc.), so those leaders showed no "Led By".
  // This map fills `gdcLeadBy` from 40kdc's structured data; the GDC overlay
  // (js/gdc.js) only overwrites gdcLeadBy when it has its OWN prose, so GDC
  // still wins wherever it has data and this is a pure fallback. Self-healing:
  // if 40kdc drops the table or GDC starts carrying the prose, the other source
  // takes over with no code change. Memoised — the same global list is copied
  // into every faction's ds, so it's read once.
  let _leaderLeadBy = null;
  function leaderLeadByMap() {
    if (_leaderLeadBy) return _leaderLeadBy;
    _leaderLeadBy = new Map();               // leader_id -> string[] of names
    try {
      const nameById = new Map();
      DC.units.all.forEach((uu) => { if (uu && uu.id) nameById.set(uu.id, uu.name); });
      const fv = DC.factions.all.find(
        (f) => f && f.ds && Array.isArray(f.ds.leaderAttachments) && f.ds.leaderAttachments.length);
      const list = (fv && fv.ds.leaderAttachments) || [];
      list.forEach((la) => {
        if (!la || !la.leader_id || !Array.isArray(la.eligible_bodyguard_ids)) return;
        const names = la.eligible_bodyguard_ids
          .map((bid) => nameById.get(bid)).filter(Boolean);
        if (!names.length) return;
        const prev = _leaderLeadBy.get(la.leader_id) || [];
        // dedupe by name (a leader can appear under multiple faction copies)
        const seen = new Set(prev);
        names.forEach((n) => { if (!seen.has(n)) { seen.add(n); prev.push(n); } });
        _leaderLeadBy.set(la.leader_id, prev);
      });
    } catch (_) { /* leave the map empty; GDC prose still drives Led By */ }
    return _leaderLeadBy;
  }

  function toUnit(uv) {
    const u = uv.raw || uv;
    const profiles = u.profiles && u.profiles.length ? u.profiles : [{ name: u.name }];
    let modelStats = profiles.map(profileStats);
    let invulnOverride;      // undefined = untouched; null/'N+' = forced
    let invulnNoteOverride;  // undefined = untouched; null/string = forced
    const statFix = UNIT_STAT_FIXES[u.faction_id + '::' + u.id]
      || (DC.statFixes || {})[u.faction_id + '::' + u.id];
    if (statFix && statFix.set) {
      const first0 = modelStats[0] || {};
      const prof0 = profiles[0] || {};
      const inv0 = prof0.invuln_sv != null ? sv(prof0.invuln_sv) : '';
      const exp = statFix.expect || {};
      const stillWrong = Object.keys(exp).every((k) => (k === 'INV'
        ? String(inv0 || '') === String(exp[k] || '')
        : String(first0[k]) === String(exp[k])));
      if (stillWrong) {
        if (Array.isArray(statFix.set.profiles) && statFix.set.profiles.length) {
          modelStats = statFix.set.profiles.map((p) => ({
            name: p.name || '', M: p.M, T: p.T, SV: p.SV, W: p.W, LD: p.LD, OC: p.OC,
          }));
        }
        if ('invuln' in statFix.set) invulnOverride = statFix.set.invuln;
        if ('invulnNote' in statFix.set) invulnNoteOverride = statFix.set.invulnNote;
      }
    }
    const first = profiles[0] || {};
    // 11e points have two independent dimensions in points[]:
    //   - squad size (`models`): 5 for X, 10 for Y
    //   - per-army-ordinal (`unit_count_min/max`): your 1st-2nd cost base, 3rd+
    //     cost more. Absent (the common case) = cost applies to every copy.
    // Split them: squadOptions carries one BASE cost per distinct size; the
    // ordinal surcharge (flat per unit across sizes) goes in `ordinal`.
    // The official MFM overlay (window.DC.mfmPoints, same shape, scraped by
    // refresh-40kdc.sh) is AUTHORITATIVE when present — upstream 40kdc points
    // lag the live MFM (e.g. Thunderwolf Cavalry shipped 115 vs MFM 100+10/3rd).
    const mfmPts = (DC.mfmPoints && DC.mfmPoints[u.faction_id + '/' + u.id]) || null;
    const { squadOptions, pointsOptions, ordinal } =
      parsePoints((mfmPts && mfmPts.length ? mfmPts : u.points) || []);
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
    // Per-faction ability corrections (leaked sibling-legion abilities on
    // shared datasheets like the Defiler).
    const abilityFix = UNIT_ABILITY_FIXES[u.faction_id + '::' + u.id] || null;
    // Consensus ability overlay (window.DC.abilityFixes — appended to the
    // bundle by the weekly stat checker + FAQ processor). Shape per
    // 'faction::unit' key:
    //   { addCore: [ability-ids], addNamed: [{name, description}],
    //     addWargear: [{name, description}], remove: [ability-ids],
    //     updateNamed: [{name, expectContains, description}] }
    // Every path is self-healing: `updateNamed` matches by name and requires
    // the current description to contain `expectContains` before rewriting —
    // so once upstream catches up, the override no-ops.
    const abilityFixOv = (DC.abilityFixes || {})[u.faction_id + '::' + u.id] || null;
    const removeAbilityIds = new Set([
      ...(abilityFix ? abilityFix.remove || [] : []),
      ...(abilityFixOv ? abilityFixOv.remove || [] : []),
    ]);
    const abilities = (uv.abilities || [])
      .filter((a) => a && a.id !== 'leader' && !ARMY_RULE_IDS.has(a.id)
        && !(removeAbilityIds && removeAbilityIds.has(a.id)))
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
        // `id` kept so tooling (the stat checker's consensus removes) can
        // target the upstream ability; renderers ignore it.
        return { name, description: textFor(a.id), isCore, id: a.id };
      })
      .filter((a) => a.name);
    // Corrections' adds (e.g. the Defiler's Deadly Demise D6 replacing the
    // leaked D3): name + prose from the store, core flag by name pattern.
    if (abilityFix && Array.isArray(abilityFix.add)) {
      const have = new Set(abilities.map((x) => x.name.toLowerCase()));
      abilityFix.add.forEach((aid) => {
        let av = null;
        try { av = DC.abilities.getAny ? DC.abilities.getAny(aid) : DC.abilities.get(aid); } catch (_) {}
        const name = (av && (av.name || (av.raw && av.raw.name))) || titleCase(String(aid).replace(/-/g, ' '));
        if (have.has(name.toLowerCase())) return;   // self-heal no-op
        have.add(name.toLowerCase());
        abilities.push({ name, description: textFor(aid), isCore: CORE_ABILITY_RE.test(name) });
      });
    }
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
    // Consensus overlay adds (see abilityFixOv above). Core adds resolve
    // through the ability store by id; named adds carry New Recruit's rules
    // text (the store has no entry to point at). `updateNamed` rewrites an
    // existing ability's description in place — gated on `expectContains` so
    // it self-heals once upstream 40kdc-abilities carries the new text.
    if (abilityFixOv) {
      const have = new Set(abilities.map((a) => a.name.toLowerCase()));
      // GW's faction packs print the ability name at the head of the rules
      // paragraph — "Adaptive Instincts (Once per turn, per unit): In the Fight
      // phase, …" — and the FAQ processor lifts the paragraph verbatim. Every
      // renderer already shows the name as its own heading, so that prefix
      // renders the name twice in a row. Strip a leading copy of the name, with
      // or without a trailing "(qualifier)". Tolerant of the curly apostrophes
      // and non-breaking spaces GW's PDFs are full of.
      const stripEchoedName = (name, desc) => {
        if (!name || !desc) return desc || '';
        const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/['’]/g, "['’]").replace(/\s+/g, '[\\s\\u00a0]+');
        return String(desc)
          .replace(new RegExp('^' + esc + '(?:[\\s\\u00a0]*\\([^)]*\\))?[\\s\\u00a0]*:[\\s\\u00a0]*', 'i'), '')
          .trim();
      };
      (abilityFixOv.updateNamed || []).forEach((u) => {
        if (!u || !u.name) return;
        const target = abilities.find((a) => a.name && a.name.toLowerCase() === u.name.toLowerCase());
        if (!target) return;   // ability not present → no-op
        if (u.expectContains && !(target.description || '').toLowerCase()
              .includes(String(u.expectContains).toLowerCase())) return;   // already updated upstream → no-op
        target.description = stripEchoedName(target.name, u.description || '');
      });
      (abilityFixOv.addCore || []).forEach((aid) => {
        let av = null;
        try { av = DC.abilities.getAny ? DC.abilities.getAny(aid) : DC.abilities.get(aid); } catch (_) {}
        const name = (av && (av.name || (av.raw && av.raw.name))) || titleCase(String(aid).replace(/-/g, ' '));
        if (have.has(name.toLowerCase())) return;   // self-heal no-op
        have.add(name.toLowerCase());
        abilities.push({ name, description: textFor(aid), isCore: true });
      });
      (abilityFixOv.addNamed || []).forEach((p) => {
        const name = p && p.name;
        if (!name || have.has(name.toLowerCase())) return;
        have.add(name.toLowerCase());
        abilities.push({ name, description: stripEchoedName(name, p.description || ''),
                         isCore: CORE_ABILITY_RE.test(name) });
      });
    }
    // Re-add the attachment ROLE as the core ability the printed datasheet
    // shows (see ATTACH_ROLE_ABILITY). `attachmentRole` still drives the detail
    // pane's Leader/Support section with its eligible-target list; this is what
    // puts the keyword itself on the card, in print, and in every export.
    // No-ops if an ability of that name is already present, so it self-heals if
    // 40kdc ever starts linking a real per-faction leader/support ability id.
    const roleAbility = ATTACH_ROLE_ABILITY[u.attachment_role];
    if (roleAbility
        && !abilities.some((a) => a.name.toLowerCase() === roleAbility.name.toLowerCase())) {
      abilities.push({ name: roleAbility.name, description: roleAbility.description, isCore: true });
    }
    // Route ability-modelled wargear abilities out of the normal Abilities
    // list. Their prose refers to "the bearer" of a wargear item (a single
    // model carrying it) whereas innate abilities say "this unit" / "this
    // model" — a clean discriminator across the whole dataset (114 units, zero
    // false positives). Complements the item scan below: some wargear abilities
    // are linked as ability_ids on the datasheet (e.g. Death Totem) rather than
    // as an item on a wargear option, so the item scan alone misses them.
    const WARGEAR_BEARER_RE = /\bthe bearer\b|bearer['’]s\b/i;
    const abilityWargear = [];
    for (let i = abilities.length - 1; i >= 0; i--) {
      const a = abilities[i];
      if (!a.isCore && WARGEAR_BEARER_RE.test(a.description || '')) {
        abilityWargear.unshift({ name: a.name, description: a.description });
        abilities.splice(i, 1);
      }
    }

    // ── Wargear abilities ──────────────────────────────────────────────
    // 11e reintroduced wargear that confers an ability / stat change (storm
    // shield → +Wounds, Astartes shield → 4++ invuln, Reiver grav-chute →
    // Deep Strike, …). 40kdc keeps the prose in the ability-text store keyed
    // by the WARGEAR ITEM id, but never links it onto the datasheet — the unit
    // references the item through weapon_ids / wargear options, not
    // ability_ids — so it never rendered. Gather every wargear item the unit
    // can field and surface the ones that carry ability text, mirroring
    // Wahapedia's "Wargear Abilities" block. `textFor(id)` empty for ordinary
    // weapons, so those are filtered out automatically. Self-heals: the name
    // dedupe drops anything upstream later links as a real ability.
    const wargearAbilities = (function () {
      const itemIds = new Set();
      (u.weapon_ids || []).forEach((id) => id && itemIds.add(id));
      (u.wargear_budgets || []).forEach((b) => (b && b.items || []).forEach((id) => id && itemIds.add(id)));
      let wgos = [];
      try { wgos = uv.wargearOptions || []; } catch (_) { wgos = []; }
      wgos.forEach((w) => {
        const raw = (w && w.raw) || w || {};
        (raw.replaces || []).forEach((id) => id && itemIds.add(id));
        (raw.replacement || []).forEach((id) => id && itemIds.add(id));
        (raw.replacement_choice || []).forEach((grp) => (grp || []).forEach((id) => id && itemIds.add(id)));
      });
      const haveNames = new Set(abilities.map((a) => a.name.toLowerCase()));
      const seen = new Set();
      const out = [];
      itemIds.forEach((id) => {
        const desc = textFor(id);
        if (!desc) return;                          // ordinary weapon / no wargear ability
        let item = null;
        try { item = (DC.wargear && DC.wargear.get(id)) || (DC.weapons && DC.weapons.get && DC.weapons.get(id)); } catch (_) {}
        const rawName = (item && (item.name || (item.raw && item.raw.name))) || String(id).replace(/-/g, ' ');
        const name = titleCase(rawName);
        const key = name.toLowerCase();
        if (haveNames.has(key) || seen.has(key)) return;   // already a normal ability, or dup
        seen.add(key);
        out.push({ name, description: desc });
      });
      return out;
    })();
    // Merge the ability-modelled wargear abilities in (dedupe by name).
    abilityWargear.forEach((wa) => {
      const key = wa.name.toLowerCase();
      if (!wargearAbilities.some((x) => x.name.toLowerCase() === key)) wargearAbilities.push(wa);
    });
    // Consensus overlay wargear-ability adds (New Recruit rules text).
    if (abilityFixOv && Array.isArray(abilityFixOv.addWargear)) {
      const haveAb = new Set(abilities.map((a) => a.name.toLowerCase()));
      abilityFixOv.addWargear.forEach((p) => {
        const key = p && p.name && p.name.toLowerCase();
        if (!key || haveAb.has(key)) return;   // self-heal no-op
        if (!wargearAbilities.some((x) => x.name.toLowerCase() === key)) {
          wargearAbilities.push({ name: p.name, description: p.description || '' });
        }
      });
    }
    // ── Structured wargear profile (drives the wargear picker) ─────────
    // 40kdc authors each datasheet's wargear options as machine-readable
    // swap/add records (replaces + replacement/replacement_choice +
    // model_constraint) plus take-limits (wargear_budgets, e.g. "1 plasma
    // pistol per 3 models") and size-tiered composition. Map them into a
    // renderer-friendly shape; null when the unit has none authored.
    // Costs: 11e prices SOME wargear per item taken (MFM: "applied on top of
    // the unit's main points cost", defaults included).
    //
    // Upstream 40kdc NOW ships these as `unit.wargear_costs`
    // ([{item_id, cost}]), so prefer it: as of 2026-07-28 it covers 50 units
    // against our MFM scrape's 42, with 46/46 shared item prices identical and
    // zero disagreements — a strict superset. The window.DC.wargearCosts
    // overlay (scraped from the official MFM site by ~/sites/base/
    // mfm-scrape-wargear.py, keyed "faction_id/unit_id" → {item_id: pts}) stays
    // as a fallback/override for anything upstream hasn't priced yet. NB the
    // scraper's OTHER output, DC.mfmPoints, remains the points authority.
    // Weapons a unit can TAKE but isn't issued by default.
    //
    // 40kdc's `weapon_ids` is only the default loadout; swap options live in
    // wargear-options as { replaces: [given up], replacement / replacement_choice:
    // [gained] }. weaponRows() only walked weapon_ids, so option-only weapons were
    // absent from unit.weapons entirely — the Venerable Dreadnought's Helfrost
    // cannon and Fenrisian great axe exist in 40kdc with full profiles and ARE
    // linked to the unit via 4 wargear options, yet never reached us. The
    // datasheet still showed them (it renders the GDC rows, which list every
    // profile on the sheet), so the gap was invisible on screen while
    // damage-calc / list-coach / analytics could not see the weapons at all.
    //
    // Only `replacement`/`replacement_choice` are read — NOT `replaces`, which is
    // what the model gives up and is normally already in the default loadout.
    // Rows are appended with `_optional: true` so consumers can tell "can take"
    // from "is armed with"; nothing here implies the model carries them all at
    // once (the wargear picker remains the authority on legal combinations).
    function optionWeaponRows() {
      let wgos = [];
      try { wgos = uv.wargearOptions || []; } catch (_) { return []; }
      if (!wgos.length) return [];
      const have = new Set((u.weapon_ids || []).filter(Boolean));
      const ids = new Set();
      wgos.forEach((w) => {
        const raw = (w && w.raw) || w || {};
        (raw.replacement || []).forEach((id) => id && !have.has(id) && ids.add(id));
        (raw.replacement_choice || []).forEach((grp) =>
          (grp || []).forEach((id) => id && !have.has(id) && ids.add(id)));
      });
      if (!ids.size) return [];
      const views = [];
      ids.forEach((id) => {
        let w = null;
        try {
          w = (DC.weapons.getInFaction && DC.weapons.getInFaction(id, u.faction_id))
            || (DC.weapons.getAny && DC.weapons.getAny(id))
            || (DC.weapons.get && DC.weapons.get(id));
        } catch (_) { w = null; }
        const raw = (w && (w.raw || w)) || null;
        if (raw && Array.isArray(raw.profiles)) views.push({ raw: raw });
      });
      return weaponRows(views).map((r) => Object.assign(r, { _optional: true }));
    }

    const wargearProfile = (function () {
      const upstreamCosts = Array.isArray(u.wargear_costs) && u.wargear_costs.length
        ? u.wargear_costs.reduce((m, c) => (c && c.item_id ? (m[c.item_id] = c.cost, m) : m), {})
        : null;
      const overlayCosts = (DC.wargearCosts && DC.wargearCosts[u.faction_id + '/' + u.id]) || null;
      const itemCosts = (upstreamCosts || overlayCosts)
        ? Object.assign({}, upstreamCosts || {}, overlayCosts || {})
        : null;
      const costOf = (id) => (itemCosts && itemCosts[id]) || 0;
      const itemName = (id) => {
        let it = null;
        try { it = DC.weapons.getInFaction ? DC.weapons.getInFaction(id, u.faction_id) : null; } catch (_) {}
        if (!it) { try { it = DC.weapons.getAny ? DC.weapons.getAny(id) : DC.weapons.get(id); } catch (_) {} }
        if (!it) { try { it = DC.wargear.getAny ? DC.wargear.getAny(id) : DC.wargear.get(id); } catch (_) {} }
        // Ability-modelled wargear (death totem, icons, …) has its display
        // name on the abilities collection rather than the item collections.
        if (!it) { try { it = DC.abilities.getAny ? DC.abilities.getAny(id) : DC.abilities.get(id); } catch (_) {} }
        const nm = it && (it.name || (it.raw && it.raw.name));
        return nm || String(id).replace(/-/g, ' ');
      };
      let wgos = [];
      try { wgos = uv.wargearOptions || []; } catch (_) { wgos = []; }
      const options = wgos.map((w) => {
        const r = (w && w.raw) || w || {};
        const groups = Array.isArray(r.replacement_choice) ? r.replacement_choice
          : (Array.isArray(r.replacement) ? [r.replacement] : []);
        return {
          id: r.id,
          replaces: (r.replaces || []).map((id) => ({ id, name: itemName(id) })),
          choices: groups.map((grp) => (grp || []).map((id) => ({ id, name: itemName(id) }))),
          constraint: r.model_constraint || {},
          // Upstream per-option surcharge — still 0 across the whole dataset
          // (their importer drops the dump's points); real prices come from
          // itemCosts below. If upstream ever populates additional_cost,
          // revisit the overlay to avoid double-charging.
          cost: (r.additional_cost > 0 && !itemCosts) ? r.additional_cost : 0,
        };
      }).filter((o) => o.id && o.choices.length);
      const budgets = (u.wargear_budgets || []).map((b) => ({
        items: (b && b.items || []).map((id) => ({ id, name: itemName(id) })),
        count: (b && b.count) || 0,
        perModels: (b && b.per_models) || 0,
      })).filter((b) => b.items.length && b.count > 0);
      // Per-squad-size model roster (from composition tiers) so the picker can
      // resolve model_name-scoped limits at the chosen squad size, plus the
      // DEFAULT loadout per size ("10 models → 10× gauss flayer, 10× close
      // combat weapon") so the picker can show what the squad starts with and
      // net swaps against it.
      let modelsBySize = null;
      let defaultsBySize = null;
      try {
        const ds = uv.ds;
        const comp = ds && ds.compositionByUnit && ds.compositionByUnit.get(u.faction_id + '::' + u.id);
        const rawComp = comp && (comp.raw || comp);
        const defByModel = {};
        (rawComp && rawComp.models || []).forEach((m) => {
          if (m && m.name && Array.isArray(m.default_weapon_ids)) defByModel[m.name] = m.default_weapon_ids;
        });
        // A tier without explicit per-model rosters falls back to the
        // composition's own model list.
        const tiers = (rawComp && Array.isArray(rawComp.tiers) && rawComp.tiers.length)
          ? rawComp.tiers
          : (rawComp && rawComp.models ? [{ models: rawComp.models }] : []);
        if (tiers.length) {
          modelsBySize = {};
          defaultsBySize = {};
          tiers.forEach((t) => {
            const models = (t && t.models) || [];
            let total = 0; const byName = {}; const items = new Map();
            models.forEach((m) => {
              const n = (m && (m.max != null ? m.max : m.min)) || 0;
              total += n;
              if (!m || !m.name) return;
              byName[m.name] = n;
              (defByModel[m.name] || []).forEach((id) => items.set(id, (items.get(id) || 0) + n));
            });
            if (total > 0) {
              modelsBySize[total] = byName;
              defaultsBySize[total] = [...items.entries()].map(([id, count]) => ({ id, name: itemName(id), count }));
            }
          });
          if (!Object.keys(modelsBySize).length) { modelsBySize = null; defaultsBySize = null; }
        }
        // Ensure every SELECTABLE squad size (squadOptions) has an entry —
        // units without authored tiers (Wolf Guard Headtakers: 3–12 models +
        // 0–2 wolves, no tiers[]) otherwise fall back to a max-size roster.
        // Distribute: every model group at its min, then fill groups toward
        // their max in declared order until the size is reached.
        const distribute = (models, size) => {
          if (!Array.isArray(models) || !models.length) return null;
          const byName = {}; let used = 0;
          models.forEach((m) => { const n = (m && m.min) || 0; if (m && m.name) byName[m.name] = n; used += n; });
          let rem = size - used;
          if (rem < 0) return null;
          for (const m of models) {
            if (rem <= 0) break;
            if (!m || !m.name) continue;
            const cap = ((m.max != null ? m.max : m.min) || 0) - byName[m.name];
            const add = Math.max(0, Math.min(cap, rem));
            byName[m.name] += add; rem -= add;
          }
          if (rem !== 0) return null;
          return byName;
        };
        (squadOptions || []).forEach((so) => {
          const size = so && so.models;
          if (!size || (defaultsBySize && defaultsBySize[size])) return;
          const byName = distribute(rawComp && rawComp.models, size);
          if (!byName) return;
          const items = new Map();
          Object.keys(byName).forEach((nm) => {
            (defByModel[nm] || []).forEach((id) => items.set(id, (items.get(id) || 0) + byName[nm]));
          });
          modelsBySize = modelsBySize || {};
          defaultsBySize = defaultsBySize || {};
          modelsBySize[size] = byName;
          defaultsBySize[size] = [...items.entries()].map(([id, count]) => ({ id, name: itemName(id), count }));
        });
      } catch (_) { modelsBySize = null; defaultsBySize = null; }
      // Apply hand-patched corrections to upstream wgo/composition errors.
      const fix = WARGEAR_PROFILE_FIXES[u.id];
      if (fix) {
        if (fix.optionReplaces) {
          options.forEach((o) => {
            const ids = fix.optionReplaces[o.id];
            if (ids) o.replaces = ids.map((id) => ({ id, name: itemName(id) }));
          });
        }
        if (fix.andOptions) {
          options.forEach((o) => { if (fix.andOptions.indexOf(o.id) !== -1) o.andSwap = true; });
        }
        if (fix.addDefaults && defaultsBySize) {
          Object.keys(defaultsBySize).forEach((size) => {
            fix.addDefaults.forEach((id) => {
              if (!defaultsBySize[size].some((d) => d.id === id)) {
                defaultsBySize[size].push({ id, name: itemName(id), count: Number(size) });
              }
            });
          });
        }
      }
      // ── 11e per-item wargear costs ──────────────────────────────────
      // Charged against the FINAL loadout: the default loadout owes for any
      // priced items it carries (defaultCostBySize, per squad size) and each
      // swap's pts is the NET delta (picker computes: added − removed — e.g.
      // Terminator Assault Squad pays +5/thunder hammer by default and gets
      // it back when a model swaps to free lightning claws). Priced items
      // that live outside the swap/defaults model entirely (ability-modelled
      // wargear like a banner) are charged flat per squad via alwaysCost.
      let defaultCostBySize = null;
      let alwaysCost = 0;
      if (itemCosts) {
        if (defaultsBySize) {
          defaultCostBySize = {};
          Object.keys(defaultsBySize).forEach((size) => {
            defaultCostBySize[size] = defaultsBySize[size]
              .reduce((s, d) => s + costOf(d.id) * d.count, 0);
          });
        }
        const reachable = new Set();
        if (defaultsBySize) {
          Object.keys(defaultsBySize).forEach((size) =>
            defaultsBySize[size].forEach((d) => reachable.add(d.id)));
        }
        options.forEach((o) => {
          o.replaces.forEach((x) => reachable.add(x.id));
          o.choices.forEach((grp) => grp.forEach((x) => reachable.add(x.id)));
        });
        Object.keys(itemCosts).forEach((id) => {
          if (!reachable.has(id)) alwaysCost += itemCosts[id];
        });
      }
      // Units with priced items but no authored options still need a profile
      // (the base-cost math and the picker's default-loadout chips use it).
      if (!options.length && !itemCosts) return null;
      return { options, budgets, modelsBySize, defaultsBySize,
               itemCosts, defaultCostBySize, alwaysCost };
    })();

    // Apply hand-patched default-wargear links the dataset omits entirely.
    (MISSING_WARGEAR_ABILITIES[u.id] || []).forEach((aid) => {
      const desc = textFor(aid);
      if (!desc) return;                          // no prose upstream → skip
      let src = null;
      try { src = (DC.abilities.getAny ? DC.abilities.getAny(aid) : DC.abilities.get(aid)) || (DC.wargear && DC.wargear.get(aid)); } catch (_) {}
      const rawName = (src && (src.name || (src.raw && src.raw.name))) || String(aid).replace(/-/g, ' ');
      const name = titleCase(rawName);
      const key = name.toLowerCase();
      if (wargearAbilities.some((x) => x.name.toLowerCase() === key)) return;   // already surfaced → self-heal no-op
      if (abilities.some((x) => x.name.toLowerCase() === key)) return;          // already a normal ability
      wargearAbilities.push({ name, description: desc });
    });

    // 11e Aircraft/flyer reconciliation (see AIRCRAFT_ERRATA note above).
    let dropAircraftKw = false;
    const er = AIRCRAFT_ERRATA[u.id];
    const stripHover = () => {
      for (let i = abilities.length - 1; i >= 0; i--) {
        if (/^hover$/i.test(abilities[i].name)) abilities.splice(i, 1);
      }
    };
    if (er) {
      if (er.M) modelStats = modelStats.map((p) => ({ ...p, M: er.M }));
      if (er.OC) modelStats = modelStats.map((p) => ({ ...p, OC: er.OC }));
      if (er.deAircraft) dropAircraftKw = true;
      if (er.removeHover) stripHover();
      if (er.addHover && !abilities.some((a) => /^hover$/i.test(a.name))) {
        abilities.push({ name: 'Hover', description: textFor('hover'), isCore: true });
      }
    } else if (isAircraft(u)) {
      // Default kept-Aircraft rule: no normal move, Hover removed.
      modelStats = modelStats.map((p) => ({ ...p, M: '-' }));
      stripHover();
    }
    let finalKeywords = (u.keywords || []).concat(u.faction_keywords || [])
      .filter((k) => !(dropAircraftKw && /^aircraft$/i.test(String(k).trim())));
    if (FRAME_UNITS.has(u.id)
        && !finalKeywords.some((k) => /^frame$/i.test(String(k).trim()))) {
      finalKeywords = finalKeywords.concat('Frame');
    }
    if (MOBILE_UNITS.has(u.id)
        && !finalKeywords.some((k) => /^mobile$/i.test(String(k).trim()))) {
      finalKeywords = finalKeywords.concat('Mobile');
    }

    return {
      id: u.id,
      name: u.name,
      type: 'unit',
      stats: { M: modelStats[0].M, T: modelStats[0].T, SV: modelStats[0].SV,
               W: modelStats[0].W, LD: modelStats[0].LD, OC: modelStats[0].OC },
      modelStats: modelStats.length > 1 ? modelStats : [{ name: '', ...modelStats[0] }],
      invulnSave: invulnOverride !== undefined
        ? invulnOverride
        : (first.invuln_sv != null ? sv(first.invuln_sv)
           : (condInvuln(first) ? condInvuln(first).value : null)),
      // Conditional-invuln note ("Against ranged attacks only"), shown as `5+*`
      // plus a footnote.
      //
      // 40kdc DOES model this — `invuln_sv_ranged` / `invuln_sv_melee` on the
      // profile, which is strictly more precise than a value + prose note. An
      // earlier comment here claimed the schema had no field for it, so 37
      // hand-authored consensus overlay entries re-encoded facts already in the
      // bundle. Read the real fields first; the overlay stays supported only as
      // an override for anything upstream genuinely lacks.
      invulnNote: invulnNoteOverride !== undefined ? invulnNoteOverride
        : (condInvuln(first) ? condInvuln(first).note : null),
      weapons: weaponRows(uv.weapons).concat(optionWeaponRows()),
      abilities,
      wargearAbilities,
      wargearProfile,
      keywords: finalKeywords,
      wargearOptions: [],
      points: pointsOptions.length ? pointsOptions[0] : 0,
      pointsOptions,
      squadOptions,
      ordinal,                       // { fromCount, surcharge } or null
      description: '',
      isLegends: !!u.is_legend,
      attachmentRole: u.attachment_role || null,   // 'leader' | 'support' | null
      // Fallback "Led By" targets from 40kdc's structured leaderAttachments
      // table, used when GDC prose carries none (e.g. all Necrons leaders). The
      // GDC overlay overwrites this per-unit only when it has its own list.
      gdcLeadBy: leaderLeadByMap().get(u.id) || undefined,
      // Points sourced from the live MFM overlay (also clears provisional —
      // the MFM is the confirmed source upstream's flag is provisional FOR).
      _mfmPoints: !!(mfmPts && mfmPts.length),
      _provisional: !!u.points_provisional && !(mfmPts && mfmPts.length),
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
      // Combat Patrol units (fixed-force mini-game datasheets, 0-point
      // characters, "Assault Force X" / "Sanctuary Guardians Y" names) are
      // matched-play noise in the roster — same exclusion as CP detachments.
      const units = (fv.units || [])
        .filter((uv) => {
          const r = (uv && uv.raw) || uv || {};
          return !(Array.isArray(r.game_modes) && r.game_modes.indexOf('combat-patrol') !== -1);
        })
        .map(toUnit);
      // Combat Patrol detachments (upstream added them 2026-07) are fixed-force
      // mini-game content: 1 detachment point, no rule text, no stratagems.
      // They leaked into the matched-play picker looking broken (The
      // Vardenghast Swarm, bug #12) — exclude them until/unless yaab grows a
      // Combat Patrol mode.
      const dets = DC.detachments.byFaction(f.id)
        .filter((dv) => {
          const d = dv.raw || dv;
          return !(Array.isArray(d.game_modes) && d.game_modes.indexOf('combat-patrol') !== -1);
        })
        .map((d) =>
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

  // ── consensus weapon-profile fixes (window.DC.weaponFixes) ─────────────────
  // Appended to the bundle by the weekly stat checker where wahapedia AND New
  // Recruit agree a weapon row differs from ours. Shape per 'faction::unit':
  //   [{ match: { name, mode: 'ranged'|'melee' },
  //      expect: { Range, A, BSWS, S, AP, D },   // pins our current values
  //      set:    { ...same keys... } }]
  // Expect-gated (no-ops once upstream corrects) and idempotent (after the
  // set is applied the expect no longer matches). Runs after the GDC weapon
  // merge so both weapon shapes (u.weapons rows and gdc profile lists) are
  // covered.
  const WFIX_ID_BY_NAME = (function () {
    const m = {};
    Object.keys(FACTION_NAME).forEach((fid) => { m[FACTION_NAME[fid]] = fid; });
    return m;
  })();
  function wfNorm(v) {
    const s = String(v == null ? '' : v).toLowerCase().replace(/["+*\s]/g, '');
    return (s === '0' || s === '-' || s === '—') ? '' : s;
  }
  // Option-weapon rows carry the stats of a SHARED weapon entity, whose skill is
  // the wrong wielder's: 40kdc stores one `helfrost-cannon`, and the Wulfen
  // Dreadnought that also takes it hits on 2+ where the Venerable Dreadnought
  // hits on 3+. Skill is a property of the model, not the gun.
  //
  // So once the GDC rows are merged (they are per-DATASHEET, i.e. already
  // wielder-correct), copy their values onto our `_optional` rows. Runs after the
  // GDC merge for that reason, alongside applyWeaponFixes. Only touches rows we
  // added ourselves, and only where a same-named GDC profile exists.
  function syncOptionalWeaponsFromGdc(factions) {
    if (!Array.isArray(factions)) return;
    const key = (v) => String(v == null ? '' : v).toLowerCase()
      .replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9]/g, '');
    factions.forEach((f) => (f.units || []).forEach((u) => {
      const opts = (u.weapons || []).filter((w) => w && w._optional);
      if (!opts.length) return;
      const idx = new Map();
      [u.gdcRangedWeapons, u.gdcMeleeWeapons].forEach((lst) => (lst || []).forEach((w) =>
        ((w && w.profiles) || []).forEach((p) => {
          const k = key(p && p.name);
          if (k && !idx.has(k)) idx.set(k, p);
        })));
      if (!idx.size) return;
      opts.forEach((w) => {
        const p = idx.get(key(w.name));
        if (!p) return;
        const melee = String(w.Range || '').toLowerCase().indexOf('melee') === 0;
        if (p.attacks != null && p.attacks !== '') w.A = String(p.attacks);
        if (p.strength != null && p.strength !== '') w.S = String(p.strength);
        if (p.ap != null && p.ap !== '') w.AP = String(p.ap);
        if (p.damage != null && p.damage !== '') w.D = String(p.damage);
        if (p.skill != null && p.skill !== '') {
          const sk = String(p.skill);
          if (melee) w.WS = sk; else w.BS = sk;
        }
        if (!melee && p.range != null && p.range !== '') w.Range = String(p.range);
      });
    }));
  }

  function applyWeaponFixes(factions) {
    const all = DC.weaponFixes || {};
    if (!Object.keys(all).length || !Array.isArray(factions)) return;
    factions.forEach((f) => {
      const fid = WFIX_ID_BY_NAME[f.factionName];
      if (!fid) return;
      (f.units || []).forEach((u) => {
        const fixes = all[fid + '::' + u.id];
        if (!fixes) return;
        fixes.forEach((fx) => {
          const wantName = String((fx.match && fx.match.name) || '').toLowerCase();
          const wantMode = (fx.match && fx.match.mode) || 'ranged';
          const exp = fx.expect || {};
          const set = fx.set || {};
          const expMatch = (cur) => Object.keys(exp).every((k) => wfNorm(cur[k]) === wfNorm(exp[k]));
          (u.weapons || []).forEach((w) => {
            if (String(w.name || '').toLowerCase() !== wantName) return;
            const mode = wfNorm(w.Range) === 'melee' ? 'melee' : 'ranged';
            if (mode !== wantMode) return;
            if (!expMatch({ Range: w.Range, A: w.A, BSWS: w.BS != null ? w.BS : w.WS,
                            S: w.S, AP: w.AP, D: w.D })) return;
            if ('Range' in set) w.Range = set.Range;
            if ('A' in set) w.A = set.A;
            if ('BSWS' in set) { if (mode === 'melee') w.WS = set.BSWS; else w.BS = set.BSWS; }
            if ('S' in set) w.S = set.S;
            if ('AP' in set) w.AP = set.AP;
            if ('D' in set) w.D = set.D;
          });
          const lst = wantMode === 'melee' ? u.gdcMeleeWeapons : u.gdcRangedWeapons;
          (lst || []).forEach((w) => ((w && w.profiles) || []).forEach((p) => {
            const pname = String(p.name || (w && w.name) || '').toLowerCase();
            if (pname !== wantName) return;
            // melee gdc profiles usually carry no range; mirror the renderers'
            // 'Melee' default so the expect pin still matches.
            const curRange = (p.range != null && p.range !== '') ? p.range
              : (wantMode === 'melee' ? 'Melee' : '');
            if (!expMatch({ Range: curRange, A: p.attacks, BSWS: p.skill,
                            S: p.strength, AP: p.ap, D: p.damage })) return;
            if ('Range' in set && wantMode !== 'melee') p.range = set.Range;
            if ('A' in set) p.attacks = set.A;
            if ('BSWS' in set) p.skill = set.BSWS;
            if ('S' in set) p.strength = set.S;
            if ('AP' in set) p.ap = set.AP;
            if ('D' in set) p.damage = set.D;
          }));
        });
      });
    });
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
    // Weapon fixes for the non-GDC rows (idempotent; re-run post-GDC below
    // for the gdc profile lists that merge creates).
    try { syncOptionalWeaponsFromGdc(factions); } catch (_) {}
    try { applyWeaponFixes(factions); } catch (_) {}

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
        try { syncOptionalWeaponsFromGdc(App.state.factions); } catch (_) {}
        try { applyWeaponFixes(App.state.factions); } catch (_) {}

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
    _applyWeaponFixes: applyWeaponFixes,
    _syncOptionalWeaponsFromGdc: syncOptionalWeaponsFromGdc,
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
