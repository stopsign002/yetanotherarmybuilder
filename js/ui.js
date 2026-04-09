/**
 * ui.js - All UI rendering and interaction logic
 */

window.UI = (() => {

  let _state = null;

  function init(state) {
    _state = state;
  }

  // ── Toast notifications ───────────────────────────────────────────────
  function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
    }, duration);
  }

  // ── Loading progress bar ──────────────────────────────────────────────
  let _loadCompleteTimer = null;
  let _loadingComplete   = false;  // once set, never re-show the loading bar

  function setLoadProgress(done, total) {
    if (_loadingComplete) return;

    const wrap       = document.getElementById('page-progress-wrap');
    const bar        = document.getElementById('page-progress-bar');
    const status     = document.getElementById('load-status');
    const spinner    = document.getElementById('load-spinner');
    const statusText = document.getElementById('load-status-text');
    const statusCount= document.getElementById('load-status-count');

    if (total === 0) return;
    const pct = Math.round((done / total) * 100);

    wrap.hidden = false;
    bar.style.width = pct + '%';
    status.hidden = false;

    if (done >= total) {
      _loadingComplete = true;

      bar.style.width = '100%';
      if (spinner) spinner.style.display = 'none';
      statusText.textContent = 'All Factions Loaded';
      statusCount.textContent = `(${total})`;
      status.classList.add('load-complete');

      clearTimeout(_loadCompleteTimer);
      _loadCompleteTimer = setTimeout(() => {
        wrap.style.transition = 'opacity 1s ease';
        status.style.transition = 'opacity 1s ease';
        wrap.style.opacity = '0';
        status.style.opacity = '0';
        setTimeout(() => {
          wrap.hidden = true;
          status.hidden = true;
          wrap.style.opacity = '';
          wrap.style.transition = '';
          status.style.opacity = '';
          status.style.transition = '';
          status.classList.remove('load-complete');
        }, 1000);
      }, 10000);
    } else {
      clearTimeout(_loadCompleteTimer);
      if (spinner) spinner.style.display = '';
      status.classList.remove('load-complete');
      statusText.textContent = 'Loading factions';
      statusCount.textContent = `${done} / ${total}`;
    }
  }

  // ── Faction filter dropdown (army panel) ──────────────────────────────
  function updateFactionFilter(factions) {
    const filter = document.getElementById('army-faction-select');
    const current = filter.value;
    filter.innerHTML = '<option value="all">All Factions</option>';
    if (factions && factions.length > 0) {
      const sorted = [...factions].sort((a, b) => a.factionName.localeCompare(b.factionName));
      sorted.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.factionName;
        opt.textContent = f.factionName;
        filter.appendChild(opt);
      });
      if ([...filter.options].some(o => o.value === current)) {
        filter.value = current;
      }
    }
  }

  // ── Faction rules in army panel (two sections: Army Rules + Stratagems) ─
  function updateFactionRules(faction) {
    const section      = document.getElementById('army-rules-section');
    const armySubsec   = document.getElementById('army-rules-subsection');
    const stratSubsec  = document.getElementById('army-stratagem-subsection');
    const armyList     = document.getElementById('army-rules-list');
    const stratList    = document.getElementById('army-stratagems-list');
    if (!section || !armyList || !stratList) return;

    const rules      = (faction && faction.armyRules)  || [];
    const stratagems = (faction && faction.stratagems) || [];

    if (rules.length === 0 && stratagems.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    // Army Rules sub-section
    if (rules.length > 0) {
      armySubsec.hidden = false;
      armyList.innerHTML = '';
      rules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'army-rule-item';
        item.dataset.ruleName = rule.name;
        item.dataset.ruleDesc = rule.description || '';
        item.dataset.ruleType = 'rule';
        item.innerHTML = `<span>${escapeHtml(rule.name)}</span><span class="rule-arrow">&#9656;</span>`;
        armyList.appendChild(item);
      });
    } else {
      armySubsec.hidden = true;
    }

    // Stratagems sub-section
    if (stratagems.length > 0) {
      stratSubsec.hidden = false;
      stratList.innerHTML = '';
      stratagems.forEach(strat => {
        const item = document.createElement('div');
        item.className = 'army-rule-item stratagem-item';
        item.dataset.ruleName = strat.name;
        item.dataset.ruleDesc = strat.description || '';
        item.dataset.ruleType = 'stratagem';
        if (strat.cp)     item.dataset.ruleCp     = strat.cp;
        if (strat.when)   item.dataset.ruleWhen   = strat.when;
        if (strat.target) item.dataset.ruleTarget = strat.target;
        if (strat.effect) item.dataset.ruleEffect = strat.effect;
        const cpBadge = strat.cp ? `<span class="stratagem-cp-badge">${escapeHtml(strat.cp)} CP</span>` : '';
        item.innerHTML = `<span>${escapeHtml(strat.name)}</span><span class="rule-item-right">${cpBadge}<span class="rule-arrow">&#9656;</span></span>`;
        stratList.appendChild(item);
      });
    } else {
      stratSubsec.hidden = true;
    }
  }

  // ── Unit roster (center panel) ────────────────────────────────────────
  function renderUnitRoster(units, searchTerm, factionFilter, selectedUnitId) {
    const grid  = document.getElementById('unit-grid');
    const badge = document.getElementById('unit-count-badge');
    const empty = document.getElementById('roster-empty');

    let filtered = units || [];
    if (factionFilter && factionFilter !== 'all') {
      filtered = filtered.filter(u => u._factionName === factionFilter);
    }
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(s) ||
        (u.keywords || []).some(k => k.toLowerCase().includes(s)) ||
        (u._factionName || '').toLowerCase().includes(s)
      );
    }

    badge.textContent = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;
    [...grid.querySelectorAll('.unit-card')].forEach(c => c.remove());

    if (filtered.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    filtered.forEach(unit => {
      const card = createUnitCard(unit, unit.id === selectedUnitId);
      grid.appendChild(card);
    });
  }

  function createUnitCard(unit, isSelected) {
    const card = document.createElement('div');
    card.className = 'unit-card' + (isSelected ? ' selected' : '');
    card.dataset.unitId      = unit.id;
    card.dataset.factionName = unit._factionName || '';

    const stats    = unit.stats    || {};
    const keywords = unit.keywords || [];

    // Resolve 10th ed stats — handle BSData mixed capitalisation (Sv, Ld, etc.)
    const STAT_ALIASES = { SV: ['SV','Sv','sv'], LD: ['LD','Ld'], OC: ['OC'] };
    const resolvedStats = {};
    ['M','T','W'].forEach(k => { if (stats[k] != null) resolvedStats[k] = stats[k]; });
    Object.entries(STAT_ALIASES).forEach(([canonical, aliases]) => {
      const found = aliases.find(a => stats[a] != null && stats[a] !== '');
      if (found) resolvedStats[canonical] = stats[found];
    });
    // Combine primary save + invuln into "3+/4+" format
    if (unit.invulnSave && resolvedStats['SV']) {
      resolvedStats['SV'] = resolvedStats['SV'] + '/' + unit.invulnSave;
    }
    const CARD_STAT_PREF = ['M','T','SV','W','LD','OC'];
    const cardStats = CARD_STAT_PREF.filter(k => resolvedStats[k] != null && resolvedStats[k] !== '').slice(0, 6);

    // Points display — show all options
    const ptsOpts   = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const ptsDisplay = ptsOpts.length > 1
      ? ptsOpts.join(' / ') + ' pts'
      : ptsOpts.length === 1 ? ptsOpts[0] + ' pts' : '—';

    card.innerHTML = `
      <div class="unit-card-header">
        <div class="unit-card-name">${escapeHtml(unit.name)}</div>
        <div class="unit-card-pts">${ptsDisplay}</div>
      </div>
      <div class="unit-card-faction">${escapeHtml(unit._factionName || '')}</div>
      <div class="unit-card-stats" style="grid-template-columns:repeat(${cardStats.length || 6},1fr)">
        ${cardStats.length > 0 ? cardStats.map(k => renderStatCell(k, resolvedStats[k])).join('') : renderStatCell('—','—')}</div>
      ${keywords.length > 0 ? `<div class="unit-card-keywords">${
        keywords.slice(0, 4).map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join('')
        }${keywords.length > 4 ? `<span class="keyword-tag">+${keywords.length - 4}</span>` : ''
      }</div>` : ''}
    `;
    return card;
  }

  function renderStatCell(label, value) {
    return `<div class="stat-cell"><span class="stat-name">${label}</span><span class="stat-value">${escapeHtml(String(value))}</span></div>`;
  }

  // ── Unit detail panel (right panel) ──────────────────────────────────
  function renderUnitDetail(unit) {
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const stats        = unit.stats        || {};
    const weapons      = unit.weapons      || [];
    const abilities    = unit.abilities    || [];
    const keywords     = unit.keywords     || [];
    const wargearOpts  = unit.wargearOptions || [];
    const squadOptions = unit.squadOptions || (unit.points ? [{ pts: unit.points, models: null }] : []);

    // Stat aliases for BSData mixed capitalisation
    const statAliases = {
      M:  ['M'],
      T:  ['T'],
      SV: ['SV','Sv','sv'],
      W:  ['W'],
      LD: ['LD','Ld'],
      OC: ['OC'],
    };
    const getStatVal = key => (statAliases[key] || [key]).map(a => stats[a]).find(v => v) || '—';

    let html = `<div class="unit-detail-content">`;

    // Header
    const ptsOpts = unit.pointsOptions || (unit.points ? [unit.points] : []);
    html += `
      <div class="detail-header">
        <div class="detail-header-main">
          <div class="detail-name">${escapeHtml(unit.name)}</div>
          <div class="detail-meta">
            ${unit._factionName ? `<span class="detail-faction">${escapeHtml(unit._factionName)}</span>` : ''}
            ${unit.type ? `<span class="detail-type">${escapeHtml(unit.type)}</span>` : ''}
            ${ptsOpts.length > 0 ? `<span class="detail-pts">${ptsOpts.join(' / ')} pts</span>` : ''}
          </div>
        </div>
        <button class="btn-google-search" id="btn-google-images" data-unit="${escapeHtml(unit.name)}" title="Search Google Images">
          <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        </button>
      </div>
    `;

    // Add to army — with squad size selector if multiple options
    const hasSquadChoice = squadOptions.length > 1;
    html += `
      <div class="detail-add-section">
        <div class="detail-add-row">
          ${hasSquadChoice ? `
            <select class="form-select detail-squad-select" id="detail-squad-select">
              ${squadOptions.map((opt, i) => {
                const label = opt.models ? `${opt.models} models — ${opt.pts} pts` : `${opt.pts} pts`;
                return `<option value="${i}">${escapeHtml(label)}</option>`;
              }).join('')}
            </select>
          ` : `<span class="detail-pts-label">${squadOptions[0] ? squadOptions[0].pts + ' pts' : '—'}</span>`}
          <input type="number" id="detail-qty" class="form-input detail-qty-input" value="1" min="1" max="99" />
          <button class="btn btn-accent detail-add-btn" id="btn-detail-add">Add to Army</button>
        </div>
      </div>
    `;

    // Stats table — 10th ed only
    const STAT_ORDER = ['M','T','SV','W','LD','OC'];
    const presentStats = STAT_ORDER.filter(k => getStatVal(k) !== '—');

    if (presentStats.length > 0) {
      // Combine primary save + invuln save into "3+/4+" display
      const displayVal = k => {
        const v = getStatVal(k);
        if (k === 'SV' && unit.invulnSave && v !== '—') return v + '/' + unit.invulnSave;
        return v;
      };
      const displayLabel = k => k === 'SV' && unit.invulnSave ? 'SV / INV' : k;

      html += `<div class="detail-section">
        <div class="detail-section-title">Stats</div>
        <div class="detail-stats-row" style="grid-template-columns:repeat(${presentStats.length},1fr)">
          ${presentStats.map(k => `<div class="detail-stat-cell"><span class="stat-name">${escapeHtml(displayLabel(k))}</span><span class="stat-value">${escapeHtml(String(displayVal(k)))}</span></div>`).join('')}
        </div>
      </div>`;
    }

    // Weapons — split into Ranged and Melee sections
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
          ? ['Range','A','BS','S','AP','D','Keywords']
          : ['Range','A','WS','S','AP','D','Keywords'];
        const allCols = new Set();
        list.forEach(w => Object.keys(w).forEach(k => { if (k !== 'name' && k !== '_typeName' && k !== '_keywordDefs') allCols.add(k); }));
        const cols = COLS.filter(c => allCols.has(c));

        const label = type === 'ranged' ? 'Ranged Weapons' : 'Melee Weapons';
        return `
          <div class="weapons-subsection">
            <div class="weapons-subsection-title ${type}">${label}</div>
            <div class="detail-table-wrap">
              <table class="weapons-table">
                <thead><tr>
                  <th>Name</th>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}
                </tr></thead>
                <tbody>
                  ${list.map(w => `<tr>
                    <td class="weapon-type-${type}">${escapeHtml(w.name)}</td>
                    ${cols.map(c => {
                      if (c === 'Keywords' && w[c]) {
                        const kws = String(w[c]).split(',').map(k => k.trim()).filter(Boolean);
                        return `<td class="weapon-keywords-cell">${kws.map(k => {
                          const d = w._keywordDefs && w._keywordDefs[k];
                          return `<span class="weapon-kw-tag${d ? ' has-tooltip' : ''}"${d ? ` data-kw-tip="${escapeHtml(d)}"` : ''}>${escapeHtml(k)}</span>`;
                        }).join('')}</td>`;
                      }
                      return `<td>${escapeHtml(String(w[c] != null ? w[c] : '—'))}</td>`;
                    }).join('')}
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      };

      html += `<div class="detail-section">
        <div class="detail-section-title">Weapons</div>
        ${renderWeaponTable(ranged, 'ranged')}
        ${renderWeaponTable(melee, 'melee')}
      </div>`;
    }

    // Separate abilities into core (system rules) / leader / regular
    const coreAbilities    = abilities.filter(a => a.isCore);
    const leaderAbilities  = abilities.filter(a => !a.isCore && /can be attached to/i.test(a.description));
    const regularAbilities = abilities.filter(a => !a.isCore && !/can be attached to/i.test(a.description));

    // Core Abilities section — system-wide rules like Deep Strike, Fights First
    if (coreAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Core Abilities</div>
        <div class="core-abilities-list">
          ${coreAbilities.map(a => `<span class="core-ability-tag">${escapeHtml(a.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    // Leader section — what units this model can lead
    if (leaderAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title detail-section-title-leader">Leader</div>`;
      leaderAbilities.forEach(ab => {
        // Parse the "can be attached to" text, splitting on bullet points
        const attachText = ab.description.replace(/^.*?can be attached to.*?:/i, '').trim();
        const unitList = attachText
          .split(/[■\n●•]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (unitList.length > 0) {
          html += `<div class="detail-leader-units">
            <span class="detail-ability-name">Can lead:</span>
            <div class="detail-leader-list">
              ${unitList.map(u => `<span class="leader-unit-tag">${escapeHtml(u)}</span>`).join('')}
            </div>
          </div>`;
        } else {
          html += `<div class="detail-ability">
            <span class="detail-ability-name">${escapeHtml(ab.name)}:</span>
            <span class="detail-ability-desc">${escapeHtml(ab.description || '—')}</span>
          </div>`;
        }
      });
      html += `</div>`;
    }

    // "Led By" section — any unit whose leader ability mentions this unit by name
    const unitNameLower = unit.name.toLowerCase();
    const ledBy = (_state && _state.allUnits || [])
      .filter(u => u.id !== unit.id &&
        (u.abilities || []).some(a =>
          /can be attached to/i.test(a.description) &&
          a.description.toLowerCase().includes(unitNameLower)
        )
      )
      .map(u => ({ name: u.name, factionName: u._factionName }));

    if (ledBy.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title detail-section-title-ledbby">Led By</div>
        <div class="detail-ledby-list">
          ${ledBy.map(l => `<span class="ledby-tag">${escapeHtml(l.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    // Abilities
    if (regularAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Abilities</div>`;
      regularAbilities.forEach(ab => {
        html += `<div class="detail-ability">
          <span class="detail-ability-name">${escapeHtml(ab.name)}:</span>
          <span class="detail-ability-desc">${escapeHtml(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // Wargear Options — bullet list matching real card format
    if (wargearOpts.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Wargear Options</div>
        <ul class="wargear-option-list">`;
      wargearOpts.forEach(opt => {
        const name = typeof opt === 'object' ? opt.name : opt;
        const choices = (typeof opt === 'object' && opt.choices) ? opt.choices : [];
        html += `<li class="wargear-option-item">${escapeHtml(name)}`;
        if (choices.length > 0) {
          html += `<ul class="wargear-choice-list">${
            choices.map(c => {
              const cn = typeof c === 'object' ? c.name : c;
              return `<li>${escapeHtml(cn)}</li>`;
            }).join('')
          }</ul>`;
        }
        html += `</li>`;
      });
      html += `</ul></div>`;
    }

    // Keywords
    if (keywords.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Keywords</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${keywords.map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join('')}
        </div>
      </div>`;
    }

    html += `</div>`; // .unit-detail-content

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    panel.insertAdjacentHTML('beforeend', html);

    // Wire Google image search button (header top-right)
    document.getElementById('btn-google-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open('https://www.google.com/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature') + '&tbm=isch', 'yaab_img');
    });
  }

  // ── Show a rule/stratagem in the details panel ────────────────────────
  function renderRuleDetail(data) {
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();

    const isStratagem = data.type === 'stratagem';

    let body = '';
    if (isStratagem) {
      if (data.cp)     body += `<div class="strat-detail-row"><span class="strat-label">CP Cost:</span> <span class="strat-value strat-cp">${escapeHtml(data.cp)}</span></div>`;
      if (data.when)   body += `<div class="strat-detail-row"><span class="strat-label">When:</span> <span class="strat-value">${escapeHtml(data.when)}</span></div>`;
      if (data.target) body += `<div class="strat-detail-row"><span class="strat-label">Target:</span> <span class="strat-value">${escapeHtml(data.target)}</span></div>`;
      if (data.effect) body += `<div class="strat-detail-row"><span class="strat-label">Effect:</span> <span class="strat-value">${escapeHtml(data.effect)}</span></div>`;
      if (data.description && !data.effect) {
        body += `<p style="font-size:13px;line-height:1.6;color:var(--text-muted)">${escapeHtml(data.description)}</p>`;
      }
    } else {
      body = `<p style="font-size:13px;line-height:1.6;color:var(--text-muted)">${escapeHtml(data.description || 'No description available.')}</p>`;
    }

    panel.insertAdjacentHTML('beforeend', `
      <div class="unit-detail-content">
        <div class="detail-header">
          <div class="detail-name">${escapeHtml(data.name)}</div>
          ${isStratagem && data.cp ? `<div class="detail-meta"><span class="detail-pts stratagem-cp-hero">${escapeHtml(data.cp)} CP</span></div>` : ''}
        </div>
        <div class="detail-section">
          <div class="detail-section-title">${isStratagem ? 'Stratagem' : 'Rule'}</div>
          ${body}
        </div>
      </div>
    `);
  }

  function clearUnitDetail() {
    const panel = document.getElementById('unit-detail-panel');
    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = '';
  }

  // ── Army list (left panel) ────────────────────────────────────────────
  function renderArmyList(army) {
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
    document.getElementById('points-bar-pct').textContent      = Math.round(pct) + '%';
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
      list.appendChild(createArmyEntryEl(entry, index));
    });
  }

  function createArmyEntryEl(entry, index) {
    const li = document.createElement('li');
    li.className = 'army-entry';
    li.dataset.index = index;
    const pts = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
    const nameDisplay = entry.squadLabel
      ? `${escapeHtml(entry.unitName)} <span class="army-entry-squad">(${escapeHtml(entry.squadLabel)})</span>`
      : escapeHtml(entry.unitName);
    li.innerHTML = `
      <div class="army-entry-name" title="${escapeHtml(entry.unitName)}">${nameDisplay}</div>
      <div class="army-entry-pts">${pts}</div>
      <div class="army-entry-qty">
        <input type="number" value="${entry.count}" min="0" max="99" data-index="${index}" class="army-qty-input" />
      </div>
      <div class="army-entry-total">${pts * entry.count}</div>
      <button class="army-entry-remove" data-index="${index}" title="Remove">&times;</button>
    `;
    return li;
  }

  // ── Load army modal ───────────────────────────────────────────────────
  function showLoadModal(armies) {
    const list = document.getElementById('saved-army-list');
    list.innerHTML = '';

    if (!armies || armies.length === 0) {
      list.innerHTML = '<li class="saved-army-empty">No saved armies found.</li>';
    } else {
      armies.forEach(army => {
        const li = document.createElement('li');
        li.className = 'saved-army-item';
        const total = army.getTotalPoints ? army.getTotalPoints() : 0;
        const date  = army.updatedAt ? new Date(army.updatedAt).toLocaleDateString() : '';
        li.innerHTML = `
          <div class="saved-army-info">
            <div class="saved-army-name">${escapeHtml(army.name)}</div>
            <div class="saved-army-meta">${total} pts &bull; ${army.entries.length} unit${army.entries.length !== 1 ? 's' : ''}${date ? ' &bull; ' + date : ''}</div>
          </div>
          <div class="saved-army-actions">
            <button class="btn btn-sm btn-accent btn-load-saved"   data-id="${army.id}">Load</button>
            <button class="btn btn-sm btn-outline btn-delete-saved" data-id="${army.id}">Delete</button>
          </div>
        `;
        list.appendChild(li);
      });
    }

    document.getElementById('modal-load').removeAttribute('hidden');
  }

  function hideLoadModal() {
    document.getElementById('modal-load').setAttribute('hidden', '');
  }

  // ── Import modal ──────────────────────────────────────────────────────
  function showImportModal() {
    document.getElementById('import-json-textarea').value = '';
    document.getElementById('modal-import').removeAttribute('hidden');
    setTimeout(() => document.getElementById('import-json-textarea').focus(), 50);
  }

  function hideImportModal() {
    document.getElementById('modal-import').setAttribute('hidden', '');
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  return {
    init,
    toast,
    setLoadProgress,
    updateFactionFilter,
    updateFactionRules,
    renderUnitRoster,
    createUnitCard,
    renderUnitDetail,
    renderRuleDetail,
    clearUnitDetail,
    renderArmyList,
    createArmyEntryEl,
    showLoadModal,
    hideLoadModal,
    showImportModal,
    hideImportModal,
    escapeHtml,
  };
})();
