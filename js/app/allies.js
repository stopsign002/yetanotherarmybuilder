// app/allies.js — surface 11e allied units (Daemonic Pact, Agents of the
// Imperium, Brood Brothers, …) on their HOST faction's roster.
//
// The units themselves are attached by js/data/dc-adapter.js (attachAlliedUnits),
// which stamps each clone with _allyOf / _allyLabel / _allySourceFaction /
// _allyDetachments. This module is presentation only: badge, toggle, detail tag.
//
// Deliberately mirrors js/app/legends-toggle.js, with one difference: this
// toggle DEFAULTS ON. Legends are non-matched-play, so hiding them by default is
// right; allies are fully legal units, and the whole point of the feature is
// that they were invisible. The toggle exists to declutter, not to opt in.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_show_allies';
  const BTN_ID = 'yaab-btn-allies';

  let showAllies = true;
  try {
    const v = localStorage.getItem(LS_KEY);
    showAllies = (v === null) ? true : (v === '1');
  } catch (_) { showAllies = true; }

  // Ally roster-filter chip state — 3-state cycle, exactly like the keyword
  // chips in roster.js, but owned here (not roster.js: see docs/UI.md
  // "Roster filter chips — and the Ally chip"). Deliberately NOT persisted —
  // it starts off on every load; the toolbar toggle above is the persistent
  // control.
  //   null      → off:      no ally filtering; the toggle above decides
  //   'include' → .active:  show ONLY allied units (overrides the toggle)
  //   'exclude' → .excluded: hide allied units
  let allyChipState = null;

  // Single combined predicate: the chip and the toolbar toggle must never
  // contradict each other. The chip's include state wins over the toggle —
  // asking to see only allies while the toggle hides them would otherwise
  // render an empty roster.
  App.hooks.rosterFilters.push(function alliesChipPredicate(unit) {
    const isAlly = !!(unit && unit._allyOf);
    if (allyChipState === 'include') return isAlly;
    if (allyChipState === 'exclude') return !isAlly;
    return showAllies || !isAlly;
  });

  // Card-class contributor: adds the ALLY corner badge via CSS ::after.
  App.hooks.cardClassContributors.push(function (unit) {
    return (unit && unit._allyOf) ? 'unit-card-ally' : null;
  });

  // "Daemons of Khorne — requires Khorne Daemonkin"
  App.allyTagText = function (unit) {
    if (!unit || !unit._allyOf) return '';
    let s = 'ALLY · ' + (unit._allyLabel || 'Allies');
    const dets = unit._allyDetachments;
    if (Array.isArray(dets) && dets.length) s += ' — requires ' + dets.join(' or ');
    return s;
  };

  // Longer-form restriction text for the tag's tooltip. Pulled off the host
  // faction's alliedRules entry so the authored `notes` prose (per-god Battleline
  // ratios, "shared by Chaos Knights and Heretic Astartes armies", …) is not lost.
  App.allyTagTitle = function (unit) {
    if (!unit || !unit._allyOf) return '';
    const faction = (App.state.factions || []).find(f => f.factionName === unit._allyOf);
    const ids = unit._allyRuleIds || [];
    const rules = ((faction && faction.alliedRules) || []).filter(r => ids.indexOf(r.id) !== -1);
    const out = [];
    rules.forEach((r) => {
      out.push(r.name + (r.sourceFactionName ? ' (' + r.sourceFactionName + ')' : ''));
      if (Array.isArray(r.pointsLimits) && r.pointsLimits.length) {
        out.push('Points limit: ' + r.pointsLimits
          .map(p => `${String(p.battle_size || '').replace(/-/g, ' ')} ${p.max_points}pts`)
          .join(', '));
      }
      if (r.cannotBeWarlord) out.push('Cannot be your Warlord.');
      if (r.cannotTakeEnhancements) out.push('Cannot take Enhancements.');
      if (r.notes) out.push(r.notes);
    });
    return out.join('\n');
  };

  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.classList.toggle('is-on', !!showAllies);
    btn.setAttribute('aria-pressed', showAllies ? 'true' : 'false');
    btn.title = showAllies
      ? 'Allied units: VISIBLE (click to hide)'
      : 'Allied units: hidden (click to show)';
  }

  function toggle() {
    showAllies = !showAllies;
    try { localStorage.setItem(LS_KEY, showAllies ? '1' : '0'); } catch (_) {}
    updateButton();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: 'A',
    ariaLabel: 'Allied units toggle',
    title: 'Show/hide allied units',
    onClick: toggle,
  });

  // ----- roster filter chip bar integration ---------------------------
  //
  // Mirrors js/app/favorites.js: wait for #roster-filter-chips (built lazily
  // by roster.js's ensureChipBar on first render — it doesn't exist at
  // bootstrap) via a MutationObserver on #panel-center, inject once, then
  // disconnect. Insert before the trailing × so it stays last.

  let _chipObserver = null;

  function syncChipClasses(btn) {
    btn = btn || document.querySelector('#roster-filter-chips .ally-chip');
    if (!btn) return;
    btn.classList.toggle('active',   allyChipState === 'include');
    btn.classList.toggle('excluded', allyChipState === 'exclude');
    btn.setAttribute('aria-pressed', allyChipState === 'include' ? 'true' : 'false');
  }

  // Co-operates with roster.js's own × clear button. That handler does
  // `bar.querySelectorAll('.filter-chip')` and strips `.active`/`.excluded`
  // off EVERY chip in the bar (ours included, since we share the class), but
  // it only clears its own `R.chipState` — it has no idea our internal
  // `allyChipState` variable exists. Without this, the chip would go back to
  // looking off while still silently filtering the roster. Bound directly to
  // the clear button (favorites.js/collection.js only use it as an insertion
  // anchor) so the visual reset and the actual filter state can't drift.
  function resetChipState() {
    if (allyChipState === null) return;
    allyChipState = null;
    syncChipClasses();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  function injectChip(bar) {
    if (!bar) return;
    if (bar.querySelector('.ally-chip')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip ally-chip';
    btn.textContent = 'Ally';
    btn.title = 'Click to show only allied units; click again to hide them';
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      allyChipState = allyChipState === null      ? 'include'
                    : allyChipState === 'include'  ? 'exclude'
                    : null;
      syncChipClasses(btn);
      if (typeof App.renderUnitRosterWithContext === 'function') {
        App.renderUnitRosterWithContext();
      }
    });
    const clearBtn = bar.querySelector('.filter-chips-clear');
    if (clearBtn) {
      bar.insertBefore(btn, clearBtn);
      clearBtn.addEventListener('click', resetChipState);
    } else {
      bar.appendChild(btn);
    }
  }

  function installChipObserver() {
    if (_chipObserver) { _chipObserver.disconnect(); _chipObserver = null; }
    const existing = document.getElementById('roster-filter-chips');
    if (existing) { injectChip(existing); return; }
    const center = document.getElementById('panel-center') || document.body;
    _chipObserver = new MutationObserver(() => {
      const bar = document.getElementById('roster-filter-chips');
      if (bar) {
        injectChip(bar);
        if (_chipObserver) { _chipObserver.disconnect(); _chipObserver = null; }
      }
    });
    _chipObserver.observe(center, { childList: true, subtree: true });
  }

  App.hooks.bootstrap.push(updateButton);
  App.hooks.bootstrap.push(installChipObserver);
})();
