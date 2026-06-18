// ui/cards-mode.js — Cards: full-page mode for printable data cards.
//
// Owns the #cards-mode container. Renders a left settings rail (layout +
// pickers + display toggles) and a right preview pane that shows real,
// physical-sized pages of cards. Print and "Save PDF" both go through the
// browser's native print system: we add a body class + an injected @page
// rule, call window.print(), and rely on @media print CSS in
// cards-mode.css to hide everything except the cards. This is the most
// reliable way to render mm-precise multi-page output in any browser
// (Save as PDF is a built-in destination in Chrome/Edge/Safari/Firefox).
//
// Card content rendering (renderUnitCard / renderRuleCard /
// renderStratagemCard) lives here. The .dcc-* class names are reused for
// the actual card chrome so the visual rules stay in one place.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const HOST_ID = 'cards-mode';

  // ── Layout presets ───────────────────────────────────────────────────────
  // Page sizes in millimetres (CSS @page works in mm). Each preset is the
  // physical sheet that goes through the printer; cols × rows is the grid
  // of cards on it. A 4×6 index card with cols=rows=1 means one card per
  // sheet.
  const IN_TO_MM = 25.4;
  const LAYOUTS = [
    { id: '4x6-portrait',  label: '4×6 index card — portrait',  w:  4 * IN_TO_MM, h:  6 * IN_TO_MM, cols: 1, rows: 1 },
    { id: '4x6-landscape', label: '4×6 index card — landscape', w:  6 * IN_TO_MM, h:  4 * IN_TO_MM, cols: 1, rows: 1 },
    { id: '4x6-2up',       label: '4×6 — 2 cards (landscape, split)', w: 6 * IN_TO_MM, h: 4 * IN_TO_MM, cols: 2, rows: 1 },
    { id: 'letter-4up',    label: 'US Letter — 4 cards (2×2)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 2, rows: 2 },
    { id: 'letter-6up',    label: 'US Letter — 6 cards (2×3)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 2, rows: 3 },
    { id: 'letter-9up',    label: 'US Letter — 9 cards (3×3)',  w: 8.5 * IN_TO_MM, h: 11 * IN_TO_MM, cols: 3, rows: 3 },
    { id: 'a4-4up',        label: 'A4 — 4 cards (2×2)',         w: 210, h: 297, cols: 2, rows: 2 },
    { id: 'a4-6up',        label: 'A4 — 6 cards (2×3)',         w: 210, h: 297, cols: 2, rows: 3 },
  ];
  const DEFAULT_LAYOUT  = '4x6-portrait';
  const PAGE_MARGIN_MM  = 5;
  const CARD_GUTTER_MM  = 3;
  // ── Borderless print tuning ───────────────────────────────────────────────
  // `safeMarginMm` insets card CONTENT (text + data) away from the card edge
  // while the background/frame still bleeds to the edge — so a borderless
  // printer that overprints/enlarges the page doesn't clip the text. It's
  // injected as --dcc-safe and folded into every card's padding (and the
  // full-bleed stencil header's bleed offset) in cards-mode.css.
  // `bleedToEdge` drops the sheet margin + inter-card gutter to 0 so the card
  // background reaches the paper edge (true 1-up borderless).
  let safeMarginMm = 0;
  let bleedToEdge  = false;
  function pageMargin() { return bleedToEdge ? 0 : PAGE_MARGIN_MM; }
  function cardGutter() { return bleedToEdge ? 0 : CARD_GUTTER_MM; }

  // ── Texture presets ──────────────────────────────────────────────────────
  // Each preset overrides the .dcc-card background. `base` is the parchment-
  // equivalent gradient + fallback colour. `grain` (optional) describes an
  // SVG-feTurbulence noise overlay multiplied on top; the renderer scales
  // its alpha by the user's intensity slider (0–100). All inline-SVG so the
  // textures travel cleanly through print.
  //
  // Tuned to keep a parchment-like reading surface across themes — the
  // backgrounds shift in tint but not in luminance, so the dark text stays
  // readable on all 16 options.
  const TEXTURES = [
    { id: 'none',      label: 'No texture',        base: '#f4ead2', grain: null },
    { id: 'parchment', label: 'Oath parchment',    base: 'radial-gradient(ellipse at 50% 0%, #f7eed4 0%, #ecdfb9 60%, #d8c897 100%), #ecdfb9', grain: { freq: 0.85, oct: 2, r: 0.18, g: 0.13, b: 0.07, a: 0.45 } },
    { id: 'vellum',    label: 'Aged vellum',       base: 'radial-gradient(ellipse at 50% 0%, #fbf6e1 0%, #f3eccf 60%, #e7dcb1 100%), #f3eccf', grain: { freq: 1.10, oct: 2, r: 0.22, g: 0.18, b: 0.10, a: 0.30 } },
    { id: 'bone',      label: 'Bleached bone',     base: 'radial-gradient(ellipse at 50% 0%, #f0ebe0 0%, #e3dccf 60%, #cfc6b3 100%), #e3dccf', grain: { freq: 0.95, oct: 2, r: 0.30, g: 0.28, b: 0.24, a: 0.35 } },
    { id: 'necron',    label: 'Necron green',      base: 'radial-gradient(ellipse at 50% 0%, #e6e8d5 0%, #d3dcc0 60%, #b6c79f 100%), #d3dcc0', grain: { freq: 0.75, oct: 3, r: 0.05, g: 0.18, b: 0.10, a: 0.55 } },
    { id: 'chaos',     label: 'Chaos crimson',     base: 'radial-gradient(ellipse at 50% 0%, #efd6c8 0%, #e0bfa9 60%, #c79880 100%), #e0bfa9', grain: { freq: 0.85, oct: 3, r: 0.32, g: 0.05, b: 0.05, a: 0.55 } },
    { id: 'warp',      label: 'Warp violet',       base: 'radial-gradient(ellipse at 50% 0%, #ead8e6 0%, #d8bfd1 60%, #b994b1 100%), #d8bfd1', grain: { freq: 0.70, oct: 3, r: 0.22, g: 0.05, b: 0.28, a: 0.55 } },
    { id: 'plague',    label: 'Plague yellow',     base: 'radial-gradient(ellipse at 50% 0%, #ece7c0 0%, #d8d2a0 60%, #b6b178 100%), #d8d2a0', grain: { freq: 0.70, oct: 3, r: 0.20, g: 0.18, b: 0.05, a: 0.55 } },
    { id: 'tyranid',   label: 'Tyranid hive',      base: 'radial-gradient(ellipse at 50% 0%, #ecdee0 0%, #ddc7cc 60%, #b890a0 100%), #ddc7cc', grain: { freq: 0.55, oct: 3, r: 0.30, g: 0.10, b: 0.20, a: 0.55 } },
    { id: 'eldar',     label: 'Eldar moonsilver',  base: 'radial-gradient(ellipse at 50% 0%, #dee5ec 0%, #c8d4e0 60%, #9eb1c4 100%), #c8d4e0', grain: { freq: 0.95, oct: 2, r: 0.10, g: 0.20, b: 0.32, a: 0.40 } },
    { id: 'drukhari',  label: 'Drukhari obsidian', base: 'radial-gradient(ellipse at 50% 0%, #c8b9c8 0%, #b09bb0 60%, #836383 100%), #b09bb0', grain: { freq: 0.60, oct: 4, r: 0.12, g: 0.05, b: 0.18, a: 0.65 } },
    { id: 'ork',       label: 'Ork rust',          base: 'radial-gradient(ellipse at 50% 0%, #ecd1b3 0%, #d6b289 60%, #ad8358 100%), #d6b289', grain: { freq: 0.60, oct: 3, r: 0.45, g: 0.20, b: 0.05, a: 0.65 } },
    { id: 'tau',       label: "T'au sky",          base: 'radial-gradient(ellipse at 50% 0%, #e0e7eb 0%, #c8d3da 60%, #9bb2bd 100%), #c8d3da', grain: { freq: 1.20, oct: 1, r: 0.15, g: 0.30, b: 0.40, a: 0.30 } },
    { id: 'imperial',  label: 'Imperial khaki',    base: 'radial-gradient(ellipse at 50% 0%, #e3dcb8 0%, #cdc492 60%, #a0995e 100%), #cdc492', grain: { freq: 0.85, oct: 2, r: 0.20, g: 0.18, b: 0.05, a: 0.45 } },
    { id: 'custodes',  label: 'Custodes gold',     base: 'radial-gradient(ellipse at 50% 0%, #f0e3b0 0%, #e2cd84 60%, #b89052 100%), #e2cd84', grain: { freq: 0.95, oct: 2, r: 0.30, g: 0.20, b: 0.05, a: 0.40 } },
    { id: 'steel',     label: 'Sigmarite steel',   base: 'radial-gradient(ellipse at 50% 0%, #e6e6e6 0%, #cfcfcf 60%, #a0a0a0 100%), #cfcfcf', grain: { freq: 1.10, oct: 2, r: 0.15, g: 0.15, b: 0.15, a: 0.40 } },
  ];
  const DEFAULT_TEXTURE   = 'parchment';
  const DEFAULT_INTENSITY = 100;

  // ── Templates (card skins) ────────────────────────────────────────────────
  // A template is the overall VISUAL SKIN of every card — frame, header
  // plate, section bars, stat blocks, palette, and ink. It is orthogonal to
  // the texture/border/typography/display knobs (those carry over when you
  // switch templates) and to presets (a preset snapshots every setting,
  // including which template is active).
  //
  // Each template is applied by tagging every rendered card cell with a
  // `dcc-tpl-<id>` class; the matching skin lives in css/cards-mode.css
  // under the "Template skins" section. `classic` is the original
  // gilded-parchment GW look and needs no CSS overrides — it's the base
  // `.dcc-*` chrome. `swatch` is a CSS background used to preview the
  // template in the Layout-panel picker (dark header band + thin gold
  // rule + body colour).
  const TEMPLATES = [
    { id: 'classic',  label: 'Gilded Parchment',
      swatch: 'linear-gradient(180deg, #15140f 0 30%, #b89052 30% 33%, #ecdfb9 33% 100%)' },
    { id: 'grimdark', label: 'Grimdark Iron',
      swatch: 'linear-gradient(180deg, #0a0805 0 30%, #c39a45 30% 33%, #141109 33% 100%)' },
    { id: 'stencil',  label: 'Industrial Stencil',
      swatch: 'linear-gradient(180deg, #29251f 0 26%, #74c043 26% 30%, #ece5d6 30% 100%)' },
  ];
  const DEFAULT_TEMPLATE = 'classic';
  function isTemplateId(id) { return TEMPLATES.some(t => t.id === id); }
  function templateClass() {
    return 'dcc-tpl-' + (isTemplateId(templateId) ? templateId : DEFAULT_TEMPLATE);
  }
  function isStencil() { return templateId === 'stencil'; }

  // ── Faction accent (drives the Industrial Stencil skin) ──────────────────
  // The stencil template is themed by a single accent colour (header rule,
  // shield/CP badges, pills, section ticks, footer label). We auto-derive it
  // from the current army's faction via App.FACTION_COLORS — the saturated
  // "dark" entry (index 2) reads best on cream paper — and inject it as
  // --dcc-accent on each .dcc-page so the CSS can color-mix every tint from
  // it. Harmless to the other templates (they don't reference it). Falls
  // back to the design's Necron green when the faction is unknown.
  const STENCIL_DEFAULT_ACCENT = '#74c043';
  function currentFactionName() {
    const f = (typeof getFaction === 'function') ? getFaction() : null;
    if (f && f.factionName) return f.factionName;
    const a = (typeof getCurrentArmy === 'function') ? getCurrentArmy() : null;
    return (a && a.factionName) ? a.factionName : '';
  }
  function currentFactionShort() {
    const fac = currentFactionName();
    return fac.includes(' - ') ? fac.split(' - ').pop().trim() : fac.trim();
  }
  function currentAccent() {
    const fc = window.App && App.FACTION_COLORS;
    if (fc) {
      const entry = fc[currentFactionShort()] || fc[currentFactionName()];
      if (entry && entry[2]) return entry[2];
    }
    return STENCIL_DEFAULT_ACCENT;
  }

  function buildGrainUrl(grain, intensity) {
    if (!grain || intensity <= 0) return null;
    const a = Math.max(0, Math.min(1, (grain.a || 0.45) * (intensity / 100)));
    // Inline-SVG data URL. %23 is `#`, %25 is `%`, urlencoded so the data
    // URI parses cleanly when slammed into a `background:` shorthand.
    return "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>"
         + "<filter id='n'>"
         + "<feTurbulence baseFrequency='" + grain.freq + "' numOctaves='" + grain.oct + "' stitchTiles='stitch' seed='4'/>"
         + "<feColorMatrix values='0 0 0 0 " + grain.r + " 0 0 0 0 " + grain.g + " 0 0 0 0 " + grain.b + " 0 0 0 " + a.toFixed(3) + " 0'/>"
         + "</filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";
  }
  function textureCSS(textureId, intensity) {
    const t = TEXTURES.find(x => x.id === textureId) || TEXTURES.find(x => x.id === DEFAULT_TEXTURE);
    const grainUrl = buildGrainUrl(t.grain, intensity);
    const bg = grainUrl ? (grainUrl + ', ' + t.base) : t.base;
    const blend = grainUrl ? 'multiply, normal, normal' : 'normal';
    // Apply the same texture to the parchment overlay used by
    // continuation cards, so a spillover card visually matches the
    // primary card it follows.
    return ''
      + '.dcc-card { background: ' + bg + '; background-blend-mode: ' + blend + '; }\n'
      + '.dcc-card-cont .dcc-cont-overlay { background: ' + bg + '; background-blend-mode: ' + blend + '; }';
  }
  // Build the full dynamic stylesheet: texture, corner radius, typography
  // CSS variables, and the optional "bold small text" override. All of it
  // lives in a single <style id="cards-texture-style"> so we only ever
  // touch the DOM once per settings change.
  function applyDynamicStyle() {
    let style = document.getElementById('cards-texture-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cards-texture-style';
      document.head.appendChild(style);
    }
    const radius = Math.max(0, Math.min(20, cornerRadiusMm || 0));
    const headRadius = Math.max(0, Math.min(20, headerRadiusMm || 0));
    const safe = Math.max(0, Math.min(10, safeMarginMm || 0));
    const t = typography;
    const css = [
      textureCSS(textureId, textureIntensity),
      '.dcc-card {',
      '  border-radius: ' + radius + 'mm;',
      // Borderless safe margin — folded into every card's content padding
      // (and the full-bleed stencil header's bleed offset) in cards-mode.css.
      '  --dcc-safe: ' + safe + 'mm;',
      // Header radius cascades into .dcc-head via var(--dcc-head-radius).
      '  --dcc-head-radius: ' + headRadius + 'mm;',
      '  --dcc-stat-radius: ' + Math.max(0, Math.min(8, statRadiusMm || 0)) + 'mm;',
      '  --dcc-head-section-radius: ' + Math.max(0, Math.min(8, sectionHeadRadiusMm || 0)) + 'mm;',
      '  --dcc-name-mul: '    + t.nameSize    + ';',
      '  --dcc-stat-mul: '    + t.statSize    + ';',
      '  --dcc-w-mul: '       + t.weaponSize  + ';',
      '  --dcc-body-mul: '    + t.bodySize    + ';',
      '  --dcc-heading-mul: ' + t.headingSize + ';',
      '  --dcc-fine-mul: '    + t.fineSize    + ';',
      '  --dcc-sub-mul: '     + t.subSize     + ';',
      '}',
      // When `bold` is on, push thin text from weight 400 to 600 so it
      // survives at-size print rendering.
      t.bold
        ? '.dcc-w-kw, .dcc-keywords, .dcc-section-cols, .dcc-w-table td.dcc-num { font-weight: 600 !important; }'
        : '',
    ].join('\n');
    style.textContent = css;
  }
  // Backwards-compat shim: lots of call sites still reference the older
  // name. Both write the same stylesheet now.
  function applyTextureStyle() { applyDynamicStyle(); }

  // ── Pref persistence ────────────────────────────────────────────────────
  // All cards-mode prefs (display toggles, texture, border, radius, layout
  // overrides, typography, card-back tuning) write through here to a single
  // localStorage key `yaab_cards_prefs`. That key is in sync.js's
  // SYNCED_BAG_KEYS, which means the bag-sync layer pushes it to /api/state
  // automatically and pulls it on every other device the user signs in
  // from. Image bytes are NOT persisted here — those go through the
  // ImageStore (server-side library when signed in, IDB when anon).
  const PREFS_KEY = 'yaab_cards_prefs';
  let _prefsLoaded = false;
  let _suppressSave = false;

  function loadPrefs() {
    _suppressSave = true;
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) || {};
        if (p.display && typeof p.display === 'object') {
          Object.keys(DEFAULT_DISPLAY).forEach(k => {
            if (typeof p.display[k] === 'boolean') display[k] = p.display[k];
          });
        }
        if (typeof p.textureId === 'string')        textureId        = p.textureId;
        if (typeof p.textureIntensity === 'number') textureIntensity = p.textureIntensity;
        if (typeof p.templateId === 'string' && isTemplateId(p.templateId)) templateId = p.templateId;
        if (typeof p.borderColor === 'string')      borderColor      = p.borderColor;
        if (typeof p.cornerRadiusMm === 'number')   cornerRadiusMm   = p.cornerRadiusMm;
        if (typeof p.headerRadiusMm === 'number')   headerRadiusMm   = p.headerRadiusMm;
        if (typeof p.statRadiusMm === 'number')     statRadiusMm     = p.statRadiusMm;
        if (typeof p.sectionHeadRadiusMm === 'number') sectionHeadRadiusMm = p.sectionHeadRadiusMm;
        if (typeof p.safeMarginMm === 'number')     safeMarginMm     = p.safeMarginMm;
        if (typeof p.bleedToEdge === 'boolean')     bleedToEdge      = p.bleedToEdge;
        if (p.spilloverMode === 'continuation' || p.spilloverMode === 'fullCard') {
          spilloverMode = p.spilloverMode;
        }
        if (typeof p.allowPartialSection === 'boolean') allowPartialSection = p.allowPartialSection;
        if (typeof p.activePresetId === 'string' || p.activePresetId === null) activePresetId = p.activePresetId;
        if (typeof p.activeLayoutId === 'string')   activeLayoutId   = p.activeLayoutId;
        if (p.layoutByKind && typeof p.layoutByKind === 'object') {
          ['unit','rule','strat'].forEach(k => {
            if (p.layoutByKind[k] === null || typeof p.layoutByKind[k] === 'string') {
              layoutByKind[k] = p.layoutByKind[k];
            }
          });
        }
        if (p.typography && typeof p.typography === 'object') {
          // Stepwise typography-prefs migration. Each time we bake a
          // slider default into the CSS base, we bump prefsVersion and
          // add a divide-by-factor step here. Loading older prefs walks
          // through every step their version hasn't been through yet, so
          // a user lands at the same rendered size as before regardless
          // of which migration era their save predates.
          //   v1 → v2 (typography baseline bake — name/stat/weapon/body/
          //            heading/fine retuned to their slider preferences):
          //     name 1.20 / stat 1.50 / weapon 1.30 / body 1.20 /
          //     heading 1.30 / fine 1.20 / sub 1.00 (no change yet).
          //   v2 → v3 (subtitle baseline bake to 130%):
          //     sub 1.30.
          const ver = (typeof p.prefsVersion === 'number' && p.prefsVersion > 0) ? p.prefsVersion : 1;
          const BAKE_V2 = {
            nameSize:    1.20,
            statSize:    1.50,
            weaponSize:  1.30,
            bodySize:    1.20,
            headingSize: 1.30,
            fineSize:    1.20,
            subSize:     1.00,
          };
          const BAKE_V3 = { subSize: 1.30 };
          Object.keys(BAKE_V2).forEach(k => {
            const n = parseFloat(p.typography[k]);
            if (Number.isNaN(n) || n <= 0) return;
            let v = n;
            if (ver < 2 && BAKE_V2[k]) v = v / BAKE_V2[k];
            if (ver < 3 && BAKE_V3[k]) v = v / BAKE_V3[k];
            typography[k] = Math.max(0.5, Math.min(2.0, v));
          });
          if (typeof p.typography.bold === 'boolean') typography.bold = p.typography.bold;
        }
        if (p.cardBack && typeof p.cardBack === 'object') {
          if (typeof p.cardBack.enabled === 'boolean') cardBack.enabled = p.cardBack.enabled;
          if (typeof p.cardBack.scale   === 'number')  cardBack.scale   = p.cardBack.scale;
          if (typeof p.cardBack.offsetX === 'number')  cardBack.offsetX = p.cardBack.offsetX;
          if (typeof p.cardBack.offsetY === 'number')  cardBack.offsetY = p.cardBack.offsetY;
        }
      }
    } catch (_) {
      // Malformed JSON or quota — fall through; defaults stay in place.
    } finally {
      // CRITICAL: must reach this even on the no-prefs path. Earlier
      // versions used an early `return;` inside the try when raw was
      // empty, which left _suppressSave stuck at true forever and made
      // every subsequent savePrefs() a silent no-op. First-time users
      // saw their settings vanish on every reload as a result.
      _prefsLoaded  = true;
      _suppressSave = false;
    }
  }

  function savePrefs() {
    // Skip while loadPrefs() is mutating state (avoids a redundant write
    // and a no-op sync round-trip immediately after pull).
    if (_suppressSave) return;
    try {
      const p = {
        prefsVersion: 3,
        display: Object.assign({}, display),
        textureId, textureIntensity, templateId, borderColor,
        cornerRadiusMm, headerRadiusMm, statRadiusMm, sectionHeadRadiusMm,
        safeMarginMm, bleedToEdge,
        spilloverMode,
        allowPartialSection,
        activePresetId,
        activeLayoutId,
        layoutByKind: Object.assign({}, layoutByKind),
        typography: Object.assign({}, typography),
        cardBack: {
          enabled: cardBack.enabled,
          scale:   cardBack.scale,
          offsetX: cardBack.offsetX,
          offsetY: cardBack.offsetY,
        },
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch (_) {}
  }

  // ── Presets ───────────────────────────────────────────────────────────
  // Named snapshots of every card-render setting, so the user can save a
  // tuned look ("steve orks", "leah eldar", …) and re-apply it later when
  // they print a second batch for the same commission. The preset stores
  // every value that affects rendering — texture, border colour, corner
  // radii, typography, spillover, layout, display toggles, card-back
  // image (by ImageStore id + name, plus offsets/scale). The image
  // bytes live in ImageStore so we don't bloat the localStorage budget;
  // if the user deletes the image from their library, the preset still
  // applies everything else and just falls back to "no image".
  //
  // The presets array is synced across devices via sync.js's bag layer
  // (yaab_cards_presets is in SYNCED_BAG_KEYS), so a preset tuned on
  // the laptop is available the next time the user signs in on the
  // print machine.
  const PRESETS_KEY = 'yaab_cards_presets';
  let presets = [];           // array of { id, name, createdAt, updatedAt, settings }
  let activePresetId = null;  // last-applied preset's id; tracks the dropdown selection

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) { presets = []; return; }
      const parsed = JSON.parse(raw);
      presets = Array.isArray(parsed) ? parsed.filter(p => p && p.id && p.name) : [];
    } catch (_) { presets = []; }
  }
  function savePresets() {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
  }
  function nowIso() { return new Date().toISOString(); }
  function newPresetId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // Snapshot every render setting into a plain JSON-able object.
  function captureSettings() {
    return {
      display:             Object.assign({}, display),
      textureId, textureIntensity, templateId, borderColor,
      cornerRadiusMm, headerRadiusMm, statRadiusMm, sectionHeadRadiusMm,
      safeMarginMm, bleedToEdge,
      spilloverMode, allowPartialSection,
      activeLayoutId,
      layoutByKind:        Object.assign({}, layoutByKind),
      typography:          Object.assign({}, typography),
      cardBack: {
        enabled:  cardBack.enabled,
        scale:    cardBack.scale,
        offsetX:  cardBack.offsetX,
        offsetY:  cardBack.offsetY,
        activeId: cardBack.activeId,
        name:     cardBack.name,
      },
    };
  }
  // Apply a captured-settings object onto module state. Permissive: any
  // missing field falls back to the current value, so an older-shape
  // preset (one saved before a new setting was added) still applies
  // cleanly without nuking the newer settings.
  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    if (s.display && typeof s.display === 'object') {
      Object.keys(DEFAULT_DISPLAY).forEach(k => {
        if (typeof s.display[k] === 'boolean') display[k] = s.display[k];
      });
    }
    if (typeof s.textureId === 'string')         textureId         = s.textureId;
    if (typeof s.textureIntensity === 'number')  textureIntensity  = s.textureIntensity;
    if (typeof s.templateId === 'string' && isTemplateId(s.templateId)) templateId = s.templateId;
    if (typeof s.borderColor === 'string')       borderColor       = s.borderColor;
    if (typeof s.cornerRadiusMm === 'number')    cornerRadiusMm    = s.cornerRadiusMm;
    if (typeof s.headerRadiusMm === 'number')    headerRadiusMm    = s.headerRadiusMm;
    if (typeof s.statRadiusMm === 'number')      statRadiusMm      = s.statRadiusMm;
    if (typeof s.sectionHeadRadiusMm === 'number') sectionHeadRadiusMm = s.sectionHeadRadiusMm;
    if (typeof s.safeMarginMm === 'number')      safeMarginMm      = s.safeMarginMm;
    if (typeof s.bleedToEdge === 'boolean')      bleedToEdge       = s.bleedToEdge;
    if (s.spilloverMode === 'continuation' || s.spilloverMode === 'fullCard') spilloverMode = s.spilloverMode;
    if (typeof s.allowPartialSection === 'boolean') allowPartialSection = s.allowPartialSection;
    if (typeof s.activeLayoutId === 'string')    activeLayoutId    = s.activeLayoutId;
    if (s.layoutByKind && typeof s.layoutByKind === 'object') {
      ['unit','rule','strat'].forEach(k => {
        if (s.layoutByKind[k] === null || typeof s.layoutByKind[k] === 'string') {
          layoutByKind[k] = s.layoutByKind[k];
        }
      });
    }
    if (s.typography && typeof s.typography === 'object') {
      ['nameSize','statSize','weaponSize','bodySize','headingSize','fineSize','subSize'].forEach(k => {
        const n = parseFloat(s.typography[k]);
        if (!Number.isNaN(n) && n > 0) typography[k] = Math.max(0.5, Math.min(2.0, n));
      });
      if (typeof s.typography.bold === 'boolean') typography.bold = s.typography.bold;
    }
    if (s.cardBack && typeof s.cardBack === 'object') {
      if (typeof s.cardBack.enabled === 'boolean') cardBack.enabled = s.cardBack.enabled;
      if (typeof s.cardBack.scale   === 'number')  cardBack.scale   = s.cardBack.scale;
      if (typeof s.cardBack.offsetX === 'number')  cardBack.offsetX = s.cardBack.offsetX;
      if (typeof s.cardBack.offsetY === 'number')  cardBack.offsetY = s.cardBack.offsetY;
      if (s.cardBack.activeId != null) {
        // Resolve the image dataUrl from the loaded library. If the
        // preset's image was deleted, fall back to no image (everything
        // else still applies). reloadSavedImages() runs at mount + on
        // auth change, so savedImages is usually warm here.
        const img = savedImages.find(i => String(i.id) === String(s.cardBack.activeId));
        if (img) {
          cardBack.activeId = img.id;
          cardBack.src      = img.dataUrl;
          cardBack.name     = img.name || s.cardBack.name || '';
        } else {
          cardBack.activeId = null;
          cardBack.src      = '';
          cardBack.name     = '';
        }
      } else {
        cardBack.activeId = null;
        cardBack.src      = '';
        cardBack.name     = '';
      }
    }
  }

  function findPreset(id) { return presets.find(p => p.id === id) || null; }
  function getActivePresetName() {
    const p = findPreset(activePresetId);
    return p ? p.name : '';
  }

  // ── Display toggles ──────────────────────────────────────────────────────
  // Every section the user can hide. Grouped by card kind so the Display
  // sub-tab can render them under headings.
  const DISPLAY_GROUPS = [
    { kind: 'unit', label: 'Unit cards', keys: [
      ['points',      'Points cost'],
      ['role',        'Role / type subtitle'],
      ['invuln',      'Invulnerable save (in SV cell)'],
      ['stats',       'Stat block (M/T/SV/W/LD/OC)'],
      ['ranged',      'Ranged weapons'],
      ['melee',       'Melee weapons'],
      ['weaponKw',    'Weapon keywords (under name)'],
      ['abilities',   'Abilities'],
      ['coreAbil',    'Core abilities row'],
      ['wargear',     'Wargear options / loadout'],
      ['enhancements','Enhancement'],
      ['factionKw',   'Faction keywords footer'],
      ['unitKw',      'Unit keywords footer'],
    ]},
    { kind: 'strat', label: 'Stratagem cards', keys: [
      ['cp',         'CP cost'],
      ['phase',      'Phase'],
      ['type',       'Type label (CORE / FACTION / DETACHMENT)'],
    ]},
    { kind: 'rule', label: 'Rule cards', keys: [
      ['kindLabel',  'Subtitle (ARMY RULE / DETACHMENT RULE)'],
    ]},
  ];
  const DEFAULT_DISPLAY = (() => {
    const d = {}; DISPLAY_GROUPS.forEach(g => g.keys.forEach(([k]) => { d[k] = true; })); return d;
  })();

  // ── Mutable state ────────────────────────────────────────────────────────
  let hostEl = null;             // the #cards-mode <section>
  let mounted = false;           // false until the first renderHost()
  let activeSubTab = 'cards';    // 'cards' | 'layout' | 'display'
  let activeCardCat = 'units';   // sub-category within Cards: 'units' | 'rules' | 'strats'
  let activeLayoutId = DEFAULT_LAYOUT;
  // Per-category layout overrides. null = inherit the global activeLayoutId.
  // Lets the user, e.g., put units 1-up on 4×6 portrait while putting rules
  // and stratagems 2-up on 4×6 landscape (their typical printing flow).
  let layoutByKind = { unit: null, rule: null, strat: null };
  // Page background — shows up as a "card border" on borderless printers.
  // Default is a deep warm near-black (classic TCG aesthetic, makes the
  // parchment cards pop). User can pick a custom hex or use a preset.
  const DEFAULT_BORDER = '#0d0a07';
  let borderColor = DEFAULT_BORDER;
  // Active texture preset and intensity (0–100, %). Live-applied via the
  // <style id="cards-texture-style"> element managed by applyTextureStyle().
  let textureId        = DEFAULT_TEXTURE;
  let textureIntensity = DEFAULT_INTENSITY;
  // Active card skin (see TEMPLATES). Persisted in prefs + captured in
  // presets. Applied as a `dcc-tpl-<id>` class on every card cell.
  let templateId       = DEFAULT_TEMPLATE;
  // Card corner radius in mm. Default 3mm — slightly tighter than the
  // classic R4 corner-cutter setting; pairs well with the 2mm inner
  // radii below so the title bar, stat pills, and section heads share
  // a consistent soft-rectangle feel.
  let cornerRadiusMm = 3;
  // Spillover handling for unit cards whose content overflows:
  //   'continuation' — partial parchment overlay sized to content,
  //                    user's card-back art bleeds through underneath
  //                    (or page background when no art is set).
  //   'fullCard'     — a regular full-parchment card identical to the
  //                    primary, just with the cloned header and the
  //                    overflowing sections.
  let spilloverMode = 'continuation';
  // When false (default), spillover splits only at whole-section
  // boundaries: a section either fits on the primary or moves entirely
  // to the continuation. Rule cards (single-section bodies) therefore
  // can't split and would clip.
  // When true, the splitter is allowed to break mid-section: rule-card
  // text splits paragraph-by-paragraph onto the continuation, and a
  // unit-card section that doesn't fit at its boundary will spill its
  // overflowing rows/items onto the continuation instead of being
  // moved entirely.
  let allowPartialSection = false;
  // Title-bar header corner radius in mm. Independent of the card-frame
  // radius so users can tune the dark-bar shape (square / softly
  // rounded / matching-the-card) without affecting the gilded frame.
  let headerRadiusMm = 2;
  // Stat-cell pill rounding (M / T / SV / W / LD / OC blocks).
  let statRadiusMm = 2;
  // Category-header bar rounding (RANGED WEAPONS / ABILITIES / WARGEAR
  // bronze bars). Only top-left + top-right are visible — the bottom
  // sits flush with the section body.
  let sectionHeadRadiusMm = 2;
  // Typography multipliers — each scales a group of font sizes by the
  // user's chosen multiplier (0.8 → 1.5). 100% (1.0) is the tuned base
  // size for printed legibility, picked after dialling things in on
  // real prints; the multipliers exist so users can nudge any single
  // group up or down without touching CSS.
  // `bold` adds weight 600 to the thin elements (.dcc-w-kw, .dcc-keywords,
  // .dcc-section-cols) so small printed text doesn't ghost.
  let typography = {
    nameSize:    1.00,
    statSize:    1.00,
    weaponSize:  1.00,
    bodySize:    1.00,
    headingSize: 1.00,
    fineSize:    1.00,
    subSize:     1.00,
    bold:        true,
  };
  const TYPOGRAPHY_DEFAULTS = JSON.parse(JSON.stringify(typography));
  // Border presets — each is { id, label, hex }. Tuned for the grimdark
  // theme but covers common TCG aesthetics too.
  const BORDER_PRESETS = [
    { id: 'black',   label: 'Grimdark black',   hex: '#0d0a07' },
    { id: 'crimson', label: 'Imperial crimson', hex: '#3a0d0d' },
    { id: 'sable',   label: 'Sable purple',    hex: '#1a0d2a' },
    { id: 'navy',    label: 'Voidship navy',    hex: '#0a1228' },
    { id: 'forest',  label: 'Forest green',     hex: '#0d2014' },
    { id: 'bronze',  label: 'Aquila bronze',    hex: '#5a3f1a' },
    { id: 'bone',    label: 'Bone (blend)',     hex: '#d8c897' },
    { id: 'paper',   label: 'White paper',      hex: '#ffffff' },
  ];
  // Card-back image for duplex printing. When `enabled` and `src` is set,
  // every front page is followed by a matching back page using the same
  // layout (so 2-up front → 2-up back, etc). Workflow: print odd pages,
  // flip the stack, print even pages.
  let cardBack = {
    enabled: false,
    src: null,           // data: URL (FileReader-produced)
    name: '',
    activeId: null,      // YaabDB.images id when picked from the library
    scale: 1.0,          // 0.5 → 3.0 multiplier
    offsetX: 0,          // -100 → +100 percent of cell
    offsetY: 0,          // -100 → +100 percent of cell
  };
  // Per-account image library, populated lazily on first paint of the
  // Card-backs section. Reset + reloaded whenever the auth user changes.
  let savedImages = [];
  let savedImagesLoading = false;

  // ImageStore — thin abstraction over the persistence layer. Signed-in
  // users hit the server (so the library follows them across devices —
  // "prep on one machine, print from another"). Anon users fall back to
  // the browser-local YaabDB.images store. Same shape returned either
  // way: { id, name, dataUrl, addedAt }. See docs/CARDS_IMAGES_API.md
  // for the server contract.
  const ImageStore = {
    LIMIT: 30,
    signedIn() {
      return !!(window.App && App.Auth && App.Auth.isSignedIn && App.Auth.isSignedIn());
    },
    ownerLabel() {
      if (!this.signedIn()) return 'this browser';
      const u = App.Auth.getCurrentUser();
      return (u && u.username) ? u.username : 'account';
    },
    storageLocation() {
      return this.signedIn() ? 'cloud' : 'local';
    },
    _on401() {
      if (window.App && App.Auth && typeof App.Auth.handleSessionExpired === 'function') {
        App.Auth.handleSessionExpired();
      }
    },
    async list() {
      if (this.signedIn()) {
        try {
          const resp = await fetch('/api/images', {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' },
          });
          if (resp.status === 401) { this._on401(); return []; }
          if (resp.ok) {
            const data = await resp.json();
            return Array.isArray(data) ? data : [];
          }
        } catch (_) {}
        return [];
      }
      return (window.YaabDB && YaabDB.images) ? YaabDB.images.list('anon') : [];
    },
    async add(name, dataUrl) {
      if (this.signedIn()) {
        try {
          const resp = await fetch('/api/images', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, dataUrl: dataUrl }),
          });
          if (resp.status === 401) { this._on401(); return { ok: false, reason: 'auth' }; }
          if (resp.ok) {
            const img = await resp.json();
            return { ok: true, id: img.id, image: img };
          }
          if (resp.status === 409 || resp.status === 413) {
            let body = null;
            try { body = await resp.json(); } catch (_) {}
            return {
              ok: false,
              reason: 'limit',
              limit: (body && body.limit) || this.LIMIT,
              count: (body && body.count) || 0,
            };
          }
        } catch (_) {}
        return { ok: false, reason: 'network' };
      }
      return (window.YaabDB && YaabDB.images)
        ? YaabDB.images.add('anon', { name: name, dataUrl: dataUrl })
        : { ok: false, reason: 'unavailable' };
    },
    async remove(id) {
      if (this.signedIn()) {
        try {
          const resp = await fetch('/api/images/' + encodeURIComponent(id), {
            method: 'DELETE',
            credentials: 'same-origin',
          });
          if (resp.status === 401) { this._on401(); return false; }
          return resp.ok;
        } catch (_) { return false; }
      }
      return (window.YaabDB && YaabDB.images) ? YaabDB.images.remove(id) : false;
    },
  };

  async function reloadSavedImages() {
    savedImagesLoading = true;
    try { savedImages = await ImageStore.list(); }
    catch (_) { savedImages = []; }
    savedImagesLoading = false;
  }
  let include = { units: null, rules: null, strats: null };
  let display = Object.assign({}, DEFAULT_DISPLAY);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function getCurrentArmy() {
    const s = App.state || {};
    return s.currentArmy || (s.armyManager && s.armyManager.current) || null;
  }
  function getFaction() {
    if (typeof App.getDetachmentFaction === 'function') {
      const f = App.getDetachmentFaction();
      if (f) return f;
    }
    if (typeof App.getCurrentFaction === 'function') return App.getCurrentFaction() || null;
    const army = getCurrentArmy();
    if (!army) return null;
    return ((App.state && App.state.factions) || []).find(f => f.factionName === army.factionName) || null;
  }
  function getLayout() { return LAYOUTS.find(l => l.id === activeLayoutId) || LAYOUTS[0]; }
  function getLayoutFor(kind) {
    const id = layoutByKind[kind] || activeLayoutId;
    return LAYOUTS.find(l => l.id === id) || getLayout();
  }

  // ── Data gathering ───────────────────────────────────────────────────────
  function gatherUnits() {
    const army = getCurrentArmy();
    if (!army || !Array.isArray(army.entries)) return [];
    return army.entries.map((entry, i) => ({
      id: 'u' + i,
      label: (entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit')
           + (entry.count > 1 ? ' ×' + entry.count : ''),
      entry,
    }));
  }
  function gatherRules() {
    const out = [];
    const faction = getFaction();
    const det = (App.state && App.state.selectedDetachment) || null;
    if (faction && Array.isArray(faction.armyRules)) {
      faction.armyRules.forEach(r => {
        if (r && r.name) out.push({ id: 'r:' + r.name, label: r.name, kind: 'army', rule: r });
      });
    }
    if (det && Array.isArray(det.rules)) {
      const seen = new Set();
      det.rules.forEach(r => {
        if (!r || !r.name || seen.has(r.name)) return;
        seen.add(r.name);
        out.push({ id: 'd:' + r.name, label: r.name, kind: 'detachment', rule: r });
      });
    }
    return out;
  }
  function gatherStratagems() {
    const out = [];
    const faction = getFaction();
    const det = (App.state && App.state.selectedDetachment) || null;
    const seen = new Set();
    function pushAll(list, type, detName) {
      (Array.isArray(list) ? list : []).forEach(s => {
        if (!s || !s.name) return;
        const key = type + '::' + s.name;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ id: key, label: s.name, type, strat: s, detName: detName || null });
      });
    }
    if (det) {
      pushAll(det.stratagems, 'detachment', det.name);
      pushAll(det.gdcStratagems, 'detachment', det.name);
    }
    if (faction) {
      pushAll(faction.factionStratagems, 'faction');
      pushAll(faction.gdcFactionStratagems, 'faction');
    }
    pushAll(App.CORE_STRATAGEMS || [], 'core');
    return out;
  }
  function syncIncludeDefaults() {
    function defaultAll(items, key) {
      if (!include[key]) include[key] = new Set(items.map(x => x.id));
    }
    defaultAll(gatherUnits(),       'units');
    defaultAll(gatherRules(),       'rules');
    defaultAll(gatherStratagems(),  'strats');
  }

  // ── Card content renderers ──────────────────────────────────────────────
  // Output is HTML for the inside of a `<article class="dcc-card">` node.
  // Card chrome is styled in css/cards-mode.css under the .dcc-* names.

  // Reformat structured-text descriptions (abilities, rules, stratagems)
  // so multi-option text doesn't read as one wall. The most common pain
  // points: bullet markers (• / ◆ / ◾) sitting inline mid-sentence, GW-
  // style stratagem sub-headers (WHEN: / TARGET: / EFFECT: / etc.) that
  // should clearly start their own line, and primarch / hero abilities
  // whose pickable sub-options are concatenated in one paragraph by
  // BSData ("Author of the Codex" → "Primarch of the XIII (Aura): …
  // Master of Battle: … Supreme Strategist: …"). Inserts \n where
  // needed and lets `white-space: pre-line / pre-wrap` in CSS render
  // the breaks.
  function formatStructuredText(text) {
    if (!text) return '';
    let out = String(text);
    // Bullet-style list markers → new line + bullet.
    out = out.replace(/\s*([•◆◾●])\s+/g, '\n$1 ');
    // GW stratagem sub-headers — only when at a word boundary so we
    // don't break sentences that happen to contain the word.
    out = out.replace(/\s*\b(WHEN|TARGET|EFFECT|RESTRICTIONS?|DURATION)\b\s*:\s*/g, '\n$1: ');
    // Sub-ability heading pattern used by primarch / hero abilities:
    //   "...prev sentence.  Foo Bar (Aura): ..." or
    //   "...abilities.'  Primarch of the XIII (Aura): ..."
    // Require a sentence-ending punctuation (optionally followed by a
    // closing quote / paren) and at least one space, then a Title Case
    // multi-word heading ending in a colon. Heading allows letters,
    // digits, hyphens, apostrophes, and parens (10e tags like "(Aura)"
    // / "(Lethal Hits)" need them).
    out = out.replace(
      /([.!?][”’'")\]]?)\s+([A-Z][A-Za-z0-9'’()\-: ]{2,80}?):\s+/g,
      '$1\n\n$2: '
    );
    // Some BSData strings end the parent sentence with just a closing
    // quote and no terminal punctuation ("...abilities.' Primarch…"
    // can also occur as "...abilities’ Primarch…" without the period).
    // Catch a quote-then-Title-Case-heading pattern as a softer fallback.
    out = out.replace(
      /([”’'])\s+([A-Z][A-Za-z0-9'’()\-: ]{2,80}?):\s+/g,
      '$1\n\n$2: '
    );
    // Collapse runs of 3+ newlines to a max of 2.
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
  }

  // Normalise an invulnerable-save string to the conventional "4++" form,
  // so SV cells read "2+ / 4++". BSData / GDC sometimes hand us "4", "4+",
  // or "4++" depending on faction; this folds them all into the same shape.
  function formatInvuln(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/\+\+$/.test(s)) return s;
    if (/\+$/.test(s))   return s + '+';
    return s + '++';
  }

  const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
  function getStatVal(stats, key) {
    const aliases = (UI && UI._STAT_ALIASES && UI._STAT_ALIASES[key]) || [key];
    for (let i = 0; i < aliases.length; i++) {
      const v = stats[aliases[i]];
      if (v != null && v !== '') return v;
    }
    return '—';
  }

  function classifyWeapons(unit) {
    const useGdc = Array.isArray(unit.gdcMeleeWeapons) || Array.isArray(unit.gdcRangedWeapons);
    if (useGdc) {
      return {
        ranged: gdcProfilesToRows(unit.gdcRangedWeapons || [], 'ranged'),
        melee:  gdcProfilesToRows(unit.gdcMeleeWeapons  || [], 'melee'),
      };
    }
    const ws = unit.weapons || [];
    const ranged = ws.filter(w => {
      const tn = (w._typeName || '').toLowerCase();
      return tn.includes('ranged') || (!tn.includes('melee') && w.Range !== 'Melee');
    });
    const melee = ws.filter(w => {
      const tn = (w._typeName || '').toLowerCase();
      return tn.includes('melee') || w.Range === 'Melee';
    });
    return { ranged, melee };
  }
  function gdcProfilesToRows(weapons, type) {
    const out = [];
    (weapons || []).forEach(w => {
      if (!w || w.active === false || !Array.isArray(w.profiles)) return;
      w.profiles.forEach(p => {
        if (!p || p.active === false) return;
        const row = {
          name: p.name || w.name || '',
          Range: p.range != null && p.range !== '' ? p.range : (type === 'melee' ? 'Melee' : '—'),
          A: p.attacks, S: p.strength, AP: p.ap, D: p.damage,
        };
        if (type === 'ranged') row.BS = p.skill; else row.WS = p.skill;
        if (Array.isArray(p.keywords) && p.keywords.length > 0) {
          row.Keywords = p.keywords.join(', ');
        }
        out.push(row);
      });
    });
    return out;
  }

  function renderWeaponsBlock(list, type) {
    if (!list || list.length === 0) return '';
    const COLS = type === 'ranged'
      ? ['Range', 'A', 'BS', 'S', 'AP', 'D']
      : ['Range', 'A', 'WS', 'S', 'AP', 'D'];
    const label = type === 'ranged' ? 'RANGED WEAPONS' : 'MELEE WEAPONS';
    const rows = list.map(w => {
      // Range is the widest stat (e.g. `Melee`, `24"`) and Damage the next
      // (`D6+2`); the rest are 1–2 chars. Tagging them lets the fixed-layout
      // table give each column a width that matches the header letters above
      // it — see `.dcc-num-range` / `.dcc-num-dmg` in cards-mode.css.
      const cells = COLS.map((c, i) => {
        const extra = c === 'Range' ? ' dcc-num-range'
                    : (i === COLS.length - 1) ? ' dcc-num-dmg'
                    : '';
        return `<td class="dcc-num${extra}">${esc(w[c] != null && w[c] !== '' ? w[c] : '—')}</td>`;
      }).join('');
      // Stencil renders each weapon keyword as a small accent pill (the
      // design's "Lethal Hits" chips); other templates keep the single italic
      // keyword line. Either way the keywords sit on their OWN line beneath the
      // weapon name (a block wrapper) rather than flowing inline after it —
      // inline pills looked off once they spilled onto a second row.
      const kw = (display.weaponKw && w.Keywords)
        ? (isStencil()
            ? `<div class="dcc-w-tags">${String(w.Keywords).split(/\s*,\s*/).filter(Boolean)
                .map(t => `<span class="dcc-w-tag">${esc(t)}</span>`).join('')}</div>`
            : `<div class="dcc-w-kw">${esc(w.Keywords)}</div>`)
        : '';
      // Keywords go in their own full-width row (colspan across name + every
      // stat column) beneath the weapon's stat line, so they can run the whole
      // card width instead of wrapping at the narrow name column. The stat row
      // drops its bottom border when a keyword row follows so the two read as
      // one weapon entry.
      const statRow = `<tr class="dcc-w-row${kw ? ' has-kw' : ''}">
        <td class="dcc-w-name">${esc(w.name)}</td>
        ${cells}
      </tr>`;
      const kwRow = kw
        ? `<tr class="dcc-w-kwrow"><td class="dcc-w-kwcell" colspan="${COLS.length + 1}">${kw}</td></tr>`
        : '';
      return statRow + kwRow;
    }).join('');
    return `
      <div class="dcc-section dcc-weapons dcc-weapons-${type}">
        <div class="dcc-section-head">
          <span class="dcc-section-label">${label}</span>
          <span class="dcc-section-cols">${COLS.map(c => `<span>${c === 'Range' ? 'R' : c}</span>`).join('')}</span>
        </div>
        <table class="dcc-w-table">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderWargearBlock(unit) {
    if (!display.wargear) return '';
    const lines = [];

    const gdcComp = Array.isArray(unit.gdcComposition) ? unit.gdcComposition : null;
    if (gdcComp && gdcComp.length > 0) {
      lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${esc(gdcComp.join(' · '))}</div>`);
    } else if (Array.isArray(unit.squadOptions)) {
      const models = [...new Set(unit.squadOptions.map(o => o.models).filter(m => m != null))].sort((a, b) => a - b);
      if (models.length === 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]} model${models[0] !== 1 ? 's' : ''}</div>`);
      else if (models.length > 1) lines.push(`<div class="dcc-wargear-line"><strong>Composition:</strong> ${models[0]}–${models[models.length - 1]} models</div>`);
    }
    if (typeof unit.gdcLoadout === 'string' && unit.gdcLoadout.trim()) {
      lines.push(`<div class="dcc-wargear-line dcc-wargear-default"><strong>Default:</strong> ${esc(unit.gdcLoadout)}</div>`);
    }

    const gdcWg = Array.isArray(unit.gdcWargear) ? unit.gdcWargear : null;
    if (gdcWg && gdcWg.length > 0) {
      gdcWg.forEach(line => {
        const parts = String(line).split(/\s*◦\s*/);
        const head = (parts[0] || '').replace(/:\s*$/, '').trim();
        const subs = parts.slice(1).map(s => s.trim()).filter(Boolean);
        let html = '<div class="dcc-wargear-line">';
        if (head) html += esc(head);
        if (subs.length > 0) html += `<ul class="dcc-wargear-sub">${subs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
        html += '</div>';
        lines.push(html);
      });
    } else {
      const opts = Array.isArray(unit.wargearOptions) ? unit.wargearOptions : [];
      const modelTypeOpts = opts.filter(o => o && o.type === 'model');
      const choiceOpts    = opts.filter(o => o && o.type !== 'model');
      modelTypeOpts.forEach(opt => {
        let count = '';
        if (opt.modelMin != null && opt.modelMax != null) {
          if (opt.modelMin === opt.modelMax)        count = `${opt.modelMin} model${opt.modelMin !== 1 ? 's' : ''}`;
          else if (opt.modelMin === 0)              count = `up to ${opt.modelMax} model${opt.modelMax !== 1 ? 's' : ''}`;
          else                                      count = `${opt.modelMin}–${opt.modelMax} models`;
        }
        let html = `<div class="dcc-wargear-line"><strong>${esc(opt.modelName || 'Model')}</strong>`;
        if (count) html += ` <span style="opacity:0.7">(${esc(count)})</span>`;
        if (opt.defaultWeapons && opt.defaultWeapons.length) {
          html += `<div class="dcc-wargear-line dcc-wargear-default" style="margin-left:1.6mm"><em>Default:</em> ${esc(opt.defaultWeapons.join(' · '))}</div>`;
        }
        (opt.subOptions || []).forEach(sub => {
          const ctx = sub.max === 1 ? ' — choose one' : sub.max > 1 ? ` — choose up to ${sub.max}` : '';
          html += `<div style="margin-left:1.6mm"><em>${esc(sub.name)}${ctx}</em>`;
          if (Array.isArray(sub.choices) && sub.choices.length) {
            html += `<ul class="dcc-wargear-sub">${sub.choices.map(c => `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`).join('')}</ul>`;
          }
          html += '</div>';
        });
        html += '</div>';
        lines.push(html);
      });
      choiceOpts.forEach(opt => {
        const name = typeof opt === 'object' ? (opt.name || '') : opt;
        const choices = typeof opt === 'object' && opt.choices ? opt.choices : [];
        const maxStr = (typeof opt === 'object' && opt.max != null) ? ` (max ${opt.max})` : '';
        let html = `<div class="dcc-wargear-line"><strong>${esc(name)}</strong>${maxStr ? `<span style="opacity:0.7"> ${esc(maxStr)}</span>` : ''}`;
        if (choices.length) html += `<ul class="dcc-wargear-sub">${choices.map(c => `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`).join('')}</ul>`;
        html += '</div>';
        lines.push(html);
      });
    }

    if (lines.length === 0) return '';
    return `<div class="dcc-section dcc-wargear">
      <div class="dcc-section-head"><span class="dcc-section-label">WARGEAR</span></div>
      <div class="dcc-wargear-body">${lines.join('')}</div>
    </div>`;
  }

  // 10e BSData encodes "choose-one-of-N" hero toggles by giving each
  // child profile a non-standard typeName matching (or related to) the
  // parent ability's name. Examples:
  //   Lion El'Jonson  → typeName="Primarch of the First Legion"
  //   Angron          → typeName="Wrathful Presence"
  //   Silent King     → typeName="Triarch Abilities"
  // The parent always has typeName="Abilities" and stays in the regular
  // ABILITIES section. Children get a dedicated section per typeName so
  // the player sees at a glance that they're pickable toggles.
  //
  // Returns the section label for an ability if it's a sub-ability,
  // null otherwise. "Primarch of <legion>" is normalised to "PRIMARCH"
  // (per user preference); other special typeNames are uppercased
  // verbatim.
  const STD_ABILITY_TYPENAMES = new Set([
    '', 'abilities', 'leader', 'invulnerable save', 'damaged',
  ]);
  function subAbilitySectionKey(a) {
    if (!a || !a._typeName) return null;
    const tn = String(a._typeName).trim();
    if (STD_ABILITY_TYPENAMES.has(tn.toLowerCase())) return null;
    // Match "Primarch" (the synthetic typeName from
    // splitMultiParagraphChooseFromN — Guilliman shape) AND
    // "Primarch of the First Legion" / "Primarch of the XIII" / etc.
    // (the natural typeNames from Lion / Magnus / Mortarion shape).
    if (/^primarch\b/i.test(tn)) return 'PRIMARCH';
    return tn.toUpperCase();
  }

  function renderAbilitiesBlock(unit) {
    if (!display.abilities) return '';
    const abil = (unit.abilities || []).filter(a => a && a.name);
    if (abil.length === 0) return '';
    const core = [], named = [];
    // Group sub-abilities by their section key — preserves first-seen
    // order so each unit's special section renders in its natural order.
    const subGroups = new Map();   // key (label) → [abilities]
    abil.forEach(a => {
      if (a.isCore) { core.push(a); return; }
      const key = subAbilitySectionKey(a);
      if (key) {
        if (!subGroups.has(key)) subGroups.set(key, []);
        subGroups.get(key).push(a);
      } else {
        named.push(a);
      }
    });
    const coreVisible = display.coreAbil && core.length > 0;
    if (!coreVisible && named.length === 0 && subGroups.size === 0) return '';

    // Stencil template: the design renders each ability as a block — a
    // category type-pill + name on one line, paragraph below — under a
    // single "Abilities" section head. Core abilities (names only in this
    // view) collapse into one "Core" pill block; sub-ability groups
    // (PRIMARCH, etc.) keep their label as the pill.
    if (isStencil()) {
      let body = '';
      if (coreVisible) {
        body += `<div class="dcc-ab-block"><div class="dcc-ab-head"><span class="dcc-type-pill">Core</span></div>`
              + `<div class="dcc-ab-text">${core.map(a => esc(a.name)).join(', ')}</div></div>`;
      }
      named.forEach(a => {
        body += `<div class="dcc-ab-block"><div class="dcc-ab-head"><span class="dcc-type-pill">Ability</span>`
              + `<span class="dcc-ab-name">${esc(a.name)}</span></div>`
              + `<div class="dcc-ab-text">${esc(formatStructuredText(a.description || ''))}</div></div>`;
      });
      subGroups.forEach((rows, label) => {
        rows.forEach(a => {
          body += `<div class="dcc-ab-block"><div class="dcc-ab-head"><span class="dcc-type-pill">${esc(label)}</span>`
                + `<span class="dcc-ab-name">${esc(a.name)}</span></div>`
                + `<div class="dcc-ab-text">${esc(formatStructuredText(a.description || ''))}</div></div>`;
        });
      });
      if (!body) return '';
      return `<div class="dcc-section dcc-abilities">
        <div class="dcc-section-head"><span class="dcc-section-label">Abilities</span></div>
        <div class="dcc-abilities-body">${body}</div>
      </div>`;
    }

    let html = '';

    // Regular ABILITIES section first — the "always on" rules players
    // reference most often. Parent toggles like "Wrathful Presence" /
    // "Voice of the Triarch" / "Primarch of the First Legion" live here
    // because they have typeName="Abilities" and explain the choose
    // mechanic for the special section below.
    if (coreVisible || named.length > 0) {
      html += `<div class="dcc-section dcc-abilities">
        <div class="dcc-section-head"><span class="dcc-section-label">ABILITIES</span></div>
        <div class="dcc-abilities-body">`;
      if (coreVisible) {
        html += `<div class="dcc-ability-row dcc-core-row"><strong>CORE:</strong> ${
          core.map(a => esc(a.name)).join(', ')
        }</div>`;
      }
      named.forEach(a => {
        html += `<div class="dcc-ability-row"><strong>${esc(a.name)}:</strong> ${esc(formatStructuredText(a.description || ''))}</div>`;
      });
      html += `</div></div>`;
    }

    // One special section per non-standard typeName: PRIMARCH for any
    // primarch toggle, "WRATHFUL PRESENCE" for Angron, "TRIARCH
    // ABILITIES" for Silent King, etc. Same gold-leaf section head
    // styling for all of them so they read as "pick from N" at a glance.
    subGroups.forEach((rows, label) => {
      html += `<div class="dcc-section dcc-abilities dcc-abilities-primarch">
        <div class="dcc-section-head dcc-section-head-primarch"><span class="dcc-section-label">${esc(label)}</span></div>
        <div class="dcc-abilities-body">`;
      rows.forEach(a => {
        html += `<div class="dcc-ability-row"><strong>${esc(a.name)}:</strong> ${esc(formatStructuredText(a.description || ''))}</div>`;
      });
      html += `</div></div>`;
    });

    return html;
  }

  // Dedicated TRANSPORT section: surfaces unit.transportCapacity in its
  // own card block instead of letting the prose mix with regular
  // abilities or — worse — fall through subAbilitySectionKey() into a
  // PRIMARCH-styled box (older Ork Trukk regression).
  function renderTransportBlock(unit) {
    if (!unit || !unit.transportCapacity) return '';
    if (display.abilities === false) return '';
    return `<div class="dcc-section dcc-abilities dcc-abilities-transport">
      <div class="dcc-section-head"><span class="dcc-section-label">TRANSPORT</span></div>
      <div class="dcc-abilities-body">
        <div class="dcc-ability-row">${esc(formatStructuredText(unit.transportCapacity))}</div>
      </div>
    </div>`;
  }

  function renderUnitCard(entry) {
    const unit = entry.unitData || {};
    // Multi-statline units (Beast Snagga Boyz = Boy + Nob, Marneus
    // Calgar + Victrix Honour Guard, Terminator Assault Squad TH/SS vs
    // LC) carry an array of distinct stat profiles in `modelStats`.
    // Render one stat row per profile, labelled with the model name
    // when there's more than one. Fall back to the legacy single
    // `stats` dict for older cached factions / genuinely single-line
    // units. The present-columns set is the UNION across every profile
    // so the rows stay column-aligned even when one model lacks a stat.
    const stats = unit.stats || {};
    const statProfiles = (Array.isArray(unit.modelStats) && unit.modelStats.length > 0)
      ? unit.modelStats
      : [{ name: '', ...stats }];
    const presentStats = STAT_ORDER.filter(k =>
      statProfiles.some(p => getStatVal(p, k) !== '—'));
    const { ranged, melee } = classifyWeapons(unit);
    const ptsOpts = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const ptsLabel = entry.selectedPts != null ? entry.selectedPts : (ptsOpts.length ? ptsOpts[0] : null);

    const showEnh = display.enhancements && Array.isArray(entry.enhancements) && entry.enhancements.length > 0;
    const enhancementHtml = showEnh
      ? `<div class="dcc-section dcc-enhancements">
          <div class="dcc-section-head"><span class="dcc-section-label">ENHANCEMENT</span></div>
          <div class="dcc-abilities-body">${
            entry.enhancements.map(e => `<div class="dcc-ability-row"><strong>${esc(e.name)}${e.pts ? ' (+' + e.pts + ')' : ''}:</strong> ${esc(e.description || '')}</div>`).join('')
          }</div>
        </div>`
      : '';

    const allKw = (unit.keywords || []).filter(Boolean);
    const factionKw = unit._factionName ? [unit._factionName] : [];
    const showFKw = display.factionKw && factionKw.length > 0;
    const showUKw = display.unitKw && allKw.length > 0;
    const fkwFooter = showFKw ? `<div class="dcc-keywords dcc-faction-kw"><strong>FACTION KEYWORDS:</strong> ${esc(factionKw.join(', '))}</div>` : '';
    const kwFooter = showUKw ? `<div class="dcc-keywords"><strong>KEYWORDS:</strong> ${esc(allKw.join(', '))}</div>` : '';
    const footerHtml = (showFKw || showUKw) ? `<footer class="dcc-foot">${fkwFooter}${kwFooter}</footer>` : '';

    const role = display.role ? `<span class="dcc-role">${esc(unit.type || '')}</span>` : '';
    const ptsHtml = (display.points && ptsLabel != null) ? `<span class="dcc-pts">${esc(String(ptsLabel))} pts</span>` : '';
    const showSubLine = !!role;
    const showInvuln = !!(display.invuln && unit.invulnSave);
    // Per-profile invuln: a BSData stat profile can carry its own
    // invulnerable-save characteristic. Prefer it so a multi-statline sheet
    // (e.g. the Silent King) shows the shield only on the line(s) that have
    // one; otherwise fall back to the unit-wide invuln on every line (as the
    // detail panel does).
    const profInvuln = prof => {
      const raw = prof && (prof['INV'] || prof['Invulnerable Save'] || prof['Inv'] || prof['Invuln']);
      const s = raw == null ? '' : String(raw).trim();
      return (s && s !== '-' && s !== '—') ? s : '';
    };
    const profInvs   = statProfiles.map(profInvuln);
    const anyProfInv = profInvs.some(Boolean);
    const hasInvuln  = !!unit.invulnSave || anyProfInv;
    // Stencil shows the invuln as a SEPARATE faction-accent shield badge at
    // the END OF EACH stat line; other templates fold the unit-wide invuln
    // into the SV cell as `2+ / 4++`.
    const shieldMode    = isStencil() && display.invuln && hasInvuln;
    const combineInvuln = showInvuln && !shieldMode;

    const multiStat = statProfiles.length > 1;
    function renderStatRow(prof) {
      return `<div class="dcc-stats" style="--dcc-stat-cols:${presentStats.length}">
          ${presentStats.map(k => {
            const v = String(getStatVal(prof, k));
            // Combine the invulnerable save into the SV cell as `2+ / 4++`
            // so it lives where players' eyes already go for saves.
            // Adds a `dcc-stat-val-combo` modifier that scales the value
            // font-size down so the longer string still fits the cell.
            if (k === 'SV' && combineInvuln && v !== '—') {
              return `
                <div class="dcc-stat-cell dcc-stat-cell-sv">
                  <span class="dcc-stat-key">${esc(k)}</span>
                  <span class="dcc-stat-val dcc-stat-val-combo">${esc(v)} / ${esc(formatInvuln(unit.invulnSave))}</span>
                </div>`;
            }
            return `
              <div class="dcc-stat-cell">
                <span class="dcc-stat-key">${esc(k)}</span>
                <span class="dcc-stat-val">${esc(v)}</span>
              </div>`;
          }).join('')}
        </div>`;
    }
    function fmtInv(v) { return esc(String(v).replace(/\++$/, '') + '+'); }
    function shieldFor(i) {
      // The invuln beside profile i: its own profile invuln when any profile
      // declares one, else the unit-wide invuln on every line. A spacer keeps
      // the stat columns aligned on rows that have no shield.
      const v = anyProfInv ? profInvs[i] : (unit.invulnSave || '');
      return v
        ? `<div class="dcc-invuln-shield"><span class="dcc-invuln-val">${fmtInv(v)}</span><span class="dcc-invuln-lbl">Inv</span></div>`
        : '<div class="dcc-invuln-spacer"></div>';
    }
    const statsHtml = (display.stats && presentStats.length > 0)
      ? statProfiles.map((prof, i) => {
          const label = (multiStat && prof.name)
            ? `<div class="dcc-stat-rowlabel">${esc(prof.name)}</div>`
            : '';
          const row = renderStatRow(prof);
          // Stencil: wrap each row with its OWN shield, flush at the end of
          // that line, so the badge never stretches across multiple profiles.
          return shieldMode
            ? label + `<div class="dcc-statline">${row}${shieldFor(i)}</div>`
            : label + row;
        }).join('')
      : '';

    // Stencil header carries a faction "kicker" (eyebrow) above the name.
    const factionShort = (function () {
      const f = unit._factionName || '';
      if (!f) return '';
      return f.includes(' - ') ? f.split(' - ').pop().trim() : f.trim();
    })();
    const kickerHtml = (isStencil() && factionShort)
      ? `<div class="dcc-kicker">${esc(factionShort)}</div>` : '';

    return `
      <header class="dcc-head">
        ${kickerHtml}
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(unit.name || entry.unitName || 'Unit')}</h1>
          ${ptsHtml}
        </div>
        ${showSubLine ? `<div class="dcc-sub-line">${role}</div>` : ''}
      </header>
      ${statsHtml}
      ${display.ranged ? renderWeaponsBlock(ranged, 'ranged') : ''}
      ${display.melee  ? renderWeaponsBlock(melee, 'melee')   : ''}
      ${renderAbilitiesBlock(unit)}
      ${renderTransportBlock(unit)}
      ${renderWargearBlock(unit)}
      ${enhancementHtml}
      ${footerHtml}`;
  }

  function renderRuleCard(item) {
    const r = item.rule || {};
    const kindLabel = item.kind === 'detachment' ? 'DETACHMENT RULE' : 'ARMY RULE';
    const subLine = display.kindLabel ? `<div class="dcc-sub-line"><span class="dcc-role">${kindLabel}</span></div>` : '';
    const kickerHtml = (isStencil() && currentFactionShort())
      ? `<div class="dcc-kicker">${esc(currentFactionShort())}</div>` : '';
    return `
      <header class="dcc-head dcc-head-rule">
        ${kickerHtml}
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(r.name || item.label)}</h1>
        </div>
        ${subLine}
      </header>
      <div class="dcc-section dcc-rule-body">
        <div class="dcc-rule-text">${esc(formatStructuredText(r.description || ''))}</div>
      </div>`;
  }

  function renderStratagemCard(item) {
    const s = item.strat || {};
    const cp = s.cp != null ? s.cp : '?';
    // Detachment stratagems show the actual detachment name (e.g. "Teleport
    // Strike Force") in place of the generic "DETACHMENT" qualifier — matching
    // the GW card, where the detachment banner identifies the stratagem set.
    const typeLabel = item.type === 'core' ? 'CORE'
      : item.type === 'detachment' ? (item.detName || 'DETACHMENT')
      : 'FACTION';
    const cpHtml = display.cp ? `<span class="dcc-cp"><span class="dcc-cp-num">${esc(String(cp))}</span><span class="dcc-cp-lbl">CP</span></span>` : '';
    const typeHtml = display.type ? `<span class="dcc-role">${esc(typeLabel)} STRATAGEM</span>` : '';
    const phaseHtml = (display.phase && s.phase) ? `<span class="dcc-strat-phase">PHASE: ${esc(String(s.phase).toUpperCase())}</span>` : '';
    const subLine = (typeHtml || phaseHtml) ? `<div class="dcc-sub-line">${typeHtml}${phaseHtml}</div>` : '';
    const kickerHtml = (isStencil() && currentFactionShort())
      ? `<div class="dcc-kicker">${esc(currentFactionShort())}</div>` : '';
    return `
      <header class="dcc-head dcc-head-strat">
        ${kickerHtml}
        <div class="dcc-name-line">
          <h1 class="dcc-name">${esc(s.name)}</h1>
          ${cpHtml}
        </div>
        ${subLine}
      </header>
      <div class="dcc-section dcc-strat-body">
        <div class="dcc-rule-text">${esc(formatStructuredText(s.description || ''))}</div>
      </div>`;
  }

  // ── Card list assembly ──────────────────────────────────────────────────
  function selectedCards() {
    const out = [];
    gatherUnits().forEach(u => {
      if (include.units && include.units.has(u.id)) out.push({ kind: 'unit', html: renderUnitCard(u.entry), label: u.label });
    });
    gatherRules().forEach(r => {
      if (include.rules && include.rules.has(r.id)) out.push({ kind: 'rule', html: renderRuleCard(r), label: r.label });
    });
    gatherStratagems().forEach(s => {
      if (include.strats && include.strats.has(s.id)) out.push({ kind: 'strat', html: renderStratagemCard(s), label: s.label });
    });
    return out;
  }

  // ── Page DOM building ───────────────────────────────────────────────────
  // Each `.dcc-page` is the full physical sheet at 1:1 (mm units in inline
  // styles). Cards are laid out by CSS grid inside. Pages are wrapped in
  // a `.dcc-page-frame` for the on-screen preview, which scales them
  // visually via CSS `transform: scale()`. The print path (browser-native
  // window.print) doesn't need the wrapper — print CSS in cards-mode.css
  // unwraps it via `transform: none`.
  function buildPageElement(layout, cards, pageNum) {
    const cardsPerPage = layout.cols * layout.rows;
    const frame = document.createElement('div');
    frame.className = 'dcc-page-frame';
    frame.style.setProperty('--dcc-page-w', layout.w + 'mm');
    frame.style.setProperty('--dcc-page-h', layout.h + 'mm');

    const pageEl = document.createElement('div');
    pageEl.className = 'dcc-page';
    pageEl.style.width  = layout.w + 'mm';
    pageEl.style.height = layout.h + 'mm';
    pageEl.style.padding = pageMargin() + 'mm';
    pageEl.style.gridTemplateColumns = 'repeat(' + layout.cols + ', 1fr)';
    pageEl.style.gridTemplateRows    = 'repeat(' + layout.rows + ', 1fr)';
    pageEl.style.gap = cardGutter() + 'mm';
    // Sheet background fills any space outside the cards — reads as a
    // "card border" once printed borderless.
    pageEl.style.backgroundColor = borderColor;
    pageEl.style.setProperty('--dcc-accent', currentAccent());
    pageEl.dataset.page = String(pageNum);
    pageEl.dataset.layout = layout.id;

    cards.forEach(card => {
      const cardEl = document.createElement('article');
      // Continuation cards may carry a contClasses string (.dcc-card-cont
      // for the partial-parchment overlay). When contClasses is the
      // empty string (spilloverMode='fullCard') the continuation is a
      // regular full-parchment card — no special class.
      let cls = 'dcc-card dcc-card-' + card.kind + ' ' + templateClass();
      if (card.isContinuation && card.contClasses) cls += ' ' + card.contClasses;
      cardEl.className = cls;
      cardEl.innerHTML = card.html;
      pageEl.appendChild(cardEl);
    });
    // Pad with empty grid placeholders so the last page keeps its layout.
    for (let k = cards.length; k < cardsPerPage; k++) {
      const ph = document.createElement('div');
      ph.className = 'dcc-card dcc-card-empty ' + templateClass();
      pageEl.appendChild(ph);
    }
    frame.appendChild(pageEl);
    return frame;
  }

  // Build a back page that mirrors the cell grid of the front it follows.
  // `frontCards` is the slice of cards on the corresponding front page
  // (one per cell, possibly fewer than cardsPerPage — the rest become
  // empty padders so the grid alignment matches when the sheet is
  // flipped through the printer).
  //
  // For each filled slot we pick one of three renderings, in priority order:
  //   1. The primary's `continuationHtml` (spillover, 'continuation' mode)
  //      — the overflow rides on the back of its own primary, so when
  //      the user prints odds, flips the stack, and prints evens, each
  //      card has its own continuation on its reverse side.
  //   2. The user's decorative card-back image (`cardBack.src`, duplex on).
  //   3. An empty placeholder when neither applies.
  function buildBackPage(layout, frontCards, pageNum) {
    const cardsPerPage = layout.cols * layout.rows;
    const frame = document.createElement('div');
    frame.className = 'dcc-page-frame';
    frame.style.setProperty('--dcc-page-w', layout.w + 'mm');
    frame.style.setProperty('--dcc-page-h', layout.h + 'mm');

    const pageEl = document.createElement('div');
    pageEl.className = 'dcc-page dcc-page-back';
    pageEl.style.width  = layout.w + 'mm';
    pageEl.style.height = layout.h + 'mm';
    pageEl.style.padding = pageMargin() + 'mm';
    pageEl.style.gridTemplateColumns = 'repeat(' + layout.cols + ', 1fr)';
    pageEl.style.gridTemplateRows    = 'repeat(' + layout.rows + ', 1fr)';
    pageEl.style.gap = cardGutter() + 'mm';
    pageEl.style.backgroundColor = borderColor;
    pageEl.style.setProperty('--dcc-accent', currentAccent());
    pageEl.dataset.page = String(pageNum);
    pageEl.dataset.layout = layout.id;
    pageEl.dataset.face = 'back';

    const imgVars = ''
      + '--dcc-back-scale:' + cardBack.scale + ';'
      + '--dcc-back-x:' + cardBack.offsetX + '%;'
      + '--dcc-back-y:' + cardBack.offsetY + '%;';

    for (let i = 0; i < cardsPerPage; i++) {
      const cell = document.createElement('article');
      const fc = frontCards[i];
      if (fc && fc.continuationHtml) {
        let cls = 'dcc-card dcc-card-' + fc.kind + ' ' + templateClass();
        if (fc.continuationClasses) cls += ' ' + fc.continuationClasses;
        cell.className = cls;
        cell.innerHTML = fc.continuationHtml;
      } else if (fc && cardBack.src) {
        cell.className = 'dcc-card dcc-card-back ' + templateClass();
        cell.innerHTML = '<img class="dcc-back-img" alt="card back" src="'
          + cardBack.src.replace(/"/g, '&quot;') + '" style="' + imgVars + '">';
      } else {
        cell.className = 'dcc-card dcc-card-empty ' + templateClass();
      }
      pageEl.appendChild(cell);
    }
    frame.appendChild(pageEl);
    return frame;
  }

  // Build pages for the active selection, paginating each card kind by
  // its own (possibly overridden) layout. Pages emit in unit → rule →
  // strat order, with a back page interleaved after each front when card
  // backs are enabled (1F, 1B, 2F, 2B, …). User prints odd pages, flips
  // the stack in the printer, prints even pages.
  // ── Card spillover ──────────────────────────────────────────────────────
  // Some unit cards (primarchs, dense vehicles) carry more text than fits.
  // Rather than clipping, we measure each unit card off-screen at its
  // exact target size and — if it overflows — split section-on-boundary
  // into a primary card (header + fitting sections) and a continuation
  // card (continuation header + overflowing sections + footer keywords).
  // The split is conservative: max 2 cards per unit, header always comes
  // first on each card so the unit is identifiable. The continuation
  // card uses .dcc-card-cont, which lets the user-uploaded card-back
  // image (if set) bleed through beneath a height-auto parchment overlay
  // — the friend's "art continues underneath" idea.
  function cardSizeFor(layout) {
    return {
      w: (layout.w - 2 * pageMargin() - (layout.cols - 1) * cardGutter()) / layout.cols,
      h: (layout.h - 2 * pageMargin() - (layout.rows - 1) * cardGutter()) / layout.rows,
    };
  }
  function splitOverflowingUnitCards(unitCards, layout) {
    if (unitCards.length === 0) return unitCards;
    const { w: cardW, h: cardH } = cardSizeFor(layout);
    const stage = document.createElement('div');
    stage.style.cssText =
      'position:fixed;top:-99999px;left:0;width:auto;height:auto;visibility:hidden;z-index:-9999;pointer-events:none;';
    stage.className = 'dcc-measure-stage';
    document.body.appendChild(stage);
    try {
      const out = [];
      const backsOn = !!(cardBack.enabled && cardBack.src);
      for (const card of unitCards) {
        const split = measureAndMaybeSplit(card, cardW, cardH, stage, backsOn);
        split.forEach(c => out.push(c));
      }
      return out;
    } finally {
      document.body.removeChild(stage);
    }
  }
  function measureAndMaybeSplit(card, cardW, cardH, stage, backsOn) {
    const host = document.createElement('div');
    host.style.cssText = 'width:' + cardW + 'mm; height:' + cardH + 'mm;';
    const cardEl = document.createElement('article');
    cardEl.className = 'dcc-card dcc-card-unit ' + templateClass();
    cardEl.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
    cardEl.innerHTML = card.html;
    host.appendChild(cardEl);
    stage.appendChild(host);
    try {
      // Sub-pixel slack: browsers can round mm-derived heights by ±1px.
      if (cardEl.scrollHeight <= cardEl.clientHeight + 2) return [card];

      const children = Array.from(cardEl.children);
      if (children.length < 2) return [card]; // can't split

      const header = children[0];
      const isHeaderEl = header && header.classList && header.classList.contains('dcc-head');
      if (!isHeaderEl) return [card];

      const last = children[children.length - 1];
      const footer = (last && last.classList && last.classList.contains('dcc-foot')) ? last : null;
      const middle = children.slice(1, footer ? -1 : undefined);
      if (middle.length === 0) return [card];

      const cardClient = cardEl.clientHeight;
      const headerH = header.offsetHeight;
      const footerH = footer ? footer.offsetHeight : 0;
      // Padding + per-section margins/gap eat ~6mm at default; budget
      // generously so the visible card never quite fills to its edge.
      const reserveMm = 8;
      const reservePx = mmToPx(reserveMm);
      const usable = cardClient - headerH - footerH - reservePx;

      // Walk sections in order, fitting whole sections until one
      // overflows. When `allowPartialSection` is on we additionally try
      // to break the overflowing section's children between primary and
      // continuation, so dense sections (long ability lists, deep weapon
      // tables) don't pop entirely to the back.
      let running = 0;
      const fits = [];
      let partialFitHtml = null;
      const overflowParts = [];
      for (let i = 0; i < middle.length; i++) {
        const c = middle[i];
        const h = c.offsetHeight + 4;  // ~1mm gap between sections
        if (running + h <= usable) {
          fits.push(c); running += h;
          continue;
        }
        if (allowPartialSection) {
          const partial = splitSectionPartial(c, usable - running);
          if (partial) {
            partialFitHtml = partial.fitHtml;
            overflowParts.push(partial.overflowHtml);
            for (let j = i + 1; j < middle.length; j++) overflowParts.push(middle[j].outerHTML);
            break;
          }
        }
        for (let j = i; j < middle.length; j++) overflowParts.push(middle[j].outerHTML);
        break;
      }

      // If even one middle section won't fit alongside the header, give
      // up and let the card clip — the alternative is an empty primary
      // card with all content on the continuation, which looks broken.
      if (fits.length === 0 && !partialFitHtml) return [card];
      if (overflowParts.length === 0) return [card];

      // Build primary card: header + fits + footer. The footer
      // (FACTION KEYWORDS / KEYWORDS lines) is pinned to the first
      // card always — it identifies the unit and shouldn't get
      // shuffled to a continuation that the user might cut apart from
      // its primary.
      const fitsHTML = fits.map(n => n.outerHTML).join('') + (partialFitHtml || '');
      const firstHTML = header.outerHTML + fitsHTML + (footer ? footer.outerHTML : '');
      const clonedHead = header.outerHTML.replace('class="dcc-head"', 'class="dcc-head dcc-head-cont"');
      const overflowHTML = overflowParts.join('');
      const { contHtml, contClasses } = buildContinuationChrome(clonedHead + overflowHTML, backsOn);

      return emitSplit(card, firstHTML, contHtml, contClasses, 'Unit');
    } finally {
      stage.removeChild(host);
    }
  }
  function mmToPx(mm) {
    // 1in = 25.4mm; browsers default to 96dpi for mm conversion.
    return mm * 96 / 25.4;
  }

  // Wrap (cloned-head + content) HTML with the spillover chrome the
  // user picked: parchment overlay + optional back-art image, or — in
  // 'fullCard' mode — nothing at all (the continuation is rendered as
  // a plain full-parchment card).
  function buildContinuationChrome(innerHtml, backsOn) {
    if (spilloverMode === 'fullCard') {
      return { contHtml: innerHtml, contClasses: '' };
    }
    const contClasses = backsOn ? 'dcc-card-cont dcc-card-cont-art' : 'dcc-card-cont';
    const backImg = backsOn
      ? '<img class="dcc-cont-bg" alt="" src="' + (cardBack.src || '').replace(/"/g, '&quot;') + '"' +
        ' style="--dcc-back-scale:' + cardBack.scale +
        ';--dcc-back-x:' + cardBack.offsetX + '%' +
        ';--dcc-back-y:' + cardBack.offsetY + '%;">'
      : '';
    return {
      contHtml: backImg + '<div class="dcc-cont-overlay">' + innerHtml + '</div>',
      contClasses,
    };
  }

  // Common return-shape helper used by every splitter. In 'continuation'
  // mode the overflow rides on the BACK of its primary's slot (duplex
  // print works automatically — print fronts, flip stack, print backs).
  // In 'fullCard' mode it takes a fresh front-grid slot of its own.
  function emitSplit(card, primaryHtml, contHtml, contClasses, kindLabel) {
    const primary = Object.assign({}, card, { html: primaryHtml });
    if (spilloverMode === 'continuation') {
      primary.continuationHtml = contHtml;
      primary.continuationClasses = contClasses;
      return [primary];
    }
    const cont = Object.assign({}, card, {
      html: contHtml,
      isContinuation: true,
      contClasses,
      label: (card.label || kindLabel || 'Card') + ' (cont.)',
    });
    return [primary, cont];
  }

  // Partial-section splitter for unit cards. Used only when the user
  // enables `allowPartialSection`. Given a section element that doesn't
  // fit in `availPx`, splits its body children between a primary clone
  // (kept) and a continuation clone (overflow). Returns null when the
  // section can't be split usefully (single child, head-only, etc.).
  function splitSectionPartial(sectionEl, availPx) {
    const head = sectionEl.querySelector(':scope > .dcc-section-head');
    const candidates = Array.from(sectionEl.children).filter(c => c !== head);
    if (candidates.length === 0) return null;
    // Walk into single-child wrappers (e.g. <table> → <tbody>) until we
    // reach a multi-child node to split.
    let splitParent = candidates[0];
    while (splitParent && splitParent.children && splitParent.children.length === 1) {
      splitParent = splitParent.children[0];
    }
    if (!splitParent || !splitParent.children || splitParent.children.length < 2) return null;

    const items = Array.from(splitParent.children);
    const headH = head ? head.offsetHeight : 0;
    let running = headH + 4;  // section head + body padding budget
    const fitItems = [], overflowItems = [];
    for (const it of items) {
      const h = it.offsetHeight + 2;
      if (overflowItems.length === 0 && running + h <= availPx) {
        fitItems.push(it); running += h;
      } else {
        overflowItems.push(it);
      }
    }
    if (fitItems.length === 0 || overflowItems.length === 0) return null;

    // Resolve the same splitParent inside a deep clone by replaying the
    // child-index path from the section root.
    const path = [];
    for (let n = splitParent; n !== sectionEl; n = n.parentNode) {
      path.unshift(Array.from(n.parentNode.children).indexOf(n));
    }
    function buildClone(itemsArr) {
      const clone = sectionEl.cloneNode(true);
      let target = clone;
      for (const idx of path) target = target.children[idx];
      while (target.firstChild) target.removeChild(target.firstChild);
      itemsArr.forEach(it => target.appendChild(it.cloneNode(true)));
      return clone.outerHTML;
    }
    return {
      fitHtml: buildClone(fitItems),
      overflowHtml: buildClone(overflowItems),
    };
  }

  // Rule-card spillover. Rule cards have a single body section (the
  // `<div class="dcc-rule-text">` blob), so they can only overflow
  // when partial-section splitting is enabled. With the flag off we
  // leave the card untouched and let it clip — matching the default
  // behaviour for everything else.
  function splitOverflowingRuleCards(ruleCards, layout) {
    if (!allowPartialSection || ruleCards.length === 0) return ruleCards;
    const { w: cardW, h: cardH } = cardSizeFor(layout);
    const stage = document.createElement('div');
    stage.style.cssText =
      'position:fixed;top:-99999px;left:0;width:auto;height:auto;visibility:hidden;z-index:-9999;pointer-events:none;';
    stage.className = 'dcc-measure-stage';
    document.body.appendChild(stage);
    try {
      const out = [];
      const backsOn = !!(cardBack.enabled && cardBack.src);
      for (const card of ruleCards) {
        measureAndMaybeSplitRule(card, cardW, cardH, stage, backsOn).forEach(c => out.push(c));
      }
      return out;
    } finally {
      document.body.removeChild(stage);
    }
  }
  function measureAndMaybeSplitRule(card, cardW, cardH, stage, backsOn) {
    const host = document.createElement('div');
    host.style.cssText = 'width:' + cardW + 'mm; height:' + cardH + 'mm;';
    const cardEl = document.createElement('article');
    cardEl.className = 'dcc-card dcc-card-rule ' + templateClass();
    cardEl.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
    cardEl.innerHTML = card.html;
    host.appendChild(cardEl);
    stage.appendChild(host);
    try {
      if (cardEl.scrollHeight <= cardEl.clientHeight + 2) return [card];

      const header = cardEl.querySelector('.dcc-head');
      const textEl = cardEl.querySelector('.dcc-rule-text');
      if (!header || !textEl) return [card];
      const fullText = textEl.textContent || '';
      if (!fullText.trim()) return [card];

      // Tokenise so we can rebuild any prefix without losing whitespace:
      // double-newline → paragraph, single-newline → soft break, words +
      // their trailing whitespace otherwise. Binary search finds the
      // largest prefix whose rendered card still fits.
      const tokens = [];
      const paraParts = fullText.split(/(\n\n+)/);
      for (const seg of paraParts) {
        if (/^\n{2,}$/.test(seg)) { tokens.push(seg); continue; }
        const lineParts = seg.split(/(\n)/);
        for (const lp of lineParts) {
          if (lp === '\n') { tokens.push(lp); continue; }
          if (!lp) continue;
          const wordParts = lp.split(/(\s+)/);
          for (const wp of wordParts) if (wp) tokens.push(wp);
        }
      }
      if (tokens.length < 2) return [card];

      let lo = 1, hi = tokens.length, bestFit = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        textEl.textContent = tokens.slice(0, mid).join('').replace(/\s+$/, '');
        if (cardEl.scrollHeight <= cardEl.clientHeight + 2) {
          bestFit = mid; lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (bestFit === 0 || bestFit >= tokens.length) return [card];

      const fitText      = tokens.slice(0, bestFit).join('').replace(/\s+$/, '');
      const overflowText = tokens.slice(bestFit).join('').replace(/^\s+/, '');
      if (!overflowText) return [card];

      // Re-inject the split text by swapping the dcc-rule-text contents
      // in the original card HTML — keeps every other class / attribute
      // intact (display.kindLabel subtitle, custom radii, etc.).
      function withRuleText(html, newText) {
        return html.replace(
          /(<div class="dcc-rule-text">)[\s\S]*?(<\/div>)/,
          '$1' + esc(newText) + '$2'
        );
      }
      const primaryHtml = withRuleText(card.html, fitText);
      const overflowOnlyHtml = withRuleText(card.html, overflowText);

      // Continuation: rebuild from the overflow-only HTML, marking the
      // cloned head as a continuation so the "(cont.)" pseudo-element
      // shows up. Strip the footerless rule card's outer header wrapper
      // and reuse it directly.
      const clonedHead = '<header class="dcc-head dcc-head-rule dcc-head-cont">' +
        (header.innerHTML || '') + '</header>';
      // The continuation body keeps the same .dcc-rule-body wrapper from
      // overflowOnlyHtml — we just splice in the cloned head.
      const overflowBodyHtml = overflowOnlyHtml.replace(/^[\s\S]*?<\/header>/, '');
      const inner = clonedHead + overflowBodyHtml;
      const { contHtml, contClasses } = buildContinuationChrome(inner, backsOn);

      return emitSplit(card, primaryHtml, contHtml, contClasses, 'Rule');
    } finally {
      stage.removeChild(host);
    }
  }

  function buildPagesDOM() {
    const all = selectedCards();

    // Pre-pass: split any unit card whose content overflows the cell at
    // its target physical size. Rule and stratagem cards aren't split —
    // they're typically short and benefit from staying contiguous.
    const unitsRaw  = all.filter(c => c.kind === 'unit');
    const rulesRaw  = all.filter(c => c.kind === 'rule');
    const strats    = all.filter(c => c.kind === 'strat');
    const unitsLayout = getLayoutFor('unit');
    const rulesLayout = getLayoutFor('rule');
    const units = splitOverflowingUnitCards(unitsRaw, unitsLayout);
    const rules = splitOverflowingRuleCards(rulesRaw, rulesLayout);

    const groups = [
      { kind: 'unit',  cards: units,  layout: unitsLayout            },
      { kind: 'rule',  cards: rules,  layout: rulesLayout            },
      { kind: 'strat', cards: strats, layout: getLayoutFor('strat')  },
    ];

    const frag = document.createDocumentFragment();
    let pageCount = 0;
    let pageNum = 0;
    const backsOn = !!(cardBack.enabled && cardBack.src);
    groups.forEach(g => {
      if (g.cards.length === 0) return;
      const cpp = g.layout.cols * g.layout.rows;
      for (let i = 0; i < g.cards.length; i += cpp) {
        const slice = g.cards.slice(i, i + cpp);
        pageNum++;
        frag.appendChild(buildPageElement(g.layout, slice, pageNum));
        pageCount++;
        // Emit a back page when either decorative backs are turned on
        // OR any card on this slice carries a spillover continuation
        // (which renders on the back of its primary's slot — see
        // measureAndMaybeSplit). Without the continuation check the
        // overflow would silently drop when card backs are disabled.
        const sliceHasCont = slice.some(c => c && c.continuationHtml);
        if (backsOn || sliceHasCont) {
          pageNum++;
          frag.appendChild(buildBackPage(g.layout, slice, pageNum));
          pageCount++;
        }
      }
    });
    // Recompute total card count — splits inflate it.
    const cardCount = units.length + rules.length + strats.length;
    return { frag, pageCount, cardCount };
  }

  // ── Mode UI shell ────────────────────────────────────────────────────────
  function renderHost() {
    if (!hostEl) return;
    syncIncludeDefaults();
    hostEl.classList.add('cards-mode-host');
    // Replace placeholder content on first render only; afterwards the
    // sub-renderers handle in-place updates.
    if (!hostEl.querySelector('.cards-shell')) {
      hostEl.innerHTML = `
        <div class="cards-shell">
          <aside class="cards-side" aria-label="Card settings">
            <header class="cards-side-head">
              <h2 class="cards-title">Cards</h2>
              <p class="cards-summary" id="cards-summary"></p>
            </header>

            <nav class="cards-subtabs" role="tablist" aria-label="Settings section">
              <button type="button" class="cards-subtab" data-subtab="cards"   role="tab">Pick cards</button>
              <button type="button" class="cards-subtab" data-subtab="layout"  role="tab">Layout</button>
              <button type="button" class="cards-subtab" data-subtab="display" role="tab">Display</button>
            </nav>

            <div class="cards-side-body" id="cards-side-body"></div>

            <footer class="cards-side-foot">
              <button type="button" class="cards-btn cards-btn-primary" id="cards-print-btn"
                      title="Open the browser print dialog. Choose 'Save as PDF' as the destination to save instead of printing.">
                Print / Save as PDF
              </button>
            </footer>
          </aside>

          <main class="cards-preview-wrap" aria-label="Card preview">
            <div class="cards-preview" id="cards-preview"></div>
          </main>
        </div>`;

      hostEl.querySelector('.cards-subtabs').addEventListener('click', e => {
        const btn = e.target.closest('.cards-subtab');
        if (!btn) return;
        activeSubTab = btn.dataset.subtab || 'cards';
        refreshSidebar();
      });
      // Trail every sidebar interaction with a savePrefs() so the user's
      // changes propagate to localStorage (and from there to the server
      // via sync.js's bag mechanism). The sync layer coalesces no-op
      // enqueues, so it's safe to fire on every event.
      const withSave = fn => function (e) { try { fn(e); } finally { savePrefs(); } };
      hostEl.querySelector('#cards-side-body').addEventListener('change', withSave(onSidebarChange));
      hostEl.querySelector('#cards-side-body').addEventListener('click',  withSave(onSidebarClick));
      hostEl.querySelector('#cards-print-btn').addEventListener('click', onPrint);
    }
    applyTextureStyle();
    refreshSidebar();
    refreshPreview();
    refreshSummary();
    mounted = true;
  }

  function refreshSidebar() {
    if (!hostEl) return;
    // Active subtab style.
    hostEl.querySelectorAll('.cards-subtab').forEach(btn => {
      const on = btn.dataset.subtab === activeSubTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    const body = hostEl.querySelector('#cards-side-body');
    if (!body) return;
    body.innerHTML = activeSubTab === 'display' ? renderDisplayPanel()
                  : activeSubTab === 'layout'  ? renderLayoutPanel()
                  :                              renderPickPanel();
  }

  function renderLayoutPanel() {
    const opts = LAYOUTS.map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('');
    const optsWithGlobal = `<option value="">Use global default</option>` + opts;
    const overrideRow = (kind, label) => `
      <label class="cards-field">
        <span class="cards-field-label">${esc(label)}</span>
        <select class="cards-select" data-layout-override="${kind}">
          ${optsWithGlobal}
        </select>
      </label>`;
    const html = `
      <div class="cards-layout-section">
        <div class="cards-disp-heading">Card template</div>
        <p class="cards-help">
          The overall visual style of every card — frame, header plate,
          section bars, palette, and ink. <strong>Gilded Parchment</strong>
          is the classic light GW-datasheet look (most printer-friendly).
          <strong>Grimdark Iron</strong> is a dark, gothic-industrial skin.
          Switching templates re-skins the whole card; your layout,
          typography, and display toggles carry over.
        </p>
        <div class="cards-templates" role="listbox" aria-label="Card templates">
          ${TEMPLATES.map(t => {
            const isActive = t.id === templateId;
            const styleAttr = ('background:' + t.swatch).replace(/"/g, '&quot;');
            return `<button type="button"
                          class="cards-template${isActive ? ' is-active' : ''}"
                          data-template-id="${esc(t.id)}"
                          title="${esc(t.label)}"
                          aria-label="${esc(t.label)}"
                          aria-selected="${isActive}"
                          style="${styleAttr}">
                    <span class="cards-template-label">${esc(t.label)}</span>
                  </button>`;
          }).join('')}
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Presets</div>
        <p class="cards-help">
          Save the current colours, typography, layout, and back-image
          selection as a named preset. Useful when you print a second
          batch for the same customer months later — pick the preset
          to snap every setting back. Presets sync across your devices
          when you're signed in.
        </p>
        <label class="cards-field">
          <span class="cards-field-label">Active preset</span>
          <select class="cards-select" id="cards-preset-select">
            <option value="">— None —</option>
            ${presets.map(p =>
              `<option value="${esc(p.id)}"${p.id === activePresetId ? ' selected' : ''}>${esc(p.name)}</option>`
            ).join('')}
          </select>
        </label>
        <div class="cards-field" style="padding:6px 12px 0; display:flex; flex-wrap:wrap; gap:6px;">
          <button type="button" class="cards-link-btn" id="cards-preset-new">Save current as new…</button>
          <button type="button" class="cards-link-btn" id="cards-preset-update"
                  ${activePresetId ? '' : 'disabled'}>Update “${esc(getActivePresetName() || '…')}”</button>
          <button type="button" class="cards-link-btn" id="cards-preset-rename"
                  ${activePresetId ? '' : 'disabled'}>Rename…</button>
          <button type="button" class="cards-link-btn" id="cards-preset-delete"
                  ${activePresetId ? '' : 'disabled'} style="color:#d97a7a;">Delete</button>
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Default sheet</div>
        <p class="cards-help">Used for any category that doesn't set its own override below.</p>
        <label class="cards-field">
          <span class="cards-field-label">Layout</span>
          <select class="cards-select" id="cards-layout-global">
            ${opts}
          </select>
        </label>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Per-category override</div>
        <p class="cards-help">
          Pick a different layout for each card kind. Useful for printing
          rules and stratagems 2-up while keeping unit cards 1-up. Cards
          of each kind are paginated independently and printed in order
          (units → rules → stratagems).
        </p>
        ${overrideRow('unit',  'Units')}
        ${overrideRow('rule',  'Army rules')}
        ${overrideRow('strat', 'Stratagems')}
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Card texture</div>
        <p class="cards-help">
          Background texture inside each card. Affects fronts and back-card
          padding. Pick a faction theme; the intensity slider scales the
          grain alpha.
        </p>
        <div class="cards-textures" role="listbox" aria-label="Card textures">
          ${TEXTURES.map(t => {
            const grainUrl = buildGrainUrl(t.grain, 100);
            const bg = grainUrl ? grainUrl + ', ' + t.base : t.base;
            const blend = grainUrl ? 'multiply, normal, normal' : 'normal';
            const isActive = t.id === textureId;
            // The grain URL contains literal `"` around the data URI
            // (CSS `url("data:…")`), and we're injecting it into an
            // HTML `style="…"` attribute. Without escaping the inner
            // quotes the parser closes the style attribute on the first
            // `"` inside the URL and renders only the prefix —
            // 15 of 16 swatches showed no texture, just a faint stripe.
            // HTML-escape the value so the browser decodes &quot; back
            // to `"` when it parses the attribute.
            const styleAttr = ('background:' + bg + ';background-blend-mode:' + blend).replace(/"/g, '&quot;');
            return `<button type="button"
                          class="cards-texture${isActive ? ' is-active' : ''}"
                          data-texture-id="${esc(t.id)}"
                          title="${esc(t.label)}"
                          aria-label="${esc(t.label)}"
                          aria-selected="${isActive}"
                          style="${styleAttr}">
                    <span class="cards-texture-label">${esc(t.label)}</span>
                  </button>`;
          }).join('')}
        </div>
        <div class="cards-field" style="padding:10px 12px 0">
          <span class="cards-field-label">Intensity <span class="cards-slider-val" id="cards-tex-intensity-val">${textureIntensity}%</span></span>
          <input type="range" min="0" max="100" step="5" value="${textureIntensity}"
                 id="cards-tex-intensity" class="cards-range">
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Card border</div>
        <p class="cards-help">
          Colour of the sheet around each card. On a borderless printer
          this prints right to the edge and reads as a trading-card
          frame around the parchment.
        </p>
        <div class="cards-field" style="padding:4px 12px 0">
          <span class="cards-field-label">Custom colour</span>
          <input type="color" id="cards-border-color" class="cards-color"
                 value="${esc(borderColor)}">
        </div>
        <div class="cards-swatches" id="cards-border-swatches" role="listbox" aria-label="Border presets">
          ${BORDER_PRESETS.map(p => `
            <button type="button"
                    class="cards-swatch${p.hex.toLowerCase() === borderColor.toLowerCase() ? ' is-active' : ''}"
                    data-border-preset="${esc(p.hex)}"
                    title="${esc(p.label)}"
                    style="background:${esc(p.hex)}"
                    aria-label="${esc(p.label)}"></button>`).join('')}
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Corner rounding</div>
        <p class="cards-help">
          Card frame defaults to 4mm to match an R4 physical corner
          cutter. The four inner sliders round the title bar, stat
          pills, and section heads independently so you can mix sharp
          and soft to taste.
        </p>
        <div class="cards-field" style="padding:4px 12px 0">
          <span class="cards-field-label">Card frame
            <span class="cards-slider-val" id="cards-radius-val">${cornerRadiusMm}mm</span>
          </span>
          <input type="range" min="0" max="10" step="0.5" value="${cornerRadiusMm}"
                 id="cards-radius" class="cards-range">
        </div>
        <div class="cards-field" style="padding:6px 12px 0">
          <span class="cards-field-label">Header corners
            <span class="cards-slider-val" id="cards-head-radius-val">${headerRadiusMm}mm</span>
          </span>
          <input type="range" min="0" max="10" step="0.5" value="${headerRadiusMm}"
                 id="cards-head-radius" class="cards-range">
        </div>
        <div class="cards-field" style="padding:6px 12px 0">
          <span class="cards-field-label">Stat blocks
            <span class="cards-slider-val" id="cards-stat-radius-val">${statRadiusMm}mm</span>
          </span>
          <input type="range" min="0" max="6" step="0.25" value="${statRadiusMm}"
                 id="cards-stat-radius" class="cards-range">
        </div>
        <div class="cards-field" style="padding:6px 12px 0">
          <span class="cards-field-label">Section heads
            <span class="cards-slider-val" id="cards-sect-radius-val">${sectionHeadRadiusMm}mm</span>
          </span>
          <input type="range" min="0" max="6" step="0.25" value="${sectionHeadRadiusMm}"
                 id="cards-sect-radius" class="cards-range">
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Borderless &amp; bleed</div>
        <p class="cards-help">
          For borderless printing. <strong>Safe margin</strong> nudges all
          text and data inward from the card edge while the background and
          frame still bleed to the edge — so a borderless printer that
          enlarges/overprints the page won't clip the text. <strong>Bleed
          background to sheet edge</strong> drops the sheet margin and the
          gaps between cards to zero so the card background reaches the paper
          edge (best with one card per sheet).
        </p>
        <div class="cards-field" style="padding:4px 12px 0">
          <span class="cards-field-label">Safe margin
            <span class="cards-slider-val" id="cards-safe-margin-val">${safeMarginMm}mm</span>
          </span>
          <input type="range" min="0" max="10" step="0.5" value="${safeMarginMm}"
                 id="cards-safe-margin" class="cards-range">
        </div>
        <label class="cards-row" style="margin: 8px 12px 0">
          <input type="checkbox" id="cards-bleed-edge" ${bleedToEdge ? 'checked' : ''}>
          <span><strong>Bleed background to sheet edge</strong></span>
        </label>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Typography</div>
        <p class="cards-help">
          Per-section font scaling for printed legibility. 100% = the
          original size. The "Bolden small text" toggle bumps weapon
          keywords, footer keywords, and column labels from weight 400
          → 600 — useful when small print ghosts on your printer.
        </p>
        ${[
          ['nameSize',    'Unit name (card title)'],
          ['statSize',    'Stat block (M T SV W LD OC values)'],
          ['weaponSize',  'Weapon table (range / A / BS / S / AP / D)'],
          ['bodySize',    'Body text (abilities, wargear, rule text)'],
          ['headingSize', 'Section heads (RANGED WEAPONS / ABILITIES / etc.)'],
          ['fineSize',    'Fine print (footer keywords, column labels)'],
          ['subSize',     'Subtitles (ARMY RULE, CORE STRATAGEM, PHASE: …)'],
        ].map(([k, label]) => {
          const pct = Math.round(typography[k] * 100);
          return `
          <div class="cards-field" style="padding:6px 12px 0">
            <span class="cards-field-label">${esc(label)}
              <span class="cards-slider-val" data-typo-val="${k}">${pct}%</span>
            </span>
            <input type="range" min="80" max="200" step="5" value="${pct}"
                   data-typo="${k}" class="cards-range">
          </div>`;
        }).join('')}
        <label class="cards-row" style="margin: 8px 12px 0">
          <input type="checkbox" id="cards-typo-bold" ${typography.bold ? 'checked' : ''}>
          <span><strong>Bolden small text</strong></span>
        </label>
        <div style="padding:8px 12px 0">
          <button type="button" class="cards-link-btn" id="cards-typo-reset">Reset typography</button>
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Card backs (duplex)</div>
        <p class="cards-help">
          Insert a back page after every front. Same layout and grid as
          the front it follows, so a 2-up rules page gets a 2-up back
          page. Print odd pages, flip the stack, then print even pages.
        </p>
        <label class="cards-row" style="margin: 4px 12px 6px">
          <input type="checkbox" id="cards-back-enabled" ${cardBack.enabled ? 'checked' : ''}>
          <span><strong>Enable card backs</strong></span>
        </label>
        <div class="cards-field" style="padding:4px 12px 0">
          <span class="cards-field-label">Upload new image</span>
          <input type="file" id="cards-back-file" accept="image/*" class="cards-file">
          ${cardBack.name ? `<div class="cards-help" style="margin:4px 0 0">Active: ${esc(cardBack.name)}</div>` : ''}
          ${cardBack.src ? `<button type="button" class="cards-link-btn" id="cards-back-clear" style="padding:4px 0">Use no image</button>` : ''}
        </div>
        ${renderImageGallery()}
        <div class="cards-field" style="padding:8px 12px 0">
          <span class="cards-field-label">Scale <span class="cards-slider-val" id="cards-back-scale-val">${(cardBack.scale * 100).toFixed(0)}%</span></span>
          <input type="range" min="50" max="300" step="5" value="${(cardBack.scale * 100).toFixed(0)}"
                 id="cards-back-scale" class="cards-range">
        </div>
        <div class="cards-field" style="padding:6px 12px 0">
          <span class="cards-field-label">Horizontal offset <span class="cards-slider-val" id="cards-back-x-val">${cardBack.offsetX}%</span></span>
          <input type="range" min="-100" max="100" step="1" value="${cardBack.offsetX}"
                 id="cards-back-x" class="cards-range">
        </div>
        <div class="cards-field" style="padding:6px 12px 0">
          <span class="cards-field-label">Vertical offset <span class="cards-slider-val" id="cards-back-y-val">${cardBack.offsetY}%</span></span>
          <input type="range" min="-100" max="100" step="1" value="${cardBack.offsetY}"
                 id="cards-back-y" class="cards-range">
        </div>
        <div style="padding:8px 12px 0">
          <button type="button" class="cards-link-btn" id="cards-back-reset">Reset position &amp; scale</button>
        </div>
      </div>

      <div class="cards-layout-section">
        <div class="cards-disp-heading">Spillover handling</div>
        <p class="cards-help">
          When a unit's text overflows the card, choose how the second
          card looks. Faction keywords + unit keywords always stay on
          the first card either way.
        </p>
        <label class="cards-row" style="margin: 4px 12px 4px">
          <input type="radio" name="spillover" value="continuation"
                 ${spilloverMode === 'continuation' ? 'checked' : ''}>
          <span><strong>Continuation card</strong>
            <span class="cards-help" style="display:block; margin:2px 0 0">Partial parchment over the back-art layer.</span>
          </span>
        </label>
        <label class="cards-row" style="margin: 0 12px 4px">
          <input type="radio" name="spillover" value="fullCard"
                 ${spilloverMode === 'fullCard' ? 'checked' : ''}>
          <span><strong>Full second card</strong>
            <span class="cards-help" style="display:block; margin:2px 0 0">Same full parchment as the primary.</span>
          </span>
        </label>
        <label class="cards-row" style="margin: 8px 12px 4px">
          <input type="checkbox" id="cards-allow-partial-section"
                 ${allowPartialSection ? 'checked' : ''}>
          <span><strong>Split sections mid-content</strong>
            <span class="cards-help" style="display:block; margin:2px 0 0">
              Required for army-rule overflow (single-section body). Also
              lets dense unit sections (abilities, weapons) break across
              primary &amp; continuation instead of moving the whole
              section.
            </span>
          </span>
        </label>
      </div>`;
    // Defer setting the <select> values until after the HTML lands in the DOM.
    queueMicrotask(() => {
      const g = hostEl.querySelector('#cards-layout-global');
      if (g) g.value = activeLayoutId;
      hostEl.querySelectorAll('select[data-layout-override]').forEach(sel => {
        const kind = sel.getAttribute('data-layout-override');
        sel.value = layoutByKind[kind] || '';
      });
    });
    return html;
  }

  function renderPickPanel() {
    // Inner category tabs (Units / Rules / Stratagems) + checkbox list.
    const cats = [
      { key: 'units',  label: 'Units',     items: gatherUnits()       },
      { key: 'rules',  label: 'Army rules', items: gatherRules()       },
      { key: 'strats', label: 'Stratagems', items: gatherStratagems() },
    ];
    const tabs = cats.map(c => {
      const on = c.key === activeCardCat;
      const count = (include[c.key] ? c.items.filter(it => include[c.key].has(it.id)).length : 0);
      return `<button type="button" class="cards-cat-tab${on ? ' is-active' : ''}" data-cat="${c.key}" role="tab" aria-selected="${on}">
        ${esc(c.label)}<span class="cards-cat-count">${count}/${c.items.length}</span>
      </button>`;
    }).join('');
    const active = cats.find(c => c.key === activeCardCat) || cats[0];
    const items = active.items;
    let body;
    if (items.length === 0) {
      const msg = active.key === 'units' ? 'No units in your army yet.'
                : active.key === 'rules' ? 'Select a faction and detachment to load rules.'
                : 'No stratagems available.';
      body = `<div class="cards-empty">${esc(msg)}</div>`;
    } else {
      const allOn = items.every(it => include[active.key].has(it.id));
      body = `
        <div class="cards-list-head">
          <label class="cards-row cards-row-all">
            <input type="checkbox" data-include="__all__" data-cat="${active.key}" ${allOn ? 'checked' : ''}>
            <span><strong>All ${esc(active.label.toLowerCase())}</strong></span>
          </label>
        </div>
        <ul class="cards-list">
          ${items.map(it => {
            const checked = include[active.key].has(it.id) ? 'checked' : '';
            return `<li><label class="cards-row">
              <input type="checkbox" data-include="${esc(it.id)}" data-cat="${active.key}" ${checked}>
              <span>${esc(it.label)}</span>
            </label></li>`;
          }).join('')}
        </ul>`;
    }
    return `
      <nav class="cards-cat-tabs" role="tablist" aria-label="Card category">${tabs}</nav>
      ${body}`;
  }

  function renderDisplayPanel() {
    const groups = DISPLAY_GROUPS.map(g => {
      const rows = g.keys.map(([key, label]) => `
        <li><label class="cards-row">
          <input type="checkbox" data-display="${esc(key)}" ${display[key] ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label></li>`).join('');
      return `<div class="cards-disp-group">
        <div class="cards-disp-heading">${esc(g.label)}</div>
        <ul class="cards-list">${rows}</ul>
      </div>`;
    }).join('');
    return `
      <div class="cards-list-head">
        <button type="button" class="cards-link-btn" id="cards-display-reset">Reset to defaults</button>
      </div>
      ${groups}`;
  }

  function onSidebarChange(e) {
    // Preset dropdown — auto-apply on selection.
    if (e.target && e.target.id === 'cards-preset-select') {
      const id = e.target.value || null;
      activePresetId = id;
      if (id) {
        const p = findPreset(id);
        if (p) applySettings(p.settings);
      }
      applyDynamicStyle();
      refreshSidebar();
      refreshPreview();
      refreshSummary();
      return;
    }
    // Layout: global preset
    if (e.target && e.target.id === 'cards-layout-global') {
      activeLayoutId = e.target.value || DEFAULT_LAYOUT;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Layout: per-category override (empty value = inherit global)
    const ovSel = e.target && e.target.matches && e.target.matches('select[data-layout-override]') ? e.target : null;
    if (ovSel) {
      const kind = ovSel.getAttribute('data-layout-override');
      layoutByKind[kind] = ovSel.value || null;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Spillover-mode radio
    if (e.target && e.target.matches && e.target.matches('input[name="spillover"]') && e.target.checked) {
      const v = e.target.value;
      if (v === 'continuation' || v === 'fullCard') {
        spilloverMode = v;
        refreshPreview();
      }
      return;
    }
    // Split-sections-mid-content checkbox
    if (e.target && e.target.id === 'cards-allow-partial-section') {
      allowPartialSection = !!e.target.checked;
      refreshPreview();
      return;
    }
    // Border color picker
    if (e.target && e.target.id === 'cards-border-color') {
      borderColor = e.target.value || DEFAULT_BORDER;
      syncBorderUI();
      refreshPreview();
      return;
    }
    // Texture intensity slider
    if (e.target && e.target.id === 'cards-tex-intensity') {
      textureIntensity = parseInt(e.target.value, 10);
      if (Number.isNaN(textureIntensity)) textureIntensity = DEFAULT_INTENSITY;
      const lbl = hostEl.querySelector('#cards-tex-intensity-val');
      if (lbl) lbl.textContent = textureIntensity + '%';
      applyDynamicStyle();
      return;
    }
    // Corner radius slider (card frame)
    if (e.target && e.target.id === 'cards-radius') {
      const v = parseFloat(e.target.value);
      cornerRadiusMm = Number.isNaN(v) ? 4 : Math.max(0, Math.min(10, v));
      const lbl = hostEl.querySelector('#cards-radius-val');
      if (lbl) lbl.textContent = cornerRadiusMm + 'mm';
      applyDynamicStyle();
      return;
    }
    // Header corner-rounding slider — independent of the card frame.
    if (e.target && e.target.id === 'cards-head-radius') {
      const v = parseFloat(e.target.value);
      headerRadiusMm = Number.isNaN(v) ? 3 : Math.max(0, Math.min(10, v));
      const lbl = hostEl.querySelector('#cards-head-radius-val');
      if (lbl) lbl.textContent = headerRadiusMm + 'mm';
      applyDynamicStyle();
      return;
    }
    // Stat-block radius slider
    if (e.target && e.target.id === 'cards-stat-radius') {
      const v = parseFloat(e.target.value);
      statRadiusMm = Number.isNaN(v) ? 1 : Math.max(0, Math.min(6, v));
      const lbl = hostEl.querySelector('#cards-stat-radius-val');
      if (lbl) lbl.textContent = statRadiusMm + 'mm';
      applyDynamicStyle();
      return;
    }
    // Section-head radius slider
    if (e.target && e.target.id === 'cards-sect-radius') {
      const v = parseFloat(e.target.value);
      sectionHeadRadiusMm = Number.isNaN(v) ? 1 : Math.max(0, Math.min(6, v));
      const lbl = hostEl.querySelector('#cards-sect-radius-val');
      if (lbl) lbl.textContent = sectionHeadRadiusMm + 'mm';
      applyDynamicStyle();
      return;
    }
    // Safe-margin (borderless content inset) slider. Changing it resizes the
    // content area, so a refreshPreview() is needed to re-run spillover.
    if (e.target && e.target.id === 'cards-safe-margin') {
      const v = parseFloat(e.target.value);
      safeMarginMm = Number.isNaN(v) ? 0 : Math.max(0, Math.min(10, v));
      const lbl = hostEl.querySelector('#cards-safe-margin-val');
      if (lbl) lbl.textContent = safeMarginMm + 'mm';
      applyDynamicStyle();
      refreshPreview();
      return;
    }
    // Bleed-to-sheet-edge toggle (zeroes sheet margin + card gutter).
    if (e.target && e.target.id === 'cards-bleed-edge') {
      bleedToEdge = !!e.target.checked;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Typography multipliers
    if (e.target && e.target.matches && e.target.matches('input[data-typo]')) {
      const key = e.target.getAttribute('data-typo');
      const pct = parseInt(e.target.value, 10);
      if (key in typography && !Number.isNaN(pct)) {
        typography[key] = Math.max(0.5, Math.min(2.0, pct / 100));
        const lbl = hostEl.querySelector('[data-typo-val="' + key + '"]');
        if (lbl) lbl.textContent = pct + '%';
        applyDynamicStyle();
      }
      return;
    }
    // Typography "bolden small text" toggle
    if (e.target && e.target.id === 'cards-typo-bold') {
      typography.bold = !!e.target.checked;
      applyDynamicStyle();
      return;
    }
    // Card-back: enable toggle
    if (e.target && e.target.id === 'cards-back-enabled') {
      cardBack.enabled = !!e.target.checked;
      refreshPreview();
      refreshSummary();
      return;
    }
    // Card-back: file upload — auto-saves to the library (up to LIMIT
    // per owner) and switches to it as the active back.
    if (e.target && e.target.id === 'cards-back-file') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        // Apply locally first so the preview updates immediately.
        cardBack.src = dataUrl;
        cardBack.name = file.name;
        cardBack.enabled = true;
        cardBack.activeId = null;
        refreshPreview();
        refreshSummary();
        // Then persist to the library (server when signed in, IDB when anon).
        const result = await ImageStore.add(file.name, dataUrl);
        if (result.ok) {
          cardBack.activeId = result.id;
          savedImages.unshift(result.image);
        } else if (result.reason === 'limit' && UI && UI.toast) {
          UI.toast(`Library is full (${result.limit} images). Delete one to save more.`, 'warning', 5000);
        } else if (result.reason === 'network' && UI && UI.toast) {
          UI.toast('Couldn\'t save to your account — check your connection.', 'warning', 5000);
        } else if (result.reason === 'auth' && UI && UI.toast) {
          UI.toast('Sign-in expired. Sign in again to save images to your account.', 'warning', 6000);
        }
        refreshSidebar();
      };
      reader.readAsDataURL(file);
      // Reset the file-input value so the same filename can be re-picked
      // after a "remove image"; otherwise change won't fire on re-pick.
      e.target.value = '';
      return;
    }
    // Card-back: range sliders
    if (e.target && e.target.id === 'cards-back-scale') {
      cardBack.scale = (parseInt(e.target.value, 10) || 100) / 100;
      const v = hostEl.querySelector('#cards-back-scale-val');
      if (v) v.textContent = (cardBack.scale * 100).toFixed(0) + '%';
      refreshPreview();
      return;
    }
    if (e.target && e.target.id === 'cards-back-x') {
      cardBack.offsetX = parseInt(e.target.value, 10) || 0;
      const v = hostEl.querySelector('#cards-back-x-val');
      if (v) v.textContent = cardBack.offsetX + '%';
      refreshPreview();
      return;
    }
    if (e.target && e.target.id === 'cards-back-y') {
      cardBack.offsetY = parseInt(e.target.value, 10) || 0;
      const v = hostEl.querySelector('#cards-back-y-val');
      if (v) v.textContent = cardBack.offsetY + '%';
      refreshPreview();
      return;
    }
    // Display toggles
    const dispCb = e.target.closest('input[type="checkbox"][data-display]');
    if (dispCb) {
      display[dispCb.dataset.display] = !!dispCb.checked;
      refreshPreview();
      return;
    }
    // Per-card include checkboxes
    const cb = e.target.closest('input[type="checkbox"][data-include]');
    if (cb) {
      const cat = cb.dataset.cat;
      const id  = cb.dataset.include;
      if (id === '__all__') {
        const allOn = cb.checked;
        const items = cat === 'units' ? gatherUnits()
                    : cat === 'rules' ? gatherRules()
                    :                   gatherStratagems();
        include[cat] = allOn ? new Set(items.map(x => x.id)) : new Set();
        refreshSidebar();
      } else {
        if (cb.checked) include[cat].add(id);
        else            include[cat].delete(id);
        // Update the count chip on the active category tab without a full re-render.
        const tab = hostEl.querySelector(`.cards-cat-tab[data-cat="${cat}"] .cards-cat-count`);
        if (tab) {
          const items = cat === 'units' ? gatherUnits() : cat === 'rules' ? gatherRules() : gatherStratagems();
          tab.textContent = `${items.filter(it => include[cat].has(it.id)).length}/${items.length}`;
        }
      }
      refreshPreview();
      refreshSummary();
    }
  }
  function onSidebarClick(e) {
    // Preset buttons (save / update / rename / delete).
    if (e.target && e.target.id === 'cards-preset-new') {
      const name = (window.prompt('Name this preset (e.g. "steve orks")') || '').trim();
      if (!name) return;
      const p = {
        id: newPresetId(),
        name,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        settings: captureSettings(),
      };
      presets.push(p);
      activePresetId = p.id;
      savePresets();
      refreshSidebar();
      if (UI && UI.toast) UI.toast('Saved preset “' + name + '”', 'success');
      return;
    }
    if (e.target && e.target.id === 'cards-preset-update') {
      const p = findPreset(activePresetId);
      if (!p) return;
      if (!window.confirm('Overwrite preset “' + p.name + '” with the current settings?')) return;
      p.settings  = captureSettings();
      p.updatedAt = nowIso();
      savePresets();
      refreshSidebar();
      if (UI && UI.toast) UI.toast('Updated preset “' + p.name + '”', 'success');
      return;
    }
    if (e.target && e.target.id === 'cards-preset-rename') {
      const p = findPreset(activePresetId);
      if (!p) return;
      const name = (window.prompt('Rename preset', p.name) || '').trim();
      if (!name || name === p.name) return;
      p.name      = name;
      p.updatedAt = nowIso();
      savePresets();
      refreshSidebar();
      return;
    }
    if (e.target && e.target.id === 'cards-preset-delete') {
      const p = findPreset(activePresetId);
      if (!p) return;
      if (!window.confirm('Delete preset “' + p.name + '”? This can\'t be undone.')) return;
      presets = presets.filter(x => x.id !== activePresetId);
      activePresetId = null;
      savePresets();
      refreshSidebar();
      return;
    }
    // Inner category tabs (Pick cards: Units/Rules/Stratagems)
    const catTab = e.target.closest('.cards-cat-tab');
    if (catTab) {
      activeCardCat = catTab.dataset.cat || 'units';
      refreshSidebar();
      return;
    }
    // Template (card skin) swatch — re-skin every card and re-tag the
    // preview cells. The skin is a CSS class applied at build time, so a
    // refreshPreview() (which rebuilds the page DOM) is what swaps it.
    const tpl = e.target.closest('[data-template-id]');
    if (tpl) {
      const id = tpl.getAttribute('data-template-id');
      templateId = isTemplateId(id) ? id : DEFAULT_TEMPLATE;
      hostEl.querySelectorAll('[data-template-id]').forEach(b => {
        const on = b.getAttribute('data-template-id') === templateId;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      refreshPreview();
      return;
    }
    // Texture swatch
    const tex = e.target.closest('[data-texture-id]');
    if (tex) {
      textureId = tex.getAttribute('data-texture-id') || DEFAULT_TEXTURE;
      // Update active class without rebuilding the whole panel.
      hostEl.querySelectorAll('[data-texture-id]').forEach(b => {
        b.classList.toggle('is-active', b.getAttribute('data-texture-id') === textureId);
        b.setAttribute('aria-selected', String(b.getAttribute('data-texture-id') === textureId));
      });
      applyTextureStyle();
      return;
    }
    // Border color preset swatch
    const sw = e.target.closest('[data-border-preset]');
    if (sw) {
      borderColor = sw.getAttribute('data-border-preset') || DEFAULT_BORDER;
      syncBorderUI();
      refreshPreview();
      return;
    }
    // Card-back: clear active image
    if (e.target && e.target.id === 'cards-back-clear') {
      cardBack.src = null;
      cardBack.name = '';
      cardBack.activeId = null;
      refreshSidebar();
      refreshPreview();
      refreshSummary();
      return;
    }
    // Card-back: delete a library thumbnail (× button) — must be checked
    // BEFORE the click-to-select handler since the × is inside the thumb.
    // Records can have integer ids (IDB autoIncrement) or string ids
    // (server UUIDs); we round-trip via String() to keep the comparison
    // robust either way.
    const delBtn = e.target.closest('[data-image-del]');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const stringId = delBtn.getAttribute('data-image-del');
      const target = savedImages.find(img => String(img.id) === stringId);
      if (target) {
        (async () => {
          await ImageStore.remove(target.id);
          savedImages = savedImages.filter(img => String(img.id) !== stringId);
          if (String(cardBack.activeId) === stringId) {
            cardBack.src = null;
            cardBack.name = '';
            cardBack.activeId = null;
            refreshPreview();
            refreshSummary();
          }
          refreshSidebar();
        })();
      }
      return;
    }
    // Card-back: click a library thumbnail to use it as the active back.
    const thumb = e.target.closest('.cards-img-thumb');
    if (thumb) {
      const stringId = thumb.getAttribute('data-image-id');
      const img = savedImages.find(i => String(i.id) === stringId);
      if (img) {
        cardBack.src = img.dataUrl;
        cardBack.name = img.name;
        cardBack.activeId = img.id;
        cardBack.enabled = true;
        refreshSidebar();
        refreshPreview();
        refreshSummary();
      }
      return;
    }
    // Card-back: reset position + scale
    if (e.target && e.target.id === 'cards-back-reset') {
      cardBack.scale   = 1.0;
      cardBack.offsetX = 0;
      cardBack.offsetY = 0;
      refreshSidebar();
      refreshPreview();
      return;
    }
    // Display "reset to defaults"
    if (e.target && e.target.id === 'cards-display-reset') {
      display = Object.assign({}, DEFAULT_DISPLAY);
      refreshSidebar();
      refreshPreview();
      return;
    }
    // Typography "Reset typography" link
    if (e.target && e.target.id === 'cards-typo-reset') {
      typography = JSON.parse(JSON.stringify(TYPOGRAPHY_DEFAULTS));
      refreshSidebar();
      applyDynamicStyle();
      return;
    }
  }

  function renderImageGallery() {
    const limit = ImageStore.LIMIT;
    const ownerLabel = esc(ImageStore.ownerLabel());
    const where = ImageStore.storageLocation();   // 'cloud' or 'local'
    const whereNote = where === 'cloud'
      ? 'Saved to your account — available on any device you sign in from.'
      : 'Saved to this browser only. Sign in to sync the library across devices.';
    const count = savedImages.length;

    let inner;
    if (savedImagesLoading) {
      inner = `<div class="cards-help" style="margin:4px 12px 6px">Loading library…</div>`;
    } else if (where === 'local' && (!window.YaabDB || !YaabDB.images)) {
      inner = `<div class="cards-help" style="margin:4px 12px 6px">Saved-image library unavailable in this browser.</div>`;
    } else if (count === 0) {
      inner = `<div class="cards-help" style="margin:4px 12px 6px">
        ${whereNote} (Up to ${limit}.)
      </div>`;
    } else {
      const thumbs = savedImages.map(img => {
        const isActive = String(cardBack.activeId) === String(img.id);
        return `
          <div class="cards-img-thumb${isActive ? ' is-active' : ''}"
               data-image-id="${img.id}" title="${esc(img.name)}">
            <img src="${esc(img.dataUrl)}" alt="${esc(img.name)}">
            <button type="button" class="cards-img-del" data-image-del="${img.id}"
                    title="Delete from library" aria-label="Delete ${esc(img.name)}">×</button>
          </div>`;
      }).join('');
      inner = `
        <div class="cards-help" style="margin:4px 12px 4px; display:flex; justify-content:space-between">
          <span>Library (${ownerLabel}${where === 'cloud' ? ' · cloud' : ' · local'})</span>
          <span><strong>${count}/${limit}</strong></span>
        </div>
        <div class="cards-img-grid">${thumbs}</div>`;
    }
    return `<div class="cards-img-section">${inner}</div>`;
  }

  function syncBorderUI() {
    if (!hostEl) return;
    const picker = hostEl.querySelector('#cards-border-color');
    if (picker) picker.value = borderColor;
    hostEl.querySelectorAll('[data-border-preset]').forEach(btn => {
      const match = btn.getAttribute('data-border-preset').toLowerCase() === borderColor.toLowerCase();
      btn.classList.toggle('is-active', match);
    });
  }

  function refreshPreview() {
    const out = hostEl && hostEl.querySelector('#cards-preview');
    if (!out) return;
    // Preserve scroll position across the rebuild. refreshPreview() fires on
    // virtually every sidebar interaction (toggles, sliders, colour swatches,
    // layout tweaks); since a styling change doesn't alter which cards are
    // shown, a full innerHTML rebuild would otherwise snap the preview back to
    // the top mid-scroll — the "data cards keep jumping to the top" bug. Save
    // the scroller's offset, rebuild, then restore it (clamped to the new
    // content height in case the card set genuinely shrank).
    const scroller = out.closest('.cards-preview-wrap');
    const prevTop = scroller ? scroller.scrollTop : 0;
    out.innerHTML = '';
    const { frag, cardCount } = buildPagesDOM();
    if (cardCount === 0) {
      out.innerHTML = '<div class="cards-empty cards-empty-large">Nothing selected yet. Pick at least one item from the sidebar.</div>';
      return;
    }
    out.appendChild(frag);
    if (scroller && prevTop > 0) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.min(prevTop, Math.max(0, max));
    }
  }
  function refreshSummary() {
    const sum = hostEl && hostEl.querySelector('#cards-summary');
    if (!sum) return;
    const all = selectedCards();
    let frontPages = 0;
    ['unit','rule','strat'].forEach(kind => {
      const cards = all.filter(c => c.kind === kind);
      if (cards.length === 0) return;
      const layout = getLayoutFor(kind);
      frontPages += Math.ceil(cards.length / (layout.cols * layout.rows));
    });
    const backsOn = !!(cardBack.enabled && cardBack.src);
    const totalPages = backsOn ? frontPages * 2 : frontPages;
    const backNote = backsOn ? ` (${frontPages} front + ${frontPages} back)` : '';
    sum.textContent = `${all.length} card${all.length === 1 ? '' : 's'} · ${totalPages} page${totalPages === 1 ? '' : 's'}${backNote}`;
  }

  // ── Print / Save PDF ─────────────────────────────────────────────────────
  // Native browser print. Inject an @page rule with the active layout's
  // page size, add `body.cards-printing` so the @media print CSS in
  // cards-mode.css can hide everything except .dcc-page elements, and
  // call window.print(). Cleanup when the dialog closes (afterprint).
  function onPrint() {
    const cards = selectedCards();
    if (cards.length === 0) {
      if (UI && UI.toast) UI.toast('Nothing selected', 'warning');
      return;
    }

    // Collect every distinct paper size in play. If categories use the
    // same w/h (e.g. all 4×6 with different grids — the common case),
    // we emit one global @page rule. If categories truly mix paper
    // sizes, we emit a named @page per size and tag each .dcc-page with
    // `page: <name>` via a generated rule keyed off data-layout.
    const sizes = new Map();   // key "wxh" → { w, h, name, layoutIds:[] }
    ['unit','rule','strat'].forEach(kind => {
      const groupCards = cards.filter(c => c.kind === kind);
      if (groupCards.length === 0) return;
      const l = getLayoutFor(kind);
      const key = l.w + 'x' + l.h;
      if (!sizes.has(key)) sizes.set(key, { w: l.w, h: l.h, name: 'cardspage' + sizes.size, layoutIds: [] });
      sizes.get(key).layoutIds.push(l.id);
    });

    let pageCss = '';
    if (sizes.size <= 1) {
      const only = [...sizes.values()][0] || { w: getLayout().w, h: getLayout().h };
      pageCss = '@page { size: ' + only.w + 'mm ' + only.h + 'mm; margin: 0; }';
    } else {
      sizes.forEach(s => {
        pageCss += '@page ' + s.name + ' { size: ' + s.w + 'mm ' + s.h + 'mm; margin: 0; }\n';
        s.layoutIds.forEach(id => {
          pageCss += 'body.cards-printing .dcc-page[data-layout="' + id + '"] { page: ' + s.name + '; }\n';
        });
      });
      // Pick the first as the document default, in case the printer
      // needs an unnamed @page fallback.
      const first = [...sizes.values()][0];
      pageCss += '@page { size: ' + first.w + 'mm ' + first.h + 'mm; margin: 0; }\n';
    }

    let style = document.getElementById('cards-print-style');
    if (style) style.remove();
    style = document.createElement('style');
    style.id = 'cards-print-style';
    style.textContent = pageCss;
    document.head.appendChild(style);
    document.body.classList.add('cards-printing');

    function cleanup() {
      document.body.classList.remove('cards-printing');
      const s = document.getElementById('cards-print-style');
      if (s) s.remove();
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    // Some browsers (Safari) don't fire afterprint reliably — also clean
    // up after a short timeout fallback.
    setTimeout(cleanup, 30000);

    // Defer one frame so the browser repaints with the body class applied.
    requestAnimationFrame(() => {
      try { window.print(); }
      catch (err) { console.warn('[cards-mode] print failed', err); cleanup(); }
    });
  }

  // ── Mount + lifecycle ────────────────────────────────────────────────────
  function mount() {
    hostEl = document.getElementById(HOST_ID);
    if (!hostEl) return;
    // Hydrate prefs from localStorage (sync.js pulled the bag into LS by
    // the time bootstrap fires for already-signed-in users).
    loadPrefs();
    loadPresets();
    applyDynamicStyle();
    // Kick off saved-image load in the background so it's ready by the
    // time the user opens the Layout sub-tab.
    reloadSavedImages().then(() => {
      if (mounted && activeSubTab === 'layout') refreshSidebar();
    });
    // Re-load when the user signs in/out — library is owner-scoped, and
    // sync.js will have pulled the latest prefs by then too.
    if (App.Auth && typeof App.Auth.onChange === 'function') {
      App.Auth.onChange(() => {
        loadPrefs();
        loadPresets();
        applyDynamicStyle();
        reloadSavedImages().then(() => {
          if (mounted) {
            refreshSidebar();
            refreshPreview();
            refreshSummary();
          }
        });
      });
    }
    // Re-load prefs when localStorage changes from another tab.
    window.addEventListener('storage', e => {
      if (e.key === PREFS_KEY || e.key === PRESETS_KEY) {
        if (e.key === PREFS_KEY)    loadPrefs();
        if (e.key === PRESETS_KEY)  loadPresets();
        applyDynamicStyle();
        if (mounted) {
          refreshSidebar();
          refreshPreview();
          refreshSummary();
        }
      }
    });
    // Re-load when the bag-sync layer pulls fresh values from the
    // server. sync.js writes via rawSet (suppresses the localStorage
    // monkey-patch and never fires `storage` for same-tab writes), so
    // we need this explicit hook to know cloud state has landed —
    // otherwise a user who signed in on this device after another
    // device pushed prefs would render their cards with stale defaults
    // until a manual reload.
    window.addEventListener('yaab-bag-pulled', e => {
      const keys = (e && e.detail && e.detail.keys) || null;
      // A null keys list means "assume everything changed". Otherwise only
      // react if one of OUR two keys was in the pull — but check both:
      // yaab_cards_prefs (live settings) AND yaab_cards_presets (named
      // snapshots). The old code only looked at PREFS_KEY and never
      // reloaded presets, so presets saved on one device never surfaced
      // when you signed in on another until a full reload.
      const prefsPulled   = !keys || keys.indexOf(PREFS_KEY)   !== -1;
      const presetsPulled = !keys || keys.indexOf(PRESETS_KEY) !== -1;
      if (!prefsPulled && !presetsPulled) return;
      if (prefsPulled)   loadPrefs();
      if (presetsPulled) loadPresets();
      applyDynamicStyle();
      if (mounted) {
        refreshSidebar();
        refreshPreview();
        refreshSummary();
      }
    });
    // Render lazily on first activation so we don't pay for it on every
    // app load — the host stays a placeholder until cards mode opens.
    if (typeof App.getMode === 'function' && App.getMode() === 'cards') {
      renderHost();
    }
  }

  if (Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(mount);
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  if (Array.isArray(App.hooks.modeChange)) {
    App.hooks.modeChange.push(mode => {
      if (mode !== 'cards') return;
      if (!hostEl) hostEl = document.getElementById(HOST_ID);
      if (!hostEl) return;
      // Re-load prefs every time the user enters Cards mode. Belt-and-
      // braces in case the bag-pulled event landed before this module
      // wired its listener (e.g. fresh sign-in flow where pullAll
      // resolves between bootstrap and the user's first click on the
      // Cards tab).
      loadPrefs();
      loadPresets();
      applyDynamicStyle();
      renderHost();
    });
  }
  if (Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(() => {
      include = { units: null, rules: null, strats: null };
      if (mounted && App.getMode && App.getMode() === 'cards') {
        // Repopulate include sets from the new army before redrawing —
        // otherwise refreshPreview sees `include.units === null`, treats
        // every card as deselected, and shows the empty-state "Nothing
        // selected yet" message until the user mode-switches (which
        // calls renderHost → syncIncludeDefaults). This was the
        // disappearing-cards-after-tab-switch bug: sync.js's
        // visibilitychange listener pulls fresh server state, the army
        // manager fires armyChange even when nothing changed, and the
        // preview blanked because of the un-defaulted include.
        syncIncludeDefaults();
        refreshSidebar(); refreshPreview(); refreshSummary();
      }
    });
  }
  if (Array.isArray(App.hooks.selectionChange)) {
    App.hooks.selectionChange.push(() => {
      if (mounted && App.getMode && App.getMode() === 'cards') {
        syncIncludeDefaults();
        refreshSidebar(); refreshPreview(); refreshSummary();
      }
    });
  }

  // Public API: external callers (Export menu, command palette) just flip
  // the mode. The mode-change hook handles rendering.
  App.openCardsMode = function () {
    if (typeof App.setMode === 'function') App.setMode('cards');
  };
})();
