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

  App.updateDetachmentOptions = function () {
    const state  = App.state;
    const select = document.getElementById('army-detachment-select');
    const detFaction = App.getDetachmentFaction();
    state.detachmentFaction = detFaction;

    if (!detFaction) {
      select.innerHTML = '<option value="">— Select Faction First —</option>';
      return;
    }

    const detachments = (detFaction.detachments || []);
    if (detachments.length === 0) {
      select.innerHTML = '<option value="">— No Detachments Found —</option>';
      return;
    }

    select.innerHTML = '<option value="">— Select Detachment —</option>';
    detachments.forEach(d => {
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
