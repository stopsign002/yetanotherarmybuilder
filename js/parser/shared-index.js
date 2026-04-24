/* shared-index.js — module-level Maps of DOM nodes from .gst / Library *.cat
 * files, used as fallback lookup during catalogue parsing. Must be released
 * after bulk load to free the underlying XML documents. */

(function () {
  window.WahapediaParser = window.WahapediaParser || {};
  const P = window.WahapediaParser;
  P._internal = P._internal || {};

  const _sharedProfilesById = new Map();
  const _sharedRulesById    = new Map();
  const _sharedEntriesById  = new Map();

  function addToSharedIndex(xmlString) {
    try {
      const doc  = new DOMParser().parseFromString(xmlString, 'application/xml');
      if (doc.querySelector('parsererror')) return;
      const root = doc.documentElement;

      root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
        const id = p.getAttribute('id');
        if (id) _sharedProfilesById.set(id, p);
      });
      root.querySelectorAll(':scope > sharedRules > rule, :scope > rules > rule').forEach(r => {
        const id = r.getAttribute('id');
        if (id) _sharedRulesById.set(id, r);
      });
      root.querySelectorAll(
        ':scope > sharedSelectionEntries > selectionEntry, ' +
        ':scope > sharedSelectionEntryGroups > selectionEntryGroup'
      ).forEach(el => {
        const id = el.getAttribute('id');
        if (id) _sharedEntriesById.set(id, el);
      });
    } catch (_) { /* ignore parse failures for the game system */ }
  }

  function releaseSharedIndex() {
    _sharedProfilesById.clear();
    _sharedRulesById.clear();
    _sharedEntriesById.clear();
  }

  P._internal.sharedProfilesById = _sharedProfilesById;
  P._internal.sharedRulesById    = _sharedRulesById;
  P._internal.sharedEntriesById  = _sharedEntriesById;
  P._internal.addToSharedIndex   = addToSharedIndex;
  P._internal.releaseSharedIndex = releaseSharedIndex;
})();
