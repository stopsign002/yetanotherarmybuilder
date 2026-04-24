// ui/army-list.js — left-panel army list + points summary.
(function () {
  const UI = window.UI = window.UI || {};

  UI.createArmyEntryEl = function (entry, index) {
    const esc = UI.escapeHtml;
    const li = document.createElement('li');
    li.className = 'army-entry';
    li.dataset.index = index;
    const pts    = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
    const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
    const total  = pts * entry.count + enhPts;
    const nameDisplay = entry.squadLabel
      ? `${esc(entry.unitName)} <span class="army-entry-squad">(${esc(entry.squadLabel)})</span>`
      : esc(entry.unitName);
    const enhBadges = (entry.enhancements || []).map(e =>
      `<span class="army-enh-badge" title="${esc(e.description || '')}">${esc(e.name)}</span>`
    ).join('');
    li.innerHTML = `
      <div class="army-entry-name" title="${esc(entry.unitName)}">${nameDisplay}${enhBadges ? `<div class="army-enh-badges">${enhBadges}</div>` : ''}</div>
      <div class="army-entry-pts">${pts}${enhPts ? `<span class="army-enh-pts">+${enhPts}</span>` : ''}</div>
      <div class="army-entry-qty">
        <input type="number" value="${entry.count}" min="0" max="99" data-index="${index}" class="army-qty-input" />
      </div>
      <div class="army-entry-total">${total}</div>
      <button class="army-entry-remove" data-index="${index}" title="Remove">&times;</button>
    `;
    return li;
  };

  UI.renderArmyList = function (army) {
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
    document.querySelector('.points-summary').classList.toggle('points-over', total > limit && limit > 0);
    document.getElementById('points-current').classList.toggle('over-limit', total > limit && limit > 0);

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
