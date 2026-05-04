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
  let activeTab = 'units';      // 'units' | 'rules' | 'strats' | 'display'
  let activeLayoutId = DEFAULT_LAYOUT;
  // Per-category include sets keyed by stable id (entry-index for units,
  // name for rules and stratagems). Defaults: everything in.
  let include = { units: null, rules: null, strats: null };

  // Display toggles — every section the user can hide. All keys default to
  // true (show everything). Grouped by card kind so the Display tab can
  // render them under headings.
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
      ['type',       'Type label (CORE/FACTION/DETACHMENT)'],
    ]},
    { kind: 'rule', label: 'Rule cards', keys: [
      ['kindLabel',  'Subtitle (ARMY RULE / DETACHMENT RULE)'],
    ]},
  ];
  const DEFAULT_DISPLAY = (() => {
    const d = {};
    DISPLAY_GROUPS.forEach(g => g.keys.forEach(([k]) => { d[k] = true; }));
    return d;
  })();
  let display = Object.assign({}, DEFAULT_DISPLAY);

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
      const kw = (display.weaponKw && w.Keywords) ? `<div class="dcc-w-kw">${esc(w.Keywords)}</div>` : '';
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

  // ── Wargear section ──────────────────────────────────────────────────
  // Shows what the unit ACTUALLY has equipped (from "default loadout") plus
  // any options it COULD swap to. Prefers GDC's pre-formatted strings when
  // available; falls back to the BSData wargearOptions tree.
  function renderWargearBlock(unit) {
    if (!display.wargear) return '';

    const lines = [];

    // Composition (e.g. "5 Models" / "1 Captain · 4 Battle-brothers").
    const gdcComp = Array.isArray(unit.gdcComposition) ? unit.gdcComposition : null;
    if (gdcComp && gdcComp.length > 0) {
      lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${esc(gdcComp.join(' · '))}</div>`);
    } else if (Array.isArray(unit.squadOptions)) {
      const models = [...new Set(unit.squadOptions.map(o => o.models).filter(m => m != null))].sort((a, b) => a - b);
      if (models.length === 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]} model${models[0] !== 1 ? 's' : ''}</div>`);
      else if (models.length > 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]}–${models[models.length - 1]} models</div>`);
    }

    // Default loadout (what's equipped out of the box).
    if (typeof unit.gdcLoadout === 'string' && unit.gdcLoadout.trim()) {
      lines.push(`<div class="dcc-wargear-line dcc-wargear-default"><strong>Default:</strong> ${esc(unit.gdcLoadout)}</div>`);
    }

    // GDC pre-formatted "X can swap Y for Z" lines, ◦-bulleted.
    const gdcWg = Array.isArray(unit.gdcWargear) ? unit.gdcWargear : null;
    if (gdcWg && gdcWg.length > 0) {
      gdcWg.forEach(line => {
        const parts = String(line).split(/\s*◦\s*/);
        const head = (parts[0] || '').replace(/:\s*$/, '').trim();
        const subs = parts.slice(1).map(s => s.trim()).filter(Boolean);
        let html = '<div class="dcc-wargear-line">';
        if (head) html += esc(head);
        if (subs.length > 0) {
          html += `<ul class="dcc-wargear-sub">${subs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
        }
        html += '</div>';
        lines.push(html);
      });
    } else {
      // BSData fallback — wargearOptions tree.
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
        if (choices.length) {
          html += `<ul class="dcc-wargear-sub">${choices.map(c => `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`).join('')}</ul>`;
        }
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
    const core = [];
    const named = [];
    abil.forEach(a => {
      if (a.isCore) core.push(a);
      else named.push(a);
    });
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
    const ptsLabel = entry.selectedPts != null ? entry.selectedPts
                  : (ptsOpts.length ? ptsOpts[0] : null);
    const titleSuffix = entry.count > 1 ? ` <span class="dcc-count">×${entry.count}</span>` : '';

    const showEnh = display.enhancements && Array.isArray(entry.enhancements) && entry.enhancements.length > 0;
    const enhancementHtml = showEnh
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
    const showFKw = display.factionKw && factionKw.length > 0;
    const showUKw = display.unitKw && allKw.length > 0;
    const kwFooter = showUKw
      ? `<div class="dcc-keywords"><strong>KEYWORDS:</strong> ${esc(allKw.join(', '))}</div>`
      : '';
    const fkwFooter = showFKw
      ? `<div class="dcc-keywords dcc-faction-kw"><strong>FACTION KEYWORDS:</strong> ${esc(factionKw.join(', '))}</div>`
      : '';
    const footerHtml = (showFKw || showUKw)
      ? `<footer class="dcc-foot">${fkwFooter}${kwFooter}</footer>`
      : '';

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
          <h1 class="dcc-name">${esc(unit.name || entry.unitName || 'Unit')}${titleSuffix}</h1>
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
    const subLine = display.kindLabel
      ? `<div class="dcc-sub-line"><span class="dcc-role">${kindLabel}</span></div>`
      : '';
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
    const cpHtml = display.cp
      ? `<span class="dcc-cp"><span class="dcc-cp-num">${esc(String(cp))}</span><span class="dcc-cp-lbl">CP</span></span>`
      : '';
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
            <button type="button" class="dcc-tab" data-tab="display" role="tab">Display</button>
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

    // Sidebar checkbox delegation — handles both per-card include checkboxes
    // (data-include) and per-section display toggles (data-display).
    modalEl.querySelector('#dcc-side').addEventListener('change', (e) => {
      const dispCb = e.target.closest('input[type="checkbox"][data-display]');
      if (dispCb) {
        const key = dispCb.dataset.display;
        display[key] = !!dispCb.checked;
        renderPreview();
        return;
      }
      const cb = e.target.closest('input[type="checkbox"][data-include]');
      if (!cb) return;
      const cat = cb.dataset.cat;
      const id  = cb.dataset.include;
      if (id === '__all__') {
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

    // Display panel "Reset to defaults" button.
    modalEl.querySelector('#dcc-side').addEventListener('click', (e) => {
      if (e.target && e.target.id === 'dcc-display-reset') {
        display = Object.assign({}, DEFAULT_DISPLAY);
        renderSidebar();
        renderPreview();
      }
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

    if (activeTab === 'display') {
      side.innerHTML = renderDisplayPanel();
      return;
    }

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

  function renderDisplayPanel() {
    const groups = DISPLAY_GROUPS.map(g => {
      const rows = g.keys.map(([key, label]) => `
        <li><label class="dcc-row">
          <input type="checkbox" data-display="${esc(key)}" ${display[key] ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label></li>`).join('');
      return `<div class="dcc-display-group">
        <div class="dcc-display-heading">${esc(g.label)}</div>
        <ul class="dcc-list">${rows}</ul>
      </div>`;
    }).join('');
    return `<div class="dcc-side-head">
        <label class="dcc-row dcc-row-all">
          <button type="button" class="dcc-link-btn" id="dcc-display-reset">Reset to defaults</button>
        </label>
      </div>
      ${groups}`;
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
    // Wrap each page in a .dcc-page-frame so the preview can scale via the
    // wrapper without putting transform: scale on .dcc-page itself (which
    // has been a source of html2canvas grief). The export stage skips the
    // wrapper and uses the pages directly at 1:1.
    const layout = getLayout();
    const wrapped = document.createDocumentFragment();
    Array.from(frag.children).forEach(pageEl => {
      const frame = document.createElement('div');
      frame.className = 'dcc-page-frame';
      frame.dataset.pageW = String(layout.w);
      frame.appendChild(pageEl);
      wrapped.appendChild(frame);
    });
    out.appendChild(wrapped);
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
    // Standalone container that html2pdf renders. Pages live directly
    // inside (no preview wrapper) so they're at full physical size at
    // 1:1, ready for html2canvas. Stage gets explicit width so it has a
    // definite bounding box.
    const layout = getLayout();
    const stage = document.createElement('div');
    stage.className = 'dcc-stage';
    stage.style.width = layout.w + 'mm';
    const { frag } = buildPagesDOM();
    stage.appendChild(frag);
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
    // Reset .dcc-stage positioning to static so the cards lay out
    // normally in the popup (the dcc-css we copy in puts the stage at
    // position:absolute behind the modal — wrong for a print popup).
    const pageCss = `@page { size: ${layout.w}mm ${layout.h}mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .dcc-stage { position: static !important; top: auto !important; left: auto !important; z-index: auto !important; pointer-events: auto !important; background: #fff; }
      .dcc-page { box-shadow: none !important; margin: 0 !important; page-break-after: always; break-after: page; }
      .dcc-page:last-child { page-break-after: auto; break-after: auto; }`;

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
