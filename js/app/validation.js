// app/validation.js — advisory 10e composition checks (Rule of Three, warlord).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  function ensureBanner() {
    let banner = document.getElementById('validation-banner');
    if (banner) return banner;
    const toolbar = document.querySelector('.army-toolbar');
    if (!toolbar) return null;
    banner = document.createElement('div');
    banner.id = 'validation-banner';
    banner.className = 'validation-banner';
    banner.hidden = true;
    toolbar.parentNode.insertBefore(banner, toolbar);
    return banner;
  }

  function keywordsOf(entry) {
    const kws = (entry && entry.unitData && entry.unitData.keywords) || [];
    return kws.map(k => {
      if (typeof k === 'string') return k;
      if (k && typeof k === 'object') return k.name || k.keyword || '';
      return '';
    }).filter(Boolean);
  }

  function hasKeyword(entry, name) {
    const lower = name.toLowerCase();
    return keywordsOf(entry).some(k => k.toLowerCase() === lower);
  }

  function computeWarnings(army) {
    const warnings = [];
    const entries = (army && army.entries) || [];
    if (entries.length === 0) return warnings;

    const byName = new Map();
    entries.forEach(e => {
      const isBattleline = hasKeyword(e, 'Battleline');
      const isTransport  = hasKeyword(e, 'Dedicated Transport');
      if (isBattleline || isTransport) return;
      const name = e.unitName || (e.unitData && e.unitData.name) || '';
      if (!name) return;
      byName.set(name, (byName.get(name) || 0) + 1);
    });
    byName.forEach((count, name) => {
      if (count > 3) {
        warnings.push('Rule of Three: "' + name + '" appears ' + count + ' times (max 3).');
      }
    });

    const hasCharacter = entries.some(e => hasKeyword(e, 'Character'));
    if (!hasCharacter) {
      warnings.push('No Character in army (a warlord is required).');
    }

    return warnings;
  }

  function render(army) {
    const banner = ensureBanner();
    if (!banner) return;
    const warnings = computeWarnings(army);
    if (warnings.length === 0) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    banner.hidden = false;
    const items = warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    banner.innerHTML =
      '<div class="validation-banner-title">Composition warnings</div>' +
      '<ul class="validation-banner-list">' + items + '</ul>';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  App.hooks.bootstrap.push(function (state) {
    ensureBanner();
    if (state && state.currentArmy) render(state.currentArmy);
  });

  App.hooks.armyChange.push(function (army) {
    if (!App.state || !App.state.currentArmy) return;
    render(army || App.state.currentArmy);
  });
})();
