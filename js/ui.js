/**
 * ui.js - All UI rendering and interaction logic
 */

window.UI = (() => {

  // ── State reference (set by app.js) ──────────────────────────────────
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

  // ── Faction list (left panel) ─────────────────────────────────────────
  function renderFactionList(factions) {
    const list = document.getElementById('faction-list');
    const filter = document.getElementById('faction-filter');

    // Rebuild faction list
    list.innerHTML = '';
    if (!factions || factions.length === 0) {
      list.innerHTML = '<li class="faction-list-empty">No factions loaded yet.<br/>Upload a Battlescribe .cat or .xml file to get started.</li>';
    } else {
      factions.forEach(faction => {
        const li = document.createElement('li');
        li.className = 'faction-item';
        li.innerHTML = `
          <div class="faction-item-info">
            <div class="faction-item-name" title="${escapeHtml(faction.factionName)}">${escapeHtml(faction.factionName)}</div>
            <div class="faction-item-count">${faction.units.length} unit${faction.units.length !== 1 ? 's' : ''}</div>
          </div>
          <button class="faction-item-del" data-faction="${escapeHtml(faction.factionName)}" title="Remove faction">&times;</button>
        `;
        list.appendChild(li);
      });
    }

    // Rebuild faction filter dropdown
    const current = filter.value;
    filter.innerHTML = '<option value="all">All Factions</option>';
    if (factions && factions.length > 0) {
      factions.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.factionName;
        opt.textContent = f.factionName;
        filter.appendChild(opt);
      });
      // Restore selection if still valid
      if ([...filter.options].some(o => o.value === current)) {
        filter.value = current;
      }
    }
  }

  // ── Unit roster (center panel) ────────────────────────────────────────
  function renderUnitRoster(units, searchTerm, factionFilter) {
    const grid = document.getElementById('unit-grid');
    const badge = document.getElementById('unit-count-badge');
    const emptyEl = document.getElementById('roster-empty');

    // Filter
    let filtered = units || [];
    if (factionFilter && factionFilter !== 'all') {
      filtered = filtered.filter(u => u._factionName === factionFilter);
    }
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(s) ||
        (u.keywords || []).some(k => k.toLowerCase().includes(s))
      );
    }

    badge.textContent = `${filtered.length} unit${filtered.length !== 1 ? 's' : ''}`;

    // Clear all cards (keep empty placeholder)
    [...grid.querySelectorAll('.unit-card')].forEach(c => c.remove());

    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    filtered.forEach(unit => {
      const card = createUnitCard(unit);
      grid.appendChild(card);
    });
  }

  function createUnitCard(unit) {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.dataset.unitId = unit.id;
    card.dataset.factionName = unit._factionName || '';

    const stats = unit.stats || {};
    const keywords = unit.keywords || [];
    const pts = unit.points || 0;

    // Primary category label
    const primaryKw = keywords[0] || '';

    card.innerHTML = `
      <div class="unit-card-header">
        <div class="unit-card-name">${escapeHtml(unit.name)}</div>
        <div class="unit-card-pts">${pts > 0 ? pts + ' pts' : '—'}</div>
      </div>
      ${primaryKw ? `<div class="unit-card-keywords"><span class="keyword-tag">${escapeHtml(primaryKw)}</span></div>` : ''}
      <div class="unit-card-stats">
        ${renderStatCell('M', stats.M || stats.MOVE || '—')}
        ${renderStatCell('T', stats.T || stats.TOUGHNESS || '—')}
        ${renderStatCell('SV', stats.SV || stats.SAVE || '—')}
        ${renderStatCell('W', stats.W || stats.WOUNDS || '—')}
        ${renderStatCell('LD', stats.LD || stats.LEADERSHIP || '—')}
        ${renderStatCell('OC', stats.OC || stats.OBJECTIVE_CONTROL || '—')}
      </div>
      ${keywords.length > 1 ? `<div class="unit-card-keywords" style="margin-top:6px">${keywords.slice(1, 4).map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join('')}${keywords.length > 4 ? `<span class="keyword-tag">+${keywords.length - 4}</span>` : ''}</div>` : ''}
    `;

    return card;
  }

  function renderStatCell(label, value) {
    return `<div class="stat-cell"><span class="stat-name">${label}</span><span class="stat-value">${escapeHtml(String(value))}</span></div>`;
  }

  // ── Unit detail modal ─────────────────────────────────────────────────
  function showUnitModal(unit) {
    const modal = document.getElementById('modal-unit');
    const nameEl = document.getElementById('unit-modal-name');
    const bodyEl = document.getElementById('unit-modal-body');
    const qtyEl = document.getElementById('unit-modal-qty');

    nameEl.textContent = unit.name;
    qtyEl.value = 1;

    const stats = unit.stats || {};
    const weapons = unit.weapons || [];
    const abilities = unit.abilities || [];
    const keywords = unit.keywords || [];

    let html = '';

    // Meta
    html += `<div class="unit-detail-meta">`;
    if (unit.points) html += `<strong style="color:var(--accent)">${unit.points} pts</strong>`;
    if (unit._factionName) html += ` &nbsp;&bull;&nbsp; ${escapeHtml(unit._factionName)}`;
    if (unit.type) html += ` &nbsp;&bull;&nbsp; <em>${escapeHtml(unit.type)}</em>`;
    html += `</div>`;

    // Stats
    const statKeys = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
    const statAliases = { M: ['M','MOVE'], T: ['T','TOUGHNESS'], SV: ['SV','SAVE'], W: ['W','WOUNDS'], LD: ['LD','LEADERSHIP'], OC: ['OC','OBJECTIVE_CONTROL'] };
    const hasStats = statKeys.some(k => {
      const aliases = statAliases[k] || [k];
      return aliases.some(a => stats[a] && stats[a] !== '—');
    });

    if (hasStats) {
      html += `<div class="unit-stats-table">`;
      statKeys.forEach(key => {
        const aliases = statAliases[key] || [key];
        const val = aliases.map(a => stats[a]).find(v => v) || '—';
        html += `<div class="stat-cell"><span class="stat-name">${key}</span><span class="stat-value">${escapeHtml(String(val))}</span></div>`;
      });
      html += `</div>`;
    }

    // Weapons
    if (weapons.length > 0) {
      html += `<div class="weapons-section"><h4>Weapons</h4>`;
      html += `<table class="weapons-table"><thead><tr>
        <th>Name</th><th>Range</th><th>A</th><th>BS/WS</th><th>S</th><th>AP</th><th>D</th>
      </tr></thead><tbody>`;

      weapons.forEach(w => {
        const isRanged = (w.type || '').toLowerCase().includes('ranged');
        const nameClass = isRanged ? 'weapon-type-ranged' : 'weapon-type-melee';
        const range = w.RANGE || w.RANGE_ || '—';
        const attacks = w.A || w.ATTACKS || '—';
        const bsws = w.BS || w.WS || w['BS/WS'] || '—';
        const strength = w.S || w.STRENGTH || '—';
        const ap = w.AP || '—';
        const dmg = w.D || w.DAMAGE || '—';
        html += `<tr>
          <td class="${nameClass}">${escapeHtml(w.name)}</td>
          <td>${escapeHtml(String(range))}</td>
          <td>${escapeHtml(String(attacks))}</td>
          <td>${escapeHtml(String(bsws))}</td>
          <td>${escapeHtml(String(strength))}</td>
          <td>${escapeHtml(String(ap))}</td>
          <td>${escapeHtml(String(dmg))}</td>
        </tr>`;
      });

      html += `</tbody></table></div>`;
    }

    // Abilities
    if (abilities.length > 0) {
      html += `<div class="weapons-section"><h4>Abilities</h4>`;
      abilities.forEach(ab => {
        html += `<p style="margin-bottom:8px;font-size:12px"><strong>${escapeHtml(ab.name)}:</strong> ${escapeHtml(ab.description || '—')}</p>`;
      });
      html += `</div>`;
    }

    // Keywords
    if (keywords.length > 0) {
      html += `<div class="weapons-section"><h4>Keywords</h4>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
      keywords.forEach(k => {
        html += `<span class="keyword-tag">${escapeHtml(k)}</span>`;
      });
      html += `</div></div>`;
    }

    // Description
    if (unit.description) {
      html += `<div class="weapons-section"><h4>Notes</h4><p style="font-size:12px;color:var(--text-muted)">${escapeHtml(unit.description)}</p></div>`;
    }

    bodyEl.innerHTML = html;
    modal.removeAttribute('hidden');
    modal.dataset.unitId = unit.id;
    modal.dataset.unitFaction = unit._factionName || '';
  }

  function hideUnitModal() {
    document.getElementById('modal-unit').setAttribute('hidden', '');
  }

  // ── Army list (right panel) ───────────────────────────────────────────
  function renderArmyList(army) {
    if (!army) return;

    // Army name
    const nameInput = document.getElementById('army-name-input');
    if (document.activeElement !== nameInput) nameInput.value = army.name;

    // Points limit
    const limitInput = document.getElementById('points-limit-input');
    if (document.activeElement !== limitInput) limitInput.value = army.pointsLimit;

    // Points summary
    const total = army.getTotalPoints();
    const limit = army.pointsLimit || 0;
    const pct = limit > 0 ? Math.min((total / limit) * 100, 100) : (total > 0 ? 100 : 0);
    const remaining = limit - total;

    document.getElementById('points-current').textContent = total;
    document.getElementById('points-limit-display').textContent = limit;
    document.getElementById('points-bar-pct').textContent = Math.round(pct) + '%';
    document.getElementById('points-bar-remaining').textContent =
      remaining >= 0 ? `${remaining} pts remaining` : `${Math.abs(remaining)} pts over limit`;

    const bar = document.getElementById('points-bar');
    bar.style.width = pct + '%';
    bar.classList.toggle('over-limit', total > limit && limit > 0);
    bar.classList.toggle('near-limit', !bar.classList.contains('over-limit') && pct >= 90);

    const summary = document.querySelector('.points-summary');
    summary.classList.toggle('points-over', total > limit && limit > 0);

    document.getElementById('points-current').classList.toggle('over-limit', total > limit && limit > 0);

    // Army entries
    const list = document.getElementById('army-entry-list');
    const emptyEl = document.getElementById('army-list-empty');

    list.innerHTML = '';

    if (!army.entries || army.entries.length === 0) {
      const li = document.createElement('li');
      li.id = 'army-list-empty';
      li.className = 'army-list-empty';
      li.innerHTML = 'No units added yet.<br/>Click a unit card to add it.';
      list.appendChild(li);
      return;
    }

    army.entries.forEach((entry, index) => {
      const li = createArmyEntryEl(entry, index);
      list.appendChild(li);
    });
  }

  function createArmyEntryEl(entry, index) {
    const li = document.createElement('li');
    li.className = 'army-entry';
    li.dataset.index = index;

    const pts = entry.unitData.points || 0;
    const entryTotal = pts * entry.count;

    li.innerHTML = `
      <div class="army-entry-name" title="${escapeHtml(entry.unitName)}">${escapeHtml(entry.customName || entry.unitName)}</div>
      <div class="army-entry-pts">${pts}</div>
      <div class="army-entry-qty">
        <input type="number" value="${entry.count}" min="0" max="99" data-index="${index}" class="army-qty-input" />
      </div>
      <div class="army-entry-total">${entryTotal}</div>
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
        const date = army.updatedAt ? new Date(army.updatedAt).toLocaleDateString() : '';
        li.innerHTML = `
          <div class="saved-army-info">
            <div class="saved-army-name">${escapeHtml(army.name)}</div>
            <div class="saved-army-meta">${total} pts &bull; ${army.entries.length} unit${army.entries.length !== 1 ? 's' : ''}${date ? ' &bull; ' + date : ''}</div>
          </div>
          <div class="saved-army-actions">
            <button class="btn btn-sm btn-accent btn-load-saved" data-id="${army.id}">Load</button>
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setUploadDragDrop(onFiles) {
    const area = document.getElementById('upload-area');

    area.addEventListener('dragover', e => {
      e.preventDefault();
      area.classList.add('dragover');
    });

    area.addEventListener('dragleave', e => {
      if (!area.contains(e.relatedTarget)) area.classList.remove('dragover');
    });

    area.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('dragover');
      const files = [...(e.dataTransfer.files || [])].filter(f =>
        f.name.endsWith('.xml') || f.name.endsWith('.cat')
      );
      if (files.length > 0) onFiles(files);
      else toast('Please drop .xml or .cat files', 'warning');
    });

    // Also support drag-drop on left panel
    const panel = document.getElementById('panel-left');
    panel.addEventListener('dragover', e => {
      e.preventDefault();
      area.classList.add('dragover');
    });
    panel.addEventListener('dragleave', e => {
      if (!panel.contains(e.relatedTarget)) area.classList.remove('dragover');
    });
    panel.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('dragover');
      const files = [...(e.dataTransfer.files || [])].filter(f =>
        f.name.endsWith('.xml') || f.name.endsWith('.cat')
      );
      if (files.length > 0) onFiles(files);
    });
  }

  return {
    init,
    toast,
    renderFactionList,
    renderUnitRoster,
    createUnitCard,
    showUnitModal,
    hideUnitModal,
    renderArmyList,
    createArmyEntryEl,
    showLoadModal,
    hideLoadModal,
    showImportModal,
    hideImportModal,
    escapeHtml,
    setUploadDragDrop
  };
})();
