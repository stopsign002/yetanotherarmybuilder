// app/lore.js — faction lore browser modal + toolbar button + click delegation on detail panel.
(function () {
  const App = window.App = window.App || {};
  const esc = (s) => (window.UI && UI.escapeHtml) ? UI.escapeHtml(s) : String(s == null ? '' : s);

  const MODAL_ID = 'yaab-lore-modal';
  const BTN_ID   = 'yaab-btn-faction-lore';

  // ---------- helpers ----------

  // Mirror applyFactionColor's short-name rule: split ' - ' and take last piece.
  function shortFactionName(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    return s.includes(' - ') ? s.split(' - ').pop().trim() : s;
  }

  function getLoreEntry(name) {
    const lore = App.FACTION_LORE || {};
    if (!name) return null;
    if (lore[name]) return { key: name, entry: lore[name] };
    const short = shortFactionName(name);
    if (lore[short]) return { key: short, entry: lore[short] };
    // case-insensitive fallback
    const lower = short.toLowerCase();
    const match = Object.keys(lore).find(k => k.toLowerCase() === lower);
    if (match) return { key: match, entry: lore[match] };
    return null;
  }

  function currentFactionGuess() {
    try {
      const s = App.state || {};
      const u = s.selectedUnit;
      if (u && u._factionName) return u._factionName;
      if (s.detachmentFaction) return s.detachmentFaction;
      if (s.selectedChapter)   return s.selectedChapter;
      if (s.factionFilter && s.factionFilter !== 'all') return s.factionFilter;
    } catch (_) {}
    return null;
  }

  // ---------- modal DOM ----------

  let modalEl = null;
  let bodyEl  = null;
  let browseEl = null;
  let lastFocused = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'lore-backdrop';
    modalEl.id = MODAL_ID;
    modalEl.setAttribute('hidden', '');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Faction lore');

    modalEl.innerHTML = ''
      + '<div class="lore-modal" role="document">'
      +   '<button type="button" class="lore-close" aria-label="Close">&times;</button>'
      +   '<div class="lore-body" id="yaab-lore-body"></div>'
      +   '<div class="lore-browse" id="yaab-lore-browse" hidden></div>'
      +   '<div class="lore-footer">'
      +     '<button type="button" class="lore-btn lore-btn-browse" data-role="browse-toggle">Browse all</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(modalEl);
    bodyEl   = modalEl.querySelector('#yaab-lore-body');
    browseEl = modalEl.querySelector('#yaab-lore-browse');

    // Backdrop click closes (only if target is the backdrop itself).
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });
    modalEl.querySelector('.lore-close').addEventListener('click', close);
    modalEl.querySelector('[data-role="browse-toggle"]').addEventListener('click', toggleBrowse);

    // Clicks inside the browse grid open the chosen faction.
    modalEl.addEventListener('click', (e) => {
      const pick = e.target.closest && e.target.closest('[data-lore-pick]');
      if (!pick) return;
      const key = pick.getAttribute('data-lore-pick');
      if (key) renderFaction(key);
    });

    return modalEl;
  }

  // ---------- render ----------

  function renderFaction(name) {
    ensureModal();
    const match = getLoreEntry(name);
    const key = match ? match.key : shortFactionName(name) || (name || '');
    const entry = match ? match.entry : null;

    // Apply faction accent to modal so border / divider pick up the colour.
    const palette = (App.FACTION_COLORS && App.FACTION_COLORS[key]) || App.DEFAULT_ACCENT;
    if (palette) {
      modalEl.style.setProperty('--lore-accent', palette[0]);
      modalEl.style.setProperty('--lore-accent-dark', palette[2]);
      modalEl.style.setProperty('--lore-accent-rgb', palette[3]);
    }

    if (entry) {
      bodyEl.innerHTML = ''
        + '<div class="lore-header">'
        +   '<div class="lore-faction-name">' + esc(key) + '</div>'
        +   '<div class="lore-tagline">' + esc(entry.tagline || '') + '</div>'
        +   '<div class="lore-divider" aria-hidden="true"></div>'
        + '</div>'
        + '<p class="lore-paragraph">' + esc(entry.body || '') + '</p>';
    } else {
      bodyEl.innerHTML = ''
        + '<div class="lore-header">'
        +   '<div class="lore-faction-name">' + esc(key || 'Unknown') + '</div>'
        +   '<div class="lore-divider" aria-hidden="true"></div>'
        + '</div>'
        + '<p class="lore-paragraph lore-missing">Lore for this faction is not yet written.</p>';
    }

    // Hide browse panel whenever we show an entry.
    if (browseEl) browseEl.setAttribute('hidden', '');
    bodyEl.scrollTop = 0;
  }

  function renderBrowseList() {
    ensureModal();
    const lore = App.FACTION_LORE || {};
    const keys = Object.keys(lore).sort((a, b) => a.localeCompare(b));
    let html = '<div class="lore-browse-title">All factions</div><div class="lore-browse-grid">';
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      html += '<button type="button" class="lore-browse-item" data-lore-pick="' + esc(k) + '">'
           +    esc(k)
           +  '</button>';
    }
    html += '</div>';
    browseEl.innerHTML = html;
    browseEl.removeAttribute('hidden');
  }

  function toggleBrowse() {
    ensureModal();
    if (browseEl.hasAttribute('hidden')) renderBrowseList();
    else browseEl.setAttribute('hidden', '');
  }

  // ---------- open / close ----------

  function open(factionName) {
    ensureModal();
    const target = factionName || currentFactionGuess();
    renderFaction(target || '');
    if (modalEl.hasAttribute('hidden')) {
      lastFocused = document.activeElement;
      modalEl.removeAttribute('hidden');
      document.body.classList.add('lore-modal-open');
      document.addEventListener('keydown', onKeydown, true);
      // Focus close button for accessibility.
      const btn = modalEl.querySelector('.lore-close');
      if (btn) { try { btn.focus(); } catch (_) {} }
    }
  }

  function close() {
    if (!modalEl || modalEl.hasAttribute('hidden')) return;
    modalEl.setAttribute('hidden', '');
    document.body.classList.remove('lore-modal-open');
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) {}
    }
    lastFocused = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  // ---------- wiring ----------

  // Event delegation on #unit-detail-panel — no edits to detail.js required.
  function wireDetailPanelDelegation() {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel || panel.dataset.loreWired === '1') return;
    panel.dataset.loreWired = '1';
    panel.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('.detail-faction');
      if (!el || !panel.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const raw = (el.textContent || '').trim();
      open(raw);
    });
    // Style hint — make the faction span look clickable.
    panel.classList.add('lore-detail-hook');
  }

  // ---------- public / hooks ----------

  App.openFactionLore = function (factionName) {
    open(factionName);
  };

  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: 'i',
    ariaLabel: 'Faction lore',
    title: 'Faction lore',
    onClick: function () { open(currentFactionGuess()); },
  });

  App.hooks.bootstrap.push(function () {
    wireDetailPanelDelegation();
  });

  // Safety: if panel mounts later, re-try on first selection change.
  App.hooks.selectionChange.push(function () {
    wireDetailPanelDelegation();
  });
})();
