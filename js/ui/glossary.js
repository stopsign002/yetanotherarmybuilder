// ui/glossary.js — click any core ability / weapon keyword and read what it does.
//
// Contract: docs/GLOSSARY.md. Reads window.DC and the DOM only; no storage, no
// App.state. Three pieces:
//   UI.glossary.lookup(nameOrId) → { id, name, text, title } | null
//   UI.linkGlossary(html)        → html with <button class="glossary-term"> links
//                                  (UI.mdBold is wrapped at load to call it)
//   one singleton popover #glossary-pop (anchored popover on desktop, bottom
//   sheet on phones, back-trapped via App.backTrap).
(function () {
  const UI = window.UI = window.UI || {};
  const App = window.App = window.App || {};

  const baseMdBold = UI.mdBold;   // ORIGINAL — the popover body never links itself
  const MOBILE_MQ = '(max-width: 820px)';
  const SMALL = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'to']);
  // Single words that are also ordinary English / unit-name fragments.
  const AMBIGUOUS = new Set(['leader', 'support', 'hover', 'heavy', 'pistol', 'assault', 'blast',
    'lance', 'psychic', 'precision', 'torrent', 'melta', 'scouts', 'cleave', 'smokescreen']);

  // ── index ────────────────────────────────────────────────────────────────
  let idx = null; // { byId: Map, byKey: Map, list: [{id,name,text}], re: RegExp }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function titleCase(id) {
    return String(id).split('-').map((w, i) => (i > 0 && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const ANTI_TEXT = 'Each time an attack is made with this weapon against a <KEYWORD> unit, '
    + 'an unmodified Wound roll of N+ scores a Critical Wound.';

  function build() {
    if (idx) return idx;
    const DC = window.DC;
    const store = (DC && DC.abilityText) || {};
    const core = new Set();
    Object.keys(store).forEach(id => {
      const e = store[id];
      if (e && e.faction === 'core' && id.indexOf('/') < 0) core.add(id);
    });
    const byId = new Map();
    core.forEach(id => {
      // shortest proper hyphen-prefix that is itself a core id, else itself
      const parts = id.split('-');
      let base = id;
      for (let n = 1; n < parts.length; n++) {
        const p = parts.slice(0, n).join('-');
        if (core.has(p)) { base = p; break; }
      }
      if (byId.has(base)) return;
      const e = store[base] || {};
      let name = '';
      try {
        const a = DC.abilities && (DC.abilities.getAny ? DC.abilities.getAny(base) : DC.abilities.get(base));
        if (a && a.name) name = String(a.name);
      } catch (_) { /* store throws on unknown ids */ }
      byId.set(base, { id: base, name: name || titleCase(base), text: e.raw_text || e.effect || '' });
    });
    if (!byId.has('anti')) byId.set('anti', { id: 'anti', name: 'Anti', text: ANTI_TEXT });
    const list = Array.from(byId.values()).filter(t => t.text);
    const live = new Map(list.map(t => [t.id, t]));
    const byKey = new Map();
    list.forEach(t => { byKey.set(norm(t.id), t); byKey.set(norm(t.name), t); });
    // Longest first so "Sustained Hits" beats a hypothetical "Sustained".
    const names = list.map(t => t.name).sort((a, b) => b.length - a.length);
    const alts = names.map(n => {
      if (norm(n) === 'anti') return 'Anti-[A-Za-z]+(?:\\s\\d\\+)?';
      return escRe(n).replace(/(?:\\?-|\s)+/g, '[\\s-]');
    });
    // Param: " 5+", " 2", " D6", ' 6"' (the html is escaped, so " may be &quot;)
    const PARAM = '(?:\\s(?:\\d+\\+?|D\\d+(?:\\+\\d+)?|\\d+(?:"|&quot;)))?';
    const re = new RegExp('(?<![\\w-])(' + alts.join('|').replace(/\)\|/g, ')|') + ')' + PARAM + '(?![\\w-])', 'gi');
    idx = { byId: live, byKey, list, re };
    return idx;
  }

  const PARAM_TAIL = /\s+(?:\d+\+?|D\d+(?:\+\d+)?|\d+(?:"|”|′)?)$/i;
  function lookup(q) {
    if (q == null) return null;
    const ix = build();
    const raw = String(q).replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const direct = ix.byId.get(raw.toLowerCase());
    if (direct) return Object.assign({ title: direct.name }, direct);
    const exact = ix.byKey.get(norm(raw));
    if (exact) return Object.assign({ title: raw }, exact);
    const anti = /^anti[\s-]+[a-z][a-z -]*?(?:\s+\d\+?)?$/i.exec(raw);
    if (anti && ix.byId.get('anti')) {
      const a = ix.byId.get('anti');
      const m = /^anti[\s-]+([a-z][a-z -]*?)(?:\s+(\d)\+?)?$/i.exec(raw);
      const kw = m[1].toUpperCase();
      const text = a.text === ANTI_TEXT
        ? ANTI_TEXT.replace('<KEYWORD>', kw).replace('N+', m[2] ? m[2] + '+' : 'the listed value or more')
        : a.text;
      return { id: 'anti', name: a.name, text, title: raw };
    }
    const idTail = raw.toLowerCase().replace(/-(?:\d+(?:-plus)?|d\d+(?:-\d+|-plus-\d+)?)$/, '');
    if (idTail !== raw.toLowerCase() && ix.byId.get(idTail)) return Object.assign({ title: raw }, ix.byId.get(idTail));
    const stripped = raw.replace(PARAM_TAIL, '');
    if (stripped !== raw) {
      const t = ix.byKey.get(norm(stripped));
      if (t) return Object.assign({ title: raw }, t);
    }
    return null;
  }

  // ── linking prose ────────────────────────────────────────────────────────
  function isTitleCase(s) {
    return s.split(/[\s-]+/).every(w => !w || /^[A-Z0-9]/.test(w) || SMALL.has(w));
  }
  // Bracketed capitals, as 11e prose writes them: "[DEVASTATING WOUNDS]", "[SUSTAINED HITS 1]".
  const BRACKET_RE = /\[([A-Z][A-Z0-9 \-']+?)( [0-9D]+(?:\+|"|&quot;)?)?\]/g;
  function linkText(text, inStrong, ix) {
    let out = '', last = 0, m;
    BRACKET_RE.lastIndex = 0;
    while ((m = BRACKET_RE.exec(text))) {
      const t = lookup((m[1] + (m[2] || '')).replace(/&quot;/g, '"'));
      if (!t) continue;
      out += linkPlain(text.slice(last, m.index), inStrong, ix, text.slice(0, m.index))
        + '<button type="button" class="glossary-term" data-glossary="' + t.id + '">' + m[0] + '</button>';
      last = m.index + m[0].length;
    }
    return last ? out + linkPlain(text.slice(last), inStrong, ix, text) : linkPlain(text, inStrong, ix, text);
  }
  function linkPlain(text, inStrong, ix) {
    ix.re.lastIndex = 0;
    return text.replace(ix.re, (m, _g, off, whole) => {
      const rawTerm = m;
      const t = lookup(rawTerm.replace(/&quot;/g, '"'));
      if (!t) return m;
      const bare = m.replace(PARAM_TAIL, '').replace(/&quot;/g, '"');
      const isAmb = AMBIGUOUS.has(t.id) && norm(bare) === t.id;
      const after = whole.slice(off + m.length);
      const before = whole.slice(0, off);
      if (!inStrong && !isTitleCase(bare)) return m;
      if (isAmb) {
        if (/^\s+[A-Z][a-z]/.test(after)) return m;
        if (!inStrong) {
          const ctx = /^\s+abilit(?:y|ies)\b/i.test(after) || /\b(?:the|has|gains?|have)\s$/i.test(before);
          if (!ctx) return m;
        }
      }
      return '<button type="button" class="glossary-term" data-glossary="' + t.id + '">' + m + '</button>';
    });
  }
  UI.linkGlossary = function (html) {
    if (!html || typeof html !== 'string') return html;
    let ix;
    try { ix = build(); } catch (_) { return html; }
    if (!ix.list.length) return html;
    let strong = 0, skip = 0; // skip: inside button/a/script/style
    return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)/g, (m, close, tag, text) => {
      if (tag) {
        const t = tag.toLowerCase();
        if (t === 'strong' || t === 'b') strong = Math.max(0, strong + (close ? -1 : 1));
        else if (t === 'button' || t === 'a' || t === 'script' || t === 'style') skip = Math.max(0, skip + (close ? -1 : 1));
        return m;
      }
      if (skip || !text) return m;
      return linkText(text, strong > 0, ix);
    });
  };
  if (typeof baseMdBold === 'function') {
    UI.mdBold = function (s) { return UI.linkGlossary(baseMdBold(s)); };
  }

  // ── popover ──────────────────────────────────────────────────────────────
  let pop = null, titleEl = null, bodyEl = null, anchor = null, open = false;
  const isMobile = () => { try { return window.matchMedia(MOBILE_MQ).matches; } catch (_) { return false; } };

  function ensurePop() {
    if (pop) return;
    pop = document.createElement('div');
    pop.id = 'glossary-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-labelledby', 'glossary-pop-title');
    pop.tabIndex = -1;
    pop.hidden = true;
    pop.innerHTML = '<div class="glossary-pop-head"><div class="glossary-pop-title" id="glossary-pop-title"></div>'
      + '<button type="button" class="glossary-pop-close" aria-label="Close">&times;</button></div>'
      + '<div class="glossary-pop-body"></div>';
    document.body.appendChild(pop);
    titleEl = pop.querySelector('.glossary-pop-title');
    bodyEl = pop.querySelector('.glossary-pop-body');
    pop.querySelector('.glossary-pop-close').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  }

  function place() {
    if (!anchor || !pop) return;
    pop.style.left = pop.style.top = pop.style.bottom = pop.style.right = '';
    if (isMobile()) { pop.classList.add('is-sheet'); return; }
    pop.classList.remove('is-sheet');
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8));
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function show(el, t) {
    ensurePop();
    anchor = el;
    titleEl.textContent = t.title || t.name;
    bodyEl.innerHTML = baseMdBold(t.text);
    const wasOpen = open;
    pop.hidden = false;
    open = true;
    place();
    if (isMobile() && App.backTrap && App.backTrap.opened) App.backTrap.opened('glossary', close);
    if (!wasOpen) { try { pop.focus({ preventScroll: true }); } catch (_) { pop.focus(); } }
    else { try { pop.focus({ preventScroll: true }); } catch (_) {} }
    bodyEl.scrollTop = 0;
  }

  function close() {
    if (!open) return;
    open = false;
    pop.hidden = true;
    pop.classList.remove('is-sheet');
    if (App.backTrap && App.backTrap.closed) App.backTrap.closed('glossary');
    const a = anchor; anchor = null;
    if (a && document.contains(a)) { try { a.focus({ preventScroll: true }); } catch (_) {} }
  }

  function labelOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function resolve(el) {
    const label = labelOf(el);
    let t = el.dataset.glossary ? lookup(el.dataset.glossary) : null;
    if (t && label) t = Object.assign({}, t, { title: label });
    if (!t) { t = lookup(label); }
    if (!t) {
      const tip = el.getAttribute('data-tooltip');
      if (tip) t = { id: '', name: label, title: label, text: tip };
    }
    return t;
  }

  function onActivate(e) {
    const el = e.target.closest && e.target.closest('.weapon-kw-tag, .core-ability-tag, .glossary-term');
    if (!el || (pop && pop.contains(el))) return false;
    const t = resolve(el);
    if (!t) return false;
    e.preventDefault();
    e.stopPropagation();
    if (open && anchor === el) { close(); return true; }
    const tip = document.getElementById('global-tooltip');
    if (tip) tip.hidden = true;
    show(el, t);
    return true;
  }

  document.addEventListener('click', (e) => { onActivate(e); }, true);
  // Chips that are not <button>s (older markup) still answer Enter / Space.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); close(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.tagName !== 'BUTTON') {
      if (onActivate(e)) return;
    }
  }, true);
  document.addEventListener('click', (e) => {
    if (open && pop && !pop.contains(e.target)) close();
  });
  window.addEventListener('resize', () => { if (open) place(); });
  document.addEventListener('scroll', (e) => {
    if (!open || isMobile() || (pop && pop.contains(e.target))) return;
    // Follow the anchor while a pane scrolls; drop the popover once it leaves the screen.
    if (!anchor || !document.contains(anchor)) { close(); return; }
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) close(); else place();
  }, true);

  UI.glossary = { lookup, size: () => build().list.length, terms: () => build().list.map(t => t.id), close };
})();
