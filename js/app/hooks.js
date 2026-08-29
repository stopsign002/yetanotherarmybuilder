// app/hooks.js — extension registry so feature modules don't need to edit
// shared files. Populate arrays from any IIFE; bootstrap / state callers
// below iterate and fire.
(function () {
  const App = window.App = window.App || {};

  App.hooks = {
    // Called once after DOMContentLoaded init (UI.init, renderAll, wireEvents).
    // Signature: fn(state)
    bootstrap: [],

    // Called after any army mutation (add/remove/update/set-enhancements/
    // new army/load army/import). Signature: fn(army, changeKind)
    armyChange: [],

    // Called after faction/chapter/detachment selection changes.
    // Signature: fn(state)
    selectionChange: [],

    // Buttons rendered in the unit-detail header next to Google Images.
    // Entries: { id, title, html, onClick(unit) }
    detailActions: [],

    // Buttons rendered in the army-panel toolbar (bottom of left panel).
    // Entries: { id, label, title, className, onClick() }
    armyToolbarActions: [],

    // Extra filter predicates applied in the roster. Entry: fn(unit) -> bool.
    rosterFilters: [],

    // Extra card-class contributors. Entry: fn(unit) -> string | null.
    cardClassContributors: [],

    // Icon buttons rendered on each army-list entry card, to the left of the
    // remove ×. Kept as a hook so a per-entry action does not have to be
    // special-cased into events.js or army-list.js (editing guidance #2).
    // Entries: {
    //   id,                       // stable; also the click-dispatch key
    //   className,                // extra class on the <button>
    //   title, ariaLabel(entry),  // ariaLabel gets the entry so it can name the unit
    //   svg,                      // inline markup, symbol-only, stroke="currentColor"
    //   visible(entry, index, army) -> bool,
    //   onClick(entry, index, army, ev)
    // }
    // The dispatcher resolves the entry by `entryId` (stable) rather than by
    // array index, so an action that splices entries cannot mis-target.
    armyEntryActions: [],
  };

  App.fireBootstrap = function (state) {
    for (let i = 0; i < App.hooks.bootstrap.length; i++) {
      try { App.hooks.bootstrap[i](state); }
      catch (e) { console.warn('[hooks.bootstrap]', e); }
    }
  };

  App.fireArmyChange = function (kind, armyOverride) {
    const army = (armyOverride !== undefined)
      ? armyOverride
      : (App.state && App.state.currentArmy);
    for (let i = 0; i < App.hooks.armyChange.length; i++) {
      try { App.hooks.armyChange[i](army, kind); }
      catch (e) { console.warn('[hooks.armyChange]', e); }
    }
  };

  App.fireSelectionChange = function () {
    for (let i = 0; i < App.hooks.selectionChange.length; i++) {
      try { App.hooks.selectionChange[i](App.state); }
      catch (e) { console.warn('[hooks.selectionChange]', e); }
    }
  };
})();
