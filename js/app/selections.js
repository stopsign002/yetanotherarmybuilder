// app/selections.js — chapter sub-dropdown, detachment dropdown, import sync.
(function () {
  const App = window.App = window.App || {};

  App.updateChapterDropdown = function (factionName) {
    const state  = App.state;
    // Every chapter is a top-level faction option, so there is never a
    // sub-dropdown to show: reset and keep it hidden.
    state.selectedChapter = null;
    document.getElementById('army-chapter-group').hidden = true;
    document.getElementById('army-chapter-select').innerHTML = '<option value="">— All —</option>';
  };

  // Token-based filter: when the user has selected an SM chapter, hide
  // detachments whose names contain tokens that belong to a different
  // chapter (defined in App.SM_CHAPTER_EXCLUSIVE_TOKENS, state.js).
  // Returns the input list untouched if the chapter isn't part of the
  // SM family — non-SM factions are unaffected.
  App.filterSMDetachmentsForChapter = function (detachments, chapterName) {
    if (!Array.isArray(detachments) || !chapterName) return detachments;
    const tokenMap = App.SM_CHAPTER_EXCLUSIVE_TOKENS || {};
    const SM_PARENT = 'Imperium - Adeptus Astartes - Space Marines';
    const isSMChapter = chapterName === SM_PARENT
      || (App.CHAPTER_PARENTS && App.CHAPTER_PARENTS[chapterName] === SM_PARENT);
    if (!isSMChapter) return detachments;

    const forbidden = [];
    for (const ch in tokenMap) {
      if (ch === chapterName) continue;
      forbidden.push(...tokenMap[ch]);
    }
    if (forbidden.length === 0) return detachments;

    return detachments.filter(d => {
      // A detachment carrying `_gdcFactionTag` has already been vetted against
      // GW's own per-detachment chapter tag by the GDC-authority pass
      // (dc-adapter's adoptGdcDetachments) — it is in this faction's list
      // BECAUSE GW says the faction may take it. The token blocklist is a
      // hand-maintained substring heuristic from the BSData era and it gets
      // this wrong in both directions now: GW tags "Deathwatch Support" as
      // generic Adeptus Astartes, so every chapter — vanilla Space Marines
      // included — may take it, yet the 'deathwatch' token would hide it from
      // all of them. Data beats heuristic; untagged lists keep the old rule.
      if (d && d._gdcFactionTag) return true;
      const name = (d && d.name ? d.name : '').toLowerCase();
      return !forbidden.some(tok => name.includes(tok));
    });
  };

  // Compute the detachments available to the current army, applying the same
  // catalogue-gate + chapter token-blocklist the old dropdown used. Sets
  // `state.detachmentFaction` as a side effect (the object the list came from).
  // Returns an (unsorted) array of detachment objects; the picker
  // (js/app/detachment-picker.js) handles grouping/sorting/render. Returns []
  // while the factions list is still warming up.
  App.getAvailableDetachments = function () {
    const state = App.state;
    const detFaction = App.getDetachmentFaction();
    state.detachmentFaction = detFaction;
    if (!detFaction) return [];

    let detachments = (detFaction.detachments || []);

    // Catalogue-gated filter: the SM parent catalogue bundles every chapter's
    // detachments and tags the chapter-exclusive ones with `onlyCatalogues` /
    // `notCatalogues` (dormant BSData path only — inert for 40kdc data). Filter
    // against the SELECTED faction's own catalogueId.
    const selFaction = App.getCurrentFaction();
    const selCatId = selFaction && selFaction.catalogueId;
    if (selCatId) {
      detachments = detachments.filter(d => {
        if (Array.isArray(d.onlyCatalogues) && d.onlyCatalogues.length &&
            d.onlyCatalogues.indexOf(selCatId) === -1) return false;
        if (Array.isArray(d.notCatalogues) && d.notCatalogues.indexOf(selCatId) !== -1) return false;
        return true;
      });
    }

    // Legacy token-based blocklist — backstop for any chapter lacking its own
    // catalogueId (so a chapter never shows another chapter's exclusive detachment).
    const chapter = state.selectedChapter
      || (state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : null);
    if (chapter && typeof App.filterSMDetachmentsForChapter === 'function') {
      detachments = App.filterSMDetachmentsForChapter(detachments, chapter);
    }
    return detachments;
  };

  App.applyImportedSelections = function (factionName, chapter, detachment) {
    const state = App.state;
    const factionSelect    = document.getElementById('army-faction-select');

    // `detachment` may be a single name (legacy saved armies / old share codes)
    // or an array of names (multi-detachment). Normalize to an array.
    const names = Array.isArray(detachment)
      ? detachment.filter(n => typeof n === 'string' && n)
      : (detachment ? [detachment] : []);

    let topLevel = factionName || 'all';
    const topLevelExists = topLevel === 'all'
      || state.factions.some(f => f.factionName === topLevel);
    if (!topLevelExists) topLevel = 'all';

    // Dispatching 'change' on the faction/chapter selects resets the detachment
    // selection to empty (events.js), re-renders the roster, and re-renders the
    // picker for the new faction. Only dispatch when the value ACTUALLY changes:
    // sync's visibility-pull and boot re-apply the SAME selections, and an
    // unconditional dispatch would reset the chapter + re-filter the roster —
    // snapping the user to the top of the units pane every time they tab back.
    if (factionSelect.value !== topLevel) {
      factionSelect.value = topLevel;
      factionSelect.dispatchEvent(new Event('change'));
    }

    // Restore the detachment selection against the now-populated available list.
    if (typeof App.setSelectedDetachments === 'function') {
      App.setSelectedDetachments(names, { persist: false });
    }

    document.getElementById('army-name-input').value    = state.currentArmy.name || '';
    document.getElementById('points-limit-input').value = state.currentArmy.pointsLimit || '';
  };
})();
