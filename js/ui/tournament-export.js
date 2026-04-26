// ui/tournament-export.js — "Tournament Prep" PDF bundle: config modal + multi-page render.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_CFG = 'yaab_tournament_cfg';

  // 10e common secondary missions — used for reference box + "pick" radio UX.
  const SECONDARIES_10E = [
    'Assassinate',
    'Bring It Down',
    'Behind Enemy Lines',
    'Engage On All Fronts',
    'No Prisoners',
    'Containment',
    'Cleanse',
    'Storm Hostile Objective',
    'Area Denial',
    'Overwhelming Force',
    'Deploy Teleport Homers',
    'Defend Stronghold',
    'Investigate Signals',
    'Raise the Banners High',
    'Sabotage',
  ];

  const DEFAULT_SECTIONS = {
    cover:      true,
    datasheets: true,
    quicklist:  true,
    cpplan:     true,
    secondaries:true,
    opponents:  true,
    battlelog:  true,
  };

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  function esc(s) {
    if (window.UI && typeof UI.escapeHtml === 'function') return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type, dur) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(msg, type || 'info', dur || 3000);
  }

  function todayStr() {
    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function currentArmy() {
    return App.state && App.state.currentArmy;
  }

  function currentDetachmentName() {
    try {
      const sel = App.state && App.state.selectedDetachment;
      return (sel && sel.name) || '';
    } catch (_) { return ''; }
  }

  function loadAllCfg() {
    try {
      const raw = localStorage.getItem(LS_CFG);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeAllCfg(store) {
    try { localStorage.setItem(LS_CFG, JSON.stringify(store)); }
    catch (_) { /* quota — silently ignore */ }
  }

  function defaultsForArmy(army) {
    return {
      eventName:    (army && army.name ? army.name + ' — Tournament' : 'Tournament'),
      rounds:       5,
      secondariesMode: 'fixed', // 'fixed' | 'pick'
      opponents:    [], // [{ name, faction, notes }]
      sections:     Object.assign({}, DEFAULT_SECTIONS),
      playerName:   '',
    };
  }

  function loadCfg(army) {
    if (!army || !army.id) return defaultsForArmy(army);
    const all = loadAllCfg();
    const saved = all[army.id];
    const base = defaultsForArmy(army);
    if (!saved || typeof saved !== 'object') return base;
    return {
      eventName:       typeof saved.eventName === 'string' ? saved.eventName : base.eventName,
      rounds:          Math.max(1, Math.min(8, parseInt(saved.rounds, 10) || base.rounds)),
      secondariesMode: (saved.secondariesMode === 'pick' ? 'pick' : 'fixed'),
      opponents:       Array.isArray(saved.opponents) ? saved.opponents : [],
      sections:        Object.assign({}, base.sections, saved.sections || {}),
      playerName:      typeof saved.playerName === 'string' ? saved.playerName : '',
    };
  }

  function saveCfg(armyId, cfg) {
    if (!armyId) return;
    const all = loadAllCfg();
    all[armyId] = cfg;
    writeAllCfg(all);
  }

  function deleteCfg(armyId) {
    if (!armyId) return;
    const all = loadAllCfg();
    if (all[armyId]) {
      delete all[armyId];
      writeAllCfg(all);
    }
  }

  // Mirror army-diff's saved-army delete listener so we clean up when the
  // user deletes an army from the Load modal.
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const delBtn = t.closest('.btn-delete-saved');
    if (!delBtn) return;
    const armyId = delBtn.dataset && delBtn.dataset.id;
    if (!armyId) return;
    setTimeout(function () {
      const am = App.state && App.state.armyManager;
      if (!am) return;
      const still = am.armies && am.armies.some(a => a.id === armyId);
      if (!still) deleteCfg(armyId);
    }, 0);
  }, false);

  // -------------------------------------------------------------------------
  // Config modal
  // -------------------------------------------------------------------------

  let modalEl = null;
  let currentCfg = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-tp';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal tp-modal">' +
        '<div class="modal-header">' +
          '<h3>Tournament Prep</h3>' +
          '<button class="modal-close" id="tp-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body" id="tp-body"></div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-accent tp-generate" id="tp-generate" type="button">Generate PDF</button>' +
          '<span class="tp-progress" id="tp-progress"><span class="tp-spinner"></span><span id="tp-progress-text">Rendering…</span></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('#tp-close').addEventListener('click', closeModal);
    backdrop.querySelector('#tp-generate').addEventListener('click', onGenerateClick);
    modalEl = backdrop;
    return modalEl;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  function closeModal() { if (modalEl) modalEl.hidden = true; }

  function renderModalBody() {
    const el = ensureModal();
    const body = el.querySelector('#tp-body');
    const army = currentArmy();
    if (!army) {
      body.innerHTML = '<div class="tp-summary">No active army. Create or load an army first.</div>';
      return;
    }

    const cfg = currentCfg;

    const sectionDefs = [
      { key: 'cover',       label: 'Cover page with army summary' },
      { key: 'datasheets',  label: 'Full datasheets (one per unique unit)' },
      { key: 'quicklist',   label: 'Quick-reference army list' },
      { key: 'cpplan',      label: 'CP plan per round' },
      { key: 'secondaries', label: 'Secondary missions tracker' },
      { key: 'opponents',   label: 'Per-round opponent note pages' },
      { key: 'battlelog',   label: 'Battle log / scoring pad' },
    ];

    const checksHtml = sectionDefs.map(function (s) {
      const checked = cfg.sections[s.key] ? ' checked' : '';
      return '<label><input type="checkbox" data-tp-section="' + s.key + '"' + checked + '> ' + esc(s.label) + '</label>';
    }).join('');

    const oppRowsHtml = buildOpponentRowsHtml(cfg);

    body.innerHTML =
      '<div class="tp-field">' +
        '<label class="tp-field-label" for="tp-event-name">Event name</label>' +
        '<input type="text" id="tp-event-name" value="' + esc(cfg.eventName) + '">' +
      '</div>' +
      '<div class="tp-field">' +
        '<label class="tp-field-label" for="tp-player-name">Player name (optional)</label>' +
        '<input type="text" id="tp-player-name" value="' + esc(cfg.playerName) + '">' +
      '</div>' +
      '<div class="tp-field">' +
        '<label class="tp-field-label" for="tp-rounds">Number of rounds</label>' +
        '<input type="number" id="tp-rounds" min="1" max="8" value="' + cfg.rounds + '">' +
        '<span class="tp-field-hint">1–8 rounds.</span>' +
      '</div>' +
      '<div class="tp-field">' +
        '<span class="tp-field-label">Secondaries mode</span>' +
        '<div class="tp-radio-row">' +
          '<label><input type="radio" name="tp-sec-mode" value="fixed"' + (cfg.secondariesMode === 'fixed' ? ' checked' : '') + '> Fixed per round</label>' +
          '<label><input type="radio" name="tp-sec-mode" value="pick"'  + (cfg.secondariesMode === 'pick'  ? ' checked' : '') + '> Pick one per round</label>' +
        '</div>' +
      '</div>' +
      '<div class="tp-opponents" id="tp-opponents">' +
        '<div class="tp-opponents-header" id="tp-opponents-header">' +
          '<span>Opponent info per round (optional)</span>' +
          '<span class="tp-caret">▶</span>' +
        '</div>' +
        '<div class="tp-opponents-body" id="tp-opponents-body">' + oppRowsHtml + '</div>' +
      '</div>' +
      '<div class="tp-field">' +
        '<span class="tp-field-label">Include sections</span>' +
        '<div class="tp-checks">' + checksHtml + '</div>' +
      '</div>' +
      '<div class="tp-summary" id="tp-summary"></div>';

    wireModalInputs();
    updateSummary();
  }

  function buildOpponentRowsHtml(cfg) {
    const rounds = cfg.rounds;
    let html = '';
    for (let i = 0; i < rounds; i++) {
      const opp = cfg.opponents[i] || {};
      html +=
        '<div class="tp-opp-row" data-tp-opp-idx="' + i + '">' +
          '<div class="tp-opp-row-title">Round ' + (i + 1) + '</div>' +
          '<input type="text" data-tp-opp-field="name"    placeholder="Opponent name"   value="' + esc(opp.name    || '') + '">' +
          '<input type="text" data-tp-opp-field="faction" placeholder="Opponent faction" value="' + esc(opp.faction || '') + '">' +
          '<input type="text" class="tp-opp-notes" data-tp-opp-field="notes" placeholder="Notes" value="' + esc(opp.notes || '') + '">' +
        '</div>';
    }
    return html;
  }

  function wireModalInputs() {
    const body = modalEl.querySelector('#tp-body');
    if (!body) return;

    body.querySelector('#tp-event-name').addEventListener('input', function (e) {
      currentCfg.eventName = e.target.value;
      persistCfg();
    });
    body.querySelector('#tp-player-name').addEventListener('input', function (e) {
      currentCfg.playerName = e.target.value;
      persistCfg();
    });
    body.querySelector('#tp-rounds').addEventListener('input', function (e) {
      let n = parseInt(e.target.value, 10);
      if (isNaN(n)) return;
      n = Math.max(1, Math.min(8, n));
      currentCfg.rounds = n;
      // Trim / extend opponents array to match rounds length.
      while (currentCfg.opponents.length > n) currentCfg.opponents.pop();
      // Re-render the opponents block to match count.
      const oppBody = body.querySelector('#tp-opponents-body');
      if (oppBody) oppBody.innerHTML = buildOpponentRowsHtml(currentCfg);
      wireOpponentInputs();
      persistCfg();
      updateSummary();
    });

    body.querySelectorAll('input[name="tp-sec-mode"]').forEach(function (r) {
      r.addEventListener('change', function (e) {
        if (e.target.checked) {
          currentCfg.secondariesMode = e.target.value;
          persistCfg();
        }
      });
    });

    const oppHeader = body.querySelector('#tp-opponents-header');
    const oppBlock  = body.querySelector('#tp-opponents');
    oppHeader.addEventListener('click', function () {
      oppBlock.classList.toggle('open');
    });

    wireOpponentInputs();

    body.querySelectorAll('input[data-tp-section]').forEach(function (c) {
      c.addEventListener('change', function (e) {
        const key = e.target.getAttribute('data-tp-section');
        currentCfg.sections[key] = !!e.target.checked;
        persistCfg();
        updateSummary();
      });
    });
  }

  function wireOpponentInputs() {
    const body = modalEl.querySelector('#tp-body');
    if (!body) return;
    body.querySelectorAll('.tp-opp-row').forEach(function (row) {
      const idx = parseInt(row.getAttribute('data-tp-opp-idx'), 10);
      row.querySelectorAll('input[data-tp-opp-field]').forEach(function (inp) {
        inp.addEventListener('input', function (e) {
          const field = e.target.getAttribute('data-tp-opp-field');
          while (currentCfg.opponents.length <= idx) currentCfg.opponents.push({});
          currentCfg.opponents[idx] = currentCfg.opponents[idx] || {};
          currentCfg.opponents[idx][field] = e.target.value;
          persistCfg();
        });
      });
    });
  }

  function persistCfg() {
    const army = currentArmy();
    if (army && army.id) saveCfg(army.id, currentCfg);
  }

  function uniqueUnitCount(army) {
    const seen = new Set();
    (army.entries || []).forEach(function (e) {
      const id = e.unitData && e.unitData.id;
      if (id) seen.add(id);
    });
    return seen.size;
  }

  function computePageCount(cfg, army) {
    let n = 0;
    if (cfg.sections.cover)       n += 1;
    if (cfg.sections.quicklist)   n += 1;
    if (cfg.sections.datasheets)  n += uniqueUnitCount(army) + 1; // +1 for the datasheet cover
    if (cfg.sections.cpplan)      n += 1;
    if (cfg.sections.secondaries) n += 1;
    if (cfg.sections.opponents)   n += cfg.rounds;
    if (cfg.sections.battlelog)   n += cfg.rounds;
    return n;
  }

  function updateSummary() {
    const el = modalEl.querySelector('#tp-summary');
    if (!el) return;
    const army = currentArmy();
    if (!army) { el.innerHTML = ''; return; }
    const pages = computePageCount(currentCfg, army);
    const ds = uniqueUnitCount(army);
    const parts = [];
    if (currentCfg.sections.cover)       parts.push('cover');
    if (currentCfg.sections.quicklist)   parts.push('quick-ref list');
    if (currentCfg.sections.datasheets)  parts.push(ds + ' datasheets');
    if (currentCfg.sections.cpplan)      parts.push('CP plan');
    if (currentCfg.sections.secondaries) parts.push('secondaries');
    if (currentCfg.sections.opponents)   parts.push(currentCfg.rounds + ' opponent notes');
    if (currentCfg.sections.battlelog)   parts.push(currentCfg.rounds + ' battle logs');
    el.innerHTML = 'Will generate: <strong>' + pages + ' pages</strong> (' + esc(parts.join(' + ') || 'nothing selected') + ').';
  }

  // -------------------------------------------------------------------------
  // Section renderers — each returns either an HTMLElement or a DocumentFragment
  // whose top-level children are `.tp-page` divs (html2pdf breaks before each).
  // -------------------------------------------------------------------------

  function makePage(extraClass) {
    const p = document.createElement('div');
    p.className = 'tp-page' + (extraClass ? ' ' + extraClass : '');
    return p;
  }

  function renderCoverPage(cfg, army) {
    const page = makePage('tp-cover');
    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const limit = army.pointsLimit || 0;
    const detachment = currentDetachmentName();

    let roundsHtml = '';
    for (let i = 0; i < cfg.rounds; i++) {
      const opp = cfg.opponents[i] || {};
      roundsHtml +=
        '<div class="tp-round-cell">' +
          '<div class="tp-round-cell-title">Round ' + (i + 1) + ' of ' + cfg.rounds + '</div>' +
          (opp.name ? '<div>vs ' + esc(opp.name) + '</div>' : '<div>vs ____________________</div>') +
          (opp.faction ? '<div>' + esc(opp.faction) + '</div>' : '') +
        '</div>';
    }

    page.innerHTML =
      '<div class="tp-kicker">Tournament Prep — ' + esc(todayStr()) + '</div>' +
      '<div class="tp-cover-title">' + esc(cfg.eventName) + '</div>' +
      '<div class="tp-cover-meta">' + esc(army.name || 'Untitled Army') + '</div>' +
      (army.factionName ? '<div class="tp-cover-meta">' + esc(army.factionName) + '</div>' : '') +
      (detachment ? '<div class="tp-cover-meta">Detachment: ' + esc(detachment) + '</div>' : '') +
      '<div class="tp-cover-pts">' + total + ' / ' + limit + ' pts</div>' +
      '<div>' +
        '<span class="tp-cover-field">Player: ' + esc(cfg.playerName || '') + '</span>' +
        '<span class="tp-cover-field">Date: ' + esc(todayStr()) + '</span>' +
      '</div>' +
      '<div class="tp-rounds-grid">' + roundsHtml + '</div>';
    return page;
  }

  function renderQuicklistPage(army) {
    const page = makePage();
    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const limit = army.pointsLimit || 0;

    const rows = (army.entries || []).map(function (e) {
      const name = e.unitName || (e.unitData && e.unitData.name) || '';
      const models = e.squadLabel || (e.count > 1 ? (e.count + ' units') : '1 unit');
      const eachPts = (e.selectedPts != null ? e.selectedPts : ((e.unitData && e.unitData.points) || 0));
      const enhPts = (e.enhancements || []).reduce(function (s, x) { return s + (x.pts || 0); }, 0);
      const linePts = eachPts * (e.count || 1) + enhPts;
      const enhNames = (e.enhancements || []).map(function (x) { return x.name; }).filter(Boolean).join(', ');
      return '<tr>' +
        '<td>' + esc(name) + '</td>' +
        '<td>' + esc(models) + (e.count > 1 ? ' × ' + e.count : '') + '</td>' +
        '<td class="tp-num">' + linePts + '</td>' +
        '<td>' + esc(enhNames) + '</td>' +
      '</tr>';
    }).join('');

    page.innerHTML =
      '<h1>' + esc(army.name || 'Army List') + '</h1>' +
      '<div class="tp-kicker">Quick Reference</div>' +
      '<table class="tp-quicklist-table">' +
        '<thead><tr>' +
          '<th>Unit</th><th>Models</th><th class="tp-num">Pts</th><th>Enhancement</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="2">Total</td>' +
          '<td class="tp-num">' + total + '</td>' +
          '<td>of ' + limit + ' pts</td>' +
        '</tr></tfoot>' +
      '</table>';
    return page;
  }

  function renderDatasheetPages(army) {
    // Reuse the existing UI.renderArmyDatasheets which already yields a
    // .datasheet-cover + sequence of .datasheet.datasheet-page children.
    // html2pdf's pagebreak.before selector below includes .datasheet-page
    // so each gets its own page. Apply .pdf-export for compact layout.
    const frag = document.createDocumentFragment();
    if (!window.UI || typeof UI.renderArmyDatasheets !== 'function') return frag;
    const container = UI.renderArmyDatasheets(army);
    container.querySelectorAll('.datasheet, .datasheet-cover').forEach(function (el) {
      el.classList.add('pdf-export');
      frag.appendChild(el);
    });
    return frag;
  }

  function renderCpPlanPage(cfg) {
    const page = makePage();
    const phases = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight'];
    let head = '<tr><th class="tp-rownum">Round</th>';
    phases.forEach(function (p) { head += '<th>' + esc(p) + '</th>'; });
    head += '</tr>';
    let rows = '';
    for (let i = 0; i < cfg.rounds; i++) {
      rows += '<tr><td class="tp-rownum">Round ' + (i + 1) + '</td>';
      for (let j = 0; j < phases.length; j++) rows += '<td></td>';
      rows += '</tr>';
    }
    page.innerHTML =
      '<h1>CP Plan</h1>' +
      '<div class="tp-kicker">Planned stratagems by phase — ' + cfg.rounds + ' rounds</div>' +
      '<table class="tp-grid-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
    return page;
  }

  function renderSecondariesPage(cfg) {
    const page = makePage();
    const pickMode = cfg.secondariesMode === 'pick';

    let rows = '';
    for (let i = 0; i < cfg.rounds; i++) {
      rows +=
        '<tr>' +
          '<td class="tp-rownum">Round ' + (i + 1) + '</td>' +
          '<td></td>' + // chosen
          '<td></td><td></td><td></td><td></td><td></td>' + // T1-T5
          '<td></td>' + // total
        '</tr>';
    }

    const refItems = SECONDARIES_10E.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');

    page.innerHTML =
      '<h1>Secondary Missions Tracker</h1>' +
      '<div class="tp-kicker">Mode: ' + (pickMode ? 'Pick one per round' : 'Fixed per round') + '</div>' +
      '<table class="tp-grid-table">' +
        '<thead><tr>' +
          '<th class="tp-rownum">Round</th>' +
          '<th>Secondary chosen</th>' +
          '<th>T1</th><th>T2</th><th>T3</th><th>T4</th><th>T5</th>' +
          '<th>Total</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<div class="tp-reference-box">' +
        '<h3>10e Secondary Reference</h3>' +
        '<ul>' + refItems + '</ul>' +
      '</div>';
    return page;
  }

  function renderOpponentNotePages(cfg) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < cfg.rounds; i++) {
      const opp = cfg.opponents[i] || {};
      const page = makePage();
      page.innerHTML =
        '<div class="tp-notes-header">' +
          '<div>' +
            '<h1>Round ' + (i + 1) + '</h1>' +
            '<div class="tp-notes-meta">Opponent: ' + esc(opp.name || '____________________') +
              (opp.faction ? ' (' + esc(opp.faction) + ')' : ' (____________)') +
            '</div>' +
          '</div>' +
          '<div class="tp-notes-vp">VP scored: ______ / ______</div>' +
        '</div>' +
        (opp.notes ? '<div class="tp-notes-meta" style="margin-bottom:4mm">' + esc(opp.notes) + '</div>' : '') +
        '<div class="tp-notes-section"><div class="tp-notes-title">Key plays</div><div class="tp-notes-lines"></div></div>' +
        '<div class="tp-notes-section"><div class="tp-notes-title">Mistakes</div><div class="tp-notes-lines"></div></div>' +
        '<div class="tp-notes-section"><div class="tp-notes-title">Lessons learned</div><div class="tp-notes-lines"></div></div>';
      frag.appendChild(page);
    }
    return frag;
  }

  function renderBattleLogPages(cfg) {
    const frag = document.createDocumentFragment();
    for (let r = 0; r < cfg.rounds; r++) {
      const page = makePage('tp-battle-log');
      let rows = '';
      for (let t = 1; t <= 5; t++) {
        rows +=
          '<tr>' +
            '<td class="tp-turn-col">T' + t + '</td>' +
            '<td></td><td></td><td></td>' + // you p/s1/s2
            '<td></td><td></td><td></td>' + // them p/s1/s2
            '<td class="tp-total-col"></td>' +
          '</tr>';
      }
      page.innerHTML =
        '<h1>Round ' + (r + 1) + ' — Battle Log</h1>' +
        '<div class="tp-kicker">Scoring pad</div>' +
        '<table>' +
          '<thead><tr>' +
            '<th class="tp-turn-col">Turn</th>' +
            '<th>You primary</th><th>You sec1</th><th>You sec2</th>' +
            '<th>Them primary</th><th>Them sec1</th><th>Them sec2</th>' +
            '<th class="tp-total-col">Running total</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>';
      frag.appendChild(page);
    }
    return frag;
  }

  // -------------------------------------------------------------------------
  // PDF generation
  // -------------------------------------------------------------------------

  function buildStage(cfg, army) {
    const stage = document.createElement('div');
    stage.className = 'tp-stage';
    stage.setAttribute('aria-hidden', 'true');

    if (cfg.sections.cover)       stage.appendChild(renderCoverPage(cfg, army));
    if (cfg.sections.quicklist)   stage.appendChild(renderQuicklistPage(army));
    if (cfg.sections.datasheets)  stage.appendChild(renderDatasheetPages(army));
    if (cfg.sections.cpplan)      stage.appendChild(renderCpPlanPage(cfg));
    if (cfg.sections.secondaries) stage.appendChild(renderSecondariesPage(cfg));
    if (cfg.sections.opponents)   stage.appendChild(renderOpponentNotePages(cfg));
    if (cfg.sections.battlelog)   stage.appendChild(renderBattleLogPages(cfg));

    return stage;
  }

  function filenameFor(cfg, army) {
    const base = (cfg.eventName || (army && army.name) || 'tournament').trim();
    return base.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') + '.pdf';
  }

  function onGenerateClick() {
    const army = currentArmy();
    if (!army || !army.entries || army.entries.length === 0) {
      toast('Add units first', 'warning');
      return;
    }
    if (typeof window.html2pdf !== 'function') {
      toast('PDF library not loaded — try again in a second', 'warning', 4000);
      return;
    }
    const anySelected = Object.keys(currentCfg.sections).some(function (k) { return currentCfg.sections[k]; });
    if (!anySelected) {
      toast('Select at least one section to include', 'warning');
      return;
    }

    const genBtn  = modalEl.querySelector('#tp-generate');
    const progEl  = modalEl.querySelector('#tp-progress');
    const progTxt = modalEl.querySelector('#tp-progress-text');
    genBtn.disabled = true;
    progEl.classList.add('is-active');
    if (progTxt) progTxt.textContent = 'Rendering ' + computePageCount(currentCfg, army) + ' pages…';

    // Build the stage and attach to body (off-screen via CSS).
    const stage = buildStage(currentCfg, army);
    document.body.appendChild(stage);

    const filename = filenameFor(currentCfg, army);
    const opts = {
      margin:      0,
      filename:    filename,
      image:       { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
      pagebreak:   {
        mode:   ['css', 'legacy'],
        before: '.tp-page, .datasheet-page',
        avoid:  '.ds-weapons-block, .ds-block, .ds-ability, .ds-leader, .tp-reference-box, tr',
      },
    };

    window.html2pdf()
      .set(opts)
      .from(stage)
      .save()
      .then(function () {
        toast('Tournament bundle saved as ' + filename, 'success', 4000);
      })
      .catch(function (err) {
        console.warn('[tournament-export]', err);
        toast('PDF export failed: ' + (err && err.message ? err.message : 'unknown'), 'error', 6000);
      })
      .finally(function () {
        if (stage.parentNode) stage.parentNode.removeChild(stage);
        genBtn.disabled = false;
        progEl.classList.remove('is-active');
      });
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  function openConfig() {
    const army = currentArmy();
    if (!army) {
      toast('No active army', 'warning');
      return;
    }
    currentCfg = loadCfg(army);
    // Keep the event-name default tied to the (potentially renamed) army until
    // the user edits it. If the saved eventName came from a previous army name
    // auto-default and doesn't match the current army, refresh it.
    if (!currentCfg.eventName) currentCfg.eventName = (army.name || 'Tournament') + ' — Tournament';
    // Clamp opponents length to rounds.
    while (currentCfg.opponents.length > currentCfg.rounds) currentCfg.opponents.pop();
    renderModalBody();
    const el = ensureModal();
    el.hidden = false;
  }

  // Register toolbar button.
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-tournament',
    region: 'primary',
    label: 'Tournament',
    title: 'Generate tournament prep PDF',
    onClick: openConfig,
  });

  // Expose for command palette / external callers.
  App.openTournamentExport = openConfig;
})();
