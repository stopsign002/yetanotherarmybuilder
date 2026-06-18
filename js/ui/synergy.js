// ui/synergy.js — detects leader attachments, keyword combos, and faction synergies in the current army.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const BTN_ID = 'yaab-btn-synergy';

  // ──────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function keywordsOf(unit) {
    const kws = (unit && unit.keywords) || [];
    const out = [];
    for (let i = 0; i < kws.length; i++) {
      const k = kws[i];
      if (typeof k === 'string') { if (k) out.push(k); continue; }
      if (k && typeof k === 'object') {
        const n = k.name || k.keyword || '';
        if (n) out.push(n);
      }
    }
    return out;
  }

  function hasKeyword(unit, name) {
    const lower = String(name).toLowerCase();
    const kws = keywordsOf(unit);
    for (let i = 0; i < kws.length; i++) {
      if (kws[i].toLowerCase() === lower) return true;
    }
    return false;
  }

  function anyKeywordMatches(unit, re) {
    const kws = keywordsOf(unit);
    for (let i = 0; i < kws.length; i++) {
      if (re.test(kws[i])) return true;
    }
    return false;
  }

  function abilitiesText(unit) {
    const abs = (unit && unit.abilities) || [];
    let out = '';
    for (let i = 0; i < abs.length; i++) {
      const a = abs[i];
      if (!a) continue;
      out += ' ' + (a.name || '') + ' ' + (a.description || '');
    }
    return out;
  }

  function hasCoreAbility(unit, name) {
    const abs = (unit && unit.abilities) || [];
    const lower = String(name).toLowerCase();
    for (let i = 0; i < abs.length; i++) {
      const a = abs[i];
      if (!a || !a.isCore) continue;
      if (String(a.name || '').toLowerCase() === lower) return true;
    }
    return false;
  }

  function getUnits(army) {
    const entries = (army && army.entries) || [];
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || !e.unitData) continue;
      out.push({ unit: e.unitData, entry: e, index: i });
    }
    return out;
  }

  function nameIncludes(unit, substr) {
    return String(unit.name || '').toLowerCase().indexOf(String(substr).toLowerCase()) !== -1;
  }

  function anyUnit(units, pred) {
    for (let i = 0; i < units.length; i++) {
      if (pred(units[i].unit, units[i])) return units[i];
    }
    return null;
  }

  function findByNameSubstr(units, substr) {
    return anyUnit(units, u => nameIncludes(u, substr));
  }

  // ──────────────────────────────────────────────────────────────
  // 1. Leader-pairing detector (mirrors ui/detail.js Led-By parse)
  // ──────────────────────────────────────────────────────────────

  function detectLeaderPairings(units) {
    const out = [];
    // Source of truth is App.Attachments (GDC `gdcLeadBy` overlay + any genuine
    // "can be attached to" prose). 40kdc's generic "leader" ability was dropped
    // in the adapter — its single shared text wrongly paired every leader with
    // Raveners — so we no longer scan unit prose directly here.
    const A = App.Attachments;
    if (!A || typeof A.canAttach !== 'function') return out;
    for (let i = 0; i < units.length; i++) {
      const leaderWrap = units[i];
      const leader = leaderWrap.unit;
      if (leader.attachmentRole && leader.attachmentRole !== 'leader') continue;
      for (let k = 0; k < units.length; k++) {
        if (k === i) continue;
        const targetWrap = units[k];
        const target = targetWrap.unit;
        const res = A.canAttach(leader, target);
        if (!res || !res.ok) continue;
        out.push({
          type: 'leader-target',
          leaderName:   leader.name,
          leaderUnit:   leader,
          leaderEntryIndex: leaderWrap.index,
          targetName:   target.name,
          targetUnit:   target,
          targetEntryIndex: targetWrap.index,
          description:  leader.name + ' can be attached to ' + target.name + '.',
        });
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Keyword-combo rule table (generic, no faction guessing)
  // ──────────────────────────────────────────────────────────────

  const KEYWORD_COMBOS = [
    {
      name: 'Battleline anchors objectives',
      explain: 'Your Battleline units each have OC2 in 10e, so they score primary secondary missions more reliably than non-Battleline troops of the same points.',
      match(units) {
        const bl = units.filter(w => hasKeyword(w.unit, 'Battleline'));
        return bl.length >= 2 ? { count: bl.length } : null;
      },
    },
    {
      name: 'Deep Strike reserve threat',
      explain: 'Multiple units with the Deep Strike core ability let you hold back a second-wave threat and pressure objectives from turn 2 onwards.',
      match(units) {
        const ds = units.filter(w => hasCoreAbility(w.unit, 'Deep Strike'));
        return ds.length >= 2 ? { count: ds.length } : null;
      },
    },
    {
      name: 'Scouts pre-game repositioning',
      explain: 'Units with the Scouts ability redeploy before turn 1, giving board control or early charge threats on turn 1.',
      match(units) {
        const sc = units.filter(w => anyKeywordMatches(w.unit, /^scouts?\b/i) ||
                                     /\bscouts\s+\d/i.test(abilitiesText(w.unit)));
        return sc.length >= 1 ? { count: sc.length } : null;
      },
    },
    {
      name: 'Infiltrators board pressure',
      explain: 'Infiltrators set up outside your deployment zone, blocking enemy deep strikes and holding midfield objectives early.',
      match(units) {
        const inf = units.filter(w => hasKeyword(w.unit, 'Infiltrators') ||
                                      /\binfiltrators\b/i.test(abilitiesText(w.unit)));
        return inf.length >= 1 ? { count: inf.length } : null;
      },
    },
    {
      name: 'Psyker presence',
      explain: 'Psyker units often unlock faction-wide psychic strategies or detachment rules. Multiple Psykers give redundancy against character-sniping.',
      match(units) {
        const ps = units.filter(w => hasKeyword(w.unit, 'Psyker'));
        return ps.length >= 2 ? { count: ps.length } : null;
      },
    },
    {
      name: 'Character + Vehicle escort',
      explain: 'A Character hidden among Vehicles gains Look Out, Sir (if in a unit) and enables buff auras for your tanks.',
      match(units) {
        const chars = units.filter(w => hasKeyword(w.unit, 'Character'));
        const vehicles = units.filter(w => hasKeyword(w.unit, 'Vehicle'));
        if (chars.length >= 1 && vehicles.length >= 2) {
          return { chars: chars.length, vehicles: vehicles.length };
        }
        return null;
      },
    },
    {
      name: 'Monster mash',
      explain: 'Multiple Monster units overload opposing anti-tank fire — each additional Monster soaks high-S shots meant for the others.',
      match(units) {
        const ms = units.filter(w => hasKeyword(w.unit, 'Monster'));
        return ms.length >= 2 ? { count: ms.length } : null;
      },
    },
    {
      name: 'Transport + Infantry bodyguard',
      explain: 'A Dedicated Transport protects an Infantry squad from turn-1 fire and delivers them into midfield — a classic 10e speed play.',
      match(units) {
        const trans = units.filter(w => hasKeyword(w.unit, 'Dedicated Transport') || hasKeyword(w.unit, 'Transport'));
        const inf   = units.filter(w => hasKeyword(w.unit, 'Infantry'));
        if (trans.length >= 1 && inf.length >= 2) {
          return { trans: trans.length, inf: inf.length };
        }
        return null;
      },
    },
    {
      name: 'Fly / Aircraft redeploy',
      explain: 'Aircraft and Fly units ignore terrain and screens, letting you score Behind Enemy Lines or Engage on All Fronts reliably.',
      match(units) {
        const fliers = units.filter(w => hasKeyword(w.unit, 'Aircraft') || hasKeyword(w.unit, 'Fly'));
        return fliers.length >= 1 ? { count: fliers.length } : null;
      },
    },
    {
      name: 'Mortal-wound weapon cluster',
      explain: 'Multiple sources of Devastating Wounds or Lethal Hits stack at the army level — hard targets crumble fast when they can\'t rely on saves.',
      match(units) {
        let count = 0;
        for (let i = 0; i < units.length; i++) {
          const weapons = units[i].unit.weapons || [];
          for (let j = 0; j < weapons.length; j++) {
            const kw = String(weapons[j].Keywords || '');
            if (/devastating\s+wounds/i.test(kw) || /lethal\s+hits/i.test(kw)) {
              count++;
              break;
            }
          }
        }
        return count >= 2 ? { count } : null;
      },
    },
    {
      name: 'Anti-tank spike',
      explain: 'Weapons with Anti-Vehicle or Anti-Monster auto-wound on the printed threshold — stacking two or more carriers gives reliable answers to elite heavy targets.',
      match(units) {
        let count = 0;
        for (let i = 0; i < units.length; i++) {
          const weapons = units[i].unit.weapons || [];
          for (let j = 0; j < weapons.length; j++) {
            const kw = String(weapons[j].Keywords || '');
            if (/anti-vehicle/i.test(kw) || /anti-monster/i.test(kw) || /anti-titanic/i.test(kw)) {
              count++;
              break;
            }
          }
        }
        return count >= 2 ? { count } : null;
      },
    },
    {
      name: 'Sustained Hits volume',
      explain: 'Sustained Hits multiplies output against horde-armor targets. Two or more carriers drown mid-toughness units in wounds.',
      match(units) {
        let count = 0;
        for (let i = 0; i < units.length; i++) {
          const weapons = units[i].unit.weapons || [];
          for (let j = 0; j < weapons.length; j++) {
            const kw = String(weapons[j].Keywords || '');
            if (/sustained\s+hits/i.test(kw)) { count++; break; }
          }
        }
        return count >= 2 ? { count } : null;
      },
    },
    {
      name: 'Melta melt-the-tank',
      explain: 'Stacking Melta weapons inside 12" gives you the alpha-strike answer to enemy vehicles — pair with a Transport or Deep Strike to land the shot.',
      match(units) {
        let count = 0;
        for (let i = 0; i < units.length; i++) {
          const weapons = units[i].unit.weapons || [];
          for (let j = 0; j < weapons.length; j++) {
            const kw = String(weapons[j].Keywords || '');
            if (/\bmelta\b/i.test(kw)) { count++; break; }
          }
        }
        return count >= 2 ? { count } : null;
      },
    },
    {
      name: 'Character leadership pool',
      explain: 'Multiple Characters in the list means you can commit one as your warlord and keep attached-leader options open — and you still have a backup if one dies.',
      match(units) {
        const chars = units.filter(w => hasKeyword(w.unit, 'Character'));
        return chars.length >= 3 ? { count: chars.length } : null;
      },
    },
    {
      name: 'Indirect-fire screen',
      explain: 'Two or more indirect-fire carriers let you threaten hidden units and chip shots from cover without exposing models.',
      match(units) {
        let count = 0;
        for (let i = 0; i < units.length; i++) {
          const weapons = units[i].unit.weapons || [];
          for (let j = 0; j < weapons.length; j++) {
            const kw = String(weapons[j].Keywords || '');
            if (/indirect\s+fire/i.test(kw)) { count++; break; }
          }
        }
        return count >= 2 ? { count } : null;
      },
    },
  ];

  // ──────────────────────────────────────────────────────────────
  // 3. Composition notes (advisory, non-overlapping with validation.js)
  // ──────────────────────────────────────────────────────────────

  function detectCompositionNotes(units) {
    const notes = [];
    if (units.length < 2) return notes;

    const battleline = units.filter(w => hasKeyword(w.unit, 'Battleline'));
    if (battleline.length < 2) {
      notes.push({
        name: 'Light on Battleline',
        explain: 'Only ' + battleline.length + ' Battleline ' + (battleline.length === 1 ? 'unit' : 'units') +
                 ' — primary-mission scoring may suffer. 10e missions reward OC2 troops on objectives.',
      });
    }

    // Mono-dimensional composition check (all same role bucket).
    const roleFor = unit => {
      if (hasKeyword(unit, 'Character'))  return 'Character';
      if (hasKeyword(unit, 'Battleline')) return 'Battleline';
      if (hasKeyword(unit, 'Monster'))    return 'Monster';
      if (hasKeyword(unit, 'Vehicle'))    return 'Vehicle';
      if (hasKeyword(unit, 'Psyker'))     return 'Psyker';
      if (hasKeyword(unit, 'Infantry'))   return 'Infantry';
      return 'Other';
    };
    const nonCharRoles = new Set();
    for (let i = 0; i < units.length; i++) {
      const r = roleFor(units[i].unit);
      if (r !== 'Character') nonCharRoles.add(r);
    }
    if (units.length >= 3 && nonCharRoles.size === 1) {
      const only = Array.from(nonCharRoles)[0];
      notes.push({
        name: 'Mono-role composition',
        explain: 'Every non-Character in the list is ' + only + '. Opponents who bring the right counter will crush the list — consider mixing roles.',
      });
    }

    // Any unit's Deep Strike / Scouts / Infiltrators unused? (Purely informational)
    let hasDeepStrike = false, hasTransport = false, hasInfantry = false;
    for (let i = 0; i < units.length; i++) {
      if (hasCoreAbility(units[i].unit, 'Deep Strike')) hasDeepStrike = true;
      if (hasKeyword(units[i].unit, 'Dedicated Transport') || hasKeyword(units[i].unit, 'Transport')) hasTransport = true;
      if (hasKeyword(units[i].unit, 'Infantry')) hasInfantry = true;
    }
    if (hasTransport && !hasInfantry) {
      notes.push({
        name: 'Transport without passengers',
        explain: 'You have a Transport but no Infantry to ride in it. Add a squad to make the transport useful.',
      });
    }

    return notes;
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Faction-specific synergies (name-substring matched)
  // ──────────────────────────────────────────────────────────────
  //
  // Each rule: detect(units, army) -> { name, explain } | null
  // Rules use .toLowerCase() name-substring matching to avoid false positives.

  const FACTION_SYNERGIES = [
    {
      detect(units) {
        if (findByNameSubstr(units, 'eldrad') && findByNameSubstr(units, 'farseer')) {
          return { name: 'Aeldari: Eldrad + Farseer', explain: 'Two Farseer-class psykers stack Fate Dice manipulation — one rerolls, the other locks the die face for the big moment.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'hive tyrant') && findByNameSubstr(units, 'genestealer')) {
          return { name: 'Tyranids: Hive Tyrant + Genestealers', explain: 'Synapse bubble keeps the Genestealers in formation while they push up the table with Lightning Reflexes — a fast-melee package anchored by a psyker-warlord.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        const captain = findByNameSubstr(units, 'captain');
        const intercessor = units.find(w => /intercessor|heavy\s+intercessor/i.test(String(w.unit.name || '')));
        if (captain && intercessor) {
          return { name: 'Space Marines: Captain + Intercessors', explain: 'A Captain delivers Oath of Moment rerolls through the squad and can be the Oath-target caller — bolter fire on your warlord\'s target becomes reliable.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'khârn') || findByNameSubstr(units, 'kharn')) {
          if (findByNameSubstr(units, 'berzerker')) {
            return { name: 'World Eaters: Khârn + Berzerkers', explain: 'Khârn leads Berzerkers to Advance-and-Charge range, unlocking the faction\'s signature turn-2 melee wave.' };
          }
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'abaddon') && (findByNameSubstr(units, 'chaos terminator') || findByNameSubstr(units, 'chosen'))) {
          return { name: 'Black Legion: Abaddon + Chosen/Terminators', explain: 'Abaddon enables Mark-of-Chaos rerolls and can bodyguard inside a Chosen or Terminator squad for maximum melee alpha-strike.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        const ghaz = findByNameSubstr(units, 'ghazghkull');
        const boyz = units.find(w => /\bboyz\b/i.test(String(w.unit.name || '')) || /\bnobz\b/i.test(String(w.unit.name || '')));
        if (ghaz && boyz) {
          return { name: 'Orks: Ghazghkull + Boyz/Nobz', explain: 'Ghazghkull joins a big green squad and turns it into a Waaagh!-powered hammer — max attacks, Sustained Hits 1, and a 2+ save ride-along.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'guilliman') && (findByNameSubstr(units, 'bladeguard') || findByNameSubstr(units, 'assault intercessor'))) {
          return { name: 'Ultramarines: Guilliman + Bladeguard', explain: 'Roboute leads a premium melee squad and re-rolls every wound roll for the whole army — a classic Ultramarines stomp package.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'logan grimnar') && findByNameSubstr(units, 'wolf guard')) {
          return { name: 'Space Wolves: Logan + Wolf Guard', explain: 'Logan re-rolls hits for his unit and counts as two Oath-target characters for the strategy-point economy.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'dante') && findByNameSubstr(units, 'sanguinary guard')) {
          return { name: 'Blood Angels: Dante + Sanguinary Guard', explain: 'Dante deep-strikes with Sanguinary Guard and lands a 6" bubble of Angel\'s Wing hit rerolls — a dedicated drop-pod-less alpha.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'azrael') && findByNameSubstr(units, 'deathwing')) {
          return { name: 'Dark Angels: Azrael + Deathwing', explain: 'Azrael grants a 4+ invulnerable bubble to his unit — tucking him into Deathwing Knights turns them into a nearly-unkillable anvil.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if ((findByNameSubstr(units, 'szarekh') || findByNameSubstr(units, 'overlord')) && findByNameSubstr(units, 'warrior')) {
          return { name: 'Necrons: Overlord + Warriors', explain: 'An Overlord joining a Warriors squad adds My Will Be Done for +1 to hit and lets the block advance + shoot — the backbone of a Necron midfield.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if ((findByNameSubstr(units, 'farsight') || findByNameSubstr(units, 'shadowsun')) && (findByNameSubstr(units, 'crisis') || findByNameSubstr(units, 'battlesuit'))) {
          return { name: 'T\'au: Commander + Crisis Suits', explain: 'A named Commander attaches to Crisis Battlesuits for re-rolls to hit and the squad\'s signature Fire Team strategy.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if ((findByNameSubstr(units, 'lelith') || findByNameSubstr(units, 'archon')) && findByNameSubstr(units, 'wych')) {
          return { name: 'Drukhari: Archon/Lelith + Wyches', explain: 'An Archon-class leader attached to Wyches unlocks No Escape and fights-first plays — the squad deletes anything short of a knight.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if (findByNameSubstr(units, 'celestine') && findByNameSubstr(units, 'battle sister')) {
          return { name: 'Adepta Sororitas: Celestine + Battle Sisters', explain: 'Celestine\'s resurrection plus a Battle Sisters squad gives a tanky battleline body with Acts of Faith access.' };
        }
        return null;
      },
    },
    {
      detect(units) {
        if ((findByNameSubstr(units, 'yarrick') || findByNameSubstr(units, 'company commander') || findByNameSubstr(units, 'lord solar')) && (findByNameSubstr(units, 'infantry squad') || findByNameSubstr(units, 'cadian shock'))) {
          return { name: 'Astra Militarum: Commander + Guardsmen', explain: 'An officer leads a Guardsman squad for Orders like Take Aim and Fix Bayonets — chain Orders across the line each turn.' };
        }
        return null;
      },
    },
  ];

  // ──────────────────────────────────────────────────────────────
  // Main compute
  // ──────────────────────────────────────────────────────────────

  function compute(army) {
    const units = getUnits(army);
    const leaderPairings = units.length >= 2 ? detectLeaderPairings(units) : [];

    const keywordCombos = [];
    if (units.length >= 2) {
      for (let i = 0; i < KEYWORD_COMBOS.length; i++) {
        const rule = KEYWORD_COMBOS[i];
        try {
          const hit = rule.match(units, army);
          if (hit) keywordCombos.push({ name: rule.name, explain: rule.explain, details: hit });
        } catch (e) { /* swallow per-rule errors */ }
      }
    }

    const factionSynergies = [];
    if (units.length >= 2) {
      for (let i = 0; i < FACTION_SYNERGIES.length; i++) {
        try {
          const hit = FACTION_SYNERGIES[i].detect(units, army);
          if (hit && hit.name) factionSynergies.push(hit);
        } catch (e) { /* swallow */ }
      }
    }

    const compositionNotes = detectCompositionNotes(units);

    const total = leaderPairings.length + keywordCombos.length + factionSynergies.length;
    return {
      unitCount: units.length,
      leaderPairings,
      keywordCombos,
      factionSynergies,
      compositionNotes,
      total,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────

  function renderLeaderRow(syn) {
    return '<li class="yaab-syn-row">' +
      '<div class="yaab-syn-row-main">' +
        '<div class="yaab-syn-row-title">' + esc(syn.leaderName) + ' <span class="yaab-syn-arrow">&rarr;</span> ' + esc(syn.targetName) + '</div>' +
        '<div class="yaab-syn-row-explain">' + esc(syn.description) + '</div>' +
      '</div>' +
      '<div class="yaab-syn-row-actions">' +
        '<button type="button" class="btn btn-sm btn-outline" data-yaab-syn-goto="leader" data-unit-id="' + esc(syn.leaderUnit.id) + '" data-faction-name="' + esc(syn.leaderUnit._factionName || '') + '">Go to leader</button>' +
      '</div>' +
    '</li>';
  }

  function renderGenericRow(syn) {
    return '<li class="yaab-syn-row">' +
      '<div class="yaab-syn-row-main">' +
        '<div class="yaab-syn-row-title">' + esc(syn.name) + '</div>' +
        '<div class="yaab-syn-row-explain">' + esc(syn.explain) + '</div>' +
      '</div>' +
    '</li>';
  }

  function renderSection(title, iconGlyph, rows) {
    if (!rows || !rows.length) return '';
    return '<section class="yaab-syn-section">' +
      '<div class="yaab-syn-section-head">' +
        '<span class="yaab-syn-section-icon" aria-hidden="true">' + iconGlyph + '</span>' +
        '<span class="yaab-syn-section-title">' + esc(title) + '</span>' +
        '<span class="yaab-syn-section-count">' + rows.length + '</span>' +
      '</div>' +
      '<ul class="yaab-syn-list">' + rows.join('') + '</ul>' +
    '</section>';
  }

  function renderBody(result) {
    if (result.unitCount < 2) {
      return '<div class="yaab-syn-empty">Add more units to see synergies.</div>';
    }
    const parts = [];
    parts.push(renderSection('Leader Pairings', '&#9670;',  result.leaderPairings.map(renderLeaderRow)));
    parts.push(renderSection('Keyword Combos',  '&#9651;',  result.keywordCombos.map(renderGenericRow)));
    parts.push(renderSection('Faction Synergies','&#9734;', result.factionSynergies.map(renderGenericRow)));
    parts.push(renderSection('Composition Notes','&#9888;',  result.compositionNotes.map(renderGenericRow)));
    const html = parts.join('');
    if (!html) {
      return '<div class="yaab-syn-empty">No synergies detected yet. Try adding a leader with its attach-list target, or stack weapon keywords.</div>';
    }
    return html;
  }

  // ──────────────────────────────────────────────────────────────
  // Modal
  // ──────────────────────────────────────────────────────────────

  let isOpen = false;
  let backdropEl = null;

  function ensureStyles() {
    if (document.querySelector('link[data-yaab-synergy]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/synergy.css';
    link.setAttribute('data-yaab-synergy', '1');
    document.head.appendChild(link);
  }

  function ensureModal() {
    if (backdropEl) return backdropEl;
    ensureStyles();
    backdropEl = document.createElement('div');
    backdropEl.className = 'modal-backdrop yaab-syn-backdrop';
    backdropEl.setAttribute('hidden', '');
    backdropEl.innerHTML =
      '<div class="modal yaab-syn-modal" role="dialog" aria-label="Unit synergy detector">' +
        '<div class="modal-header">' +
          '<h3>Synergies</h3>' +
          '<button class="modal-close" type="button" aria-label="Close" data-yaab-syn-close>&times;</button>' +
        '</div>' +
        '<div class="modal-body yaab-syn-body" id="yaab-syn-body"></div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-outline btn-sm" type="button" data-yaab-syn-close>Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdropEl);

    backdropEl.addEventListener('click', function (e) {
      if (e.target === backdropEl) { close(); return; }
      if (e.target.closest && e.target.closest('[data-yaab-syn-close]')) { close(); return; }
      const goto = e.target.closest && e.target.closest('[data-yaab-syn-goto]');
      if (goto) {
        const unitId      = goto.getAttribute('data-unit-id') || '';
        const factionName = goto.getAttribute('data-faction-name') || '';
        openUnitInDetail(unitId, factionName);
      }
    });
    return backdropEl;
  }

  function openUnitInDetail(unitId, factionName) {
    if (!unitId || !App.findUnit) return;
    const unit = App.findUnit(unitId, factionName);
    if (!unit) return;
    const state = App.state;
    if (!state) return;
    state.selectedUnit = unit;
    state.selectedArmyEntryIndex = null;
    const detEnhs = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
    if (window.UI && typeof UI.renderUnitDetail === 'function') {
      UI.renderUnitDetail(unit, detEnhs, []);
    }
    close();
    const grid = document.getElementById('unit-grid');
    if (grid) {
      document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
      try {
        const card = grid.querySelector('.unit-card[data-unit-id="' + (window.CSS && CSS.escape ? CSS.escape(unitId) : unitId) + '"]');
        if (card) {
          card.classList.add('selected');
          try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        }
      } catch (_) {}
    }
  }

  function rerender() {
    if (!isOpen) return;
    const army = (App.state && App.state.currentArmy) || null;
    const result = compute(army);
    const body = document.getElementById('yaab-syn-body');
    if (body) body.innerHTML = renderBody(result);
  }

  function open() {
    ensureModal();
    isOpen = true;
    backdropEl.removeAttribute('hidden');
    rerender();
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (!backdropEl) return;
    isOpen = false;
    backdropEl.setAttribute('hidden', '');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  // ──────────────────────────────────────────────────────────────
  // Badge management
  // ──────────────────────────────────────────────────────────────

  function updateBadge() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const army = (App.state && App.state.currentArmy) || null;
    const result = compute(army);
    const count = result.total;
    if (count > 0) {
      btn.setAttribute('data-count', String(count));
      btn.classList.add('has-synergies');
    } else {
      btn.removeAttribute('data-count');
      btn.classList.remove('has-synergies');
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Hook registrations
  // ──────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: '⟡', // ⟡ — white concave-sided diamond (unicode star-ish)
    ariaLabel: 'Synergy detector',
    title: 'Detected synergies in your army',
    onClick: toggle,
  });

  App.hooks.bootstrap.push(function () {
    updateBadge();
  });

  App.hooks.armyChange.push(function () {
    updateBadge();
    if (isOpen) rerender();
  });

  // Expose for command palette / debugging.
  App.openSynergies      = open;
  App.closeSynergies     = close;
  App.toggleSynergies    = toggle;
  App._computeSynergies  = compute;
})();
