// app/url-share.js — encode/decode current army into `?a=YAAB1:...` URL.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const PARAM = 'a';
  let imported = false;

  function readParam() {
    try {
      const usp = new URLSearchParams(window.location.search);
      return usp.get(PARAM);
    } catch (_) { return null; }
  }

  async function tryImport(raw) {
    if (imported) return true;
    if (!App.state || !Array.isArray(App.state.factions) || App.state.factions.length === 0) {
      return false;
    }
    imported = true;
    try {
      const { army, chapter, detachment } = await Storage.importArmyFromString(raw, {
        factions: App.state.factions,
      });
      App.state.armyManager.saveArmy(army);
      App.state.currentArmy = army;
      App.state.armyManager.currentArmy = army;
      if (typeof App.applyImportedSelections === 'function') {
        App.applyImportedSelections(army.factionName, chapter, detachment);
      }
      if (window.UI && typeof UI.renderArmyList === 'function') {
        UI.renderArmyList(App.state.currentArmy);
      }
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('Loaded from URL', 'success');
      }
      try {
        const url = window.location.origin + window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', url);
      } catch (_) {}
    } catch (err) {
      imported = false;
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('URL import failed: ' + err.message, 'error', 5000);
      }
    }
    return true;
  }

  App.hooks.bootstrap.push(function (state) {
    const raw = readParam();
    if (!raw) return;
    if (tryImport(raw)) return;

    const started = Date.now();
    const timer = setInterval(() => {
      if (imported || Date.now() - started > 60000) {
        clearInterval(timer);
        return;
      }
      tryImport(raw).then(ok => { if (ok) clearInterval(timer); });
    }, 500);
  });

  async function onShareClick() {
    if (!App.state || !App.state.currentArmy) return;
    try {
      const state = App.state;
      const code = await Storage.exportArmyToString(state.currentArmy, {
        factionName:    state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : '',
        chapter:        state.selectedChapter,
        detachmentName: state.selectedDetachment ? state.selectedDetachment.name : null,
      });
      const url = window.location.origin + window.location.pathname + '?a=' + code;
      try {
        await navigator.clipboard.writeText(url);
        if (window.UI) UI.toast('Link copied', 'success');
      } catch (_) {
        if (window.UI) UI.toast('Clipboard unavailable — link: ' + url, 'info', 8000);
      }
    } catch (err) {
      if (window.UI) UI.toast('Share failed: ' + err.message, 'error', 5000);
    }
  }

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-share',
    label: 'Share Link',
    title: 'Copy a shareable URL for this army',
    className: 'btn btn-sm btn-outline',
    onClick: onShareClick,
  });
})();
