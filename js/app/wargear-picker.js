// app/wargear-picker.js — the Wargear inventory in the unit details pane.
//
// Inventory v2 (owner decision 2026-11-03, contract docs/WARGEAR-RULES.md §5):
// a FULL inventory of the squad's guns. Every row — default items included —
// has a − N + stepper; nothing is ever capped or disabled (floor at 0). The
// datasheet rules (`wargearProfile.rules`, or the legacy 40kdc `options[]`
// mapped onto the same shape by rulesOf()) only produce WARNINGS, listed
// under the inventory and as a "wargear" badge on the army entry:
//
//   slot      a default item plus the swaps that replace it ≠ the models
//             that carry it ("Boltgun: 13 weapons for 10 models …")
//   cap       more of an option than its rules allow at this size
//   requires  an add-on that needs (or locks) an item more models lack
//   exclusive rules joined by exclusiveWith taken more than once per model
//
// Per-model-type blocks (§6): one block per model type at this size
// (modelsBySize order, heading "Plague Champion · 1"); each lists that
// type's defaults (defaultsByModel × count) and the items its rules offer
// (model-less rules offer in every block). Rows and warnings are per block;
// loadout rows carry `model` on multi-type units.
//
// Storage: entry.loadout = [{ id, name, count, model? }] (defaults with their counts,
// extras, zeros omitted) via army.setLoadout(); entry.wargear is no longer
// written. A new pick starts from the defaults at the chosen size; changing
// size on an unsaved pick resets to that size's defaults; changing size on a
// saved entry keeps the counts. Points: Army.loadoutPts (alwaysCost +
// Σ itemCosts × count), which equals the old priced-default base when the
// loadout is untouched.
(function () {
  const App = window.App = window.App || {};

  // Pending inventory for the viewed unit: item key -> { id, name, count }.
  let unitId = null;
  let inv = null;
  let invSize = null;   // squad size the pending inventory was built for
  let panelEl = null;
  // Army entry being EDITED, or null when configuring a not-yet-added unit.
  let entryIndex = null;

  // `entryIndex` can go stale when an EARLIER entry is removed (#71): resolve
  // the live index from state; entryIndex only gates entry-bound mode.
  function liveEntryIndex() {
    return (entryIndex != null) ? (App.state || {}).selectedArmyEntryIndex : null;
  }

  function currentEntry() {
    const s = App.state || {};
    const idx = liveEntryIndex();
    if (idx == null || !s.currentArmy) return null;
    return s.currentArmy.entries[idx] || null;
  }

  function syncEntry(unit) {
    const s = App.state || {};
    if (!currentEntry()) return;
    const lo = App.WargearPicker.takeSelections(unit);
    if (typeof s.currentArmy.setLoadout === 'function') s.currentArmy.setLoadout(liveEntryIndex(), lo);
    if (s.armyManager) s.armyManager.saveArmy(s.currentArmy);
    if (window.UI && UI.renderArmyList) UI.renderArmyList(s.currentArmy);
  }

  const esc = (s) => ((window.UI && UI.escapeHtml) ? UI.escapeHtml(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const names = (grp) => (grp || []).map((x) => x.name).join(' + ');
  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .replace(/\s*\([^)]*\)/g, '').replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const sing = (s) => s.replace(/\s+models?$/, '').replace(/s$/, '');
  const itemCountOf = (x) => (x && Number.isFinite(x.count) && x.count > 1 ? x.count : 1);

  // ── squad size / tiers ───────────────────────────────────────────────────
  function currentModels(unit) {
    const opts = unit.squadOptions || [];
    const sel = document.getElementById('detail-squad-select');
    const opt = sel ? opts[parseInt(sel.value, 10)] : opts[0];
    return (opt && opt.models) || (opts[0] && opts[0].models) || null;
  }

  // Exact tier, else nearest below, else the smallest.
  function pickTier(bySize, models) {
    if (!bySize) return null;
    if (models != null && bySize[models]) return bySize[models];
    const sizes = Object.keys(bySize).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    if (!sizes.length) return null;
    let pick = sizes[0];
    sizes.forEach((s) => { if (models != null && s <= models) pick = s; });
    return bySize[pick] || null;
  }

  // Priced default loadout cost at a squad size — same tier pick as army.js
  // getEntryWargearBasePts so the banner preview and the added entry agree.
  function defaultBasePts(profile, models) {
    const bySize = profile.defaultCostBySize;
    if (!bySize) return 0;
    const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
    if (!sizes.length) return 0;
    let pick = sizes[0];
    sizes.forEach((s) => { if (models != null && s <= models) pick = s; });
    return bySize[pick] || 0;
  }

  const defaultsFor = (profile, models) => pickTier(profile.defaultsBySize, models) || [];

  // ── rules (with the legacy options[] adapter) ────────────────────────────
  // What a LEGACY 40kdc option actually takes off the squad: its `replaces`
  // can list the model's whole prior loadout even when only one item is
  // given up. One item → that; multi-item pick or hand-confirmed andSwap →
  // all of them (AND); otherwise the FIRST listed item (OR).
  const effReplaces = (opt, grp) => {
    const r = opt.replaces || [];
    if (r.length <= 1) return r;
    if (opt.andSwap) return r;
    if (grp && grp.length > 1) return r;
    return [r[0]];
  };

  const legacyCache = new WeakMap();
  // profile.rules when present, else options[] mapped onto the rule shape:
  // named model + any number → every model of that type; "for every N" →
  // 1 per N; "any number" → every model; otherwise 1. Caps now apply to the
  // rule as a whole (Σ of its choices) rather than to each choice.
  function rulesOf(profile) {
    if (!profile) return [];
    if (Array.isArray(profile.rules)) return profile.rules;
    if (legacyCache.has(profile)) return legacyCache.get(profile);
    const out = (profile.options || []).filter(Boolean).map((o) => {
      const c = o.constraint || {};
      const r = {
        id: o.id, text: '', kind: (o.replaces || []).length ? 'replace' : 'add',
        model: c.model_name || null, scope: 'fixed', n: null, max: 1,
        replaces: o.replaces || [], choices: o.choices || [],
        requires: [], locks: [], exclusiveWith: [], condition: null,
        cost: o.cost || 0, _legacy: o,
      };
      if (c.per_n_models) { r.scope = 'per_n'; r.n = c.per_n_models; r.max = 1; }
      else if (c.any_number) { r.scope = 'any'; r.max = null; }
      else if (c.model_name) { r.scope = 'fixed'; r.max = null; }
      return r;
    });
    legacyCache.set(profile, out);
    return out;
  }

  // Items a take of rule choice `ci` removes from the model. Parsed rules
  // say exactly (AND); legacy options go through effReplaces.
  function removesOf(rule, ci) {
    if (!rule || rule.kind === 'add') return [];
    if (rule._legacy) return effReplaces(rule._legacy, (rule.choices || [])[ci]);
    return rule.replaces || [];
  }

  // NET points delta of one take: priced items gained minus priced items
  // given up, plus any per-rule surcharge.
  function costOf(profile, rule, ci) {
    const ic = profile && profile.itemCosts;
    let d = (rule && rule.cost) || 0;
    if (!ic || !rule) return d;
    ((rule.choices || [])[ci] || []).forEach((x) => { d += ic[x.id] || 0; });
    removesOf(rule, ci).forEach((x) => { d -= ic[x.id] || 0; });
    return d;
  }

  // ── engine context at one squad size ─────────────────────────────────────
  function makeCtx(unit, models) {
    const profile = (unit && unit.wargearProfile) || {};
    const rules = rulesOf(profile);
    const row = pickTier(profile.modelsBySize, models) || {};
    const rowSum = Object.keys(row).reduce((s, k) => s + (row[k] || 0), 0);
    const size = models || rowSum || 1;
    const modelKeys = Object.keys(row);

    // Count of a model type at this size; null model = the whole unit. An
    // unknown name (prose and composition disagree) falls back to the unit.
    const countCache = new Map();
    function countOf(model) {
      if (!model) return size;
      if (countCache.has(model)) return countCache.get(model);
      const want = norm(model), ws = sing(want);
      let k = modelKeys.find((m) => norm(m) === want)
        || modelKeys.find((m) => sing(norm(m)) === ws);
      if (!k && modelKeys.length === 1) k = modelKeys[0];
      const n = k ? (row[k] || 0) : size;
      countCache.set(model, n);
      return n;
    }

    // Item identity: matched to a default-loadout row by name or by id stem
    // (40kdc suffixes ids with the unit id), else an unknown item keyed by
    // its name. Unknown items are never availability-checked.
    const defaults = defaultsFor(profile, size);
    const suf = '-' + ((unit && unit.id) || '');
    const stem = (id) => { id = String(id || ''); return norm(unit && unit.id && id.endsWith(suf) ? id.slice(0, -suf.length) : id); };
    const dIndex = new Map();
    defaults.forEach((d, i) => {
      [norm(d.name), sing(norm(d.name)), stem(d.id)].forEach((k) => { if (k && !dIndex.has(k)) dIndex.set(k, i); });
    });
    const itemName = new Map();
    function keyOf(x) {
      if (!x) return 'x:';
      const n = norm(x.name);
      let i = dIndex.get(n);
      if (i == null) i = dIndex.get(sing(n));
      if (i == null && x.id) i = dIndex.get(stem(x.id));
      const k = (i != null) ? 'd:' + i : 'x:' + n;
      if (!itemName.has(k)) itemName.set(k, i != null ? defaults[i].name : x.name);
      return k;
    }
    const defaultCount = (k) => (k.startsWith('d:') ? (defaults[+k.slice(2)].count || 0) : 0);

    // Optional schema fields (docs/DATASET.md §wargearProfile) are read
    // defensively: anything missing or malformed means "no such limit".
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    const visible = (r) => {
      const c = r.condition || {};
      if (num(c.minModels) && size < c.minModels) return false;
      if (num(c.maxModels) && size > c.maxModels) return false;
      return true;
    };
    // How many of the replaced item ONE model may swap under an "any" rule:
    // a model carrying k of it ("2 shuriken cannons", "3 dark lances") may
    // swap each of them ("each shuriken cannon it is equipped with", "any
    // number of this model's dark lances can each be replaced") — so k —
    // unless the text says "one of their/its …" (Talos macro-scalpels). Only
    // 1-for-1 swaps: a "their 2 heavy bolters → 2 flamers" group already
    // carries its own count.
    const perModelCache = new Map();
    function perModelOf(r) {
      if (!r || r.kind !== 'replace' || r.scope !== 'any' || (r.replaces || []).length !== 1) return 1;
      if (perModelCache.has(r.id)) return perModelCache.get(r.id);
      let k = 1;
      const single = (r.choices || []).every((g) => (g || []).length === 1 && itemCountOf(g[0]) === 1);
      if (single && !/\bone of (?:their|its|this model|the model)/i.test(r.text || '')) {
        const want = norm(r.replaces[0].name), ws = sing(want);
        const byModel = profile.defaultsByModel || {};
        const types = Object.keys(byModel).filter((t) => !r.model || norm(t) === norm(r.model) || sing(norm(t)) === sing(norm(r.model)));
        types.forEach((t) => (byModel[t] || []).forEach((d) => {
          const dn = norm(d.name);
          if ((dn === want || sing(dn) === ws) && Number.isFinite(d.count) && d.count > k) k = d.count;
        }));
      }
      perModelCache.set(r.id, k);
      return k;
    }
    function capOf(r) {
      let c;
      if (r.scope === 'per_n') {
        const base = r.nModel ? countOf(r.nModel) : size;   // "For every 5 Inquisitorial Agents"
        c = Math.floor(base / (num(r.n) || 1)) * (r.max == null ? 1 : r.max);
      } else if (r.scope === 'any') c = countOf(r.model) * perModelOf(r);
      else c = r.max == null ? countOf(r.model) : r.max;
      return c * (num(r.picks) || 1);                        // "up to two of the following"
    }
    // Unit-wide limit on one choice ("once per unit unless it contains 20
    // models, in which case twice"), or null.
    function choiceCapOf(r) {
      if (!num(r.choiceMax)) return null;
      return r.choiceMax * (num(r.choiceMaxN) ? Math.floor(size / r.choiceMaxN) || 1 : 1);
    }

    // exclusiveWith → connected sets (union-find over rule ids).
    const parent = new Map();
    const find = (a) => { while (parent.has(a) && parent.get(a) !== a) a = parent.get(a); return a; };
    rules.forEach((r) => parent.set(r.id, r.id));
    rules.forEach((r) => (r.exclusiveWith || []).forEach((o) => {
      if (!parent.has(o)) return;
      const a = find(r.id), b = find(o);
      if (a !== b) parent.set(b, a);
    }));
    const exclSets = new Map();
    rules.forEach((r) => {
      const root = find(r.id);
      if (!exclSets.has(root)) exclSets.set(root, []);
      exclSets.get(root).push(r);
    });

    return { unit, profile, rules, size, countOf, defaults, keyOf, defaultCount, itemName, visible, capOf, choiceCapOf, perModelOf, exclSets };
  }


  // ── inventory helpers ────────────────────────────────────────────────────
  // Per-model-type blocks (docs/WARGEAR-RULES.md §6): the inventory is keyed
  // by (model type, item). Single-type units have one block with model null
  // and their rows carry no `model`, exactly as before.
  const A = () => window.Army;
  const priceOf = (unit, it) => ((A() && A().itemPrice) ? A().itemPrice(unit, it) : 0);
  const kebab = (s) => (A() ? A()._kebab(s) : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const foldType = (t) => sing(norm(t));
  const plural = (m, n) => (n > 1 && !/s$/i.test(m) ? m + 's' : m);
  const ik = (model, key) => (model || '') + '|' + key;

  // Blocks at the context's size: [{ model, label, count, defaults:[{key,id,name,count}] }]
  function blocksOf(ctx) {
    if (ctx._blocks) return ctx._blocks;
    const types = A() ? A().modelTypes(ctx.unit, ctx.size) : [{ name: null, count: ctx.size }];
    const multi = types.length > 1;
    const defs = A() ? A().defaultLoadout(ctx.unit, ctx.size) : ctx.defaults;
    ctx._blocks = types.map((t) => ({
      model: multi ? t.name : null,
      label: t.name || '',
      count: t.count,
      defaults: defs.filter((d) => (multi ? d.model === t.name : true))
        .map((d) => ({ key: ctx.keyOf(d), id: String(d.id || ''), name: d.name, count: d.count || 0 })),
    }));
    // Shared words dropped for badges: "Plague Champion" → "Champion".
    if (multi) {
      const words = ctx._blocks.map((b) => b.label.split(/\s+/));
      let k = 0;
      while (words.every((w) => w.length > k + 1 && w[k] === words[0][k])) k++;
      ctx._blocks.forEach((b, i) => { b.short = words[i].slice(k).join(' '); });
    }
    return ctx._blocks;
  }
  const multiOf = (ctx) => blocksOf(ctx).length > 1;
  // The block a rule names (null-model rules offer in every block). A model
  // name that matches no block goes to the largest one.
  function ruleBlock(ctx, r) {
    const blocks = blocksOf(ctx);
    if (blocks.length < 2 || !r.model) return null;
    const f = foldType(r.model);
    const hit = blocks.find((b) => foldType(b.label) === f)
      || blocks.find((b) => foldType(b.label).startsWith(f) || f.startsWith(foldType(b.label)));
    if (hit) return hit.model;
    return blocks.slice().sort((a, b) => b.count - a.count)[0].model;
  }
  const inBlock = (ctx, r, blk) => { const m = ruleBlock(ctx, r); return m == null || m === blk.model; };
  function blockByName(ctx, name) {
    const f = foldType(name);
    return blocksOf(ctx).find((b) => foldType(b.label) === f) || null;
  }

  function defaultInv(ctx) {
    const m = new Map();
    blocksOf(ctx).forEach((b) => b.defaults.forEach((d) => {
      if (d.count > 0) m.set(ik(b.model, d.key), { id: d.id || kebab(d.name), name: d.name, count: d.count, model: b.model });
    }));
    return m;
  }
  function bumpInv(ctx, m, model, x, n) {
    const k = ik(model, ctx.keyOf(x));
    const have = m.get(k);
    if (have) have.count += n;
    else m.set(k, { id: String(x.id || '') || kebab(x.name), name: x.name, count: n, model });
  }

  // A loadout whose rows lack `model` on a multi-type unit (saved before §6)
  // → per-block rows: defaults go to each type up to its default count,
  // smallest type first; extras go to the type whose rules offer the item
  // (the larger type when several do); anything else to the largest type.
  function migrateFlat(ctx, flat) {
    const blocks = blocksOf(ctx);
    const m = new Map();
    const pool = new Map();   // item key -> { x, n }
    (flat || []).forEach((x) => {
      if (!x || !x.count) return;
      const k = ctx.keyOf(x);
      const p = pool.get(k);
      if (p) p.n += x.count; else pool.set(k, { x, n: x.count });
    });
    const asc = blocks.slice().sort((a, b) => a.count - b.count);
    asc.forEach((b) => b.defaults.forEach((d) => {
      const p = pool.get(d.key);
      if (!p || !p.n) return;
      const n = Math.min(p.n, d.count);
      bumpInv(ctx, m, b.model, p.x, n);
      p.n -= n;
    }));
    const largest = blocks.slice().sort((a, b) => b.count - a.count)[0];
    pool.forEach((p, k) => {
      if (!p.n) return;
      const offering = blocks.filter((b) => ctx.rules.some((r) => inBlock(ctx, r, b)
        && (r.choices || []).some((g) => (g || []).some((x) => ctx.keyOf(x) === k))));
      const to = offering.length ? offering.sort((a, b) => b.count - a.count)[0] : largest;
      bumpInv(ctx, m, to.model, p.x, p.n);
    });
    return m;
  }

  function invFromLoadout(ctx, loadout) {
    const multi = multiOf(ctx);
    const rows = (loadout || []).filter((x) => x && x.count);
    if (multi && rows.some((x) => !x.model || !blockByName(ctx, x.model))) {
      // Mixed: rows that name a block keep it, the rest are migrated.
      const keep = rows.filter((x) => x.model && blockByName(ctx, x.model));
      if (!keep.length) return migrateFlat(ctx, rows);
      const m = migrateFlat(ctx, rows.filter((x) => !(x.model && blockByName(ctx, x.model))));
      keep.forEach((x) => bumpInv(ctx, m, blockByName(ctx, x.model).model, x, x.count));
      return m;
    }
    const m = new Map();
    rows.forEach((x) => bumpInv(ctx, m, multi ? blockByName(ctx, x.model).model : null, x, x.count));
    return m;
  }
  const invToLoadout = (m) => Array.from(m.values()).filter((x) => x.count > 0)
    .map((x) => { const r = { id: x.id, name: x.name, count: x.count }; if (x.model) r.model = x.model; return r; });

  // Old selection rows (entry.wargear, rule or 40kdc option ids) → the full
  // inventory: defaults − replaced + added, each take in the block its rule
  // names (a model-less rule: the largest block still carrying what it
  // replaces). A row whose id no longer resolves still adds its items.
  function loadoutFromWargear(unit, models, wargear) {
    const ctx = makeCtx(unit, models);
    const blocks = blocksOf(ctx);
    const m = defaultInv(ctx);
    const largest = blocks.slice().sort((a, b) => b.count - a.count)[0];
    (wargear || []).forEach((w) => {
      if (!w || !w.count) return;
      const rule = ctx.rules.find((r) => r.id === w.optionId);
      const ci = w.choice == null ? 0 : w.choice;
      const grp = rule && (rule.choices || [])[ci];
      if (grp) {
        let model = ruleBlock(ctx, rule);
        if (model == null && blocks.length > 1) {
          const rm = removesOf(rule, ci).map((x) => ctx.keyOf(x));
          const carry = blocks.filter((b) => rm.some((k) => ((m.get(ik(b.model, k)) || {}).count || 0) > 0));
          model = (carry.length ? carry.sort((a, b) => b.count - a.count)[0] : largest).model;
        }
        removesOf(rule, ci).forEach((x) => bumpInv(ctx, m, model, x, -w.count));
        grp.forEach((x) => bumpInv(ctx, m, model, x, w.count * (Number.isFinite(x.count) && x.count > 1 ? x.count : 1)));
      } else {
        (w.items || []).forEach((nm) => bumpInv(ctx, m, largest.model, { id: '', name: nm }, w.count));
      }
    });
    m.forEach((x) => { if (x.count < 0) x.count = 0; });
    return invToLoadout(m);
  }

  // Rows per block: the block's defaults, then every item a rule offering in
  // this block hands out (deduplicated), then anything else the block holds.
  function rowsFor(ctx, m) {
    return blocksOf(ctx).map((b) => {
      const rows = [], seen = new Map();
      b.defaults.forEach((d) => {
        const r = { key: ik(b.model, d.key), item: d.key, id: d.id, name: d.name, def: d.count, rules: [], block: b };
        rows.push(r); seen.set(d.key, r);
      });
      ctx.rules.forEach((rule) => {
        if (!inBlock(ctx, rule, b)) return;
        (rule.choices || []).forEach((grp) => (grp || []).forEach((x) => {
          const k = ctx.keyOf(x);
          let r = seen.get(k);
          // A rule whose condition is unmet at this size ("If this unit
          // contains 10 models") offers no new row; an item already held
          // keeps its row and its rule, so the cap warning still names it.
          if (!r && !ctx.visible(rule) && !((m.get(ik(b.model, k)) || {}).count)) return;
          if (!r) { r = { key: ik(b.model, k), item: k, id: String(x.id || ''), name: x.name, def: 0, rules: [], block: b }; rows.push(r); seen.set(k, r); }
          if (r.rules.indexOf(rule) === -1) r.rules.push(rule);
        }));
      });
      m.forEach((x, key) => {
        if ((x.model || null) !== b.model) return;
        const k = key.slice(key.indexOf('|') + 1);
        if (seen.has(k)) return;
        const r = { key, item: k, id: x.id, name: x.name, def: 0, rules: [], block: b };
        rows.push(r); seen.set(k, r);
      });
      return { block: b, rows };
    });
  }

  // "only at 10 models" / "10+ models" for a rule whose size condition is unmet.
  function condPhrase(r) {
    const c = r.condition || {};
    const lo = Number.isFinite(c.minModels) ? c.minModels : null, hi = Number.isFinite(c.maxModels) ? c.maxModels : null;
    if (lo != null && lo === hi) return `only with ${lo} models`;
    if (lo != null && hi != null) return `only with ${lo}–${hi} models`;
    if (lo != null) return `only with ${lo}+ models`;
    if (hi != null) return `only with up to ${hi} models`;
    return 'not at this size';
  }
  function capText(ctx, r) {
    const c = ctx.capOf(r);
    if (r.scope === 'per_n') return (r.max == null || r.max === 1) ? `1 per ${r.n}` : `up to ${r.max} per ${r.n}`;
    if (r.scope === 'any') return (c <= 1 && ctx.perModelOf(r) <= 1) ? '1 only' : 'any';
    if (r.max == null) return c <= 1 ? '1 only' : `up to ${c}`;
    return r.max === 1 ? '1 only' : `up to ${r.max}`;
  }
  function capPhrase(ctx, r) {
    if (!ctx.visible(r)) return condPhrase(r);
    if (r.scope === 'per_n') return (r.max == null || r.max === 1) ? `1 per ${r.n} models` : `up to ${r.max} per ${r.n} models`;
    const k = ctx.perModelOf(r);
    if (k > 1) return r.model ? `up to ${k} per ${r.model}` : `up to ${k} per model`;
    if (r.scope === 'any' || r.max == null) return r.model ? `one per ${r.model}` : 'one per model';
    return r.max === 1 ? '1 only' : `up to ${r.max}`;
  }
  const article = (name) => {
    const n = String(name || '').toLowerCase();
    if (/s$/.test(n)) return n;
    return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
  };
  const itemCount = itemCountOf;

  // ── warnings (§5, per block §6) ──────────────────────────────────────────
  function warnings(ctx, m) {
    const out = [];
    const multi = multiOf(ctx);
    const blockRows = rowsFor(ctx, m);
    // A rule's cap is unit-wide (per_n reads the unit size; a named type
    // reads that type's count; a model-less "any" reads the unit), shared
    // over every block that offers it.
    const left = new Map(ctx.rules.map((r) => [r.id, ctx.visible(r) ? ctx.capOf(r) : 0]));

    blockRows.forEach(({ block: b, rows }) => {
      const pre = multi ? `${plural(b.label, b.count)}: ` : '';
      const cnt = (k) => ((m.get(ik(b.model, k)) || {}).count || 0);
      const defOf = (k) => { const d = b.defaults.find((x) => x.key === k); return d ? d.count : 0; };
      const extras = (k) => Math.max(0, cnt(k) - defOf(k));
      const nameOf = (k) => { const r = rows.find((x) => x.item === k); return r ? r.name : (ctx.itemName.get(k) || k.replace(/^x:/, '')); };
      const rules = ctx.rules.filter((r) => inBlock(ctx, r, b));

      // 1. Slot.
      const targets = new Map(), flexible = new Set();
      rules.forEach((rule) => (rule.choices || []).forEach((grp, ci) => {
        const rm = removesOf(rule, ci).map((x) => ctx.keyOf(x)).filter((k) => defOf(k) > 0);
        (grp || []).forEach((x) => {
          const k = ctx.keyOf(x);
          if (!targets.has(k)) targets.set(k, new Set());
          if (rule.kind === 'add' || !rm.length) { flexible.add(k); return; }
          if ((grp || []).length > 1 || itemCount(x) > 1) flexible.add(k);
          rm.forEach((d) => targets.get(k).add(d));
        });
      }));
      targets.forEach((set, k) => { if (set.size > 1) flexible.add(k); });
      b.defaults.forEach((d) => {
        let excl = 0, shared = 0;
        targets.forEach((set, k) => {
          if (!set.has(d.key) || k === d.key) return;
          if (flexible.has(k)) shared += extras(k); else excl += extras(k);
        });
        // A default that is ALSO what another default swaps into (Crisis
        // Fireknife: plasma rifle ⇄ missile pod, so 2 plasma rifles a model
        // is legal; Baneblade: twin heavy flamers → twin heavy bolters next
        // to its own) — its extras sit in that other default's slot and are
        // counted there, so its own slot holds at most its default count.
        const swappedIn = Array.from((targets.get(d.key) || [])).some((o) => o !== d.key);
        const have = cnt(d.key), own = swappedIn ? Math.min(have, d.count) : have;
        const lo = own + excl, hi = lo + shared;
        if (lo <= d.count && hi >= d.count) return;
        const swaps = lo > d.count ? excl : excl + shared;
        if (multi) {
          out.push(`${pre}${cap(d.name)} ${own} and swaps ${swaps} for ${d.count} model${d.count === 1 ? '' : 's'}`);
        } else if (lo > d.count) {
          out.push(`${cap(d.name)}: ${lo} weapons for ${d.count} models — lower the ${String(d.name).toLowerCase()} count when you add swaps`);
        } else {
          out.push(`${cap(d.name)}: only ${hi} for ${d.count} models`);
        }
      });

      // 2. Cap. One take of a multi-item choice ("2 synaptic obliterators and
      // 2 transdimensional projectors") gains every item in it, so the takes
      // charged to a choice group by one of its items cover the others.
      const grpUsed = new Map();
      rows.forEach((row) => {
        if (!row.rules.length) return;
        const taken = extras(row.item);
        if (!taken) return;
        let rest = taken;
        row.rules.forEach((r) => {
          const gi = (r.choices || []).findIndex((g) => (g || []).some((x) => ctx.keyOf(x) === row.item));
          const grp = (r.choices || [])[gi] || [];
          const mult = Math.max(1, grp.filter((x) => ctx.keyOf(x) === row.item).reduce((n, x) => n + itemCount(x), 0));
          const gk = r.id + '#' + gi, prior = grpUsed.get(gk) || 0;
          const can = Math.min(rest, ((left.get(r.id) || 0) + prior) * mult);
          const takes = Math.ceil(can / mult);
          left.set(r.id, (left.get(r.id) || 0) - Math.max(0, takes - prior));
          grpUsed.set(gk, Math.max(prior, takes));
          rest -= can;
        });
        const sep = multi ? ' ' : ': ';
        if (rest > 0) {
          out.push(`${pre}${cap(row.name)}${sep}${taken} taken, the datasheet allows up to ${taken - rest} (${capPhrase(ctx, row.rules[0])})`);
          return;
        }
        // A per-unit limit on one choice binds only when every rule offering
        // the item has one: Legionaries' "any number … Astartes chainsword"
        // is unlimited even though the 1-per-5 special list caps it there.
        let lim = 0;
        row.rules.forEach((r) => { const c = ctx.choiceCapOf(r); lim = (c == null || lim == null) ? null : lim + c; });
        if (lim != null && taken > lim) out.push(`${pre}${cap(row.name)}${sep}${taken} taken, the datasheet allows ${lim} per unit`);
      });

      // 3. Requires / locks, within the block.
      rules.forEach((rule) => {
        const need = new Map();
        (rule.requires || []).concat(rule.locks || []).forEach((x) => need.set(ctx.keyOf(x), x));
        if (!need.size) return;
        const gained = new Set();
        (rule.choices || []).forEach((g) => (g || []).forEach((x) => gained.add(ctx.keyOf(x))));
        gained.forEach((g) => {
          const n = extras(g);
          if (!n) return;
          need.forEach((x, k) => {
            if (n > cnt(k)) out.push(`${pre}${cap(nameOf(g))} needs a model that still carries ${article(nameOf(k) || x.name)}`);
          });
        });
      });

      // 4. Exclusive: one rule of an exclusiveWith set per model of the block.
      ctx.exclSets.forEach((set) => {
        const inb = set.filter((r) => inBlock(ctx, r, b));
        if (inb.length < 2) return;
        const keys = new Set();
        inb.forEach((r) => (r.choices || []).forEach((g) => (g || []).forEach((x) => keys.add(ctx.keyOf(x)))));
        let sum = 0;
        keys.forEach((k) => { sum += extras(k); });
        if (sum > b.count) out.push(`${pre}${Array.from(keys).map((k) => cap(nameOf(k))).join(', ')}: only one of these per model`);
      });
    });
    return Array.from(new Set(out));
  }

  const ptsChip = (d) => (d ? ` <span class="wgp-pts">${d > 0 ? '+' : '−'}${Math.abs(d)} pts</span>` : '');

  function focusedStepperBtn(host) {
    const btn = document.activeElement;
    if (!btn || !host.contains(btn) || !btn.classList || !btn.classList.contains('wgp-btn')) return null;
    const stepper = btn.closest('.wgp-stepper');
    if (!stepper) return null;
    return { key: stepper.dataset.key, plus: btn.classList.contains('wgp-plus') };
  }
  function restoreStepperFocus(host, ref) {
    if (!ref) return;
    let stepper = null;
    host.querySelectorAll('.wgp-stepper').forEach((s) => {
      if (!stepper && s.dataset.key === ref.key) stepper = s;
    });
    const btn = stepper && stepper.querySelector(ref.plus ? '.wgp-plus' : '.wgp-minus');
    if (btn) btn.focus();
  }

  function render(unit, host) {
    const profile = unit.wargearProfile;
    const models = currentModels(unit);
    const ctx = makeCtx(unit, models);
    const refocus = focusedStepperBtn(host);
    const blocks = rowsFor(ctx, inv);
    const multi = blocks.length > 1;

    const wgLive = A() && A().loadoutPts ? A().loadoutPts(unit, invToLoadout(inv)) : 0;
    const anyRows = blocks.some((b) => b.rows.length);
    const anyPriced = blocks.some((b) => b.rows.some((r) => priceOf(unit, r)));
    if (!anyRows) {
      host.innerHTML = '';
      updateBannerPts(unit, wgLive);
      return;
    }

    const rowHtml = (r) => {
      const n = (inv.get(r.key) || {}).count || 0;
      const hint = r.def ? 'default' : (r.rules.length ? capText(ctx, r.rules[0]) : '');
      const hintChip = hint ? ` <span class="wgp-chip">${esc(hint)}</span>` : '';
      const title = r.rules.map((x) => x.text).filter(Boolean).join('\n');
      const t = title ? ` title="${esc(title)}"` : '';
      const who = multi ? ` (${r.block.label})` : '';
      return `<div class="wgp-row${r.def ? ' wgp-row-default' : ''}"><span class="wgp-item"${t}>${esc(cap(r.name))}${ptsChip(priceOf(unit, r))}${hintChip}</span>`
        + `<span class="wgp-stepper" data-key="${esc(r.key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one ${esc(r.name)}${esc(who)}">&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one ${esc(r.name)}${esc(who)}">+</button>
          </span></div>`;
    };
    let html = '<div class="wgp-inv">';
    blocks.forEach(({ block: b, rows }) => {
      if (!multi) { html += rows.map(rowHtml).join(''); return; }
      html += `<div class="wgp-group wgp-block" data-model="${esc(b.label)}">`
        + `<div class="wgp-group-title">${esc(plural(b.label, b.count))} · ${b.count}</div>`
        + rows.map(rowHtml).join('') + '</div>';
    });
    html += '</div>';
    const warn = warnings(ctx, inv);
    if (warn.length) {
      html += '<div class="validation-banner wgp-warnings" role="status" style="margin:var(--sp-3) 0 0">'
        + '<div class="validation-banner-title">Wargear check</div><ul class="validation-banner-list">'
        + warn.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
    }
    const unparsed = Array.isArray(profile.unparsed) ? profile.unparsed.filter(Boolean) : [];
    if (unparsed.length) {
      html += '<div class="wgp-unparsed" style="margin-top:var(--sp-2);font-size:var(--fs-2xs);color:var(--text-muted)">'
        + 'Not checked: ' + unparsed.map((l) => esc(l)).join(' · ') + '</div>';
    }
    if (anyPriced || wgLive) html += `<div class="wgp-note wgp-total">Wargear points: +${wgLive} pts</div>`;
    host.innerHTML = html;
    restoreStepperFocus(host, refocus);
    updateBannerPts(unit, wgLive);
  }

  function updateBannerPts(unit, wgLive) {
    if (!panelEl) return;
    const el = panelEl.querySelector('.detail-banner-pts.detail-pts-value');
    if (!el || !el.firstChild || el.firstChild.nodeType !== 3) return;
    const opts = unit.squadOptions || [];
    const sel = panelEl.querySelector('#detail-squad-select');
    const idx = sel ? (parseInt(sel.value, 10) || 0) : 0;
    const base = (opts[idx] && opts[idx].pts != null) ? opts[idx].pts
      : (opts[0] && opts[0].pts != null) ? opts[0].pts : (unit.points || 0);
    el.firstChild.nodeValue =
      el.firstChild.nodeValue.replace(/^\d+/, String(base + wgLive));
  }

  // The inventory an entry holds, as per-block rows: its loadout (migrated
  // when rows lack `model`), else its old selection rows, else defaults.
  function entryLoadout(unit, entry) {
    const models = A() && A().entryModels ? A().entryModels(entry) : null;
    if (Array.isArray(entry.loadout)) return invToLoadout(invFromLoadout(makeCtx(unit, models), entry.loadout));
    if (Array.isArray(entry.wargear) && entry.wargear.length) return loadoutFromWargear(unit, models, entry.wargear);
    return invToLoadout(defaultInv(makeCtx(unit, models)));
  }
  // True when a saved loadout needs the §6 migration (multi-type unit, a row
  // without a usable `model`).
  function needsModel(unit, models, loadout) {
    if (!Array.isArray(loadout) || !loadout.length) return false;
    const ctx = makeCtx(unit, models);
    return multiOf(ctx) && loadout.some((x) => x && x.count && !(x.model && blockByName(ctx, x.model)));
  }

  App.WargearPicker = {
    mount(unit, panel) {
      const host = panel.querySelector('#detail-wargear-picker');
      if (!host || !unit || !unit.wargearProfile) return;
      panelEl = panel;
      const s = App.state || {};
      const selEntry = (s.selectedArmyEntryIndex != null && s.currentArmy)
        ? s.currentArmy.entries[s.selectedArmyEntryIndex] : null;
      const ei = (selEntry && selEntry.unitId === unit.id) ? s.selectedArmyEntryIndex : null;
      const entry0 = (ei != null) ? selEntry : null;
      if (entry0) {
        const sel = panel.querySelector('#detail-squad-select');
        const opts = unit.squadOptions || [];
        const idx = opts.findIndex((o) => o.pts === entry0.selectedPts);
        if (sel && idx >= 0 && String(idx) !== sel.value) {
          sel.value = String(idx);
          const label = panel.querySelector('#detail-size-label');
          if (label && opts[idx]) {
            label.textContent = opts[idx].models
              ? `${opts[idx].models} models — ${opts[idx].pts} pts` : `${opts[idx].pts} pts`;
          }
        }
      }
      const models = currentModels(unit);
      if (unit.id !== unitId || ei !== entryIndex || !inv) {
        unitId = unit.id;
        entryIndex = ei;
        const ctx = makeCtx(unit, models);
        inv = entry0 ? invFromLoadout(ctx, entryLoadout(unit, entry0)) : defaultInv(ctx);
        invSize = models;
      } else if (!entry0 && models !== invSize) {
        inv = defaultInv(makeCtx(unit, models));
        invSize = models;
      }
      render(unit, host);

      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.wgp-btn');
        if (!btn) return;
        const stepper = btn.closest('.wgp-stepper');
        if (!stepper || !stepper.dataset.key) return;
        const key = stepper.dataset.key;
        let item = inv.get(key);
        if (!item) {
          const ctx = makeCtx(unit, currentModels(unit));
          let row = null;
          rowsFor(ctx, inv).forEach((b) => b.rows.forEach((r) => { if (r.key === key) row = r; }));
          if (!row) return;
          item = { id: row.id || kebab(row.name), name: row.name, count: 0, model: row.block.model };
          inv.set(key, item);
        }
        if (btn.classList.contains('wgp-plus')) item.count += 1;
        else if (item.count > 0) item.count -= 1;
        else return;
        render(unit, host);
        syncEntry(unit);
      });
      const sizeSel = panel.querySelector('#detail-squad-select');
      if (sizeSel && !sizeSel._wgpWired) {
        sizeSel._wgpWired = true;
        sizeSel.addEventListener('change', () => {
          if (unitId !== unit.id) return;
          if (!currentEntry()) {
            invSize = currentModels(unit);
            inv = defaultInv(makeCtx(unit, invSize));
          }
          render(unit, host);
        });
      }
    },

    // Map lowercased item name -> { name, count } summed over blocks (cards
    // ×N chips). Accepts a loadout or old selection rows.
    effectiveCounts(unit, models, list, asLoadout) {
      if (!unit || !unit.wargearProfile) return null;
      const isLoadout = asLoadout === true
        || (Array.isArray(list) && list.length > 0 && list.every((x) => x && !x.optionId && typeof x.name === 'string'));
      const lo = isLoadout ? list : loadoutFromWargear(unit, models, list || []);
      const out = new Map();
      lo.forEach((x) => {
        const k = String(x.name).toLowerCase();
        const have = out.get(k);
        out.set(k, { name: x.name, count: (have ? have.count : 0) + (x.count || 0) });
      });
      makeCtx(unit, models).defaults.forEach((d) => {
        const k = String(d.name).toLowerCase();
        if (!out.has(k)) out.set(k, { name: d.name, count: 0 });
      });
      return out;
    },

    takeSelections(unit) {
      if (!unit || unit.id !== unitId || !unit.wargearProfile || !inv) return [];
      return invToLoadout(inv);
    },
    takeLoadout(unit) { return this.takeSelections(unit); },

    warnings(unit, models, loadout) {
      if (!unit || !unit.wargearProfile) return [];
      const ctx = makeCtx(unit, models);
      return warnings(ctx, invFromLoadout(ctx, loadout || []));
    },
    // Rows whose count differs from the default, [{ id, name, count, def,
    // model, short }] (short = type name without the words all types share).
    diff(unit, models, loadout) {
      if (!unit || !unit.wargearProfile) return [];
      const ctx = makeCtx(unit, models);
      const m = invFromLoadout(ctx, loadout || []);
      const out = [];
      rowsFor(ctx, m).forEach(({ block: b, rows }) => rows.forEach((r) => {
        const n = (m.get(r.key) || {}).count || 0;
        if (n !== r.def) out.push({ id: r.id || (m.get(r.key) || {}).id, name: r.name, count: n, def: r.def, model: b.model, short: b.short || b.label });
      }));
      return out;
    },
    defaultLoadout(unit, models) { return invToLoadout(defaultInv(makeCtx(unit, models))); },
    entryLoadout,
    loadoutFromWargear,
    needsModel,
    // Per-block rows for a loadout (the §6 migration of rows without model).
    blockLoadout(unit, models, loadout) { return invToLoadout(invFromLoadout(makeCtx(unit, models), loadout || [])); },

    rulesOf,
    removesOf,
    costOf,
    groupCost(profile, opt, grp) {
      const rule = (opt && !opt.kind && rulesOf(profile).find((r) => r.id === opt.id)) || opt;
      const ci = Math.max(0, (rule && rule.choices ? rule.choices.indexOf(grp) : 0));
      return costOf(profile, rule, ci);
    },
  };
})();
