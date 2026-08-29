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
      // Count COPIES, not entries. `count` is how many of the datasheet this
      // entry represents, and the same three models warn or don't purely on
      // whether the user happens to have them stacked (addUnit merges plain
      // duplicates) or split across entries. kotc.js:87 already reads copies.
      byName.set(name, (byName.get(name) || 0) + (Number.isFinite(e.count) ? e.count : 1));
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

    alliedPointsWarnings(army, warnings);

    return warnings;
  }

  // yaab has no battle-size concept — only a free-integer pointsLimit — so map
  // it onto the three sizes 40kdc's allied points_limits are keyed by.
  function battleSizeFor(pointsLimit) {
    const n = Number(pointsLimit) || 2000;
    if (n <= 1000) return 'incursion';
    if (n <= 2000) return 'strike-force';
    return 'onslaught';
  }

  const SIZE_LABEL = {
    'incursion': 'Incursion',
    'strike-force': 'Strike Force',
    'onslaught': 'Onslaught',
  };

  // Advisory only: 11e allied rules (Daemonic Pact, Imperial Agents, …) cap how
  // many points of borrowed units a list may take, per battle size. Allied units
  // are stamped by js/data/dc-adapter.js and rendered by js/app/allies.js; the
  // limits live on the host faction's `alliedRules`. Rules that cap by KEYWORD
  // COUNT rather than points (Agents / Imperial Knights / Chaos Knights) are not
  // checked here — see the plan's phase 2.
  function alliedPointsWarnings(army, warnings) {
    const entries = (army && army.entries) || [];
    const state = App.state || {};
    const byLabel = new Map();   // ally label → points in list

    entries.forEach((e, i) => {
      const ud = e && e.unitData;
      if (!ud || !ud._allyOf) return;
      const label = ud._allyLabel || 'Allies';
      let pts = 0;
      try { pts = army.getEntryPoints(i) || 0; }
      catch (_) { pts = (e.selectedPts || 0) * (e.count || 0); }
      const cur = byLabel.get(label) || { pts: 0, host: ud._allyOf, ruleIds: new Set() };
      cur.pts += pts;
      (ud._allyRuleIds || []).forEach(id => cur.ruleIds.add(id));
      byLabel.set(label, cur);
    });
    if (!byLabel.size) return;

    const size = battleSizeFor(army && army.pointsLimit);
    byLabel.forEach((agg, label) => {
      const faction = (state.factions || []).find(f => f.factionName === agg.host);
      const rules = ((faction && faction.alliedRules) || [])
        .filter(r => agg.ruleIds.has(r.id) && Array.isArray(r.pointsLimits));
      if (!rules.length) return;
      // One entry can be granted by more than one rule; the most permissive cap
      // is the one that could legally be in force, so warn only past that.
      let cap = null, capRule = null;
      rules.forEach((r) => {
        const row = r.pointsLimits.find(p => p && p.battle_size === size);
        if (!row || row.max_points == null) return;
        if (cap === null || row.max_points > cap) { cap = row.max_points; capRule = r; }
      });
      if (cap === null || agg.pts <= cap) return;
      warnings.push(
        'Allied points: ' + agg.pts + ' pts of ' + label +
        ' (' + (capRule.name || capRule.id) + ') — limit ' + cap +
        ' at ' + (SIZE_LABEL[size] || size) + ' (' + (army.pointsLimit || 2000) + ' pts).'
      );
    });
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
