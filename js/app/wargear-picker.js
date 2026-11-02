// app/wargear-picker.js — POINTS-ONLY wargear picker in the unit details pane.
//
// Renders under the official-wording Wargear section (detail.js) for any unit
// with a structured `wargearProfile` (built by dc-adapter.js from 40kdc wargear
// options / composition tiers). The official prose already lists EVERY option;
// this picker only surfaces the choices that CHANGE THE UNIT'S POINTS, as plain
// steppers, so armies cost correctly. It deliberately does NOT enforce limits,
// budgets, model-scoped constraints or swap cascades, and does not show the
// default loadout — that fuller UI had too many edge cases (see git history).
//
// Configure-then-add: the picker holds a pending config for the currently-viewed
// unit; "Add to Army" (events.js) snapshots it onto the new entry via
// App.WargearPicker.takeSelections(). Editing an existing army entry writes back
// live via syncEntry().
//
// Costs: 11e prices SOME wargear per item taken (MFM overlay →
// wargearProfile.itemCosts). Priced DEFAULTS cost points before any selection
// (army.js getEntryWargearBasePts / wargearProfile.defaultCostBySize); each
// shown row is a non-zero NET delta — negative when it sheds a priced default
// (thunder hammer → free lightning claws = −5 pts). takeSelections stamps that
// net delta on each selection's `pts` for the entry points math.
(function () {
  const App = window.App = window.App || {};

  // Pending config for the viewed unit: 'optionId:choiceIdx' -> count.
  let unitId = null;
  let counts = new Map();
  let panelEl = null;   // details pane root (set at mount) — banner pts live here
  // Army entry being EDITED (pane opened by clicking an army-list entry), or
  // null when configuring a not-yet-added roster unit. Mirrors how the
  // enhancement checkboxes edit existing entries via selectedArmyEntryIndex.
  let entryIndex = null;

  // `entryIndex` is only refreshed inside mount() (see above), so it can go
  // stale: removing an EARLIER army entry shifts every later one down (#71),
  // and events.js's removal path reconciles state.selectedArmyEntryIndex but
  // has no way to reach into this module's private copy. Since a re-render
  // of THIS pane isn't guaranteed on removal (the remove button only
  // re-renders the army list, not the detail pane), resolve the live index
  // from state at read/write time rather than trusting the mount-time copy —
  // entryIndex itself still gates whether we're in entry-bound mode at all.
  function liveEntryIndex() {
    return (entryIndex != null) ? (App.state || {}).selectedArmyEntryIndex : null;
  }

  function currentEntry() {
    const s = App.state || {};
    const idx = liveEntryIndex();
    if (idx == null || !s.currentArmy) return null;
    return s.currentArmy.entries[idx] || null;
  }

  // Live write-back for entry-bound panes: same flow as the enhancement
  // checkboxes — update the entry, persist, re-render the army list.
  function syncEntry(unit) {
    const s = App.state || {};
    if (!currentEntry()) return;
    s.currentArmy.setWargear(liveEntryIndex(), App.WargearPicker.takeSelections(unit));
    if (s.armyManager) s.armyManager.saveArmy(s.currentArmy);
    if (window.UI && UI.renderArmyList) UI.renderArmyList(s.currentArmy);
  }

  const esc = UI.escapeHtml;
  const cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const names = (grp) => (grp || []).map((x) => x.name).join(' + ');

  // Current squad size (models) from the detail pane's squad select.
  function currentModels(unit) {
    const opts = unit.squadOptions || [];
    const sel = document.getElementById('detail-squad-select');
    const opt = sel ? opts[parseInt(sel.value, 10)] : opts[0];
    return (opt && opt.models) || (opts[0] && opts[0].models) || null;
  }

  // Priced default loadout cost at a squad size (nearest tier ≤ models, else
  // smallest). Mirrors army.js getEntryWargearBasePts's tier pick so the
  // banner preview and the added entry agree.
  function defaultBasePts(profile, models) {
    const bySize = profile.defaultCostBySize;
    if (!bySize) return 0;
    const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
    if (!sizes.length) return 0;
    let pick = sizes[0];
    sizes.forEach((s) => { if (models != null && s <= models) pick = s; });
    return bySize[pick] || 0;
  }

  // Default loadout at a squad size (exact tier, else nearest below, else first).
  function defaultsFor(profile, models) {
    const bySize = profile.defaultsBySize;
    if (!bySize) return [];
    if (models != null && bySize[models]) return bySize[models];
    const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
    if (!sizes.length) return [];
    let pick = sizes[0];
    sizes.forEach((s) => { if (models != null && s <= models) pick = s; });
    return bySize[pick] || [];
  }

  // What a swap ACTUALLY takes off the squad. 40kdc's `replaces` array can
  // list the model's whole prior loadout even when only one item is given
  // up (GW's "bolt pistol, teeth and claws OR wolf guard weapon"). The
  // disambiguator that holds across the dataset:
  //   - one replaces item                → replace it (unambiguous)
  //   - chosen group has MULTIPLE items  → pair-swap, AND: all replaced
  //     ("storm bolter and power weapon → power fist and assault cannon")
  //   - multi-replaces, single-item pick → OR: the FIRST listed item is the
  //     one really given up (bolt pistol first for TWC; the model keeps its
  //     teeth and claws)
  const effReplaces = (opt, grp) => {
    if (opt.replaces.length <= 1) return opt.replaces;
    if (opt.andSwap) return opt.replaces;            // hand-confirmed "and"
    if (grp && grp.length > 1) return opt.replaces;
    return [opt.replaces[0]];
  };

  // NET points delta of taking one of this choice group: priced items gained
  // minus priced items given up (per effReplaces), plus any upstream
  // per-option surcharge (opt.cost — 0 across today's dataset).
  const groupCost = (profile, opt, grp) => {
    const ic = profile.itemCosts;
    let d = opt.cost || 0;
    if (!ic) return d;
    (grp || []).forEach((x) => { d += ic[x.id] || 0; });
    effReplaces(opt, grp).forEach((x) => { d -= ic[x.id] || 0; });
    return d;
  };
  // How many models may take an option at the current squad size: a named
  // model (the Sergeant) → 1, "for every N models" → floor(models / N),
  // "any number" → every model, otherwise 1. Counts were unbounded before.
  function maxFor(unit, key) {
    const profile = unit.wargearProfile || {};
    const optId = key.slice(0, key.lastIndexOf(':'));
    const opt = (profile.options || []).find((o) => o.id === optId);
    if (!opt) return Infinity;
    const c = opt.constraint || {};
    const models = currentModels(unit) || 1;
    if (c.model_name) {
      // Named model type (the Sergeant): as many as there are of that type,
      // whether or not the option also says "any number".
      const bySize = profile.modelsBySize || {};
      const row = bySize[models] || bySize[Object.keys(bySize)[0]] || {};
      return Math.max(1, row[c.model_name] || 1);
    }
    if (c.per_n_models) return Math.max(1, Math.floor(models / c.per_n_models));
    if (c.any_number) return models;
    return 1;
  }
  const ptsChip = (d) => (d ? ` <span class="wgp-pts">${d > 0 ? '+' : '−'}${Math.abs(d)} pts</span>` : '');

  // render() rebuilds the whole host with innerHTML, which destroys the very
  // stepper button the user just pressed — focus falls to <body> and a
  // keyboard / switch-control / VoiceOver user can't press "+" twice in a row.
  // Remember the focused control by its stepper's data-key plus direction (a
  // STABLE id — the option list can change between renders, so a positional
  // index would land on the wrong row) and put focus back after the rebuild.
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
    // Match on dataset rather than a selector — option ids aren't guaranteed
    // to be safe inside an attribute selector.
    host.querySelectorAll('.wgp-stepper').forEach((s) => {
      if (!stepper && s.dataset.key === ref.key) stepper = s;
    });
    const btn = stepper && stepper.querySelector(ref.plus ? '.wgp-plus' : '.wgp-minus');
    if (btn) btn.focus();
  }

  // Points-only picker. The official prose (rendered by detail.js) already
  // lists EVERY wargear option; this surfaces just the choices whose net points
  // delta is non-zero, as plain steppers, so an army costs correctly. Rows are
  // grouped under the MODEL the option applies to (constraint.model_name) —
  // units often offer the same upgrade separately per model (e.g. a Wolf Guard
  // Terminator vs its Pack Leader each get a storm shield option). No title
  // band: detail.js owns the section heading. Deliberately NO limits, budgets
  // or swap-cascade logic — those are what had too many edge cases.
  function render(unit, host) {
    const profile = unit.wargearProfile;
    const models = currentModels(unit);
    const refocus = focusedStepperBtn(host);

    // Point-costing choice groups (positive = upgrade; negative = shedding a
    // priced default), grouped by the model the option is for. Preserves
    // first-seen model order.
    // Every option is offered, free ones too (owner 2026-11-02): until then
    // only priced swaps were pickable and free ones (a Necron Warrior's
    // gauss reaper) were left to the datasheet prose, which is fine for
    // points but leaves nothing for the Tabletop Simulator export to put on
    // the models. Free rows just carry no points chip.
    const groups = new Map();   // modelName -> [{ key, opt, grp, cost }]
    let anyPriced = false;
    (profile.options || []).forEach((opt) => {
      const model = (opt.constraint && opt.constraint.model_name) || unit.name || 'Any model';
      opt.choices.forEach((grp, ci) => {
        const cost = groupCost(profile, opt, grp);
        if (cost) anyPriced = true;
        if (!groups.has(model)) groups.set(model, []);
        groups.get(model).push({ key: opt.id + ':' + ci, opt, grp, cost });
      });
    });

    // Live wargear points = priced default loadout at this size + selected
    // deltas, floored at 0 — mirrors army.js getEntryPoints so the banner
    // preview and the added entry agree.
    let wgLive = (profile.alwaysCost || 0) + defaultBasePts(profile, models);
    groups.forEach((rows) => rows.forEach((r) => { wgLive += (counts.get(r.key) || 0) * r.cost; }));
    wgLive = Math.max(0, wgLive);

    if (!groups.size) {
      // Nothing to pick — the datasheet has no wargear options.
      host.innerHTML = '';
      updateBannerPts(unit, wgLive);
      return;
    }

    // INVENTORY view (owner 2026-11-03): the section reads as "what guns do
    // I have", not as a replacement system. Default items are listed with
    // the number the squad still carries (derived: default count minus the
    // swaps that remove it), option items with a stepper. The option model
    // (replaces / choices / counts) underneath is unchanged, so saved armies,
    // points and the TTS export all keep working.
    let html = '<div class="wgp-inv">';
    const row = (label, n, r, hint, fixed) => {
      const hintChip = hint ? ` <span class="wgp-chip">${esc(hint)}</span>` : '';
      const pts = r ? ptsChip(r.cost) : '';
      const stepper = fixed
        ? `<span class="wgp-stepper wgp-stepper-fixed"><span class="wgp-count">${n}</span></span>`
        : `<span class="wgp-stepper" data-key="${esc(r.key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one ${esc(label)}">&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one ${esc(label)}">+</button>
          </span>`;
      return `<div class="wgp-row${fixed ? ' wgp-row-default' : ''}"><span class="wgp-item">${esc(label)}${pts}${hintChip}</span>${stepper}</div>`;
    };
    // Default items at this size, minus whatever the picked swaps removed.
    const removedBy = new Map();
    groups.forEach((rows) => rows.forEach((r) => {
      const n = counts.get(r.key) || 0; if (!n) return;
      effReplaces(r.opt, r.grp).forEach((x) => removedBy.set(x.id, (removedBy.get(x.id) || 0) + n));
    }));
    defaultsFor(profile, models).forEach((d) => {
      const left = Math.max(0, (d.count || 0) - (removedBy.get(d.id) || 0));
      html += row(cap(d.name), left, null, 'default', true);
    });
    // Everything the datasheet lets you take instead of / on top of that.
    groups.forEach((rows, model) => rows.forEach((r) => {
      const hint = (r.opt.constraint && r.opt.constraint.model_name) ? model : '';
      html += row(cap(names(r.grp)), counts.get(r.key) || 0, r, hint, false);
    }));
    html += '</div>';
    if (anyPriced || wgLive) html += `<div class="wgp-note wgp-total">Wargear points: +${wgLive} pts</div>`;
    host.innerHTML = html;
    restoreStepperFocus(host, refocus);
    updateBannerPts(unit, wgLive);
  }

  // Banner points (big number, top of the details pane) track the LIVE cost:
  // selected squad size's base points + current wargear points. The banner
  // renders pointsOptions as "main / sub / sub" — only the leading number is
  // the main value, so replace just those digits and keep the dimmed subs.
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

  // Mount into the placeholder detail.js renders under the Add box.
  App.WargearPicker = {
    mount(unit, panel) {
      const host = panel.querySelector('#detail-wargear-picker');
      if (!host || !unit || !unit.wargearProfile) return;
      panelEl = panel;
      // Entry-bound render? (army-list click sets selectedArmyEntryIndex and
      // renders the detail pane for that entry's unit)
      const s = App.state || {};
      const selEntry = (s.selectedArmyEntryIndex != null && s.currentArmy)
        ? s.currentArmy.entries[s.selectedArmyEntryIndex] : null;
      const ei = (selEntry && selEntry.unitId === unit.id) ? s.selectedArmyEntryIndex : null;
      if (unit.id !== unitId || ei !== entryIndex) {
        unitId = unit.id;
        entryIndex = ei;
        counts = new Map();
        // Seed from the entry's saved selections so the pane shows (and
        // edits) the squad's ACTUAL loadout.
        const entry = currentEntry();
        ((entry && entry.wargear) || []).forEach((w) => {
          if (w && w.optionId && w.count) {
            counts.set(w.optionId + ':' + (w.choice == null ? 0 : w.choice), w.count);
          }
        });
      }
      // Editing an existing entry: preselect ITS squad size so limits, the
      // banner, and the live wargear total describe the squad being edited.
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

      // Steppers (one delegated listener per mount — host is fresh DOM).
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.wgp-btn');
        if (!btn) return;
        const key = btn.closest('.wgp-stepper').dataset.key;
        const cur = counts.get(key) || 0;
        const next = Math.max(0, cur + (btn.classList.contains('wgp-plus') ? 1 : -1));
        counts.set(key, Math.min(next, maxFor(unit, key)));
        render(unit, host);
        syncEntry(unit);   // no-op unless this pane edits an army entry
      });
      // Squad-size change → limits recompute.
      const sizeSel = panel.querySelector('#detail-squad-select');
      if (sizeSel && !sizeSel._wgpWired) {
        sizeSel._wgpWired = true;
        sizeSel.addEventListener('change', () => render(unit, host));
      }
    },

    // Full effective loadout for a squad: defaults at `models` size adjusted
    // by the entry's saved wargear selections (adds − replaced), plus taken
    // items that aren't defaults. Returns Map lowercased item name →
    // { name, count }, or null when the unit has no profile. Used by the
    // card exporter to stamp ×N on every weapon row.
    effectiveCounts(unit, models, selections) {
      const profile = unit && unit.wargearProfile;
      if (!profile) return null;
      const defaults = defaultsFor(profile, models);
      const added = new Map(), removed = new Map();
      (selections || []).forEach((sel) => {
        if (!sel || !sel.optionId || !sel.count) return;
        const opt = profile.options.find((o) => o.id === sel.optionId);
        if (!opt) return;
        const grp = opt.choices[sel.choice == null ? 0 : sel.choice] || [];
        grp.forEach((x) => added.set(x.id, (added.get(x.id) || 0) + sel.count));
        effReplaces(opt, grp).forEach((x) => removed.set(x.id, (removed.get(x.id) || 0) + sel.count));
      });
      const out = new Map();
      const put = (name, count) => { const k = String(name).toLowerCase(); out.set(k, { name, count }); };
      const seen = new Set();
      defaults.forEach((d) => {
        seen.add(d.id);
        put(d.name, Math.max(0, d.count + (added.get(d.id) || 0) - (removed.get(d.id) || 0)));
      });
      // Taken items that aren't part of the default loadout.
      profile.options.forEach((opt) => {
        opt.choices.forEach((grp) => grp.forEach((x) => {
          if (seen.has(x.id) || !added.get(x.id)) return;
          seen.add(x.id);
          put(x.name, added.get(x.id));
        }));
      });
      return out;
    },

    // Snapshot the pending config for addUnit(); keeps state so adding a
    // second copy of the squad reuses the same loadout.
    takeSelections(unit) {
      if (!unit || unit.id !== unitId || !unit.wargearProfile) return [];
      const out = [];
      unit.wargearProfile.options.forEach((opt) => {
        opt.choices.forEach((grp, ci) => {
          const n = counts.get(opt.id + ':' + ci) || 0;
          if (!n) return;
          out.push({
            optionId: opt.id,
            choice: ci,
            count: n,
            label: cap(names(grp)),
            items: grp.map((x) => x.name),
            // NET delta per take (may be negative — swapping away a priced
            // default refunds it; army.js floors the entry total at 0).
            pts: groupCost(unit.wargearProfile, opt, grp),
          });
        });
      });
      return out;
    },
  };
})();
