// app/entry-rehydrate.js — refresh army entries' unitData snapshots.
//
// Army entries embed a COPY of the unit object taken at add-time (and that
// snapshot round-trips through localStorage and cloud sync). Anything the
// data layer learns later — new core-ability flags, wargear abilities,
// wargearProfile, corrected points — never reaches old entries, so printed
// cards and the details pane can render a months-old view of the datasheet.
//
// This module swaps each entry's unitData for the freshly-built unit object
// (matched by unitId, preferring the snapshot's faction) once factions are
// loaded, and again whenever the current army changes. In-place and silent:
// updatedAt is NOT touched, so sync never sees a phantom edit; the refreshed
// snapshot persists naturally with the army's next real save.
//
// Swapping unitData is not enough on its own for POINTS, because the cost an
// army actually bills lives on the entry itself (`selectedPts`, copied from
// the chosen squad option at add-time) and never looked at the datasheet
// again. `repairSelectedPts` below closes that gap.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Does the user have a manual dataslate override on this unit? If so its
  // squadOptions are deliberately shifted off the official cost and we must
  // not "correct" the entry back — that price is the user's, not data.
  function hasOverride(unitId) {
    return typeof App.getPointsOverride === 'function'
      && App.getPointsOverride(unitId) != null;
  }

  // Re-read the entry's price off the current datasheet when the stored one no
  // longer exists there.
  //
  // Why this is needed: `selectedPts` is a snapshot of a squad option's cost,
  // taken once when the unit was added, and every later data correction slid
  // past it. Orks Trukk shipped at 65 pts from 2026-07-09 to 2026-07-28 (the
  // MFM scrape had captured only its 4th-copy surcharge band and not the 55 pt
  // base), so armies built in that window kept billing 65 for a lone Trukk
  // long after the data itself was fixed.
  //
  // The rule is deliberately narrow. We only act when the stored price matches
  // NO option on the fresh datasheet, and only when we can still tell which
  // squad SIZE the user picked. Size is the user's choice; the price attached
  // to that size is data. Re-reading the price for the same size is a
  // correction — it can never silently re-pick a different unit size.
  function repairSelectedPts(entry, prevUnit, fresh) {
    if (entry.selectedPts == null) return false;
    const opts = (fresh && Array.isArray(fresh.squadOptions)) ? fresh.squadOptions : null;
    if (!opts || !opts.length) return false;
    if (opts.some((o) => o.pts === entry.selectedPts)) return false;  // still a real price
    if (hasOverride(entry.unitId)) return false;

    // Which size? Prefer the saved label, then the pre-refresh snapshot's own
    // option list, then the case where there is only one size to begin with.
    let models = null;
    const m = /^(\d+)\s+model/.exec(entry.squadLabel || '');
    if (m) models = parseInt(m[1], 10);
    if (models == null && prevUnit && Array.isArray(prevUnit.squadOptions)) {
      const prev = prevUnit.squadOptions.find((o) => o.pts === entry.selectedPts);
      if (prev && prev.models != null) models = prev.models;
    }

    let pick = null;
    if (models != null) pick = opts.find((o) => o.models === models) || null;
    else if (opts.length === 1) pick = opts[0];
    if (!pick || pick.pts === entry.selectedPts) return false;       // can't tell — leave it alone

    entry.selectedPts = pick.pts;
    if (pick.models) entry.squadLabel = `${pick.models} models`;
    return true;
  }

  // Enhancement and wargear prices are ALSO add-time copies on the entry
  // (`enhancements[i].pts`, `wargear[i].pts`), so after an MFM change they
  // disagree with the live default-loadout cost army.js recomputes. Re-read
  // both. Enhancements: by name, from the selected detachments first, then
  // from every detachment of the unit's faction (and its chapter parent) —
  // the latter only when all same-named enhancements there agree on a price.
  // Wargear: the stored selection names its option id + choice index, so the
  // NET delta is recomputed against the fresh wargearProfile exactly as the
  // picker would. Anything that no longer resolves is left alone.
  function enhancementPrice(name, facName) {
    const key = String(name || '').toLowerCase();
    if (!key) return null;
    const s = App.state || {};
    const fromDets = (dets) => {
      const prices = new Set();
      (dets || []).forEach((d) => (d && d.enhancements || []).forEach((x) => {
        if (x && String(x.name || '').toLowerCase() === key && Number.isFinite(x.pts)) prices.add(x.pts);
      }));
      return prices.size === 1 ? prices.values().next().value : null;
    };
    const sel = fromDets(s.selectedDetachments);
    if (sel != null) return sel;
    const facs = s.factions || [];
    const names = [facName, App.CHAPTER_PARENTS && App.CHAPTER_PARENTS[facName]].filter(Boolean);
    const dets = [];
    facs.forEach((f) => { if (names.indexOf(f.factionName) !== -1) dets.push(...(f.detachments || [])); });
    return fromDets(dets);
  }

  // Mirror of wargear-picker.js's private groupCost/effReplaces (prefer an
  // exported App.WargearPicker.groupCost if that module ever offers one). Keep
  // the two in step: this is what the entry is billed.
  function groupCost(profile, opt, grp) {
    if (App.WargearPicker && typeof App.WargearPicker.groupCost === 'function') {
      return App.WargearPicker.groupCost(profile, opt, grp);
    }
    const ic = profile.itemCosts;
    let d = opt.cost || 0;
    if (!ic) return d;
    const reps = opt.replaces || [];
    const eff = (reps.length <= 1 || opt.andSwap || (grp && grp.length > 1)) ? reps : [reps[0]];
    (grp || []).forEach((x) => { d += ic[x.id] || 0; });
    eff.forEach((x) => { d -= ic[x.id] || 0; });
    return d;
  }

  function repairAddOnPts(entry, fresh) {
    let changed = false;
    const facName = (fresh && fresh._factionName) || (entry.unitData && entry.unitData._factionName) || '';
    (entry.enhancements || []).forEach((x) => {
      if (!x || !x.name) return;
      const pts = enhancementPrice(x.name, facName);
      if (pts != null && pts !== x.pts) { x.pts = pts; changed = true; }
    });
    const prof = fresh && fresh.wargearProfile;
    if (prof && Array.isArray(prof.options)) {
      (entry.wargear || []).forEach((w) => {
        if (!w || w.optionId == null || w.choice == null) return;
        const opt = prof.options.find((o) => o && o.id === w.optionId);
        const grp = opt && opt.choices && opt.choices[w.choice];
        if (!grp) return;
        const pts = groupCost(prof, opt, grp);
        if (Number.isFinite(pts) && pts !== w.pts) { w.pts = pts; changed = true; }
      });
    }
    return changed;
  }

  // An entry whose unitId matches NO current unit is stuck: findUnit misses,
  // nothing above runs, and the add-time snapshot (and its price) lives on
  // forever. That is every entry added before the 40kdc cutover — they carry
  // BattleScribe GUIDs ("81bd-ce4e-229f-a88") where the dataset now keys
  // "azrael" (#101: 106 such entries across 13 saved armies, still on
  // pre-codex points and T4 marines). id-migration.js already holds the
  // GUID→slug map but only ever applied it to Reserves / Requisitions.
  //
  // Resolution order: the GUID→slug map, then the datasheet NAME within the
  // snapshot's own faction, then the name anywhere — but only if every unit of
  // that name shares one id (a generic Space Marines unit appears under each
  // chapter with the same slug; two different datasheets that merely share a
  // name do not resolve). Returns the current unit or null; never guesses.
  const foldName = (s) => String(s || '').toLowerCase()
    .replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  function resolveStaleId(entry, facName) {
    if (typeof App.migrateUnitId === 'function') {
      const slug = App.migrateUnitId(entry.unitId);
      if (slug) {
        const byMap = App.findUnit(slug, facName);
        if (byMap) return byMap;
      }
    }
    const want = foldName(entry.unitName || (entry.unitData && entry.unitData.name));
    if (!want) return null;
    const all = (App.state && App.state.allUnits) || [];
    const sameName = all.filter((u) => u && foldName(u.name) === want);
    if (!sameName.length) return null;
    const inFaction = sameName.find((u) => u._factionName === facName);
    if (inFaction) return inFaction;
    const ids = new Set(sameName.map((u) => u.id));
    return ids.size === 1 ? sameName[0] : null;
  }

  function rehydrateArmy(army) {
    if (!army || !Array.isArray(army.entries)) return { swapped: 0, repriced: 0, remapped: 0 };
    if (typeof App.findUnit !== 'function') return { swapped: 0, repriced: 0, remapped: 0 };
    let swapped = 0, repriced = 0, remapped = 0;
    army.entries.forEach((e) => {
      if (!e || !e.unitId) return;
      const facName = (e.unitData && e.unitData._factionName) || '';
      let fresh = App.findUnit(e.unitId, facName);
      if (!fresh) {
        fresh = resolveStaleId(e, facName);
        if (!fresh) return;
        // Rewrite the id so every id-keyed consumer (ordinal pricing groups by
        // entry.unitId, Play mode, the cards exporter) sees the current unit,
        // and the datasheet name alongside it — Rule of Three groups on it.
        e.unitId = fresh.id;
        if (fresh.name) e.unitName = fresh.name;
        remapped++;
      }
      const prevUnit = e.unitData;
      if (fresh !== prevUnit) {
        e.unitData = fresh;
        swapped++;
      }
      const a = repairSelectedPts(e, prevUnit, fresh);
      const b = repairAddOnPts(e, fresh);
      if (a || b) repriced++;
    });
    return { swapped, repriced, remapped };
  }

  // Returns the number of entries whose price was corrected, so callers can
  // decide whether the army list needs redrawing.
  App.rehydrateEntryUnitData = function () {
    const s = App.state;
    if (!s || !s.currentArmy) return 0;
    if (!Array.isArray(s.allUnits) || s.allUnits.length === 0) return 0; // factions not ready
    const { swapped, repriced, remapped } = rehydrateArmy(s.currentArmy);
    if (remapped > 0) console.info('[rehydrate] re-pointed', remapped, 'army entries from retired unit ids');
    if (swapped > 0) console.info('[rehydrate] refreshed unitData on', swapped, 'army entries');
    if (repriced > 0) console.info('[rehydrate] re-read current points on', repriced, 'army entries');
    return repriced;
  };

  // Any army landing in state carries whatever snapshots it was saved with —
  // refresh them as soon as it appears. `armyChange('load')` is fired by very
  // few callers, so this listens to every kind: loading a saved army mid-session
  // only fires `'render'`, and that is exactly the path a months-old army takes.
  // The re-entrancy flag is what makes redrawing from inside a `'render'` hook
  // safe; the pass is idempotent (a repaired price matches a squad option, so
  // the second pass is a no-op) and only redraws when something actually moved.
  let busy = false;
  App.hooks.armyChange.push(function () {
    if (busy) return;
    busy = true;
    try {
      const repriced = App.rehydrateEntryUnitData();
      if (repriced > 0 && window.UI && typeof UI.renderArmyList === 'function'
          && App.state && App.state.currentArmy) {
        UI.renderArmyList(App.state.currentArmy);
      }
    } finally {
      busy = false;
    }
  });
})();
