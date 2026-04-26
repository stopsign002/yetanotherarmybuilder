// ui/list-coach.js — heuristic-based list coach modal: composition, threats, points, synergy.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  // ---------------------------------------------------------------------------
  // Severity
  // ---------------------------------------------------------------------------
  const SEV = { INFO: 'info', WARN: 'warning', CRIT: 'critical' };
  const SEV_GLYPH = { info: 'i', warning: '!', critical: 'X' };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function lcKeywords(unit) {
    const set = new Set();
    const kws = (unit && unit.keywords) || [];
    for (let i = 0; i < kws.length; i++) {
      const k = String(kws[i] || '').toLowerCase();
      if (k) set.add(k);
    }
    return set;
  }

  function hasKeyword(unit, kw) {
    return lcKeywords(unit).has(String(kw).toLowerCase());
  }

  function parseS(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const m = s.match(/^(\d*)\s*[dD](\d+)(?:\s*([+-])\s*(\d+))?/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      let v = n * (sides + 1) / 2;
      if (m[3] && m[4]) v += (m[3] === '+' ? 1 : -1) * parseInt(m[4], 10);
      return Math.round(v);
    }
    return 0;
  }

  function parseA(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const m = s.match(/^(\d*)\s*[dD](\d+)(?:\s*([+-])\s*(\d+))?/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      let v = n * (sides + 1) / 2;
      if (m[3] && m[4]) v += (m[3] === '+' ? 1 : -1) * parseInt(m[4], 10);
      return Math.round(v);
    }
    return 0;
  }

  function parseRange(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (/melee/i.test(s)) return 0;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function isMelee(w) {
    if (!w) return false;
    const tn = String(w._typeName || '').toLowerCase();
    if (tn.indexOf('melee') !== -1) return true;
    if (String(w.Range || '').toLowerCase() === 'melee') return true;
    return false;
  }

  function weaponHasAntiVehicle(w) {
    const kws = String((w && w.Keywords) || '');
    return /anti-?vehicle/i.test(kws);
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------
  function analyze(army) {
    const sug = [];
    if (!army) return sug;
    const entries = army.entries || [];

    // Composition counts
    let battleline = 0, characters = 0, psykers = 0;
    let hasInfantry = false, hasVehicle = false, hasMonster = false;
    let hasAntiTank = false, hasAntiHorde = false, hasLongRange = false;
    let escortableInfantry = 0;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const u = e.unitData || {};
      if (hasKeyword(u, 'battleline')) battleline += (e.count || 1);
      const isCharacter = hasKeyword(u, 'character');
      if (isCharacter) characters += (e.count || 1);
      if (hasKeyword(u, 'psyker')) psykers += (e.count || 1);
      if (hasKeyword(u, 'infantry')) {
        hasInfantry = true;
        if (!isCharacter) escortableInfantry += (e.count || 1);
      }
      if (hasKeyword(u, 'vehicle')) hasVehicle = true;
      if (hasKeyword(u, 'monster'))  hasMonster = true;

      const weapons = u.weapons || [];
      for (let j = 0; j < weapons.length; j++) {
        const w = weapons[j];
        const S = parseS(w.S);
        const A = parseA(w.A);
        const R = parseRange(w.Range);
        if (!isMelee(w)) {
          if (S >= 8 || weaponHasAntiVehicle(w)) hasAntiTank = true;
          if (A >= 3 && S <= 5 && S > 0) hasAntiHorde = true;
          if (R >= 36) hasLongRange = true;
        } else {
          if (S >= 8 || weaponHasAntiVehicle(w)) hasAntiTank = true;
        }
      }
    }

    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const limit = army.pointsLimit || 0;
    const small = entries.length < 5;

    // ── Composition ────────────────────────────────────────────────
    if (battleline < 2) {
      sug.push({
        sev: SEV.WARN,
        title: 'Add a Battleline unit',
        body: 'Most missions reward holding objectives. You have ' + battleline + ' Battleline ' + (battleline === 1 ? 'unit' : 'units') + '.',
      });
    }

    if (characters === 0) {
      sug.push({
        sev: SEV.CRIT,
        title: 'Add a Character',
        body: 'Characters take Enhancements and serve as Warlord — required by most detachments.',
      });
    }

    if (!small) {
      if (psykers === 0) {
        sug.push({
          sev: SEV.INFO,
          title: 'No Psyker in the list',
          body: 'You have no Psyker — vulnerable to opponent Psychic phase. Consider adding one.',
        });
      }

      // Mono-role check: if every entry shares a single role keyword.
      if (entries.length >= 3) {
        const allVehicle  = entries.every(e => hasKeyword(e.unitData || {}, 'vehicle'));
        const allInfantry = entries.every(e => hasKeyword(e.unitData || {}, 'infantry'));
        if (allVehicle) {
          sug.push({
            sev: SEV.INFO,
            title: 'All-Vehicle list',
            body: 'Diverse roles improve adaptability — consider adding Infantry for objectives.',
          });
        } else if (allInfantry) {
          sug.push({
            sev: SEV.INFO,
            title: 'All-Infantry list',
            body: 'Diverse roles improve adaptability — consider adding a Vehicle or Monster.',
          });
        }
      }
    }

    // ── Threat coverage (skip on tiny lists to avoid false positives) ──
    if (!small) {
      if (!hasAntiTank) {
        sug.push({
          sev: SEV.WARN,
          title: 'Light on anti-tank',
          body: 'No high-Strength weapons (S8+) or Anti-Vehicle keywords. Knights and Vehicles will be hard to remove.',
        });
      }
      if (!hasAntiHorde) {
        sug.push({
          sev: SEV.WARN,
          title: 'Limited anti-horde fire',
          body: 'No volume weapons (A3+, S5-). Tyranid swarms or Ork mobs may overwhelm you.',
        });
      }
      if (!hasLongRange) {
        sug.push({
          sev: SEV.INFO,
          title: 'No long-range threat',
          body: 'No weapon with 36"+ range. Opponents can sit on objectives unchallenged.',
        });
      }
    }

    // ── Points efficiency ──────────────────────────────────────────
    if (limit > 0) {
      if (total > limit) {
        sug.push({
          sev: SEV.CRIT,
          title: 'Over points limit',
          body: 'Trim ' + (total - limit) + ' pts to fit in ' + limit + '.',
        });
      } else if (total < (limit - 30)) {
        sug.push({
          sev: SEV.INFO,
          title: 'Under points limit',
          body: 'You have ' + (limit - total) + ' pts unspent. Add a unit or wargear.',
        });
      }
    }

    // ── Synergy hints ──────────────────────────────────────────────
    if (characters > 0 && escortableInfantry === 0 && !small) {
      sug.push({
        sev: SEV.WARN,
        title: 'Character has no escort',
        body: 'Your Character has no non-Character Infantry to lead — add an Infantry unit so they can attach.',
      });
    }
    if (hasVehicle && characters === 0) {
      sug.push({
        sev: SEV.INFO,
        title: 'Vehicles without buffs',
        body: 'No Characters available — Characters often grant Vehicle re-rolls or auras.',
      });
    }

    return sug;
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  function ensureStyles() {
    if (document.querySelector('link[data-yaab-voice-coach]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/voice-coach.css';
    link.setAttribute('data-yaab-voice-coach', '1');
    document.head.appendChild(link);
  }

  let backdropEl = null;
  let isOpen = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureModal() {
    if (backdropEl) return backdropEl;
    ensureStyles();
    backdropEl = document.createElement('div');
    backdropEl.className = 'modal-backdrop list-coach-backdrop';
    backdropEl.setAttribute('hidden', '');
    backdropEl.innerHTML = `
      <div class="modal list-coach-modal" role="dialog" aria-label="List Coach">
        <div class="modal-header">
          <h3>List Coach</h3>
          <button class="modal-close" type="button" aria-label="Close" data-lc-close>&times;</button>
        </div>
        <div class="modal-body list-coach-body" id="list-coach-body"></div>
        <div class="modal-footer">
          <button class="btn btn-outline btn-sm" type="button" data-lc-close>Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdropEl);
    backdropEl.addEventListener('click', function (e) {
      if (e.target === backdropEl) close();
      if (e.target.closest && e.target.closest('[data-lc-close]')) close();
    });
    return backdropEl;
  }

  function renderBody(suggestions, army) {
    if (!army || !(army.entries || []).length) {
      return '<div class="coach-empty">Add some units, then run the coach.</div>';
    }
    if (!suggestions.length) {
      return '<div class="coach-empty coach-empty-good">Looks solid. No critical issues spotted.</div>';
    }
    let html = '<ul class="coach-suggestions">';
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      html += `
        <li class="coach-suggestion coach-sev-${esc(s.sev)}">
          <span class="coach-sev-icon" aria-hidden="true">${esc(SEV_GLYPH[s.sev] || '')}</span>
          <div class="coach-sug-text">
            <div class="coach-sug-title">${esc(s.title)}</div>
            <div class="coach-sug-body">${esc(s.body)}</div>
          </div>
        </li>
      `;
    }
    html += '</ul>';
    return html;
  }

  function rerender() {
    if (!isOpen) return;
    const body = document.getElementById('list-coach-body');
    if (!body) return;
    const army = App.state && App.state.currentArmy;
    const suggestions = analyze(army);
    body.innerHTML = renderBody(suggestions, army);
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

  // ---------------------------------------------------------------------------
  // Registration — primary registration is tools-menu (analysis category).
  // The toolbar router (app/index.js) routes tools-menu items into the Tools
  // dropdown when present and falls through gracefully when unavailable.
  // ---------------------------------------------------------------------------
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-list-coach',
    region: 'tools-menu',
    category: 'analysis',
    label: 'List Coach',
    title: 'Tactical analysis of your current army',
    onClick: toggle,
  });

  App.hooks.armyChange.push(function () {
    if (isOpen) rerender();
  });

  // Expose for voice-commands / palette / programmatic use.
  App.toggleListCoach = toggle;
  App.openListCoach = open;
  App.closeListCoach = close;
  UI.openListCoach = open;
  UI._coachAnalyze = analyze;
})();
