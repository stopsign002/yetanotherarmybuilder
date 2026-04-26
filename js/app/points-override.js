// app/points-override.js — dataslate support: user-edited unit point costs, persisted to LS.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_points_overrides';

  // { [unitId]: overriddenPts }. Mirrors localStorage.
  const overrides = loadOverrides();
  // Parallel cache of parser-original values, populated lazily so clearing
  // restores cleanly even after IndexedDB cache wipes / re-parse.
  const _originalPoints = {};

  let modalEl = null;
  let searchTerm = '';
  let bannerEl = null;

  // ── persistence ──────────────────────────────────────────────────────────

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return {};
      const out = {};
      Object.keys(obj).forEach(k => {
        const n = Number(obj[k]);
        if (Number.isFinite(n) && n >= 0) out[k] = Math.round(n);
      });
      return out;
    } catch (_) { return {}; }
  }

  function saveOverrides() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch (_) {}
  }

  const overrideCount = () => Object.keys(overrides).length;

  // ── apply / restore ──────────────────────────────────────────────────────

  function snapshotOriginal(unit) {
    if (_originalPoints[unit.id]) return;
    _originalPoints[unit.id] = {
      points:        unit.points,
      pointsOptions: Array.isArray(unit.pointsOptions) ? unit.pointsOptions.slice() : [],
      squadOptions:  Array.isArray(unit.squadOptions)
        ? unit.squadOptions.map(o => ({ pts: o.pts, models: o.models }))
        : [],
    };
  }

  function applyToUnit(unit, pts) {
    snapshotOriginal(unit);
    const orig = _originalPoints[unit.id];
    const origPts = Number(orig.points) || 0;
    const delta = pts - origPts;
    unit.points = pts;
    unit.pointsOptions = (orig.pointsOptions.length > 0 ? orig.pointsOptions : [origPts])
      .map(p => Math.max(0, p + delta));
    unit.squadOptions = (orig.squadOptions.length > 0 ? orig.squadOptions : [{ pts: origPts, models: null }])
      .map(o => ({ pts: Math.max(0, (Number(o.pts) || 0) + delta), models: o.models }));
  }

  function restoreUnit(unit) {
    const orig = _originalPoints[unit.id];
    if (!orig) return;
    unit.points        = orig.points;
    unit.pointsOptions = orig.pointsOptions.slice();
    unit.squadOptions  = orig.squadOptions.map(o => ({ pts: o.pts, models: o.models }));
  }

  App.applyPointsOverrides = function () {
    const factions = (App.state && App.state.factions) || [];
    for (let i = 0; i < factions.length; i++) {
      const units = factions[i].units || [];
      for (let j = 0; j < units.length; j++) {
        const u = units[j];
        if (!u || !u.id) continue;
        if (Object.prototype.hasOwnProperty.call(overrides, u.id)) applyToUnit(u, overrides[u.id]);
        else if (_originalPoints[u.id]) restoreUnit(u);
      }
    }
    if (typeof App.rebuildAllUnits === 'function') App.rebuildAllUnits();
    if (typeof App.renderUnitRosterWithContext === 'function') App.renderUnitRosterWithContext();
    if (window.UI && typeof UI.renderArmyList === 'function' && App.state && App.state.currentArmy) {
      UI.renderArmyList(App.state.currentArmy);
    }
    updateBanner();
  };

  // ── banner (mounted into #panel-center .panel-controls) ─────────────────

  function updateBanner() {
    const host = document.querySelector('#panel-center .panel-controls');
    if (!host) return;
    if (!bannerEl || !host.contains(bannerEl)) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'yaab-points-banner';
      bannerEl.className = 'points-override-banner';
      host.insertBefore(bannerEl, host.firstChild);
    }
    const n = overrideCount();
    if (n === 0) { bannerEl.hidden = true; bannerEl.innerHTML = ''; return; }
    bannerEl.hidden = false;
    bannerEl.innerHTML =
      '<span class="points-override-banner-text">' + n +
        ' points override' + (n === 1 ? '' : 's') + ' active</span>' +
      '<button type="button" class="points-override-banner-reset">reset all</button>';
    bannerEl.querySelector('.points-override-banner-reset').addEventListener('click', resetAll);
  }

  function resetAll() {
    if (overrideCount() === 0) return;
    Object.keys(overrides).forEach(k => delete overrides[k]);
    saveOverrides();
    App.applyPointsOverrides();
    if (modalEl && !modalEl.hidden) renderList();
    if (window.UI && typeof UI.toast === 'function') UI.toast('All point overrides cleared', 'success');
  }

  // ── modal ────────────────────────────────────────────────────────────────

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const shortFac = n => !n ? '' : (n.includes(' - ') ? n.split(' - ').pop() : n);

  const originalPtsOf = u =>
    _originalPoints[u.id] ? _originalPoints[u.id].points : (Number(u.points) || 0);

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-points-override';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal points-override-modal">' +
        '<div class="modal-header">' +
          '<h3>Points Override</h3>' +
          '<button class="modal-close" id="points-override-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p class="muted points-override-help">Edit any unit\'s base cost for dataslate or house-rule support. ' +
            'Stored locally and reapplied on load. Leave blank or click the x to restore.</p>' +
          '<input type="text" id="points-override-search" class="points-override-search" placeholder="Search units..." />' +
          '<div id="points-override-list" class="points-override-list"></div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-outline" id="points-override-reset-all" type="button">Reset all</button>' +
          '<span class="toolbar-spacer" style="flex:1"></span>' +
          '<button class="btn btn-accent" id="points-override-done" type="button">Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#points-override-close').addEventListener('click', closeModal);
    backdrop.querySelector('#points-override-done').addEventListener('click', closeModal);
    backdrop.querySelector('#points-override-reset-all').addEventListener('click', resetAll);
    backdrop.querySelector('#points-override-search').addEventListener('input', e => {
      searchTerm = (e.target.value || '').trim().toLowerCase();
      renderList();
    });
    modalEl = backdrop;
    return modalEl;
  }

  function renderList() {
    if (!modalEl) return;
    const list = modalEl.querySelector('#points-override-list');
    if (!list) return;
    const all = (App.state && App.state.allUnits) || [];
    if (all.length === 0) {
      list.innerHTML = '<div class="points-override-empty">Faction data still loading&hellip;</div>';
      return;
    }
    const rows = [];
    for (let i = 0; i < all.length && rows.length < 400; i++) {
      const u = all[i];
      if (!u || !u.id) continue;
      const hay = (u.name + ' ' + (u._factionName || '')).toLowerCase();
      if (searchTerm && hay.indexOf(searchTerm) === -1) continue;
      const orig = originalPtsOf(u);
      const cur = Object.prototype.hasOwnProperty.call(overrides, u.id) ? overrides[u.id] : '';
      rows.push(
        '<div class="points-override-row">' +
          '<div class="points-override-row-main">' +
            '<div class="points-override-row-name">' + esc(u.name) + '</div>' +
            '<div class="points-override-row-fac muted">' + esc(shortFac(u._factionName)) + '</div>' +
          '</div>' +
          '<div class="points-override-row-orig">' + orig + ' pt</div>' +
          '<input type="number" class="points-override-input" min="0" step="1" ' +
            'data-unit-id="' + esc(u.id) + '" value="' + esc(cur) + '" placeholder="' + orig + '" />' +
          '<button type="button" class="points-override-clear" data-unit-id="' + esc(u.id) + '" title="Clear override">&times;</button>' +
        '</div>'
      );
    }
    list.innerHTML = rows.join('') || '<div class="points-override-empty">No units match your filter.</div>';
    list.querySelectorAll('.points-override-input').forEach(inp => {
      inp.addEventListener('change', onInputChange);
    });
    list.querySelectorAll('.points-override-clear').forEach(btn => {
      btn.addEventListener('click', onClearClick);
    });
  }

  function onInputChange(e) {
    const id = e.target.getAttribute('data-unit-id');
    const raw = (e.target.value || '').trim();
    if (raw === '') {
      if (overrides[id] != null) { delete overrides[id]; saveOverrides(); App.applyPointsOverrides(); }
      return;
    }
    const n = Math.max(0, Math.round(Number(raw) || 0));
    if (overrides[id] === n) return;
    overrides[id] = n;
    saveOverrides();
    App.applyPointsOverrides();
  }

  function onClearClick(e) {
    const id = e.currentTarget.getAttribute('data-unit-id');
    if (overrides[id] == null) return;
    delete overrides[id];
    saveOverrides();
    App.applyPointsOverrides();
    const input = modalEl && modalEl.querySelector('.points-override-input[data-unit-id="' + id + '"]');
    if (input) input.value = '';
  }

  function openModal() {
    const el = ensureModal();
    searchTerm = '';
    const s = el.querySelector('#points-override-search');
    if (s) s.value = '';
    renderList();
    el.hidden = false;
    setTimeout(() => { if (s) s.focus(); }, 50);
  }

  function closeModal() { if (modalEl) modalEl.hidden = true; }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── hooks ────────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-points-override',
    region: 'primary',
    label: 'Points',
    title: 'Override unit points (dataslate support)',
    onClick: openModal,
  });

  App.hooks.bootstrap.push(function () {
    if (overrideCount() > 0) App.applyPointsOverrides();
    updateBanner();
    // Banner host is created by UI.init, but re-watch panel-center so the
    // banner survives re-renders of the controls bar.
    const center = document.getElementById('panel-center') || document.body;
    new MutationObserver(() => {
      const host = document.querySelector('#panel-center .panel-controls');
      if (host && (!bannerEl || !host.contains(bannerEl))) updateBanner();
    }).observe(center, { childList: true, subtree: true });
  });

  // Factions load asynchronously; reapply once any overridden unit has shown
  // up but hasn't had a snapshot taken yet.
  App.hooks.armyChange.push(function () {
    if (overrideCount() === 0) return;
    const factions = (App.state && App.state.factions) || [];
    for (let i = 0; i < factions.length; i++) {
      const units = factions[i].units || [];
      for (let j = 0; j < units.length; j++) {
        const u = units[j];
        if (u && u.id && overrides[u.id] != null && !_originalPoints[u.id]) {
          App.applyPointsOverrides();
          return;
        }
      }
    }
  });
})();
