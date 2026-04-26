// ui/dice-roller.js — click a stat cell to roll 1d6, shown as a floating badge.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  function d6() { return 1 + Math.floor(Math.random() * 6); }

  function parseTarget(text) {
    // "3+" style → returns the needed number (3); else null.
    const m = String(text || '').trim().match(/^(\d)\s*\+$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function captionFor(label, value, roll) {
    const L = String(label || '').trim().toUpperCase();
    const target = parseTarget(value);
    if (target !== null) {
      const ok = roll >= target;
      return 'Rolled ' + roll + (ok ? ' — pass' : ' — fail');
    }
    if (L === 'M')  return 'Rolled ' + roll + (roll >= 5 ? ' — fleet of foot' : '');
    if (L === 'T')  return 'Rolled ' + roll + (roll >= 5 ? ' — tough break' : '');
    if (L === 'W')  return 'Rolled ' + roll;
    if (L === 'LD') return 'Rolled ' + roll + (roll <= 2 ? ' — steady nerves' : '');
    if (L === 'OC') return 'Rolled ' + roll;
    return 'Rolled ' + roll + '.';
  }

  function readCell(cell) {
    const name = cell.querySelector('.stat-name');
    const val  = cell.querySelector('.stat-value');
    const label = name ? name.textContent : '';
    const value = val ? val.textContent : cell.textContent;
    return { label, value };
  }

  function showBadge(cell, text) {
    const existing = cell.querySelector('.dice-badge');
    if (existing) existing.remove();
    const badge = document.createElement('span');
    badge.className = 'dice-badge';
    badge.textContent = text;
    // Ensure positioning works even if the cell is not set to relative already.
    const cs = window.getComputedStyle(cell);
    if (cs.position === 'static') cell.style.position = 'relative';
    cell.appendChild(badge);
    setTimeout(() => {
      if (badge.parentNode) badge.parentNode.removeChild(badge);
    }, 1500);
  }

  function onClick(e) {
    const cell = e.target.closest('.detail-stat-cell, .stat-cell');
    if (!cell) return;
    // Avoid nested click weirdness if user clicked the badge itself.
    if (e.target.classList && e.target.classList.contains('dice-badge')) return;
    const { label, value } = readCell(cell);
    const roll = d6();
    showBadge(cell, captionFor(label, value, roll));
  }

  App.hooks.bootstrap.push(function () {
    document.addEventListener('click', onClick);
  });
})();
