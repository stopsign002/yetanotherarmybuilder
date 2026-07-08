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
  // Scaling budgets are PROPORTIONAL: "2 per 10 models" allows 1 at 5 models
  // (floor(models × count / per)), matching GW's "for every N models" wording.
  function budgetLimitFor(profile, itemId, models) {
    let lim = Infinity;
    (profile.budgets || []).forEach((b) => {
      if (!b.items.some((it) => it.id === itemId)) return;
      const l = (b.perModels > 0 && models) ? Math.floor((models * b.count) / b.perModels) : b.count;
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

  function render(unit, host) {
    const profile = unit.wargearProfile;
    const models = currentModels(unit);
    const defaults = defaultsFor(profile, models);

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

    // Per-item ADD totals and REMOVE totals across all selections.
    const added = new Map(), removed = new Map();
    profile.options.forEach((opt) => {
      opt.choices.forEach((grp, ci) => {
        const n = counts.get(opt.id + ':' + ci) || 0;
        if (!n) return;
        grp.forEach((x) => added.set(x.id, (added.get(x.id) || 0) + n));
        effReplaces(opt, grp).forEach((x) => removed.set(x.id, (removed.get(x.id) || 0) + n));
      });
    });
    const itemTotals = added;   // budget checks count what's been TAKEN

    // Effective default counts after all swaps. Negative = the selections
    // collectively swap out more of an item than the squad carries — the
    // cascade signal (e.g. a pair-swap consumed a storm bolter, so one fewer
    // storm shield can be taken).
    const effById = new Map();
    defaults.forEach((d) => effById.set(d.id, d.count + (added.get(d.id) || 0) - (removed.get(d.id) || 0)));
    const depleted = (opt, grp) =>
      effReplaces(opt, grp).filter((x) => effById.has(x.id) && effById.get(x.id) < 0);

    // For each default item, the (option, choice) pairs that actually replace
    // it — a single unambiguous pair gets proxy steppers on the default row
    // itself ("remove a gauss flayer" = take one of its replacement).
    const replacerFor = (itemId) => {
      const pairs = [];
      profile.options.forEach((opt) => {
        opt.choices.forEach((grp, ci) => {
          if (effReplaces(opt, grp).some((x) => x.id === itemId)) pairs.push(opt.id + ':' + ci);
        });
      });
      return pairs.length === 1 ? pairs[0] : null;
    };

    // Right-side hover: the official (GDC) wargear-option wording, so the
    // datasheet text is one hover away while making selections.
    let officialText = '';
    if (typeof unit.gdcLoadout === 'string' && unit.gdcLoadout) {
      officialText += 'Every model is equipped with: ' + unit.gdcLoadout;
    }
    if (Array.isArray(unit.gdcWargear) && unit.gdcWargear.length) {
      const lines = unit.gdcWargear.map((l) => String(l).replace(/\s*◦\s*/g, '\n   • '));
      officialText += (officialText ? '\n\n' : '') + lines.join('\n\n');
    }
    const infoHtml = officialText
      ? `<span class="wgp-info has-tooltip" data-tooltip="${esc(officialText)}">official wording</span>`
      : '';
    let html = `<div class="detail-section-title detail-section-title-wargear wgp-band"><span>Wargear</span>${infoHtml}</div>`;

    // ── Default loadout with LIVE effective counts ──
    if (defaults.length) {
      let negNote = false;
      html += `<div class="wgp-option wgp-defaults"><div class="wgp-option-head">
        <span class="wgp-replaces">Default loadout${models ? ' — ' + models + ' models' : ''}</span>
      </div>`;
      defaults.forEach((d) => {
        const eff = effById.get(d.id);
        const neg = eff < 0;
        if (neg) negNote = true;
        const proxy = replacerFor(d.id);
        const stepper = proxy
          ? `<span class="wgp-stepper" data-key="${esc(proxy)}" data-proxy="1">
              <button type="button" class="wgp-btn wgp-plus" aria-label="Remove one (swap it out)">&minus;</button>
              <span class="wgp-count${eff < d.count ? ' wgp-count-dim' : ''}">${eff}</span>
              <button type="button" class="wgp-btn wgp-minus" aria-label="Add one back">+</button>
            </span>`
          : `<span class="wgp-eff${eff < d.count ? ' wgp-count-dim' : ''}${neg ? ' wgp-neg' : ''}">×${eff}</span>`;
        html += `<div class="wgp-row${neg ? ' wgp-row-over' : ''}">
          <span class="wgp-item">${esc(cap(d.name))}</span>
          ${stepper}
        </div>`;
      });
      if (negNote) html += `<div class="wgp-note">More swapped out than the squad carries</div>`;
      html += `</div>`;
    }
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

      // Label mirrors the semantics: AND pair-swaps join with "+", OR lists
      // join with "or" (only one of them is given up per swap).
      const isPairSwap = opt.andSwap || opt.choices.some((g) => g.length > 1);
      const replacesLabel = !opt.replaces.length ? 'Add'
        : opt.replaces.length === 1 || isPairSwap
          ? 'Replace ' + names(opt.replaces)
          : 'Replace ' + opt.replaces.map((x) => x.name).slice(0, -1).join(', ')
            + ' or ' + opt.replaces[opt.replaces.length - 1].name;
      html += `<div class="wgp-option${overOpt ? ' wgp-over' : ''}" data-option="${esc(opt.id)}">
        <div class="wgp-option-head">
          <span class="wgp-replaces">${esc(replacesLabel)}</span>
          <span class="wgp-chip">${esc(constraintChip(profile, opt, models))}</span>
        </div>`;
      const shortNames = new Set();
      opt.choices.forEach((grp, ci) => {
        const key = opt.id + ':' + ci;
        const n = counts.get(key) || 0;
        // Cascade: this row is red when the item(s) it swaps out are already
        // exhausted by other selections (nothing left to replace).
        const short = n > 0 ? depleted(opt, grp) : [];
        short.forEach((x) => shortNames.add(x.name));
        const rowOver = overOpt && n > 0 || short.length > 0 || grp.some((x) => overBudgetItems.has(x.id));
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
      } else if (shortNames.size) {
        html += `<div class="wgp-note">Not enough ${esc([...shortNames].join(' / '))} left to swap</div>`;
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
