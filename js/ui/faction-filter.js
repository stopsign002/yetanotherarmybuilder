// ui/faction-filter.js — populates the top-level faction <select> with alliance optgroups.
(function () {
  const UI = window.UI = window.UI || {};

  // Known alliance prefixes (matched case-insensitively against the first
  // " - "-separated component). Factions not matching fall into "Other".
  const ALLIANCES = ['Imperium', 'Chaos', 'Xenos'];

  function splitAlliance(name) {
    const idx = name.indexOf(' - ');
    if (idx === -1) return { alliance: null, rest: name };
    const head = name.slice(0, idx).trim();
    const match = ALLIANCES.find(a => a.toLowerCase() === head.toLowerCase());
    if (!match) return { alliance: null, rest: name };
    return { alliance: match, rest: name.slice(idx + 3).trim() };
  }

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

    // Bucket into alliance groups (plus a catch-all "Other").
    const groups = { Imperium: [], Chaos: [], Xenos: [], Other: [] };
    [...names].forEach(name => {
      const { alliance, rest } = splitAlliance(name);
      const bucket = alliance ? groups[alliance] : groups.Other;
      bucket.push({ value: name, label: alliance ? rest : name });
    });

    const order = ['Imperium', 'Chaos', 'Xenos', 'Other'];
    order.forEach(groupName => {
      const items = groups[groupName];
      if (!items.length) return;
      items.sort((a, b) => a.label.localeCompare(b.label));
      const og = document.createElement('optgroup');
      og.label = groupName;
      items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.value;
        opt.textContent = it.label;
        og.appendChild(opt);
      });
      filter.appendChild(og);
    });

    if ([...filter.options].some(o => o.value === current)) {
      filter.value = current;
    }
  };
})();
