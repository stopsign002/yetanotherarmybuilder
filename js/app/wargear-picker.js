// app/wargear-picker.js — wargear picker in the unit details pane.
//
// Renders under the Add-to-Army box for any unit with a structured
// `wargearProfile` (built by dc-adapter.js from 40kdc wargear options /
// budgets / composition tiers). Configure-then-add: the picker holds a
// pending config for the currently-viewed unit; "Add to Army" (events.js)
// snapshots it onto the new entry via App.WargearPicker.takeSelections().
//
// Limits are SOFT: exceeding a per-model/per-size limit never blocks the
// stepper — the rows turn red with a note so the player knows the loadout
// is illegal at the chosen squad size. Limits recompute live when the
// squad-size select changes.
//
// Costs: every option is free in today's upstream data (cost:0 carried
// through). When 40kdc ships 11e wargear costs the "+N pts" chips and the
// entry points math (army.js getEntryPoints) light up without UI changes.
(function () {
  const App = window.App = window.App || {};

  // Pending config for the viewed unit: 'optionId:choiceIdx' -> count.
  let unitId = null;
  let counts = new Map();

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

  // How many of `modelName` exist at this squad size (null → unknown).
  function eligibleModels(profile, modelName, models) {
    if (!models) return null;
    if (!modelName) return models;
    const tier = profile.modelsBySize && profile.modelsBySize[models];
    if (tier && tier[modelName] != null) return tier[modelName];
    return models; // tier data missing — fall back to whole squad
  }

  // Per-option take limit at the given squad size. Infinity = unbounded.
  function limitFor(profile, opt, models) {
    const c = opt.constraint || {};
    if (c.max_count != null) return c.max_count;
    const elig = eligibleModels(profile, c.model_name || null, models);
    if (c.any_number || c.model_name) return (elig == null) ? Infinity : elig;
    return (elig == null) ? Infinity : elig;
  }

  // Take-budget limit for one item id at the given squad size (Infinity = none).
  function budgetLimitFor(profile, itemId, models) {
    let lim = Infinity;
    (profile.budgets || []).forEach((b) => {
      if (!b.items.some((it) => it.id === itemId)) return;
      const l = (b.perModels > 0 && models) ? Math.floor(models / b.perModels) * b.count : b.count;
      lim = Math.min(lim, l);
    });
    return lim;
  }

  function constraintChip(profile, opt, models) {
    const c = opt.constraint || {};
    const bits = [];
    if (c.model_name) bits.push(c.model_name + ' only');
    if (c.max_count != null) bits.push('max ' + c.max_count);
    else if (c.any_number) bits.push('any number');
    // Surface a scaling budget on the chip when one governs this option's items.
    (profile.budgets || []).forEach((b) => {
      if (b.perModels > 0 && opt.choices.some((grp) => grp.some((x) => b.items.some((it) => it.id === x.id)))) {
        bits.push(b.count + ' per ' + b.perModels + ' models');
      }
    });
    return bits.length ? bits.join(' · ') : 'any model';
  }

  function render(unit, host) {
    const profile = unit.wargearProfile;
    const models = currentModels(unit);

    // Per-item totals across all selections (for budget checks).
    const itemTotals = new Map();
    profile.options.forEach((opt) => {
      opt.choices.forEach((grp, ci) => {
        const n = counts.get(opt.id + ':' + ci) || 0;
        if (!n) return;
        grp.forEach((x) => itemTotals.set(x.id, (itemTotals.get(x.id) || 0) + n));
      });
    });

    let html = `<div class="detail-section-title detail-section-title-wargear">Wargear Options</div>`;
    profile.options.forEach((opt) => {
      const lim = limitFor(profile, opt, models);
      const total = opt.choices.reduce((s, _g, ci) => s + (counts.get(opt.id + ':' + ci) || 0), 0);
      const overOpt = total > lim;
      // Budget check: any chosen item over its budget marks the rows carrying it.
      const overBudgetItems = new Set();
      opt.choices.forEach((grp, ci) => {
        if (!(counts.get(opt.id + ':' + ci) || 0)) return;
        grp.forEach((x) => {
          if ((itemTotals.get(x.id) || 0) > budgetLimitFor(profile, x.id, models)) overBudgetItems.add(x.id);
        });
      });

      html += `<div class="wgp-option${overOpt ? ' wgp-over' : ''}" data-option="${esc(opt.id)}">
        <div class="wgp-option-head">
          <span class="wgp-replaces">${opt.replaces.length ? 'Replace ' + esc(names(opt.replaces)) : 'Add'}</span>
          <span class="wgp-chip">${esc(constraintChip(profile, opt, models))}</span>
        </div>`;
      opt.choices.forEach((grp, ci) => {
        const key = opt.id + ':' + ci;
        const n = counts.get(key) || 0;
        const rowOver = overOpt && n > 0 || grp.some((x) => overBudgetItems.has(x.id));
        html += `<div class="wgp-row${rowOver ? ' wgp-row-over' : ''}">
          <span class="wgp-item">${esc(cap(names(grp)))}${opt.cost ? ` <span class="wgp-pts">+${opt.cost} pts</span>` : ''}</span>
          <span class="wgp-stepper" data-key="${esc(key)}">
            <button type="button" class="wgp-btn wgp-minus" aria-label="Remove one">&minus;</button>
            <span class="wgp-count">${n}</span>
            <button type="button" class="wgp-btn wgp-plus" aria-label="Add one">+</button>
          </span>
        </div>`;
      });
      if (overOpt) {
        html += `<div class="wgp-note">Exceeds limit — ${lim === Infinity ? 'over budget' : 'max ' + lim}${models ? ' for ' + models + ' models' : ''}</div>`;
      } else if (overBudgetItems.size) {
        html += `<div class="wgp-note">Over the take-limit for: ${esc([...overBudgetItems].map((id) => {
          for (const o of profile.options) for (const g of o.choices) { const hit = g.find((x) => x.id === id); if (hit) return hit.name; }
          return id;
        }).join(', '))}</div>`;
      }
      html += `</div>`;
    });
    host.innerHTML = html;
  }

  // Mount into the placeholder detail.js renders under the Add box.
  App.WargearPicker = {
    mount(unit, panel) {
      const host = panel.querySelector('#detail-wargear-picker');
      if (!host || !unit || !unit.wargearProfile) return;
      if (unit.id !== unitId) { unitId = unit.id; counts = new Map(); }
      render(unit, host);

      // Steppers (one delegated listener per mount — host is fresh DOM).
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.wgp-btn');
        if (!btn) return;
        const key = btn.closest('.wgp-stepper').dataset.key;
        const cur = counts.get(key) || 0;
        counts.set(key, Math.max(0, cur + (btn.classList.contains('wgp-plus') ? 1 : -1)));
        render(unit, host);
      });
      // Squad-size change → limits recompute.
      const sizeSel = panel.querySelector('#detail-squad-select');
      if (sizeSel && !sizeSel._wgpWired) {
        sizeSel._wgpWired = true;
        sizeSel.addEventListener('change', () => render(unit, host));
      }
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
            pts: opt.cost || 0,
          });
        });
      });
      return out;
    },
  };
})();
