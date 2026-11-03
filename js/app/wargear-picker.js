// app/wargear-picker.js — the Wargear inventory in the unit details pane.
//
// Renders under the official-wording Wargear section (detail.js) for any unit
// with a structured `wargearProfile`. Inventory view: the default loadout is
// listed with the number the squad still carries (derived), every option
// with a stepper. Since 2026-11-03 the steppers ENFORCE the datasheet rules
// (contract docs/WARGEAR-RULES.md §3):
//
//   1. rule cap      — Σ over a rule's choices ≤ cap(rule, squad size)
//   2. availability  — a swap needs a model that still carries what it gives
//                      up (default − removed − locked + gained ≥ 0, per model
//                      type and unit-wide)
//   3. exclusivity   — rules in one exclusiveWith set: one per model
//   4. requires      — a take needs a model still carrying the required items
//   5. "+" is disabled (not hidden) at a limit, its title says why; "−" never
//      is above 0.
//
// The rules come from `wargearProfile.rules[]` (the pipeline parses GDC's
// datasheet prose). A profile that still has only the old 40kdc `options[]`
// is mapped onto the same rule shape by rulesOf() with best-effort caps, so
// armies built on an older dataset keep working.
//
// Configure-then-add: the picker holds a pending config for the currently-
// viewed unit; "Add to Army" (events.js) snapshots it onto the new entry via
// App.WargearPicker.takeSelections(). Editing an existing army entry writes
// back live via syncEntry(). Saved shape is unchanged:
//   entry.wargear[] = { optionId (= rule id), choice, count, items, label, pts }
//
// Costs: 11e prices SOME wargear per item taken (MFM → wargearProfile
// .itemCosts). Priced DEFAULTS cost points before any selection (army.js
// getEntryWargearBasePts / wargearProfile.defaultCostBySize); each row's
// chip is the NET delta per take (negative when it sheds a priced default).
(function () {
  const App = window.App = window.App || {};

  // Pending config for the viewed unit: 'ruleId:choiceIdx' -> count.
  let unitId = null;
  let counts = new Map();
  let panelEl = null;   // details pane root (set at mount) — banner pts live here
  // Army entry being EDITED (pane opened by clicking an army-list entry), or
  // null when configuring a not-yet-added roster unit.
  let entryIndex = null;

  // `entryIndex` is only refreshed inside mount(), so it can go stale when an
  // EARLIER army entry is removed (#71). Resolve the live index from state at
  // read/write time; entryIndex itself only gates entry-bound mode.
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
    s.currentArmy.setWargear(liveEntryIndex(), App.WargearPicker.takeSelections(unit));
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

    const visible = (r) => !(r.condition && r.condition.minModels) || size >= r.condition.minModels;
    function capOf(r) {
      if (r.scope === 'per_n') return Math.floor(size / (r.n || 1)) * (r.max == null ? 1 : r.max);
      if (r.scope === 'any') return countOf(r.model);
      return r.max == null ? countOf(r.model) : r.max;
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

    return { unit, profile, rules, size, countOf, defaults, keyOf, defaultCount, itemName, visible, capOf, exclSets };
  }

  // ── constraint check ─────────────────────────────────────────────────────
  const article = (name) => {
    const n = String(name || '').toLowerCase();
    if (/s$/.test(n)) return n;
    return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
  };
  const plural = (m) => (/s$/i.test(m) ? m : m + 's');
  function capReason(ctx, r) {
    const c = ctx.capOf(r);
    if (r.scope === 'per_n') {
      const per = (r.max == null || r.max === 1) ? '1' : 'Up to ' + r.max;
      return `${per} per ${r.n} models (${c} at ${ctx.size})`;
    }
    if (r.scope === 'any' || r.max == null) {
      if (c <= 1) return r.model ? `Only 1 ${r.model} can take this` : 'Only one of these';
      return `Only ${c} ${r.model ? plural(r.model) : 'models'} in the unit`;
    }
    if (c === 1) return r.model ? `Only 1 ${r.model} can take this` : 'Only one of these';
    return `Up to ${c} of these`;
  }
  function capText(ctx, r) {
    if (r.scope === 'per_n') return (r.max == null || r.max === 1) ? `1 per ${r.n}` : `up to ${r.max} per ${r.n}`;
    const c = ctx.capOf(r);
    if (r.scope === 'any') return c <= 1 ? '1 only' : 'any';
    if (r.max == null) return c <= 1 ? '1 only' : `up to ${c}`;
    return r.max === 1 ? '1 only' : `up to ${r.max}`;
  }

  // Every constraint the counts break, as id -> { msg, over }. A "+" is
  // allowed when it introduces no new violation and worsens none.
  function violations(ctx, cnt) {
    const v = new Map();
    const put = (id, msg, over) => { if (over > 0) v.set(id, { msg, over }); };
    const totals = new Map();
    const unitL = new Map();     // key -> {rm, lk, gn}
    const scopeL = new Map();    // model -> Map(key -> {rm, lk, gn})
    const led = (m, k) => {
      let L = unitL;
      if (m) { if (!scopeL.has(m)) scopeL.set(m, new Map()); L = scopeL.get(m); }
      if (!L.has(k)) L.set(k, { rm: 0, lk: 0, gn: 0 });
      return L.get(k);
    };
    const bump = (m, k, f, n) => { led(null, k)[f] += n; if (m) led(m, k)[f] += n; };

    ctx.rules.forEach((r) => {
      let total = 0;
      (r.choices || []).forEach((grp, ci) => {
        const n = cnt.get(r.id + ':' + ci) || 0;
        if (!n) return;
        total += n;
        removesOf(r, ci).forEach((x) => bump(r.model, ctx.keyOf(x), 'rm', n));
        (grp || []).forEach((x) => bump(r.model, ctx.keyOf(x), 'gn', n));
      });
      (r.locks || []).forEach((x) => { if (total) bump(r.model, ctx.keyOf(x), 'lk', total); });
      totals.set(r.id, total);
      if (!total) return;
      if (!ctx.visible(r)) put('cond:' + r.id, `Needs ${r.condition.minModels}+ models`, total);
      put('cap:' + r.id, capReason(ctx, r), total - ctx.capOf(r));
    });

    const known = (k, L) => k.startsWith('d:') || (L.get(k) || {}).gn > 0;
    const avail = (m, k) => {
      const L = m ? (scopeL.get(m) || new Map()) : unitL;
      const e = L.get(k) || { rm: 0, lk: 0, gn: 0 };
      const base = m ? Math.min(ctx.countOf(m), ctx.defaultCount(k)) : ctx.defaultCount(k);
      return base + e.gn - e.rm - e.lk;
    };
    scopeL.forEach((L, m) => L.forEach((e, k) => {
      if (!known(k, L) && !known(k, unitL)) return;
      put('avail:' + m + ':' + k, `No ${m} still carries ${article(ctx.itemName.get(k))}`, -avail(m, k));
    }));
    unitL.forEach((e, k) => {
      if (!known(k, unitL)) return;
      put('avail::' + k, `No model still carries ${article(ctx.itemName.get(k))}`, -avail(null, k));
    });

    // Requires (not locked by the same rule): each take needs a carrier.
    ctx.rules.forEach((r) => {
      const total = totals.get(r.id) || 0;
      if (!total || !(r.requires || []).length) return;
      const locked = new Set((r.locks || []).map((x) => ctx.keyOf(x)));
      (r.requires || []).forEach((x) => {
        const k = ctx.keyOf(x);
        if (!k.startsWith('d:') && !((unitL.get(k) || {}).gn > 0)) return;
        if (locked.has(k)) {
          // The take keeps the item and locks it: availability (≥ 0) covers
          // it, but it must also exist on that model type at all.
          const base = r.model ? Math.min(ctx.countOf(r.model), ctx.defaultCount(k)) : ctx.defaultCount(k);
          put('req:' + r.id + ':' + k, `No ${r.model || 'model'} still carries ${article(ctx.itemName.get(k))}`, total - base - ((led(r.model, k).gn) || 0));
          return;
        }
        put('req:' + r.id + ':' + k, `No ${r.model || 'model'} still carries ${article(ctx.itemName.get(k))}`, total - avail(r.model, k));
      });
    });

    // Exclusivity: one rule of the set per model.
    ctx.exclSets.forEach((set, root) => {
      if (set.length < 2) return;
      const sum = set.reduce((s, r) => s + (totals.get(r.id) || 0), 0);
      put('excl:' + root, 'Only one of these per model', sum - ctx.countOf(set[0].model));
    });
    return v;
  }

  // Why "+" on `key` is refused (string), or null when it is allowed.
  function refusal(ctx, cnt, key) {
    const next = new Map(cnt);
    next.set(key, (next.get(key) || 0) + 1);
    const cur = violations(ctx, cnt), nx = violations(ctx, next);
    for (const [id, e] of nx) {
      const was = cur.get(id);
      if (!was || e.over > was.over) return e.msg;
    }
    return null;
  }

  // Re-fit counts to the limits at the current size (size change while
  // configuring): re-add one at a time in rule order, dropping what no
  // longer fits.
  function normalize(ctx, cnt) {
    const out = new Map();
    ctx.rules.forEach((r) => (r.choices || []).forEach((g, ci) => {
      const k = r.id + ':' + ci;
      const want = cnt.get(k) || 0;
      for (let i = 0; i < want; i++) {
        if (refusal(ctx, out, k)) break;
        out.set(k, (out.get(k) || 0) + 1);
      }
    }));
    return out;
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
    let btn = stepper && stepper.querySelector(ref.plus ? '.wgp-plus' : '.wgp-minus');
    // A just-disabled "+" cannot hold focus; hand it to its "−".
    if (btn && btn.disabled) btn = stepper.querySelector(ref.plus ? '.wgp-minus' : '.wgp-plus');
    if (btn && !btn.disabled) btn.focus();
  }

  // Disabled steppers: the stylesheet has no :disabled rule for .wgp-btn yet,
  // so dim it inline (CSP allows inline styles on this vhost).
  const DIS = ' disabled style="opacity:.35;cursor:not-allowed"';

  function render(unit, host) {
    const profile = unit.wargearProfile;
    const models = currentModels(unit);
    const ctx = makeCtx(unit, models);
    const refocus = focusedStepperBtn(host);

    const groups = new Map();   // modelName -> [{ key, rule, ci, grp, cost }]
    let anyPriced = false;
    ctx.rules.forEach((rule) => {
      const model = rule.model || '';
      (rule.choices || []).forEach((grp, ci) => {
        const cost = costOf(profile, rule, ci);
        if (cost) anyPriced = true;
        if (!ctx.visible(rule)) return;
        if (!groups.has(model)) groups.set(model, []);
        groups.get(model).push({ key: rule.id + ':' + ci, rule, ci, grp, cost });
      });
    });

    // Live wargear points = priced defaults at this size + selected deltas,
    // floored at 0 — mirrors army.js getEntryPoints.
    let wgLive = (profile.alwaysCost || 0) + defaultBasePts(profile, models);
    ctx.rules.forEach((rule) => (rule.choices || []).forEach((g, ci) => {
      wgLive += (counts.get(rule.id + ':' + ci) || 0) * costOf(profile, rule, ci);
    }));
    wgLive = Math.max(0, wgLive);

    const unparsed = Array.isArray(profile.unparsed) ? profile.unparsed.filter(Boolean) : [];
    if (!groups.size && !unparsed.length) {
      host.innerHTML = '';
      updateBannerPts(unit, wgLive);
      return;
    }

    let html = '<div class="wgp-inv">';
    const row = (label, n, r, hint, fixed, why, title) => {
      const hintChip = hint ? ` <span class="wgp-chip">${esc(hint)}</span>` : '';
      const pts = r ? ptsChip(r.cost) : '';
      const stepper = fixed
        ? `<span class="wgp-stepper wgp-stepper-fixed"><span class="wgp-count">${n}</span></span>`
        : `<span class="wgp-stepper" data-key="${esc(r.key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one ${esc(label)}"${n > 0 ? '' : DIS}>&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one ${esc(label)}"${why ? DIS + ` title="${esc(why)}"` : ''}>+</button>
          </span>`;
      const t = title ? ` title="${esc(title)}"` : '';
      return `<div class="wgp-row${fixed ? ' wgp-row-default' : ''}"><span class="wgp-item"${t}>${esc(label)}${pts}${hintChip}</span>${stepper}</div>`;
    };
    // Default items at this size, minus whatever the picked swaps removed.
    const removedBy = new Map();
    ctx.rules.forEach((rule) => (rule.choices || []).forEach((g, ci) => {
      const n = counts.get(rule.id + ':' + ci) || 0; if (!n) return;
      removesOf(rule, ci).forEach((x) => { const k = ctx.keyOf(x); removedBy.set(k, (removedBy.get(k) || 0) + n); });
    }));
    ctx.defaults.forEach((d, i) => {
      const left = Math.max(0, (d.count || 0) - (removedBy.get('d:' + i) || 0));
      html += row(cap(d.name), left, null, 'default', true);
    });
    // Everything the datasheet lets you take instead of / on top of that.
    groups.forEach((rows) => rows.forEach((r) => {
      const hint = (r.rule.model ? r.rule.model + ' · ' : '') + capText(ctx, r.rule);
      const why = refusal(ctx, counts, r.key);
      html += row(cap(names(r.grp)), counts.get(r.key) || 0, r, hint, false, why, r.rule.text || '');
    }));
    html += '</div>';
    // A saved loadout that no longer fits (squad shrunk, data changed).
    const broken = Array.from(violations(ctx, counts).values()).map((e) => e.msg);
    if (broken.length) html += `<div class="wgp-note wgp-over">Over a datasheet limit: ${esc(Array.from(new Set(broken)).join('; '))}</div>`;
    if (unparsed.length) {
      html += '<div class="wgp-unparsed" style="margin-top:var(--sp-2);font-size:var(--fs-2xs);color:var(--text-muted)">'
        + 'Not checked by the picker: ' + unparsed.map((l) => esc(l)).join(' · ') + '</div>';
    }
    if (anyPriced || wgLive) html += `<div class="wgp-note wgp-total">Wargear points: +${wgLive} pts</div>`;
    host.innerHTML = html;
    restoreStepperFocus(host, refocus);
    updateBannerPts(unit, wgLive);
  }

  // Banner points track the LIVE cost: selected size's base + wargear points.
  // Only the leading number is replaced; the dimmed subs stay.
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

  App.WargearPicker = {
    mount(unit, panel) {
      const host = panel.querySelector('#detail-wargear-picker');
      if (!host || !unit || !unit.wargearProfile) return;
      panelEl = panel;
      const s = App.state || {};
      const selEntry = (s.selectedArmyEntryIndex != null && s.currentArmy)
        ? s.currentArmy.entries[s.selectedArmyEntryIndex] : null;
      const ei = (selEntry && selEntry.unitId === unit.id) ? s.selectedArmyEntryIndex : null;
      if (unit.id !== unitId || ei !== entryIndex) {
        unitId = unit.id;
        entryIndex = ei;
        counts = new Map();
        // Seed from the entry's saved selections (summed: a migration can
        // map two old rows onto one rule choice).
        const entry = currentEntry();
        ((entry && entry.wargear) || []).forEach((w) => {
          if (w && w.optionId && w.count) {
            const k = w.optionId + ':' + (w.choice == null ? 0 : w.choice);
            counts.set(k, (counts.get(k) || 0) + w.count);
          }
        });
      }
      // Editing an existing entry: preselect ITS squad size.
      const entry = currentEntry();
      if (entry) {
        const sel = panel.querySelector('#detail-squad-select');
        const opts = unit.squadOptions || [];
        const idx = opts.findIndex((o) => o.pts === entry.selectedPts);
        if (sel && idx >= 0 && String(idx) !== sel.value) {
          sel.value = String(idx);
          const label = panel.querySelector('#detail-size-label');
          if (label && opts[idx]) {
            label.textContent = opts[idx].models
              ? `${opts[idx].models} models — ${opts[idx].pts} pts` : `${opts[idx].pts} pts`;
          }
        }
      }
      render(unit, host);

      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.wgp-btn');
        if (!btn || btn.disabled) return;
        const stepper = btn.closest('.wgp-stepper');
        if (!stepper || !stepper.dataset.key) return;
        const key = stepper.dataset.key;
        const cur = counts.get(key) || 0;
        if (btn.classList.contains('wgp-plus')) {
          if (refusal(makeCtx(unit, currentModels(unit)), counts, key)) return;
          counts.set(key, cur + 1);
        } else {
          if (cur <= 0) return;
          counts.set(key, cur - 1);
        }
        render(unit, host);
        syncEntry(unit);   // no-op unless this pane edits an army entry
      });
      // Squad-size change → limits recompute. While configuring a new unit
      // the pending loadout is re-fitted to the new size; an entry being
      // edited keeps its saved rows (the over-limit note says what broke).
      const sizeSel = panel.querySelector('#detail-squad-select');
      if (sizeSel && !sizeSel._wgpWired) {
        sizeSel._wgpWired = true;
        sizeSel.addEventListener('change', () => {
          if (!currentEntry()) counts = normalize(makeCtx(unit, currentModels(unit)), counts);
          render(unit, host);
        });
      }
    },

    // Full effective loadout for a squad: defaults at `models` adjusted by
    // the saved selections (adds − removed), plus taken non-default items.
    // Map lowercased item name -> { name, count }, or null without a profile.
    // Used by the card exporter for the ×N chips.
    effectiveCounts(unit, models, selections) {
      const profile = unit && unit.wargearProfile;
      if (!profile) return null;
      const ctx = makeCtx(unit, models);
      const added = new Map(), removed = new Map(), label = new Map();
      (selections || []).forEach((sel) => {
        if (!sel || !sel.optionId || !sel.count) return;
        const rule = ctx.rules.find((r) => r.id === sel.optionId);
        if (!rule) return;
        const ci = sel.choice == null ? 0 : sel.choice;
        ((rule.choices || [])[ci] || []).forEach((x) => {
          const k = ctx.keyOf(x);
          added.set(k, (added.get(k) || 0) + sel.count);
          if (!label.has(k)) label.set(k, x.name);
        });
        removesOf(rule, ci).forEach((x) => { const k = ctx.keyOf(x); removed.set(k, (removed.get(k) || 0) + sel.count); });
      });
      const out = new Map();
      const put = (name, count) => { out.set(String(name).toLowerCase(), { name, count }); };
      ctx.defaults.forEach((d, i) => {
        const k = 'd:' + i;
        put(d.name, Math.max(0, (d.count || 0) + (added.get(k) || 0) - (removed.get(k) || 0)));
      });
      added.forEach((n, k) => { if (!k.startsWith('d:') && n) put(label.get(k), n); });
      return out;
    },

    // Snapshot the pending config for addUnit(); keeps state so adding a
    // second copy of the squad reuses the same loadout.
    takeSelections(unit) {
      if (!unit || unit.id !== unitId || !unit.wargearProfile) return [];
      const out = [];
      rulesOf(unit.wargearProfile).forEach((rule) => {
        (rule.choices || []).forEach((grp, ci) => {
          const n = counts.get(rule.id + ':' + ci) || 0;
          if (!n) return;
          out.push({
            optionId: rule.id,
            choice: ci,
            count: n,
            label: cap(names(grp)),
            items: grp.map((x) => x.name),
            // NET delta per take (may be negative; army.js floors at 0).
            pts: costOf(unit.wargearProfile, rule, ci),
          });
        });
      });
      return out;
    },

    // Shared with entry-rehydrate.js (pricing + migration) and the verify
    // script. groupCost keeps its old (profile, option, group) signature.
    rulesOf,
    removesOf,
    costOf,
    groupCost(profile, opt, grp) {
      // A raw legacy option resolves to its adapted rule (same choices array).
      const rule = (opt && !opt.kind && rulesOf(profile).find((r) => r.id === opt.id)) || opt;
      const ci = Math.max(0, (rule && rule.choices ? rule.choices.indexOf(grp) : 0));
      return costOf(profile, rule, ci);
    },
    // Engine probe for tests: why "+" on `key` is refused at `models`, given
    // `cnt` (object or Map of 'ruleId:ci' -> n); null = allowed.
    _refusal(unit, models, cnt, key) {
      const m = cnt instanceof Map ? cnt : new Map(Object.entries(cnt || {}));
      return refusal(makeCtx(unit, models), m, key);
    },
  };
})();
