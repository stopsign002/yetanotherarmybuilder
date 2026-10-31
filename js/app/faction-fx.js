// app/faction-fx.js — accent-colored particle bursts at the FLIP landing site, and
// a banner archetype on <body> so faction-banner.css can paint a subtle SVG behind the hero.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  // OS query OR the in-app toggle (App.prefersReducedMotion, mode-shell.js).
  function reducedMotion() {
    if (typeof App.prefersReducedMotion === 'function') return App.prefersReducedMotion();
    return !!(mqReduce && mqReduce.matches);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Faction-name → archetype map. Short names match App.FACTION_COLORS keys.
  // ─────────────────────────────────────────────────────────────────────────
  const FACTION_ARCHETYPE = {
    'Adeptus Astartes':    'imperium-marines',
    'Space Marines':       'imperium-marines',
    'Blood Angels':        'imperium-marines',
    'Dark Angels':         'imperium-marines',
    'Grey Knights':        'imperium-marines',
    'Space Wolves':        'imperium-marines',
    'Imperial Fists':      'imperium-marines',
    'Black Templars':      'imperium-marines',
    'Iron Hands':          'imperium-marines',
    'Salamanders':         'imperium-marines',
    'Ultramarines':        'imperium-marines',
    'White Scars':         'imperium-marines',
    'Raven Guard':         'imperium-marines',
    'Deathwatch':          'imperium-marines',
    'Astra Militarum':     'imperium-guard',
    'Adepta Sororitas':    'sororitas',
    'Adeptus Custodes':    'custodes',
    'Adeptus Mechanicus':  'mechanicus',
    'Imperial Knights':    'knights',
    'Chaos Knights':       'knights',
    'Chaos Space Marines': 'chaos',
    'Death Guard':         'chaos',
    'Thousand Sons':       'chaos',
    'World Eaters':        'chaos',
    "Emperor's Children":  'chaos',
    'Chaos Daemons':       'daemons',
    'Tyranids':            'tyranid',
    'Genestealer Cults':   'genestealer',
    'Orks':                'ork',
    'Aeldari':             'eldar',
    'Drukhari':            'drukhari',
    'Harlequins':          'eldar',
    'Necrons':             'necron',
    "T'au Empire":         'tau',
    'Leagues of Votann':   'votann',
  };

  function archetypeForFaction(name) {
    if (!name) return 'default';
    const short = UI.factionShort(name.trim());
    return FACTION_ARCHETYPE[short] || FACTION_ARCHETYPE[name] || 'default';
  }

  // Coarser archetype for hero banner (groups similar themes).
  function bannerArchetype(arch) {
    if (arch === 'imperium-marines' || arch === 'imperium-guard') return 'imperium';
    if (arch === 'sororitas' || arch === 'custodes' || arch === 'mechanicus' || arch === 'knights') return 'imperium';
    if (arch === 'chaos' || arch === 'daemons') return 'chaos';
    if (arch === 'eldar' || arch === 'drukhari') return 'eldar';
    if (arch === 'tyranid' || arch === 'genestealer') return 'tyranid';
    if (arch === 'ork')    return 'ork';
    if (arch === 'tau')    return 'tau';
    if (arch === 'necron') return 'necron';
    if (arch === 'votann') return 'votann';
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Current-faction lookup (uses already-set state)
  // ─────────────────────────────────────────────────────────────────────────
  function currentFactionName() {
    const s = App.state || {};
    if (s.detachmentFaction && s.detachmentFaction.name) return s.detachmentFaction.name;
    if (s.factionFilter && s.factionFilter !== 'all')    return s.factionFilter;
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  function getAccent() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return v || '#c8c8c8';
    } catch (_) { return '#c8c8c8'; }
  }

  function ensureLayer() {
    let l = document.getElementById('yaab-fx-layer');
    if (l) return l;
    l = document.createElement('div');
    l.id = 'yaab-fx-layer';
    document.body.appendChild(l);
    return l;
  }

  function particleBurst(x, y, opts) {
    if (reducedMotion()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const o = opts || {};
    const count = o.count || 12;
    const accent = getAccent();
    const layer = ensureLayer();
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'yaab-fx-particle';
      const angle = (Math.PI * 2) * (i / count) + (Math.random() * 0.5 - 0.25);
      const dist  = 28 + Math.random() * 56;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 12; // slight upward bias for that "hit" feel
      const size = 3 + Math.random() * 3;
      p.style.left = (x - size / 2) + 'px';
      p.style.top  = (y - size / 2) + 'px';
      p.style.width  = size + 'px';
      p.style.height = size + 'px';
      p.style.background = accent;
      p.style.color      = accent;
      p.style.setProperty('--dx', dx + 'px');
      p.style.setProperty('--dy', dy + 'px');
      p.style.animationDelay = (Math.random() * 40) + 'ms';
      layer.appendChild(p);
      setTimeout(function () { try { p.remove(); } catch (_) {} }, 720);
    }
  }

  function syncBanner() {
    const body = document.body;
    if (!body) return;
    const name = currentFactionName();
    if (!name) {
      body.removeAttribute('data-faction-banner');
      return;
    }
    const arch = archetypeForFaction(name);
    const banner = bannerArchetype(arch);
    if (banner) body.setAttribute('data-faction-banner', banner);
    else        body.removeAttribute('data-faction-banner');
  }

  App.factionFx = {
    particleBurst:         particleBurst,
    archetypeForFaction:   archetypeForFaction,
    syncBanner:            syncBanner,
  };

  App.hooks.armyChange.push(function () { syncBanner(); });
  App.hooks.selectionChange.push(function () { syncBanner(); });
  App.hooks.bootstrap.push(function () { syncBanner(); });
})();
