// app/sound-fx.js — opt-in WebAudio sound effects (no sample files; all synthesized).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // unsupported — don't register the toggle button

  const STORAGE_KEY = 'yaab_sound_enabled';
  const PEAK = 0.08; // hard cap on per-tone gain — must NOT be obnoxious

  // Default ON: if the user has never visited (key missing) we treat sound
  // as enabled. Only an explicit '0' (the user toggled it off) keeps it off.
  let enabled = true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) enabled = true;
    else enabled = (v === '1');
  } catch (_) { enabled = true; }

  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      try { ctx = new AC(); }
      catch (_) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (_) {}
    }
    return ctx;
  }

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------
  function tone(freq, duration, opts) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const o = opts || {};
    const start = c.currentTime + (o.delay || 0);
    const peak = Math.min(o.peak != null ? o.peak : PEAK, PEAK);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.value = freq;
    osc.connect(gain).connect(c.destination);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noiseBurst(duration, opts) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const o = opts || {};
    const peak = Math.min(o.peak != null ? o.peak : PEAK * 0.7, PEAK);
    const sampleRate = c.sampleRate;
    const len = Math.max(1, Math.floor(sampleRate * duration));
    const buf = c.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    const start = c.currentTime;
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(gain).connect(c.destination);
    src.start(start);
    src.stop(start + duration + 0.02);
  }

  // ---------------------------------------------------------------------------
  // Named effects
  // ---------------------------------------------------------------------------
  // Two-tone confirm chime: C5 (523.25) + E5 (659.25), ~80ms each
  function playSave() {
    tone(523.25, 0.08, { type: 'triangle' });
    tone(659.25, 0.08, { type: 'triangle', delay: 0.08 });
  }

  // Triumphant 3-note arpeggio: C5/E5/G5 ~110ms each
  function playLanding() {
    tone(523.25, 0.11, { type: 'triangle' });
    tone(659.25, 0.11, { type: 'triangle', delay: 0.10 });
    tone(783.99, 0.18, { type: 'triangle', delay: 0.20 });
  }

  // Soft click: short white-noise burst
  function playUnitAdded() {
    noiseBurst(0.03, { peak: PEAK * 0.5 });
  }

  // Distinct toast tones per kind — short, simple
  const TOAST_TONES = {
    info:      { f: 660,  d: 0.06, type: 'sine' },
    success:   { f: 880,  d: 0.07, type: 'triangle' },
    warning:   { f: 440,  d: 0.08, type: 'square' },
    error:     { f: 220,  d: 0.10, type: 'sawtooth' },
    celebrate: { f: 988,  d: 0.10, type: 'triangle' },
  };
  function playToast(kind) {
    const t = TOAST_TONES[kind] || TOAST_TONES.info;
    tone(t.f, t.d, { type: t.type, peak: PEAK * 0.6 });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  // 1) Save button click
  document.addEventListener('click', function (e) {
    if (!enabled) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#btn-save-army')) playSave();
  }, true);

  // 2) Unit added — armyChange hook (kind hint when available)
  let lastEntryCount = -1;
  function onArmyChange(army, kind) {
    if (!enabled || !army) {
      if (army) lastEntryCount = (army.entries || []).length;
      return;
    }
    const count = (army.entries || []).length;
    let added = false;
    if (typeof kind === 'string') {
      if (/add/i.test(kind)) added = true;
    }
    if (!added && lastEntryCount >= 0 && count > lastEntryCount) added = true;
    lastEntryCount = count;
    if (added) playUnitAdded();
  }
  App.hooks.armyChange.push(onArmyChange);

  // 3) Toast tones — observe the toast container; also catch the celebrations
  //    "Nailed it." toast as the points-limit-landing trigger.
  function wireToastObserver() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const mo = new MutationObserver(function (muts) {
      if (!enabled) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (!node.classList || !node.classList.contains('toast')) continue;
          const txt = (node.textContent || '').toLowerCase();
          // Landing celebration: prefer the arpeggio over the regular toast tone.
          if (/nailed it|landed|exact/i.test(txt) || node.classList.contains('toast-celebrate')) {
            playLanding();
            continue;
          }
          let kind = 'info';
          if (node.classList.contains('toast-success')) kind = 'success';
          else if (node.classList.contains('toast-warning')) kind = 'warning';
          else if (node.classList.contains('toast-error')) kind = 'error';
          else if (node.classList.contains('toast-celebrate')) kind = 'celebrate';
          playToast(kind);
        }
      }
    });
    mo.observe(container, { childList: true });
  }

  // ---------------------------------------------------------------------------
  // Toggle UI
  // ---------------------------------------------------------------------------
  function toggleSound() {
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
    if (enabled) {
      ensureCtx();
      // Tiny confirmation ping so the user knows it's on.
      tone(880, 0.06, { type: 'triangle', peak: PEAK * 0.6 });
    }
    if (window.UI && UI.toast) {
      UI.toast(enabled ? 'Sound effects on' : 'Sound effects off', 'info', 1400);
    }
  }

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-sound',
    region: 'icon',
    label: '♪',           // musical note (single char)
    ariaLabel: 'Sound effects',
    title: 'Toggle sound',
    onClick: toggleSound,
  });

  App.hooks.bootstrap.push(function () {
    wireToastObserver();
    const army = App.state && App.state.currentArmy;
    if (army) lastEntryCount = (army.entries || []).length;
  });

  App.toggleSound = toggleSound;
  App.isSoundEnabled = function () { return enabled; };
})();
