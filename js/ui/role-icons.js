// ui/role-icons.js — small role icon prefix on unit cards (Character / Battleline / etc.) via cardClassContributor + DOM observer.
(function () {
  const App = window.App = window.App || {};
  if (App._roleIconsInstalled) return;
  App._roleIconsInstalled = true;

  // THE role table (roster.js builds its filter chips from UI.roles too).
  // Array order = classification priority, first match wins: Character →
  // Psyker → Monster → Vehicle → Battleline → Infantry. `chip` is the order of
  // the roster filter chips (kw = the keyword they match against unit.keywords).
  // Glyphs are from the geometric Unicode block so they render without
  // webfonts; tinted via `currentColor`.
  const ROLES = [
    { id: 'character',  kw: 'character',  chip: 1, glyph: '\u25C6', label: 'Character'  },
    { id: 'psyker',     kw: 'psyker',     chip: 5, glyph: '\u2756', label: 'Psyker'     },
    { id: 'monster',    kw: 'monster',    chip: 4, glyph: '\u2B22', label: 'Monster'    },
    { id: 'vehicle',    kw: 'vehicle',    chip: 3, glyph: '\u25B2', label: 'Vehicle'    },
    { id: 'battleline', kw: 'battleline', chip: 0, glyph: '\u25A3', label: 'Battleline' },
    { id: 'infantry',   kw: 'infantry',   chip: 2, glyph: '\u25CF', label: 'Infantry'   },
  ];
  ROLES.forEach(r => { const re = new RegExp('\\b' + r.kw + '\\b', 'i'); r.test = kw => re.test(kw); });
  (window.UI = window.UI || {}).roles = ROLES;

  function classifyRole(unit) {
    if (!unit || !Array.isArray(unit.keywords)) return null;
    const joined = unit.keywords.join(' ');
    for (let i = 0; i < ROLES.length; i++) {
      if (ROLES[i].test(joined)) return ROLES[i];
    }
    return null;
  }

  // Expose for any future consumer.
  App.classifyUnitRole = function (unit) {
    const r = classifyRole(unit);
    return r ? r.id : null;
  };

  // Register a class contributor so `.unit-card.role-character` etc. exists.
  // The CSS in animations-polish.css uses these classes for the ::before glyph.
  if (App.hooks && Array.isArray(App.hooks.cardClassContributors)) {
    App.hooks.cardClassContributors.push(function (unit) {
      const r = classifyRole(unit);
      return r ? 'role-' + r.id : null;
    });
  }

  // Belt-and-braces: also DOM-inject an explicit <span class="role-icon"> so
  // the marker is in the document tree (lets screen readers announce role and
  // gives us a tooltip target). The CSS pseudo-element handles the visual
  // case where the span is absent (e.g. cards built before this script ran).
  function decorateCard(card) {
    if (!card || card.dataset.roleIconDone === '1') return;
    // Find the role class we already added.
    const cls = (card.className || '').split(/\s+/).find(c => c.indexOf('role-') === 0);
    if (!cls) { card.dataset.roleIconDone = '1'; return; }
    const id = cls.slice(5);
    const role = ROLES.find(r => r.id === id);
    if (!role) { card.dataset.roleIconDone = '1'; return; }
    const nameEl = card.querySelector('.unit-card-name');
    if (!nameEl) { card.dataset.roleIconDone = '1'; return; }
    if (nameEl.querySelector('.role-icon')) { card.dataset.roleIconDone = '1'; return; }
    const span = document.createElement('span');
    span.className = 'role-icon role-icon-' + id;
    span.setAttribute('title', role.label);
    span.setAttribute('aria-label', role.label);
    span.textContent = role.glyph;
    nameEl.insertBefore(span, nameEl.firstChild);
    card.dataset.roleIconDone = '1';
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const cards = scope.querySelectorAll('.unit-card');
    cards.forEach(decorateCard);
  }

  let raf = 0;
  function schedule(root) {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; scan(root || document); });
  }

  function startObserver() {
    if (App._roleIconsObserver) return;
    const mo = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.addedNodes && r.addedNodes.length) { schedule(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    App._roleIconsObserver = mo;
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(function () { schedule(); });
  }
})();
