// ui/faction-filter.js — populates the top-level faction <select>.
(function () {
  const UI = window.UI = window.UI || {};

  UI.updateFactionFilter = function (factions, options = {}) {
    const hide   = options.hide   || new Set();
    const extras = options.extras || [];
    const filter = document.getElementById('army-faction-select');
    const current = filter.value;
    filter.innerHTML = '<option value="all">All Factions</option>';
    const names = new Set();
    (factions || []).forEach(f => {
      if (!hide.has(f.factionName)) names.add(f.factionName);
    });
    extras.forEach(n => names.add(n));
    [...names]
      .sort((a, b) => a.localeCompare(b))
      .forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        filter.appendChild(opt);
      });
    if ([...filter.options].some(o => o.value === current)) {
      filter.value = current;
    }
  };
})();
