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

  // ── Loading progress bar (thin bar under header) ──────────────────────
  function setLoadProgress(done, total) {
    const wrap = document.getElementById('page-progress-wrap');
    const bar  = document.getElementById('page-progress-bar');
    const status     = document.getElementById('load-status');
    const statusText = document.getElementById('load-status-text');
    const statusCount= document.getElementById('load-status-count');

    if (total === 0) return;

    const pct = Math.round((done / total) * 100);
    wrap.hidden = false;
    bar.style.width = pct + '%';

    status.hidden = false;
    statusText.textContent = 'Loading factions';
    statusCount.textContent = `${done} / ${total}`;

    if (done >= total) {
      bar.style.width = '100%';
      setTimeout(() => {
        wrap.hidden = true;
        status.hidden = true;
      }, 800);
    }
  }

  // ── Faction filter dropdown ───────────────────────────────────────────
  function updateFactionFilter(factions) {
    const filter = document.getElementById('faction-filter');
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

  // ── Unit roster (left panel) ──────────────────────────────────────────
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
    card.dataset.unitId     = unit.id;
    card.dataset.factionName = unit._factionName || '';

    const stats    = unit.stats    || {};
    const keywords = unit.keywords || [];
    const pts      = unit.points   || 0;

    card.innerHTML = `
      <div class="unit-card-header">
        <div class="unit-card-name">${escapeHtml(unit.name)}</div>
        <div class="unit-card-pts">${pts > 0 ? pts + ' pts' : '—'}</div>
      </div>
      <div class="unit-card-faction">${escapeHtml(unit._factionName || '')}</div>
      <div class="unit-card-stats">
        ${renderStatCell('M',  stats.M  || stats.MOVE              || '—')}
        ${renderStatCell('T',  stats.T  || stats.TOUGHNESS         || '—')}
        ${renderStatCell('SV', stats.SV || stats.SAVE              || '—')}
        ${renderStatCell('W',  stats.W  || stats.WOUNDS            || '—')}
        ${renderStatCell('LD', stats.LD || stats.LEADERSHIP        || '—')}
        ${renderStatCell('OC', stats.OC || stats.OBJECTIVE_CONTROL || '—')}
      </div>
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

    const statAliases = {
      M:  ['M','MOVE'],
      T:  ['T','TOUGHNESS'],
      SV: ['SV','SAVE'],
      W:  ['W','WOUNDS'],
      LD: ['LD','LEADERSHIP'],
      OC: ['OC','OBJECTIVE_CONTROL'],
    };

    const getStatVal = key => (statAliases[key] || [key]).map(a => stats[a]).find(v => v) || '—';

    let html = `<div class="unit-detail-content">`;

    // Header
    html += `
      <div class="detail-header">
        <div class="detail-name">${escapeHtml(unit.name)}</div>
        <div class="detail-meta">
          ${unit._factionName ? `<span class="detail-faction">${escapeHtml(unit._factionName)}</span>` : ''}
          ${unit.type ? `<span class="detail-type">${escapeHtml(unit.type)}</span>` : ''}
          ${unit.points ? `<span class="detail-pts">${unit.points} pts</span>` : ''}
        </div>
      </div>
    `;

    // Add to army
    html += `
      <div class="detail-add-section">
        <label class="form-label">Quantity</label>
        <div class="detail-add-row">
          <input type="number" id="detail-qty" class="form-input detail-qty-input" value="1" min="1" max="99" />
          <button class="btn btn-accent detail-add-btn" id="btn-detail-add">Add to Army</button>
        </div>
      </div>
    `;

    // Stats table
    const statKeys = ['M','T','SV','W','LD','OC'];
    const hasStats = statKeys.some(k => getStatVal(k) !== '—');
    if (hasStats) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Stats</div>
        <div class="detail-stats-row">
          ${statKeys.map(k => `<div class="detail-stat-cell"><span class="stat-name">${k}</span><span class="stat-value">${escapeHtml(getStatVal(k))}</span></div>`).join('')}
        </div>
      </div>`;
    }

    // Weapons
    if (weapons.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Weapons</div>
        <div class="detail-table-wrap">
          <table class="weapons-table">
            <thead><tr>
              <th>Name</th><th>Range</th><th>A</th><th>BS/WS</th><th>S</th><th>AP</th><th>D</th>
            </tr></thead>
            <tbody>`;
      weapons.forEach(w => {
        const isRanged = (w.type || '').toLowerCase().includes('ranged');
        html += `<tr>
          <td class="${isRanged ? 'weapon-type-ranged' : 'weapon-type-melee'}">${escapeHtml(w.name)}</td>
          <td>${escapeHtml(String(w.RANGE || w.RANGE_ || '—'))}</td>
          <td>${escapeHtml(String(w.A || w.ATTACKS || '—'))}</td>
          <td>${escapeHtml(String(w.BS || w.WS || w['BS/WS'] || '—'))}</td>
          <td>${escapeHtml(String(w.S || w.STRENGTH || '—'))}</td>
          <td>${escapeHtml(String(w.AP || '—'))}</td>
          <td>${escapeHtml(String(w.D || w.DAMAGE || '—'))}</td>
        </tr>`;
      });
      html += `</tbody></table></div></div>`;
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

    // Google Images search
    html += `
      <div class="detail-section detail-images-section">
        <div class="detail-section-title">Find Images</div>
        <p class="detail-images-desc">Search Google Images to see how this unit looks painted and on the battlefield.</p>
        <div class="detail-images-buttons">
          <button class="btn btn-outline detail-img-btn" id="btn-google-images"
            data-unit="${escapeHtml(unit.name)}">
            &#128269; Google Images
          </button>
          <button class="btn btn-outline detail-img-btn" id="btn-bing-images"
            data-unit="${escapeHtml(unit.name)}">
            &#128269; Bing Images
          </button>
        </div>
      </div>
    `;

    html += `</div>`; // .unit-detail-content

    // Replace content (keep empty placeholder in DOM but hidden)
    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    panel.insertAdjacentHTML('beforeend', html);

    // Wire image search buttons
    document.getElementById('btn-google-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open(
        'https://www.google.com/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature') + '&tbm=isch',
        'yaab_images',
        'width=1200,height=800,scrollbars=yes,resizable=yes'
      );
    });
    document.getElementById('btn-bing-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open(
        'https://www.bing.com/images/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature'),
        'yaab_images',
        'width=1200,height=800,scrollbars=yes,resizable=yes'
      );
    });
  }

  function clearUnitDetail() {
    const panel = document.getElementById('unit-detail-panel');
    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = '';
  }

  // ── Army list (center panel) ──────────────────────────────────────────
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

    document.getElementById('points-current').textContent    = total;
    document.getElementById('points-limit-display').textContent = limit;
    document.getElementById('points-bar-pct').textContent    = Math.round(pct) + '%';
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
      li.innerHTML = 'No units added yet.<br/>Click a unit, then &ldquo;Add to Army&rdquo;.';
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
    const pts = entry.unitData.points || 0;
    li.innerHTML = `
      <div class="army-entry-name" title="${escapeHtml(entry.unitName)}">${escapeHtml(entry.customName || entry.unitName)}</div>
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

  function setUploadDragDrop(onFiles) {
    const panel = document.getElementById('panel-left');
    const area  = document.getElementById('upload-area');

    function highlight() { panel.classList.add('drag-over'); }
    function unhighlight(){ panel.classList.remove('drag-over'); }

    panel.addEventListener('dragover',  e => { e.preventDefault(); highlight(); });
    panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) unhighlight(); });
    panel.addEventListener('drop', e => {
      e.preventDefault();
      unhighlight();
      const files = [...(e.dataTransfer.files || [])].filter(f =>
        f.name.endsWith('.xml') || f.name.endsWith('.cat')
      );
      if (files.length > 0) onFiles(files);
      else toast('Please drop .xml or .cat files', 'warning');
    });
  }

  return {
    init,
    toast,
    setLoadProgress,
    updateFactionFilter,
    renderUnitRoster,
    createUnitCard,
    renderUnitDetail,
    clearUnitDetail,
    renderArmyList,
    createArmyEntryEl,
    showLoadModal,
    hideLoadModal,
    showImportModal,
    hideImportModal,
    escapeHtml,
    setUploadDragDrop,
  };
})();
