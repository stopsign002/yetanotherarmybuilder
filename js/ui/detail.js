// ui/detail.js — right-panel unit detail, rule detail, and Led-By index cache.
(function () {
  const UI = window.UI = window.UI || {};

  // Lazy reverse-index: unitNameLower -> Set<leaderUnitObj>. Rebuilt only when
  // state.factionsVersion advances (i.e. a new faction was loaded).
  let _ledByCache = null;
  let _ledByVersion = -1;

  // Weapon-keyword color class resolver. Matches by lowercase prefix or
  // exact lowercase name. Falls through to default (no class = neutral gray).
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

  function buildLedByIndex(allUnits) {
    const idx = new Map();
    for (let i = 0; i < allUnits.length; i++) {
      const leader = allUnits[i];
      const abilities = leader.abilities || [];
      for (let j = 0; j < abilities.length; j++) {
        const a = abilities[j];
        const desc = a && a.description;
        if (!desc || !/can be attached to/i.test(desc)) continue;
        const attachText = desc.replace(/^.*?can be attached to[^:]*:/i, '').trim();
        const names = attachText.split(/[,■\n●•]+/);
        for (let k = 0; k < names.length; k++) {
          const n = names[k].trim().toLowerCase();
          if (!n) continue;
          let bucket = idx.get(n);
          if (!bucket) { bucket = []; idx.set(n, bucket); }
          // Dedupe per leader (same leader may list the unit multiple times).
          if (bucket[bucket.length - 1] !== leader) bucket.push(leader);
        }
      }
    }
    return idx;
  }

  function getLedByFor(unit) {
    const state = UI._state;
    if (!state) return [];
    const version = state.factionsVersion || 0;
    if (_ledByCache === null || _ledByVersion !== version) {
      _ledByCache = buildLedByIndex(state.allUnits || []);
      _ledByVersion = version;
    }
    const bucket = _ledByCache.get(unit.name.toLowerCase());
    if (!bucket) return [];
    const out = [];
    for (let i = 0; i < bucket.length; i++) {
      const u = bucket[i];
      if (u.id === unit.id) continue;
      out.push({ name: u.name, factionName: u._factionName });
    }
    return out;
  }

  UI.renderUnitDetail = function (unit, detachmentEnhancements = [], selectedEnhancements = []) {
    const esc = UI.escapeHtml;
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const stats        = unit.stats        || {};
    const weapons      = unit.weapons      || [];
    const abilities    = unit.abilities    || [];
    const keywords     = unit.keywords     || [];
    const wargearOpts  = unit.wargearOptions || [];
    const squadOptions = unit.squadOptions || (unit.points ? [{ pts: unit.points, models: null }] : []);

    const getStatVal = key => (UI._STAT_ALIASES[key] || [key]).map(a => stats[a]).find(v => v) || '—';

    let html = `<div class="unit-detail-content unit-detail-datasheet" data-detail-kind="unit">`;

    const ptsOpts = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const subtitleParts = [];
    if (unit._factionName) subtitleParts.push(`<span class="detail-faction">${esc(unit._factionName)}</span>`);
    if (unit.type)         subtitleParts.push(`<span class="detail-type">${esc(unit.type)}</span>`);

    // Render unit-flavor blurb when unit.description is empty and a matching
    // App.UNIT_FLAVOR entry exists (case-insensitive substring match on name).
    let flavorHtml = '';
    if (!unit.description && window.App && App.UNIT_FLAVOR) {
      const lcName = String(unit.name || '').toLowerCase();
      let flavor = null;
      for (const key in App.UNIT_FLAVOR) {
        if (lcName.indexOf(key) !== -1) { flavor = App.UNIT_FLAVOR[key]; break; }
      }
      if (flavor) {
        flavorHtml = `<div class="detail-flavor" style="font-style:italic;font-size:12px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(flavor)}</div>`;
      }
    }

    html += `
      <div class="detail-header detail-banner">
        <div class="detail-header-main">
          <div class="detail-name">${esc(unit.name)}</div>
          ${flavorHtml}
          <div class="detail-meta detail-banner-subtitle">
            ${subtitleParts.join('')}
          </div>
        </div>
        <div class="detail-header-actions detail-banner-actions">
          ${ptsOpts.length > 0 ? `<span class="detail-pts detail-banner-pts">${ptsOpts.join(' / ')} pts</span>` : ''}
          ${(window.App && App.hooks && App.hooks.detailActions || []).map(a =>
            `<button class="detail-action-btn" data-action-id="${esc(a.id)}" title="${esc(a.title || '')}">${a.html || esc(a.label || '')}</button>`
          ).join('')}
          <button class="btn-google-search" id="btn-google-images" data-unit="${esc(unit.name)}" title="Search Google Images">
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    const hasSquadChoice = squadOptions.length > 1;
    html += `
      <div class="detail-add-section">
        <div class="detail-add-row">
          ${hasSquadChoice ? `
            <select class="form-select detail-squad-select" id="detail-squad-select">
              ${squadOptions.map((opt, i) => {
                const label = opt.models ? `${opt.models} models — ${opt.pts} pts` : `${opt.pts} pts`;
                return `<option value="${i}">${esc(label)}</option>`;
              }).join('')}
            </select>
          ` : `<span class="detail-pts-label">${squadOptions[0] ? squadOptions[0].pts + ' pts' : '—'}</span>`}
          <input type="number" id="detail-qty" class="form-input detail-qty-input" value="1" min="1" max="99" />
          <button class="btn btn-accent detail-add-btn" id="btn-detail-add">Add to Army</button>
        </div>
      </div>
    `;

    const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
    const presentStats = STAT_ORDER.filter(k => getStatVal(k) !== '—');

    if (presentStats.length > 0) {
      const renderPillar = k => {
        const v = getStatVal(k);
        if (k === 'SV' && unit.invulnSave && v !== '—') {
          return `<div class="detail-stat-cell detail-stat-pillar detail-stat-pillar-sv">
            <span class="stat-name detail-stat-pillar-label">SV</span>
            <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
            <span class="detail-stat-pillar-invuln">${esc(String(unit.invulnSave))} INV</span>
          </div>`;
        }
        return `<div class="detail-stat-cell detail-stat-pillar">
          <span class="stat-name detail-stat-pillar-label">${esc(k)}</span>
          <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
        </div>`;
      };

      html += `<div class="detail-section detail-stats-section">
        <div class="detail-stats-row detail-stat-strip" style="grid-template-columns:repeat(${presentStats.length},1fr)">
          ${presentStats.map(renderPillar).join('')}
        </div>
      </div>`;
    }

    if (weapons.length > 0) {
      const ranged = weapons.filter(w => {
        const tn = (w._typeName || '').toLowerCase();
        return tn.includes('ranged') || (!tn.includes('melee') && w.Range !== 'Melee');
      });
      const melee = weapons.filter(w => {
        const tn = (w._typeName || '').toLowerCase();
        return tn.includes('melee') || w.Range === 'Melee';
      });

      const renderWeaponTable = (list, type) => {
        if (list.length === 0) return '';
        const COLS = type === 'ranged'
          ? ['Range', 'A', 'BS', 'S', 'AP', 'D', 'Keywords']
          : ['Range', 'A', 'WS', 'S', 'AP', 'D', 'Keywords'];
        const allCols = new Set();
        list.forEach(w => Object.keys(w).forEach(k => { if (k !== 'name' && k !== '_typeName' && k !== '_keywordDefs') allCols.add(k); }));
        const cols = COLS.filter(c => allCols.has(c));

        const label = type === 'ranged' ? 'Ranged Weapons' : 'Melee Weapons';
        const numericCols = new Set(['Range', 'A', 'BS', 'WS', 'S', 'AP', 'D']);
        return `
          <div class="weapons-subsection weapons-section">
            <div class="weapons-subsection-title weapons-section-banner weapons-section-banner-${type} ${type}">${label}</div>
            <div class="detail-table-wrap weapons-table-wrap">
              <table class="weapons-table weapons-datasheet-table">
                <thead><tr>
                  <th class="weapons-col-name">Name</th>${cols.map(c => `<th class="${numericCols.has(c) ? 'weapons-col-num' : 'weapons-col-kw'}">${esc(c)}</th>`).join('')}
                </tr></thead>
                <tbody>
                  ${list.map(w => `<tr>
                    <td class="weapon-type-${type} weapons-col-name">${esc(w.name)}</td>
                    ${cols.map(c => {
                      if (c === 'Keywords' && w[c]) {
                        const kws = String(w[c]).split(',').map(k => k.trim()).filter(Boolean);
                        return `<td class="weapon-keywords-cell weapons-col-kw">${kws.map(k => {
                          const d = w._keywordDefs && w._keywordDefs[k];
                          const colorClass = weaponKwClass(k);
                          const classes = 'weapon-kw-tag'
                            + (d ? ' has-tooltip' : '')
                            + (colorClass ? ' ' + colorClass : '');
                          return `<span class="${classes}"${d ? ` data-tooltip="${esc(d)}"` : ''}>${esc(k)}</span>`;
                        }).join('')}</td>`;
                      }
                      const cellClass = numericCols.has(c) ? 'weapons-col-num' : '';
                      return `<td class="${cellClass}">${esc(String(w[c] != null ? w[c] : '—'))}</td>`;
                    }).join('')}
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      };

      html += `<div class="detail-section detail-weapons-section">
        <div class="detail-section-title">Weapons</div>
        ${renderWeaponTable(ranged, 'ranged')}
        ${renderWeaponTable(melee, 'melee')}
      </div>`;
    }

    const coreAbilities    = abilities.filter(a => a.isCore);
    const leaderAbilities  = abilities.filter(a => !a.isCore && /can be attached to/i.test(a.description));
    const regularAbilities = abilities.filter(a => !a.isCore && !/can be attached to/i.test(a.description));

    if (coreAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Core Abilities</div>
        <div class="core-abilities-list">
          ${coreAbilities.map(a => `<span class="core-ability-tag"${a.description ? ` data-tooltip="${esc(a.description)}"` : ''}>${esc(a.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    if (leaderAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title detail-section-title-leader">Leader</div>`;
      leaderAbilities.forEach(ab => {
        const attachText = ab.description.replace(/^.*?can be attached to.*?:/i, '').trim();
        const unitList = attachText
          .split(/[■\n●•]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (unitList.length > 0) {
          html += `<div class="detail-leader-units">
            <span class="detail-ability-name">Can lead:</span>
            <div class="detail-leader-list">
              ${unitList.map(u => `<span class="leader-unit-tag">${esc(u)}</span>`).join('')}
            </div>
          </div>`;
        } else {
          html += `<div class="detail-ability">
            <span class="detail-ability-name">${esc(ab.name)}:</span>
            <span class="detail-ability-desc">${esc(ab.description || '—')}</span>
          </div>`;
        }
      });
      html += `</div>`;
    }

    // "Led By" uses the memoized reverse-index. Collapsed by default: first
    // 3 leaders visible + "+N more" pill; click section header or pill to expand.
    const ledBy = getLedByFor(unit);
    if (ledBy.length > 0) {
      const extra = ledBy.length - 3;
      const collapsed = ledBy.length > 3;
      html += `<div class="detail-section detail-ledby-section">
        <div class="detail-section-title detail-section-title-ledbby detail-ledby-title"${collapsed ? ' role="button" tabindex="0"' : ''}>Led By</div>
        <div class="detail-ledby-list${collapsed ? ' collapsed' : ''}">
          ${ledBy.map(l => `<span class="ledby-tag">${esc(l.name)}</span>`).join('')}
          ${collapsed ? `<span class="ledby-more-pill" role="button" tabindex="0">+${extra} more</span>` : ''}
        </div>
      </div>`;
    }

    if (regularAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Abilities</div>`;
      regularAbilities.forEach(ab => {
        html += `<div class="detail-ability">
          <span class="detail-ability-name">${esc(ab.name)}:</span>
          <span class="detail-ability-desc">${esc(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    }

    const modelNums = [...new Set(squadOptions.map(o => o.models).filter(m => m != null))].sort((a, b) => a - b);
    const compLabel = modelNums.length === 0 ? null
      : modelNums.length === 1 ? `${modelNums[0]} model${modelNums[0] !== 1 ? 's' : ''}`
      : `${modelNums[0]}–${modelNums[modelNums.length - 1]} models`;

    const modelTypeOpts = wargearOpts.filter(o => o.type === 'model');
    const choiceOpts    = wargearOpts.filter(o => o.type !== 'model');

    if (compLabel || wargearOpts.length > 0) {
      html += `<div class="detail-section"><div class="detail-section-title">Loadout</div>`;

      if (compLabel) {
        html += `<div class="wl-composition">${esc(compLabel)}</div>`;
      }

      modelTypeOpts.forEach(opt => {
        let countStr = '';
        if (opt.modelMin != null && opt.modelMax != null) {
          countStr = opt.modelMin === opt.modelMax
            ? `${opt.modelMin} model${opt.modelMin !== 1 ? 's' : ''}`
            : `${opt.modelMin}–${opt.modelMax} models`;
        } else if (opt.modelMax != null) {
          countStr = `up to ${opt.modelMax} model${opt.modelMax !== 1 ? 's' : ''}`;
        } else if (opt.modelMin != null) {
          countStr = `${opt.modelMin}+ models`;
        }

        html += `<div class="wl-model-block"><div class="wl-model-header">
          <span class="wl-model-name">${esc(opt.modelName)}</span>`;
        if (countStr) html += `<span class="wl-model-count">${esc(countStr)}</span>`;
        html += `</div>`;

        if (opt.defaultWeapons && opt.defaultWeapons.length > 0) {
          html += `<div class="wl-defaults">
            <span class="wl-defaults-label">Default:</span>
            <span class="wl-defaults-weapons">${opt.defaultWeapons.map(esc).join(' · ')}</span>
          </div>`;
        }

        (opt.subOptions || []).forEach(sub => {
          const subCtx = sub.max === 1 ? ' — choose one' : sub.max > 1 ? ` — choose up to ${sub.max}` : '';
          html += `<div class="wl-suboption">
            <div class="wl-suboption-title">${esc(sub.name)}${subCtx}</div>
            <ul class="wl-choice-list">`;
          (sub.choices || []).forEach(c => {
            html += `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`;
          });
          html += `</ul></div>`;
        });

        html += `</div>`;
      });

      choiceOpts.forEach(opt => {
        const name    = typeof opt === 'object' ? (opt.name || '') : opt;
        const choices = typeof opt === 'object' && opt.choices ? opt.choices : [];
        const maxSpan = typeof opt === 'object' && opt.max != null
          ? ` <span class="wl-max">(max ${opt.max})</span>` : '';
        html += `<div class="wl-choice-group">
          <div class="wl-choice-group-title">${esc(name)}${maxSpan}</div>`;
        if (choices.length > 0) {
          html += `<ul class="wl-choice-list">`;
          choices.forEach(c => { html += `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`; });
          html += `</ul>`;
        }
        html += `</div>`;
      });

      html += `</div>`;
    }

    if (keywords.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Keywords</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${keywords.map(k => `<span class="keyword-tag">${esc(k)}</span>`).join('')}
        </div>
      </div>`;
    }

    if (detachmentEnhancements && detachmentEnhancements.length > 0) {
      const selectedNames = new Set((selectedEnhancements || []).map(e => e.name));
      // 10e rule: enhancements require the Character keyword on the recipient.
      // Conservative: only mark ineligible when the keyword is clearly missing;
      // never hide (users may want to see what exists in the detachment).
      const isCharacter = (unit.keywords || []).some(k => String(k).toLowerCase() === 'character');
      html += `<div class="detail-section" id="detail-enhancements-section">
        <div class="detail-section-title">Enhancements</div>
        <div class="detail-enhancements-list">`;
      detachmentEnhancements.forEach(enh => {
        const checked = selectedNames.has(enh.name) ? ' checked' : '';
        const ineligClass = isCharacter ? '' : ' enhancement-ineligible';
        html += `<label class="enhancement-cb-item${ineligClass}"${!isCharacter ? ' title="Character-only"' : ''}>
          <input type="checkbox" class="enhancement-cb" value="${esc(enh.name)}"${checked}
            data-enh-pts="${enh.pts || 0}" data-enh-name="${esc(enh.name)}" data-enh-desc="${esc(enh.description || '')}"/>
          <span class="enh-cb-body">
            <span class="enh-cb-header">
              <span class="enh-cb-name">${esc(enh.name)}</span>
              <span class="enh-cb-pts">${enh.pts ? enh.pts + ' pts' : ''}</span>
            </span>
            <span class="enh-cb-desc">${esc(enh.description || '')}</span>
            ${!isCharacter ? '<span class="enh-cb-ineligible-note">Character-only</span>' : ''}
          </span>
        </label>`;
      });
      html += `</div></div>`;
    }

    html += `</div>`;

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    panel.insertAdjacentHTML('beforeend', html);

    document.getElementById('btn-google-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open('https://www.google.com/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature') + '&tbm=isch', 'yaab_img');
    });

    // Wire hook-registered detail action buttons.
    const actions = (window.App && App.hooks && App.hooks.detailActions) || [];
    panel.querySelectorAll('.detail-action-btn').forEach(btn => {
      const id = btn.dataset.actionId;
      const action = actions.find(a => a.id === id);
      if (action && typeof action.onClick === 'function') {
        btn.addEventListener('click', () => action.onClick(unit));
      }
    });

    // Led-By: clicking the section title or "+N more" pill toggles collapse.
    const ledbyList = panel.querySelector('.detail-ledby-list');
    if (ledbyList) {
      const expand = () => ledbyList.classList.remove('collapsed');
      const toggle = () => ledbyList.classList.toggle('collapsed');
      const title = panel.querySelector('.detail-ledby-title');
      if (title) {
        title.addEventListener('click', toggle);
        title.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
      const pill = panel.querySelector('.ledby-more-pill');
      if (pill) {
        pill.addEventListener('click', e => { e.stopPropagation(); expand(); });
        pill.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); }
        });
      }
    }
  };

  UI.renderRuleDetail = function (data) {
    const esc = UI.escapeHtml;
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();

    const isEnhancement = data.type === 'enhancement';
    const body = `<p style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(data.description || 'No description available.')}</p>`;

    panel.insertAdjacentHTML('beforeend', `
      <div class="unit-detail-content unit-detail-rule" data-detail-kind="rule">
        <div class="detail-header detail-banner detail-banner-rule">
          <div class="detail-header-main">
            <div class="detail-name">${esc(data.name)}</div>
            <div class="detail-meta detail-banner-subtitle">
              <span class="detail-rule-kind">${isEnhancement ? 'Enhancement' : 'Army Rule'}</span>
            </div>
          </div>
          ${isEnhancement && data.pts ? `<div class="detail-header-actions detail-banner-actions"><span class="detail-pts detail-banner-pts">${esc(String(data.pts))} pts</span></div>` : ''}
        </div>
        <div class="detail-section">
          <div class="detail-section-title">${isEnhancement ? 'Enhancement' : 'Rule'}</div>
          ${body}
        </div>
      </div>
    `);
  };

  UI.clearUnitDetail = function () {
    const panel = document.getElementById('unit-detail-panel');
    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = '';
  };
})();
