// ui/analytics.js — army analytics dashboard (modal overlay; live via armyChange hook).
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  // ──────────────────────────────────────────────────────────────
  // Assumptions (documented per task requirements)
  //
  // Weapon multiplicity: we assume every weapon listed on a unit is carried
  // by ALL models in the unit, UNLESS the weapon name contains a parenthetical
  // count hint like "(1)", "(one)", "(two)", "(2)", "(3)". In that case we
  // treat it as carried by that many models total across the whole entry
  // (not per-squad; this is a coarse approximation — BattleScribe's wargear
  // options would be required for an exact count). This intentionally over-
  // counts heavy/special weapons shared between squadmates but gives a
  // useful at-a-glance picture of the army's threat profile.
  //
  // Dice averaging (A / S / D): numeric strings pass through as-is.
  // "D3" → 2, "D6" → 3.5, "D3+1" → 3, "2D6" → 7, "D6+2" → 5.5, etc. We
  // parse N*DX + C expressions. Unparseable strings fall back to 1.
  // ──────────────────────────────────────────────────────────────

  const PAREN_COUNT_RE = /\(\s*(\d+|one|two|three|four|five|six)\s*\)/i;
  const WORD_NUM = { one:1, two:2, three:3, four:4, five:5, six:6 };

  const NOTABLE_KEYWORDS = [
    'Lethal Hits',
    'Devastating Wounds',
    'Sustained Hits',
    'Anti-',
    'Assault',
    'Rapid Fire',
    'Melta',
    'Torrent',
    'Twin-linked',
  ];

  const ROLE_ORDER = ['Character', 'Battleline', 'Monster', 'Vehicle', 'Psyker', 'Infantry', 'Other'];
  const ROLE_COLORS = {
    Character:  '#e6c77a',
    Battleline: '#7aa3e6',
    Monster:    '#c37ae6',
    Vehicle:    '#7ae6c9',
    Psyker:     '#e67a9e',
    Infantry:   '#a8cf7a',
    Other:      '#888888',
  };

  // ──────────────────────────────────────────────────────────────
  // Parsing helpers
  // ──────────────────────────────────────────────────────────────

  // Parse dice expressions: "3", "D6", "2D3", "D3+1", "D6+2", etc. Returns
  // the expected value. Unparseable → 1 (lazy fallback).
  function parseDice(raw) {
    if (raw == null) return 1;
    const s = String(raw).trim();
    if (!s) return 1;
    const m = s.match(/^(\d*)\s*[dD](\d+)(?:\s*([+-])\s*(\d+))?/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      const avg = (sides + 1) / 2;
      let total = n * avg;
      if (m[3] && m[4]) {
        const c = parseInt(m[4], 10);
        total += m[3] === '+' ? c : -c;
      }
      return total;
    }
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n;
    return 1; // fallback: treat unparseable as 1 (documented)
  }

  // Parse strength: D6 averages are used (per dice rule), integers as-is.
  function parseStrength(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (!s) return 0;
    // Some S values are like "User", "x2" etc; these become 0 and are bucketed into S1-3.
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const d = parseDice(s);
    return isFinite(d) ? Math.round(d) : 0;
  }

  function parseRange(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (/melee/i.test(s)) return 0;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function isMeleeWeapon(w) {
    const tn = String(w._typeName || '').toLowerCase();
    if (tn.includes('melee')) return true;
    if (String(w.Range || '').toLowerCase() === 'melee') return true;
    return false;
  }

  function carriersForWeapon(weapon, totalModels) {
    const name = String(weapon.name || '');
    const m = name.match(PAREN_COUNT_RE);
    if (m) {
      const raw = m[1].toLowerCase();
      const n = WORD_NUM[raw] != null ? WORD_NUM[raw] : parseInt(raw, 10);
      if (!isNaN(n) && n > 0) return Math.min(n, totalModels);
    }
    return totalModels;
  }

  function totalModelsForEntry(entry) {
    const count = entry.count || 1;
    const unit = entry.unitData || {};
    const opts = unit.squadOptions || [];
    let modelsPerSquad = 1;
    if (opts.length) {
      // Match on selectedPts if present
      let chosen = opts.find(o => o.pts === entry.selectedPts);
      if (!chosen) chosen = opts[0];
      if (chosen && chosen.models) modelsPerSquad = chosen.models;
    }
    return count * modelsPerSquad;
  }

  function classifyRole(keywords) {
    const set = new Set((keywords || []).map(k => String(k).toLowerCase()));
    // Character takes priority, then Battleline, then the rest.
    if (set.has('character')) return 'Character';
    if (set.has('battleline')) return 'Battleline';
    if (set.has('monster')) return 'Monster';
    if (set.has('vehicle')) return 'Vehicle';
    if (set.has('psyker')) return 'Psyker';
    if (set.has('infantry')) return 'Infantry';
    return 'Other';
  }

  function statNumber(stats, key) {
    if (!stats) return null;
    const candidates = [key, key.toLowerCase(), key.toUpperCase()];
    for (const k of candidates) {
      if (stats[k] != null && stats[k] !== '') {
        const n = parseInt(String(stats[k]).replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) return n;
      }
    }
    return null;
  }

  function saveMultiplier(sv) {
    if (!sv) return 1.0;
    const s = String(sv).trim();
    if (s.startsWith('2')) return 1.5;
    if (s.startsWith('3')) return 1.2;
    if (s.startsWith('4')) return 1.0;
    if (s.startsWith('5')) return 0.8;
    if (s.startsWith('6')) return 0.6;
    return 1.0;
  }

  // ──────────────────────────────────────────────────────────────
  // Main compute pass over the army
  // ──────────────────────────────────────────────────────────────

  function computeAnalytics(army) {
    const result = {
      name: (army && army.name) || '—',
      totalPoints: 0,
      pointsLimit: (army && army.pointsLimit) || 0,
      unitCount: 0,
      modelCount: 0,
      roles: {},        // { role: points }
      strengthMelee:  [0, 0, 0, 0, 0], // S1-3, S4-5, S6-7, S8-9, S10+
      strengthRanged: [0, 0, 0, 0, 0],
      threatRanges: { 12: 0, 24: 0, 36: 0, 48: 0, 60: 0 },
      durabilityScore: 0,
      durabilityContributors: [], // { name, score }
      keywordCounts: {},
      totalWounds: 0,
      totalAttacks: 0,
      empty: true,
    };
    ROLE_ORDER.forEach(r => { result.roles[r] = 0; });
    NOTABLE_KEYWORDS.forEach(k => { result.keywordCounts[k] = 0; });

    const entries = (army && army.entries) || [];
    if (!entries.length) return result;
    result.empty = false;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const unit = entry.unitData || {};
      const stats = unit.stats || {};
      const totalModels = totalModelsForEntry(entry);
      const entryPts = (entry.selectedPts != null ? entry.selectedPts : (unit.points || 0)) * (entry.count || 1)
        + (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);

      result.unitCount += (entry.count || 1);
      result.modelCount += totalModels;
      result.totalPoints += entryPts;

      // Role breakdown
      const role = classifyRole(unit.keywords);
      result.roles[role] = (result.roles[role] || 0) + entryPts;

      // Durability
      const T = statNumber(stats, 'T') || 0;
      const W = statNumber(stats, 'W') || 0;
      const SV = stats.SV || stats.Sv || stats.sv || '';
      let dmul = saveMultiplier(SV);
      if (unit.invulnSave) dmul += 0.3;
      const score = totalModels * T * W * dmul;
      if (score > 0) {
        result.durabilityScore += score;
        result.durabilityContributors.push({ name: unit.name || entry.unitName || '—', score });
      }
      result.totalWounds += totalModels * W;

      // Weapons pass
      const weapons = unit.weapons || [];
      for (let j = 0; j < weapons.length; j++) {
        const w = weapons[j];
        const carriers = carriersForWeapon(w, totalModels);
        if (carriers <= 0) continue;
        const attacksPer = parseDice(w.A);
        const totalAttacks = attacksPer * carriers;
        const S = parseStrength(w.S);
        const ranged = !isMeleeWeapon(w);

        result.totalAttacks += totalAttacks;

        // Strength bucket
        let bucket = 0;
        if (S >= 10) bucket = 4;
        else if (S >= 8) bucket = 3;
        else if (S >= 6) bucket = 2;
        else if (S >= 4) bucket = 1;
        else bucket = 0;
        if (ranged) result.strengthRanged[bucket] += totalAttacks;
        else result.strengthMelee[bucket] += totalAttacks;

        // Threat ranges (ranged only)
        if (ranged) {
          const r = parseRange(w.Range);
          if (r > 0) {
            if (r >= 60) result.threatRanges[60] += totalAttacks;
            else if (r >= 48) result.threatRanges[48] += totalAttacks;
            else if (r >= 36) result.threatRanges[36] += totalAttacks;
            else if (r >= 24) result.threatRanges[24] += totalAttacks;
            else result.threatRanges[12] += totalAttacks;
          }
        }

        // Notable keywords
        const kwString = String(w.Keywords || '');
        if (kwString) {
          const kws = kwString.split(',').map(k => k.trim()).filter(Boolean);
          for (const kw of kws) {
            for (const notable of NOTABLE_KEYWORDS) {
              if (notable === 'Anti-') {
                if (/^anti-/i.test(kw)) result.keywordCounts['Anti-'] += 1;
              } else if (notable === 'Twin-linked') {
                if (/twin-?linked/i.test(kw)) result.keywordCounts['Twin-linked'] += 1;
              } else if (notable === 'Rapid Fire') {
                if (/^rapid\s*fire/i.test(kw)) result.keywordCounts['Rapid Fire'] += 1;
              } else if (notable === 'Sustained Hits') {
                if (/^sustained\s*hits/i.test(kw)) result.keywordCounts['Sustained Hits'] += 1;
              } else if (notable === 'Melta') {
                if (/^melta/i.test(kw)) result.keywordCounts['Melta'] += 1;
              } else {
                if (kw.toLowerCase() === notable.toLowerCase()) {
                  result.keywordCounts[notable] += 1;
                }
              }
            }
          }
        }
      }
    }

    result.durabilityContributors.sort((a, b) => b.score - a.score);
    result.durabilityContributors = result.durabilityContributors.slice(0, 3);
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtInt(n) { return Math.round(n).toLocaleString(); }
  function fmtPct(n) {
    if (!isFinite(n)) return '0%';
    return Math.round(n) + '%';
  }

  function renderHeader(a) {
    const pct = a.pointsLimit > 0 ? (a.totalPoints / a.pointsLimit) * 100 : 0;
    return `
      <div class="yaab-an-header">
        <div class="yaab-an-header-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="yaab-an-header-stats">
          <div class="yaab-an-header-stat">
            <div class="yaab-an-header-stat-value">${fmtInt(a.totalPoints)} / ${fmtInt(a.pointsLimit)}</div>
            <div class="yaab-an-header-stat-label">points (${fmtPct(pct)})</div>
          </div>
          <div class="yaab-an-header-stat">
            <div class="yaab-an-header-stat-value">${fmtInt(a.unitCount)}</div>
            <div class="yaab-an-header-stat-label">units</div>
          </div>
          <div class="yaab-an-header-stat">
            <div class="yaab-an-header-stat-value">${fmtInt(a.modelCount)}</div>
            <div class="yaab-an-header-stat-label">models</div>
          </div>
        </div>
      </div>`;
  }

  function renderRoleBreakdown(a) {
    const entries = ROLE_ORDER.map(r => ({ role: r, pts: a.roles[r] || 0 })).filter(e => e.pts > 0);
    const total = entries.reduce((s, e) => s + e.pts, 0);
    if (total === 0) {
      return `<div class="yaab-an-section">
        <div class="yaab-an-section-title">Role breakdown</div>
        <div class="yaab-an-empty-inline">No points yet.</div>
      </div>`;
    }
    const segments = entries.map(e => {
      const pctN = (e.pts / total) * 100;
      return `<div class="yaab-an-role-seg" style="flex-basis:${pctN}%;background:${ROLE_COLORS[e.role]}" title="${esc(e.role)}: ${fmtInt(e.pts)} pts"></div>`;
    }).join('');
    const legend = entries.map(e => {
      const pctN = (e.pts / total) * 100;
      return `<div class="yaab-an-legend-item">
        <span class="yaab-an-legend-swatch" style="background:${ROLE_COLORS[e.role]}"></span>
        <span class="yaab-an-legend-role">${esc(e.role)}</span>
        <span class="yaab-an-legend-pts">${fmtInt(e.pts)} pts</span>
        <span class="yaab-an-legend-pct">${fmtPct(pctN)}</span>
      </div>`;
    }).join('');
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Role breakdown</div>
        <div class="yaab-an-role-bar">${segments}</div>
        <div class="yaab-an-legend">${legend}</div>
      </div>`;
  }

  function renderDamageProfile(a) {
    const labels = ['S1-3', 'S4-5', 'S6-7', 'S8-9', 'S10+'];
    const maxVal = Math.max(1,
      ...a.strengthMelee, ...a.strengthRanged
    );
    const rows = labels.map((lbl, i) => {
      const m = a.strengthMelee[i];
      const r = a.strengthRanged[i];
      const mPct = (m / maxVal) * 100;
      const rPct = (r / maxVal) * 100;
      return `
        <div class="yaab-an-dmg-row">
          <div class="yaab-an-dmg-label">${esc(lbl)}</div>
          <div class="yaab-an-dmg-bars">
            <div class="yaab-an-dmg-barline" title="Ranged ${esc(lbl)}: ${fmtInt(r)}">
              <div class="yaab-an-dmg-bar yaab-an-dmg-bar-ranged" style="width:${rPct}%"></div>
              <span class="yaab-an-dmg-val">${fmtInt(r)} ranged</span>
            </div>
            <div class="yaab-an-dmg-barline" title="Melee ${esc(lbl)}: ${fmtInt(m)}">
              <div class="yaab-an-dmg-bar yaab-an-dmg-bar-melee" style="width:${mPct}%"></div>
              <span class="yaab-an-dmg-val">${fmtInt(m)} melee</span>
            </div>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Damage profile (attacks by S bracket)</div>
        <div class="yaab-an-dmg-legend">
          <span class="yaab-an-legend-item"><span class="yaab-an-legend-swatch yaab-an-swatch-ranged"></span>Ranged</span>
          <span class="yaab-an-legend-item"><span class="yaab-an-legend-swatch yaab-an-swatch-melee"></span>Melee</span>
        </div>
        <div class="yaab-an-dmg-grid">${rows}</div>
      </div>`;
  }

  function renderThreatRanges(a) {
    const buckets = [12, 24, 36, 48, 60];
    const maxVal = Math.max(1, ...buckets.map(b => a.threatRanges[b] || 0));
    const bars = buckets.map(b => {
      const val = a.threatRanges[b] || 0;
      const pctN = (val / maxVal) * 100;
      const label = b === 60 ? '60"+' : (b + '"');
      return `
        <div class="yaab-an-threat-col" title="${esc(label)}: ${fmtInt(val)} attacks">
          <div class="yaab-an-threat-val">${fmtInt(val)}</div>
          <div class="yaab-an-threat-bar-wrap">
            <div class="yaab-an-threat-bar" style="height:${pctN}%"></div>
          </div>
          <div class="yaab-an-threat-label">${esc(label)}</div>
        </div>`;
    }).join('');
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Threat ranges (ranged attacks)</div>
        <div class="yaab-an-threat-row">${bars}</div>
      </div>`;
  }

  function renderDurability(a) {
    const tip = 'Durability = Σ (models × T × W × save-multiplier). Save multipliers: 2+ 1.5, 3+ 1.2, 4+ 1.0, 5+ 0.8, 6+ 0.6. +0.3 bonus if unit has an invulnerable save. This is a rough comparative index, not an exact stat.';
    const list = a.durabilityContributors.map(c =>
      `<li><span class="yaab-an-top-name">${esc(c.name)}</span><span class="yaab-an-top-score">${fmtInt(c.score)}</span></li>`
    ).join('');
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Durability index
          <span class="yaab-an-help" data-tooltip="${esc(tip)}" title="${esc(tip)}">?</span>
        </div>
        <div class="yaab-an-durability">
          <div class="yaab-an-durability-score">${fmtInt(a.durabilityScore)}</div>
          <div class="yaab-an-durability-label">total score</div>
        </div>
        <ol class="yaab-an-top-list">${list || '<li class="yaab-an-empty-inline">—</li>'}</ol>
      </div>`;
  }

  function renderKeywordHighlights(a) {
    const chips = NOTABLE_KEYWORDS.map(k => {
      const n = a.keywordCounts[k] || 0;
      const cls = n > 0 ? 'yaab-an-chip' : 'yaab-an-chip yaab-an-chip-zero';
      return `<span class="${cls}"><span class="yaab-an-chip-label">${esc(k)}</span><span class="yaab-an-chip-count">${n}</span></span>`;
    }).join('');
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Weapon keyword highlights</div>
        <div class="yaab-an-chips">${chips}</div>
      </div>`;
  }

  function renderEfficiency(a) {
    const pct = a.pointsLimit > 0 ? (a.totalPoints / a.pointsLimit) * 100 : 0;
    const ppw = a.totalWounds > 0 ? (a.totalPoints / a.totalWounds) : 0;
    const ppa = a.totalAttacks > 0 ? (a.totalPoints / a.totalAttacks) : 0;
    return `
      <div class="yaab-an-section">
        <div class="yaab-an-section-title">Points efficiency</div>
        <div class="yaab-an-eff-row">
          <div class="yaab-an-eff-big">
            <div class="yaab-an-eff-big-num">${fmtPct(pct)}</div>
            <div class="yaab-an-eff-big-label">of points limit</div>
          </div>
          <div class="yaab-an-eff-secondary">
            <div class="yaab-an-eff-sec-item">
              <div class="yaab-an-eff-sec-num">${ppw > 0 ? ppw.toFixed(1) : '—'}</div>
              <div class="yaab-an-eff-sec-label">pts / wound</div>
            </div>
            <div class="yaab-an-eff-sec-item">
              <div class="yaab-an-eff-sec-num">${ppa > 0 ? ppa.toFixed(1) : '—'}</div>
              <div class="yaab-an-eff-sec-label">pts / attack</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderBody(a) {
    if (a.empty) {
      return `<div class="yaab-an-empty">Add units to see analytics</div>`;
    }
    return `
      ${renderHeader(a)}
      <div class="yaab-an-grid">
        <div class="yaab-an-cell yaab-an-cell-wide">${renderRoleBreakdown(a)}</div>
        <div class="yaab-an-cell yaab-an-cell-wide">${renderDamageProfile(a)}</div>
        <div class="yaab-an-cell">${renderThreatRanges(a)}</div>
        <div class="yaab-an-cell">${renderDurability(a)}</div>
        <div class="yaab-an-cell yaab-an-cell-wide">${renderKeywordHighlights(a)}</div>
        <div class="yaab-an-cell yaab-an-cell-wide">${renderEfficiency(a)}</div>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // Modal
  // ──────────────────────────────────────────────────────────────

  let isOpen = false;
  let backdropEl = null;

  function ensureModal() {
    if (backdropEl) return backdropEl;
    // Load stylesheet (idempotent)
    if (!document.querySelector('link[data-yaab-analytics]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/analytics.css';
      link.setAttribute('data-yaab-analytics', '1');
      document.head.appendChild(link);
    }

    backdropEl = document.createElement('div');
    backdropEl.className = 'modal-backdrop yaab-an-backdrop';
    backdropEl.setAttribute('hidden', '');
    backdropEl.innerHTML = `
      <div class="modal yaab-an-modal" role="dialog" aria-label="Army analytics">
        <div class="modal-header">
          <h3>Army Analytics</h3>
          <button class="modal-close" type="button" aria-label="Close" data-yaab-an-close>&times;</button>
        </div>
        <div class="modal-body yaab-an-body" id="yaab-an-body"></div>
        <div class="modal-footer">
          <button class="btn btn-outline btn-sm" type="button" data-yaab-an-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(backdropEl);

    // Close handlers
    backdropEl.addEventListener('click', function (e) {
      if (e.target === backdropEl) close();
      if (e.target.closest('[data-yaab-an-close]')) close();
    });
    return backdropEl;
  }

  function rerender() {
    if (!isOpen) return;
    const army = (App.state && App.state.currentArmy) || null;
    const analytics = computeAnalytics(army);
    const body = document.getElementById('yaab-an-body');
    if (body) body.innerHTML = renderBody(analytics);
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
    if (isOpen) close();
    else open();
  }

  // ──────────────────────────────────────────────────────────────
  // Hook registrations
  // ──────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-analytics',
    region: 'primary',
    label: 'Analytics',
    title: 'Army analytics dashboard',
    onClick: toggle,
  });

  App.hooks.armyChange.push(function () {
    if (isOpen) rerender();
  });

  // Expose for debugging / integration.
  UI.toggleAnalytics = toggle;
  UI.openAnalytics   = open;
  UI.closeAnalytics  = close;
  UI._computeAnalytics = computeAnalytics;
})();
