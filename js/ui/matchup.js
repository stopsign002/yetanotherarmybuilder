// ui/matchup.js — opponent paste-in modal + side-by-side matchup viewer.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Stylesheet injected once.
  function ensureStylesheet() {
    if (document.querySelector('link[data-yaab-opponent]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/opponent.css';
    link.setAttribute('data-yaab-opponent', '1');
    document.head.appendChild(link);
  }

  // ────────────────────────────────────────────────────────────────────
  // Role classification + attack-class tallies (local — not imported).
  // ────────────────────────────────────────────────────────────────────

  const ROLE_ORDER = ['Character', 'Battleline', 'Infantry', 'Vehicle', 'Monster', 'Other'];
  const ROLE_COLORS = {
    Character:  '#e6c77a',
    Battleline: '#7aa3e6',
    Infantry:   '#a8cf7a',
    Vehicle:    '#7ae6c9',
    Monster:    '#c37ae6',
    Other:      '#888888',
  };

  function classifyRole(keywords) {
    const set = new Set((keywords || []).map(k => String(k).toLowerCase()));
    if (set.has('character')) return 'Character';
    if (set.has('battleline')) return 'Battleline';
    if (set.has('monster')) return 'Monster';
    if (set.has('vehicle')) return 'Vehicle';
    if (set.has('infantry')) return 'Infantry';
    return 'Other';
  }

  function parseDice(raw) {
    if (raw == null) return 1;
    const s = String(raw).trim();
    if (!s) return 1;
    const m = s.match(/^(\d*)\s*[dD](\d+)(?:\s*([+-])\s*(\d+))?/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      let total = n * ((sides + 1) / 2);
      if (m[3] && m[4]) total += m[3] === '+' ? parseInt(m[4], 10) : -parseInt(m[4], 10);
      return total;
    }
    const n = parseInt(s, 10);
    return isNaN(n) ? 1 : n;
  }

  function parseS(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const d = parseDice(s);
    return isFinite(d) ? Math.round(d) : 0;
  }

  function parseAP(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    const m = s.match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function modelsForEntry(entry) {
    const count = entry.count || 1;
    const u = entry.unitData || {};
    const opts = u.squadOptions || [];
    let per = 1;
    if (opts.length) {
      let chosen = opts.find(o => o.pts === entry.selectedPts) || opts[0];
      if (chosen && chosen.models) per = chosen.models;
    }
    return count * per;
  }

  // Roster summary + composition + strength matchup buckets.
  function computeSummary(army) {
    const out = {
      name:      (army && army.name) || 'Opponent',
      faction:   (army && army.factionName) || '',
      points:    0,
      unitCount: 0,
      modelCount: 0,
      roles:     {},
      attacks: {
        antiInfantry: 0, // S <= 5
        antiElite:    0, // AP <= -2 OR S 6-9
        antiTank:     0, // S >= 8 OR Anti-Vehicle kw
        horde:        0, // blast/torrent OR A >= 5
      },
      entries: [],
    };
    ROLE_ORDER.forEach(r => { out.roles[r] = 0; });

    const entries = (army && army.entries) || [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const u = entry.unitData || {};
      const models = modelsForEntry(entry);
      const pts = (entry.selectedPts != null ? entry.selectedPts : (u.points || 0)) * (entry.count || 1)
        + (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
      out.points += pts;
      out.unitCount += (entry.count || 1);
      out.modelCount += models;

      const role = classifyRole(u.keywords);
      out.roles[role] = (out.roles[role] || 0) + pts;

      out.entries.push({
        unitName: entry.unitName || u.name || '(unknown)',
        unit: u.id ? u : null,
        count: entry.count || 1,
        pts,
        matched: !!(u && u.id),
      });

      const weapons = u.weapons || [];
      for (let j = 0; j < weapons.length; j++) {
        const w = weapons[j];
        const A = parseDice(w.A);
        const S = parseS(w.S);
        const AP = parseAP(w.AP);
        const kws = String(w.Keywords || '').toLowerCase();
        const atk = A * models; // coarse proxy (all models carry)
        if (S > 0 && S <= 5) out.attacks.antiInfantry += atk;
        if (AP <= -2 || (S >= 6 && S <= 9)) out.attacks.antiElite += atk;
        if (S >= 8 || /anti-\s*vehicle/.test(kws)) out.attacks.antiTank += atk;
        if (/blast|torrent/.test(kws) || A >= 5) out.attacks.horde += atk;
      }
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // Paste modal
  // ────────────────────────────────────────────────────────────────────

  let pasteEl = null;
  let matchupEl = null;
  let pendingParsed = null; // { kind, army, code?, entries? }

  function buildPasteModal() {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop yaab-opp-backdrop';
    bd.setAttribute('hidden', '');
    bd.innerHTML = `
      <div class="modal yaab-opp-modal" role="dialog" aria-label="Opponent army">
        <div class="modal-header">
          <h3>Opponent Army</h3>
          <button class="modal-close" type="button" data-yaab-opp-close aria-label="Close">&times;</button>
        </div>
        <div class="modal-body yaab-opp-body">
          <p class="yaab-opp-muted">
            Paste an army code (<code>YAAB1:</code>) or a plain-text list
            (BattleScribe / WTC / GW app). We'll best-effort match units.
          </p>
          <textarea id="yaab-opp-textarea" class="form-input yaab-opp-textarea"
            rows="12" placeholder="YAAB1:... or&#10;3x Intercessor Squad [120 pts]&#10;1x Captain in Terminator Armour [95 pts]&#10;..."></textarea>
          <div id="yaab-opp-preview" class="yaab-opp-preview" hidden></div>
        </div>
        <div class="modal-footer yaab-opp-footer">
          <button class="btn btn-sm btn-outline" type="button" id="yaab-opp-clear">Clear opponent</button>
          <span class="yaab-opp-spacer"></span>
          <button class="btn btn-sm btn-outline" type="button" data-yaab-opp-close>Cancel</button>
          <button class="btn btn-sm btn-outline" type="button" id="yaab-opp-parse">Parse</button>
          <button class="btn btn-sm btn-accent" type="button" id="yaab-opp-accept" disabled>Accept</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    bd.addEventListener('click', e => {
      if (e.target === bd) closePaste();
      if (e.target.closest && e.target.closest('[data-yaab-opp-close]')) closePaste();
    });
    bd.querySelector('#yaab-opp-parse').addEventListener('click', onParse);
    bd.querySelector('#yaab-opp-accept').addEventListener('click', onAccept);
    bd.querySelector('#yaab-opp-clear').addEventListener('click', onClear);
    return bd;
  }

  function ensurePaste() {
    if (pasteEl) return pasteEl;
    ensureStylesheet();
    pasteEl = buildPasteModal();
    return pasteEl;
  }

  async function onParse() {
    const ta = document.getElementById('yaab-opp-textarea');
    const preview = document.getElementById('yaab-opp-preview');
    const accept = document.getElementById('yaab-opp-accept');
    if (!ta) return;
    const raw = ta.value;
    try {
      const result = await App.opponent.parseInput(raw);
      pendingParsed = result;
      preview.hidden = false;
      preview.innerHTML = renderPreview(result);
      if (accept) accept.disabled = false;
    } catch (err) {
      pendingParsed = null;
      preview.hidden = false;
      preview.innerHTML = `<div class="yaab-opp-error">${esc(err.message || 'Parse failed')}</div>`;
      if (accept) accept.disabled = true;
    }
  }

  function renderPreview(result) {
    const army = result.army;
    const rows = (army.entries || []).map(e => {
      const matched = !!(e.unitData && e.unitData.id);
      const pts = e.selectedPts || 0;
      return `<li class="yaab-opp-prev-row${matched ? '' : ' yaab-opp-unknown'}">
        <span class="yaab-opp-prev-count">${e.count || 1}×</span>
        <span class="yaab-opp-prev-name">${esc(e.unitName)}${matched ? '' : ' <em>(unknown)</em>'}</span>
        <span class="yaab-opp-prev-pts">${pts} pts</span>
      </li>`;
    }).join('');
    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const kind = result.kind === 'yaab1' ? 'YAAB1 code' : 'plain text';
    return `
      <div class="yaab-opp-prev-head">Parsed (${esc(kind)}) — ${army.entries.length} entries · ${total} pts</div>
      <ul class="yaab-opp-prev-list">${rows || '<li class="yaab-opp-muted">No entries</li>'}</ul>`;
  }

  function onAccept() {
    if (!pendingParsed) return;
    App.opponent.setOpponent(pendingParsed.army, pendingParsed.code);
    if (UI.toast) UI.toast('Opponent saved', 'success');
    pendingParsed = null;
    closePaste();
  }

  function onClear() {
    App.opponent.clearOpponent();
    pendingParsed = null;
    const preview = document.getElementById('yaab-opp-preview');
    const ta = document.getElementById('yaab-opp-textarea');
    const accept = document.getElementById('yaab-opp-accept');
    if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    if (ta) ta.value = '';
    if (accept) accept.disabled = true;
    if (UI.toast) UI.toast('Opponent cleared', 'info');
  }

  function openPaste() {
    ensurePaste();
    pendingParsed = null;
    const preview = document.getElementById('yaab-opp-preview');
    const accept = document.getElementById('yaab-opp-accept');
    if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    if (accept) accept.disabled = true;
    pasteEl.removeAttribute('hidden');
    setTimeout(() => {
      const ta = document.getElementById('yaab-opp-textarea');
      if (ta) ta.focus();
    }, 40);
    document.addEventListener('keydown', pasteKey);
  }

  function closePaste() {
    if (!pasteEl) return;
    pasteEl.setAttribute('hidden', '');
    document.removeEventListener('keydown', pasteKey);
  }

  function pasteKey(e) { if (e.key === 'Escape') closePaste(); }

  // ────────────────────────────────────────────────────────────────────
  // Matchup modal
  // ────────────────────────────────────────────────────────────────────

  function ensureMatchup() {
    if (matchupEl) return matchupEl;
    ensureStylesheet();
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop yaab-mu-backdrop';
    bd.setAttribute('hidden', '');
    bd.innerHTML = `
      <div class="modal yaab-mu-modal" role="dialog" aria-label="Army matchup">
        <div class="modal-header">
          <h3>Matchup</h3>
          <button class="modal-close" type="button" data-yaab-mu-close aria-label="Close">&times;</button>
        </div>
        <div class="modal-body yaab-mu-body" id="yaab-mu-body"></div>
        <div class="modal-footer">
          <button class="btn btn-sm btn-outline" type="button" data-yaab-mu-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', e => {
      if (e.target === bd) closeMatchup();
      if (e.target.closest && e.target.closest('[data-yaab-mu-close]')) closeMatchup();
    });
    matchupEl = bd;
    return matchupEl;
  }

  function renderRoleBar(summary) {
    const total = ROLE_ORDER.reduce((s, r) => s + (summary.roles[r] || 0), 0);
    if (!total) return '<div class="yaab-mu-empty">No composition data</div>';
    const segs = ROLE_ORDER.map(r => {
      const pts = summary.roles[r] || 0;
      if (!pts) return '';
      const pct = (pts / total) * 100;
      return `<div class="yaab-mu-role-seg" style="flex-basis:${pct}%;background:${ROLE_COLORS[r]}" title="${esc(r)}: ${pts} pts"></div>`;
    }).join('');
    const legend = ROLE_ORDER.filter(r => (summary.roles[r] || 0) > 0).map(r => {
      const pts = summary.roles[r] || 0;
      const pct = Math.round((pts / total) * 100);
      return `<span class="yaab-mu-legend-item">
        <span class="yaab-mu-swatch" style="background:${ROLE_COLORS[r]}"></span>
        ${esc(r)} <span class="yaab-mu-legend-pct">${pct}%</span>
      </span>`;
    }).join('');
    return `
      <div class="yaab-mu-role-bar">${segs}</div>
      <div class="yaab-mu-role-legend">${legend}</div>`;
  }

  function renderAttackGrid(you, them) {
    const rows = [
      ['Anti-infantry (S ≤ 5)',    'antiInfantry'],
      ['Anti-elite (AP ≤ -2 / S 6-9)', 'antiElite'],
      ['Anti-tank (S ≥ 8 / Anti-Veh)', 'antiTank'],
      ['Horde clearance (blast/torrent/A≥5)', 'horde'],
    ];
    const cells = rows.map(([label, key]) => {
      const a = Math.round(you.attacks[key]) || 0;
      const b = Math.round(them.attacks[key]) || 0;
      const max = Math.max(a, b, 1);
      const ap = (a / max) * 100;
      const bp = (b / max) * 100;
      const leadCls = a === b ? '' : (a > b ? ' yaab-mu-lead-you' : ' yaab-mu-lead-them');
      return `<div class="yaab-mu-atk-row${leadCls}">
        <div class="yaab-mu-atk-label">${esc(label)}</div>
        <div class="yaab-mu-atk-bars">
          <div class="yaab-mu-atk-side">
            <div class="yaab-mu-atk-bar yaab-mu-atk-you" style="width:${ap}%"></div>
            <span class="yaab-mu-atk-val">${a}</span>
          </div>
          <div class="yaab-mu-atk-side">
            <div class="yaab-mu-atk-bar yaab-mu-atk-them" style="width:${bp}%"></div>
            <span class="yaab-mu-atk-val">${b}</span>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div class="yaab-mu-atk-grid">${cells}</div>`;
  }

  function renderStatStrip(unit) {
    if (!unit || !unit.stats) return '';
    const s = unit.stats;
    const aliases = (UI && UI._STAT_ALIASES) || {};
    const order = (UI && UI._CARD_STAT_PREF) || ['M', 'T', 'SV', 'W', 'LD', 'OC'];
    const resolved = {};
    ['M', 'T', 'W'].forEach(k => { if (s[k] != null) resolved[k] = s[k]; });
    Object.entries(aliases).forEach(([canonical, alts]) => {
      if (resolved[canonical] != null) return;
      const hit = (alts || []).find(a => s[a] != null && s[a] !== '');
      if (hit) resolved[canonical] = s[hit];
    });
    if (unit.invulnSave && resolved['SV']) resolved['SV'] = resolved['SV'] + '/' + unit.invulnSave;
    const cells = order
      .filter(k => resolved[k] != null && resolved[k] !== '')
      .slice(0, 6)
      .map(k => `<div class="yaab-mu-stat"><span class="yaab-mu-stat-k">${esc(k)}</span><span class="yaab-mu-stat-v">${esc(String(resolved[k]))}</span></div>`)
      .join('');
    return `<div class="yaab-mu-stat-strip">${cells || '<span class="yaab-mu-muted">No stats</span>'}</div>`;
  }

  function renderRoster(summary) {
    if (!summary.entries.length) return '<div class="yaab-mu-empty">No units</div>';
    const rows = summary.entries.map((e, i) => {
      const cls = e.matched ? '' : ' yaab-mu-unknown';
      return `<li class="yaab-mu-roster-row${cls}" data-idx="${i}">
        <button type="button" class="yaab-mu-roster-btn" data-idx="${i}">
          <span class="yaab-mu-roster-count">${e.count}×</span>
          <span class="yaab-mu-roster-name">${esc(e.unitName)}${e.matched ? '' : ' <em>(unknown)</em>'}</span>
          <span class="yaab-mu-roster-pts">${e.pts} pts</span>
        </button>
        <div class="yaab-mu-roster-detail" hidden></div>
      </li>`;
    }).join('');
    return `<ul class="yaab-mu-roster-list">${rows}</ul>`;
  }

  function renderBody() {
    const yourArmy = (App.state && App.state.currentArmy) || null;
    const themArmy = (App.state && App.state.opponentArmy) || null;
    if (!themArmy) {
      return `<div class="yaab-mu-empty">No opponent loaded. Click Opponent in the toolbar and paste a list first.</div>`;
    }
    const you  = computeSummary(yourArmy);
    const them = computeSummary(themArmy);

    const youFac  = shortFaction(you.faction) || '—';
    const themFac = shortFaction(them.faction) || '—';

    return `
      <div class="yaab-mu-header">
        <div class="yaab-mu-side yaab-mu-you">
          <div class="yaab-mu-side-title">You</div>
          <div class="yaab-mu-side-sub">${esc(youFac)}</div>
        </div>
        <div class="yaab-mu-vs">vs</div>
        <div class="yaab-mu-side yaab-mu-them">
          <div class="yaab-mu-side-title">Them</div>
          <div class="yaab-mu-side-sub">${esc(themFac)}</div>
        </div>
      </div>

      <div class="yaab-mu-totals">
        <div class="yaab-mu-totals-cell">${you.points} pts · ${you.unitCount} units · ${you.modelCount} models</div>
        <div class="yaab-mu-totals-cell">${them.points} pts · ${them.unitCount} units · ${them.modelCount} models</div>
      </div>

      <div class="yaab-mu-section">
        <div class="yaab-mu-section-title">Composition</div>
        <div class="yaab-mu-compare">
          <div class="yaab-mu-compare-cell">${renderRoleBar(you)}</div>
          <div class="yaab-mu-compare-cell">${renderRoleBar(them)}</div>
        </div>
      </div>

      <div class="yaab-mu-section">
        <div class="yaab-mu-section-title">Strength matchups (total attacks)</div>
        ${renderAttackGrid(you, them)}
      </div>

      <details class="yaab-mu-section yaab-mu-roster-section">
        <summary class="yaab-mu-section-title">Their roster (${them.entries.length})</summary>
        ${renderRoster(them)}
      </details>`;
  }

  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function rerenderMatchup() {
    const body = document.getElementById('yaab-mu-body');
    if (!body) return;
    body.innerHTML = renderBody();
    wireRosterClicks(body);
  }

  function wireRosterClicks(root) {
    const buttons = root.querySelectorAll('.yaab-mu-roster-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const li = btn.closest('.yaab-mu-roster-row');
        if (!li) return;
        const detail = li.querySelector('.yaab-mu-roster-detail');
        if (!detail) return;
        if (!detail.hasAttribute('hidden')) {
          detail.setAttribute('hidden', '');
          detail.innerHTML = '';
          return;
        }
        const themArmy = App.state.opponentArmy;
        if (!themArmy) return;
        const entry = themArmy.entries[idx];
        if (!entry) return;
        const u = entry.unitData;
        const matched = !!(u && u.id);
        if (!matched) {
          detail.innerHTML = `<div class="yaab-mu-muted">Unit not matched to a loaded datasheet.</div>`;
        } else {
          const kws = (u.keywords || []).slice(0, 8).map(k => `<span class="yaab-mu-kw">${esc(k)}</span>`).join('');
          detail.innerHTML = `
            <div class="yaab-mu-detail-inner">
              ${renderStatStrip(u)}
              <div class="yaab-mu-detail-kws">${kws}</div>
            </div>`;
        }
        detail.removeAttribute('hidden');
      });
    });
  }

  function openMatchup() {
    ensureMatchup();
    rerenderMatchup();
    matchupEl.removeAttribute('hidden');
    document.addEventListener('keydown', matchupKey);
  }

  function closeMatchup() {
    if (!matchupEl) return;
    matchupEl.setAttribute('hidden', '');
    document.removeEventListener('keydown', matchupKey);
  }

  function matchupKey(e) { if (e.key === 'Escape') closeMatchup(); }

  // ────────────────────────────────────────────────────────────────────
  // Hook registrations
  // ────────────────────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-opponent',
    region: 'primary',
    label: 'Opponent',
    title: "Paste your opponent's army to compare",
    onClick: openPaste,
  });

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-matchup',
    region: 'primary',
    label: 'Matchup',
    title: 'View side-by-side matchup',
    onClick: openMatchup,
  });

  // Re-render matchup on army changes; refresh the enabled state of the
  // Matchup button whenever our army or the opponent slot changes.
  App.hooks.armyChange.push(function () {
    if (App.opponent && App.opponent.refreshMatchupButton) {
      App.opponent.refreshMatchupButton();
    }
    if (matchupEl && !matchupEl.hasAttribute('hidden')) rerenderMatchup();
  });

  App.hooks.bootstrap.push(function () {
    if (App.opponent && App.opponent.refreshMatchupButton) {
      App.opponent.refreshMatchupButton();
    }
    // Poll briefly — opponent may be restored from localStorage after boot.
    let n = 0;
    const t = setInterval(() => {
      if (App.opponent) App.opponent.refreshMatchupButton();
      if (++n > 30) clearInterval(t);
    }, 1000);
  });

  // Expose for command palette + debugging.
  App.openOpponentPaste = openPaste;
  App.openMatchup = openMatchup;
  UI.openOpponentPaste = openPaste;
  UI.openMatchup = openMatchup;
})();
