// ui/damage-calc.js — 10e attack simulator: weapon + target -> expected/rolled damage.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  // ──────────────────────────────────────────────────────────────
  // Dice + parsing helpers
  // ──────────────────────────────────────────────────────────────

  function d6() { return 1 + Math.floor(Math.random() * 6); }
  function dN(n) { return 1 + Math.floor(Math.random() * n); }

  // Parse expressions like "3", "D3", "D6", "2D6", "D3+1", "D6-1".
  // Returns { expected: number, roll: () => number, raw: string, ok: bool }.
  function parseDiceExpr(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { expected: 0, roll: () => 0, raw: s, ok: false };
    // Plain integer.
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return { expected: n, roll: () => n, raw: s, ok: true };
    }
    const m = s.match(/^(\d*)\s*[dD](\d+)(?:\s*([+-])\s*(\d+))?$/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      const sign = m[3] === '-' ? -1 : 1;
      const mod = m[4] ? sign * parseInt(m[4], 10) : 0;
      const expected = n * ((sides + 1) / 2) + mod;
      return {
        expected,
        roll: () => {
          let t = mod;
          for (let i = 0; i < n; i++) t += dN(sides);
          return Math.max(0, t);
        },
        raw: s,
        ok: true,
      };
    }
    // Unparseable — degrade: assume 1.
    return { expected: 1, roll: () => 1, raw: s, ok: false };
  }

  // "3+" -> 3; "2+" -> 2; bad input -> null.
  function parseTargetPlus(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^(\d)\s*\+?$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 2 || n > 6) return null;
    return n;
  }

  // Probability that a d6 meets/beats target, clamped 2..6.
  function pHit(t) {
    if (t == null) return 0;
    const tt = Math.max(2, Math.min(6, t));
    return (7 - tt) / 6;
  }
  // Probability of rolling a natural 6 (crit for hits and wounds by default).
  const P_CRIT = 1 / 6;

  // 10e wound chart: S vs T.
  function woundTarget(S, T) {
    if (!isFinite(S) || !isFinite(T) || S <= 0 || T <= 0) return null;
    if (S >= 2 * T) return 2;
    if (S > T)      return 3;
    if (S === T)    return 4;
    if (S * 2 <= T) return 6;
    return 5;
  }

  // Strength parsing: plain int or dice -> rounded expected.
  function parseStrength(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const d = parseDiceExpr(s);
    return d.ok ? Math.round(d.expected) : 0;
  }

  // Parse AP: "-1" / "0" / "-2" -> number (positive int, we store as positive AP magnitude).
  function parseAP(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || s === '-' || s === '0') return 0;
    const m = s.match(/-?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // ──────────────────────────────────────────────────────────────
  // Keyword parsing
  // ──────────────────────────────────────────────────────────────

  function splitKeywords(raw) {
    return String(raw == null ? '' : raw)
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
  }

  function analyzeKeywords(kws) {
    const out = {
      torrent: false,
      twinLinked: false,
      lethalHits: false,
      devWounds: false,
      sustainedHits: 0,
      antiT: null,       // target wound on crits if Anti-<anything> present
      antiLabel: '',
      rapidFire: 0,
      melta: 0,
      assault: false,
      heavy: false,
      precision: false,
      blast: false,
      ignoresCover: false,
      raw: kws.slice(),
    };
    for (const kw of kws) {
      const low = kw.toLowerCase();
      if (/^torrent$/.test(low)) out.torrent = true;
      else if (/^twin[-\s]?linked$/.test(low)) out.twinLinked = true;
      else if (/^lethal\s+hits$/.test(low)) out.lethalHits = true;
      else if (/^devastating\s+wounds$/.test(low)) out.devWounds = true;
      else if (/^sustained\s+hits\s+(\d+|d\d+)$/i.test(low)) {
        const m = low.match(/^sustained\s+hits\s+(\d+|d\d+)$/i);
        // For simplicity, D3 -> 2 expected, D6 -> 3.5.
        if (m) {
          if (/^\d+$/.test(m[1])) out.sustainedHits = parseInt(m[1], 10);
          else out.sustainedHits = parseDiceExpr(m[1]).expected;
        }
      }
      else if (/^anti-/i.test(kw)) {
        const m = kw.match(/^anti-([^\s]+)\s+(\d)\+?$/i);
        if (m) {
          out.antiT = parseInt(m[2], 10);
          out.antiLabel = m[1];
        } else {
          // No parsed threshold — treat as 4+ default on the named keyword.
          const m2 = kw.match(/^anti-([^\s]+)/i);
          if (m2) { out.antiT = 4; out.antiLabel = m2[1]; }
        }
      }
      else if (/^rapid\s+fire\s+(\d+|d\d+)$/i.test(low)) {
        const m = low.match(/^rapid\s+fire\s+(\d+|d\d+)$/i);
        if (m) {
          if (/^\d+$/.test(m[1])) out.rapidFire = parseInt(m[1], 10);
          else out.rapidFire = Math.round(parseDiceExpr(m[1]).expected);
        }
      }
      else if (/^melta\s+(\d+)$/i.test(low)) {
        const m = low.match(/^melta\s+(\d+)$/i);
        if (m) out.melta = parseInt(m[1], 10);
      }
      else if (/^assault$/.test(low)) out.assault = true;
      else if (/^heavy$/.test(low)) out.heavy = true;
      else if (/^precision$/.test(low)) out.precision = true;
      else if (/^blast$/.test(low)) out.blast = true;
      else if (/^ignores\s+cover$/.test(low)) out.ignoresCover = true;
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────
  // Expected-value math
  // ──────────────────────────────────────────────────────────────

  // Calculates expected damage analytically from probabilities.
  function computeExpected(input) {
    const {
      attacks, hitTarget, S, T, ap, damageExpected,
      saveRaw, invRaw, wounds, spillover, kws,
    } = input;

    const baseHit = pHit(hitTarget);
    const pHitCrit = kws.torrent ? 1 : (hitTarget == null ? 0 : P_CRIT);
    // Effective hit chance (normal + crit). Torrent auto-hits.
    const pEffHit = kws.torrent ? 1 : baseHit;
    // Crits (natural 6) are a subset of hits.
    const pHitCritOfAll = kws.torrent ? 0 : Math.min(pEffHit, P_CRIT);

    // Sustained Hits X: each crit hit adds X extra hits (no further crit checks).
    const sustainedExtra = kws.sustainedHits ? pHitCritOfAll * kws.sustainedHits : 0;

    // Expected non-crit hits (for wounding) and expected crit hits.
    const expHits = attacks * (pEffHit + sustainedExtra);
    const expCritHits = attacks * pHitCritOfAll;
    const expNormalHits = Math.max(0, expHits - expCritHits);

    // Lethal Hits: crit hits auto-wound (bypass the wound roll).
    // Wound roll applies to (normal hits + sustained-extra hits).
    const expWoundRolls = kws.lethalHits
      ? (expNormalHits + attacks * sustainedExtra)
      : (expHits);

    const wTarget = woundTarget(S, T);
    const pWoundNormal = pHit(wTarget); // reuse same math
    // Anti-X Y+: on crit wound rolls, target clamps to Y+ (doesn't change normal target).
    // Note: crits always wound on a 6. But with Anti-, the *critical* threshold
    // effectively lowers: a roll >= antiT counts as a crit. We model this by saying:
    // p_critWound = chance to roll >= antiT; p_normalWound = chance to roll >= wTarget (and not crit).
    let pCritWound = P_CRIT;
    if (kws.antiT != null) {
      const antiThresh = Math.max(2, Math.min(6, kws.antiT));
      pCritWound = (7 - antiThresh) / 6;
    }
    // p_any_wound on a regular wound roll:
    const pAnyWound = wTarget == null ? 0 : pWoundNormal;
    // Ensure crit prob doesn't exceed any-wound prob.
    const pCritEff = Math.min(pCritWound, Math.max(pAnyWound, P_CRIT));
    const pNormalWound = Math.max(0, pAnyWound - pCritEff);

    // Twin-linked: re-roll failed wounds.
    let pTotalWound = pAnyWound;
    if (kws.twinLinked) {
      pTotalWound = pAnyWound + (1 - pAnyWound) * pAnyWound;
    }
    // Split crit vs normal proportionally after re-rolls.
    let pWoundCritShare = pCritEff;
    let pWoundNormalShare = Math.max(0, pTotalWound - pWoundCritShare);

    const expCritWounds = expWoundRolls * pWoundCritShare;
    const expNormalWounds = expWoundRolls * pWoundNormalShare;
    // Lethal Hits: crit hits auto-wound — add them to "normal wounds" bucket
    // (Dev Wounds only triggers on a wound-roll 6, so lethal-hit auto-wounds are *not* crit wounds).
    const expLethalAutoWounds = kws.lethalHits ? expCritHits : 0;

    // Save. Inv ignores AP; use the better (lower number) of modified save or inv.
    const sv = parseTargetPlus(saveRaw);
    const inv = parseTargetPlus(invRaw);
    const modSv = sv == null ? null : Math.max(2, sv + ap);
    const effSave = (modSv != null && inv != null) ? Math.min(modSv, inv) :
                    (modSv != null ? modSv : inv);
    const pSavePass = effSave == null ? 0 : pHit(effSave);
    const pSaveFail = 1 - pSavePass;
    // Invulnerable alone (no armour given): pSaveFail uses inv only.

    // Devastating wounds: crit wounds become mortal wounds (bypass saves).
    const expDevMortalWounds = kws.devWounds ? expCritWounds : 0;
    const expCritWoundsForSave = kws.devWounds ? 0 : expCritWounds;

    // Wounds that must be saved:
    const expWoundsToSave = expNormalWounds + expLethalAutoWounds + expCritWoundsForSave;
    const expUnsaved = expWoundsToSave * pSaveFail;

    // Damage: mortal wounds apply with their damage value (usually 1 per; we use weapon D).
    // 10e: mortal wounds from Dev Wounds deal the weapon's damage.
    const damagePerWound = damageExpected;
    const rawExpectedDamage = (expUnsaved + expDevMortalWounds) * damagePerWound;

    // Spillover: if spillover off, each "unsaved wound" caps at target wounds.
    let finalExpectedDamage = rawExpectedDamage;
    if (!spillover && wounds > 0 && damagePerWound > wounds) {
      // Cap damage-per-failed-save at target W.
      const cappedDmg = Math.min(damagePerWound, wounds);
      finalExpectedDamage = (expUnsaved + expDevMortalWounds) * cappedDmg;
    }

    return {
      hitTarget,
      woundTarget: wTarget,
      effSave,
      modSv,
      inv,
      expHits,
      expWoundRolls,
      expCritWounds,
      expNormalWounds,
      expLethalAutoWounds,
      expUnsaved,
      expDevMortalWounds,
      expDamage: finalExpectedDamage,
      rawExpectedDamage,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Simulation (single roll)
  // ──────────────────────────────────────────────────────────────

  function simulateOnce(input, log) {
    const {
      attacks, hitTarget, S, T, ap, damageRoll,
      saveRaw, invRaw, wounds, spillover, kws,
    } = input;

    const sv = parseTargetPlus(saveRaw);
    const inv = parseTargetPlus(invRaw);
    const modSv = sv == null ? null : Math.max(2, sv + ap);
    const effSave = (modSv != null && inv != null) ? Math.min(modSv, inv) :
                    (modSv != null ? modSv : inv);
    const wT = woundTarget(S, T);
    const antiT = kws.antiT != null ? Math.max(2, Math.min(6, kws.antiT)) : null;

    // Stage 1: hit rolls. Torrent auto-hits every attack (no roll, no crits).
    let normalHits = 0;
    let critHits = 0;
    const hitRolls = [];
    if (kws.torrent) {
      normalHits = attacks;
    } else {
      for (let i = 0; i < attacks; i++) {
        if (hitTarget == null) { hitRolls.push('?'); continue; }
        const r = d6();
        hitRolls.push(r);
        if (r >= hitTarget) {
          if (r === 6) critHits++; else normalHits++;
        }
      }
    }
    // Sustained Hits: each crit hit -> +X extra normal hits (rolled for D-dice).
    let sustainExtra = 0;
    if (kws.sustainedHits && critHits > 0) {
      const val = kws.sustainedHits;
      // val may be a float if parsed from D3 — simulate as dice per crit.
      for (let i = 0; i < critHits; i++) {
        if (Number.isInteger(val)) sustainExtra += val;
        else sustainExtra += (val <= 2 ? dN(3) : dN(6));
      }
    }

    // Stage 2: wound rolls.
    let autoWounds = 0; // from Lethal Hits
    if (kws.lethalHits) {
      autoWounds = critHits;
      critHits = 0;
    }
    const woundPoolHits = normalHits + critHits + sustainExtra;
    let normalWounds = 0, critWounds = 0;
    const woundRolls = [];
    for (let i = 0; i < woundPoolHits; i++) {
      if (wT == null) { woundRolls.push('?'); continue; }
      let r = d6();
      // Twin-linked re-roll failed wounds.
      if (kws.twinLinked && r < wT && (antiT == null || r < antiT)) {
        r = d6();
      }
      woundRolls.push(r);
      const isCrit = antiT != null ? r >= antiT : r === 6;
      if (isCrit) critWounds++;
      else if (r >= wT) normalWounds++;
    }

    // Stage 3: saves. Dev Wounds: crit wounds -> mortal (bypass saves).
    let devMortals = 0;
    if (kws.devWounds) {
      devMortals = critWounds;
      critWounds = 0;
    }
    const toSave = normalWounds + critWounds + autoWounds;
    let unsaved = 0;
    const saveRolls = [];
    for (let i = 0; i < toSave; i++) {
      if (effSave == null) { saveRolls.push('?'); unsaved++; continue; }
      const r = d6();
      saveRolls.push(r);
      if (r < effSave) unsaved++;
    }

    // Stage 4: damage (per failed save + per mortal). Mortals deal weapon damage per 10e Dev Wounds.
    let totalDmg = 0;
    const dmgRolls = [];
    const totalWoundsThatDoDmg = unsaved + devMortals;
    for (let i = 0; i < totalWoundsThatDoDmg; i++) {
      let d = damageRoll();
      if (!spillover && wounds > 0) d = Math.min(d, wounds);
      dmgRolls.push(d);
      totalDmg += d;
    }

    if (log) {
      log.hitRolls = hitRolls;
      log.woundRolls = woundRolls;
      log.saveRolls = saveRolls;
      log.dmgRolls = dmgRolls;
      log.normalHits = normalHits;
      log.critHits = critHits;
      log.sustainExtra = sustainExtra;
      log.autoWounds = autoWounds;
      log.normalWounds = normalWounds;
      log.critWounds = critWounds;
      log.devMortals = devMortals;
      log.unsaved = unsaved;
    }

    return totalDmg;
  }

  function simulateMany(input, n) {
    const results = new Array(n);
    for (let i = 0; i < n; i++) results[i] = simulateOnce(input, null);
    results.sort((a, b) => a - b);
    const sum = results.reduce((s, v) => s + v, 0);
    return {
      min: results[0],
      max: results[n - 1],
      avg: sum / n,
      median: results[Math.floor(n / 2)],
      results,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Model/unit helpers
  // ──────────────────────────────────────────────────────────────

  function totalModelsForEntry(entry) {
    const count = entry.count || 1;
    const unit = entry.unitData || {};
    const opts = unit.squadOptions || [];
    let modelsPerSquad = 1;
    if (opts.length) {
      let chosen = opts.find(o => o.pts === entry.selectedPts);
      if (!chosen) chosen = opts[0];
      if (chosen && chosen.models) modelsPerSquad = chosen.models;
    } else if (unit.type === 'unit') {
      modelsPerSquad = 1;
    }
    return count * modelsPerSquad;
  }

  // Try to extract a BS/WS from a weapon. Fields vary: "BS", "WS", "Skill".
  function weaponSkill(weapon) {
    const keys = ['BS', 'WS', 'Skill', 'BS/WS'];
    for (const k of keys) {
      if (weapon[k] != null && weapon[k] !== '') return weapon[k];
    }
    // Fallback: typeName hints.
    return '';
  }

  // Collect selectable weapons from army entries, or fall back to all units.
  function collectWeaponChoices() {
    const out = [];
    const army = App.state && App.state.currentArmy;
    const entries = (army && army.entries) || [];
    if (entries.length) {
      entries.forEach((entry, ei) => {
        const unit = entry.unitData || {};
        const weapons = unit.weapons || [];
        const totalModels = totalModelsForEntry(entry);
        weapons.forEach((w, wi) => {
          out.push({
            source: 'army',
            key: 'e' + ei + 'w' + wi,
            unitName: entry.unitName || unit.name || '—',
            totalModels,
            weapon: w,
            entry,
          });
        });
      });
      return out;
    }
    // Fallback: all loaded units.
    const all = (App.state && App.state.allUnits) || [];
    all.forEach((unit, ui) => {
      const weapons = unit.weapons || [];
      weapons.forEach((w, wi) => {
        out.push({
          source: 'all',
          key: 'u' + ui + 'w' + wi,
          unitName: unit.name || '—',
          totalModels: 1,
          weapon: w,
          entry: null,
        });
      });
    });
    return out;
  }

  function collectTargetProfiles() {
    // Try opponent army first.
    const opp = App.state && App.state.opponentArmy;
    if (opp && opp.entries && opp.entries.length) {
      return opp.entries.map((e, i) => {
        const u = e.unitData || {};
        return {
          key: 'opp' + i,
          label: (e.unitName || u.name || '—') + ' (opponent)',
          unit: u,
        };
      });
    }
    return [];
  }

  // ──────────────────────────────────────────────────────────────
  // Presets
  // ──────────────────────────────────────────────────────────────

  const PRESETS = [
    { name: 'Marine',       T: 4,  sv: '3', inv: '',  W: 2  },
    { name: 'Guardsman',    T: 3,  sv: '5', inv: '',  W: 1  },
    { name: 'Primaris Char',T: 4,  sv: '3', inv: '4', W: 5  },
    { name: 'Terminator',   T: 5,  sv: '2', inv: '4', W: 3  },
    { name: 'Vehicle',      T: 10, sv: '3', inv: '',  W: 11 },
    { name: 'Knight',       T: 12, sv: '3', inv: '5', W: 22 },
  ];

  // ──────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n, p = 2) {
    if (!isFinite(n)) return '—';
    const r = Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
    return String(r);
  }

  let state = null;   // { choices, selectedKey, targetPresetIdx, target, kwAnalysis, lastSim, lastDist }
  let backdropEl = null;
  let isOpen = false;

  function ensureStylesheet() {
    if (document.querySelector('link[data-yaab-dmgcalc]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/damage-calc.css';
    link.setAttribute('data-yaab-dmgcalc', '1');
    document.head.appendChild(link);
  }

  function ensureModal() {
    if (backdropEl) return backdropEl;
    ensureStylesheet();
    backdropEl = document.createElement('div');
    backdropEl.className = 'modal-backdrop yaab-dc-backdrop';
    backdropEl.setAttribute('hidden', '');
    backdropEl.innerHTML = `
      <div class="modal yaab-dc-modal" role="dialog" aria-label="Damage calculator">
        <div class="modal-header">
          <h3>Damage Calculator</h3>
          <button class="modal-close" type="button" aria-label="Close" data-yaab-dc-close>&times;</button>
        </div>
        <div class="modal-body yaab-dc-body" id="yaab-dc-body"></div>
      </div>`;
    document.body.appendChild(backdropEl);
    backdropEl.addEventListener('click', e => {
      if (e.target === backdropEl) close();
      if (e.target.closest('[data-yaab-dc-close]')) close();
    });
    return backdropEl;
  }

  function renderBody() {
    const body = document.getElementById('yaab-dc-body');
    if (!body) return;
    const choices = state.choices;
    // Group by unit name for the dropdown.
    const groups = {};
    choices.forEach(c => {
      (groups[c.unitName] = groups[c.unitName] || []).push(c);
    });
    const groupNames = Object.keys(groups);
    const optionsHtml = choices.length
      ? groupNames.map(g => {
          const opts = groups[g].map(c =>
            `<option value="${esc(c.key)}"${c.key === state.selectedKey ? ' selected' : ''}>${esc(g)} — ${esc(c.weapon.name || 'Weapon')}</option>`
          ).join('');
          return `<optgroup label="${esc(g)}">${opts}</optgroup>`;
        }).join('')
      : '<option value="">(no weapons — load an army or units first)</option>';

    const selected = choices.find(c => c.key === state.selectedKey);
    const w = selected ? selected.weapon : null;
    const atk = state.attacker;

    const presetBtns = PRESETS.map((p, i) =>
      `<button class="yaab-dc-preset${i === state.targetPresetIdx ? ' active' : ''}" data-preset="${i}" type="button">${esc(p.name)}</button>`
    ).join('');

    const oppList = collectTargetProfiles();
    const oppHtml = oppList.length
      ? `<div class="yaab-dc-row yaab-dc-opp-row">
          <label class="yaab-dc-lbl">Opponent unit</label>
          <select id="yaab-dc-opp">
            <option value="">—</option>
            ${oppList.map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}
          </select>
        </div>`
      : '';

    body.innerHTML = `
      <section class="yaab-dc-section">
        <div class="yaab-dc-sec-title">Attacker</div>
        <div class="yaab-dc-row">
          <label class="yaab-dc-lbl">Weapon</label>
          <select id="yaab-dc-weapon">${optionsHtml}</select>
        </div>
        <div class="yaab-dc-grid5">
          <div><label>Attacks</label><input id="yaab-dc-a" type="text" value="${esc(atk.attacks)}"></div>
          <div><label>Hit (BS/WS)</label><input id="yaab-dc-h" type="text" value="${esc(atk.hit)}"></div>
          <div><label>S</label><input id="yaab-dc-s" type="text" value="${esc(atk.S)}"></div>
          <div><label>AP</label><input id="yaab-dc-ap" type="text" value="${esc(atk.ap)}"></div>
          <div><label>D</label><input id="yaab-dc-d" type="text" value="${esc(atk.damage)}"></div>
        </div>
        <div class="yaab-dc-row">
          <label class="yaab-dc-lbl">Keywords</label>
          <input id="yaab-dc-kw" type="text" value="${esc(atk.kwRaw)}" placeholder="e.g. Lethal Hits, Sustained Hits 1, Anti-Vehicle 4+">
        </div>
        <div class="yaab-dc-row yaab-dc-mult-row">
          <label class="yaab-dc-checkbox">
            <input type="checkbox" id="yaab-dc-multmodels"${atk.multByModels ? ' checked' : ''}>
            Multiply A × ${atk.totalModels || 1} models
          </label>
          <span class="yaab-dc-effatk">effective attacks: <b id="yaab-dc-effatk">${esc(effectiveAttacksLabel())}</b></span>
        </div>
      </section>

      <section class="yaab-dc-section">
        <div class="yaab-dc-sec-title">Target</div>
        <div class="yaab-dc-presets">${presetBtns}</div>
        ${oppHtml}
        <div class="yaab-dc-grid4">
          <div><label>T</label><input id="yaab-dc-t" type="number" min="1" value="${esc(state.target.T)}"></div>
          <div><label>Sv</label><input id="yaab-dc-sv" type="text" value="${esc(state.target.sv)}" placeholder="3"></div>
          <div><label>Inv</label><input id="yaab-dc-inv" type="text" value="${esc(state.target.inv)}" placeholder="—"></div>
          <div><label>W</label><input id="yaab-dc-w" type="number" min="1" value="${esc(state.target.W)}"></div>
        </div>
        <div class="yaab-dc-row">
          <label class="yaab-dc-checkbox">
            <input type="checkbox" id="yaab-dc-spill"${state.target.spillover ? ' checked' : ''}>
            Spill damage across models (squad target)
          </label>
        </div>
      </section>

      <section class="yaab-dc-section yaab-dc-results">
        <div class="yaab-dc-sec-title">Results</div>
        <div class="yaab-dc-actions">
          <button class="btn btn-accent yaab-dc-go" id="yaab-dc-roll" type="button">Roll / Simulate</button>
          <button class="btn btn-outline" id="yaab-dc-sim100" type="button">Simulate 100x</button>
          <button class="btn btn-outline" id="yaab-dc-copy" type="button">Copy as text</button>
        </div>
        <div id="yaab-dc-out" class="yaab-dc-out"></div>
      </section>
    `;
    wireBody();
  }

  function effectiveAttacksLabel() {
    const a = state.attacker;
    const base = parseDiceExpr(a.attacks);
    const mult = a.multByModels ? (a.totalModels || 1) : 1;
    return base.ok
      ? `${fmt(base.expected * mult, 2)} avg (${a.attacks}${mult > 1 ? ' × ' + mult : ''})`
      : '?';
  }

  function wireBody() {
    const $ = id => document.getElementById(id);

    const weaponSel = $('yaab-dc-weapon');
    if (weaponSel) weaponSel.addEventListener('change', e => {
      state.selectedKey = e.target.value;
      autoFillFromSelection();
      renderBody();
    });

    // Fields — live update (no re-render; just update model).
    const bind = (id, key, opts) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        state.attacker[key] = el.value;
        updateEffectiveLabel();
      });
    };
    bind('yaab-dc-a',  'attacks');
    bind('yaab-dc-h',  'hit');
    bind('yaab-dc-s',  'S');
    bind('yaab-dc-ap', 'ap');
    bind('yaab-dc-d',  'damage');
    bind('yaab-dc-kw', 'kwRaw');

    const multCb = $('yaab-dc-multmodels');
    if (multCb) multCb.addEventListener('change', () => {
      state.attacker.multByModels = multCb.checked;
      updateEffectiveLabel();
    });

    ['yaab-dc-t', 'yaab-dc-sv', 'yaab-dc-inv', 'yaab-dc-w'].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener('input', () => {
        const map = { 'yaab-dc-t': 'T', 'yaab-dc-sv': 'sv', 'yaab-dc-inv': 'inv', 'yaab-dc-w': 'W' };
        state.target[map[id]] = el.value;
        state.targetPresetIdx = -1;
        document.querySelectorAll('.yaab-dc-preset').forEach(b => b.classList.remove('active'));
      });
    });

    const spill = $('yaab-dc-spill');
    if (spill) spill.addEventListener('change', () => { state.target.spillover = spill.checked; });

    document.querySelectorAll('.yaab-dc-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.preset, 10);
        const p = PRESETS[i];
        if (!p) return;
        state.target.T = p.T; state.target.sv = p.sv; state.target.inv = p.inv; state.target.W = p.W;
        state.targetPresetIdx = i;
        renderBody();
      });
    });

    const opp = $('yaab-dc-opp');
    if (opp) opp.addEventListener('change', () => {
      const list = collectTargetProfiles();
      const pick = list.find(o => o.key === opp.value);
      if (!pick) return;
      const u = pick.unit || {};
      const s = u.stats || {};
      state.target.T = parseInt(String(s.T || s.t || '4').replace(/[^\d]/g, ''), 10) || 4;
      state.target.sv = String(s.SV || s.Sv || s.sv || '3').replace(/[^\d]/g, '') || '3';
      state.target.inv = u.invulnSave ? String(u.invulnSave).replace(/[^\d]/g, '') : '';
      state.target.W = parseInt(String(s.W || s.w || '1').replace(/[^\d]/g, ''), 10) || 1;
      renderBody();
    });

    const rollBtn = $('yaab-dc-roll');
    if (rollBtn) rollBtn.addEventListener('click', doRoll);
    const sim100 = $('yaab-dc-sim100');
    if (sim100) sim100.addEventListener('click', doSim100);
    const copyBtn = $('yaab-dc-copy');
    if (copyBtn) copyBtn.addEventListener('click', doCopy);
  }

  function updateEffectiveLabel() {
    const el = document.getElementById('yaab-dc-effatk');
    if (el) el.textContent = effectiveAttacksLabel();
  }

  function autoFillFromSelection() {
    const c = state.choices.find(ch => ch.key === state.selectedKey);
    if (!c) return;
    const w = c.weapon || {};
    state.attacker.attacks = String(w.A || '1');
    state.attacker.hit = String(weaponSkill(w) || '4+');
    state.attacker.S = String(w.S || '4');
    state.attacker.ap = String(w.AP || '0');
    state.attacker.damage = String(w.D || w.Damage || '1');
    state.attacker.kwRaw = String(w.Keywords || '');
    state.attacker.multByModels = c.totalModels > 1;
    state.attacker.totalModels = c.totalModels || 1;
  }

  // ──────────────────────────────────────────────────────────────
  // Roll / Simulate actions
  // ──────────────────────────────────────────────────────────────

  function buildInput() {
    const a = state.attacker;
    const t = state.target;
    const baseA = parseDiceExpr(a.attacks);
    const mult = a.multByModels ? (a.totalModels || 1) : 1;
    const attacksExpected = Math.max(0, Math.round(baseA.expected * mult));
    const hitTarget = parseTargetPlus(a.hit);
    const S = parseStrength(a.S);
    const T = parseInt(String(t.T).replace(/[^\d]/g, ''), 10) || 0;
    const ap = parseAP(a.ap);
    const dmgExpr = parseDiceExpr(a.damage);
    const kws = analyzeKeywords(splitKeywords(a.kwRaw));

    // For simulate: attacks count rolls one dice expression instance per attack
    // only if attacks is itself dice. Per 10e: "Attacks: D6" means you roll D6
    // once to get the attack count for the weapon. We'll roll attacks fresh each time.
    // For expected, we use attacksExpected. For simulate, roll each time.
    return {
      attacks: attacksExpected,
      rollAttacks: () => {
        const v = baseA.roll();
        return Math.max(0, Math.round(v * mult));
      },
      hitTarget,
      S, T, ap,
      damageExpected: dmgExpr.expected,
      damageRoll: dmgExpr.roll,
      saveRaw: t.sv,
      invRaw: t.inv,
      wounds: parseInt(String(t.W).replace(/[^\d]/g, ''), 10) || 0,
      spillover: !!t.spillover,
      kws,
    };
  }

  function doRoll() {
    const inp = buildInput();
    const exp = computeExpected(inp);
    // Simulate once: roll attacks fresh.
    const log = {};
    const simInput = Object.assign({}, inp, { attacks: inp.rollAttacks() });
    const rolledDmg = simulateOnce(simInput, log);
    state.lastSim = { inp, exp, log, rolledDmg, simAttacks: simInput.attacks };
    state.lastDist = null;
    renderOutput();
  }

  function doSim100() {
    const inp = buildInput();
    const exp = computeExpected(inp);
    // Distribution uses expected attacks for each trial (close enough).
    const n = 100;
    const results = new Array(n);
    for (let i = 0; i < n; i++) {
      const simInput = Object.assign({}, inp, { attacks: inp.rollAttacks() });
      results[i] = simulateOnce(simInput, null);
    }
    results.sort((a, b) => a - b);
    const sum = results.reduce((s, v) => s + v, 0);
    state.lastDist = {
      min: results[0], max: results[n - 1],
      avg: sum / n, median: results[Math.floor(n / 2)],
      results, n,
    };
    state.lastSim = { inp, exp, log: null, rolledDmg: null, simAttacks: null };
    renderOutput();
  }

  function renderOutput() {
    const out = document.getElementById('yaab-dc-out');
    if (!out) return;
    const s = state.lastSim;
    if (!s) { out.innerHTML = ''; return; }
    const { inp, exp, log, rolledDmg, simAttacks } = s;

    const kwBadges = kwBadgesHtml(inp.kws);
    const expHtml = `
      <div class="yaab-dc-expected">
        <div class="yaab-dc-expected-big">${fmt(exp.expDamage, 2)}</div>
        <div class="yaab-dc-expected-lbl">expected damage</div>
        <div class="yaab-dc-stages">
          <div><b>${fmt(exp.expHits, 2)}</b> hits</div>
          <div><b>${fmt(exp.expCritWounds + exp.expNormalWounds + exp.expLethalAutoWounds + exp.expDevMortalWounds, 2)}</b> wounds</div>
          <div><b>${fmt(exp.expUnsaved + exp.expDevMortalWounds, 2)}</b> unsaved + mortals</div>
        </div>
        <div class="yaab-dc-targets">
          Hit ${exp.hitTarget != null ? exp.hitTarget + '+' : '?'} · Wound ${exp.woundTarget != null ? exp.woundTarget + '+' : '?'} · Save ${exp.effSave != null ? exp.effSave + '+' : '—'}
        </div>
        ${kwBadges ? `<div class="yaab-dc-kwbadges">${kwBadges}</div>` : ''}
      </div>`;

    let rolledHtml = '';
    if (rolledDmg != null && log) {
      rolledHtml = `
        <div class="yaab-dc-rolled">
          <div class="yaab-dc-rolled-big">${rolledDmg}</div>
          <div class="yaab-dc-rolled-lbl">rolled damage (${simAttacks} attacks)</div>
          <details class="yaab-dc-details">
            <summary>per-roll breakdown</summary>
            <div class="yaab-dc-brk">
              <div><span>Hit rolls:</span> ${log.hitRolls.join(', ') || '—'}</div>
              <div><span>Hits:</span> ${log.normalHits} normal + ${log.critHits} crit${log.sustainExtra ? ' + ' + log.sustainExtra + ' sustained' : ''}${log.autoWounds ? ' → ' + log.autoWounds + ' auto-wound (Lethal)' : ''}</div>
              <div><span>Wound rolls:</span> ${log.woundRolls.join(', ') || '—'}</div>
              <div><span>Wounds:</span> ${log.normalWounds} normal + ${log.critWounds} crit${log.devMortals ? ' + ' + log.devMortals + ' mortal (Dev)' : ''}</div>
              <div><span>Save rolls:</span> ${log.saveRolls.join(', ') || '—'}</div>
              <div><span>Unsaved:</span> ${log.unsaved}</div>
              <div><span>Damage dice:</span> ${log.dmgRolls.join(', ') || '—'}</div>
            </div>
          </details>
        </div>`;
    }

    let distHtml = '';
    if (state.lastDist) {
      const d = state.lastDist;
      // Build a histogram: bucket by integer damage.
      const buckets = {};
      d.results.forEach(v => { buckets[v] = (buckets[v] || 0) + 1; });
      const keys = Object.keys(buckets).map(k => parseInt(k, 10)).sort((a, b) => a - b);
      const maxCt = Math.max(...keys.map(k => buckets[k]));
      const bars = keys.map(k => {
        const h = (buckets[k] / maxCt) * 100;
        return `<div class="yaab-dc-hist-col" title="${k} dmg: ${buckets[k]} trials">
          <div class="yaab-dc-hist-bar" style="height:${h}%"></div>
          <div class="yaab-dc-hist-lbl">${k}</div>
        </div>`;
      }).join('');
      distHtml = `
        <div class="yaab-dc-dist">
          <div class="yaab-dc-dist-stats">
            <span>min <b>${d.min}</b></span>
            <span>median <b>${d.median}</b></span>
            <span>avg <b>${fmt(d.avg, 2)}</b></span>
            <span>max <b>${d.max}</b></span>
            <span class="yaab-dc-n">(n=${d.n})</span>
          </div>
          <div class="yaab-dc-hist">${bars}</div>
        </div>`;
    }

    out.innerHTML = `<div class="yaab-dc-out-grid">${expHtml}${rolledHtml}</div>${distHtml}`;
  }

  function kwBadgesHtml(kws) {
    const bits = [];
    if (kws.torrent) bits.push('Torrent');
    if (kws.twinLinked) bits.push('Twin-linked');
    if (kws.lethalHits) bits.push('Lethal Hits');
    if (kws.devWounds) bits.push('Devastating Wounds');
    if (kws.sustainedHits) bits.push('Sustained Hits ' + kws.sustainedHits);
    if (kws.antiT != null) bits.push('Anti-' + (kws.antiLabel || '?') + ' ' + kws.antiT + '+');
    if (kws.melta) bits.push('Melta ' + kws.melta);
    return bits.map(b => `<span class="yaab-dc-kwb">${esc(b)}</span>`).join('');
  }

  function doCopy() {
    const s = state.lastSim;
    if (!s) { if (UI.toast) UI.toast('Run a roll first.', 'info'); return; }
    const { inp, exp, log, rolledDmg, simAttacks } = s;
    const a = state.attacker;
    const t = state.target;
    const lines = [];
    lines.push('Damage Calculator');
    lines.push('Weapon: A=' + a.attacks + ', Hit=' + a.hit + ', S=' + a.S + ', AP=' + a.ap + ', D=' + a.damage);
    if (a.kwRaw) lines.push('Keywords: ' + a.kwRaw);
    if (a.multByModels) lines.push('Attacks × ' + (a.totalModels || 1) + ' models = ' + inp.attacks);
    lines.push('Target: T' + t.T + ' Sv' + (t.sv ? t.sv + '+' : '-') + (t.inv ? ' Inv' + t.inv + '+' : '') + ' W' + t.W);
    lines.push('Hit ' + (exp.hitTarget != null ? exp.hitTarget + '+' : '?') + ', Wound ' + (exp.woundTarget != null ? exp.woundTarget + '+' : '?') + ', Save ' + (exp.effSave != null ? exp.effSave + '+' : '-'));
    lines.push('Expected: ' + fmt(exp.expDamage, 2) + ' damage (hits ' + fmt(exp.expHits, 2) + ', unsaved+mortals ' + fmt(exp.expUnsaved + exp.expDevMortalWounds, 2) + ')');
    if (rolledDmg != null) lines.push('Rolled: ' + rolledDmg + ' damage (' + simAttacks + ' attacks)');
    if (state.lastDist) {
      const d = state.lastDist;
      lines.push('100-trial: min ' + d.min + ', median ' + d.median + ', avg ' + fmt(d.avg, 2) + ', max ' + d.max);
    }
    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { if (UI.toast) UI.toast('Copied.', 'success'); },
        () => { if (UI.toast) UI.toast('Copy failed.', 'error'); }
      );
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); if (UI.toast) UI.toast('Copied.', 'success'); }
      catch (e) { if (UI.toast) UI.toast('Copy failed.', 'error'); }
      document.body.removeChild(ta);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Open / close
  // ──────────────────────────────────────────────────────────────

  function freshState() {
    const choices = collectWeaponChoices();
    return {
      choices,
      selectedKey: choices.length ? choices[0].key : '',
      targetPresetIdx: 0,
      target: { T: PRESETS[0].T, sv: PRESETS[0].sv, inv: PRESETS[0].inv, W: PRESETS[0].W, spillover: false },
      attacker: {
        attacks: '1', hit: '4+', S: '4', ap: '0', damage: '1',
        kwRaw: '', multByModels: false, totalModels: 1,
      },
      lastSim: null,
      lastDist: null,
    };
  }

  function open(opts) {
    ensureModal();
    if (!state) state = freshState();
    else {
      // Refresh weapon list in case army changed.
      state.choices = collectWeaponChoices();
      if (!state.choices.find(c => c.key === state.selectedKey)) {
        state.selectedKey = state.choices.length ? state.choices[0].key : '';
      }
    }
    if (opts && opts.preselectKey) state.selectedKey = opts.preselectKey;
    autoFillFromSelection();
    isOpen = true;
    backdropEl.removeAttribute('hidden');
    renderBody();
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
    else if ((e.key === 'Enter') && isOpen && e.target && e.target.tagName !== 'TEXTAREA') {
      // Avoid hijacking dropdown/input navigation; only fire if target isn't a select/input w/ composition.
      const tag = e.target.tagName;
      if (tag === 'SELECT' || tag === 'INPUT') return;
      doRoll();
    }
  }

  // Open pre-selected from a unit's detail panel: pick its first weapon.
  function openFromUnit(unit) {
    if (!unit) { open(); return; }
    const choices = collectWeaponChoices();
    // Prefer army-entry weapons that match this unit by id.
    let pick = choices.find(c => c.entry && c.entry.unitData && c.entry.unitData.id === unit.id);
    // Otherwise find an all-units weapon for this unit.
    if (!pick) pick = choices.find(c => c.source === 'all' && c.unitName === unit.name);
    // If nothing matches, synthesize a one-off choice list just from this unit.
    if (!pick && unit.weapons && unit.weapons.length) {
      const adhoc = unit.weapons.map((w, wi) => ({
        source: 'adhoc',
        key: 'ad' + wi,
        unitName: unit.name || '—',
        totalModels: 1,
        weapon: w,
        entry: null,
      }));
      // Merge into choices up-front for this session open.
      state = freshState();
      state.choices = adhoc.concat(state.choices);
      state.selectedKey = adhoc[0].key;
      open({ preselectKey: state.selectedKey });
      return;
    }
    open(pick ? { preselectKey: pick.key } : undefined);
  }

  // ──────────────────────────────────────────────────────────────
  // Hook registrations
  // ──────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-dmgcalc',
    region: 'primary',
    label: 'Calc',
    title: 'Damage calculator',
    onClick: () => open(),
  });

  App.hooks.detailActions.push({
    id: 'sim-attack',
    title: 'Simulate attack with this unit',
    html: '<span style="font-weight:700">&Sigma;</span>',
    onClick: unit => openFromUnit(unit),
  });

  // Refresh weapon list when the army changes and we're open.
  App.hooks.armyChange.push(function () {
    if (!isOpen || !state) return;
    state.choices = collectWeaponChoices();
    if (!state.choices.find(c => c.key === state.selectedKey)) {
      state.selectedKey = state.choices.length ? state.choices[0].key : '';
      autoFillFromSelection();
    }
    renderBody();
  });

  // Expose for command palette and debugging.
  App.openDamageCalc = open;
  UI.openDamageCalc = open;
  UI._damageCalcMath = { parseDiceExpr, woundTarget, computeExpected, simulateOnce, analyzeKeywords };
})();
