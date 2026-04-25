// app/faction-fx.js — faction-themed add stingers + particle bursts + hero banner archetype.
// Synthesizes per-faction WebAudio cues (no sample files), emits accent-colored
// particle bursts at the FLIP landing site, and tags <body> with a banner
// archetype so faction-banner.css can paint a subtle SVG behind the hero.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  const PEAK = 0.08; // matches sound-fx.js cap — must NOT be obnoxious
  let ctx = null;

  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  function ensureCtx() {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (_) { ctx = null; return null; } }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }
  function soundOn() {
    return typeof App.isSoundEnabled === 'function' ? App.isSoundEnabled() : false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Synth primitives
  // ─────────────────────────────────────────────────────────────────────────
  function tone(c, freq, dur, opts) {
    const o = opts || {};
    const start = c.currentTime + (o.delay || 0);
    const peak  = Math.min(o.peak != null ? o.peak : PEAK, PEAK);
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = o.type || 'sine';
    const fromF = (o.fromFreq != null) ? o.fromFreq : freq;
    osc.frequency.setValueAtTime(fromF, start);
    if (o.fromFreq != null) osc.frequency.exponentialRampToValueAtTime(Math.max(0.001, freq), start + dur * 0.9);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
  function noise(c, dur, opts) {
    const o = opts || {};
    const peak = Math.min(o.peak != null ? o.peak : PEAK * 0.7, PEAK);
    const sr = c.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = c.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const start = c.currentTime + (o.delay || 0);
    g.gain.setValueAtTime(peak, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(g).connect(c.destination);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-archetype stingers — each is ~120-280ms, shaped to evoke the faction
  // ─────────────────────────────────────────────────────────────────────────
  const STINGERS = {
    'imperium-marines': function (c) {
      // Bolter rack: noise click + low thump
      noise(c, 0.04, { peak: PEAK * 0.6 });
      tone(c, 90, 0.18, { type: 'sine', fromFreq: 160, peak: PEAK * 0.9 });
    },
    'imperium-guard': function (c) {
      // Drum thump
      noise(c, 0.025, { peak: PEAK * 0.4 });
      tone(c, 70, 0.16, { type: 'triangle', fromFreq: 130, peak: PEAK * 0.9 });
    },
    'sororitas': function (c) {
      // Choir-like harmonic
      tone(c, 698, 0.22, { type: 'triangle', peak: PEAK * 0.55 });
      tone(c, 880, 0.20, { type: 'triangle', peak: PEAK * 0.45, delay: 0.01 });
    },
    'custodes': function (c) {
      // Solemn bell
      tone(c, 660, 0.32, { type: 'triangle', peak: PEAK * 0.7 });
      tone(c, 990, 0.20, { type: 'triangle', peak: PEAK * 0.3, delay: 0.005 });
    },
    'mechanicus': function (c) {
      // Servo whine ramp + cutoff
      tone(c, 800, 0.20, { type: 'sawtooth', fromFreq: 200, peak: PEAK * 0.45 });
      noise(c, 0.03, { peak: PEAK * 0.3, delay: 0.18 });
    },
    'knights': function (c) {
      // Metallic stomp + servo whine
      tone(c, 60, 0.22, { type: 'sine', peak: PEAK * 0.95 });
      tone(c, 1500, 0.04, { type: 'square', peak: PEAK * 0.4 });
      noise(c, 0.04, { peak: PEAK * 0.45, delay: 0.005 });
    },
    'chaos': function (c) {
      // Detuned dissonance
      tone(c, 220, 0.18, { type: 'sawtooth', peak: PEAK * 0.5 });
      tone(c, 233, 0.18, { type: 'sawtooth', peak: PEAK * 0.5, delay: 0.005 });
      tone(c, 110, 0.22, { type: 'sine', peak: PEAK * 0.7, delay: 0.04 });
    },
    'daemons': function (c) {
      // Warp shriek + noise hiss
      tone(c, 440, 0.20, { type: 'sawtooth', fromFreq: 220, peak: PEAK * 0.5 });
      tone(c, 466, 0.18, { type: 'sawtooth', peak: PEAK * 0.4, delay: 0.06 });
      noise(c, 0.10, { peak: PEAK * 0.25, delay: 0.04 });
    },
    'tyranid': function (c) {
      // High chittering screech
      tone(c, 1800, 0.06, { type: 'sawtooth', fromFreq: 3200, peak: PEAK * 0.45 });
      tone(c, 2200, 0.05, { type: 'sawtooth', fromFreq: 3600, peak: PEAK * 0.4, delay: 0.04 });
      noise(c, 0.04, { peak: PEAK * 0.25, delay: 0.02 });
    },
    'genestealer': function (c) {
      // Chittering pulses
      tone(c, 1400, 0.04, { type: 'square', peak: PEAK * 0.4 });
      tone(c, 1100, 0.04, { type: 'square', peak: PEAK * 0.4, delay: 0.05 });
      tone(c, 1600, 0.04, { type: 'square', peak: PEAK * 0.4, delay: 0.10 });
    },
    'ork': function (c) {
      // Guttural growl + grunt
      tone(c, 90, 0.18, { type: 'square', fromFreq: 180, peak: PEAK * 0.9 });
      noise(c, 0.06, { peak: PEAK * 0.5, delay: 0.04 });
    },
    'eldar': function (c) {
      // Ethereal chime arpeggio
      tone(c, 880, 0.10, { type: 'triangle', peak: PEAK * 0.5 });
      tone(c, 1320, 0.14, { type: 'triangle', peak: PEAK * 0.45, delay: 0.05 });
    },
    'drukhari': function (c) {
      // Sharp slash + noise
      tone(c, 600, 0.06, { type: 'square', fromFreq: 2000, peak: PEAK * 0.6 });
      noise(c, 0.05, { peak: PEAK * 0.4, delay: 0.02 });
    },
    'tau': function (c) {
      // Digital double-beep
      tone(c, 1000, 0.04, { type: 'square', peak: PEAK * 0.45 });
      tone(c, 1200, 0.04, { type: 'square', peak: PEAK * 0.45, delay: 0.06 });
    },
    'necron': function (c) {
      // Metallic clang with harmonic
      tone(c, 800, 0.18, { type: 'triangle', peak: PEAK * 0.7 });
      tone(c, 1200, 0.14, { type: 'triangle', peak: PEAK * 0.4, delay: 0.005 });
      tone(c, 400, 0.20, { type: 'sine', peak: PEAK * 0.5, delay: 0.02 });
    },
    'votann': function (c) {
      // Heavy mechanical clunk
      tone(c, 80, 0.20, { type: 'square', fromFreq: 130, peak: PEAK * 0.9 });
      noise(c, 0.04, { peak: PEAK * 0.5, delay: 0.05 });
    },
    'default': function (c) {
      // Soft thud (unchanged from FLIP's original safePlayThud)
      tone(c, 60, 0.18, { type: 'sine', fromFreq: 140, peak: PEAK * 0.8 });
    },
  };

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
    const short = name.indexOf(' - ') !== -1 ? name.split(' - ').pop().trim() : name.trim();
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
    const army = s.currentArmy;
    if (army && army.entries && army.entries.length) {
      const last = army.entries[army.entries.length - 1];
      if (last && last.unit && last.unit._factionName) return last.unit._factionName;
    }
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  function playAddStinger() {
    if (!soundOn()) return;
    const c = ensureCtx();
    if (!c) return;
    const arch = archetypeForFaction(currentFactionName());
    const fn = STINGERS[arch] || STINGERS.default;
    try { fn(c); } catch (_) {}
  }

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
    playAddStinger:        playAddStinger,
    particleBurst:         particleBurst,
    archetypeForFaction:   archetypeForFaction,
    syncBanner:            syncBanner,
  };

  App.hooks.armyChange.push(function () { syncBanner(); });
  App.hooks.selectionChange.push(function () { syncBanner(); });
  App.hooks.bootstrap.push(function () { syncBanner(); });
})();
