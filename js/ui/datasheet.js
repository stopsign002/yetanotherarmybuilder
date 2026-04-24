// ui/datasheet.js — GW-style datasheet rendering + print flow for single unit / whole army.
(function () {
  const UI = window.UI = window.UI || {};
  const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];

  function esc(s) { return UI.escapeHtml(s); }

  function getStatVal(stats, key) {
    const aliases = (UI._STAT_ALIASES && UI._STAT_ALIASES[key]) || [key];
    for (let i = 0; i < aliases.length; i++) {
      const v = stats[aliases[i]];
      if (v != null && v !== '') return v;
    }
    return '—';
  }

  function classifyWeapons(weapons) {
    const ranged = [], melee = [];
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const tn = (w._typeName || '').toLowerCase();
      if (tn.includes('melee') || w.Range === 'Melee') melee.push(w);
      else ranged.push(w);
    }
    return { ranged, melee };
  }

  function weaponColsPresent(list, preferred) {
    const present = new Set();
    list.forEach(w => {
      Object.keys(w).forEach(k => {
        if (k !== 'name' && k !== '_typeName' && k !== '_keywordDefs') present.add(k);
      });
    });
    return preferred.filter(c => present.has(c));
  }

  function renderWeaponsTable(list, kind) {
    if (!list.length) return '';
    const preferred = kind === 'ranged'
      ? ['Range', 'A', 'BS', 'S', 'AP', 'D', 'Keywords']
      : ['Range', 'A', 'WS', 'S', 'AP', 'D', 'Keywords'];
    const cols = weaponColsPresent(list, preferred);
    const title = kind === 'ranged' ? 'Ranged Weapons' : 'Melee Weapons';

    const headerCells = `<th class="ds-w-name">Name</th>` + cols.map(c => `<th>${esc(c)}</th>`).join('');
    const bodyRows = list.map(w => {
      const cells = cols.map(c => {
        if (c === 'Keywords' && w[c]) {
          const kws = String(w[c]).split(',').map(k => k.trim()).filter(Boolean);
          return `<td class="ds-w-keywords">${kws.map(k => {
            const d = w._keywordDefs && w._keywordDefs[k];
            return `<span class="ds-chip${d ? ' ds-chip-has-tip' : ''}"${d ? ` title="${esc(d)}"` : ''}>${esc(k)}</span>`;
          }).join('')}</td>`;
        }
        const v = w[c] != null && w[c] !== '' ? w[c] : '—';
        return `<td>${esc(String(v))}</td>`;
      }).join('');
      return `<tr><td class="ds-w-name">${esc(w.name)}</td>${cells}</tr>`;
    }).join('');

    return `
      <div class="ds-weapons-block">
        <div class="ds-subheading ds-subheading-${kind}">${title}</div>
        <table class="ds-table ds-weapons-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }

  function renderWargearList(wargearOpts) {
    if (!wargearOpts || !wargearOpts.length) return '';
    let html = `<ul class="ds-wargear-list">`;
    wargearOpts.forEach(opt => {
      if (opt.type === 'model') {
        let modelLabel;
        if (opt.perModels && opt.perModels > 1) {
          modelLabel = `1 per ${opt.perModels} models — ${opt.modelName}`;
        } else if (opt.modelMax != null) {
          modelLabel = `Up to ${opt.modelMax} ${opt.modelName}`;
        } else {
          modelLabel = opt.modelName || '';
        }
        html += `<li class="ds-wargear-item"><span class="ds-wargear-model">${esc(modelLabel)}</span> can be equipped with:`;
        (opt.subOptions || []).forEach(sub => {
          html += `<ul class="ds-wargear-sub">`;
          if (sub.name) html += `<li class="ds-wargear-sub-head">${esc(sub.name)}:</li>`;
          (sub.choices || []).forEach(c => {
            const cn = typeof c === 'object' ? c.name : c;
            html += `<li>${esc(cn)}</li>`;
          });
          html += `</ul>`;
        });
        html += `</li>`;
      } else {
        const name = typeof opt === 'object' ? (opt.name || '') : opt;
        const choices = (typeof opt === 'object' && opt.choices) ? opt.choices : [];
        const maxStr = (typeof opt === 'object' && opt.max != null) ? ` (max ${opt.max})` : '';
        html += `<li class="ds-wargear-item">${esc(name)}${esc(maxStr)}`;
        if (choices.length) {
          html += `<ul class="ds-wargear-sub">${choices.map(c => {
            const cn = typeof c === 'object' ? c.name : c;
            return `<li>${esc(cn)}</li>`;
          }).join('')}</ul>`;
        }
        html += `</li>`;
      }
    });
    html += `</ul>`;
    return html;
  }

  function pointsLabel(unit) {
    const opts = unit.pointsOptions && unit.pointsOptions.length
      ? unit.pointsOptions.slice().sort((a, b) => a - b)
      : (unit.points ? [unit.points] : []);
    if (!opts.length) return '';
    if (opts.length === 1) return opts[0] + ' pts';
    return opts[0] + '-' + opts[opts.length - 1] + ' pts';
  }

  UI.renderDatasheet = function (unit) {
    const root = document.createElement('div');
    root.className = 'datasheet';

    const stats        = unit.stats || {};
    const weapons      = unit.weapons || [];
    const abilities    = unit.abilities || [];
    const keywords     = unit.keywords || [];
    const wargearOpts  = unit.wargearOptions || [];

    const presentStats = STAT_ORDER.filter(k => getStatVal(stats, k) !== '—');
    const displayVal = k => {
      const v = getStatVal(stats, k);
      if (k === 'SV' && unit.invulnSave && v !== '—') return v + '/' + unit.invulnSave;
      return v;
    };
    const displayLabel = k => (k === 'SV' && unit.invulnSave) ? 'SV/INV' : k;

    const { ranged, melee } = classifyWeapons(weapons);
    const coreAbilities    = abilities.filter(a => a.isCore);
    const leaderAbilities  = abilities.filter(a => !a.isCore && /can be attached to/i.test(a.description || ''));
    const regularAbilities = abilities.filter(a => !a.isCore && !/can be attached to/i.test(a.description || ''));

    let html = '';

    // Title banner
    html += `
      <div class="ds-banner">
        <div class="ds-banner-left">
          <div class="ds-name">${esc(unit.name)}</div>
          <div class="ds-subtitle">
            ${unit._factionName ? `<span class="ds-faction">${esc(unit._factionName)}</span>` : ''}
            ${unit.type ? `<span class="ds-type">${esc(unit.type)}</span>` : ''}
          </div>
        </div>
        <div class="ds-banner-right">
          ${pointsLabel(unit) ? `<div class="ds-pts">${esc(pointsLabel(unit))}</div>` : ''}
        </div>
      </div>`;

    // Stat strip
    if (presentStats.length) {
      html += `<div class="ds-stats" style="grid-template-columns:repeat(${presentStats.length},1fr)">`;
      presentStats.forEach(k => {
        html += `<div class="ds-stat"><div class="ds-stat-label">${esc(displayLabel(k))}</div><div class="ds-stat-value">${esc(String(displayVal(k)))}</div></div>`;
      });
      html += `</div>`;
      if (unit.invulnSave) {
        html += `<div class="ds-footnote">Invulnerable Save: ${esc(unit.invulnSave)}</div>`;
      }
    }

    // Two-column body: left = weapons + wargear, right = abilities
    html += `<div class="ds-body">`;

    html += `<div class="ds-col ds-col-left">`;
    if (ranged.length || melee.length) {
      html += renderWeaponsTable(ranged, 'ranged');
      html += renderWeaponsTable(melee, 'melee');
    }
    if (wargearOpts.length) {
      html += `<div class="ds-block ds-wargear-block">
        <div class="ds-subheading">Wargear Options</div>
        ${renderWargearList(wargearOpts)}
      </div>`;
    }
    html += `</div>`;

    html += `<div class="ds-col ds-col-right">`;
    if (coreAbilities.length) {
      html += `<div class="ds-block">
        <div class="ds-subheading">Core</div>
        <div class="ds-chip-row">${coreAbilities.map(a =>
          `<span class="ds-chip ds-chip-core${a.description ? ' ds-chip-has-tip' : ''}"${a.description ? ` title="${esc(a.description)}"` : ''}>${esc(a.name)}</span>`
        ).join('')}</div>
      </div>`;
    }

    if (leaderAbilities.length) {
      html += `<div class="ds-block"><div class="ds-subheading">Leader</div>`;
      leaderAbilities.forEach(ab => {
        const attachText = (ab.description || '').replace(/^.*?can be attached to.*?:/i, '').trim();
        const unitList = attachText.split(/[■\n●•]+/).map(s => s.trim()).filter(Boolean);
        if (unitList.length) {
          html += `<div class="ds-leader">
            <div class="ds-ability-name">Can lead:</div>
            <div class="ds-chip-row">${unitList.map(u => `<span class="ds-chip">${esc(u)}</span>`).join('')}</div>
          </div>`;
        } else {
          html += `<div class="ds-ability">
            <span class="ds-ability-name">${esc(ab.name)}:</span>
            <span class="ds-ability-desc">${esc(ab.description || '—')}</span>
          </div>`;
        }
      });
      html += `</div>`;
    }

    if (regularAbilities.length) {
      html += `<div class="ds-block"><div class="ds-subheading">Abilities</div>`;
      regularAbilities.forEach(ab => {
        html += `<div class="ds-ability">
          <span class="ds-ability-name">${esc(ab.name)}:</span>
          <span class="ds-ability-desc">${esc(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;

    html += `</div>`; // ds-body

    // Keywords row
    if (keywords.length) {
      html += `<div class="ds-keywords">
        <span class="ds-keywords-label">Keywords:</span>
        <span class="ds-keywords-list">${keywords.map(k => `<span class="ds-chip ds-chip-keyword">${esc(k)}</span>`).join('')}</span>
      </div>`;
    }

    root.innerHTML = html;
    return root;
  };

  UI.renderArmyDatasheets = function (army) {
    const container = document.createElement('div');
    container.className = 'datasheet-container';

    // Cover page
    const cover = document.createElement('div');
    cover.className = 'datasheet-cover';
    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const limit = army.pointsLimit || 0;

    // Try to discover detachment name from App.state if available.
    let detachmentName = '';
    try {
      const sel = window.App && App.state && App.state.selectedDetachment;
      if (sel && sel.name) detachmentName = sel.name;
    } catch (_) { /* noop */ }

    cover.innerHTML = `
      <div class="ds-cover-inner">
        <div class="ds-cover-kicker">Warhammer 40,000 — Army Roster</div>
        <div class="ds-cover-title">${esc(army.name || 'Untitled Army')}</div>
        ${army.factionName ? `<div class="ds-cover-line">${esc(army.factionName)}</div>` : ''}
        ${detachmentName ? `<div class="ds-cover-line">Detachment: ${esc(detachmentName)}</div>` : ''}
        <div class="ds-cover-pts">${total} / ${limit} pts</div>
      </div>`;
    container.appendChild(cover);

    // Unique units by id
    const seen = new Set();
    const entries = army.entries || [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const u = entry.unitData;
      if (!u || !u.id || seen.has(u.id)) continue;
      seen.add(u.id);
      const ds = UI.renderDatasheet(u);
      ds.classList.add('datasheet-page');
      container.appendChild(ds);
    }
    return container;
  };

  function ensurePrintRoot() {
    let root = document.getElementById('print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'print-root';
      root.className = 'print-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function ensurePreviewBar() {
    let bar = document.getElementById('print-preview-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'print-preview-bar';
    bar.className = 'print-preview-bar';
    bar.innerHTML = `
      <div>
        <span class="print-preview-title">Print Preview</span>
        <span class="print-preview-hint"> &nbsp;&mdash;&nbsp; preview on screen before printing. Use your printer dialog to switch paper size or orientation.</span>
      </div>
      <div class="print-preview-actions">
        <button type="button" class="btn-print" id="print-preview-confirm">Print / Save as PDF</button>
        <button type="button" class="btn-close" id="print-preview-close">Close</button>
      </div>
    `;
    document.body.appendChild(bar);
    bar.querySelector('#print-preview-confirm').addEventListener('click', () => {
      try { window.print(); }
      catch (e) { console.warn('[datasheet.print]', e); closePreview(); }
    });
    bar.querySelector('#print-preview-close').addEventListener('click', closePreview);
    return bar;
  }

  function closePreview() {
    document.body.classList.remove('print-preview-open');
    const root = document.getElementById('print-root');
    if (root) root.innerHTML = '';
    document.removeEventListener('keydown', onPreviewKeydown);
    window.removeEventListener('afterprint', closePreview);
  }

  function onPreviewKeydown(e) {
    if (e.key === 'Escape') closePreview();
  }

  function openPreview(content) {
    const root = ensurePrintRoot();
    root.innerHTML = '';
    root.appendChild(content);
    ensurePreviewBar();
    document.body.classList.add('print-preview-open');
    document.addEventListener('keydown', onPreviewKeydown);
    window.addEventListener('afterprint', closePreview);
    root.scrollTop = 0;
  }

  UI.printUnitDatasheet = function (unit) {
    if (!unit) return;
    openPreview(UI.renderDatasheet(unit));
  };

  UI.printArmyDatasheets = function (army) {
    if (!army) return;
    openPreview(UI.renderArmyDatasheets(army));
  };

  // Register hook-driven buttons.
  if (window.App && App.hooks) {
    const printerSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';

    App.hooks.detailActions.push({
      id: 'print-datasheet',
      title: 'Print this unit datasheet',
      html: printerSvg,
      onClick: (unit) => UI.printUnitDatasheet(unit),
    });

  }

  // Exposed so events.js can wire the static #btn-print-army button.
  UI.printCurrentArmy = function () {
    const army = window.App && App.state && App.state.currentArmy;
    if (!army || !army.entries || !army.entries.length) {
      if (UI.toast) UI.toast('Add units first', 'warning');
      return;
    }
    UI.printArmyDatasheets(army);
  };
})();
