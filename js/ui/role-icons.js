// ui/role-icons.js — small role icon prefix on unit cards (Character / Battleline / etc.) via cardClassContributor + DOM observer.
(function () {
  const App = window.App = window.App || {};
  if (App._roleIconsInstalled) return;
  App._roleIconsInstalled = true;

  // Order matters: first match wins. Character → Psyker → Vehicle → Monster → Battleline → Infantry → Other.
  // Glyphs picked from the geometric Unicode block so they render consistently
  // without needing webfonts. They're tinted via `currentColor` (CSS vars).
  const ROLES = [
    { id: 'character',  test: kw => /\bcharacter\b/i.test(kw),  glyph: '◆', label: 'Character'  }, // ◆
    { id: 'psyker',     test: kw => /\bpsyker\b/i.test(kw),     glyph: '❖', label: 'Psyker'     }, // ❖
    { id: 'monster',    test: kw => /\bmonster\b/i.test(kw),    glyph: '⬢', label: 'Monster'    }, // ⬢
    { id: 'vehicle',    test: kw => /\bvehicle\b/i.test(kw),    glyph: '▲', label: 'Vehicle'    }, // ▲
    { id: 'battleline', test: kw => /\bbattleline\b/i.test(kw), glyph: '▣', label: 'Battleline' }, // ▣
    { id: 'infantry',   test: kw => /\binfantry\b/i.test(kw),   glyph: '●', label: 'Infantry'   }, // ●
  ];

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
