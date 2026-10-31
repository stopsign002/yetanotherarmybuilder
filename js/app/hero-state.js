// app/hero-state.js — empty-army hero CTA and Cmd+K search hint badge.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // ── Platform detection for shortcut label ─────────────────────
  function isMac() {
    try {
      const uad = navigator.userAgentData;
      if (uad && uad.platform) return /mac/i.test(uad.platform);
    } catch (_) {}
    const p = (navigator.platform || '') + ' ' + (navigator.userAgent || '');
    return /mac|iphone|ipad|ipod/i.test(p);
  }
  const SHORTCUT_LABEL = isMac() ? '⌘K' : 'Ctrl K';

  // ── Helpers ───────────────────────────────────────────────────
  const esc = UI.escapeHtml;

  // ─────────────────────────────────────────────────────────────
  // 1. Hero / cold-start state
  // ─────────────────────────────────────────────────────────────

  const HERO_ID = 'yaab-hero-cta';

  function focusFactionDropdown() {
    const sel = document.getElementById('army-faction-select');
    if (!sel) return;
    try { sel.focus(); } catch (_) {}
    if (typeof sel.showPicker === 'function') {
      try { sel.showPicker(); return; } catch (_) {}
    }
    // Best-effort fallback: dispatch a mousedown so native UA opens it.
    try { sel.click(); } catch (_) {}
  }

  function clickLoadArmy() {
    const btn = document.getElementById('btn-load-army');
    if (btn) btn.click();
  }

  function buildHeroEl() {
    const state = App.state || {};
    const factionSelected = state.factionFilter && state.factionFilter !== 'all';

    const wrap = document.createElement('li');
    wrap.id = HERO_ID;
    wrap.className = 'yaab-hero-cta';

    if (factionSelected) {
      const short = UI.factionShort(state.factionFilter || '');
      wrap.classList.add('yaab-hero-cta-mini');
      wrap.innerHTML =
        '<div class="yaab-hero-mini-headline">No units in this army yet</div>' +
        '<div class="yaab-hero-mini-sub">Pick from the ' + esc(short) +
        ' roster in the Units panel →</div>';
      return wrap;
    }

    let buttons = '';
    buttons +=
      '<button type="button" class="yaab-hero-btn" data-action="pick-faction">' +
        '<span class="yaab-hero-btn-title">Pick a faction</span>' +
        '<span class="yaab-hero-btn-sub">Browse the full roster</span>' +
      '</button>';
    buttons +=
      '<button type="button" class="yaab-hero-btn" data-action="load-saved">' +
        '<span class="yaab-hero-btn-title">Load saved</span>' +
        '<span class="yaab-hero-btn-sub">Open a previous list</span>' +
      '</button>';

    wrap.innerHTML =
      '<div class="yaab-hero-headline">Build your army</div>' +
      '<div class="yaab-hero-sub">Pick a faction to begin, or start from a saved list.</div>' +
      '<div class="yaab-hero-grid">' + buttons + '</div>';

    wrap.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const a = btn.getAttribute('data-action');
      if (a === 'pick-faction') focusFactionDropdown();
      else if (a === 'load-saved') clickLoadArmy();
    });

    return wrap;
  }

  function injectHeroIfEmpty() {
    const list = document.getElementById('army-entry-list');
    if (!list) return;
    if (document.getElementById(HERO_ID)) return;
    const empty = list.querySelector('.army-list-empty');
    if (!empty) return;
    // Only one child and it is the empty placeholder.
    if (list.children.length !== 1) return;
    const hero = buildHeroEl();
    // Replace the small placeholder with the hero block (keeps single-child invariant).
    list.replaceChild(hero, empty);
  }

  function watchArmyList() {
    const list = document.getElementById('army-entry-list');
    if (!list) return;
    // Initial pass.
    injectHeroIfEmpty();
    const obs = new MutationObserver(() => {
      // renderArmyList nukes innerHTML each call, so the hero auto-detaches.
      injectHeroIfEmpty();
    });
    obs.observe(list, { childList: true });
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Cmd+K search hint badge
  // ─────────────────────────────────────────────────────────────

  function injectKbdBadge() {
    if (typeof App.openCommandPalette !== 'function') return; // keyboard mod not loaded
    const input = document.getElementById('search-input');
    if (!input || !input.parentNode) return;
    if (document.getElementById('yaab-kbd-hint')) return;
    // A "Ctrl K" hint is meaningless on touch devices (and overlaps the search
    // placeholder on phones): skip it where there is no hover-capable pointer.
    try { if (window.matchMedia && window.matchMedia('(hover: none)').matches) return; } catch (_) {}

    // Wrap input + badge so the badge can be absolutely-positioned over the
    // input's right edge without disturbing surrounding layout.
    const parent = input.parentNode;
    const wrap = document.createElement('span');
    wrap.className = 'yaab-search-wrap';
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const badge = document.createElement('kbd');
    badge.id = 'yaab-kbd-hint';
    badge.className = 'yaab-kbd-hint';
    badge.textContent = SHORTCUT_LABEL;
    badge.title = 'Open command palette';
    badge.setAttribute('aria-hidden', 'true');
    badge.addEventListener('mousedown', e => {
      // Clicking the badge opens the palette (don't steal focus from input).
      e.preventDefault();
      try { App.openCommandPalette(); } catch (_) {}
    });
    wrap.appendChild(badge);

    function updateVisibility() {
      const focused = document.activeElement === input;
      const typed = !!(input.value && input.value.length);
      badge.classList.toggle('yaab-kbd-hint-hidden', focused || typed);
    }
    input.addEventListener('focus', updateVisibility);
    input.addEventListener('blur',  updateVisibility);
    input.addEventListener('input', updateVisibility);
    updateVisibility();
  }

  // ─────────────────────────────────────────────────────────────
  // Hooks
  // ─────────────────────────────────────────────────────────────

  App.hooks.bootstrap.push(function () {
    watchArmyList();
    injectKbdBadge();
  });

  App.hooks.selectionChange.push(function () {
    // Hero text changes between empty-state ("no faction") and mini-state
    // ("faction selected") — re-inject if the army is still empty.
    const hero = document.getElementById(HERO_ID);
    if (hero && hero.parentNode) hero.remove();
    injectHeroIfEmpty();
  });
})();
