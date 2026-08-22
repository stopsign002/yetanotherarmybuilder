// app/render.js — top-level render pipelines that combine filter + UI calls.
(function () {
  const App = window.App = window.App || {};

  // Pending requestAnimationFrame id for the coalesced boot repaints — see
  // App.scheduleRosterRender below. Declared here because both renderAll and
  // renderUnitRosterWithContext cancel it.
  let pendingRaf = 0;

  // The units-pane "All factions" view (reserves.js view switcher) bypasses
  // the faction filter entirely so a unit can be searched across every army
  // even while a faction/chapter is selected.
  function effectiveRosterFilter() {
    if (App.Reserves && typeof App.Reserves.getView === 'function'
        && App.Reserves.getView() === 'everything') {
      return { factionFilter: 'all', linkedFactions: [] };
    }
    return App.getEffectiveFilter();
  }

  App.renderAll = function () {
    if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0; }
    const state = App.state;
    UI.updateFactionFilter(state.factions, {
      hide:   state.chapterFactions,
      extras: Object.keys(state.chaptersMap),
    });
    const { factionFilter, linkedFactions } = effectiveRosterFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
    UI.renderArmyList(state.currentArmy);
  };

  // ── Coalesced roster repaints ───────────────────────────────────────────
  // renderUnitRoster is expensive in a way its own early-outs cannot fix: the
  // content-signature skip at the top of the function can only fire AFTER the
  // filter chain has run, because the rosterFilters predicates read module-
  // private state (favorites, reserves, collection, legends, kill-team) that
  // the signature can't cheaply capture. So a no-op call still pays for the
  // full pass over ~1.7k units plus the fireSelectionChange fan-out to ~25
  // subscribers. Measured on a cold boot: 38 calls, 2 of which rebuilt the
  // grid, 9.9s of self time — 67% of the profile.
  //
  // The worst offender is boot. dc-adapter's loadAllFactions hands us all 34
  // factions in ONE synchronous forEach (js/data/dc-adapter.js), so the ~34
  // per-faction repaints cannot paint anything — the browser never gets a
  // frame between them. Routing those through a requestAnimationFrame gate
  // collapses them into a single render at the end of the tick, with no
  // change to what the user sees. On the dormant per-file bsdata.js loader,
  // which really does await between factions, the same gate degrades to one
  // paint per frame, which is the streaming behaviour you'd want anyway.
  //
  // Callers that must render NOW (a click, a keystroke, a faction switch)
  // keep calling renderUnitRosterWithContext directly; it cancels any frame
  // this gate has queued so the two can never both fire for one change.
  App.scheduleRosterRender = function () {
    if (pendingRaf) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      App.renderUnitRosterWithContext();
    });
  };

  // Turn a queued frame into an immediate render. Called at the end of the
  // boot load: requestAnimationFrame does not fire in a background tab, so a
  // boot that completes while the tab is hidden would otherwise leave the
  // roster unpainted until the user came back to it. No-op when nothing is
  // queued, so this never adds a render of its own.
  App.flushRosterRender = function () {
    if (!pendingRaf) return;
    App.renderUnitRosterWithContext();
  };

  App.renderUnitRosterWithContext = function () {
    // A direct render supersedes anything the gate has queued. Note this does
    // NOT touch App._rosterFilterPass (js/ui/roster.js) — that counter is
    // bumped once per actual renderUnitRoster call and reserves.js's dedupe
    // predicate keys its seen-set to it, so skipping a render must skip the
    // bump too, which is exactly what cancelling the frame achieves.
    if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0; }
    const state = App.state;
    const { factionFilter, linkedFactions } = effectiveRosterFilter();
    UI.renderUnitRoster(
      state.allUnits,
      document.getElementById('search-input').value,
      factionFilter,
      state.selectedUnit ? state.selectedUnit.id : null,
      linkedFactions
    );
    if (typeof App.fireSelectionChange === 'function') App.fireSelectionChange();
  };
})();
