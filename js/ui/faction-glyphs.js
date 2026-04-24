// ui/faction-glyphs.js — original geometric faction glyphs (inline SVG) + DOM injection helpers.
(function () {
  const App = window.App = window.App || {};
  if (App._factionGlyphsInstalled) return;
  App._factionGlyphsInstalled = true;

  // Each glyph is a 24×24 viewBox path drawn in `currentColor`. All shapes are
  // ORIGINAL geometric primitives — no GW iconography. They evoke the army's
  // theme through abstract form (wedge, claw, gear, star, etc.) without
  // copying any copyrighted symbol.
  const PATHS = {
    // Astartes-family — forward arrow / wedge (combat advance).
    'Adeptus Astartes':    'M12 2 L21 20 L12 16 L3 20 Z',
    'Space Marines':       'M12 2 L21 20 L12 16 L3 20 Z',
    'Ultramarines':        'M12 2 L21 20 L12 16 L3 20 Z',
    'Blood Angels':        'M12 2 C18 8 19 14 12 22 C5 14 6 8 12 2 Z',                                     // teardrop / drop
    'Dark Angels':         'M12 2 L20 9 L17 22 L7 22 L4 9 Z',                                              // shield
    'Grey Knights':        'M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z',                     // 4-point compass star
    'Space Wolves':        'M4 7 L9 4 L12 9 L15 4 L20 7 L17 13 L20 19 L15 22 L12 17 L9 22 L4 19 L7 13 Z', // jagged fang ring
    'Imperial Fists':      'M5 5 H19 V11 H13 V19 H11 V11 H5 Z',                                            // bold T
    'Black Templars':      'M11 2 H13 V11 H22 V13 H13 V22 H11 V13 H2 V11 H11 Z',                          // straight cross
    'Iron Hands':          'M7 4 H17 V8 H21 V20 H3 V8 H7 Z',                                              // anvil/fist block
    'Salamanders':         'M12 3 C8 7 6 10 8 14 C10 18 14 18 16 14 C18 10 16 7 12 3 Z M11 11 L13 11 L13 14 L11 14 Z', // flame
    'White Scars':         'M3 18 L10 4 L14 12 L21 6 L17 20 Z',                                           // lightning sweep
    'Raven Guard':         'M3 12 L9 8 L12 3 L15 8 L21 12 L15 16 L12 21 L9 16 Z',                         // wing diamond
    'Deathwatch':          'M12 2 L20 9 L17 22 L7 22 L4 9 Z',                                              // shield (mirrors DA)

    // Chaos-aligned — 8-point geometric star (generic, not GW chaos icon).
    'Chaos Space Marines': 'M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z',
    'Death Guard':         'M12 3 A9 9 0 1 0 12.01 3 Z M12 7 A5 5 0 1 1 11.99 7 Z M12 10 A2 2 0 1 0 12.01 10 Z', // ringed orb (rot)
    'Thousand Sons':       'M12 2 L18 6 L18 14 L12 22 L6 14 L6 6 Z M9 10 H15 V14 H9 Z',                  // hex with band
    'World Eaters':        'M3 4 L7 12 L3 20 L9 16 L12 22 L15 16 L21 20 L17 12 L21 4 L15 8 L12 2 L9 8 Z',// jagged X-burst
    "Emperor's Children":  'M12 2 C16 6 20 8 22 12 C20 16 16 18 12 22 C8 18 4 16 2 12 C4 8 8 6 12 2 Z',  // sonic lens
    'Chaos Daemons':       'M12 2 L15 9 L22 9 L17 14 L19 21 L12 17 L5 21 L7 14 L2 9 L9 9 Z',             // 5-point star
    'Chaos Knights':       'M5 4 H19 L21 12 L17 20 H7 L3 12 Z M10 9 H14 V14 H10 Z',                      // banded shield-frame

    // Xenos.
    'Necrons':             'M12 3 L20 19 L4 19 Z M12 9 L17 18 L7 18 Z',                                  // pyramid (stacked)
    "T'au Empire":         'M12 12 m -10 0 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 M12 12 m -5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M11 11 H13 V13 H11 Z', // concentric rings
    'Tyranids':            'M4 21 C4 12 8 4 18 3 C16 8 14 11 11 13 C8 15 6 17 4 21 Z',                   // curved claw
    'Orks':                'M3 5 L8 5 L12 11 L16 5 L21 5 L14 13 L21 21 L16 21 L12 15 L8 21 L3 21 L10 13 Z', // jagged X
    'Aeldari':             'M12 2 C7 8 6 14 12 22 C18 14 17 8 12 2 Z',                                    // teardrop
    'Drukhari':            'M12 2 L18 8 L12 22 L6 8 Z M12 8 L14 12 L12 18 L10 12 Z',                     // bladed kite
    'Harlequins':          'M3 12 L12 3 L21 12 L12 21 Z M12 7 L17 12 L12 17 L7 12 Z',                    // diamond-in-diamond
    'Genestealer Cults':   'M12 2 L17 7 L17 17 L12 22 L7 17 L7 7 Z M9 10 H15 V14 H9 Z',                  // hex banded
    'Leagues of Votann':   'M5 5 H19 V9 H21 V15 H19 V19 H5 V15 H3 V9 H5 Z',                              // ingot/forge

    // Imperium misc.
    'Adeptus Mechanicus':  'M12 3 L14 5 L17 4 L18 7 L21 8 L20 11 L22 13 L20 15 L21 18 L18 19 L17 22 L14 21 L12 23 L10 21 L7 22 L6 19 L3 18 L4 15 L2 13 L4 11 L3 8 L6 7 L7 4 L10 5 Z M12 9 A3 3 0 1 0 12.01 9 Z', // gear
    'Astra Militarum':     'M3 18 H21 V20 H3 Z M5 14 H19 V16 H5 Z M8 4 L12 8 L16 4 L16 12 L8 12 Z',      // banner/bunker
    'Adepta Sororitas':    'M12 2 C9 7 6 9 3 12 C6 15 9 17 12 22 C15 17 18 15 21 12 C18 9 15 7 12 2 Z',  // flame fleur
    'Adeptus Custodes':    'M12 2 L19 6 V13 C19 18 16 21 12 22 C8 21 5 18 5 13 V6 Z',                    // shield/aquila base
    'Imperial Knights':    'M5 4 H19 L21 12 L17 20 H7 L3 12 Z',                                          // wedge shield
  };

  // Generic hex fallback for anything not in the table.
  const FALLBACK = 'M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z';

  function svgFor(d) {
    return '<svg class="faction-glyph-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
           '<path d="' + d + '" fill="currentColor"></path></svg>';
  }

  // Strip "Imperium - X" / "Chaos - Y" prefixes so the lookup still works on
  // long catalogue names. Returns the trimmed short name.
  function shortName(name) {
    if (!name) return '';
    let s = String(name).trim();
    if (s.indexOf(' - ') !== -1) s = s.split(' - ').pop().trim();
    return s;
  }

  // Public API.
  App.factionGlyph = function (factionName) {
    const sn = shortName(factionName);
    const d = (sn && PATHS[sn]) || (factionName && PATHS[factionName]) || FALLBACK;
    return svgFor(d);
  };

  App.factionGlyphPath = function (factionName) {
    const sn = shortName(factionName);
    return (sn && PATHS[sn]) || (factionName && PATHS[factionName]) || FALLBACK;
  };

  App.hasFactionGlyph = function (factionName) {
    const sn = shortName(factionName);
    return !!(sn && PATHS[sn]) || !!(factionName && PATHS[factionName]);
  };

  // ── DOM injection ──────────────────────────────────────────────────────
  // We watch a small set of elements that carry faction *text* and prepend a
  // small inline glyph as a sibling. The glyph wrapper is keyed by
  // `data-glyph-for` so we can re-sync without duplicating nodes.

  const TARGETS = [
    // BUILD-mode hero faction title.
    { sel: '[data-build-hero="faction"]', mode: 'prepend', size: 28, cls: 'faction-glyph faction-glyph-hero' },
    // Detail-banner faction subtitle.
    { sel: '.detail-faction',              mode: 'prepend', size: 14, cls: 'faction-glyph faction-glyph-inline' },
  ];

  function ensureGlyphFor(el, opts) {
    if (!el) return;
    const text = (el.textContent || '').trim();
    if (!text || /^select a faction$/i.test(text)) {
      removeGlyph(el);
      return;
    }
    // Don't inject if there is no matching glyph and we already left a fallback.
    const html = App.factionGlyph(text);
    let host = el.previousElementSibling;
    if (!host || !host.classList || !host.classList.contains('faction-glyph') || host.dataset.glyphFor !== opts.sel) {
      host = document.createElement('span');
      host.className = opts.cls;
      host.dataset.glyphFor = opts.sel;
      host.style.color = 'var(--accent)';
      host.style.display = 'inline-flex';
      host.style.alignItems = 'center';
      host.style.justifyContent = 'center';
      host.style.flex = '0 0 auto';
      host.style.width = opts.size + 'px';
      host.style.height = opts.size + 'px';
      host.style.marginRight = '8px';
      host.style.verticalAlign = 'middle';
      host.style.pointerEvents = 'none';
      host.setAttribute('aria-hidden', 'true');
      // Insert before the text node.
      if (el.parentNode) el.parentNode.insertBefore(host, el);
    }
    if (host.dataset.glyphText !== text) {
      host.innerHTML = html;
      host.dataset.glyphText = text;
      const svg = host.firstElementChild;
      if (svg) {
        svg.setAttribute('width', String(opts.size));
        svg.setAttribute('height', String(opts.size));
        svg.style.display = 'block';
      }
    }
  }

  function removeGlyph(el) {
    if (!el || !el.parentNode) return;
    const sib = el.previousElementSibling;
    if (sib && sib.classList && sib.classList.contains('faction-glyph')) sib.remove();
  }

  function syncAll() {
    TARGETS.forEach(function (t) {
      const nodes = document.querySelectorAll(t.sel);
      nodes.forEach(function (n) { ensureGlyphFor(n, t); });
    });
  }

  // Throttle to one frame to coalesce mutation bursts.
  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; syncAll(); });
  }

  function startObserver() {
    if (App._factionGlyphsObserver) return;
    const mo = new MutationObserver(function () { schedule(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    App._factionGlyphsObserver = mo;
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // Re-sync on faction selection changes (immediate, doesn't wait for DOM mutations).
  if (App.hooks && Array.isArray(App.hooks.selectionChange)) {
    App.hooks.selectionChange.push(function () { schedule(); });
  }
  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(function () { schedule(); });
  }
})();
