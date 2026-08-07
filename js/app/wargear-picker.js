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

  function currentEntry() {
    const s = App.state || {};
    if (entryIndex == null || !s.currentArmy) return null;
    return s.currentArmy.entries[entryIndex] || null;
  }

  // Live write-back for entry-bound panes: same flow as the enhancement
  // checkboxes — update the entry, persist, re-render the army list.
  function syncEntry(unit) {
    const s = App.state || {};
    if (!currentEntry()) return;
    s.currentArmy.setWargear(entryIndex, App.WargearPicker.takeSelections(unit));
    if (s.armyManager) s.armyManager.saveArmy(s.currentArmy);
    if (window.UI && UI.renderArmyList) UI.renderArmyList(s.currentArmy);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
    const groups = new Map();   // modelName -> [{ key, opt, grp, cost }]
    if (profile.itemCosts) {
      profile.options.forEach((opt) => {
        const model = (opt.constraint && opt.constraint.model_name) || unit.name || 'Any model';
        opt.choices.forEach((grp, ci) => {
          const cost = groupCost(profile, opt, grp);
          if (!cost) return;
          if (!groups.has(model)) groups.set(model, []);
          groups.get(model).push({ key: opt.id + ':' + ci, opt, grp, cost });
        });
      });
    }

    // Live wargear points = priced default loadout at this size + selected
    // deltas, floored at 0 — mirrors army.js getEntryPoints so the banner
    // preview and the added entry agree.
    let wgLive = (profile.alwaysCost || 0) + defaultBasePts(profile, models);
    groups.forEach((rows) => rows.forEach((r) => { wgLive += (counts.get(r.key) || 0) * r.cost; }));
    wgLive = Math.max(0, wgLive);

    if (!groups.size) {
      // No priced options to pick — the official prose covers the free ones.
      // Leave the section empty but keep the banner accurate for the default.
      host.innerHTML = '';
      updateBannerPts(unit, wgLive);
      return;
    }

    let html = '';
    groups.forEach((rows, model) => {
      html += `<div class="wgp-group"><div class="wgp-group-title">${esc(model)}</div>`;
      rows.forEach((r) => {
        const n = counts.get(r.key) || 0;
        const repl = (r.opt.replaces && r.opt.replaces.length)
          ? ` <span class="wgp-chip">replaces ${esc(names(r.opt.replaces))}</span>` : '';
        // The option name goes IN the button label: a unit can render a dozen
        // priced rows, and a bare "Add one" ×12 is unusable in a screen
        // reader's controls rotor. The .wgp-item text alongside is decorative
        // for that purpose — it names no control.
        const label = cap(names(r.grp));
        html += `<div class="wgp-row">
          <span class="wgp-item">${esc(label)}${ptsChip(r.cost)}${repl}</span>
          <span class="wgp-stepper" data-key="${esc(r.key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one ${esc(label)}">&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one ${esc(label)}">+</button>
          </span>
        </div>`;
      });
      html += `</div>`;
    });
    html += `<div class="wgp-note wgp-total">Wargear points: +${wgLive} pts</div>`;
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
        counts.set(key, Math.max(0, cur + (btn.classList.contains('wgp-plus') ? 1 : -1)));
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
