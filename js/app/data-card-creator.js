// app/data-card-creator.js — Modal feature: build & export printable data cards
// (unit datasheets, army rules, stratagems) for the currently-built army.
//
// Replaces the old js/ui/datasheet.js print flow. Renders cards at fixed
// physical sizes (in inches/mm) so the on-screen preview matches the PDF
// output 1:1. PDF export goes through html2pdf with a custom page size derived
// from the chosen layout preset.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MODAL_ID = 'yaab-dcc-modal';
  const BTN_ID   = 'yaab-btn-data-cards';

  // ── Layout presets ───────────────────────────────────────────────────────
  // Page sizes in millimetres (jsPDF works in mm). Each preset describes the
  // physical sheet that will be fed through the printer; cols × rows is the
  // grid of cards laid out on that sheet. A 4×6 index card with cols=rows=1
  // is "one card == one sheet".
  const IN_TO_MM = 25.4;
  const LAYOUTS = [
    { id: '4x6-portrait',  label: '4×6 index card — portrait',  w:  4 * IN_TO_MM, h:  6 * IN_TO_MM, cols: 1, rows: 1 },
    { id: '4x6-landscape', label: '4×6 index card — landscape', w:  6 * IN_TO_MM, h:  4 * IN_TO_MM, cols: 1, rows: 1 },
    { id: '4x6-2up',       label: '4×6 — 2 cards (landscape, split)', w: 6 * IN_TO_MM, h: 4 * IN_TO_MM, cols: 2, rows: 1 },
    { id: 'letter-4up',    label: 'US Letter — 4 cards (2×2)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 2, rows: 2 },
    { id: 'letter-6up',    label: 'US Letter — 6 cards (2×3)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 2, rows: 3 },
    { id: 'letter-9up',    label: 'US Letter — 9 cards (3×3)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 3, rows: 3 },
    { id: 'a4-4up',        label: 'A4 — 4 cards (2×2)',         w: 210, h: 297, cols: 2, rows: 2 },
    { id: 'a4-6up',        label: 'A4 — 6 cards (2×3)',         w: 210, h: 297, cols: 2, rows: 3 },
  ];
  const DEFAULT_LAYOUT = '4x6-portrait';
  const PAGE_MARGIN_MM = 5;   // outer page margin
  const CARD_GUTTER_MM = 3;   // space between cards on multi-up layouts

  // ── Mutable state ────────────────────────────────────────────────────────
  let modalEl = null;
  let lastFocused = null;
  let activeTab = 'units';      // 'units' | 'rules' | 'strats'
  let activeLayoutId = DEFAULT_LAYOUT;
  // Per-category include sets keyed by stable id (entry-index for units,
  // name for rules and stratagems). Defaults: everything in.
  let include = { units: null, rules: null, strats: null };

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    if (window.UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function toast(msg, kind, ms) {
    if (window.UI && UI.toast) UI.toast(msg, kind || 'info', ms || 2200);
  }
  function getCurrentArmy() {
    const s = App.state || {};
    return s.currentArmy || (s.armyManager && s.armyManager.current) || null;
  }
  function getFaction() {
    if (typeof App.getDetachmentFaction === 'function') {
      const f = App.getDetachmentFaction();
      if (f) return f;
    }
    if (typeof App.getCurrentFaction === 'function') return App.getCurrentFaction() || null;
    const army = getCurrentArmy();
    if (!army) return null;
    return (App.state.factions || []).find(f => f.factionName === army.factionName) || null;
  }

  // ── Data gathering ───────────────────────────────────────────────────────
  function gatherUnits() {
    const army = getCurrentArmy();
    if (!army || !Array.isArray(army.entries)) return [];
    return army.entries.map((entry, i) => ({
      id: 'u' + i,
      label: (entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit')
           + (entry.count > 1 ? ' ×' + entry.count : ''),
      entry,
    }));
  }
  function gatherRules() {
    const out = [];
    const faction = getFaction();
    const det = (App.state && App.state.selectedDetachment) || null;
    if (faction && Array.isArray(faction.armyRules)) {
      faction.armyRules.forEach(r => {
        if (r && r.name) out.push({ id: 'r:' + r.name, label: r.name, kind: 'army', rule: r });
      });
    }
    if (det && Array.isArray(det.rules)) {
      const seen = new Set();
      det.rules.forEach(r => {
        if (!r || !r.name || seen.has(r.name)) return;
        seen.add(r.name);
        out.push({ id: 'd:' + r.name, label: r.name, kind: 'detachment', rule: r });
      });
    }
    return out;
  }
  function gatherStratagems() {
    const out = [];
    const faction = getFaction();
    const det = (App.state && App.state.selectedDetachment) || null;
    const seen = new Set();
    function pushAll(list, type) {
      (Array.isArray(list) ? list : []).forEach(s => {
        if (!s || !s.name) return;
        const key = type + '::' + s.name;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ id: key, label: s.name, type, strat: s });
      });
    }
    if (det) {
      pushAll(det.stratagems, 'detachment');
      pushAll(det.gdcStratagems, 'detachment');
    }
    if (faction) {
      pushAll(faction.factionStratagems, 'faction');
      pushAll(faction.gdcFactionStratagems, 'faction');
    }
    pushAll(App.CORE_STRATAGEMS || [], 'core');
    return out;
  }

  // Initialise/repair the include sets so that "no selection" means "all on".
  function syncIncludeDefaults() {
    function defaultAll(items, key) {
      if (!include[key]) include[key] = new Set(items.map(x => x.id));
    }
    defaultAll(gatherUnits(),       'units');
    defaultAll(gatherRules(),       'rules');
    defaultAll(gatherStratagems(),  'strats');
  }

  // ── Card content renderers ──────────────────────────────────────────────
  // Each returns inner HTML for a `.dcc-card` element. Sizing/scaling is
  // driven entirely by CSS (the card itself is a fixed physical size).

  const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
  function getStatVal(stats, key) {
    const aliases = (window.UI && UI._STAT_ALIASES && UI._STAT_ALIASES[key]) || [key];
    for (let i = 0; i < aliases.length; i++) {
      const v = stats[aliases[i]];
      if (v != null && v !== '') return v;
    }
    return '—';
  }

  function classifyWeapons(unit) {
    // Mirror detail.js: prefer GDC pre-bucketed lists when present, else fall
    // back to the BSData _typeName/Range heuristic on the flat .weapons array.
    const useGdc = Array.isArray(unit.gdcMeleeWeapons) || Array.isArray(unit.gdcRangedWeapons);
    if (useGdc) {
      return {
        ranged: gdcProfilesToRows(unit.gdcRangedWeapons || [], 'ranged'),
        melee:  gdcProfilesToRows(unit.gdcMeleeWeapons  || [], 'melee'),
      };
    }
    const ws = unit.weapons || [];
    const ranged = ws.filter(w => {
      const tn = (w._typeName || '').toLowerCase();
      return tn.includes('ranged') || (!tn.includes('melee') && w.Range !== 'Melee');
    });
    const melee = ws.filter(w => {
      const tn = (w._typeName || '').toLowerCase();
      return tn.includes('melee') || w.Range === 'Melee';
    });
    return { ranged, melee };
  }
  function gdcProfilesToRows(weapons, type) {
    const out = [];
    (weapons || []).forEach(w => {
      if (!w || w.active === false || !Array.isArray(w.profiles)) return;
      w.profiles.forEach(p => {
        if (!p || p.active === false) return;
        const row = {
          name: p.name || w.name || '',
          Range: p.range != null && p.range !== '' ? p.range : (type === 'melee' ? 'Melee' : '—'),
          A: p.attacks, S: p.strength, AP: p.ap, D: p.damage,
        };
        if (type === 'ranged') row.BS = p.skill; else row.WS = p.skill;
        if (Array.isArray(p.keywords) && p.keywords.length > 0) {
          row.Keywords = p.keywords.join(', ');
        }
        out.push(row);
      });
    });
    return out;
  }

  function renderWeaponsBlock(list, type) {
    if (!list || list.length === 0) return '';
    const COLS = type === 'ranged'
      ? ['Range', 'A', 'BS', 'S', 'AP', 'D']
      : ['Range', 'A', 'WS', 'S', 'AP', 'D'];
    const label = type === 'ranged' ? 'RANGED WEAPONS' : 'MELEE WEAPONS';
    const rows = list.map(w => {
      const stats = COLS.map(c => `<td class="dcc-num">${esc(w[c] != null && w[c] !== '' ? w[c] : '—')}</td>`).join('');
      const kw = w.Keywords ? `<div class="dcc-w-kw">${esc(w.Keywords)}</div>` : '';
      return `<tr class="dcc-w-row">
        <td class="dcc-w-name">${esc(w.name)}${kw}</td>
        ${stats}
      </tr>`;
    }).join('');
    return `
      <div class="dcc-section dcc-weapons dcc-weapons-${type}">
        <div class="dcc-section-head">
          <span class="dcc-section-label">${label}</span>
          <span class="dcc-section-cols">${COLS.map(c => `<span>${c}</span>`).join('')}</span>
        </div>
        <table class="dcc-w-table">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderAbilitiesBlock(unit) {
    const abil = (unit.abilities || []).filter(a => a && a.name);
    if (abil.length === 0) return '';
    const core = [];
    const named = [];
    abil.forEach(a => {
      if (a.isCore) core.push(a);
      else named.push(a);
    });
    let html = `<div class="dcc-section dcc-abilities">
      <div class="dcc-section-head"><span class="dcc-section-label">ABILITIES</span></div>
      <div class="dcc-abilities-body">`;
    if (core.length > 0) {
      html += `<div class="dcc-ability-row dcc-core-row"><strong>CORE:</strong> ${
        core.map(a => esc(a.name)).join(', ')
      }</div>`;
    }
    named.forEach(a => {
      html += `<div class="dcc-ability-row"><strong>${esc(a.name)}:</strong> ${esc(a.description || '')}</div>`;
    });
    html += `</div></div>`;
    return html;
  }

  function renderUnitCard(entry) {
    const unit = entry.unitData || {};
    const stats = unit.stats || {};
    const presentStats = STAT_ORDER.filter(k => getStatVal(stats, k) !== '—');
    const { ranged, melee } = classifyWeapons(unit);

    const ptsOpts = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const ptsLabel = entry.selectedPts != null ? entry.selectedPts
                  : (ptsOpts.length ? ptsOpts[0] : null);
    const titleSuffix = entry.count > 1 ? ` <span class="dcc-count">×${entry.count}</span>` : '';

    const enhancementHtml = (Array.isArray(entry.enhancements) && entry.enhancements.length > 0)
      ? `<div class="dcc-section dcc-enhancements">
          <div class="dcc-section-head"><span class="dcc-section-label">ENHANCEMENT</span></div>
          <div class="dcc-abilities-body">${
            entry.enhancements.map(e => `<div class="dcc-ability-row"><strong>${esc(e.name)}${e.pts ? ' (+' + e.pts + ')' : ''}:</strong> ${esc(e.description || '')}</div>`).join('')
          }</div>
        </div>`
      : '';

    // Footer keywords
    const allKw = (unit.keywords || []).filter(Boolean);
    const factionKw = unit._factionName ? [unit._factionName] : [];
    const kwFooter = allKw.length > 0
      ? `<div class="dcc-keywords"><strong>KEYWORDS:</strong> ${esc(allKw.join(', '))}</div>`
      : '';
    const fkwFooter = factionKw.length > 0
      ? `<div class="dcc-keywords dcc-faction-kw"><strong>FACTION KEYWORDS:</strong> ${esc(factionKw.join(', '))}</div>`
      : '';

    const inv = unit.invulnSave ? `<span class="dcc-inv" title="Invulnerable Save">${esc(unit.invulnSave)} INV</span>` : '';

    const statsHtml = presentStats.length > 0
      ? `<div class="dcc-stats" style="--dcc-stat-cols:${presentStats.length}">
          ${presentStats.map(k => `
            <div class="dcc-stat-cell">
              <span class="dcc-stat-key">${esc(k)}</span>
              <span class="dcc-stat-val">${esc(String(getStatVal(stats, k)))}</span>
            </div>`).join('')}
        </div>`
      : '';

    return `
      <header class="dcc-head">
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(unit.name || entry.unitName || 'Unit')}${titleSuffix}</h1>
          ${ptsLabel != null ? `<span class="dcc-pts">${esc(String(ptsLabel))} pts</span>` : ''}
        </div>
        <div class="dcc-sub-line">
          <span class="dcc-role">${esc(unit.type || '')}</span>
          ${inv}
        </div>
      </header>
      ${statsHtml}
      ${renderWeaponsBlock(ranged, 'ranged')}
      ${renderWeaponsBlock(melee, 'melee')}
      ${renderAbilitiesBlock(unit)}
      ${enhancementHtml}
      <footer class="dcc-foot">
        ${fkwFooter}
        ${kwFooter}
      </footer>`;
  }

  function renderRuleCard(item) {
    const r = item.rule || {};
    const kindLabel = item.kind === 'detachment' ? 'DETACHMENT RULE' : 'ARMY RULE';
    return `
      <header class="dcc-head dcc-head-rule">
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(r.name || item.label)}</h1>
        </div>
        <div class="dcc-sub-line"><span class="dcc-role">${kindLabel}</span></div>
      </header>
      <div class="dcc-section dcc-rule-body">
        <div class="dcc-rule-text">${esc(r.description || '')}</div>
      </div>`;
  }

  function renderStratagemCard(item) {
    const s = item.strat || {};
    const cp = s.cp != null ? s.cp : '?';
    const phase = s.phase ? ('PHASE: ' + String(s.phase).toUpperCase()) : '';
    const typeLabel = item.type === 'core' ? 'CORE' : item.type === 'detachment' ? 'DETACHMENT' : 'FACTION';
    return `
      <header class="dcc-head dcc-head-strat">
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(s.name)}</h1>
          <span class="dcc-cp"><span class="dcc-cp-num">${esc(String(cp))}</span><span class="dcc-cp-lbl">CP</span></span>
        </div>
        <div class="dcc-sub-line">
          <span class="dcc-role">${esc(typeLabel)} STRATAGEM</span>
          <span class="dcc-strat-phase">${esc(phase)}</span>
        </div>
      </header>
      <div class="dcc-section dcc-strat-body">
        <div class="dcc-rule-text">${esc(s.description || '')}</div>
      </div>`;
  }

  // ── Page assembly ────────────────────────────────────────────────────────
  // Selection is per-card across all categories — the active sidebar tab
  // only governs which list is on screen, not which cards print.
  function selectedCards() {
    const out = [];
    gatherUnits().forEach(u => {
      if (include.units && include.units.has(u.id)) out.push({ kind: 'unit', html: renderUnitCard(u.entry), label: u.label });
    });
    gatherRules().forEach(r => {
      if (include.rules && include.rules.has(r.id)) out.push({ kind: 'rule', html: renderRuleCard(r), label: r.label });
    });
    gatherStratagems().forEach(s => {
      if (include.strats && include.strats.has(s.id)) out.push({ kind: 'strat', html: renderStratagemCard(s), label: s.label });
    });
    return out;
  }

  function getLayout() {
    return LAYOUTS.find(l => l.id === activeLayoutId) || LAYOUTS[0];
  }

  // Each `.dcc-page` is a fixed physical size (mm). Inside, a CSS grid lays
  // out cards. The same DOM is used for both the on-screen scaled preview
  // and the html2pdf off-screen render — preview just wraps in a transformed
  // shell, the PDF stage strips that wrapper.
  function buildPagesDOM() {
    const layout = getLayout();
    const cardsPerPage = layout.cols * layout.rows;
    const cards = selectedCards();
    const pages = [];
    for (let i = 0; i < cards.length; i += cardsPerPage) {
      pages.push(cards.slice(i, i + cardsPerPage));
    }
    if (pages.length === 0) pages.push([]);

    // Card size = (page - 2*margin - (cols-1)*gutter) / cols
    const cardW = (layout.w - 2 * PAGE_MARGIN_MM - (layout.cols - 1) * CARD_GUTTER_MM) / layout.cols;
    const cardH = (layout.h - 2 * PAGE_MARGIN_MM - (layout.rows - 1) * CARD_GUTTER_MM) / layout.rows;

    const frag = document.createDocumentFragment();
    pages.forEach((page, pi) => {
      const pageEl = document.createElement('div');
      pageEl.className = 'dcc-page';
      // Bake page geometry into inline styles directly. CSS custom
      // properties don't always survive html2canvas's document clone
      // (the export DOM gets stamped into a sandbox iframe); inline
      // width/height/grid here keeps the layout intact in the PDF.
      pageEl.style.width  = layout.w + 'mm';
      pageEl.style.height = layout.h + 'mm';
      pageEl.style.padding = PAGE_MARGIN_MM + 'mm';
      pageEl.style.gridTemplateColumns = 'repeat(' + layout.cols + ', 1fr)';
      pageEl.style.gridTemplateRows    = 'repeat(' + layout.rows + ', 1fr)';
      pageEl.style.gap = CARD_GUTTER_MM + 'mm';
      // The card-w/h vars are only used by the per-card-grid-density CSS
      // rules (font tweaks for 9-up). Keep them as CSS vars too so those
      // selectors still match.
      pageEl.style.setProperty('--dcc-page-w', layout.w + 'mm');
      pageEl.style.setProperty('--dcc-page-h', layout.h + 'mm');
      pageEl.style.setProperty('--dcc-grid-cols', layout.cols);
      pageEl.style.setProperty('--dcc-grid-rows', layout.rows);
      pageEl.style.setProperty('--dcc-card-w', cardW + 'mm');
      pageEl.style.setProperty('--dcc-card-h', cardH + 'mm');
      pageEl.dataset.page = String(pi + 1);

      page.forEach(card => {
        const cardEl = document.createElement('article');
        cardEl.className = 'dcc-card dcc-card-' + card.kind;
        cardEl.innerHTML = card.html;
        pageEl.appendChild(cardEl);
      });
      // Pad with empty grid placeholders so the last page keeps its layout.
      for (let k = page.length; k < cardsPerPage; k++) {
        const ph = document.createElement('div');
        ph.className = 'dcc-card dcc-card-empty';
        pageEl.appendChild(ph);
      }
      frag.appendChild(pageEl);
    });
    return { frag, pageCount: pages.length, cardCount: cards.length };
  }

  // ── Modal: structure + render ───────────────────────────────────────────
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'dcc-backdrop';
    modalEl.id = MODAL_ID;
    modalEl.setAttribute('hidden', '');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Data card creator');

    modalEl.innerHTML = `
      <div class="dcc-modal" role="document">
        <header class="dcc-modal-head">
          <h2 class="dcc-modal-title">Data Card Creator</h2>
          <div class="dcc-summary" id="dcc-summary"></div>
          <button type="button" class="dcc-close" aria-label="Close">&times;</button>
        </header>
        <div class="dcc-toolbar">
          <div class="dcc-tabs" role="tablist">
            <button type="button" class="dcc-tab" data-tab="units" role="tab">Units</button>
            <button type="button" class="dcc-tab" data-tab="rules" role="tab">Army rules</button>
            <button type="button" class="dcc-tab" data-tab="strats" role="tab">Stratagems</button>
          </div>
          <label class="dcc-layout-pick">
            <span class="dcc-layout-label">Layout</span>
            <select class="dcc-layout-select" id="dcc-layout-select">
              ${LAYOUTS.map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('')}
            </select>
          </label>
          <div class="dcc-actions">
            <button type="button" class="dcc-btn" id="dcc-print">Print…</button>
            <button type="button" class="dcc-btn dcc-btn-primary" id="dcc-pdf">Save PDF</button>
          </div>
        </div>
        <div class="dcc-body">
          <aside class="dcc-side" id="dcc-side"></aside>
          <section class="dcc-preview-wrap">
            <div class="dcc-preview" id="dcc-preview"></div>
          </section>
        </div>
      </div>`;

    document.body.appendChild(modalEl);

    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });
    modalEl.querySelector('.dcc-close').addEventListener('click', close);

    // Tabs
    modalEl.querySelectorAll('.dcc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderSidebar();
        renderTabsState();
      });
    });

    // Layout dropdown
    modalEl.querySelector('#dcc-layout-select').addEventListener('change', (e) => {
      activeLayoutId = e.target.value;
      renderPreview();
    });

    // Sidebar checkbox delegation
    modalEl.querySelector('#dcc-side').addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-include]');
      if (!cb) return;
      const cat = cb.dataset.cat;
      const id  = cb.dataset.include;
      if (id === '__all__') {
        // bulk toggle: this checkbox only acts as a "select all / none" trigger
        const allOn = cb.checked;
        const items = cat === 'units' ? gatherUnits()
                    : cat === 'rules' ? gatherRules()
                    :                   gatherStratagems();
        include[cat] = allOn ? new Set(items.map(x => x.id)) : new Set();
        renderSidebar();
      } else {
        if (cb.checked) include[cat].add(id);
        else            include[cat].delete(id);
      }
      renderPreview();
      renderSummary();
    });

    // Action buttons
    modalEl.querySelector('#dcc-print').addEventListener('click', onPrint);
    modalEl.querySelector('#dcc-pdf').addEventListener('click', onExportPDF);

    return modalEl;
  }

  function renderTabsState() {
    modalEl.querySelectorAll('.dcc-tab').forEach(btn => {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  function renderSidebar() {
    const side = modalEl.querySelector('#dcc-side');
    let items, cat, emptyMsg;
    if (activeTab === 'units')      { cat = 'units';  items = gatherUnits();      emptyMsg = 'No units in your army yet.'; }
    else if (activeTab === 'rules') { cat = 'rules';  items = gatherRules();      emptyMsg = 'Select a faction and detachment to load rules.'; }
    else                            { cat = 'strats'; items = gatherStratagems(); emptyMsg = 'No stratagems available.'; }

    if (!include[cat]) include[cat] = new Set(items.map(x => x.id));

    if (items.length === 0) {
      side.innerHTML = `<div class="dcc-empty">${esc(emptyMsg)}</div>`;
      return;
    }
    const allOn = items.every(it => include[cat].has(it.id));
    side.innerHTML = `
      <div class="dcc-side-head">
        <label class="dcc-row dcc-row-all">
          <input type="checkbox" data-include="__all__" data-cat="${cat}" ${allOn ? 'checked' : ''}>
          <span><strong>${activeTab === 'units' ? 'All units' : activeTab === 'rules' ? 'All rules' : 'All stratagems'}</strong>
            <span class="dcc-counts">${items.filter(it => include[cat].has(it.id)).length}/${items.length}</span>
          </span>
        </label>
      </div>
      <ul class="dcc-list">
        ${items.map(it => {
          const checked = include[cat].has(it.id) ? 'checked' : '';
          return `<li><label class="dcc-row">
            <input type="checkbox" data-include="${esc(it.id)}" data-cat="${cat}" ${checked}>
            <span>${esc(it.label)}</span>
          </label></li>`;
        }).join('')}
      </ul>`;
  }

  function renderSummary() {
    const sum = modalEl.querySelector('#dcc-summary');
    if (!sum) return;
    const cards = selectedCards();
    const layout = getLayout();
    const cardsPerPage = layout.cols * layout.rows;
    const pages = Math.max(1, Math.ceil(cards.length / cardsPerPage));
    sum.textContent = `${cards.length} cards · ${pages} page${pages === 1 ? '' : 's'}`;
  }

  function renderPreview() {
    const out = modalEl.querySelector('#dcc-preview');
    if (!out) return;
    out.innerHTML = '';
    const { frag, cardCount } = buildPagesDOM();
    if (cardCount === 0) {
      out.innerHTML = '<div class="dcc-empty">Nothing selected. Tick at least one item in the sidebar.</div>';
      renderSummary();
      return;
    }
    out.appendChild(frag);
    renderSummary();
  }

  function renderAll() {
    syncIncludeDefaults();
    renderTabsState();
    renderSidebar();
    // Keep the layout dropdown in sync with state (e.g. on second open).
    const sel = modalEl.querySelector('#dcc-layout-select');
    if (sel) sel.value = activeLayoutId;
    renderPreview();
  }

  // ── Print + PDF ──────────────────────────────────────────────────────────
  function buildExportStage() {
    // Standalone container that html2pdf renders. Full physical size, no
    // preview-scale wrapper. Each `.dcc-page` is one PDF page.
    const layout = getLayout();
    const stage = document.createElement('div');
    stage.className = 'dcc-stage';
    // Give the stage a definite bounding box so html2canvas knows what to
    // capture. Width matches the page; height grows with content.
    stage.style.width = layout.w + 'mm';
    const { frag } = buildPagesDOM();
    stage.appendChild(frag);
    // Strip the preview transform inline on every page in this stage.
    // html2canvas can otherwise render the scaled-down version even though
    // the .dcc-stage .dcc-page CSS override is supposed to undo it.
    stage.querySelectorAll('.dcc-page').forEach(p => {
      p.style.transform = 'none';
      p.style.margin = '0';
      p.style.boxShadow = 'none';
    });
    return stage;
  }

  function onPrint() {
    const cards = selectedCards();
    if (cards.length === 0) { toast('Nothing selected', 'warning'); return; }

    const layout = getLayout();
    const stage = buildExportStage();

    // Open a new window with isolated styles so the host app's CSS doesn't
    // bleed in. We grab the data-card-creator stylesheet from the parent.
    const w = window.open('', '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups for printing', 'warning', 4000); return; }

    const dccCss = collectDCCStyles();
    const pageCss = `@page { size: ${layout.w}mm ${layout.h}mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .dcc-stage { background: #fff; }
      .dcc-page { box-shadow: none !important; margin: 0 !important; page-break-after: always; }
      .dcc-page:last-child { page-break-after: auto; }`;

    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Data cards</title>
      <style>${pageCss}</style>
      <style>${dccCss}</style>
    </head><body></body></html>`);
    w.document.close();
    w.document.body.appendChild(stage);
    // Give the new window a beat to lay out fonts before triggering print.
    setTimeout(() => {
      try { w.focus(); w.print(); } catch (_) {}
    }, 250);
  }

  function collectDCCStyles() {
    // Pull every <link rel=stylesheet> and <style> with our css filename.
    let out = '';
    Array.from(document.styleSheets).forEach(ss => {
      const href = ss.href || '';
      if (!/data-card-creator\.css/.test(href)) return;
      try {
        const rules = ss.cssRules || [];
        for (let i = 0; i < rules.length; i++) out += rules[i].cssText + '\n';
      } catch (_) {
        // Cross-origin — fall back to fetched text.
      }
    });
    return out;
  }

  function onExportPDF() {
    const cards = selectedCards();
    if (cards.length === 0) { toast('Nothing selected', 'warning'); return; }
    if (typeof window.html2pdf !== 'function') {
      toast('PDF library still loading — try again in a second', 'warning', 3500);
      return;
    }

    const layout = getLayout();
    const stage = buildExportStage();
    // Off-screen positioning lives in CSS (.dcc-stage). Just attach it.
    document.body.appendChild(stage);

    const army = getCurrentArmy();
    const filename = ('YAAB-cards-' + (army && army.name ? army.name : 'army') + '.pdf')
      .replace(/[\\/:*?"<>|]/g, '-');

    const opts = {
      margin: 0,
      filename,
      image:   { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false },
      jsPDF:   { unit: 'mm', format: [layout.w, layout.h], orientation: layout.w > layout.h ? 'landscape' : 'portrait', compress: true },
      pagebreak: {
        mode: ['css', 'legacy'],
        before: '.dcc-page',
        avoid:  '.dcc-card, .dcc-section, tr',
      },
    };

    const pdfBtn = modalEl.querySelector('#dcc-pdf');
    if (pdfBtn) pdfBtn.disabled = true;
    toast('Rendering PDF…', 'info', 1800);

    window.html2pdf()
      .set(opts)
      .from(stage)
      .save()
      .then(() => toast('Saved ' + filename, 'success', 3500))
      .catch(err => {
        console.warn('[data-card-creator]', err);
        toast('PDF export failed', 'error', 4000);
      })
      .finally(() => {
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        if (pdfBtn) pdfBtn.disabled = false;
      });
  }

  // ── Open/close ───────────────────────────────────────────────────────────
  function open() {
    ensureModal();
    renderAll();
    if (modalEl.hasAttribute('hidden')) {
      lastFocused = document.activeElement;
      modalEl.removeAttribute('hidden');
      document.body.classList.add('dcc-modal-open');
      document.addEventListener('keydown', onKeydown, true);
      const closeBtn = modalEl.querySelector('.dcc-close');
      if (closeBtn) { try { closeBtn.focus(); } catch (_) {} }
    }
  }
  function close() {
    if (!modalEl || modalEl.hasAttribute('hidden')) return;
    modalEl.setAttribute('hidden', '');
    document.body.classList.remove('dcc-modal-open');
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) {}
    }
    lastFocused = null;
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  // Reset the include sets when the army changes so newly-added units show
  // up checked by default without persisting stale ids.
  if (Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(() => {
      include = { units: null, rules: null, strats: null };
      if (modalEl && !modalEl.hasAttribute('hidden')) renderAll();
    });
  }

  // ── Public + hook registration ───────────────────────────────────────────
  App.openDataCardCreator = open;

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'primary',
    label: 'Data cards',
    category: 'export',
    title: 'Create printable data cards for units, rules, and stratagems',
    onClick: open,
  });
})();
