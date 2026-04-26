// app/command-palette.js — Cmd/Ctrl+K fuzzy command palette + `?` keyboard-help overlay.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // ---------------------------------------------------------------------------
  // Fuzzy scoring
  // ---------------------------------------------------------------------------

  function isSubsequence(needle, haystack) {
    if (!needle) return false;
    let i = 0, j = 0;
    while (i < needle.length && j < haystack.length) {
      if (needle.charCodeAt(i) === haystack.charCodeAt(j)) i++;
      j++;
    }
    return i === needle.length;
  }

  function scoreCandidate(cand, tokens) {
    if (!tokens.length) {
      // No query: show actions first, then the rest (bounded later).
      return cand.type === 'Actions' ? 5 : 0;
    }
    const name = (cand.label || '').toLowerCase();
    let score = 0;
    const first = tokens[0];
    if (name.startsWith(first)) score += 10;
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (!tok) continue;
      if (name.indexOf(tok) !== -1) score += 3;
      else if (isSubsequence(tok, name)) score += 1;
      else return -1; // every token must match somewhere
    }
    if (cand.type === 'Actions') score += 5;
    return score;
  }

  // ---------------------------------------------------------------------------
  // Candidate assembly (lazy — only at open time)
  // ---------------------------------------------------------------------------

  const ACTIONS = [
    { label: 'New army',           shortcut: null,         btn: 'btn-new-army' },
    { label: 'Save army',          shortcut: null,         btn: 'btn-save-army' },
    { label: 'Load army',          shortcut: null,         btn: 'btn-load-army' },
    { label: 'Export (copy code)', shortcut: null,         btn: 'btn-export-string' },
    { label: 'Copy as text',       shortcut: null,         btn: 'btn-export-text' },
    { label: 'Download CSV',       shortcut: null,         btn: 'btn-export-csv' },
    { label: 'Share link',         shortcut: null,         btn: 'yaab-btn-share' },
    { label: 'Print',              shortcut: null,         btn: 'btn-print-army' },
    { label: 'Save as PDF',        shortcut: null,         btn: '__pdf__' },
    { label: 'Undo',               shortcut: 'Cmd/Ctrl+Z', btn: 'yaab-btn-undo' },
    { label: 'Redo',               shortcut: 'Shift+Cmd/Ctrl+Z', btn: 'yaab-btn-redo' },
    { label: 'Toggle keyboard help', shortcut: '?',        btn: '__help__' },
  ];

  function clickButtonById(id) {
    const el = document.getElementById(id);
    if (!el) {
      if (window.UI && UI.toast) UI.toast('Action unavailable', 'warning');
      return;
    }
    el.click();
  }

  function saveAsPdf() {
    const printBtn = document.getElementById('btn-print-army');
    if (!printBtn) return;
    printBtn.click();
    // Preview renders synchronously in datasheet.js; click after a frame.
    setTimeout(() => {
      const pdfBtn = document.getElementById('print-preview-pdf');
      if (pdfBtn) pdfBtn.click();
    }, 150);
  }

  function buildActionCandidates() {
    return ACTIONS.map(a => ({
      type: 'Actions',
      label: a.label,
      subtitle: a.shortcut || '',
      run: a.btn === '__help__' ? openHelp
         : a.btn === '__pdf__'  ? saveAsPdf
         : () => clickButtonById(a.btn),
    }));
  }

  function buildFactionCandidates(state) {
    const select = document.getElementById('army-faction-select');
    const options = select ? Array.from(select.options).map(o => o.value) : [];
    const seen = new Set();
    const out = [];
    (state.factions || []).forEach(f => {
      const name = f.name;
      if (!name || seen.has(name)) return;
      if (state.chapterFactions && state.chapterFactions.has(name)) return; // hidden
      if (options.length && options.indexOf(name) === -1) return;
      seen.add(name);
      out.push({
        type: 'Factions',
        label: name,
        subtitle: 'Faction',
        run: () => selectFaction(name),
      });
    });
    // Virtual parents (e.g. Imperium - Adeptus Astartes) appear in the select too.
    if (select) {
      Array.from(select.options).forEach(o => {
        if (!o.value || o.value === 'all') return;
        if (seen.has(o.value)) return;
        seen.add(o.value);
        out.push({
          type: 'Factions',
          label: o.value,
          subtitle: 'Faction',
          run: () => selectFaction(o.value),
        });
      });
    }
    return out;
  }

  function selectFaction(name) {
    const select = document.getElementById('army-faction-select');
    if (!select) return;
    select.value = name;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectDetachment(name) {
    const select = document.getElementById('army-detachment-select');
    if (!select) return;
    select.value = name;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function buildDetachmentCandidates(state) {
    const faction = state.detachmentFaction || (typeof App.getCurrentFaction === 'function' ? App.getCurrentFaction() : null);
    if (!faction || !Array.isArray(faction.detachments)) return [];
    return faction.detachments.map(d => ({
      type: 'Detachments',
      label: d.name,
      subtitle: faction.name,
      run: () => selectDetachment(d.name),
    }));
  }

  function buildUnitCandidates(state) {
    const all = state.allUnits || [];
    const out = new Array(all.length);
    for (let i = 0; i < all.length; i++) {
      const u = all[i];
      out[i] = {
        type: 'Units',
        label: u.name || '',
        subtitle: u._factionName || '',
        unit: u,
        run: () => openUnit(u),
      };
    }
    return out;
  }

  function openUnit(unit) {
    if (!unit || !window.App || !App.state) return;
    const state = App.state;
    state.selectedUnit = unit;
    state.selectedArmyEntryIndex = null;
    const detEnhs = (state.selectedDetachment && state.selectedDetachment.enhancements) || [];
    if (window.UI && typeof UI.renderUnitDetail === 'function') {
      UI.renderUnitDetail(unit, detEnhs, []);
    }
    // Highlight + scroll-into-view if present in current roster.
    const grid = document.getElementById('unit-grid');
    if (!grid) return;
    document.querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
    const card = grid.querySelector(`.unit-card[data-unit-id="${CSS.escape(String(unit.id))}"]`);
    if (card) {
      card.classList.add('selected');
      try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }
  }

  function buildCandidates() {
    const state = App.state || {};
    return [].concat(
      buildActionCandidates(),
      buildFactionCandidates(state),
      buildDetachmentCandidates(state),
      buildUnitCandidates(state),
    );
  }

  // ---------------------------------------------------------------------------
  // Palette DOM (lazy)
  // ---------------------------------------------------------------------------

  let paletteRoot = null;
  let paletteInput = null;
  let paletteList = null;
  let paletteOpen = false;
  let cachedCandidates = null;
  let currentResults = [];
  let activeIndex = 0;
  const RESULT_CAP = 40;
  const GROUP_ORDER = ['Actions', 'Factions', 'Detachments', 'Units'];

  function buildPaletteDom() {
    if (paletteRoot) return paletteRoot;
    const root = document.createElement('div');
    root.className = 'cmdp-backdrop';
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="cmdp-modal" role="dialog" aria-label="Command palette">
        <div class="cmdp-input-wrap">
          <input type="text" class="cmdp-input" placeholder="Search units, factions, or actions&hellip;" autocomplete="off" spellcheck="false" />
        </div>
        <div class="cmdp-list" role="listbox"></div>
        <div class="cmdp-footer">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
          <span><kbd>Tab</kbd> cycle group</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    paletteRoot = root;
    paletteInput = root.querySelector('.cmdp-input');
    paletteList = root.querySelector('.cmdp-list');

    root.addEventListener('click', e => {
      if (e.target === root) closePalette();
    });
    paletteInput.addEventListener('input', renderResults);
    paletteInput.addEventListener('keydown', onInputKeydown);
    paletteList.addEventListener('click', e => {
      const row = e.target.closest('.cmdp-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx, 10);
      if (isNaN(idx)) return;
      selectIndex(idx);
    });
    paletteList.addEventListener('mousemove', e => {
      const row = e.target.closest('.cmdp-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx, 10);
      if (!isNaN(idx) && idx !== activeIndex) {
        setActive(idx);
      }
    });
    return root;
  }

  function onInputKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(currentResults.length - 1, activeIndex + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectIndex(activeIndex);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleGroup(e.shiftKey ? -1 : 1);
      return;
    }
  }

  function cycleGroup(dir) {
    if (!currentResults.length) return;
    const currentType = currentResults[activeIndex] && currentResults[activeIndex].type;
    const types = [];
    currentResults.forEach(r => { if (types.indexOf(r.type) === -1) types.push(r.type); });
    if (types.length <= 1) return;
    let ti = types.indexOf(currentType);
    ti = (ti + dir + types.length) % types.length;
    const nextType = types[ti];
    const nextIdx = currentResults.findIndex(r => r.type === nextType);
    if (nextIdx >= 0) setActive(nextIdx);
  }

  function setActive(idx) {
    activeIndex = idx;
    const rows = paletteList.querySelectorAll('.cmdp-row');
    rows.forEach(r => r.classList.remove('active'));
    const el = paletteList.querySelector(`.cmdp-row[data-idx="${idx}"]`);
    if (el) {
      el.classList.add('active');
      try { el.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }

  function selectIndex(idx) {
    const pick = currentResults[idx];
    if (!pick) return;
    closePalette();
    try { pick.run(); }
    catch (err) {
      if (window.UI && UI.toast) UI.toast('Command failed: ' + err.message, 'error');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderResults() {
    const q = (paletteInput.value || '').trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const cands = cachedCandidates || [];
    const scored = [];
    for (let i = 0; i < cands.length; i++) {
      const s = scoreCandidate(cands[i], tokens);
      if (s < 0) continue;
      if (!tokens.length && cands[i].type === 'Units') continue; // don't flood empty query
      scored.push({ c: cands[i], s });
    }
    scored.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const ga = GROUP_ORDER.indexOf(a.c.type);
      const gb = GROUP_ORDER.indexOf(b.c.type);
      if (ga !== gb) return ga - gb;
      return a.c.label.localeCompare(b.c.label);
    });
    const top = scored.slice(0, RESULT_CAP).map(x => x.c);

    // Group-sorted for display while preserving score-rank within group.
    const grouped = [];
    GROUP_ORDER.forEach(type => {
      top.forEach(c => { if (c.type === type) grouped.push(c); });
    });

    currentResults = grouped;
    activeIndex = 0;

    if (!grouped.length) {
      paletteList.innerHTML = '<div class="cmdp-empty">No matches</div>';
      return;
    }

    let html = '';
    let lastType = null;
    for (let i = 0; i < grouped.length; i++) {
      const r = grouped[i];
      if (r.type !== lastType) {
        html += `<div class="cmdp-section">${escapeHtml(r.type)}</div>`;
        lastType = r.type;
      }
      const sub = r.subtitle ? `<span class="cmdp-sub">${escapeHtml(r.subtitle)}</span>` : '';
      html += `<div class="cmdp-row${i === 0 ? ' active' : ''}" data-idx="${i}" role="option">
        <span class="cmdp-label">${escapeHtml(r.label)}</span>
        ${sub}
      </div>`;
    }
    paletteList.innerHTML = html;
  }

  function openPalette() {
    if (paletteOpen) return;
    buildPaletteDom();
    cachedCandidates = buildCandidates();
    paletteRoot.removeAttribute('hidden');
    paletteOpen = true;
    paletteInput.value = '';
    renderResults();
    setTimeout(() => { paletteInput.focus(); paletteInput.select(); }, 0);
  }

  function closePalette() {
    if (!paletteOpen || !paletteRoot) return;
    paletteRoot.setAttribute('hidden', '');
    paletteOpen = false;
    cachedCandidates = null;
    currentResults = [];
  }

  // ---------------------------------------------------------------------------
  // Keyboard help overlay
  // ---------------------------------------------------------------------------

  let helpRoot = null;
  let helpOpen = false;

  const SHORTCUTS = [
    { keys: ['/'],                                       desc: 'Focus search' },
    { keys: ['Cmd/Ctrl', 'K'],                           desc: 'Command palette' },
    { keys: ['?'],                                       desc: 'This help' },
    { keys: ['Cmd/Ctrl', 'Z'],                           desc: 'Undo' },
    { keys: ['Shift', 'Cmd/Ctrl', 'Z'],                  desc: 'Redo' },
    { keys: ['Esc'],                                     desc: 'Close modals' },
    { keys: ['←', '↑', '↓', '→'],    desc: 'Navigate unit grid' },
    { keys: ['Enter'],                                   desc: 'Open selected' },
    { keys: ['a'],                                       desc: 'Add to army' },
  ];

  function buildHelpDom() {
    if (helpRoot) return helpRoot;
    const root = document.createElement('div');
    root.className = 'cmdp-help-backdrop';
    root.setAttribute('hidden', '');
    const rows = SHORTCUTS.map(s => {
      const keys = s.keys.map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('<span class="cmdp-kbd-plus">+</span>');
      return `<div class="cmdp-help-row"><div class="cmdp-help-keys">${keys}</div><div class="cmdp-help-desc">${escapeHtml(s.desc)}</div></div>`;
    }).join('');
    root.innerHTML = `
      <div class="cmdp-help-modal" role="dialog" aria-label="Keyboard shortcuts">
        <div class="cmdp-help-header">
          <h3>Keyboard Shortcuts</h3>
          <button type="button" class="cmdp-help-close" aria-label="Close">&times;</button>
        </div>
        <div class="cmdp-help-grid">${rows}</div>
      </div>
    `;
    document.body.appendChild(root);
    helpRoot = root;
    root.addEventListener('click', e => {
      if (e.target === root) closeHelp();
    });
    root.querySelector('.cmdp-help-close').addEventListener('click', closeHelp);
    return root;
  }

  function openHelp() {
    if (helpOpen) { closeHelp(); return; }
    // If palette is open, close it first so overlays don't stack.
    if (paletteOpen) closePalette();
    buildHelpDom();
    helpRoot.removeAttribute('hidden');
    helpOpen = true;
  }

  function closeHelp() {
    if (!helpOpen || !helpRoot) return;
    helpRoot.setAttribute('hidden', '');
    helpOpen = false;
  }

  // ---------------------------------------------------------------------------
  // Global keybindings (only claim Cmd/Ctrl+K, and `?` when not typing)
  // ---------------------------------------------------------------------------

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  document.addEventListener('keydown', function (e) {
    const mod = e.metaKey || e.ctrlKey;
    const key = (e.key || '').toLowerCase();

    if (mod && key === 'k' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
      return;
    }

    // Esc closes our overlays even when focus is in the palette input.
    if (e.key === 'Escape') {
      if (paletteOpen) { closePalette(); return; }
      if (helpOpen)    { closeHelp();    return; }
    }

    if (isTypingTarget(e.target)) return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      // Keep the existing keyboard.js toast behavior off the critical path:
      // prefer the rich overlay.
      e.preventDefault();
      e.stopPropagation();
      openHelp();
      return;
    }
  }, true); // capture, so we win over keyboard.js's `?` toast

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-cmdp',
    region: 'icon',
    label: '⌘K',
    ariaLabel: 'Command palette',
    title: 'Open command palette (Cmd/Ctrl+K)',
    onClick: openPalette,
  });

  App.hooks.bootstrap.push(function () {
    // DOM bindings are already installed above; nothing faction-dependent here.
  });

  // Expose for programmatic access (e.g., other modules / tests).
  App.openCommandPalette = openPalette;
  App.closeCommandPalette = closePalette;
  App.openKeyboardHelp = openHelp;
  App.closeKeyboardHelp = closeHelp;
})();
