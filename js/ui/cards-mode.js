// ui/cards-mode.js — Cards: full-page mode for printable data cards.
//
// Owns the #cards-mode container. Renders a left settings rail (layout +
// pickers + display toggles) and a right preview pane that shows real,
// physical-sized pages of cards. Print and "Save PDF" both go through the
// browser's native print system: we add a body class + an injected @page
// rule, call window.print(), and rely on @media print CSS in
// cards-mode.css to hide everything except the cards. This is the most
// reliable way to render mm-precise multi-page output in any browser
// (Save as PDF is a built-in destination in Chrome/Edge/Safari/Firefox).
//
// Card content rendering (renderUnitCard / renderRuleCard /
// renderStratagemCard) lives here. The .dcc-* class names are reused for
// the actual card chrome so the visual rules stay in one place.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const HOST_ID = 'cards-mode';

  // ── Layout presets ───────────────────────────────────────────────────────
  // Page sizes in millimetres (CSS @page works in mm). Each preset is the
  // physical sheet that goes through the printer; cols × rows is the grid
  // of cards on it. A 4×6 index card with cols=rows=1 means one card per
  // sheet.
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
  const DEFAULT_LAYOUT  = '4x6-portrait';
  const PAGE_MARGIN_MM  = 5;
  const CARD_GUTTER_MM  = 3;

  // ── Display toggles ──────────────────────────────────────────────────────
  // Every section the user can hide. Grouped by card kind so the Display
  // sub-tab can render them under headings.
  const DISPLAY_GROUPS = [
    { kind: 'unit', label: 'Unit cards', keys: [
      ['points',      'Points cost'],
      ['role',        'Role / type subtitle'],
      ['invuln',      'Invulnerable save badge'],
      ['stats',       'Stat block (M/T/SV/W/LD/OC)'],
      ['ranged',      'Ranged weapons'],
      ['melee',       'Melee weapons'],
      ['weaponKw',    'Weapon keywords (under name)'],
      ['abilities',   'Abilities'],
      ['coreAbil',    'Core abilities row'],
      ['wargear',     'Wargear options / loadout'],
      ['enhancements','Enhancement'],
      ['factionKw',   'Faction keywords footer'],
      ['unitKw',      'Unit keywords footer'],
    ]},
    { kind: 'strat', label: 'Stratagem cards', keys: [
      ['cp',         'CP cost'],
      ['phase',      'Phase'],
      ['type',       'Type label (CORE / FACTION / DETACHMENT)'],
    ]},
    { kind: 'rule', label: 'Rule cards', keys: [
      ['kindLabel',  'Subtitle (ARMY RULE / DETACHMENT RULE)'],
    ]},
  ];
  const DEFAULT_DISPLAY = (() => {
    const d = {}; DISPLAY_GROUPS.forEach(g => g.keys.forEach(([k]) => { d[k] = true; })); return d;
  })();

  // ── Mutable state ────────────────────────────────────────────────────────
  let hostEl = null;             // the #cards-mode <section>
  let mounted = false;           // false until the first renderHost()
  let activeSubTab = 'cards';    // 'cards' | 'layout' | 'display'
  let activeCardCat = 'units';   // sub-category within Cards: 'units' | 'rules' | 'strats'
  let activeLayoutId = DEFAULT_LAYOUT;
  // Per-category layout overrides. null = inherit the global activeLayoutId.
  // Lets the user, e.g., put units 1-up on 4×6 portrait while putting rules
  // and stratagems 2-up on 4×6 landscape (their typical printing flow).
  let layoutByKind = { unit: null, rule: null, strat: null };
  let include = { units: null, rules: null, strats: null };
  let display = Object.assign({}, DEFAULT_DISPLAY);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
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
    return ((App.state && App.state.factions) || []).find(f => f.factionName === army.factionName) || null;
  }
  function getLayout() { return LAYOUTS.find(l => l.id === activeLayoutId) || LAYOUTS[0]; }
  function getLayoutFor(kind) {
    const id = layoutByKind[kind] || activeLayoutId;
    return LAYOUTS.find(l => l.id === id) || getLayout();
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
  function syncIncludeDefaults() {
    function defaultAll(items, key) {
      if (!include[key]) include[key] = new Set(items.map(x => x.id));
    }
    defaultAll(gatherUnits(),       'units');
    defaultAll(gatherRules(),       'rules');
    defaultAll(gatherStratagems(),  'strats');
  }

  // ── Card content renderers ──────────────────────────────────────────────
  // Output is HTML for the inside of a `<article class="dcc-card">` node.
  // Card chrome is styled in css/cards-mode.css under the .dcc-* names.

  const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
  function getStatVal(stats, key) {
    const aliases = (UI && UI._STAT_ALIASES && UI._STAT_ALIASES[key]) || [key];
    for (let i = 0; i < aliases.length; i++) {
      const v = stats[aliases[i]];
      if (v != null && v !== '') return v;
    }
    return '—';
  }

  function classifyWeapons(unit) {
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
      const cells = COLS.map(c => `<td class="dcc-num">${esc(w[c] != null && w[c] !== '' ? w[c] : '—')}</td>`).join('');
      const kw = (display.weaponKw && w.Keywords) ? `<div class="dcc-w-kw">${esc(w.Keywords)}</div>` : '';
      return `<tr class="dcc-w-row">
        <td class="dcc-w-name">${esc(w.name)}${kw}</td>
        ${cells}
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

  function renderWargearBlock(unit) {
    if (!display.wargear) return '';
    const lines = [];

    const gdcComp = Array.isArray(unit.gdcComposition) ? unit.gdcComposition : null;
    if (gdcComp && gdcComp.length > 0) {
      lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${esc(gdcComp.join(' · '))}</div>`);
    } else if (Array.isArray(unit.squadOptions)) {
      const models = [...new Set(unit.squadOptions.map(o => o.models).filter(m => m != null))].sort((a, b) => a - b);
      if (models.length === 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]} model${models[0] !== 1 ? 's' : ''}</div>`);
      else if (models.length > 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]}–${models[models.length - 1]} models</div>`);
    }
    if (typeof unit.gdcLoadout === 'string' && unit.gdcLoadout.trim()) {
      lines.push(`<div class="dcc-wargear-line dcc-wargear-default"><strong>Default:</strong> ${esc(unit.gdcLoadout)}</div>`);
    }

    const gdcWg = Array.isArray(unit.gdcWargear) ? unit.gdcWargear : null;
    if (gdcWg && gdcWg.length > 0) {
      gdcWg.forEach(line => {
        const parts = String(line).split(/\s*◦\s*/);
        const head = (parts[0] || '').replace(/:\s*$/, '').trim();
        const subs = parts.slice(1).map(s => s.trim()).filter(Boolean);
        let html = '<div class="dcc-wargear-line">';
        if (head) html += esc(head);
        if (subs.length > 0) html += `<ul class="dcc-wargear-sub">${subs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
        html += '</div>';
        lines.push(html);
      });
    } else {
      const opts = Array.isArray(unit.wargearOptions) ? unit.wargearOptions : [];
      const modelTypeOpts = opts.filter(o => o && o.type === 'model');
      const choiceOpts    = opts.filter(o => o && o.type !== 'model');
      modelTypeOpts.forEach(opt => {
        let count = '';
        if (opt.modelMin != null && opt.modelMax != null) {
          if (opt.modelMin === opt.modelMax)        count = `${opt.modelMin} model${opt.modelMin !== 1 ? 's' : ''}`;
          else if (opt.modelMin === 0)              count = `up to ${opt.modelMax} model${opt.modelMax !== 1 ? 's' : ''}`;
          else                                      count = `${opt.modelMin}–${opt.modelMax} models`;
        }
        let html = `<div class="dcc-wargear-line"><strong>${esc(opt.modelName || 'Model')}</strong>`;
        if (count) html += ` <span style="opacity:0.7">(${esc(count)})</span>`;
        if (opt.defaultWeapons && opt.defaultWeapons.length) {
          html += `<div class="dcc-wargear-line dcc-wargear-default" style="margin-left:1.6mm"><em>Default:</em> ${esc(opt.defaultWeapons.join(' · '))}</div>`;
        }
        (opt.subOptions || []).forEach(sub => {
          const ctx = sub.max === 1 ? ' — choose one' : sub.max > 1 ? ` — choose up to ${sub.max}` : '';
          html += `<div style="margin-left:1.6mm"><em>${esc(sub.name)}${ctx}</em>`;
          if (Array.isArray(sub.choices) && sub.choices.length) {
            html += `<ul class="dcc-wargear-sub">${sub.choices.map(c => `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`).join('')}</ul>`;
          }
          html += '</div>';
        });
        html += '</div>';
        lines.push(html);
      });
      choiceOpts.forEach(opt => {
        const name = typeof opt === 'object' ? (opt.name || '') : opt;
        const choices = typeof opt === 'object' && opt.choices ? opt.choices : [];
        const maxStr = (typeof opt === 'object' && opt.max != null) ? ` (max ${opt.max})` : '';
        let html = `<div class="dcc-wargear-line"><strong>${esc(name)}</strong>${maxStr ? `<span style="opacity:0.7"> ${esc(maxStr)}</span>` : ''}`;
        if (choices.length) html += `<ul class="dcc-wargear-sub">${choices.map(c => `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`).join('')}</ul>`;
        html += '</div>';
        lines.push(html);
      });
    }

    if (lines.length === 0) return '';
    return `<div class="dcc-section dcc-wargear">
      <div class="dcc-section-head"><span class="dcc-section-label">WARGEAR</span></div>
      <div class="dcc-wargear-body">${lines.join('')}</div>
    </div>`;
  }

  function renderAbilitiesBlock(unit) {
    if (!display.abilities) return '';
    const abil = (unit.abilities || []).filter(a => a && a.name);
    if (abil.length === 0) return '';
    const core = [], named = [];
    abil.forEach(a => { (a.isCore ? core : named).push(a); });
    const coreVisible = display.coreAbil && core.length > 0;
    if (!coreVisible && named.length === 0) return '';
    let html = `<div class="dcc-section dcc-abilities">
      <div class="dcc-section-head"><span class="dcc-section-label">ABILITIES</span></div>
      <div class="dcc-abilities-body">`;
    if (coreVisible) {
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
    const ptsLabel = entry.selectedPts != null ? entry.selectedPts : (ptsOpts.length ? ptsOpts[0] : null);

    const showEnh = display.enhancements && Array.isArray(entry.enhancements) && entry.enhancements.length > 0;
    const enhancementHtml = showEnh
      ? `<div class="dcc-section dcc-enhancements">
          <div class="dcc-section-head"><span class="dcc-section-label">ENHANCEMENT</span></div>
          <div class="dcc-abilities-body">${
            entry.enhancements.map(e => `<div class="dcc-ability-row"><strong>${esc(e.name)}${e.pts ? ' (+' + e.pts + ')' : ''}:</strong> ${esc(e.description || '')}</div>`).join('')
          }</div>
        </div>`
      : '';

    const allKw = (unit.keywords || []).filter(Boolean);
    const factionKw = unit._factionName ? [unit._factionName] : [];
    const showFKw = display.factionKw && factionKw.length > 0;
    const showUKw = display.unitKw && allKw.length > 0;
    const fkwFooter = showFKw ? `<div class="dcc-keywords dcc-faction-kw"><strong>FACTION KEYWORDS:</strong> ${esc(factionKw.join(', '))}</div>` : '';
    const kwFooter = showUKw ? `<div class="dcc-keywords"><strong>KEYWORDS:</strong> ${esc(allKw.join(', '))}</div>` : '';
    const footerHtml = (showFKw || showUKw) ? `<footer class="dcc-foot">${fkwFooter}${kwFooter}</footer>` : '';

    const inv = (display.invuln && unit.invulnSave) ? `<span class="dcc-inv" title="Invulnerable Save">${esc(unit.invulnSave)} INV</span>` : '';
    const role = display.role ? `<span class="dcc-role">${esc(unit.type || '')}</span>` : '';
    const ptsHtml = (display.points && ptsLabel != null) ? `<span class="dcc-pts">${esc(String(ptsLabel))} pts</span>` : '';
    const showSubLine = !!(role || inv);

    const statsHtml = (display.stats && presentStats.length > 0)
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
          <h1 class="dcc-name">${esc(unit.name || entry.unitName || 'Unit')}</h1>
          ${ptsHtml}
        </div>
        ${showSubLine ? `<div class="dcc-sub-line">${role}${inv}</div>` : ''}
      </header>
      ${statsHtml}
      ${display.ranged ? renderWeaponsBlock(ranged, 'ranged') : ''}
      ${display.melee  ? renderWeaponsBlock(melee, 'melee')   : ''}
      ${renderAbilitiesBlock(unit)}
      ${renderWargearBlock(unit)}
      ${enhancementHtml}
      ${footerHtml}`;
  }

  function renderRuleCard(item) {
    const r = item.rule || {};
    const kindLabel = item.kind === 'detachment' ? 'DETACHMENT RULE' : 'ARMY RULE';
    const subLine = display.kindLabel ? `<div class="dcc-sub-line"><span class="dcc-role">${kindLabel}</span></div>` : '';
    return `
      <header class="dcc-head dcc-head-rule">
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(r.name || item.label)}</h1>
        </div>
        ${subLine}
      </header>
      <div class="dcc-section dcc-rule-body">
        <div class="dcc-rule-text">${esc(r.description || '')}</div>
      </div>`;
  }

  function renderStratagemCard(item) {
    const s = item.strat || {};
    const cp = s.cp != null ? s.cp : '?';
    const typeLabel = item.type === 'core' ? 'CORE' : item.type === 'detachment' ? 'DETACHMENT' : 'FACTION';
    const cpHtml = display.cp ? `<span class="dcc-cp"><span class="dcc-cp-num">${esc(String(cp))}</span><span class="dcc-cp-lbl">CP</span></span>` : '';
    const typeHtml = display.type ? `<span class="dcc-role">${esc(typeLabel)} STRATAGEM</span>` : '';
    const phaseHtml = (display.phase && s.phase) ? `<span class="dcc-strat-phase">PHASE: ${esc(String(s.phase).toUpperCase())}</span>` : '';
    const subLine = (typeHtml || phaseHtml) ? `<div class="dcc-sub-line">${typeHtml}${phaseHtml}</div>` : '';
    return `
      <header class="dcc-head dcc-head-strat">
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(s.name)}</h1>
          ${cpHtml}
        </div>
        ${subLine}
      </header>
      <div class="dcc-section dcc-strat-body">
        <div class="dcc-rule-text">${esc(s.description || '')}</div>
      </div>`;
  }

  // ── Card list assembly ──────────────────────────────────────────────────
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

  // ── Page DOM building ───────────────────────────────────────────────────
  // Each `.dcc-page` is the full physical sheet at 1:1 (mm units in inline
  // styles). Cards are laid out by CSS grid inside. Pages are wrapped in
  // a `.dcc-page-frame` for the on-screen preview, which scales them
  // visually via CSS `transform: scale()`. The print path (browser-native
  // window.print) doesn't need the wrapper — print CSS in cards-mode.css
  // unwraps it via `transform: none`.
  function buildPageElement(layout, cards, pageNum) {
    const cardsPerPage = layout.cols * layout.rows;
    const frame = document.createElement('div');
    frame.className = 'dcc-page-frame';
    frame.style.setProperty('--dcc-page-w', layout.w + 'mm');
    frame.style.setProperty('--dcc-page-h', layout.h + 'mm');

    const pageEl = document.createElement('div');
    pageEl.className = 'dcc-page';
    pageEl.style.width  = layout.w + 'mm';
    pageEl.style.height = layout.h + 'mm';
    pageEl.style.padding = PAGE_MARGIN_MM + 'mm';
    pageEl.style.gridTemplateColumns = 'repeat(' + layout.cols + ', 1fr)';
    pageEl.style.gridTemplateRows    = 'repeat(' + layout.rows + ', 1fr)';
    pageEl.style.gap = CARD_GUTTER_MM + 'mm';
    pageEl.dataset.page = String(pageNum);
    pageEl.dataset.layout = layout.id;

    cards.forEach(card => {
      const cardEl = document.createElement('article');
      cardEl.className = 'dcc-card dcc-card-' + card.kind;
      cardEl.innerHTML = card.html;
      pageEl.appendChild(cardEl);
    });
    // Pad with empty grid placeholders so the last page keeps its layout.
    for (let k = cards.length; k < cardsPerPage; k++) {
      const ph = document.createElement('div');
      ph.className = 'dcc-card dcc-card-empty';
      pageEl.appendChild(ph);
    }
    frame.appendChild(pageEl);
    return frame;
  }

  // Build pages for the active selection, paginating each card kind by
  // its own (possibly overridden) layout. Pages are emitted in the order
  // unit → rule → strat so the user can flip through them naturally.
  function buildPagesDOM() {
    const all = selectedCards();
    const groups = [
      { kind: 'unit',  cards: all.filter(c => c.kind === 'unit'),  layout: getLayoutFor('unit')  },
      { kind: 'rule',  cards: all.filter(c => c.kind === 'rule'),  layout: getLayoutFor('rule')  },
      { kind: 'strat', cards: all.filter(c => c.kind === 'strat'), layout: getLayoutFor('strat') },
    ];

    const frag = document.createDocumentFragment();
    let pageCount = 0;
    let pageNum = 0;
    groups.forEach(g => {
      if (g.cards.length === 0) return;
      const cpp = g.layout.cols * g.layout.rows;
      for (let i = 0; i < g.cards.length; i += cpp) {
        pageNum++;
        frag.appendChild(buildPageElement(g.layout, g.cards.slice(i, i + cpp), pageNum));
        pageCount++;
      }
    });
    return { frag, pageCount, cardCount: all.length };
  }

  // ── Mode UI shell ────────────────────────────────────────────────────────
  function renderHost() {
    if (!hostEl) return;
    syncIncludeDefaults();
    hostEl.classList.add('cards-mode-host');
    // Replace placeholder content on first render only; afterwards the
    // sub-renderers handle in-place updates.
    if (!hostEl.querySelector('.cards-shell')) {
      hostEl.innerHTML = `
        <div class="cards-shell">
          <aside class="cards-side" aria-label="Card settings">
            <header class="cards-side-head">
              <h2 class="cards-title">Cards</h2>
              <p class="cards-summary" id="cards-summary"></p>
            </header>

            <nav class="cards-subtabs" role="tablist" aria-label="Settings section">
              <button type="button" class="cards-subtab" data-subtab="cards"   role="tab">Pick cards</button>
              <button type="button" class="cards-subtab" data-subtab="layout"  role="tab">Layout</button>
              <button type="button" class="cards-subtab" data-subtab="display" role="tab">Display</button>
            </nav>

            <div class="cards-side-body" id="cards-side-body"></div>

            <footer class="cards-side-foot">
              <button type="button" class="cards-btn cards-btn-primary" id="cards-print-btn"
                      title="Open the browser print dialog. Choose 'Save as PDF' as the destination to save instead of printing.">
                Print / Save as PDF
              </button>
            </footer>
          </aside>

          <main class="cards-preview-wrap" aria-label="Card preview">
            <div class="cards-preview" id="cards-preview"></div>
          </main>
        </div>`;

      hostEl.querySelector('.cards-subtabs').addEventListener('click', e => {
        const btn = e.target.closest('.cards-subtab');
        if (!btn) return;
        activeSubTab = btn.dataset.subtab || 'cards';
        refreshSidebar();
      });
      hostEl.querySelector('#cards-side-body').addEventListener('change', onSidebarChange);
      hostEl.querySelector('#cards-side-body').addEventListener('click', onSidebarClick);
      hostEl.querySelector('#cards-print-btn').addEventListener('click', onPrint);
    }
    refreshSidebar();
    refreshPreview();
    refreshSummary();
    mounted = true;
  }

  function refreshSidebar() {
    if (!hostEl) return;
    // Active subtab style.
    hostEl.querySelectorAll('.cards-subtab').forEach(btn => {
      const on = btn.dataset.subtab === activeSubTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    const body = hostEl.querySelector('#cards-side-body');
    if (!body) return;
    body.innerHTML = activeSubTab === 'display' ? renderDisplayPanel()
                  : activeSubTab === 'layout'  ? renderLayoutPanel()
                  :                              renderPickPanel();
  }

  function renderLayoutPanel() {
    const opts = LAYOUTS.map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('');
    const optsWithGlobal = `<option value="">Use global default</option>` + opts;
    const overrideRow = (kind, label) => `
      <label class="cards-field">
        <span class="cards-field-label">${esc(label)}</span>
        <select class="cards-select" data-layout-override="${kind}">
          ${optsWithGlobal}
        </select>
      </label>`;
    const html = `
      <div class="cards-layout-section">
        <div class="cards-disp-heading">Default sheet</div>
        <p class="cards-help">Used for any category that doesn't set its own override below.</p>
        <label class="cards-field">
          <span class="cards-field-label">Layout</span>
          <select class="cards-select" id="cards-layout-global">
            ${opts}
          </select>
        </label>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Per-category override</div>
        <p class="cards-help">
          Pick a different layout for each card kind. Useful for printing
          rules and stratagems 2-up while keeping unit cards 1-up. Cards
          of each kind are paginated independently and printed in order
          (units → rules → stratagems).
        </p>
        ${overrideRow('unit',  'Units')}
        ${overrideRow('rule',  'Army rules')}
        ${overrideRow('strat', 'Stratagems')}
      </div>`;
    // Defer setting the <select> values until after the HTML lands in the DOM.
    queueMicrotask(() => {
      const g = hostEl.querySelector('#cards-layout-global');
      if (g) g.value = activeLayoutId;
      hostEl.querySelectorAll('select[data-layout-override]').forEach(sel => {
        const kind = sel.getAttribute('data-layout-override');
        sel.value = layoutByKind[kind] || '';
      });
    });
    return html;
  }

  function renderPickPanel() {
    // Inner category tabs (Units / Rules / Stratagems) + checkbox list.
    const cats = [
      { key: 'units',  label: 'Units',     items: gatherUnits()       },
      { key: 'rules',  label: 'Army rules', items: gatherRules()       },
      { key: 'strats', label: 'Stratagems', items: gatherStratagems() },
    ];
    const tabs = cats.map(c => {
      const on = c.key === activeCardCat;
      const count = (include[c.key] ? c.items.filter(it => include[c.key].has(it.id)).length : 0);
      return `<button type="button" class="cards-cat-tab${on ? ' is-active' : ''}" data-cat="${c.key}" role="tab" aria-selected="${on}">
        ${esc(c.label)}<span class="cards-cat-count">${count}/${c.items.length}</span>
      </button>`;
    }).join('');
    const active = cats.find(c => c.key === activeCardCat) || cats[0];
    const items = active.items;
    let body;
    if (items.length === 0) {
      const msg = active.key === 'units' ? 'No units in your army yet.'
                : active.key === 'rules' ? 'Select a faction and detachment to load rules.'
                : 'No stratagems available.';
      body = `<div class="cards-empty">${esc(msg)}</div>`;
    } else {
      const allOn = items.every(it => include[active.key].has(it.id));
      body = `
        <div class="cards-list-head">
          <label class="cards-row cards-row-all">
            <input type="checkbox" data-include="__all__" data-cat="${active.key}" ${allOn ? 'checked' : ''}>
            <span><strong>All ${esc(active.label.toLowerCase())}</strong></span>
          </label>
        </div>
        <ul class="cards-list">
          ${items.map(it => {
            const checked = include[active.key].has(it.id) ? 'checked' : '';
            return `<li><label class="cards-row">
              <input type="checkbox" data-include="${esc(it.id)}" data-cat="${active.key}" ${checked}>
              <span>${esc(it.label)}</span>
            </label></li>`;
          }).join('')}
        </ul>`;
    }
    return `
      <nav class="cards-cat-tabs" role="tablist" aria-label="Card category">${tabs}</nav>
      ${body}`;
  }

  function renderDisplayPanel() {
    const groups = DISPLAY_GROUPS.map(g => {
      const rows = g.keys.map(([key, label]) => `
        <li><label class="cards-row">
          <input type="checkbox" data-display="${esc(key)}" ${display[key] ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label></li>`).join('');
      return `<div class="cards-disp-group">
        <div class="cards-disp-heading">${esc(g.label)}</div>
        <ul class="cards-list">${rows}</ul>
      </div>`;
    }).join('');
    return `
      <div class="cards-list-head">
        <button type="button" class="cards-link-btn" id="cards-display-reset">Reset to defaults</button>
      </div>
      ${groups}`;
  }

  function onSidebarChange(e) {
    // Layout: global preset
    if (e.target && e.target.id === 'cards-layout-global') {
      activeLayoutId = e.target.value || DEFAULT_LAYOUT;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Layout: per-category override (empty value = inherit global)
    const ovSel = e.target && e.target.matches && e.target.matches('select[data-layout-override]') ? e.target : null;
    if (ovSel) {
      const kind = ovSel.getAttribute('data-layout-override');
      layoutByKind[kind] = ovSel.value || null;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Display toggles
    const dispCb = e.target.closest('input[type="checkbox"][data-display]');
    if (dispCb) {
      display[dispCb.dataset.display] = !!dispCb.checked;
      refreshPreview();
      return;
    }
    // Per-card include checkboxes
    const cb = e.target.closest('input[type="checkbox"][data-include]');
    if (cb) {
      const cat = cb.dataset.cat;
      const id  = cb.dataset.include;
      if (id === '__all__') {
        const allOn = cb.checked;
        const items = cat === 'units' ? gatherUnits()
                    : cat === 'rules' ? gatherRules()
                    :                   gatherStratagems();
        include[cat] = allOn ? new Set(items.map(x => x.id)) : new Set();
        refreshSidebar();
      } else {
        if (cb.checked) include[cat].add(id);
        else            include[cat].delete(id);
        // Update the count chip on the active category tab without a full re-render.
        const tab = hostEl.querySelector(`.cards-cat-tab[data-cat="${cat}"] .cards-cat-count`);
        if (tab) {
          const items = cat === 'units' ? gatherUnits() : cat === 'rules' ? gatherRules() : gatherStratagems();
          tab.textContent = `${items.filter(it => include[cat].has(it.id)).length}/${items.length}`;
        }
      }
      refreshPreview();
      refreshSummary();
    }
  }
  function onSidebarClick(e) {
    // Inner category tabs (Pick cards: Units/Rules/Stratagems)
    const catTab = e.target.closest('.cards-cat-tab');
    if (catTab) {
      activeCardCat = catTab.dataset.cat || 'units';
      refreshSidebar();
      return;
    }
    // Display "reset to defaults"
    if (e.target && e.target.id === 'cards-display-reset') {
      display = Object.assign({}, DEFAULT_DISPLAY);
      refreshSidebar();
      refreshPreview();
    }
  }

  function refreshPreview() {
    const out = hostEl && hostEl.querySelector('#cards-preview');
    if (!out) return;
    out.innerHTML = '';
    const { frag, cardCount } = buildPagesDOM();
    if (cardCount === 0) {
      out.innerHTML = '<div class="cards-empty cards-empty-large">Nothing selected yet. Pick at least one item from the sidebar.</div>';
      return;
    }
    out.appendChild(frag);
  }
  function refreshSummary() {
    const sum = hostEl && hostEl.querySelector('#cards-summary');
    if (!sum) return;
    const all = selectedCards();
    let pages = 0;
    ['unit','rule','strat'].forEach(kind => {
      const cards = all.filter(c => c.kind === kind);
      if (cards.length === 0) return;
      const layout = getLayoutFor(kind);
      pages += Math.ceil(cards.length / (layout.cols * layout.rows));
    });
    if (pages === 0) pages = 0;
    sum.textContent = `${all.length} card${all.length === 1 ? '' : 's'} · ${pages} page${pages === 1 ? '' : 's'}`;
  }

  // ── Print / Save PDF ─────────────────────────────────────────────────────
  // Native browser print. Inject an @page rule with the active layout's
  // page size, add `body.cards-printing` so the @media print CSS in
  // cards-mode.css can hide everything except .dcc-page elements, and
  // call window.print(). Cleanup when the dialog closes (afterprint).
  function onPrint() {
    const cards = selectedCards();
    if (cards.length === 0) {
      if (UI && UI.toast) UI.toast('Nothing selected', 'warning');
      return;
    }

    // Collect every distinct paper size in play. If categories use the
    // same w/h (e.g. all 4×6 with different grids — the common case),
    // we emit one global @page rule. If categories truly mix paper
    // sizes, we emit a named @page per size and tag each .dcc-page with
    // `page: <name>` via a generated rule keyed off data-layout.
    const sizes = new Map();   // key "wxh" → { w, h, name, layoutIds:[] }
    ['unit','rule','strat'].forEach(kind => {
      const groupCards = cards.filter(c => c.kind === kind);
      if (groupCards.length === 0) return;
      const l = getLayoutFor(kind);
      const key = l.w + 'x' + l.h;
      if (!sizes.has(key)) sizes.set(key, { w: l.w, h: l.h, name: 'cardspage' + sizes.size, layoutIds: [] });
      sizes.get(key).layoutIds.push(l.id);
    });

    let pageCss = '';
    if (sizes.size <= 1) {
      const only = [...sizes.values()][0] || { w: getLayout().w, h: getLayout().h };
      pageCss = '@page { size: ' + only.w + 'mm ' + only.h + 'mm; margin: 0; }';
    } else {
      sizes.forEach(s => {
        pageCss += '@page ' + s.name + ' { size: ' + s.w + 'mm ' + s.h + 'mm; margin: 0; }\n';
        s.layoutIds.forEach(id => {
          pageCss += 'body.cards-printing .dcc-page[data-layout="' + id + '"] { page: ' + s.name + '; }\n';
        });
      });
      // Pick the first as the document default, in case the printer
      // needs an unnamed @page fallback.
      const first = [...sizes.values()][0];
      pageCss += '@page { size: ' + first.w + 'mm ' + first.h + 'mm; margin: 0; }\n';
    }

    let style = document.getElementById('cards-print-style');
    if (style) style.remove();
    style = document.createElement('style');
    style.id = 'cards-print-style';
    style.textContent = pageCss;
    document.head.appendChild(style);
    document.body.classList.add('cards-printing');

    function cleanup() {
      document.body.classList.remove('cards-printing');
      const s = document.getElementById('cards-print-style');
      if (s) s.remove();
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    // Some browsers (Safari) don't fire afterprint reliably — also clean
    // up after a short timeout fallback.
    setTimeout(cleanup, 30000);

    // Defer one frame so the browser repaints with the body class applied.
    requestAnimationFrame(() => {
      try { window.print(); }
      catch (err) { console.warn('[cards-mode] print failed', err); cleanup(); }
    });
  }

  // ── Mount + lifecycle ────────────────────────────────────────────────────
  function mount() {
    hostEl = document.getElementById(HOST_ID);
    if (!hostEl) return;
    // Render lazily on first activation so we don't pay for it on every
    // app load — the host stays a placeholder until cards mode opens.
    if (typeof App.getMode === 'function' && App.getMode() === 'cards') {
      renderHost();
    }
  }

  if (Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(mount);
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  if (Array.isArray(App.hooks.modeChange)) {
    App.hooks.modeChange.push(mode => {
      if (mode !== 'cards') return;
      if (!hostEl) hostEl = document.getElementById(HOST_ID);
      if (hostEl) renderHost();
    });
  }
  if (Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(() => {
      include = { units: null, rules: null, strats: null };
      if (mounted && App.getMode && App.getMode() === 'cards') {
        refreshSidebar(); refreshPreview(); refreshSummary();
      }
    });
  }
  if (Array.isArray(App.hooks.selectionChange)) {
    App.hooks.selectionChange.push(() => {
      if (mounted && App.getMode && App.getMode() === 'cards') {
        refreshSidebar(); refreshPreview(); refreshSummary();
      }
    });
  }

  // Public API: external callers (Export menu, command palette) just flip
  // the mode. The mode-change hook handles rendering.
  App.openCardsMode = function () {
    if (typeof App.setMode === 'function') App.setMode('cards');
  };
})();
