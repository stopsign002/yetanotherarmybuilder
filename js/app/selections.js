// app/selections.js — chapter sub-dropdown, detachment dropdown, import sync.
(function () {
  const App = window.App = window.App || {};

  App.updateChapterDropdown = function (factionName) {
    const state  = App.state;
    const group  = document.getElementById('army-chapter-group');
    const select = document.getElementById('army-chapter-select');
    state.selectedChapter = null;
    const chapters = (factionName && factionName !== 'all')
      ? (state.chaptersMap[factionName] || [])
      : [];
    if (chapters.length === 0) {
      group.hidden = true;
      select.innerHTML = '<option value="">— All —</option>';
      return;
    }
    group.hidden = false;
    const prefix = factionName + ' - ';
    select.innerHTML = '<option value="">— All Chapters —</option>';
    chapters.slice().sort().forEach(c => {
      const label = c.startsWith(prefix) ? c.slice(prefix.length) : c;
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = label;
      select.appendChild(opt);
    });
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
      const name = (d && d.name ? d.name : '').toLowerCase();
      return !forbidden.some(tok => name.includes(tok));
    });
  };

  App.updateDetachmentOptions = function () {
    const state  = App.state;
    const select = document.getElementById('army-detachment-select');
    const detFaction = App.getDetachmentFaction();
    state.detachmentFaction = detFaction;

    if (!detFaction) {
      // Don't blow away an already-populated dropdown while the factions
      // list is still warming up (e.g. a visibility-change-triggered
      // re-render fires before state.factions has finished hydrating).
      // The user otherwise watches their detachment options vanish for
      // no apparent reason when they tab back into the window.
      const factionsReady = Array.isArray(state.factions) && state.factions.length > 0;
      const dropdownHasOptions = select && select.options && select.options.length > 1;
      if (!factionsReady && dropdownHasOptions) return;
      select.innerHTML = '<option value="">— Select Faction First —</option>';
      return;
    }

    let detachments = (detFaction.detachments || []);

    // Catalogue-gated filter: the SM parent catalogue bundles every
    // chapter's detachments (Sons of Sanguinius, Inner Circle Task
    // Force, Champions of Fenris, Blade of Ultramar, …) and tags the
    // chapter-exclusive ones with `onlyCatalogues` / `notCatalogues`
    // (BSData "hide unless primary-catalogue is X" conditions — parsed
    // in js/parser/catalogue.js). Filter against the SELECTED faction's
    // own catalogueId, not the detachment-list faction's (which may be
    // the SM parent we fell back to for the list itself).
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

    // Legacy token-based blocklist — kept as a backstop for any chapter
    // that lacks its own catalogue (so getCurrentFaction has no
    // catalogueId) or detachments parsed before the v29 DB bump.
    const chapter = state.selectedChapter
      || (state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : null);
    if (chapter && typeof App.filterSMDetachmentsForChapter === 'function') {
      detachments = App.filterSMDetachmentsForChapter(detachments, chapter);
    }

    if (detachments.length === 0) {
      select.innerHTML = '<option value="">— No Detachments Found —</option>';
      return;
    }

    select.innerHTML = '<option value="">— Select Detachment —</option>';
    detachments
      .slice()
      .sort((a, b) => String(a && a.name || '').localeCompare(String(b && b.name || ''), undefined, { sensitivity: 'base' }))
      .forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = d.name;
        select.appendChild(opt);
      });
  };

  App.applyImportedSelections = function (factionName, chapter, detachment) {
    const state = App.state;
    const factionSelect    = document.getElementById('army-faction-select');
    const chapterSelect    = document.getElementById('army-chapter-select');
    const detachmentSelect = document.getElementById('army-detachment-select');

    let topLevel = chapter ? (App.getVirtualParentOf(chapter) || factionName) : factionName;
    if (!topLevel) topLevel = 'all';
    const topLevelExists = topLevel === 'all'
      || state.factions.some(f => f.factionName === topLevel)
      || !!state.chaptersMap[topLevel];
    if (!topLevelExists) topLevel = 'all';

    factionSelect.value = topLevel;
    factionSelect.dispatchEvent(new Event('change'));

    if (chapter && [...chapterSelect.options].some(o => o.value === chapter)) {
      chapterSelect.value = chapter;
      chapterSelect.dispatchEvent(new Event('change'));
    }

    if (detachment && [...detachmentSelect.options].some(o => o.value === detachment)) {
      detachmentSelect.value = detachment;
      detachmentSelect.dispatchEvent(new Event('change'));
    }

    document.getElementById('army-name-input').value    = state.currentArmy.name || '';
    document.getElementById('points-limit-input').value = state.currentArmy.pointsLimit || '';
  };
})();
