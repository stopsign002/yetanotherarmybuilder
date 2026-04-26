// ui/deployment-planner.js — drag-drop battlefield deployment planner (per-army; localStorage).
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  // ──────────────────────────────────────────────────────────────
  // Constants — 10e standard table (60" × 44")
  // ──────────────────────────────────────────────────────────────
  const TABLE_W_IN = 60;
  const TABLE_H_IN = 44;
  const GRID_IN    = 6;              // each square is 6"
  const DZ_DEPTH   = 12;              // deployment zone depth in inches
  const PX_PER_IN_DEFAULT = 14;       // baseline scale — resized at open
  const STORAGE_KEY = 'yaab_deployments';
  const MAX_PER_ARMY = 10;

  // Role-based token colors (per spec).
  const COLOR_BY_ROLE = {
    Character:  '#e6c77a',
    Battleline: '#4f8bd6',
    Vehicle:    '#c85050',
    Monster:    '#c85050',
    Other:      '#888888',
  };

  const PALETTE = [
    '#e6c77a', '#4f8bd6', '#c85050', '#7ccf7c',
    '#c77ae6', '#7ae6c9', '#e68a3a', '#888888',
  ];

  const PRESETS = ['Gunline', 'Midfield', 'Flanks', 'Castle', 'Spearhead'];

  const PREFERS_REDUCED_MOTION =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ──────────────────────────────────────────────────────────────
  // Utils
  // ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() { return Math.random().toString(36).slice(2, 10); }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function toast(msg, kind) {
    if (UI && typeof UI.toast === 'function') UI.toast(msg, kind || 'info');
  }

  function classifyRole(keywords) {
    const set = new Set((keywords || []).map(k => String(k).toLowerCase()));
    if (set.has('character')) return 'Character';
    if (set.has('battleline')) return 'Battleline';
    if (set.has('vehicle')) return 'Vehicle';
    if (set.has('monster')) return 'Monster';
    return 'Other';
  }

  function isRanged(unit) {
    const kws = new Set((unit.keywords || []).map(k => String(k).toLowerCase()));
    if (kws.has('vehicle') || kws.has('monster')) return true;
    const weapons = unit.weapons || [];
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      const tn = String(w._typeName || '').toLowerCase();
      if (tn.includes('ranged')) return true;
      const rng = String(w.Range || '').toLowerCase();
      if (rng && rng !== 'melee' && /\d/.test(rng)) return true;
    }
    return false;
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const letters = words.map(w => w[0].toUpperCase()).filter(c => /[A-Z0-9]/.test(c));
    return letters.slice(0, 3).join('');
  }

  function totalModelsForEntry(entry) {
    const count = entry.count || 1;
    const unit = entry.unitData || {};
    const opts = unit.squadOptions || [];
    let modelsPerSquad = 1;
    if (opts.length) {
      let chosen = opts.find(o => o.pts === entry.selectedPts) || opts[0];
      if (chosen && chosen.models) modelsPerSquad = chosen.models;
    }
    return count * modelsPerSquad;
  }

  // ──────────────────────────────────────────────────────────────
  // Storage
  // ──────────────────────────────────────────────────────────────
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }

  function writeAll(store) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); return true; }
    catch (e) { console.warn('[deployment-planner] persist failed', e); return false; }
  }

  function listFor(armyId) {
    if (!armyId) return [];
    const all = loadAll();
    return Array.isArray(all[armyId]) ? all[armyId] : [];
  }

  function saveDeploymentFor(armyId, rec) {
    if (!armyId) return false;
    const all = loadAll();
    const arr = Array.isArray(all[armyId]) ? all[armyId] : [];
    const idx = arr.findIndex(d => d.id === rec.id);
    if (idx >= 0) arr[idx] = rec;
    else arr.unshift(rec);
    while (arr.length > MAX_PER_ARMY) arr.pop();
    all[armyId] = arr;
    return writeAll(all);
  }

  function deleteDeploymentFor(armyId, depId) {
    const all = loadAll();
    const arr = Array.isArray(all[armyId]) ? all[armyId] : [];
    const next = arr.filter(d => d.id !== depId);
    if (next.length === 0) delete all[armyId]; else all[armyId] = next;
    return writeAll(all);
  }

  // ──────────────────────────────────────────────────────────────
  // Module state
  // ──────────────────────────────────────────────────────────────
  let backdropEl = null;
  let canvasEl = null;
  let ctx = null;
  let canvasHostEl = null;
  let fieldWrapEl = null;
  let sideEl = null;
  let readoutEl = null;
  let popupEl = null;
  let selectLoadEl = null;
  let measureBtnEl = null;

  let pxPerIn = PX_PER_IN_DEFAULT;

  const state = {
    armyId: null,
    tokens: [],            // { id, x, y, r, color, label, unitId, unitName }
    measure: null,         // { enabled, a: {x,y}, b: {x,y}, active }
    drag: null,            // { kind: 'new' | 'move', tokenId?, offsetX, offsetY, unitId?, pendingTemplate? }
    popupForTokenId: null,
    currentDepId: null,    // id of loaded deployment, if any
    isOpen: false,
  };

  // ──────────────────────────────────────────────────────────────
  // Stylesheet injection (runtime — no index.html edit needed)
  // ──────────────────────────────────────────────────────────────
  function ensureStylesheet() {
    if (document.querySelector('link[data-yaab-deployment]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/deployment-planner.css';
    link.setAttribute('data-yaab-deployment', '1');
    document.head.appendChild(link);
  }

  // ──────────────────────────────────────────────────────────────
  // DOM scaffold
  // ──────────────────────────────────────────────────────────────
  function buildModal() {
    const presetBtns = PRESETS.map(p =>
      `<button class="yaab-dp-btn" data-yaab-preset="${esc(p)}" title="Apply ${esc(p)} layout">${esc(p)}</button>`
    ).join('');

    backdropEl = document.createElement('div');
    backdropEl.className = 'modal-backdrop yaab-dp-backdrop';
    backdropEl.setAttribute('hidden', '');
    backdropEl.innerHTML = `
      <div class="modal yaab-dp-modal" role="dialog" aria-label="Deployment Planner">
        <div class="modal-header">
          <h3>Deployment Planner</h3>
          <button class="modal-close" type="button" aria-label="Close" data-yaab-dp-close>&times;</button>
        </div>
        <div class="modal-body yaab-dp-body">
          <div class="yaab-dp-toolbar">
            <div class="yaab-dp-toolbar-group">
              <span class="yaab-dp-toolbar-label">Presets</span>
              ${presetBtns}
            </div>
            <div class="yaab-dp-sep"></div>
            <div class="yaab-dp-toolbar-group">
              <button class="yaab-dp-btn" id="yaab-dp-measure" title="Measure: click-drag on canvas">Measure</button>
            </div>
            <div class="yaab-dp-sep"></div>
            <div class="yaab-dp-toolbar-group">
              <button class="yaab-dp-btn" id="yaab-dp-new" title="Clear canvas">New</button>
              <button class="yaab-dp-btn" id="yaab-dp-save" title="Save current deployment">Save</button>
              <select class="yaab-dp-select" id="yaab-dp-load" title="Load saved deployment">
                <option value="">— Load saved —</option>
              </select>
              <button class="yaab-dp-btn yaab-dp-btn-danger" id="yaab-dp-delete" title="Delete selected saved deployment">Delete</button>
            </div>
            <div class="yaab-dp-sep"></div>
            <div class="yaab-dp-toolbar-group">
              <button class="yaab-dp-btn" id="yaab-dp-export" title="Export as PNG">Export PNG</button>
            </div>
          </div>
          <div class="yaab-dp-main">
            <aside class="yaab-dp-side" id="yaab-dp-side">
              <div class="yaab-dp-side-title">Army Units</div>
              <div class="yaab-dp-side-list" id="yaab-dp-side-list"></div>
            </aside>
            <div class="yaab-dp-field-wrap" id="yaab-dp-field-wrap">
              <div class="yaab-dp-canvas-host" id="yaab-dp-canvas-host">
                <canvas class="yaab-dp-canvas" id="yaab-dp-canvas"></canvas>
                <div class="yaab-dp-readout" id="yaab-dp-readout" hidden></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdropEl);

    canvasEl      = backdropEl.querySelector('#yaab-dp-canvas');
    ctx           = canvasEl.getContext('2d');
    canvasHostEl  = backdropEl.querySelector('#yaab-dp-canvas-host');
    fieldWrapEl   = backdropEl.querySelector('#yaab-dp-field-wrap');
    sideEl        = backdropEl.querySelector('#yaab-dp-side-list');
    readoutEl     = backdropEl.querySelector('#yaab-dp-readout');
    selectLoadEl  = backdropEl.querySelector('#yaab-dp-load');
    measureBtnEl  = backdropEl.querySelector('#yaab-dp-measure');

    wireToolbar();
    wireCanvas();

    // Close handlers
    backdropEl.addEventListener('click', function (e) {
      if (e.target === backdropEl) close();
      if (e.target.closest('[data-yaab-dp-close]')) close();
    });
  }

  function wireToolbar() {
    backdropEl.querySelectorAll('[data-yaab-preset]').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.getAttribute('data-yaab-preset')));
    });
    measureBtnEl.addEventListener('click', toggleMeasure);
    backdropEl.querySelector('#yaab-dp-new').addEventListener('click', onNewDeployment);
    backdropEl.querySelector('#yaab-dp-save').addEventListener('click', onSaveDeployment);
    backdropEl.querySelector('#yaab-dp-delete').addEventListener('click', onDeleteDeployment);
    backdropEl.querySelector('#yaab-dp-export').addEventListener('click', onExportPng);
    selectLoadEl.addEventListener('change', function () {
      const depId = selectLoadEl.value;
      if (!depId) return;
      const rec = listFor(state.armyId).find(d => d.id === depId);
      if (rec) loadDeployment(rec);
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Canvas sizing (responsive, maintains aspect ratio)
  // ──────────────────────────────────────────────────────────────
  function resizeCanvas() {
    if (!canvasEl || !fieldWrapEl) return;
    const pad = 28; // inner padding
    const availW = fieldWrapEl.clientWidth  - pad;
    const availH = fieldWrapEl.clientHeight - pad;
    const scaleW = availW / TABLE_W_IN;
    const scaleH = availH / TABLE_H_IN;
    let scale = Math.min(scaleW, scaleH);
    if (!isFinite(scale) || scale <= 0) scale = PX_PER_IN_DEFAULT;
    scale = Math.max(8, Math.min(30, scale));
    pxPerIn = scale;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.round(TABLE_W_IN * scale);
    const cssH = Math.round(TABLE_H_IN * scale);
    canvasEl.style.width  = cssW + 'px';
    canvasEl.style.height = cssH + 'px';
    canvasEl.width  = Math.round(cssW * dpr);
    canvasEl.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ──────────────────────────────────────────────────────────────
  // Coordinate helpers
  // ──────────────────────────────────────────────────────────────
  function canvasPointFromEvent(evt) {
    const rect = canvasEl.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    return { x, y };
  }

  function pxToIn(v) { return v / pxPerIn; }

  // ──────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────
  function render() {
    if (!ctx) return;
    const W = TABLE_W_IN * pxPerIn;
    const H = TABLE_H_IN * pxPerIn;
    ctx.clearRect(0, 0, W, H);

    // Field base — light green
    ctx.fillStyle = '#5d7d52';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid (6" squares)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID_IN; x < TABLE_W_IN; x += GRID_IN) {
      const px = x * pxPerIn;
      ctx.moveTo(px + 0.5, 0); ctx.lineTo(px + 0.5, H);
    }
    for (let y = GRID_IN; y < TABLE_H_IN; y += GRID_IN) {
      const py = y * pxPerIn;
      ctx.moveTo(0, py + 0.5); ctx.lineTo(W, py + 0.5);
    }
    ctx.stroke();

    // Centerline (slightly stronger)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Deployment zones — 12" strip each long edge
    ctx.fillStyle = 'rgba(70,110,180,0.18)';
    ctx.fillRect(0, 0, W, DZ_DEPTH * pxPerIn);
    ctx.fillStyle = 'rgba(180,70,70,0.18)';
    ctx.fillRect(0, H - DZ_DEPTH * pxPerIn, W, DZ_DEPTH * pxPerIn);

    ctx.strokeStyle = 'rgba(70,110,180,0.6)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, DZ_DEPTH * pxPerIn); ctx.lineTo(W, DZ_DEPTH * pxPerIn);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180,70,70,0.6)';
    ctx.beginPath();
    ctx.moveTo(0, H - DZ_DEPTH * pxPerIn); ctx.lineTo(W, H - DZ_DEPTH * pxPerIn);
    ctx.stroke();
    ctx.setLineDash([]);

    // Four classic 10e-style objective markers
    // Approx: 6" in from each short edge on centerline, plus two on centerline
    // 14" from each short edge.
    const objs = objectivePoints();
    objs.forEach(o => drawObjective(o.x, o.y));

    // Tokens
    for (let i = 0; i < state.tokens.length; i++) drawToken(state.tokens[i]);

    // Measurement line
    if (state.measure && state.measure.a && state.measure.b) {
      drawMeasureLine(state.measure.a, state.measure.b);
    }
  }

  function objectivePoints() {
    // 10e-ish: 4 objectives — two on centerline, two inside deployment zones.
    // Positions in inches (x,y) on the 60x44 board:
    return [
      { x: 14,            y: TABLE_H_IN / 2 }, // center-left
      { x: TABLE_W_IN-14, y: TABLE_H_IN / 2 }, // center-right
      { x: TABLE_W_IN/2,  y: DZ_DEPTH + 4 },   // front of top deployment
      { x: TABLE_W_IN/2,  y: TABLE_H_IN - DZ_DEPTH - 4 }, // front of bottom deployment
    ];
  }

  function drawObjective(xIn, yIn) {
    const px = xIn * pxPerIn;
    const py = yIn * pxPerIn;
    ctx.save();
    ctx.fillStyle = 'rgba(230,199,122,0.35)';
    ctx.strokeStyle = '#e6c77a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, pxPerIn * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fffbe6';
    ctx.font = `bold ${Math.round(pxPerIn * 0.9)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OBJ', px, py);
    ctx.restore();
  }

  function drawToken(tok) {
    ctx.save();
    // Drop shadow
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = tok.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tok.x, tok.y, tok.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.stroke();
    // Initials
    ctx.fillStyle = '#111';
    const fontPx = Math.max(9, Math.round(tok.r * 0.8));
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tok.label || '?', tok.x, tok.y);
    ctx.restore();
  }

  function drawMeasureLine(a, b) {
    const distIn = pxToIn(Math.hypot(b.x - a.x, b.y - a.y));
    ctx.save();
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Endpoint pips
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
    // Label
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const text = distIn.toFixed(1) + '"';
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    const pad = 5;
    const w = ctx.measureText(text).width + pad * 2;
    const h = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = 1;
    ctx.fillRect(midX - w / 2, midY - h / 2, w, h);
    ctx.strokeRect(midX - w / 2, midY - h / 2, w, h);
    ctx.fillStyle = '#ffd84d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, midX, midY);
    ctx.restore();

    if (readoutEl) {
      readoutEl.hidden = false;
      readoutEl.textContent = 'Distance: ' + distIn.toFixed(2) + '"';
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Side panel (draggable source tokens)
  // ──────────────────────────────────────────────────────────────
  function getArmyEntries() {
    const army = App.state && App.state.currentArmy;
    if (!army || !Array.isArray(army.entries)) return { army: null, entries: [] };
    return { army, entries: army.entries };
  }

  function renderSide() {
    if (!sideEl) return;
    const { army, entries } = getArmyEntries();
    if (!army || entries.length === 0) {
      sideEl.innerHTML = '<div class="yaab-dp-side-empty">Add units to your army, then drag them onto the battlefield.</div>';
      return;
    }

    const counts = {};
    state.tokens.forEach(t => {
      if (!t.unitId) return;
      counts[t.unitId] = (counts[t.unitId] || 0) + 1;
    });

    sideEl.innerHTML = entries.map((e, idx) => {
      const unit = e.unitData || {};
      const name = unit.name || 'Unit';
      const role = classifyRole(unit.keywords);
      const color = COLOR_BY_ROLE[role] || COLOR_BY_ROLE.Other;
      const models = totalModelsForEntry(e);
      const pts = (e.selectedPts != null ? e.selectedPts : (unit.points || 0)) * (e.count || 1)
        + (e.enhancements || []).reduce((s, en) => s + (en.pts || 0), 0);
      const placed = counts[unit.id] || 0;
      return `
        <div class="yaab-dp-token-item" draggable="true"
             data-yaab-dp-idx="${idx}"
             data-yaab-dp-unitid="${esc(unit.id || '')}"
             data-yaab-dp-color="${color}"
             data-yaab-dp-models="${models}"
             title="Drag onto the battlefield. Drag again for another token.">
          <div class="yaab-dp-token-swatch" style="background:${color}">${esc(initials(name))}</div>
          <div class="yaab-dp-token-meta">
            <div class="yaab-dp-token-name">${esc(name)}</div>
            <div class="yaab-dp-token-sub">${models} model${models !== 1 ? 's' : ''} &middot; ${pts} pts</div>
          </div>
          ${placed ? `<span class="yaab-dp-token-placed" title="${placed} placed on field">${placed}</span>` : ''}
        </div>`;
    }).join('');

    // Drag start from side
    sideEl.querySelectorAll('.yaab-dp-token-item').forEach(el => {
      el.addEventListener('dragstart', onSideDragStart);
      el.addEventListener('dragend',   onSideDragEnd);
    });
  }

  function onSideDragStart(e) {
    const idx = parseInt(e.currentTarget.getAttribute('data-yaab-dp-idx'), 10);
    const { entries } = getArmyEntries();
    const entry = entries[idx];
    if (!entry) return;
    e.currentTarget.classList.add('yaab-dp-dragging');
    const payload = { idx };
    try { e.dataTransfer.setData('text/plain', 'yaab-dp:' + idx); } catch (_) {}
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    state.drag = { kind: 'new', entryIdx: idx };
  }

  function onSideDragEnd(e) {
    e.currentTarget.classList.remove('yaab-dp-dragging');
    // If drop landed on canvas, we already handled it in drop handler.
    state.drag = null;
  }

  // ──────────────────────────────────────────────────────────────
  // Canvas interactions: drop from side, drag-move, dbl-click, right-click
  // ──────────────────────────────────────────────────────────────
  function wireCanvas() {
    canvasEl.addEventListener('dragover', function (e) {
      if (state.drag && state.drag.kind === 'new') {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvasEl.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!state.drag || state.drag.kind !== 'new') return;
      const pt = canvasPointFromEvent(e);
      createTokenFromEntry(state.drag.entryIdx, pt.x, pt.y);
      state.drag = null;
    });

    // Mouse interactions on the canvas itself (move tokens, measure, context menu).
    canvasEl.addEventListener('mousedown', onCanvasMouseDown);
    canvasEl.addEventListener('mousemove', onCanvasMouseMove);
    canvasEl.addEventListener('mouseup',   onCanvasMouseUp);
    canvasEl.addEventListener('mouseleave', onCanvasMouseLeave);
    canvasEl.addEventListener('dblclick',  onCanvasDblClick);
    canvasEl.addEventListener('contextmenu', onCanvasContextMenu);

    // Close popup on outside click
    backdropEl.addEventListener('mousedown', function (e) {
      if (!popupEl) return;
      if (popupEl.contains(e.target)) return;
      if (e.target.classList && e.target.classList.contains('yaab-dp-canvas')) {
        // Allow canvas interaction; close popup but don't start something new here.
        closePopup();
        return;
      }
      closePopup();
    });
  }

  function findTokenAt(x, y) {
    for (let i = state.tokens.length - 1; i >= 0; i--) {
      const t = state.tokens[i];
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= t.r) return t;
    }
    return null;
  }

  function onCanvasMouseDown(e) {
    if (e.button === 2) return; // right-click handled in contextmenu
    const pt = canvasPointFromEvent(e);
    if (state.measure && state.measure.enabled) {
      state.measure.a = pt;
      state.measure.b = pt;
      state.measure.active = true;
      render();
      return;
    }
    const tok = findTokenAt(pt.x, pt.y);
    if (tok) {
      state.drag = {
        kind: 'move',
        tokenId: tok.id,
        offsetX: pt.x - tok.x,
        offsetY: pt.y - tok.y,
      };
      canvasEl.classList.add('yaab-dp-cursor-grab');
    }
  }

  function onCanvasMouseMove(e) {
    const pt = canvasPointFromEvent(e);
    if (state.measure && state.measure.active) {
      state.measure.b = pt;
      render();
      return;
    }
    if (state.drag && state.drag.kind === 'move') {
      const tok = state.tokens.find(t => t.id === state.drag.tokenId);
      if (!tok) return;
      tok.x = clamp(pt.x - state.drag.offsetX, tok.r, TABLE_W_IN * pxPerIn - tok.r);
      tok.y = clamp(pt.y - state.drag.offsetY, tok.r, TABLE_H_IN * pxPerIn - tok.r);
      render();
    }
  }

  function onCanvasMouseUp() {
    if (state.measure && state.measure.active) {
      state.measure.active = false;
      // leave line visible; click elsewhere clears
      return;
    }
    if (state.drag && state.drag.kind === 'move') {
      state.drag = null;
      canvasEl.classList.remove('yaab-dp-cursor-grab');
    }
  }

  function onCanvasMouseLeave() {
    if (state.drag && state.drag.kind === 'move') {
      state.drag = null;
      canvasEl.classList.remove('yaab-dp-cursor-grab');
    }
  }

  function onCanvasDblClick(e) {
    const pt = canvasPointFromEvent(e);
    const tok = findTokenAt(pt.x, pt.y);
    if (tok) openTokenPopup(tok, e.clientX, e.clientY);
  }

  function onCanvasContextMenu(e) {
    e.preventDefault();
    const pt = canvasPointFromEvent(e);
    const tok = findTokenAt(pt.x, pt.y);
    if (tok) {
      removeToken(tok.id);
      return;
    }
    // Clicking elsewhere clears the measurement.
    if (state.measure) {
      state.measure.a = null; state.measure.b = null; state.measure.active = false;
      if (readoutEl) readoutEl.hidden = true;
      render();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Token lifecycle
  // ──────────────────────────────────────────────────────────────
  function computeTokenRadius(models) {
    // 5+ models = bigger. Scale with pxPerIn so token size is visible at all zooms.
    const baseIn = models >= 5 ? 1.6 : 1.1;
    return Math.max(14, baseIn * pxPerIn);
  }

  function createTokenFromEntry(entryIdx, x, y) {
    const { entries } = getArmyEntries();
    const entry = entries[entryIdx];
    if (!entry) return;
    const unit = entry.unitData || {};
    const role = classifyRole(unit.keywords);
    const color = COLOR_BY_ROLE[role] || COLOR_BY_ROLE.Other;
    const models = totalModelsForEntry(entry);
    const r = computeTokenRadius(models);
    const tok = {
      id: uid(),
      x: clamp(x, r, TABLE_W_IN * pxPerIn - r),
      y: clamp(y, r, TABLE_H_IN * pxPerIn - r),
      r,
      color,
      label: initials(unit.name || 'Unit'),
      unitId: unit.id || '',
      unitName: unit.name || 'Unit',
    };
    state.tokens.push(tok);
    render();
    renderSide();
  }

  function removeToken(id) {
    state.tokens = state.tokens.filter(t => t.id !== id);
    closePopup();
    render();
    renderSide();
  }

  // ──────────────────────────────────────────────────────────────
  // Popup editor (dbl-click a token)
  // ──────────────────────────────────────────────────────────────
  function closePopup() {
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    popupEl = null;
    state.popupForTokenId = null;
  }

  function openTokenPopup(tok, clientX, clientY) {
    closePopup();
    state.popupForTokenId = tok.id;
    popupEl = document.createElement('div');
    popupEl.className = 'yaab-dp-popup';
    popupEl.innerHTML = `
      <div class="yaab-dp-popup-row">
        <span class="yaab-dp-popup-label">Label</span>
        <input type="text" id="yaab-dp-popup-label" maxlength="6" value="${esc(tok.label)}" />
      </div>
      <div class="yaab-dp-popup-row" style="align-items:flex-start">
        <span class="yaab-dp-popup-label">Color</span>
        <div class="yaab-dp-swatches" id="yaab-dp-popup-swatches">
          ${PALETTE.map(c => `<div class="yaab-dp-swatch${c === tok.color ? ' yaab-dp-swatch-active' : ''}" style="background:${c}" data-yaab-dp-color="${c}"></div>`).join('')}
        </div>
      </div>
      <div class="yaab-dp-popup-row" style="font-size:11px;color:var(--text-muted)">${esc(tok.unitName || '')}</div>
      <div class="yaab-dp-popup-actions">
        <button class="yaab-dp-btn yaab-dp-btn-danger" id="yaab-dp-popup-remove">Remove</button>
        <button class="yaab-dp-btn" id="yaab-dp-popup-close">Done</button>
      </div>`;
    // Position — clamp inside viewport
    const hostRect = backdropEl.getBoundingClientRect();
    const px = Math.min(clientX - hostRect.left + 8, hostRect.width - 230);
    const py = Math.min(clientY - hostRect.top + 8,  hostRect.height - 170);
    popupEl.style.left = Math.max(8, px) + 'px';
    popupEl.style.top  = Math.max(8, py) + 'px';
    backdropEl.querySelector('.yaab-dp-modal').appendChild(popupEl);

    const labelInput = popupEl.querySelector('#yaab-dp-popup-label');
    labelInput.addEventListener('input', function () {
      tok.label = labelInput.value.trim() || initials(tok.unitName);
      render();
    });
    popupEl.querySelectorAll('[data-yaab-dp-color]').forEach(sw => {
      sw.addEventListener('click', function () {
        tok.color = sw.getAttribute('data-yaab-dp-color');
        popupEl.querySelectorAll('.yaab-dp-swatch').forEach(s => s.classList.remove('yaab-dp-swatch-active'));
        sw.classList.add('yaab-dp-swatch-active');
        render();
      });
    });
    popupEl.querySelector('#yaab-dp-popup-remove').addEventListener('click', function () {
      removeToken(tok.id);
    });
    popupEl.querySelector('#yaab-dp-popup-close').addEventListener('click', closePopup);
    setTimeout(() => { try { labelInput.focus(); labelInput.select(); } catch (_) {} }, 10);
  }

  // ──────────────────────────────────────────────────────────────
  // Measurement toggle
  // ──────────────────────────────────────────────────────────────
  function toggleMeasure() {
    if (!state.measure || !state.measure.enabled) {
      state.measure = { enabled: true, a: null, b: null, active: false };
      measureBtnEl.classList.add('yaab-dp-btn-active');
      canvasEl.classList.add('yaab-dp-cursor-measure');
    } else {
      state.measure = null;
      measureBtnEl.classList.remove('yaab-dp-btn-active');
      canvasEl.classList.remove('yaab-dp-cursor-measure');
      if (readoutEl) readoutEl.hidden = true;
      render();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Save / load / delete
  // ──────────────────────────────────────────────────────────────
  function refreshLoadDropdown() {
    if (!selectLoadEl) return;
    const items = listFor(state.armyId);
    const opts = ['<option value="">— Load saved —</option>'].concat(
      items.map(d => `<option value="${esc(d.id)}"${d.id === state.currentDepId ? ' selected' : ''}>${esc(d.label || 'Deployment')}</option>`)
    );
    selectLoadEl.innerHTML = opts.join('');
  }

  function serializeTokens() {
    // Store normalized (inches) so canvas resizes don't break saves.
    return state.tokens.map(t => ({
      xi: +(t.x / pxPerIn).toFixed(3),
      yi: +(t.y / pxPerIn).toFixed(3),
      ri: +(t.r / pxPerIn).toFixed(3),
      color: t.color,
      label: t.label,
      unitId: t.unitId,
      unitName: t.unitName,
    }));
  }

  function deserializeTokens(arr) {
    return (arr || []).map(t => ({
      id: uid(),
      x: (t.xi != null ? t.xi : 0) * pxPerIn,
      y: (t.yi != null ? t.yi : 0) * pxPerIn,
      r: (t.ri != null ? t.ri : 1.1) * pxPerIn,
      color: t.color || '#888',
      label: t.label || '?',
      unitId: t.unitId || '',
      unitName: t.unitName || '',
    }));
  }

  function onSaveDeployment() {
    if (!state.armyId) { toast('Save your army first before saving a deployment.', 'warn'); return; }
    const list = listFor(state.armyId);
    const nextNum = (list.length + 1);
    let label = 'Deployment #' + nextNum;
    if (state.currentDepId) {
      const existing = list.find(d => d.id === state.currentDepId);
      if (existing) label = existing.label;
    }
    const entered = window.prompt('Deployment label:', label);
    if (entered === null) return;
    const finalLabel = (entered.trim() || label).slice(0, 80);

    const id = state.currentDepId || uid();
    const existing = list.find(d => d.id === id);
    const rec = {
      id,
      label: finalLabel,
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now(),
      tokens: serializeTokens(),
    };
    if (saveDeploymentFor(state.armyId, rec)) {
      state.currentDepId = id;
      toast('Deployment saved: ' + finalLabel, 'success');
      refreshLoadDropdown();
    } else {
      toast('Could not save deployment', 'error');
    }
  }

  function loadDeployment(rec) {
    state.tokens = deserializeTokens(rec.tokens);
    state.currentDepId = rec.id;
    render();
    renderSide();
    refreshLoadDropdown();
    toast('Loaded: ' + (rec.label || 'deployment'), 'info');
  }

  function onNewDeployment() {
    state.tokens = [];
    state.currentDepId = null;
    state.measure = null;
    measureBtnEl.classList.remove('yaab-dp-btn-active');
    canvasEl.classList.remove('yaab-dp-cursor-measure');
    if (readoutEl) readoutEl.hidden = true;
    closePopup();
    render();
    renderSide();
    refreshLoadDropdown();
  }

  function onDeleteDeployment() {
    const id = selectLoadEl.value || state.currentDepId;
    if (!id) { toast('Pick a saved deployment to delete.', 'warn'); return; }
    const rec = listFor(state.armyId).find(d => d.id === id);
    if (!rec) return;
    if (!window.confirm('Delete "' + (rec.label || 'deployment') + '"?')) return;
    deleteDeploymentFor(state.armyId, id);
    if (state.currentDepId === id) state.currentDepId = null;
    refreshLoadDropdown();
    toast('Deleted', 'info');
  }

  // ──────────────────────────────────────────────────────────────
  // Presets — simple heuristic placements
  // ──────────────────────────────────────────────────────────────
  function applyPreset(name) {
    const { entries } = getArmyEntries();
    if (!entries.length) { toast('No units to place.', 'warn'); return; }

    // Clear existing tokens for a clean layout
    state.tokens = [];

    // Classify entries into buckets
    const ranged = [];
    const melee  = [];
    const chars  = [];
    const heavies = []; // vehicles/monsters
    entries.forEach((e, i) => {
      const unit = e.unitData || {};
      const role = classifyRole(unit.keywords);
      const bucket = { entryIdx: i, role };
      if (role === 'Character') chars.push(bucket);
      else if (role === 'Vehicle' || role === 'Monster') heavies.push(bucket);
      else if (isRanged(unit)) ranged.push(bucket);
      else melee.push(bucket);
    });

    // Own deployment zone: bottom (y near TABLE_H - DZ_DEPTH ... TABLE_H)
    const dzTop    = TABLE_H_IN - DZ_DEPTH;
    const dzBottom = TABLE_H_IN - 1;
    const cx       = TABLE_W_IN / 2;

    function placeRow(list, yIn, spreadPct) {
      if (!list.length) return;
      const spread = TABLE_W_IN * (spreadPct || 0.85);
      const step   = list.length > 1 ? spread / (list.length - 1) : 0;
      const startX = cx - spread / 2;
      list.forEach((b, i) => {
        const xIn = list.length === 1 ? cx : (startX + step * i);
        placeFromBucket(b, xIn, yIn);
      });
    }

    function placeFromBucket(b, xIn, yIn) {
      const x = clamp(xIn, 1, TABLE_W_IN - 1) * pxPerIn;
      const y = clamp(yIn, 1, TABLE_H_IN - 1) * pxPerIn;
      createTokenFromEntry(b.entryIdx, x, y);
    }

    switch (name) {
      case 'Gunline': {
        placeRow(ranged.concat(heavies), dzBottom - 1, 0.9);
        placeRow(chars,  dzBottom - 4, 0.6);
        placeRow(melee,  dzTop + 1,    0.7);
        break;
      }
      case 'Midfield': {
        placeRow(melee,  TABLE_H_IN / 2 + 2, 0.85);
        placeRow(ranged, dzTop + 2,          0.8);
        placeRow(chars,  TABLE_H_IN / 2 + 4, 0.4);
        placeRow(heavies,dzTop + 4,          0.7);
        break;
      }
      case 'Flanks': {
        const left = []; const right = [];
        const all = ranged.concat(melee).concat(heavies);
        all.forEach((b, i) => (i % 2 === 0 ? left : right).push(b));
        // Left flank
        left.forEach((b, i) => {
          const y = dzTop + (i * 3) % DZ_DEPTH;
          placeFromBucket(b, 8, y);
        });
        // Right flank
        right.forEach((b, i) => {
          const y = dzTop + (i * 3) % DZ_DEPTH;
          placeFromBucket(b, TABLE_W_IN - 8, y);
        });
        chars.forEach((b, i) => placeFromBucket(b, cx, dzBottom - 1 - i * 3));
        break;
      }
      case 'Castle': {
        // Tight cluster around center of deployment zone
        const all = chars.concat(ranged).concat(heavies).concat(melee);
        const cols = 4;
        const spacingX = 4.5;
        const spacingY = 3.5;
        all.forEach((b, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const xIn = cx - (cols - 1) * spacingX / 2 + col * spacingX;
          const yIn = dzBottom - 1 - row * spacingY;
          placeFromBucket(b, xIn, yIn);
        });
        break;
      }
      case 'Spearhead': {
        // Diagonal wedge pushing up one flank
        const all = melee.concat(chars).concat(ranged).concat(heavies);
        all.forEach((b, i) => {
          const xIn = 6 + i * 3.5;
          const yIn = dzBottom - 1 - i * 2.5;
          placeFromBucket(b, xIn, yIn);
        });
        break;
      }
      default:
        // unknown preset — noop
        break;
    }
    render();
    renderSide();
  }

  // ──────────────────────────────────────────────────────────────
  // PNG export
  // ──────────────────────────────────────────────────────────────
  function onExportPng() {
    try {
      const url = canvasEl.toDataURL('image/png');
      const a = document.createElement('a');
      const army = App.state && App.state.currentArmy;
      const base = (army && army.name ? army.name : 'deployment').replace(/[^a-z0-9_-]+/gi, '_');
      a.href = url;
      a.download = base + '_deployment.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('PNG exported', 'success');
    } catch (e) {
      console.warn('[deployment-planner] export failed', e);
      toast('PNG export failed', 'error');
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Open / close
  // ──────────────────────────────────────────────────────────────
  let resizeObserver = null;

  function open() {
    ensureStylesheet();
    if (!backdropEl) buildModal();

    const army = App.state && App.state.currentArmy;
    state.armyId = army ? army.id : null;
    state.tokens = [];
    state.currentDepId = null;
    state.measure = null;
    state.isOpen = true;

    backdropEl.removeAttribute('hidden');
    // Size + render after layout settles
    requestAnimationFrame(() => {
      resizeCanvas();
      renderSide();
      refreshLoadDropdown();
    });

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKey);
    if (window.ResizeObserver && fieldWrapEl && !resizeObserver) {
      resizeObserver = new ResizeObserver(() => resizeCanvas());
      resizeObserver.observe(fieldWrapEl);
    }
  }

  function close() {
    if (!backdropEl) return;
    state.isOpen = false;
    backdropEl.setAttribute('hidden', '');
    closePopup();
    window.removeEventListener('resize', onWindowResize);
    document.removeEventListener('keydown', onKey);
    if (resizeObserver) { try { resizeObserver.disconnect(); } catch (_) {} resizeObserver = null; }
  }

  function onWindowResize() { resizeCanvas(); }

  function onKey(e) {
    if (!state.isOpen) return;
    if (e.key === 'Escape') {
      if (popupEl) { closePopup(); return; }
      close();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Public hooks
  // ──────────────────────────────────────────────────────────────
  App.openDeploymentPlanner = open;

  App.hooks.armyToolbarActions.push({
    region: 'primary',
    label: 'Deploy',
    title: 'Deployment planner — drag units onto a battlefield',
    onClick: open,
  });

  // React to live army changes if open
  App.hooks.armyChange.push(function (army) {
    if (!state.isOpen) return;
    const nextId = army ? army.id : null;
    if (nextId !== state.armyId) {
      state.armyId = nextId;
      state.tokens = [];
      state.currentDepId = null;
    }
    renderSide();
    refreshLoadDropdown();
    render();
  });

  // Expose for debugging
  UI.deploymentPlanner = { open, close };
})();
