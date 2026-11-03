// app/tts-export.js — "Send to Tabletop Simulator" (contract docs/TTS-EXPORT.md).
//
// Builds a Rosterizer `.regiztry` (a one-entry STORED zip around a JSON
// registry) shaped for Yellowscribe's bin/rosterizerParser.js, posts it through
// yaab-api (POST /api/export/tts — yellowscribe.link sends no CORS headers) and
// shows the 8-character code the Yellowscribe v2 TTS mod accepts.
//
//   App.TtsExport.buildRegistry(army, { unitsById?, factionName? }) -> object   PURE
//   App.TtsExport.buildZip(obj, entryName?)                          -> Uint8Array
//   App.TtsExport.send(army, opts?)   (opts.zip: a prebuilt zip)     -> Promise<{code}>
//   App.TtsExport.open(army)  — the menu flow: build, send, modal (or download)
//
// buildRegistry touches no DOM and no network so scripts/verify/tts-export.mjs
// can run it under node. Allocation of a loadout onto models:
//   - model types: wargearProfile.modelsBySize[size] → gdcComposition count
//     lines ("1 X model", "4-9 Y models") → one model named after the unit;
//   - defaults: "<subject> is equipped with: a; b; c." lines (composition, else
//     gdcLoadout) → else wargearProfile.defaultsBySize → else every weapon on
//     every model (a few datasheets carry no loadout at all). A loadout name
//     that matches no weapon row becomes a Wargear ability on that model;
//   - swaps: entry.wargear against wargearProfile.rules (legacy: .options),
//     applied per copy to `count` models of the rule's model type (or the most numerous type when
//     unconstrained), preferring models that still carry what is replaced and
//     have not been touched yet — so a Sergeant's two swaps stack on the one
//     Sergeant while three gauss reapers land on three different Warriors.
//     A split-off group is named "<type> w/ <gained>" when its type has more
//     than one group, so the TTS sheet tells the models apart.
(function () {
  const App = window.App = window.App || {};

  // ── small helpers ─────────────────────────────────────────────────────────
  const S = (v) => ({ processed: { format: { current: String(v == null || v === '' ? '-' : v) } } });
  // Plain text for TTS: drop markdown bold. (UI.mdPlain HTML-escapes, which
  // would put literal "&amp;" into the mod, so it is not used here.)
  const plain = (s) => String(s == null ? '' : s).replace(/\*\*/g, '').replace(/\r/g, '').trim();
  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // "Plasma Pistol – Standard" -> "Plasma Pistol"
  const baseName = (n) => String(n || '').split(/\s[–—]\s/)[0].trim();
  const cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const assets = () => ({ traits: [], included: [] });

  function abilityAsset(name, text, classification, keywords) {
    return {
      lineage: ['Ability'], classification: classification || 'Ability',
      designation: plain(name) || 'Ability', name: null, aspects: {},
      text: plain(text), keywords: { Keywords: keywords || [] }, assets: assets(),
    };
  }

  function weaponAsset(row, qty) {
    const melee = /melee/i.test(row._typeName || '') || /^melee$/i.test(String(row.Range || ''));
    const stats = { Range: S(melee ? 'Melee' : row.Range), A: S(row.A), S: S(row.S), AP: S(row.AP), D: S(row.D) };
    if (melee) stats.WS = S(row.WS || row.BS || 'N/A');
    else stats.BS = S(row.BS || row.WS || 'N/A');
    const kws = String(row.Keywords || '').split(/,\s*/).map((k) => k.trim()).filter((k) => k && k !== '-');
    const defs = row._keywordDefs || {};
    const traits = kws.map((k) => {
      const text = defs[k] != null ? defs[k] : (defs[k.replace(/\s+\S*\d\S*$/, '')] || '');
      return abilityAsset(k, text, 'Ability', []);
    });
    return {
      lineage: ['Weapon'], classIdentity: 'Weapon',
      classification: melee ? 'Melee Weapon' : 'Ranged Weapon',
      designation: row.name, name: null, aspects: {}, quantity: qty || 1, keywords: {},
      stats, assets: { traits, included: [] },
    };
  }

  // ── name resolution against unit.weapons ─────────────────────────────────
  function makeResolver(unit) {
    const rows = unit.weapons || [];
    const byBase = new Map();
    rows.forEach((r) => {
      const b = norm(baseName(r.name));
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(r);
    });
    // Option ids carry what names do not: replaces "close-combat-weapon" is
    // the default "Knives and Fists" (id close-combat-weapon-intercessor-squad).
    const stem = (id) => {
      id = String(id || '');
      const suf = '-' + (unit.id || '');
      return norm(unit.id && id.endsWith(suf) ? id.slice(0, -suf.length) : id);
    };
    const alias = new Map();
    const wp = unit.wargearProfile || {};
    Object.values(wp.defaultsBySize || {}).forEach((list) => (list || []).forEach((it) => {
      if (it && it.id && it.name) alias.set(stem(it.id), it.name);
    }));
    const lookup = (n) => {
      if (!n) return null;
      if (byBase.has(n)) return byBase.get(n);
      const exact = rows.filter((r) => norm(r.name) === n);
      return exact.length ? exact : null;
    };
    return function resolve(name, id) {
      const n = norm(name);
      let hit = lookup(n);
      if (!hit && id) { const a = alias.get(stem(id)); if (a) hit = lookup(norm(a)); }
      if (!hit && id) hit = lookup(stem(id));
      if (!hit) { // "astartes chainsword" -> "chainsword"
        const w = n.split(' ');
        for (let i = 1; i < w.length && !hit; i++) hit = lookup(w.slice(i).join(' '));
      }
      if (!hit) hit = n.endsWith('s') ? lookup(n.slice(0, -1)) : lookup(n + 's');
      if (!hit) { // longest weapon base contained either way
        let best = null;
        byBase.forEach((rs, b) => {
          if (b.length >= 4 && (n.includes(b) || b.includes(n)) && (!best || b.length > best[0].length)) best = [b, rs];
        });
        if (best) hit = best[1];
      }
      return hit
        ? { key: norm(baseName(hit[0].name)), label: baseName(hit[0].name), rows: hit }
        : { key: n, label: cap(plain(name)), rows: null };
    };
  }

  // ── squad size + model types ─────────────────────────────────────────────
  function squadSize(unit, entry) {
    const m = parseInt(String((entry && entry.squadLabel) || '').replace(/[^\d]/g, ''), 10);
    if (m > 0) return m;
    const opts = unit.squadOptions || [];
    const byPts = entry && opts.find((o) => o && o.pts === entry.selectedPts && o.models);
    if (byPts) return byPts.models;
    if (opts[0] && opts[0].models) return opts[0].models;
    return null;
  }

  function pickTier(bySize, size) {
    const sizes = Object.keys(bySize || {}).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    if (!sizes.length) return null;
    if (size != null && bySize[size]) return bySize[size];
    let pick = sizes[0];
    sizes.forEach((s) => { if (size != null && s <= size) pick = s; });
    return bySize[pick];
  }

  const COUNT_RE = /^[\s•·\-*]*(\d+)(?:\s*[-‐-―]\s*(\d+))?\s+(.+?)\s*$/;
  function compositionTypes(unit) {
    const out = [];
    (unit.gdcComposition || []).forEach((line) => {
      if (/equipped with/i.test(line)) return;
      const m = String(line).match(COUNT_RE);
      if (!m) return;
      const name = m[3].replace(/\s*[–—-]\s*EPIC HERO\s*$/i, '').replace(/\*+$/, '')
        .replace(/\s+models?$/i, '').trim();
      if (!name) return;
      out.push({ name, lo: +m[1], hi: m[2] ? +m[2] : +m[1] });
    });
    return out;
  }

  function modelTypes(unit, entry) {
    let size = squadSize(unit, entry);
    const wp = unit.wargearProfile || {};
    const tier = pickTier(wp.modelsBySize, size);
    if (tier && Object.keys(tier).length) {
      return Object.keys(tier).map((name) => ({ name, qty: tier[name] })).filter((t) => t.qty > 0);
    }
    const comp = compositionTypes(unit);
    if (comp.length) {
      const min = comp.reduce((s, t) => s + t.lo, 0);
      if (!size || size < min) size = min;
      const types = comp.map((t) => ({ name: t.name, qty: t.lo, room: t.hi - t.lo }));
      let rest = size - min;
      // Fixed counts first; the open range(s) take the remainder, widest first.
      types.slice().sort((a, b) => b.room - a.room).forEach((t) => {
        const add = Math.min(rest, t.room); t.qty += add; rest -= add;
      });
      return types.map((t) => ({ name: t.name, qty: t.qty })).filter((t) => t.qty > 0);
    }
    const single = (unit.modelStats || []).length === 1 ? unit.modelStats[0].name : unit.name;
    return [{ name: single || unit.name, qty: size || 1 }];
  }

  function statsFor(unit, typeName) {
    const rows = unit.modelStats || [];
    const t = norm(typeName);
    let row = rows.find((r) => norm(r.name) === t)
      || rows.find((r) => norm(r.name) && (t.includes(norm(r.name)) || norm(r.name).includes(t)))
      || rows[0] || unit.stats || {};
    const g = (k, alts) => { for (const a of [k].concat(alts || [])) if (row[a] != null && row[a] !== '') return row[a]; return '-'; };
    return {
      M: S(g('M')), T: S(g('T')), Sv: S(g('SV', ['Sv', 'sv'])), W: S(g('W')),
      Ld: S(g('LD', ['Ld'])), OC: S(g('OC')),
    };
  }

  // Which model types a subject ("Every model", "The Intercessor Sergeant",
  // "Every Nob") names.
  function typesForSubject(subject, groups) {
    const s = norm(subject);
    if (/^(every|each|all|this|these|the)\s+models?$/.test(s) || s === 'models') return groups;
    const core = s.replace(/^(the|every|each|all|\d+)\s+/, '').replace(/\s+models?$/, '');
    const eq = groups.filter((g) => {
      const n = norm(g.type);
      return n === core || n === core + 's' || n + 's' === core;
    });
    if (eq.length) return eq;
    const part = groups.filter((g) => { const n = norm(g.type); return n.startsWith(core) || core.startsWith(n); });
    if (part.length) return part;
    if (groups.length === 1) return groups;
    // Best word overlap; nothing in common → every model.
    const words = new Set(core.split(' '));
    let best = [], bestN = 0;
    groups.forEach((g) => {
      const n = norm(g.type).split(' ').filter((w) => words.has(w)).length;
      if (n > bestN) { best = [g]; bestN = n; } else if (n && n === bestN) best.push(g);
    });
    return best.length ? best : groups;
  }

  function equipLines(unit) {
    const split = (l) => String(l || '').split(/(?<=\.)\s+(?=[A-Z])/);
    let lines = [];
    (unit.gdcComposition || []).forEach((l) => split(l).forEach((x) => { if (/equipped with\s*:/i.test(x)) lines.push(x); }));
    if (!lines.length && unit.gdcLoadout) split(unit.gdcLoadout).forEach((x) => { if (/equipped with\s*:/i.test(x)) lines.push(x); });
    return lines.map((l) => {
      const m = l.match(/^\s*(.*?)\s+(?:is|are)\s+equipped\s+with\s*:\s*(.*?)\s*\.?\s*$/i);
      if (!m) return null;
      const items = m[2].split(/\s*;\s*/).map((it) => {
        it = it.replace(/\.$/, '').trim();
        const q = it.match(/^(\d+)\s+(.+)$/);
        return q ? { qty: +q[1], name: q[2] } : { qty: 1, name: it };
      }).filter((it) => it.name && !/^(nothing|none|-)$/i.test(it.name));
      return { subject: m[1], items };
    }).filter(Boolean);
  }

  function addItem(group, item, qty) {
    const have = group.items.find((i) => i.key === item.key);
    if (have) have.qty += qty;
    else group.items.push({ key: item.key, label: item.label, rows: item.rows, qty });
  }

  // Same disambiguation as wargear-picker.js effReplaces (legacy options only).
  function effReplaces(opt, grp) {
    const r = opt.replaces || [];
    if (r.length <= 1) return r;
    if (opt.andSwap) return r;
    if (grp && grp.length > 1) return r;
    return [r[0]];
  }

  // Picker selections name a rule id (wargearProfile.rules, docs/WARGEAR-
  // RULES.md) or, on an older dataset, a 40kdc option id. Both resolve to
  // { model, choices, removes(ci) }: parsed rules remove exactly `replaces`
  // (nothing for kind "add"); legacy options go through effReplaces. Kept
  // local (not App.WargearPicker) so buildRegistry stays runnable under node.
  function ruleIndex(wp) {
    const m = new Map();
    if (Array.isArray(wp.rules)) {
      wp.rules.forEach((r) => {
        if (!r || r.id == null) return;
        m.set(r.id, { model: r.model || null, choices: r.choices || [],
          removes: () => (r.kind === 'add' ? [] : (r.replaces || [])) });
      });
    } else {
      (wp.options || []).forEach((o) => {
        if (!o || o.id == null) return;
        m.set(o.id, { model: (o.constraint && o.constraint.model_name) || null, choices: o.choices || [],
          removes: (ci) => effReplaces(o, (o.choices || [])[ci]) });
      });
    }
    return m;
  }

  function applySwap(groups, typeMatch, replKeys, adds, n) {
    let pool = groups.filter((g) => typeMatch(g.type));
    if (!pool.length) {
      const top = groups.slice().sort((a, b) => b.qty - a.qty)[0];
      pool = top ? groups.filter((g) => g.type === top.type) : [];
    }
    const holds = (g) => !replKeys.length || replKeys.some((k) => g.items.some((i) => i.key === k));
    const ordered = pool.slice().sort((a, b) =>
      (holds(b) - holds(a)) || ((a.gained.length === 0 ? 0 : 1) - (b.gained.length === 0 ? 0 : 1)) || (b.qty - a.qty));
    let left = n;
    for (const g of ordered) {
      if (left <= 0) break;
      const k = Math.min(left, g.qty);
      let target = g;
      if (k < g.qty) {
        target = {
          type: g.type, qty: k, gained: g.gained.slice(),
          items: g.items.map((i) => Object.assign({}, i)),
        };
        g.qty -= k;
        groups.splice(groups.indexOf(g) + 1, 0, target);
      }
      target.items = target.items.filter((i) => !replKeys.includes(i.key));
      adds.forEach((a) => {
        addItem(target, a.item, a.qty);
        if (!target.gained.includes(a.item.label)) target.gained.push(a.item.label);
      });
      left -= k;
    }
  }

  // Which model types a rule's take may land on: its named model, else the
  // types that carry what it replaces, else the most numerous type.
  function typeMatcher(groups, model, replKeys) {
    if (model) {
      const hits = typesForSubject('The ' + model, groups).map((g) => g.type);
      return (t) => hits.includes(t);
    }
    const carriers = groups.filter((g) => replKeys.length && replKeys.some((k) => g.items.some((i) => i.key === k)));
    const pool = carriers.length ? carriers : groups;
    const byType = new Map();
    pool.forEach((g) => byType.set(g.type, (byType.get(g.type) || 0) + g.qty));
    let top = null;
    byType.forEach((q, t) => { if (!top || q > top[1]) top = [t, q]; });
    const types2 = carriers.length ? Array.from(byType.keys()) : (top ? [top[0]] : []);
    return (t) => types2.includes(t);
  }

  // Inventory v2 (docs/WARGEAR-RULES.md §5): entry.loadout is the squad's
  // whole inventory. The default allocation is already on the models; the
  // difference (items above / below default) is placed per model block:
  // an extra goes to the model type its rule names, swapping out one of the
  // items that rule replaces while any is still surplus to the loadout; the
  // single-model blocks (Champion, Sergeant) are served first; extras with
  // no slot to fill (add-ons, over-limit picks) go onto further models in
  // order; defaults lowered with nothing replacing them are taken off last.
  function allocateLoadout(groups, loadout, rulesById, resolve) {
    const have = new Map();
    groups.forEach((g) => g.items.forEach((i) => have.set(i.key, (have.get(i.key) || 0) + i.qty * g.qty)));
    const want = new Map();
    loadout.forEach((x) => {
      if (!x || !x.count) return;
      const r = resolve(x.name, x.id);
      const w = want.get(r.key);
      if (w) w.qty += x.count; else want.set(r.key, { item: r, qty: x.count });
    });
    const surplus = new Map();   // default key -> how many to take off
    have.forEach((q, k) => { const w = want.get(k); const d = q - (w ? w.qty : 0); if (d > 0) surplus.set(k, d); });
    const extras = [];
    want.forEach((w, k) => { const d = w.qty - (have.get(k) || 0); if (d > 0) extras.push({ key: k, item: w.item, qty: d }); });
    // Rules offering each extra (by resolved key), in rule order.
    const offers = (key) => {
      const out = [];
      rulesById.forEach((r) => (r.choices || []).forEach((g, ci) => {
        if ((g || []).some((x) => resolve(x.name, x.id).key === key)) out.push({ r, ci });
      }));
      return out;
    };
    const typeQty = (model) => {
      if (!model) return Infinity;
      const hits = typesForSubject('The ' + model, groups).map((g) => g.type);
      return groups.filter((g) => hits.includes(g.type)).reduce((s, g) => s + g.qty, 0);
    };
    extras.forEach((e) => {
      e.offers = offers(e.key);
      e.order = e.offers.length ? Math.min.apply(null, e.offers.map((o) => typeQty(o.r.model))) : Infinity;
    });
    extras.sort((a, b) => a.order - b.order);
    extras.forEach((e) => {
      let left = e.qty;
      e.offers.forEach((o) => {
        if (left <= 0) return;
        o.r.removes(o.ci).map((x) => resolve(x.name, x.id).key).forEach((rk) => {
          const k = Math.min(left, surplus.get(rk) || 0);
          if (k <= 0) return;
          applySwap(groups, typeMatcher(groups, o.r.model, [rk]), [rk], [{ item: e.item, qty: 1 }], k);
          surplus.set(rk, surplus.get(rk) - k);
          left -= k;
        });
      });
      if (left > 0) {
        const model = e.offers.length ? e.offers[0].r.model : null;
        applySwap(groups, typeMatcher(groups, model, []), [], [{ item: e.item, qty: 1 }], left);
      }
    });
    surplus.forEach((k, rk) => {
      if (k > 0) applySwap(groups, typeMatcher(groups, null, [rk]), [rk], [], k);
    });
    // Merge identical blocks that one-at-a-time placement split apart.
    for (let i = 0; i < groups.length; i++) {
      const sig = (g) => g.type + '|' + g.items.map((x) => x.key + 'x' + x.qty).sort().join(',');
      for (let j = groups.length - 1; j > i; j--) {
        if (sig(groups[j]) === sig(groups[i])) { groups[i].qty += groups[j].qty; groups.splice(j, 1); }
      }
    }
  }

  // ── one army entry → one unitAsset (per copy) ────────────────────────────
  function buildUnitAsset(unit, entry, factionName) {
    const resolve = makeResolver(unit);
    const wp = unit.wargearProfile || {};
    const types = modelTypes(unit, entry);
    const groups = types.map((t) => ({ type: t.name, qty: t.qty, items: [], gained: [] }));
    const total = groups.reduce((s, g) => s + g.qty, 0);

    // Default loadout.
    const lines = equipLines(unit);
    if (lines.length) {
      lines.forEach((ln) => {
        const targets = typesForSubject(ln.subject, groups);
        ln.items.forEach((it) => {
          const r = resolve(it.name);
          targets.forEach((g) => addItem(g, r, it.qty));
        });
      });
    } else if (pickTier(wp.defaultsBySize, total)) {
      pickTier(wp.defaultsBySize, total).forEach((it) => {
        const r = resolve(it.name, it.id);
        if ((it.count || 0) >= total) groups.forEach((g) => addItem(g, r, 1));
        else applySwap(groups, () => false, [], [{ item: r, qty: 1 }], it.count || 1);
      });
    } else {
      // No loadout data at all (a handful of datasheets): every model gets
      // every weapon, so the sheet in TTS is complete rather than empty.
      const seen = new Set();
      (unit.weapons || []).forEach((row) => {
        const r = resolve(baseName(row.name));
        if (seen.has(r.key)) return;
        seen.add(r.key);
        groups.forEach((g) => addItem(g, r, 1));
      });
    }

    const rulesById = ruleIndex(wp);
    if (Array.isArray(entry.loadout) && entry.loadout.length && groups.length > 1
        && entry.loadout.every((x) => !x || !x.count || x.model)) {
      // §6: every row names its model type — place each block's rows on that
      // type's models only (the allocation runs within the block).
      const parts = [];
      const byType = new Map();
      groups.forEach((g) => { if (!byType.has(g.type)) byType.set(g.type, []); byType.get(g.type).push(g); });
      const fold = (t) => norm(t).replace(/ models?$/, '').replace(/s$/, '');
      byType.forEach((sub, type) => {
        const rows = entry.loadout.filter((x) => x && x.count && fold(x.model) === fold(type));
        allocateLoadout(sub, rows, rulesById, resolve);
        parts.push(...sub);
      });
      // Rows naming a type the composition does not have: onto the largest.
      const known = new Set(Array.from(byType.keys()).map(fold));
      const stray = entry.loadout.filter((x) => x && x.count && !known.has(fold(x.model)));
      groups.length = 0;
      parts.forEach((g) => groups.push(g));
      if (stray.length) {
        const top = groups.slice().sort((a, b) => b.qty - a.qty)[0];
        stray.forEach((x) => { if (top) addItem(top, resolve(x.name, x.id), x.count); });
      }
    } else if (Array.isArray(entry.loadout)) allocateLoadout(groups, entry.loadout, rulesById, resolve);
    // Swaps from the picker (entries saved before inventory v2).
    else (entry.wargear || []).forEach((sel) => {
      const n = Math.max(0, parseInt(sel && sel.count, 10) || 0);
      if (!n) return;
      const opt = rulesById.get(sel.optionId);
      const grp = opt && Array.isArray(opt.choices) ? opt.choices[sel.choice] : null;
      const addObjs = grp && grp.length ? grp : (sel.items || []).map((nm) => ({ name: nm }));
      const adds = [];
      addObjs.forEach((x) => {
        const r = resolve(x.name, x.id);
        const have = adds.find((a) => a.item.key === r.key);
        if (have) have.qty += 1; else adds.push({ item: r, qty: 1 });
      });
      const repl = opt ? opt.removes(sel.choice).map((x) => resolve(x.name, x.id).key) : [];
      const mn = opt && opt.model;
      let typeMatch;
      if (mn) {
        const hits = typesForSubject('The ' + mn, groups).map((g) => g.type);
        typeMatch = (t) => hits.includes(t);
      } else {
        // Unconstrained: the rank and file (most numerous type) — unless a
        // type actually carries what is being replaced.
        const carriers = groups.filter((g) => repl.length && repl.some((k) => g.items.some((i) => i.key === k)));
        const pool = carriers.length ? carriers : groups;
        const byType = new Map();
        pool.forEach((g) => byType.set(g.type, (byType.get(g.type) || 0) + g.qty));
        let top = null;
        byType.forEach((q, t) => { if (!top || q > top[1]) top = [t, q]; });
        const types2 = carriers.length ? Array.from(byType.keys()) : (top ? [top[0]] : []);
        typeMatch = (t) => types2.includes(t);
      }
      applySwap(groups, typeMatch, repl, adds, n);
    });

    // Wargear abilities: on the model carrying the matching item; otherwise
    // unit-level unless it is an option nobody took.
    const wgAbilities = (unit.wargearAbilities || []).filter((a) => a && a.name);
    const optionItemKeys = new Set();
    rulesById.forEach((o) => (o.choices || []).forEach((g) => (g || []).forEach((x) => optionItemKeys.add(norm(x.name)))));
    const usedWg = new Set();

    const typeCount = new Map();
    groups.forEach((g) => typeCount.set(g.type, (typeCount.get(g.type) || 0) + 1));

    const modelAssets = groups.filter((g) => g.qty > 0).map((g, gi) => {
      const traits = [];
      g.items.forEach((it) => {
        if (it.rows) {
          it.rows.forEach((row) => traits.push(weaponAsset(row, it.qty)));
        } else {
          const wa = wgAbilities.find((a) => norm(a.name) === it.key || norm(a.name).includes(it.key) || it.key.includes(norm(a.name)));
          if (wa) usedWg.add(wa);
          traits.push(abilityAsset(wa ? wa.name : it.label, wa ? wa.description : it.label, 'Wargear', []));
        }
      });
      if (gi === 0) {
        (entry.enhancements || []).forEach((e) => {
          if (e && e.name) traits.push(abilityAsset(e.name, e.description || '', 'Enhancement', []));
        });
      }
      const label = (typeCount.get(g.type) > 1 && g.gained.length) ? `${g.type} w/ ${g.gained.join(', ')}` : g.type;
      return {
        lineage: ['Model'], classification: 'Model', designation: label, name: null, aspects: {},
        quantity: g.qty, keywords: {}, stats: statsFor(unit, g.type),
        assets: { traits, included: [] },
      };
    });

    const unitTraits = modelAssets.slice();
    (unit.abilities || []).forEach((a) => {
      if (!a || !a.name) return;
      unitTraits.push(abilityAsset(a.name, a.description || '', 'Ability', a.isCore ? ['Core'] : []));
    });
    if (unit.invulnSave) {
      let t = `This model has a ${unit.invulnSave} invulnerable save.`;
      if (unit.invulnNote) t += ' ' + plain(unit.invulnNote);
      unitTraits.push(abilityAsset('Invulnerable Save', t, 'Ability', []));
    }
    wgAbilities.forEach((a) => {
      if (usedWg.has(a) || optionItemKeys.has(norm(a.name))) return;
      unitTraits.push(abilityAsset(a.name, a.description || '', 'Wargear', []));
    });

    // Keywords: faction = the short faction name + any faction-name segment
    // the unit carries ("Imperium", "Adeptus Astartes"); the rest are keywords.
    const segs = String(factionName || '').split(' - ').map((s) => s.trim()).filter(Boolean);
    const short = segs.length ? segs[segs.length - 1] : '';
    const segKeys = new Set(segs.map(norm));
    const kws = (unit.keywords || []).filter(Boolean).map(String);
    const faction = [];
    if (short) faction.push(short);
    kws.forEach((k) => { if (segKeys.has(norm(k)) && !faction.some((f) => norm(f) === norm(k))) faction.push(k); });
    const other = kws.filter((k) => !faction.some((f) => norm(f) === norm(k)));

    return {
      lineage: ['Unit'], designation: unit.name,
      name: entry.customName ? String(entry.customName) : null,
      aspects: {}, classification: 'Unit',
      keywords: { Faction: faction, Keywords: other },
      assets: { traits: unitTraits, included: [] },
    };
  }

  function buildRegistry(army, opts) {
    opts = opts || {};
    const included = [];
    const errors = [];
    ((army && army.entries) || []).forEach((entry) => {
      if (!entry) return;
      const unit = (opts.unitsById && opts.unitsById[entry.unitId]) || entry.unitData;
      if (!unit || !unit.name) {
        errors.push({ name: entry.unitName || entry.unitId || 'Unit', message: 'no datasheet data; left out' });
        return;
      }
      const fac = unit._factionName || opts.factionName || '';
      const copies = Math.max(1, parseInt(entry.count, 10) || 1);
      for (let i = 0; i < copies; i++) included.push(buildUnitAsset(unit, entry, fac));
    });
    return { assets: { traits: [], included }, errors };
  }

  // ── STORED zip (one entry) ───────────────────────────────────────────────
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(obj, entryName) {
    const name = new TextEncoder().encode(entryName || 'roster.regiztry.json');
    const data = new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj));
    const crc = crc32(data);
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const out = new Uint8Array(30 + name.length + data.length + 46 + name.length + 22);
    const v = new DataView(out.buffer);
    let p = 0;
    const u32 = (x) => { v.setUint32(p, x >>> 0, true); p += 4; };
    const u16 = (x) => { v.setUint16(p, x & 0xFFFF, true); p += 2; };
    // local file header
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(crc); u32(data.length); u32(data.length); u16(name.length); u16(0);
    out.set(name, p); p += name.length;
    out.set(data, p); p += data.length;
    // central directory
    const cdStart = p;
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(crc); u32(data.length); u32(data.length); u16(name.length); u16(0); u16(0);
    u16(0); u16(0); u32(0); u32(0);
    out.set(name, p); p += name.length;
    const cdSize = p - cdStart;
    // end of central directory
    u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  // ── network + UI ─────────────────────────────────────────────────────────
  const ENDPOINT = '/api/export/tts';
  const fileBase = (army) => (String((army && army.name) || 'army').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'army').slice(0, 60);

  async function send(army, opts) {
    const zip = (opts && opts.zip) || buildZip(buildRegistry(army, opts));
    let resp;
    try {
      resp = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Roster-Name': fileBase(army) + '.regiztry' },
        body: zip,
      });
    } catch (_) {
      const e = new Error('Network error: could not reach yaab'); e.status = 0; e.zip = zip; throw e;
    }
    let body = null;
    try { body = await resp.json(); } catch (_) {}
    if (resp.ok && body && body.code) return { code: String(body.code), zip };
    let msg;
    if (resp.status === 401) msg = 'Sign in to send armies to Tabletop Simulator';
    else if (resp.status === 429) msg = 'Too many sends; wait a minute and try again';
    else if (resp.status === 502 || (body && body.error === 'yellowscribe_unavailable')) msg = 'Yellowscribe is unavailable right now';
    else msg = `Send failed (${resp.status})`;
    const e = new Error(msg); e.status = resp.status; e.zip = zip; throw e;
  }

  const $ = (id) => document.getElementById(id);
  let lastZip = null, lastName = 'army', wired = false;

  function hide() { const m = $('modal-tts'); if (m) m.setAttribute('hidden', ''); }
  function setState(state, info) {
    const sending = $('tts-sending'), result = $('tts-result'), failed = $('tts-failed');
    if (sending) sending.hidden = state !== 'sending';
    if (result) result.hidden = state !== 'ok';
    if (failed) failed.hidden = state !== 'failed';
    const copy = $('btn-tts-copy'), dl = $('btn-tts-download');
    if (copy) copy.hidden = state !== 'ok';
    if (dl) dl.hidden = state !== 'failed';
    if (state === 'ok' && $('tts-code')) $('tts-code').textContent = info;
    if (state === 'failed' && $('tts-failed-reason')) $('tts-failed-reason').textContent = info;
  }
  function download() {
    if (!lastZip) return;
    const blob = new Blob([lastZip], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = lastName + '.regiztry';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function wire() {
    if (wired || !$('modal-tts')) return;
    wired = true;
    $('modal-tts-close').addEventListener('click', hide);
    $('btn-tts-done').addEventListener('click', hide);
    $('modal-tts').addEventListener('click', (e) => { if (e.target === e.currentTarget) hide(); });
    $('modal-tts').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
    $('btn-tts-download').addEventListener('click', download);
    $('btn-tts-copy').addEventListener('click', async () => {
      const code = ($('tts-code') || {}).textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        if (window.UI && UI.toast) UI.toast('Code copied', 'success');
      } catch (_) {
        const r = document.createRange(); r.selectNodeContents($('tts-code'));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        if (window.UI && UI.toast) UI.toast('Select-and-copy the code', 'info');
      }
    });
  }

  async function open(army) {
    const toast = (m, t, ms) => { if (window.UI && UI.toast) UI.toast(m, t, ms); };
    if (!army || !(army.entries || []).length) { toast('Add some units first', 'info'); return; }
    wire();
    lastName = fileBase(army);
    try { lastZip = buildZip(buildRegistry(army)); } catch (err) {
      toast('Could not build the Tabletop Simulator file: ' + err.message, 'error', 5000); return;
    }
    const m = $('modal-tts');
    setState('sending');
    if (m) m.removeAttribute('hidden');
    try {
      const { code } = await send(army, { zip: lastZip });
      setState('ok', code);
      setTimeout(() => { const b = $('btn-tts-copy'); if (b) b.focus(); }, 50);
    } catch (err) {
      toast(err.message, 'error', 5000);
      setState('failed', err.message + '.');
      setTimeout(() => { const b = $('btn-tts-download'); if (b) b.focus(); }, 50);
    }
  }

  App.TtsExport = { buildRegistry, buildZip, send, open, _internal: { crc32, modelTypes, equipLines, makeResolver } };
})();
