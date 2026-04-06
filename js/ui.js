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

  function setLoadProgress(done, total) {
    const wrap      = document.getElementById('page-progress-wrap');
    const bar       = document.getElementById('page-progress-bar');
    const status    = document.getElementById('load-status');
    const spinner   = document.getElementById('load-spinner');
    const statusText= document.getElementById('load-status-text');
    const statusCount=document.getElementById('load-status-count');

    if (total === 0) return;
    const pct = Math.round((done / total) * 100);

    wrap.hidden = false;
    bar.style.width = pct + '%';
    status.hidden = false;

    if (done >= total) {
      // Show completion state
      bar.style.width = '100%';
      if (spinner) spinner.style.display = 'none';
      statusText.textContent = 'All Factions Loaded';
      statusCount.textContent = `(${total})`;
      status.classList.add('load-complete');

      // Fade out after 10 seconds
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
          if (spinner) spinner.style.display = '';
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

  // ── Faction rules in army panel ───────────────────────────────────────
  function updateFactionRules(faction) {
    const section  = document.getElementById('army-rules-section');
    const list     = document.getElementById('army-rules-list');
    if (!section || !list) return;

    const rules = (faction && faction.factionAbilities) || [];
    if (rules.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    list.innerHTML = '';
    rules.forEach(rule => {
      const item = document.createElement('div');
      item.className = 'army-rule-item';
      item.dataset.ruleName = rule.name;
      item.dataset.ruleDesc = rule.description || '';
      item.innerHTML = `<span>${escapeHtml(rule.name)}</span><span class="rule-arrow">&#9656;</span>`;
      list.appendChild(item);
    });
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

    const stats    = unit.stats    || {};
    const weapons  = unit.weapons  || [];
    const abilities= unit.abilities|| [];
    const keywords = unit.keywords || [];
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
        <div class="detail-name">${escapeHtml(unit.name)}</div>
        <div class="detail-meta">
          ${unit._factionName ? `<span class="detail-faction">${escapeHtml(unit._factionName)}</span>` : ''}
          ${unit.type ? `<span class="detail-type">${escapeHtml(unit.type)}</span>` : ''}
          ${ptsOpts.length > 0 ? `<span class="detail-pts">${ptsOpts.join(' / ')} pts</span>` : ''}
        </div>
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
      html += `<div class="detail-section">
        <div class="detail-section-title">Stats</div>
        <div class="detail-stats-row" style="grid-template-columns:repeat(${presentStats.length},1fr)">
          ${presentStats.map(k => `<div class="detail-stat-cell"><span class="stat-name">${escapeHtml(k)}</span><span class="stat-value">${escapeHtml(String(getStatVal(k)))}</span></div>`).join('')}
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
        list.forEach(w => Object.keys(w).forEach(k => { if (k !== 'name' && k !== '_typeName') allCols.add(k); }));
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
                    ${cols.map(c => `<td>${escapeHtml(String(w[c] != null ? w[c] : '—'))}</td>`).join('')}
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

    // Abilities
    if (abilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Abilities</div>`;
      abilities.forEach(ab => {
        html += `<div class="detail-ability">
          <span class="detail-ability-name">${escapeHtml(ab.name)}:</span>
          <span class="detail-ability-desc">${escapeHtml(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
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

    // Google / Bing image search
    html += `
      <div class="detail-section detail-images-section">
        <div class="detail-section-title">Find Images</div>
        <p class="detail-images-desc">Search for how this unit looks painted and on the battlefield.</p>
        <div class="detail-images-buttons">
          <button class="btn btn-outline detail-img-btn" id="btn-google-images" data-unit="${escapeHtml(unit.name)}">
            &#128269; Google
          </button>
          <button class="btn btn-outline detail-img-btn" id="btn-bing-images" data-unit="${escapeHtml(unit.name)}">
            &#128269; Bing
          </button>
        </div>
      </div>
    `;

    html += `</div>`; // .unit-detail-content

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    panel.insertAdjacentHTML('beforeend', html);

    // Wire image search buttons
    document.getElementById('btn-google-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open('https://www.google.com/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature') + '&tbm=isch', 'yaab_img');
    });
    document.getElementById('btn-bing-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open('https://www.bing.com/images/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature'), 'yaab_img');
    });
  }

  // ── Show a rule/ability in the details panel ──────────────────────────
  function renderRuleDetail(name, description) {
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();

    panel.insertAdjacentHTML('beforeend', `
      <div class="unit-detail-content">
        <div class="detail-header">
          <div class="detail-name">${escapeHtml(name)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section-title">Rule</div>
          <p style="font-size:13px;line-height:1.6;color:var(--text-muted)">${escapeHtml(description || 'No description available.')}</p>
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
      ? `${entry.unitName} <span class="army-entry-squad">(${entry.squadLabel})</span>`
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
