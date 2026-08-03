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

  // Roster filter: hide allied units when the toggle is off.
  App.hooks.rosterFilters.push(function (unit) {
    return showAllies || !unit || !unit._allyOf;
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

  App.hooks.bootstrap.push(updateButton);
})();
