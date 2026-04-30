/* keywords.js — categoryLink-based keyword extraction and generic dedup. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  function parseKeywords(entryEl) {
    const kws = [];
    entryEl.querySelectorAll(':scope > categoryLinks > categoryLink').forEach(link => {
      const name = I.getAttr(link, 'name', '').trim();
      if (!name || /^new\s+category/i.test(name)) return;
      kws.push(name);
    });
    return kws;
  }

  // dedup(arr, key) — `key` may be a string property name (e.g. 'name')
  // or a function (item => composite-key). Composite keys are used by the
  // weapon collector so a ranged and a melee weapon sharing a name (e.g.
  // Plasmancer / Technomancer, both with a "Staff of Light" in each kind)
  // are treated as distinct entries instead of one masking the other.
  function dedup(arr, key) {
    const seen = new Set();
    const get = typeof key === 'function' ? key : item => item[key];
    return arr.filter(item => {
      const k = get(item);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  I.parseKeywords = parseKeywords;
  I.dedup         = dedup;
})();
