// app/themes.js — App.Themes: the runtime half of the interchangeable-theme
// system. The registry and the pre-paint loader live in js/theme-boot.js (a
// synchronous head script); this file adds everything that needs the app to
// exist: switching at runtime, persistence + cloud sync, cross-tab/pull
// reaction, and the faction-accent retint.
//
// ── Faction accent ──────────────────────────────────────────────────────
// App.FACTION_COLORS is a palette of light pastels (HSL L ≈ 78%) chosen to
// read against the default theme's near-black panels. Drop those same pastels
// onto a white ground — as the Neo-Brutalist theme does — and the accent all
// but disappears; the 4px hard offset shadow under a selected unit card, which
// is the single loudest place the faction colour shows up in that style, turns
// into a pale smudge.
//
// So a theme declares an `accentMode` and this module retints the SAME faction
// hue to suit that theme's ground: it never picks a different colour, only a
// different lightness/saturation of the one the faction already owns. The
// default theme declares `accentMode: null` and gets the palette back
// byte-identical — App.applyFactionColor behaves exactly as it did before this
// module existed.
(function () {
  'use strict';
  const App = window.App = window.App || {};
  const REG = window.YAAB_THEMES;
  if (!REG) return; // theme-boot.js missing → default theme, nothing to do.

  const STORAGE_KEY = REG.STORAGE_KEY;

  // ── Colour maths ─────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = String(hex || '').trim().replace('#', '');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue(p, q, h + 1 / 3) * 255),
      Math.round(hue(p, q, h) * 255),
      Math.round(hue(p, q, h - 1 / 3) * 255),
    ];
  }
  function toHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }
  // Re-light a colour while keeping its hue. `minSat` is a floor, not a
  // target — and it is skipped entirely below 0.10 saturation so that
  // App.DEFAULT_ACCENT (a pure grey, used when no faction is chosen) stays
  // grey instead of being given an arbitrary hue by the floor.
  function relight(hex, lightness, minSat) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const [h, s, ] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const sat = s < 0.10 ? s : Math.max(s, minSat);
    return hslToRgb(h, sat, lightness);
  }

  // Per-mode recipes. Lightness targets are picked against the theme's ground:
  // ~46% is the darkest a mid-tone can sit on white and still read as its own
  // hue rather than as black; ~72% is the mirror of that on near-black.
  //
  // Each recipe also picks WHICH slot of the faction tuple to build from.
  // The tuple is [pastel, lighter, saturated-mid, rgb] — the pastel is right
  // for a dark ground, the saturated mid is the honest starting point for a
  // light one.
  const MODES = {
    light: { from: 2, accent: 0.46, hover: 0.37, dark: 0.29, minSat: 0.62 },
    dark:  { from: 0, accent: 0.72, hover: 0.82, dark: 0.60, minSat: 0.66 },
  };

  // Called by App.applyFactionColor (js/app/state.js). Returns a replacement
  // [accent, hover, dark, rgb] tuple, or null to leave the palette untouched.
  App.Themes = App.Themes || {};
  App.Themes.remapAccent = function (tuple) {
    const theme = REG.byId(current());
    const mode = theme && theme.accentMode && MODES[theme.accentMode];
    if (!mode || !Array.isArray(tuple)) return null;
    const src = tuple[mode.from] || tuple[0];
    const accent = relight(src, mode.accent, mode.minSat);
    const hover  = relight(src, mode.hover,  mode.minSat);
    const dark   = relight(src, mode.dark,   mode.minSat);
    if (!accent || !hover || !dark) return null;
    return [toHex(accent), toHex(hover), toHex(dark), accent.join(', ')];
  };

  // ── Current theme + switching ────────────────────────────────────────
  let _current = REG.stored();

  function current() { return _current; }

  // The faction whose colour is currently painted. Mirrors the two call sites
  // in js/app/events.js so a theme switch re-derives exactly what a faction
  // change would have.
  function currentFaction() {
    const s = App.state || {};
    const f = s.selectedChapter || s.factionFilter;
    return (!f || f === 'all') ? null : f;
  }

  function paint(id) {
    _current = (REG.byId(id) || REG.byId(REG.DEFAULT_ID)).id;
    REG.apply(_current);
    // The accent recipe changed under us, so re-derive it for the live faction.
    if (typeof App.applyFactionColor === 'function') {
      try { App.applyFactionColor(currentFaction()); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('yaab-theme-changed', { detail: { id: _current } }));
    } catch (_) {}
    // Repaint the drawer if it is open — the theme rows show a selected state.
    try {
      if (App.settingsDrawer && App.settingsDrawer.isOpen && App.settingsDrawer.isOpen()) {
        App.settingsDrawer.render();
      }
    } catch (_) {}
  }

  App.Themes.list    = function () { return REG.list.slice(); };
  App.Themes.get     = current;
  App.Themes.current = function () { return REG.byId(_current); };

  App.Themes.set = function (id) {
    if (!REG.byId(id)) return false;
    if (id === _current) return true;
    // Plain localStorage.setItem on purpose: js/app/sync.js monkey-patches it
    // and yaab_theme is in SYNCED_BAG_KEYS, so this write is what pushes the
    // choice to the account. Writing it any other way would keep the theme
    // stuck on one device.
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    paint(id);
    return true;
  };

  // Cross-tab changes AND cloud pulls both arrive as a `storage` event —
  // sync.js fires a synthetic one for every key it overwrites from the server
  // (see the bag-merge block there), which is what makes the theme follow the
  // account onto a second device without a reload.
  window.addEventListener('storage', function (e) {
    if (!e || e.key !== STORAGE_KEY) return;
    const next = REG.stored();
    if (next !== _current) paint(next);
  });
})();
