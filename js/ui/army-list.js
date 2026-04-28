// ui/army-list.js — left-panel army list + points summary.
(function () {
  const UI = window.UI = window.UI || {};

  UI.createArmyEntryEl = function (entry, index) {
    const esc = UI.escapeHtml;
    const li = document.createElement('li');
    li.className = 'army-entry army-entry-card';
    li.dataset.index = index;
    const pts    = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
    const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
    const total  = pts * entry.count + enhPts;
    const squadHtml = entry.squadLabel
      ? `<span class="army-entry-squad">(${esc(entry.squadLabel)})</span>` : '';
    const enhBadges = (entry.enhancements || []).map(e =>
      `<span class="army-enh-badge" title="${esc(e.description || '')}">${esc(e.name)}</span>`
    ).join('');
    // New richer markup. Preserves the original element classes + data-* attrs
    // that events.js delegates on (.army-entry, .army-qty-input,
    // .army-entry-remove, data-index). The grid is replaced by a flex layout
    // styled in build-mode.css; the legacy column-grid CSS still targets the
    // sub-elements via class name when build-mode.css is absent.
    li.innerHTML = `
      <span class="army-entry-stripe" aria-hidden="true"></span>
      <span class="army-entry-handle" aria-hidden="true" title="Drag to reorder">
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
      </span>
      <div class="army-entry-body">
        <div class="army-entry-name" title="${esc(entry.unitName)}">
          <span class="army-entry-title">${esc(entry.unitName)}</span>
          ${squadHtml}
        </div>
        ${enhBadges ? `<div class="army-enh-badges">${enhBadges}</div>` : ''}
        <div class="army-entry-stats">
          <span class="army-entry-stat army-entry-stat-pts">
            <span class="army-entry-stat-label">Pts</span>
            <span class="army-entry-pts">${pts}${enhPts ? `<span class="army-enh-pts">+${enhPts}</span>` : ''}</span>
          </span>
          <span class="army-entry-stat army-entry-stat-qty">
            <span class="army-entry-stat-label">Qty</span>
            <span class="army-entry-qty">
              <input type="number" value="${entry.count}" min="0" max="99" data-index="${index}" class="army-qty-input" />
            </span>
          </span>
          <span class="army-entry-stat army-entry-stat-total">
            <span class="army-entry-stat-label">Total</span>
            <span class="army-entry-total">${total}</span>
          </span>
        </div>
      </div>
      <button class="army-entry-remove" data-index="${index}" title="Remove" aria-label="Remove unit">&times;</button>
    `;
    return li;
  };

  UI.renderArmyList = function (army) {
    if (window.App && typeof App.fireArmyChange === 'function') App.fireArmyChange('render');
    if (!army) return;

    const nameInput  = document.getElementById('army-name-input');
    const limitInput = document.getElementById('points-limit-input');
    if (document.activeElement !== nameInput)  nameInput.value  = army.name;
    if (document.activeElement !== limitInput) limitInput.value = army.pointsLimit;

    const total     = army.getTotalPoints();
    const limit     = army.pointsLimit || 0;
    const pct       = limit > 0 ? Math.min((total / limit) * 100, 100) : (total > 0 ? 100 : 0);
    const remaining = limit - total;

    document.getElementById('points-current').textContent      = total;
    document.getElementById('points-limit-display').textContent = limit;
    document.getElementById('points-bar-pct').textContent       = Math.round(pct) + '%';
    document.getElementById('points-bar-remaining').textContent =
      remaining >= 0 ? `${remaining} pts remaining` : `${Math.abs(remaining)} pts over limit`;

    const bar = document.getElementById('points-bar');
    bar.style.width = pct + '%';
    bar.classList.toggle('over-limit',  total > limit && limit > 0);
    bar.classList.toggle('near-limit', !bar.classList.contains('over-limit') && pct >= 90);
    const summaryEl = document.querySelector('.points-summary');
    if (summaryEl) summaryEl.classList.toggle('points-over', total > limit && limit > 0);
    const curEl = document.getElementById('points-current');
    if (curEl) curEl.classList.toggle('over-limit', total > limit && limit > 0);

    // The topbar build-hero has its own current/limit/pct/bar elements
    // (data-build-hero="*"); build-mode.js#syncHero is supposed to refresh
    // them via the armyChange hook, but the hook fires *before* the legacy
    // spans are written, so under some timing it lagged a render behind.
    // Update the visible elements directly here too — cheap, idempotent.
    const heroCur = document.querySelector('[data-build-hero="points-current"]');
    if (heroCur) heroCur.textContent = total;
    const heroLim = document.querySelector('[data-build-hero="points-limit"]');
    if (heroLim) heroLim.textContent = limit;
    const heroPct = document.querySelector('[data-build-hero="pct"]');
    if (heroPct) heroPct.textContent = Math.round(pct) + '%';
    const heroBar = document.querySelector('[data-build-hero="bar"]');
    if (heroBar) {
      heroBar.style.width = pct + '%';
      heroBar.classList.toggle('over-limit',  total > limit && limit > 0);
      heroBar.classList.toggle('near-limit', !heroBar.classList.contains('over-limit') && pct >= 90);
    }

    const list = document.getElementById('army-entry-list');
    list.innerHTML = '';

    if (!army.entries || army.entries.length === 0) {
      const li = document.createElement('li');
      li.id = 'army-list-empty';
      li.className = 'army-list-empty';
      li.innerHTML = 'No units added yet.<br/>Select a unit, then &ldquo;Add to Army&rdquo;.';
      list.appendChild(li);
      return;
    }

    army.entries.forEach((entry, index) => {
      list.appendChild(UI.createArmyEntryEl(entry, index));
    });
  };
})();
