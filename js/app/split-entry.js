// app/split-entry.js — "peel one copy off this stack" button on army entries.
//
// WHY THIS EXISTS
// `Army.addUnit` merges plain duplicates: add Necron Warriors twice and you get
// ONE entry with `count: 2`, rendered as one card. But everything that gives a
// unit its own identity hangs off the ENTRY, not off a copy inside it — the
// attachment graph (`attachedToEntryId` names one `entryId`), a custom name, an
// enhancement. So two stacked squads cannot be told apart: a leader dragged
// onto the card attaches to the stack as a whole, and there is no second card
// to drop a second leader on. (Nothing stops you attaching TWO leaders to that
// one card — flip-animations.js does no uniqueness check — but they both read
// as leading the same stack, which is not what a player means.)
//
// This registers one App.hooks.armyEntryActions button, so neither events.js
// nor army-list.js needs a special case for it (editing guidance #2).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !App.hooks.armyEntryActions) return;

  // Two offset sheets pulling apart. Symbol-only and deliberately not a "+" or
  // a copy glyph: this does not add points or duplicate a unit, it separates
  // copies that are already paid for. stroke="currentColor" so every theme and
  // the faction accent reach it without a per-theme icon.
  const SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"'
            + ' fill="none" stroke="currentColor" stroke-width="1.6"'
            + ' stroke-linecap="round" stroke-linejoin="round">'
            + '<rect x="1.1" y="1.1" width="7" height="9" rx="1.4"/>'
            + '<rect x="7.9" y="5.9" width="7" height="9" rx="1.4"/>'
            + '</svg>';

  App.hooks.armyEntryActions.push({
    id: 'split-entry',
    className: 'army-entry-split',
    title: 'Split one copy off as its own unit',
    svg: SVG,
    // Name the unit: a screen reader on a 12-unit list otherwise hears the same
    // two anonymous buttons twelve times with no way to tell the rows apart.
    ariaLabel: (entry) => `Split one copy of ${entry.customName || entry.unitName} off as its own unit`,
    visible: (entry) => Number.isFinite(entry && entry.count) && entry.count > 1,
    onClick: (entry, index, army) => {
      const state = App.state || {};
      const name = entry.customName || entry.unitName;

      // Pin the selection to the entry OBJECT across the splice. Resolving by
      // identity afterwards is immune to where the copy is inserted; the
      // arithmetic version ("if selected > index, add one") silently rots the
      // day somebody changes the insert position.
      const selected = (state.selectedArmyEntryIndex != null)
        ? army.entries[state.selectedArmyEntryIndex] : null;

      const copy = army.splitEntry(index);
      if (!copy) return;

      state.selectedArmyEntryIndex = selected ? army.entries.indexOf(selected) : null;
      if (state.selectedArmyEntryIndex === -1) state.selectedArmyEntryIndex = null;

      if (state.armyManager) state.armyManager.saveArmy(army);
      if (window.UI && UI.renderArmyList) UI.renderArmyList(army);

      // The wargear picker caches the entry's ARRAY INDEX in a module-local
      // that ONLY mount() refreshes (wargear-picker.js) — a re-render does not
      // reconcile it. After a splice that index can address a different entry,
      // and the next stepper nudge would write the open pane's loadout onto the
      // wrong unit, then save and sync it. Re-rendering the detail pane
      // re-mounts the picker against the correct index. See issue #71 for the
      // same latent bug on the remove path.
      const sel = state.selectedArmyEntryIndex;
      if (sel != null && army.entries[sel] && window.UI && UI.renderUnitDetail) {
        const e = army.entries[sel];
        const detEnhs = App.getActiveEnhancements ? App.getActiveEnhancements() : [];
        try { UI.renderUnitDetail(e.unitData, detEnhs, e.enhancements || []); }
        catch (err) { console.warn('[split-entry] detail re-render', err); }
      }

      // Say what did NOT come along, or a user who had named the squad or given
      // it an enhancement reads the split as data loss.
      const kept = [];
      if (entry.customName) kept.push('the custom name');
      if ((entry.enhancements || []).length) kept.push('enhancements');
      const suffix = kept.length ? ` — ${kept.join(' and ')} stayed with the original.` : '';
      if (window.UI && UI.toast) {
        UI.toast(`Split off 1 × ${name}.${suffix}`, 'success', kept.length ? 4200 : 2400);
      }
    },
  });
})();
