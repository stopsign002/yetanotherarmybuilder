// ui/datasheet-parts.js — shared datasheet fragments (stats, weapons, abilities,
// keywords). Lifted verbatim from detail.js so its output is unchanged.
// Must load BEFORE detail.js and cards-mode.js. All functions return HTML strings.
//
//   UI.ds.statsTable(modelStats, opts)
//     modelStats: array of stat dicts ({name?, M, T, SV|Sv, W, LD, OC}); when
//       empty/absent, opts.stats (single dict) is used as one nameless profile.
//     opts: { stats, invulnSave, invulnNote }  -> stat-strip section markup
//       ('' when no stat is present).
//   UI.ds.weaponRows(weapons, opts)
//     weapons: flat row list ({name, Range, A, BS|WS, S, AP, D, Keywords,
//       _keywordDefs}). opts: { type: 'ranged'|'melee' } -> one banner + rows
//       sub-section ('' for an empty list). Keyword chips get weapon-kw colour
//       classes, tooltips (_keywordDefs) and glossary hooks.
//   UI.ds.abilityList(abilities, opts)
//     abilities: [{name, description, isCore, _typeName}]. opts.kind:
//       'core'    -> Core Abilities tag section
//       'regular' -> "Abilities" section (core/sub/leader-prose rows excluded)
//       'sub'     -> one section per choose-from-N typeName group
//     Returns '' when nothing to show. UI.ds.splitAbilities(abilities) returns
//     {core, regular, leader, subGroups:Map} for callers that need the buckets
//     (e.g. the "Can lead" merge reads `leader`).
//   UI.ds.keywordChips(keywords, opts)
//     opts: { title: 'Keywords' } -> Keywords section markup.
//   UI.ds.weaponKwClass(raw) -> colour class for a weapon keyword.
(function () {
  const UI = window.UI = window.UI || {};
  const ds = UI.ds = UI.ds || {};

  function weaponKwClass(raw) {
    const kw = (raw || '').trim().toLowerCase();
    if (!kw) return '';
    if (kw.startsWith('anti-'))       return 'weapon-kw-red';
    if (kw === 'lethal hits')         return 'weapon-kw-red';
    if (kw === 'devastating wounds')  return 'weapon-kw-red';
    if (kw.startsWith('sustained hits')) return 'weapon-kw-orange';
    if (kw === 'melta' || kw.startsWith('melta '))  return 'weapon-kw-orange';
    if (kw === 'assault')             return 'weapon-kw-blue';
    if (kw === 'pistol')              return 'weapon-kw-blue';
    if (kw.startsWith('rapid fire'))  return 'weapon-kw-blue';
    if (kw === 'heavy')               return 'weapon-kw-blue';
    if (kw === 'twin-linked' || kw === 'twin linked') return 'weapon-kw-purple';
    if (kw === 'torrent')             return 'weapon-kw-purple';
    return '';
  }
  ds.weaponKwClass = weaponKwClass;

  const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];

  ds.statsTable = function (modelStats, opts) {
    opts = opts || {};
    const esc = UI.escapeHtml;
    const unit = opts;
    const profilesToRender = (Array.isArray(modelStats) && modelStats.length > 0)
      ? modelStats
      : [{ name: '', ...(opts.stats || {}) }];

    const presentStats = STAT_ORDER.filter(k =>
      profilesToRender.some(p => {
        const aliases = UI._STAT_ALIASES[k] || [k];
        return aliases.some(a => p[a]);
      })
    );
    if (presentStats.length === 0) return '';

    const renderPillar = (k, prof) => {
      const aliases = UI._STAT_ALIASES[k] || [k];
      const v = aliases.map(a => prof[a]).find(x => x) || '—';
      if (k === 'SV' && unit.invulnSave && v !== '—') {
        return `<div class="detail-stat-cell detail-stat-pillar detail-stat-pillar-sv">
            <span class="stat-name detail-stat-pillar-label">SV</span>
            <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
            <span class="detail-stat-pillar-invuln">${esc(String(unit.invulnSave))}${unit.invulnNote ? '*' : ''} INV</span>
          </div>`;
      }
      return `<div class="detail-stat-cell detail-stat-pillar">
          <span class="stat-name detail-stat-pillar-label">${esc(k)}</span>
          <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
        </div>`;
    };

    let html = `<div class="detail-section detail-stats-section">`;
    profilesToRender.forEach(prof => {
      const label = profilesToRender.length > 1 && prof.name
        ? `<div class="detail-stat-rowlabel" style="font-size:11px;color:var(--text-muted);margin:4px 0 2px">${esc(prof.name)}</div>`
        : '';
      html += label;
      html += `<div class="detail-stats-row detail-stat-strip" style="grid-template-columns:repeat(${presentStats.length},1fr)">
            ${presentStats.map(k => renderPillar(k, prof)).join('')}
          </div>`;
    });
    if (unit.invulnSave && unit.invulnNote) {
      html += `<div class="detail-invuln-note" style="font-size:11px;color:var(--text-muted);margin-top:2px">* ${esc(String(unit.invulnNote))}</div>`;
    }
    html += `</div>`;
    return html;
  };

  ds.weaponRows = function (list, opts) {
    opts = opts || {};
    const esc = UI.escapeHtml;
    const type = opts.type === 'melee' ? 'melee' : 'ranged';
    if (!list || list.length === 0) return '';
    const skill = type === 'ranged' ? 'BS' : 'WS';
    const STATS = ['Range', 'A', skill, 'S', 'AP', 'D'];
    const HDR   = ['Rng', 'A', skill, 'S', 'AP', 'D'];
    const label = type === 'ranged' ? 'Ranged Weapons' : 'Melee Weapons';

    const rows = list.map((w, i) => {
      const cells = STATS.map(c => {
        let v = w[c];
        v = (v != null && v !== '') ? String(v) : '—';
        const melee = c === 'Range' && v.toLowerCase() === 'melee';
        return `<span class="wg-cell${melee ? ' wg-cell-melee' : ''}">${esc(v)}</span>`;
      }).join('');
      const kws = w.Keywords
        ? String(w.Keywords).split(',').map(k => k.trim()).filter(Boolean)
        : [];
      const kwHtml = kws.length
        ? `<div class="wg-kw-row">${kws.map(k => {
            const d = w._keywordDefs && w._keywordDefs[k];
            const colorClass = weaponKwClass(k);
            const classes = 'weapon-kw-tag'
              + (d ? ' has-tooltip' : '')
              + (colorClass ? ' ' + colorClass : '');
            const gl = UI.glossary && UI.glossary.lookup(k);
            return `<button type="button" class="${classes}"${d ? ` data-tooltip="${esc(d)}"` : ''}${gl ? ` data-glossary="${gl.id}"` : ''}>${esc(k)}</button>`;
          }).join('')}</div>`
        : '';
      return `<div class="wg-weapon${i % 2 === 1 ? ' wg-weapon-alt' : ''}">
            <div class="wg-line">
              <span class="wg-name">${esc(w.name)}</span>
              ${cells}
            </div>
            ${kwHtml}
          </div>`;
    }).join('');

    return `
          <div class="weapons-subsection weapons-section wg-section">
            <div class="weapons-subsection-title weapons-section-banner weapons-section-banner-${type} ${type} wg-banner">
              <span class="wg-banner-label">${label}</span>
              ${HDR.map(h => `<span class="wg-cell wg-banner-col">${esc(h)}</span>`).join('')}
            </div>
            <div class="wg-box wg-box-attached">
              <div class="wg-rows">${rows}</div>
            </div>
          </div>`;
  };

  // Sub-abilities: children of choose-from-N hero toggles carry a non-standard
  // typeName (Primarch..., Wrathful Presence, Triarch Abilities).
  const STD_AB_TN = new Set(['', 'abilities', 'leader', 'invulnerable save', 'damaged']);
  function subAbilityKey(a) {
    if (!a || !a._typeName) return null;
    const tn = String(a._typeName).trim();
    if (STD_AB_TN.has(tn.toLowerCase())) return null;
    if (/^primarch\b/i.test(tn)) return 'PRIMARCH';
    return tn.toUpperCase();
  }

  ds.splitAbilities = function (abilities) {
    abilities = abilities || [];
    const subGroups = new Map();
    abilities.forEach(a => {
      if (a.isCore) return;
      const key = subAbilityKey(a);
      if (!key) return;
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key).push(a);
    });
    const isSub = (a) => !!subAbilityKey(a);
    return {
      core:    abilities.filter(a => a.isCore),
      leader:  abilities.filter(a => !a.isCore && !isSub(a) && /can be attached to/i.test(a.description)),
      regular: abilities.filter(a => !a.isCore && !isSub(a) && !/can be attached to/i.test(a.description)),
      subGroups,
    };
  };

  ds.abilityList = function (abilities, opts) {
    opts = opts || {};
    const esc = UI.escapeHtml;
    const parts = ds.splitAbilities(abilities);
    const kind = opts.kind || 'regular';
    let html = '';
    if (kind === 'core') {
      if (parts.core.length === 0) return '';
      return `<div class="detail-section">
        <div class="detail-section-title">Core Abilities</div>
        <div class="core-abilities-list">
          ${parts.core.map(a => { const gl = UI.glossary && UI.glossary.lookup(a.name); return `<button type="button" class="core-ability-tag"${a.description ? ` data-tooltip="${UI.mdPlain(a.description)}"` : ''}${gl ? ` data-glossary="${gl.id}"` : ''}>${esc(a.name)}</button>`; }).join('')}
        </div>
      </div>`;
    }
    if (kind === 'regular') {
      if (parts.regular.length === 0) return '';
      html += `<div class="detail-section">
        <div class="detail-section-title">Abilities</div>`;
      parts.regular.forEach(ab => {
        html += `<div class="detail-ability">
          <span class="detail-ability-name">${esc(ab.name)}</span>
          <span class="detail-ability-desc">${UI.mdBold(ab.description || '—')}</span>
        </div>`;
      });
      return html + `</div>`;
    }
    parts.subGroups.forEach((rows, label) => {
      const friendlyLabel = label.charAt(0) + label.slice(1).toLowerCase();
      html += `<div class="detail-section detail-section-primarch">
        <div class="detail-section-title detail-section-title-primarch">${esc(friendlyLabel)} <span class="detail-primarch-hint">pick from these each turn</span></div>`;
      rows.forEach(ab => {
        html += `<div class="detail-ability detail-ability-primarch">
          <span class="detail-ability-name">${esc(ab.name)}</span>
          <span class="detail-ability-desc">${UI.mdBold(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    });
    return html;
  };

  ds.keywordChips = function (keywords, opts) {
    opts = opts || {};
    const esc = UI.escapeHtml;
    if (!keywords || keywords.length === 0) return '';
    return `<div class="detail-section">
        <div class="detail-section-title">${esc(opts.title || 'Keywords')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${keywords.map(k => `<span class="keyword-tag">${esc(k)}</span>`).join('')}
        </div>
      </div>`;
  };
})();
