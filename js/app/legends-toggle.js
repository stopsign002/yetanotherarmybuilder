// app/legends-toggle.js — opt-in visibility toggle for [Legends] units.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_show_legends';
  const BTN_ID = 'yaab-btn-legends';

  let showLegends = false;
  try { showLegends = localStorage.getItem(LS_KEY) === '1'; } catch (_) { showLegends = false; }

  // Roster filter: hide Legends unless the toggle is on.
  App.hooks.rosterFilters.push(function (unit) {
    return showLegends || !unit || !unit.isLegends;
  });

  // Card-class contributor: adds LEGENDS corner badge via CSS ::after.
  App.hooks.cardClassContributors.push(function (unit) {
    return (unit && unit.isLegends) ? 'unit-card-legends' : null;
  });

  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.classList.toggle('is-on', !!showLegends);
    btn.setAttribute('aria-pressed', showLegends ? 'true' : 'false');
    btn.title = showLegends
      ? 'Legends units: VISIBLE (click to hide)'
      : 'Show/hide Legends units';
  }

  function toggle() {
    showLegends = !showLegends;
    try { localStorage.setItem(LS_KEY, showLegends ? '1' : '0'); } catch (_) {}
    updateButton();
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  // Toolbar icon: 'L' glyph with amber-glow active state when enabled.
  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: 'L',
    ariaLabel: 'Legends toggle',
    title: 'Show/hide Legends units',
    onClick: toggle,
  });

  // Detail-panel indicator: watch #unit-detail-panel and inject a "LEGENDS —
  // casual play" tag next to .detail-name when the selected unit is Legends.
  function applyDetailTag() {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const nameEl = panel.querySelector('.detail-name');
    const existing = panel.querySelector('.detail-legends-tag');
    const sel = App.state && App.state.selectedUnit;
    const isLeg = !!(sel && sel.isLegends && nameEl);
    if (!isLeg) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const tag = document.createElement('span');
    tag.className = 'detail-legends-tag';
    tag.textContent = 'LEGENDS — casual play';
    nameEl.insertAdjacentElement('afterend', tag);
  }

  function startDetailObserver() {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const obs = new MutationObserver(function () { applyDetailTag(); });
    obs.observe(panel, { childList: true, subtree: true });
    applyDetailTag();
  }

  App.hooks.bootstrap.push(function () {
    updateButton();
    startDetailObserver();
  });
})();
