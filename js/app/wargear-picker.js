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
// Storage: entry.loadout = [{ id, name, count }] (defaults with their counts,
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
    function capOf(r) {
      let c;
      if (r.scope === 'per_n') {
        const base = r.nModel ? countOf(r.nModel) : size;   // "For every 5 Inquisitorial Agents"
        c = Math.floor(base / (num(r.n) || 1)) * (r.max == null ? 1 : r.max);
      } else if (r.scope === 'any') c = countOf(r.model);
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

    return { unit, profile, rules, size, countOf, defaults, keyOf, defaultCount, itemName, visible, capOf, choiceCapOf, exclSets };
  }


  // ── inventory helpers ────────────────────────────────────────────────────
  const A = () => window.Army;
  const priceOf = (unit, it) => ((A() && A().itemPrice) ? A().itemPrice(unit, it) : 0);

  function defaultInv(ctx) {
    const m = new Map();
    ctx.defaults.forEach((d, i) => {
      if ((d.count || 0) > 0) m.set('d:' + i, { id: String(d.id || ''), name: d.name, count: d.count });
    });
    return m;
  }
  function invFromLoadout(ctx, loadout) {
    const m = new Map();
    (loadout || []).forEach((x) => {
      if (!x || !x.count) return;
      const k = ctx.keyOf(x);
      const have = m.get(k);
      if (have) have.count += x.count;
      else m.set(k, { id: String(x.id || ''), name: x.name, count: x.count });
    });
    return m;
  }
  const invToLoadout = (m) => Array.from(m.values()).filter((x) => x.count > 0)
    .map((x) => ({ id: x.id, name: x.name, count: x.count }));

  // Old selection rows (entry.wargear, rule or 40kdc option ids) → the full
  // inventory: defaults at this size − replaced + added. A row whose id no
  // longer resolves still adds its items, so nothing silently disappears.
  function loadoutFromWargear(unit, models, wargear) {
    const ctx = makeCtx(unit, models);
    const m = defaultInv(ctx);
    const bump = (x, n) => {
      const k = ctx.keyOf(x);
      const have = m.get(k);
      if (have) have.count += n;
      else m.set(k, { id: String(x.id || ''), name: x.name, count: n });
    };
    (wargear || []).forEach((w) => {
      if (!w || !w.count) return;
      const rule = ctx.rules.find((r) => r.id === w.optionId);
      const ci = w.choice == null ? 0 : w.choice;
      const grp = rule && (rule.choices || [])[ci];
      if (grp) {
        removesOf(rule, ci).forEach((x) => bump(x, -w.count));
        grp.forEach((x) => bump(x, w.count * (Number.isFinite(x.count) && x.count > 1 ? x.count : 1)));
      } else {
        (w.items || []).forEach((nm) => bump({ id: '', name: nm }, w.count));
      }
    });
    m.forEach((x) => { if (x.count < 0) x.count = 0; if (!x.id) x.id = (A() ? A()._kebab(x.name) : x.name); });
    return invToLoadout(m);
  }

  // Rows: defaults first (default order), then every item any rule offers
  // (deduplicated; one that is also a default stays in the defaults block),
  // then anything else the inventory holds. Each option row carries the
  // rules that offer it, for its chip.
  function rowsFor(ctx, m) {
    const rows = [], seen = new Map();
    ctx.defaults.forEach((d, i) => {
      const r = { key: 'd:' + i, id: String(d.id || ''), name: d.name, def: d.count || 0, rules: [] };
      rows.push(r); seen.set(r.key, r);
    });
    ctx.rules.forEach((rule) => (rule.choices || []).forEach((grp) => (grp || []).forEach((x) => {
      const k = ctx.keyOf(x);
      let r = seen.get(k);
      if (!r) { r = { key: k, id: String(x.id || ''), name: x.name, def: 0, rules: [] }; rows.push(r); seen.set(k, r); }
      if (r.rules.indexOf(rule) === -1) r.rules.push(rule);
    })));
    m.forEach((x, k) => {
      if (seen.has(k)) return;
      const r = { key: k, id: x.id, name: x.name, def: 0, rules: [] };
      rows.push(r); seen.set(k, r);
    });
    return rows;
  }

  function capText(ctx, r) {
    const c = ctx.capOf(r);
    if (r.scope === 'per_n') return (r.max == null || r.max === 1) ? `1 per ${r.n}` : `up to ${r.max} per ${r.n}`;
    if (r.scope === 'any') return c <= 1 ? '1 only' : 'any';
    if (r.max == null) return c <= 1 ? '1 only' : `up to ${c}`;
    return r.max === 1 ? '1 only' : `up to ${r.max}`;
  }
  function capPhrase(ctx, r) {
    if (r.scope === 'per_n') return (r.max == null || r.max === 1) ? `1 per ${r.n} models` : `up to ${r.max} per ${r.n} models`;
    if (r.scope === 'any') return r.model ? `one per ${r.model}` : 'one per model';
    if (r.max == null) return r.model ? `one per ${r.model}` : 'one per model';
    return r.max === 1 ? '1 only' : `up to ${r.max}`;
  }
  const article = (name) => {
    const n = String(name || '').toLowerCase();
    if (/s$/.test(n)) return n;
    return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
  };

  // ── warnings (§5) ────────────────────────────────────────────────────────
  // Counts by item key. Returns an array of messages; [] = clean.
  function warnings(ctx, m) {
    const out = [];
    const cnt = (k) => ((m.get(k) || {}).count || 0);
    const nameOf = (k) => (m.get(k) || {}).name || ctx.itemName.get(k) || k.replace(/^x:/, '');
    const extras = (k) => Math.max(0, cnt(k) - ctx.defaultCount(k));

    // 1. Slot. For each default D: extras of items that can only replace D
    //    (single-item choices of replace rules, offered by nothing else) must
    //    fit D's freed slots; flexible items (several targets, also offered
    //    by an add rule, or part of a bundle) may fill them but are not
    //    forced to.
    const targets = new Map(), flexible = new Set();
    ctx.rules.forEach((rule) => (rule.choices || []).forEach((grp, ci) => {
      const rm = removesOf(rule, ci).map((x) => ctx.keyOf(x)).filter((k) => k.startsWith('d:'));
      (grp || []).forEach((x) => {
        const k = ctx.keyOf(x);
        if (!targets.has(k)) targets.set(k, new Set());
        if (rule.kind === 'add' || !rm.length) { flexible.add(k); return; }
        if ((grp || []).length > 1 || (Number.isFinite(x.count) && x.count > 1)) flexible.add(k);
        rm.forEach((d) => targets.get(k).add(d));
      });
    }));
    targets.forEach((set, k) => { if (set.size > 1) flexible.add(k); });
    ctx.defaults.forEach((d, i) => {
      const D = 'd:' + i, def = d.count || 0;
      let excl = 0, shared = 0;
      targets.forEach((set, k) => {
        if (!set.has(D) || k === D) return;
        if (flexible.has(k)) shared += extras(k); else excl += extras(k);
      });
      const lo = cnt(D) + excl, hi = lo + shared;
      const dn = String(d.name || '').toLowerCase();
      if (lo > def) out.push(`${cap(d.name)}: ${lo} weapons for ${def} models — lower the ${dn} count when you add swaps`);
      else if (hi < def) out.push(`${cap(d.name)}: only ${hi} for ${def} models`);
    });

    // 2. Cap. Each item's extras fill the rules that offer it in order; a
    //    rule's cap is shared across its choices.
    const left = new Map(ctx.rules.map((r) => [r.id, ctx.visible(r) ? ctx.capOf(r) : 0]));
    rowsFor(ctx, m).forEach((row) => {
      if (!row.rules.length) return;
      const taken = extras(row.key);
      if (!taken) return;
      let rest = taken;
      row.rules.forEach((r) => {
        const grp = (r.choices || []).find((g) => (g || []).some((x) => ctx.keyOf(x) === row.key)) || [];
        const mult = Math.max(1, grp.filter((x) => ctx.keyOf(x) === row.key)
          .reduce((n, x) => n + (Number.isFinite(x.count) && x.count > 1 ? x.count : 1), 0));
        const can = Math.min(rest, (left.get(r.id) || 0) * mult);
        const takes = Math.ceil(can / mult);
        left.set(r.id, (left.get(r.id) || 0) - takes);
        rest -= can;
      });
      if (rest > 0) {
        const r0 = row.rules[0];
        out.push(`${cap(row.name)}: ${taken} taken, the datasheet allows up to ${taken - rest} (${capPhrase(ctx, r0)})`);
        return;
      }
      // Per-choice unit-wide limit (choiceMax), summed over the rules that
      // set one for this item.
      let lim = null;
      row.rules.forEach((r) => { const c = ctx.choiceCapOf(r); if (c != null) lim = (lim || 0) + c; });
      if (lim != null && taken > lim) out.push(`${cap(row.name)}: ${taken} taken, the datasheet allows ${lim} per unit`);
    });

    // 3. Requires / locks: an add-on needs a model still carrying the item.
    ctx.rules.forEach((rule) => {
      const need = new Map();
      (rule.requires || []).concat(rule.locks || []).forEach((x) => need.set(ctx.keyOf(x), x));
      if (!need.size) return;
      const gained = new Set();
      (rule.choices || []).forEach((g) => (g || []).forEach((x) => gained.add(ctx.keyOf(x))));
      gained.forEach((g) => {
        const n = extras(g);
        if (!n) return;
        need.forEach((x, k) => {
          if (n > cnt(k)) out.push(`${cap(nameOf(g))} needs a model that still carries ${article(nameOf(k))}`);
        });
      });
    });

    // 4. Exclusive: one rule of an exclusiveWith set per model.
    ctx.exclSets.forEach((set) => {
      if (set.length < 2) return;
      const keys = new Set();
      set.forEach((r) => (r.choices || []).forEach((g) => (g || []).forEach((x) => keys.add(ctx.keyOf(x)))));
      let sum = 0;
      keys.forEach((k) => { sum += extras(k); });
      if (sum > ctx.countOf(set[0].model)) {
        out.push(`${Array.from(keys).map((k) => cap(nameOf(k))).join(', ')}: only one of these per model`);
      }
    });
    return Array.from(new Set(out));
  }

  const ptsChip = (d) => (d ? ` <span class="wgp-pts">${d > 0 ? '+' : '−'}${Math.abs(d)} pts</span>` : '');

  // render() rebuilds the host with innerHTML, destroying the pressed button;
  // remember the focused stepper by data-key + direction and restore it.
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
    const rows = rowsFor(ctx, inv);

    const loadout = invToLoadout(inv);
    const wgLive = A() && A().loadoutPts ? A().loadoutPts(unit, loadout) : 0;
    const anyPriced = rows.some((r) => priceOf(unit, r));

    if (!rows.length) {
      host.innerHTML = '';
      updateBannerPts(unit, wgLive);
      return;
    }

    let html = '<div class="wgp-inv">';
    rows.forEach((r) => {
      const n = (inv.get(r.key) || {}).count || 0;
      let hint = '';
      if (r.def) hint = 'default';
      else if (r.rules.length) {
        const ms = Array.from(new Set(r.rules.map((x) => x.model || '')));
        hint = ((ms.length === 1 && ms[0]) ? ms[0] + ' · ' : '') + capText(ctx, r.rules[0]);
      }
      const hintChip = hint ? ` <span class="wgp-chip">${esc(hint)}</span>` : '';
      const title = r.rules.map((x) => x.text).filter(Boolean).join('\n');
      const t = title ? ` title="${esc(title)}"` : '';
      html += `<div class="wgp-row${r.def ? ' wgp-row-default' : ''}"><span class="wgp-item"${t}>${esc(cap(r.name))}${ptsChip(priceOf(unit, r))}${hintChip}</span>`
        + `<span class="wgp-stepper" data-key="${esc(r.key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one ${esc(r.name)}">&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one ${esc(r.name)}">+</button>
          </span></div>`;
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

  // Banner points track the LIVE cost: selected size's base + wargear points.
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

  // The inventory an entry holds: its loadout, else its old selection rows
  // converted, else the defaults at its size.
  function entryLoadout(unit, entry) {
    const models = A() && A().entryModels ? A().entryModels(entry) : null;
    if (Array.isArray(entry.loadout)) return entry.loadout;
    if (Array.isArray(entry.wargear) && entry.wargear.length) return loadoutFromWargear(unit, models, entry.wargear);
    return invToLoadout(defaultInv(makeCtx(unit, models)));
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
      // Editing an existing entry: preselect ITS squad size first.
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
        const ctx = makeCtx(unit, currentModels(unit));
        let item = inv.get(key);
        if (!item) {
          const row = rowsFor(ctx, inv).find((r) => r.key === key);
          if (!row) return;
          item = { id: row.id || (A() ? A()._kebab(row.name) : row.name), name: row.name, count: 0 };
          inv.set(key, item);
        }
        if (btn.classList.contains('wgp-plus')) item.count += 1;
        else if (item.count > 0) item.count -= 1;
        else return;
        render(unit, host);
        syncEntry(unit);   // no-op unless this pane edits an army entry
      });
      // Size change: an unsaved pick resets to that size's defaults; a saved
      // entry keeps its counts (the warnings say what no longer fits).
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

    // Effective loadout as Map lowercased item name -> { name, count }, or
    // null without a profile. Accepts a loadout ([{id,name,count}]) or old
    // selection rows. Used by the card exporter for the ×N chips.
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
      // Defaults that were lowered to 0 still get a row (×0).
      makeCtx(unit, models).defaults.forEach((d) => {
        const k = String(d.name).toLowerCase();
        if (!out.has(k)) out.set(k, { name: d.name, count: 0 });
      });
      return out;
    },

    // The pending inventory as a loadout for addUnit() (events.js passes it
    // in the old `wargear` slot; Army.addUnit recognises the shape). State
    // is kept so a second copy reuses the same loadout.
    takeSelections(unit) {
      if (!unit || unit.id !== unitId || !unit.wargearProfile || !inv) return [];
      return invToLoadout(inv);
    },
    takeLoadout(unit) { return this.takeSelections(unit); },

    // Warnings for a loadout at a squad size (army-list badge).
    warnings(unit, models, loadout) {
      if (!unit || !unit.wargearProfile) return [];
      const ctx = makeCtx(unit, models);
      return warnings(ctx, invFromLoadout(ctx, loadout || []));
    },
    // Items whose count differs from the default at that size, as
    // [{ id, name, count, def }] (army-list badges show the gains).
    diff(unit, models, loadout) {
      if (!unit || !unit.wargearProfile) return [];
      const ctx = makeCtx(unit, models);
      const m = invFromLoadout(ctx, loadout || []);
      const out = [];
      rowsFor(ctx, m).forEach((r) => {
        const n = (m.get(r.key) || {}).count || 0;
        if (n !== r.def) out.push({ id: r.id || (m.get(r.key) || {}).id, name: r.name, count: n, def: r.def });
      });
      return out;
    },
    defaultLoadout(unit, models) { return invToLoadout(defaultInv(makeCtx(unit, models))); },
    entryLoadout,
    loadoutFromWargear,

    // Shared with entry-rehydrate.js and tts-export-style readers.
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
