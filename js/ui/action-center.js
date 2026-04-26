// ui/action-center.js — slide-in sheet that replaces Tools/More dropdowns.
(function () {
  const UI = window.UI = window.UI || {};

  // ── Section definitions (display order) ──────────────────────────────
  const SECTIONS = [
    { id: 'game-day',  title: 'Game Day',       desc: 'Match flow & on-table tools' },
    { id: 'analyze',   title: 'Analyze',        desc: 'Insight into your roster' },
    { id: 'export',    title: 'Print & Export', desc: 'Take your list off the screen' },
    { id: 'browse',    title: 'Browse',         desc: 'Inspiration & guided tours' },
    { id: 'collection',title: 'Collection',     desc: 'Models, campaigns, history' },
    { id: 'settings',  title: 'Settings',       desc: 'Tweak the app' },
  ];

  // Cards by section. Order within a section is registration order.
  const cards = {};
  let initialized = false;

  function $(id) { return document.getElementById(id); }

  function ensureInit() {
    if (initialized) return;
    const root = $('action-center-root');
    if (!root) return;

    SECTIONS.forEach(s => { cards[s.id] = []; });

    $('action-center-close').addEventListener('click', close);
    $('action-center-scrim').addEventListener('click', close);

    // Esc to close.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && root.classList.contains('is-open')) {
        close();
        e.preventDefault();
      }
    });

    const search = $('action-center-search');
    search.addEventListener('input', () => applyFilter(search.value));

    initialized = true;
  }

  // Public API ───────────────────────────────────────────────────────────
  // Add an action card to a named section.
  // action = { id?, label, title?, description?, onClick }
  function registerAction(action, sectionId) {
    ensureInit();
    const sid = cards[sectionId] ? sectionId : 'settings';
    cards[sid].push(action);
  }

  function clearActions() {
    Object.keys(cards).forEach(k => { cards[k] = []; });
    const body = $('action-center-body');
    if (body) {
      body.querySelectorAll('.ac-section').forEach(n => n.remove());
    }
  }

  function render() {
    ensureInit();
    const body = $('action-center-body');
    if (!body) return;
    // Wipe any existing sections (keep the "empty" placeholder).
    body.querySelectorAll('.ac-section').forEach(n => n.remove());

    const empty = $('action-center-empty');
    SECTIONS.forEach(s => {
      const list = cards[s.id] || [];
      const sec = document.createElement('section');
      sec.className = 'ac-section';
      sec.dataset.sectionId = s.id;
      if (!list.length) sec.classList.add('is-empty');

      const h = document.createElement('div');
      h.className = 'ac-section-header';
      const title = document.createElement('h3');
      title.className = 'ac-section-title';
      title.textContent = s.title;
      h.appendChild(title);
      const count = document.createElement('span');
      count.className = 'ac-section-count';
      count.textContent = list.length ? String(list.length) : '';
      h.appendChild(count);
      sec.appendChild(h);

      const grid = document.createElement('div');
      grid.className = 'ac-grid';
      list.forEach(a => grid.appendChild(buildCard(a)));
      sec.appendChild(grid);

      body.insertBefore(sec, empty || null);
    });
    if (empty) empty.hidden = true;
  }

  function buildCard(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ac-card';
    if (a.id) btn.dataset.actionId = a.id;
    if (a.title) btn.title = a.title;
    if (a.ariaLabel) btn.setAttribute('aria-label', a.ariaLabel);

    const name = document.createElement('span');
    name.className = 'ac-card-name';
    name.textContent = a.label || a.title || a.id || 'Action';
    btn.appendChild(name);

    const desc = document.createElement('span');
    desc.className = 'ac-card-desc';
    desc.textContent = a.description || a.title || '';
    if (desc.textContent) btn.appendChild(desc);

    btn.addEventListener('click', e => {
      // Run the registered handler then close the sheet.
      try {
        if (typeof a.onClick === 'function') a.onClick(e);
      } catch (err) {
        console.warn('[action-center] handler threw', err);
      }
      close();
    });
    return btn;
  }

  function applyFilter(q) {
    const norm = String(q || '').trim().toLowerCase();
    const body = $('action-center-body');
    const empty = $('action-center-empty');
    if (!body) return;
    let total = 0;
    body.querySelectorAll('.ac-section').forEach(sec => {
      let visible = 0;
      sec.querySelectorAll('.ac-card').forEach(card => {
        const text = (card.textContent || '').toLowerCase();
        const ok = !norm || text.indexOf(norm) !== -1;
        card.hidden = !ok;
        if (ok) visible++;
      });
      sec.classList.toggle('is-empty', visible === 0);
      total += visible;
    });
    if (empty) empty.hidden = total > 0;
  }

  function open() {
    ensureInit();
    render();
    const root = $('action-center-root');
    if (!root) return;
    root.hidden = false;
    // Force a frame so the transition runs from translateX(100%).
    requestAnimationFrame(() => root.classList.add('is-open'));
    const trigger = $('topbar-action-center');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    const search = $('action-center-search');
    if (search) {
      search.value = '';
      applyFilter('');
      // Focus the search after the transition starts.
      setTimeout(() => search.focus(), 80);
    }
  }

  function close() {
    const root = $('action-center-root');
    if (!root) return;
    root.classList.remove('is-open');
    const trigger = $('topbar-action-center');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    // Hide after transition.
    const reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reduce ? 0 : 280;
    setTimeout(() => { root.hidden = true; }, delay);
    if (trigger) trigger.focus();
  }

  function isOpen() {
    const root = $('action-center-root');
    return !!(root && root.classList.contains('is-open'));
  }

  function toggle() { isOpen() ? close() : open(); }

  UI.actionCenter = {
    open, close, toggle, isOpen,
    registerAction, clearActions, render,
    sections: SECTIONS.map(s => s.id),
  };
})();
