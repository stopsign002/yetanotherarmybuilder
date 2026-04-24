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

  function dedup(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
      const k = item[key];
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  I.parseKeywords = parseKeywords;
  I.dedup         = dedup;
})();
