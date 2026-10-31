// ui/waha-mode.js — Waha mode: look anything up, build nothing.
//
// Contract: docs/WAHA-MODE.md. Any datasheet, detachment, stratagem, army rule
// or enhancement for any faction, found from one always-visible search box,
// with NO army involved. The builder's faction select WRITES the faction into
// the open army; this mode never does. It reads App.state.factions and
// renders with the shared detail renderers (browseView / host options) and
// writes exactly one key of its own, yaab_waha_recent.
//
// Sections: helpers · recent · index · search · results · reader ·
// phone navigation · keyboard · mount/activation · entry points.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_RECENT = 'yaab_waha_recent';   // [{kind, key, factionId, detName?}] newest first, max 10
  const MAX_RECENT = 10;
  const PAGE = 60;                         // rows per page on a kind tab
  const TOP_N = 8;                         // rows per group on the All tab
  const DEBOUNCE_MS = 80;
  const MIN_FACTIONS = 30;

  // Result groups, in the fixed order the contract asks for.
  const KINDS = [
    ['unit',  'Datasheets'],
    ['det',   'Detachments'],
    ['strat', 'Stratagems'],
    ['rule',  'Army rules'],
    ['enh',   'Enhancements'],
  ];
  const TABS = [['all', 'All']].concat(KINDS);
  const KIND_NAME = { unit: 'Datasheet', det: 'Detachment', strat: 'Stratagem', rule: 'Army rule', enh: 'Enhancement' };
  const GLYPH = { unit: '▣', det: '◆', strat: '✦', rule: '❖', enh: '★' };
  const ROLE_ORDER = ['epic hero', 'character', 'battleline', 'infantry', 'mounted', 'beast', 'swarm',
    'monster', 'vehicle', 'walker', 'aircraft', 'fortification', 'dedicated transport'];

  // ── module state ──────────────────────────────────────────────────────
  let _root = null;            // .waha-root
  let _mounted = false;
  let _idx = null;             // search index (see buildIndex)
  let _sig = '';               // signature the index was built for
  let _timer = 0;              // query debounce
  let _tick = 0;               // staleness poll while the page is open
  let _hi = -1;                // highlighted row (arrow keys)
  let _mql = null;             // matchMedia('(max-width: 820px)')
  let _results = null;         // memo of the last run() for the current state
  const S = freshState();

  function freshState() {
    return { q: '', faction: 'all', tab: 'all', limits: {}, sel: null, enhDet: '' };
  }
  function resetState() {
    const f = freshState();
    Object.keys(f).forEach(k => { S[k] = f[k]; });
    _hi = -1;
    _results = null;
  }

  // ── helpers ───────────────────────────────────────────────────────────
  const esc = (s) => UI.escapeHtml(s);
  function shortFaction(name) { return String(name || '').replace(/^(Imperium|Xenos|Chaos) - /, ''); }
  function isActive() {
    const host = document.getElementById('waha-mode');
    return !!host && !host.hidden && host.classList.contains('mode-active');
  }
  function isPhone() { return !!(_mql && _mql.matches); }
  function legendsOn() {
    try { return localStorage.getItem('yaab_show_legends') === '1'; } catch (_) { return false; }
  }
  function factionsReady() {
    const s = App.state;
    return !!(s && Array.isArray(s.factions) && s.factions.length >= MIN_FACTIONS);
  }
  function q(sel) { return _root ? _root.querySelector(sel) : null; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function roleOf(u) {
    let r = (u && u.role) || (App.classifyUnitRole && App.classifyUnitRole(u)) || '';
    r = String(r).replace(/-/g, ' ').trim();
    return r || 'other';
  }
  function roleLabel(r) { return r.replace(/\b\w/g, c => c.toUpperCase()); }
  function roleRank(r) { const i = ROLE_ORDER.indexOf(r); return i === -1 ? 50 : i; }
  function ptsText(u) {
    const o = (u.pointsOptions && u.pointsOptions.length) ? u.pointsOptions : (u.points ? [u.points] : []);
    return o.length ? o.join(' / ') + ' pts' : '';
  }

  // ── recent (the only thing this mode persists) ────────────────────────
  function readRecent() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_RECENT) || '[]');
      return Array.isArray(v) ? v.filter(e => e && e.kind && e.key) : [];
    } catch (_) { return []; }
  }
  function pushRecent(rec) {
    const entry = { kind: rec.kind, key: rec.key, factionId: rec.factionId };
    if (rec.detName) entry.detName = rec.detName;
    const list = readRecent().filter(e => !(e.kind === rec.kind && e.key === rec.key));
    list.unshift(entry);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(list.slice(0, MAX_RECENT))); } catch (_) {}
  }

  // ── index ─────────────────────────────────────────────────────────────
  // One record per searchable thing. Rebuilt when factionsVersion, the
  // Legends pref, or the amount of loaded stratagem text changes (the GDC
  // stratagems arrive a few seconds after the factions do).
  function signature() {
    const s = App.state;
    let n = 0;
    ((s && s.factions) || []).forEach(f => {
      n += (f.factionStratagems || []).length + (f.gdcFactionStratagems || []).length;
      (f.detachments || []).forEach(d => { n += (d.stratagems || []).length + (d.gdcStratagems || []).length; });
    });
    return ((s && s.factionsVersion) || 0) + '|' + (legendsOn() ? 1 : 0) + '|' + n;
  }
  function recKey(kind, key) { return kind + '\u0001' + key; }

  function buildIndex() {
    const legends = legendsOn();
    const recs = [];
    const byKey = new Map();
    const unitsByName = new Map();
    const factions = [];
    const facByName = new Map();
    function add(r) {
      r.lname = r.name.toLowerCase();
      r.hay = String(r.hay || r.name).toLowerCase();
      const k = recKey(r.kind, r.key);
      if (byKey.has(k)) return;
      byKey.set(k, r);
      recs.push(r);
    }
    function uniqStrats() {
      const seen = new Set(), out = [];
      for (let a = 0; a < arguments.length; a++) {
        (arguments[a] || []).forEach(s => {
          if (!s || !s.name) return;
          const k = s.name.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k);
          out.push(s);
        });
      }
      return out;
    }
    function stratRec(s, f, fid, detName, detKey, core) {
      const bits = [];
      if (s.cp != null && s.cp !== '') bits.push(s.cp + ' CP');
      const ph = (window.UI && UI.stratPhaseLabel) ? UI.stratPhaseLabel(s) : (s.phase || '');
      if (ph) bits.push(ph);
      add({
        kind: 'strat', key: (core ? 'core' : fid) + '|' + (detKey || '') + '|' + s.name,
        name: s.name, factionName: core ? 'Core' : f.factionName, factionId: core ? 'core' : fid,
        detName: detName || '', line: bits.join(' · '),
        hay: s.name + ' ' + (s.description || ''), ref: s, core: !!core,
      });
    }

    (App.state.factions || []).forEach(f => {
      const fid = f._factionId || f.factionName;
      const retired = new Set(f._retiredDetachments || []);
      let unitCount = 0;
      facByName.set(f.factionName, f);
      // A Space Marine chapter faction repeats its parent's detachments (and
      // army rules / faction stratagems) verbatim; index those once, under the
      // parent. Chapter-only entries stay under the chapter.
      const parentF = (App.state.factions || []).find(
        x => x.factionName === (App.CHAPTER_PARENTS || {})[f.factionName]);
      const inParent = (list, name) => !!parentF && (parentF[list] || []).some(x => x && x.name === name);

      (f.units || []).forEach(u => {
        if (!u || !u.name) return;
        if (u.isLegends && !legends) return;
        unitCount++;
        const hay = [u.name]
          .concat(u.keywords || [])
          .concat((u.abilities || []).map(a => a && a.name))
          .concat((u.weapons || []).map(w => w && w.name))
          .filter(Boolean).join(' ');
        const role = roleOf(u);
        const rec = {
          kind: 'unit', key: fid + '|' + (u.id || u.name), name: u.name,
          factionName: f.factionName, factionId: fid, detName: '',
          line: [roleLabel(role), ptsText(u)].filter(Boolean).join(' · '),
          hay, ref: u, role,
        };
        add(rec);
        const ln = u.name.toLowerCase();
        if (!unitsByName.has(ln)) unitsByName.set(ln, []);
        unitsByName.get(ln).push(rec);
      });

      (f.armyRules || []).forEach(r => {
        if (!r || !r.name) return;
        if (inParent('armyRules', r.name)) return;
        add({
          kind: 'rule', sub: 'army', key: fid + '||' + r.name, name: r.name,
          factionName: f.factionName, factionId: fid, detName: '', line: 'Army rule',
          hay: r.name + ' ' + (r.description || ''), ref: r,
        });
      });

      uniqStrats(f.factionStratagems, f.gdcFactionStratagems)
        .filter(s => !(parentF && uniqStrats(parentF.factionStratagems, parentF.gdcFactionStratagems)
          .some(p => p.name === s.name)))
        .forEach(s => stratRec(s, f, fid, '', '', false));

      (f.detachments || []).forEach(d => {
        if (!d || !d.name) return;
        if (inParent('detachments', d.name)) return;
        const dKey = d.id || d.name;
        const isRetired = retired.has(d.name);
        const firstRule = (d.rules && d.rules[0] && d.rules[0].name) || '';
        add({
          kind: 'det', key: fid + '|' + dKey, name: d.name,
          factionName: f.factionName, factionId: fid, detName: d.name,
          line: (isRetired ? 'Retired · ' : '') + firstRule,
          hay: d.name + ' ' + (d.rules || []).map(r => r && r.name).filter(Boolean).join(' '),
          ref: d, retired: isRetired,
        });
        (d.rules || []).forEach(r => {
          if (!r || !r.name) return;
          add({
            kind: 'rule', sub: 'det', key: fid + '|' + dKey + '|' + r.name, name: r.name,
            factionName: f.factionName, factionId: fid, detName: d.name, line: 'Detachment rule',
            hay: r.name + ' ' + (r.description || ''), ref: r,
          });
        });
        (d.enhancements || []).forEach(e => {
          if (!e || !e.name) return;
          add({
            kind: 'enh', key: fid + '|' + dKey + '|' + e.name, name: e.name,
            factionName: f.factionName, factionId: fid, detName: d.name,
            line: e.pts != null && e.pts !== '' ? e.pts + ' pts' : 'Enhancement',
            hay: e.name + ' ' + (e.description || ''), ref: e,
          });
        });
        uniqStrats(d.stratagems, d.gdcStratagems)
          .forEach(s => stratRec(s, f, fid, d.name, dKey, false));
      });

      factions.push({
        name: f.factionName, id: fid, short: shortFaction(f.factionName),
        units: unitCount, dets: (f.detachments || []).length,
      });
    });

    uniqStrats(App.CORE_STRATAGEMS).forEach(s => stratRec(s, null, 'core', '', '', true));

    factions.sort((a, b) => a.short.localeCompare(b.short));
    return { recs, byKey, unitsByName, factions, facByName };
  }

  // Build (or rebuild) when stale. Returns true when it rebuilt.
  function ensureIndex() {
    if (!factionsReady()) return false;
    const sig = signature();
    if (_idx && sig === _sig) return false;
    _idx = buildIndex();
    _sig = sig;
    _results = null;
    fillFactionSelect();
    return true;
  }

  function fillFactionSelect() {
    const sel = q('#waha-faction');
    if (!sel || !_idx) return;
    const keep = S.faction;
    sel.innerHTML = '';
    const all = el('option', null, 'All factions');
    all.value = 'all';
    sel.appendChild(all);
    _idx.factions.forEach(f => {
      const o = el('option', null, f.short);
      o.value = f.name;
      sel.appendChild(o);
    });
    sel.value = keep;
    if (sel.value !== keep) { S.faction = 'all'; sel.value = 'all'; }
  }

  // ── search ────────────────────────────────────────────────────────────
  function tokens() { return S.q.toLowerCase().split(/\s+/).filter(Boolean); }

  // The filtered, ranked records for the current query + faction filter,
  // split by kind. Core stratagems are faction-less and stay visible under a
  // faction filter. Empty query = just the faction filter, unranked.
  function run() {
    if (_results) return _results;
    const toks = tokens();
    const fac = S.faction;
    const out = { unit: [], det: [], strat: [], rule: [], enh: [] };
    if (_idx) {
      for (let i = 0; i < _idx.recs.length; i++) {
        const r = _idx.recs[i];
        if (fac !== 'all' && r.factionName !== fac && !r.core) continue;
        if (toks.length) {
          let ok = true, prefix = false, inName = false;
          for (let t = 0; t < toks.length; t++) {
            if (r.hay.indexOf(toks[t]) === -1) { ok = false; break; }
            if (r.lname.startsWith(toks[t])) prefix = true;
            else if (r.lname.indexOf(toks[t]) !== -1) inName = true;
          }
          if (!ok) continue;
          r.score = prefix ? 0 : (inName ? 1 : 2);
        }
        out[r.kind].push(r);
      }
      if (toks.length) {
        KINDS.forEach(([k]) => out[k].sort((a, b) =>
          (a.score - b.score) || a.lname.localeCompare(b.lname) || a.factionName.localeCompare(b.factionName)));
      }
    }
    out.total = KINDS.reduce((n, [k]) => n + out[k].length, 0);
    _results = out;
    return out;
  }

  // ── results ───────────────────────────────────────────────────────────
  function rowFor(rec, compact) {
    const sel = !!(S.sel && S.sel.kind === rec.kind && S.sel.key === rec.key);
    let node;
    if (rec.kind === 'unit' && !compact && window.UI && UI.createUnitCard) {
      node = UI.createUnitCard(rec.ref, sel);
      node.classList.add('waha-unit-card');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
    } else {
      node = el('button', 'waha-row');
      node.type = 'button';
      const sub = [rec.kind === 'det' || rec.kind === 'unit' ? '' : rec.detName,
        rec.core ? 'Core' : shortFaction(rec.factionName)].filter(Boolean).join(' · ');
      node.innerHTML = '<span class="waha-row-glyph" aria-hidden="true">' + GLYPH[rec.kind] + '</span>'
        + '<span class="waha-row-main"><span class="waha-row-name">' + esc(rec.name) + '</span>'
        + '<span class="waha-row-sub">' + esc(sub) + '</span></span>'
        + '<span class="waha-row-line">' + esc(rec.line || '') + '</span>';
      if (sel) node.classList.add('is-sel');
    }
    node.dataset.wahaKind = rec.kind;
    node.dataset.wahaKey = rec.key;
    return node;
  }

  function groupEl(title, count, kind) {
    const g = el('section', 'waha-group');
    if (kind) g.dataset.kind = kind;
    const h = el('h3', 'waha-group-head');
    h.appendChild(document.createTextNode(title));
    if (count != null) h.appendChild(el('span', 'waha-group-n', String(count)));
    g.appendChild(h);
    const body = el('div', 'waha-group-body');
    g.appendChild(body);
    return { g, body, head: h };
  }
  function moreBtn(label, attr, value) {
    const b = el('button', 'waha-more', label);
    b.type = 'button';
    b.dataset[attr] = value;
    return b;
  }

  // Append `recs` (already ordered) into `body`, paged by S.limits[id]. When
  // `groupBy` is given, a subhead is emitted each time its value changes.
  function appendPaged(body, id, recs, groupBy, defLimit) {
    const limit = S.limits[id] || defLimit || PAGE;
    const shown = recs.slice(0, limit);
    let last = null;
    shown.forEach(r => {
      if (groupBy) {
        const gk = groupBy(r);
        if (gk !== last) { body.appendChild(el('h4', 'waha-subhead', gk)); last = gk; }
      }
      body.appendChild(rowFor(r));
    });
    if (recs.length > shown.length) {
      body.appendChild(moreBtn('Show more (' + (recs.length - shown.length) + ' left)', 'wahaMore', id));
    }
  }

  function sortedBy(recs, groupKey) {
    return recs.slice().sort((a, b) =>
      (groupKey(a).localeCompare(groupKey(b))) || a.lname.localeCompare(b.lname));
  }
  function unitSort(recs) {
    return recs.slice().sort((a, b) =>
      (roleRank(a.role) - roleRank(b.role)) || a.role.localeCompare(b.role) || a.lname.localeCompare(b.lname));
  }

  function renderResults() {
    const box = q('.waha-results');
    if (!box) return;
    const keepTop = box.scrollTop;
    box.replaceChildren();
    _hi = -1;
    if (!_idx) {
      box.appendChild(el('div', 'waha-loading', 'Loading the data…'));
      updateTabs(null);
      return;
    }
    const res = run();
    updateTabs(res);
    const toks = tokens();

    if (!toks.length) {
      if (S.tab === 'all') {
        if (S.faction === 'all') renderHome(box); else renderFactionView(box, res);
      } else {
        renderKindList(box, S.tab, res, false);
      }
    } else if (S.tab === 'all') {
      if (!res.total) { box.appendChild(emptyMsg()); }
      KINDS.forEach(([k, label]) => {
        const list = res[k];
        if (!list.length) return;
        const grp = groupEl(label, list.length, k);
        list.slice(0, TOP_N).forEach(r => grp.body.appendChild(rowFor(r)));
        if (list.length > TOP_N) {
          grp.body.appendChild(moreBtn('Show all ' + list.length, 'wahaShowall', k));
        }
        box.appendChild(grp.g);
      });
    } else {
      renderKindList(box, S.tab, res, true);
    }
    box.scrollTop = keepTop;
  }

  function emptyMsg() {
    const d = el('div', 'waha-empty');
    d.appendChild(el('p', 'waha-empty-title', 'No results'));
    d.appendChild(el('p', 'muted', S.q
      ? 'Nothing matches “' + S.q + '”' + (S.faction !== 'all' ? ' in this faction' : '') + '.'
      : 'Nothing here.'));
    return d;
  }

  // A single kind's full list (Datasheets / Detachments / … tab).
  function renderKindList(box, kind, res, ranked) {
    const list = res[kind];
    const label = (KINDS.find(k => k[0] === kind) || [0, ''])[1];
    if (!list.length) { box.appendChild(emptyMsg()); return; }
    const grp = groupEl(label, list.length, kind);
    box.appendChild(grp.g);
    const id = 'tab:' + kind;
    if (ranked) {
      appendPaged(grp.body, id, list, null);
    } else if (S.faction === 'all') {
      appendPaged(grp.body, id, sortedBy(list, r => shortFaction(r.factionName)),
        r => shortFaction(r.factionName));
    } else if (kind === 'unit') {
      appendPaged(grp.body, id, unitSort(list), r => roleLabel(r.role));
    } else if (kind === 'det') {
      appendPaged(grp.body, id, list.slice().sort((a, b) => a.lname.localeCompare(b.lname)), null);
    } else {
      appendPaged(grp.body, id, sortedBy(list, r => r.detName || (r.core ? 'Core' : 'Faction')),
        r => r.detName || (r.core ? 'Core' : 'Faction'));
    }
  }

  // Empty query, All factions: recently opened + the faction directory.
  function renderHome(box) {
    const recent = readRecent().map(e => _idx.byKey.get(recKey(e.kind, e.key))).filter(Boolean);
    if (recent.length) {
      const grp = groupEl('Recently opened', null, null);
      grp.g.classList.add('waha-recent');
      recent.forEach(r => grp.body.appendChild(rowFor(r, true)));
      box.appendChild(grp.g);
    }
    const dir = groupEl('Factions', _idx.factions.length, null);
    dir.g.classList.add('waha-directory');
    dir.body.classList.add('waha-tiles');
    _idx.factions.forEach(f => {
      const t = el('button', 'waha-tile');
      t.type = 'button';
      t.dataset.wahaFaction = f.name;
      const glyph = (App.factionGlyph && App.factionGlyph(f.name)) || '';
      t.innerHTML = '<span class="waha-tile-glyph" aria-hidden="true">' + glyph + '</span>'
        + '<span class="waha-tile-name">' + esc(f.short) + '</span>'
        + '<span class="waha-tile-n">' + (f.units ? f.units + ' datasheets' : f.dets + ' detachments') + '</span>';
      dir.body.appendChild(t);
    });
    box.appendChild(dir.g);
  }

  // Empty query, All tab, one faction: army rules, detachments, datasheets by role.
  function renderFactionView(box, res) {
    const f = _idx.factions.find(x => x.name === S.faction);
    const head = el('div', 'waha-faction-head');
    const glyph = (App.factionGlyph && App.factionGlyph(S.faction)) || '';
    head.innerHTML = '<span class="waha-tile-glyph" aria-hidden="true">' + glyph + '</span>'
      + '<span class="waha-faction-name">' + esc(f ? f.short : S.faction) + '</span>';
    const clear = el('button', 'waha-btn', 'All factions');
    clear.type = 'button';
    clear.dataset.wahaClearFaction = '1';
    head.appendChild(clear);
    box.appendChild(head);

    const rules = res.rule.filter(r => r.sub === 'army')
      .sort((a, b) => a.lname.localeCompare(b.lname));
    if (rules.length) {
      const g = groupEl('Army rules', rules.length, 'rule');
      rules.forEach(r => g.body.appendChild(rowFor(r)));
      box.appendChild(g.g);
    }
    if (res.det.length) {
      const g = groupEl('Detachments', res.det.length, 'det');
      res.det.slice().sort((a, b) => a.lname.localeCompare(b.lname))
        .forEach(r => g.body.appendChild(rowFor(r)));
      box.appendChild(g.g);
    }
    if (res.unit.length) {
      const g = groupEl('Datasheets', res.unit.length, 'unit');
      appendPaged(g.body, 'fac:unit', unitSort(res.unit), r => roleLabel(r.role));
      box.appendChild(g.g);
    }
    if (!rules.length && !res.det.length && !res.unit.length) box.appendChild(emptyMsg());
  }

  function updateTabs(res) {
    if (!_root) return;
    _root.querySelectorAll('.waha-tab').forEach(btn => {
      const k = btn.dataset.tab;
      const on = k === S.tab;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const n = btn.querySelector('.waha-tab-n');
      if (n) n.textContent = res ? String(k === 'all' ? res.total : res[k].length) : '';
    });
  }

  function markSelected() {
    const box = q('.waha-results');
    if (!box) return;
    box.querySelectorAll('[data-waha-kind]').forEach(n => {
      const on = !!(S.sel && n.dataset.wahaKind === S.sel.kind && n.dataset.wahaKey === S.sel.key);
      n.classList.toggle('is-sel', on);
      if (n.classList.contains('unit-card')) n.classList.toggle('selected', on);
    });
  }

  // ── reader ────────────────────────────────────────────────────────────
  function renderReader() {
    const reader = q('.waha-reader');
    if (!reader) return;
    reader.querySelectorAll('.waha-reader-body').forEach(n => n.remove());
    const body = el('div', 'waha-reader-body');
    reader.appendChild(body);
    const crumb = q('.waha-crumb');
    const rec = S.sel;
    if (!rec) {
      if (crumb) crumb.textContent = '';
      body.appendChild(el('div', 'waha-reader-empty', 'Search above, or pick a faction.'));
      return;
    }
    if (crumb) {
      crumb.textContent = rec.core ? 'Core stratagems'
        : [shortFaction(rec.factionName), rec.kind === 'det' ? rec.name : rec.detName].filter(Boolean).join(' › ');
    }
    if (rec.kind === 'unit') renderUnitReader(body, rec);
    else if (rec.kind === 'det') renderDetReader(body, rec);
    else renderRuleReader(body, rec);
    reader.scrollTop = 0;
  }

  function sheetHost(body) {
    const host = el('div', 'waha-sheet-host');
    body.appendChild(host);
    return host;
  }

  function renderUnitReader(body, rec) {
    const f = _idx.facByName.get(rec.factionName);
    const dets = ((f && f.detachments) || []).filter(d => d && d.name && (d.enhancements || []).length);
    if (!dets.some(d => d.name === S.enhDet)) S.enhDet = '';
    const host = sheetHost(body);
    const paint = () => {
      const det = dets.find(d => d.name === S.enhDet);
      if (window.UI && UI.renderUnitDetail) {
        UI.renderUnitDetail(rec.ref, det ? det.enhancements : [], [], { host, browseView: true });
      }
    };
    if (dets.length) {
      const row = el('div', 'waha-enh-for');
      const lab = el('label', 'waha-enh-label', 'Enhancements for:');
      lab.htmlFor = 'waha-enh-select';
      const sel = el('select', 'waha-enh-select');
      sel.id = 'waha-enh-select';
      [{ name: '', label: 'None' }].concat(dets.map(d => ({ name: d.name, label: d.name }))).forEach(c => {
        const o = el('option', null, c.label);
        o.value = c.name;
        sel.appendChild(o);
      });
      sel.value = S.enhDet;
      row.appendChild(lab);
      row.appendChild(sel);
      body.insertBefore(row, host);
      sel.addEventListener('change', () => { S.enhDet = sel.value; paint(); });
    }
    paint();
  }

  function renderDetReader(body, rec) {
    const host = sheetHost(body);
    if (window.UI && UI.renderDetachmentDetail) UI.renderDetachmentDetail(rec.ref, { host });
  }

  function renderRuleReader(body, rec) {
    // "from <detachment> · <faction>" — the detachment part opens its sheet.
    const from = el('div', 'waha-reader-from');
    from.appendChild(document.createTextNode('from '));
    if (rec.core) {
      from.appendChild(document.createTextNode('the core rules'));
    } else {
      if (rec.detName) {
        const b = el('button', 'waha-from-btn', rec.detName);
        b.type = 'button';
        b.dataset.wahaDet = rec.detName;
        b.dataset.wahaFaction = rec.factionName;
        from.appendChild(b);
        from.appendChild(document.createTextNode(' · '));
      }
      from.appendChild(document.createTextNode(shortFaction(rec.factionName)));
    }
    if (rec.kind === 'enh' && rec.ref.pts != null && rec.ref.pts !== '') {
      from.appendChild(document.createTextNode(' · ' + rec.ref.pts + ' pts'));
    }
    body.appendChild(from);

    const r = rec.ref;
    const data = {
      type: rec.kind === 'strat' ? 'stratagem' : rec.kind === 'enh' ? 'enhancement' : 'rule',
      name: rec.name, description: r.description,
    };
    if (rec.kind === 'strat') {
      data.cp = r.cp;
      data.phase = r.phase;
      data.phases = r.phases;
      if (rec.core) data.kindLabel = 'Core Stratagem';
    } else if (rec.kind === 'rule' && rec.sub === 'det') {
      data.kindLabel = 'Detachment Rule';
    }
    const host = sheetHost(body);
    if (window.UI && UI.renderRuleDetail) UI.renderRuleDetail(data, { host, gameView: true });
  }

  function openRec(rec, opts) {
    if (!rec) return;
    S.sel = rec;
    S.enhDet = '';
    if (!(opts && opts.noRecent)) pushRecent(rec);
    markSelected();
    renderReader();
    showReaderScreen();
  }
  function openUnitByName(name, preferFactionId) {
    if (!_idx) return;
    const list = _idx.unitsByName.get(String(name).toLowerCase()) || [];
    if (!list.length) return;
    openRec(list.find(r => r.factionId === preferFactionId) || list[0]);
  }
  function openDet(factionName, detName) {
    if (!_idx) return;
    for (let i = 0; i < _idx.recs.length; i++) {
      const r = _idx.recs[i];
      if (r.kind === 'det' && r.factionName === factionName && r.name === detName) { openRec(r); return; }
    }
  }

  // ── phone navigation: results screen <-> reader screen ────────────────
  let _resultsTop = 0;
  function showReaderScreen() {
    if (!_root || !isPhone()) return;
    if (_root.dataset.screen !== 'reader') {
      const box = q('.waha-results');
      _resultsTop = box ? box.scrollTop : 0;
    }
    _root.dataset.screen = 'reader';
    if (App.backTrap) App.backTrap.opened('waha:reader', leaveReaderScreen);
    const reader = q('.waha-reader');
    if (reader) reader.scrollTop = 0;
  }
  // Idempotent — also what hardware Back calls once the trap is popped.
  function leaveReaderScreen() {
    if (!_root || _root.dataset.screen !== 'reader') return;
    _root.dataset.screen = 'results';
    const box = q('.waha-results');
    if (box) box.scrollTop = _resultsTop;
  }
  function backFromReader() {
    if (App.backTrap && App.backTrap.isTrapped('waha:reader')) App.backTrap.closed('waha:reader');
    leaveReaderScreen();
  }

  // ── listing trap: one Back from a listing returns to the directory ────
  function inListing() { return !!S.q || S.faction !== 'all'; }
  function syncListingTrap() {
    if (!App.backTrap) return;
    const trapped = App.backTrap.isTrapped('waha:listing');
    if (inListing()) {
      if (!trapped) App.backTrap.opened('waha:listing', leaveListing);
    } else if (trapped) {
      App.backTrap.closed('waha:listing');
    }
  }
  // Idempotent — also what hardware Back calls once the trap is popped.
  function leaveListing() {
    if (!_root || !inListing()) return;
    S.q = '';
    S.faction = 'all';
    S.limits = {};
    _results = null;
    const box = q('#waha-q');
    if (box) box.value = '';
    const sel = q('#waha-faction');
    if (sel) sel.value = 'all';
    clearTimeout(_timer);
    renderResults();
    const res = q('.waha-results');
    if (res) res.scrollTop = 0;
  }

  // ── query / filter / tab / paging handlers ────────────────────────────
  function applyQuery() {
    clearTimeout(_timer);
    const box = q('#waha-q');
    S.q = box ? box.value.trim() : '';
    S.limits = {};
    _results = null;
    renderResults();
    syncListingTrap();
  }
  function setTab(tab) {
    if (!TABS.some(t => t[0] === tab)) return;
    S.tab = tab;
    S.limits = {};
    renderResults();
  }
  function setFaction(name) {
    S.faction = name || 'all';
    const sel = q('#waha-faction');
    if (sel) sel.value = S.faction;
    S.limits = {};
    _results = null;
    renderResults();
    const box = q('.waha-results');
    if (box) box.scrollTop = 0;
    syncListingTrap();
  }
  function visibleRows() {
    const box = q('.waha-results');
    return box ? Array.prototype.slice.call(box.querySelectorAll('[data-waha-kind]')) : [];
  }
  function highlight(delta) {
    const rows = visibleRows();
    if (!rows.length) return;
    const prev = rows[_hi];
    if (prev) prev.classList.remove('is-hi');
    _hi = Math.min(rows.length - 1, Math.max(0, (_hi === -1 ? (delta > 0 ? 0 : rows.length - 1) : _hi + delta)));
    const cur = rows[_hi];
    cur.classList.add('is-hi');
    try { cur.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  }
  function recFromNode(n) {
    if (!n || !_idx) return null;
    return _idx.byKey.get(recKey(n.dataset.wahaKind, n.dataset.wahaKey)) || null;
  }
  function openHighlightedOrFirst() {
    const rows = visibleRows();
    const n = rows[_hi] || rows[0];
    if (n) openRec(recFromNode(n));
  }

  // ── mount (skeleton, once) ────────────────────────────────────────────
  function ensureRoot() {
    const host = document.getElementById('waha-mode');
    if (!host) return null;
    host.querySelectorAll('.mode-placeholder').forEach(n => n.remove());
    let root = host.querySelector('.waha-root');
    if (!root) {
      root = document.createElement('div');
      root.className = 'waha-root';
      root.dataset.screen = 'results';
      root.innerHTML = ''
        + '<header class="waha-header">'
        +   '<div class="waha-wordmark">WAHA</div>'
        +   '<input type="search" id="waha-q" class="waha-q" autocomplete="off" spellcheck="false"'
        +     ' aria-label="Search" placeholder="Search any datasheet, detachment, stratagem, rule or enhancement…" />'
        +   '<select id="waha-faction" class="waha-faction" aria-label="Faction"><option value="all">All factions</option></select>'
        +   '<button type="button" class="waha-exit" id="waha-exit" title="Back to Build" aria-label="Back to Build">'
        +     '<span class="waha-exit-long">Back to Build</span><span class="waha-exit-short">Exit</span></button>'
        + '</header>'
        + '<nav class="waha-tabs" role="tablist" aria-label="What to show">'
        +   TABS.map(([id, label]) =>
              '<button type="button" class="waha-tab" role="tab" data-tab="' + id + '" aria-selected="'
              + (id === S.tab ? 'true' : 'false') + '">' + label + '<span class="waha-tab-n"></span></button>').join('')
        + '</nav>'
        + '<div class="waha-layout">'
        +   '<main class="waha-results" aria-label="Results"></main>'
        +   '<section class="waha-reader" aria-label="Reader">'
        +     '<div class="waha-reader-bar">'
        +       '<button type="button" class="waha-back">‹ Back</button>'
        +       '<span class="waha-crumb"></span>'
        +     '</div>'
        +   '</section>'
        + '</div>';
      host.appendChild(root);
      bindHandlers(root);
    }
    _root = root;
    return root;
  }

  function bindHandlers(root) {
    if (typeof window.matchMedia === 'function') {
      _mql = window.matchMedia('(max-width: 820px)');
    }
    const box = root.querySelector('#waha-q');
    box.addEventListener('input', () => {
      clearTimeout(_timer);
      _timer = setTimeout(applyQuery, DEBOUNCE_MS);
    });
    root.querySelector('#waha-faction').addEventListener('change', e => setFaction(e.target.value));
    root.querySelector('#waha-exit').addEventListener('click', () => {
      if (typeof App.setMode === 'function') App.setMode('build');
    });
    root.querySelector('.waha-tabs').addEventListener('click', e => {
      const t = e.target.closest('.waha-tab');
      if (t) setTab(t.dataset.tab);
    });
    root.querySelector('.waha-back').addEventListener('click', backFromReader);

    root.querySelector('.waha-results').addEventListener('click', e => {
      const more = e.target.closest('[data-waha-more]');
      if (more) { S.limits[more.dataset.wahaMore] = (S.limits[more.dataset.wahaMore] || PAGE) + PAGE; renderResults(); return; }
      const showAll = e.target.closest('[data-waha-showall]');
      if (showAll) { setTab(showAll.dataset.wahaShowall); return; }
      if (e.target.closest('[data-waha-clear-faction]')) { setFaction('all'); return; }
      const tile = e.target.closest('[data-waha-faction]');
      if (tile) { S.tab = 'all'; setFaction(tile.dataset.wahaFaction); return; }
      const row = e.target.closest('[data-waha-kind]');
      if (row) openRec(recFromNode(row));
    });

    // Reader: Led By / Leads names open that datasheet; the "from" detachment
    // button opens its sheet.
    root.querySelector('.waha-reader').addEventListener('click', e => {
      const u = e.target.closest('[data-waha-unit]');
      if (u) { openUnitByName(u.dataset.wahaUnit, S.sel && S.sel.factionId); return; }
      const d = e.target.closest('.waha-from-btn');
      if (d) openDet(d.dataset.wahaFaction, d.dataset.wahaDet);
    });

    // Unit cards are divs, not buttons: Enter/Space opens them.
    root.querySelector('.waha-results').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList &&
          e.target.classList.contains('waha-unit-card')) {
        e.preventDefault();
        openRec(recFromNode(e.target));
      }
    });

    // Keyboard shortcuts, only while Waha is the open page.
    document.addEventListener('keydown', e => {
      if (!isActive()) return;
      const t = e.target;
      const inField = !!(t && t.closest && t.closest('input, textarea, select, [contenteditable]'));
      if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        box.focus();
        box.select();
        return;
      }
      if (e.key === 'Escape') {
        if (box.value || S.q) {
          e.preventDefault();
          box.value = '';
          applyQuery();
          box.focus();
        } else if (isPhone() && _root.dataset.screen === 'reader') {
          e.preventDefault();
          backFromReader();
        }
        return;
      }
      if (e.key === 'Enter' && t === box) {
        if (box.value.trim() || S.q) {
          e.preventDefault();
          applyQuery();   // flush the debounce so Enter acts on what was typed
          openHighlightedOrFirst();
        }
        return;
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (!inField || t === box) &&
          !(isPhone() && _root.dataset.screen === 'reader')) {
        e.preventDefault();
        highlight(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  // ── activation ────────────────────────────────────────────────────────
  function renderAll() {
    ensureIndex();
    updateTabs(_idx ? run() : null);
    renderResults();
    renderReader();
  }

  function activate() {
    const root = ensureRoot();
    if (!root) return;
    _mounted = true;
    resetState();
    backFromReader();
    if (App.backTrap && App.backTrap.isTrapped('waha:listing')) App.backTrap.closed('waha:listing');
    root.dataset.screen = 'results';
    const box = q('#waha-q');
    if (box) box.value = '';
    const sel = q('#waha-faction');
    if (sel) sel.value = 'all';
    renderAll();
    startTick();
    if (box) { try { box.focus({ preventScroll: true }); } catch (_) { box.focus(); } }
  }

  function deactivate() {
    clearInterval(_tick);
    _tick = 0;
    clearTimeout(_timer);
    if (App.backTrap && App.backTrap.isTrapped('waha:reader')) {
      // Leaving the mode: mode-shell's own closed('mode:waha') rewinds the
      // trap stack, so just drop our flag.
      if (_root) _root.dataset.screen = 'results';
    }
  }

  // While open: pick up factions finishing their async load, and the GDC
  // stratagems arriving after them, without losing the user's query.
  function startTick() {
    clearInterval(_tick);
    _tick = setInterval(() => {
      if (!isActive()) return;
      if (!_idx && !factionsReady()) return;
      const was = _idx;
      if (ensureIndex()) {
        renderResults();
        if (S.sel && _idx) {
          const nr = _idx.byKey.get(recKey(S.sel.kind, S.sel.key));
          if (nr && (!was || nr.ref !== S.sel.ref)) { S.sel = nr; renderReader(); }
        }
      }
    }, 1000);
  }

  App.hooks.modeChange.push(mode => {
    if (mode === 'waha') activate(); else if (_mounted) deactivate();
  });

  // The Build Details pane's empty state gets a way in.
  App.hooks.bootstrap.push(function () {
    const empty = document.getElementById('unit-detail-empty');
    if (empty && !empty.querySelector('.waha-hint-btn')) {
      const b = el('button', 'waha-hint-btn', 'Just looking something up? Open Waha →');
      b.type = 'button';
      b.addEventListener('click', () => { if (typeof App.setMode === 'function') App.setMode('waha'); });
      empty.appendChild(b);
    }
    const host = document.getElementById('waha-mode');
    if (host && !host.hidden && host.classList.contains('mode-active')) activate();
  });

  // Desktop entry: a top-bar shelf button (TOPBAR_SHELF_IDS in js/app/index.js).
  // The Settings-drawer GO row covers phones.
  App.hooks.armyToolbarActions.push({
    id: 'btn-waha-mode',
    region: 'icon',
    glyph: '⌕',
    label: 'Waha',
    title: 'Waha — look anything up: any datasheet, detachment, stratagem or rule, any faction, without touching your army',
    onClick: function () { App.setMode('waha'); },
  });

  // Cmd/Ctrl+K entry (App.hooks.paletteCommands, yaab#105).
  if (!Array.isArray(App.hooks.paletteCommands)) App.hooks.paletteCommands = [];
  App.hooks.paletteCommands.push({
    id: 'mode-waha',
    label: 'Waha: look anything up',
    hint: 'Any datasheet, detachment, stratagem or rule, any faction',
    run: function () { App.setMode('waha'); },
  });

  App.wahaMode = { activate: activate };
})();
