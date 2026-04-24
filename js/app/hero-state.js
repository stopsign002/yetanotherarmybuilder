// app/hero-state.js — empty-army hero CTA, Cmd+K search hint badge, recent-faction chip row.
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
  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }
  function accentFor(factionName) {
    const colors = (App && App.FACTION_COLORS) || {};
    const short = shortFaction(factionName);
    const tuple = colors[short] || colors[factionName] || App.DEFAULT_ACCENT || ['#666'];
    return tuple[0];
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Hero / cold-start state
  // ─────────────────────────────────────────────────────────────

  const HERO_ID = 'yaab-hero-cta';

  function hasSurpriseMe() {
    // Detect a "surprise me" entry-point. Prefer an explicit App API if it
    // ever appears; otherwise fall back to the starter-lists modal — its
    // gallery exposes the Surprise Me button there.
    if (typeof App.starterListsRollRandom === 'function') return true;
    if (typeof App.surpriseMe === 'function') return true;
    // Starter-lists modal exists if its toolbar action got registered.
    return !!document.getElementById('yaab-btn-starter-lists');
  }

  function rollSurpriseMe() {
    if (typeof App.starterListsRollRandom === 'function') return App.starterListsRollRandom();
    if (typeof App.surpriseMe === 'function') return App.surpriseMe();
    // Fallback: open the starter-lists gallery, then click its Surprise Me
    // after the modal renders. Mirrors how command-palette handles "Save as PDF".
    const trigger = document.getElementById('yaab-btn-starter-lists');
    if (!trigger) return;
    trigger.click();
    setTimeout(() => {
      const btn = document.getElementById('starter-btn-surprise');
      if (btn) btn.click();
    }, 60);
  }

  function hasOpenStarterLists() {
    if (typeof App.openStarterLists === 'function') return true;
    return !!document.getElementById('yaab-btn-starter-lists');
  }
  function openStarterLists() {
    if (typeof App.openStarterLists === 'function') return App.openStarterLists();
    const trigger = document.getElementById('yaab-btn-starter-lists');
    if (trigger) trigger.click();
  }

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
      const short = shortFaction(state.factionFilter || '');
      wrap.classList.add('yaab-hero-cta-mini');
      wrap.innerHTML =
        '<div class="yaab-hero-mini-headline">No units in this army yet</div>' +
        '<div class="yaab-hero-mini-sub">Pick from the ' + esc(short) +
        ' roster on your right →</div>';
      return wrap;
    }

    const showStarter  = hasOpenStarterLists();
    const showSurprise = hasSurpriseMe();

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
    if (showStarter) {
      buttons +=
        '<button type="button" class="yaab-hero-btn" data-action="starter">' +
          '<span class="yaab-hero-btn-title">Try a starter list</span>' +
          '<span class="yaab-hero-btn-sub">Curated intro armies</span>' +
        '</button>';
    }
    if (showSurprise) {
      buttons +=
        '<button type="button" class="yaab-hero-btn" data-action="surprise">' +
          '<span class="yaab-hero-btn-title">Surprise me</span>' +
          '<span class="yaab-hero-btn-sub">Roll a random army</span>' +
        '</button>';
    }

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
      else if (a === 'starter') openStarterLists();
      else if (a === 'surprise') rollSurpriseMe();
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
  // 3. Faction switcher chip row (recents)
  // ─────────────────────────────────────────────────────────────

  const RECENTS_KEY = 'yaab_recent_factions';
  const RECENTS_MAX = 5;

  function readRecents() {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
    } catch (_) { return []; }
  }
  function writeRecents(arr) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(arr.slice(0, RECENTS_MAX))); }
    catch (_) {}
  }
  function pushRecent(factionName) {
    if (!factionName || factionName === 'all') return;
    const cur = readRecents();
    const filtered = cur.filter(n => n !== factionName);
    filtered.unshift(factionName);
    writeRecents(filtered);
  }

  function buildChipRow() {
    const recents = readRecents();
    if (recents.length === 0) return null;
    const sel = document.getElementById('army-faction-select');
    if (!sel) return null;
    const valid = new Set(Array.from(sel.options).map(o => o.value));

    const row = document.createElement('div');
    row.id = 'yaab-faction-chips';
    row.className = 'yaab-faction-chips';

    let added = 0;
    recents.forEach(name => {
      if (!valid.has(name)) return; // skip recents that no longer load
      const short = shortFaction(name);
      const accent = accentFor(name);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'yaab-faction-chip';
      chip.title = 'Switch to ' + name;
      chip.dataset.faction = name;
      chip.innerHTML =
        '<span class="yaab-faction-chip-dot" style="background:' + esc(accent) + '"></span>' +
        '<span class="yaab-faction-chip-label">' + esc(short) + '</span>';
      chip.addEventListener('click', () => {
        sel.value = name;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      row.appendChild(chip);
      added++;
    });
    return added > 0 ? row : null;
  }

  function renderChipRow() {
    const sel = document.getElementById('army-faction-select');
    if (!sel) return;
    // Mount inside the .form-group that wraps the faction <select>.
    const formGroup = sel.closest('.form-group');
    if (!formGroup) return;

    const existing = document.getElementById('yaab-faction-chips');
    if (existing) existing.remove();

    const row = buildChipRow();
    if (!row) return;
    formGroup.insertBefore(row, formGroup.firstChild);
  }

  // ─────────────────────────────────────────────────────────────
  // Hooks
  // ─────────────────────────────────────────────────────────────

  App.hooks.bootstrap.push(function () {
    watchArmyList();
    injectKbdBadge();
    renderChipRow();
  });

  App.hooks.selectionChange.push(function (state) {
    const cur = state && state.factionFilter;
    if (cur && cur !== 'all') pushRecent(cur);
    renderChipRow();
    // Hero text changes between empty-state ("no faction") and mini-state
    // ("faction selected") — re-inject if the army is still empty.
    const hero = document.getElementById(HERO_ID);
    if (hero && hero.parentNode) hero.remove();
    injectHeroIfEmpty();
  });

  App.hooks.armyChange.push(function () {
    // renderArmyList already wipes innerHTML; the MutationObserver re-injects
    // when the empty placeholder reappears.
  });

  // Expose the recent-faction tracker for external use (e.g. tests, other modules).
  App.heroState = {
    pushRecent: pushRecent,
    readRecents: readRecents,
    rerender: function () { renderChipRow(); injectHeroIfEmpty(); },
  };
})();
