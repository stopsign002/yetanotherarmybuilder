// parser/report.js — dev-only parse coverage report (opt-in via localStorage).
(function () {
  if (!window.WahapediaParser) return;
  const P = window.WahapediaParser;

  window._yaabParseReport = window._yaabParseReport || {
    parsedFactions: [],
    emptyUnits: [],
    warnings: [],
  };

  function debugEnabled() {
    try { return localStorage.getItem('yaab_parse_debug') === '1'; }
    catch (_) { return false; }
  }

  const origParse = P.parse;
  if (typeof origParse !== 'function') return;

  P.parse = function wrappedParse() {
    const result = origParse.apply(this, arguments);
    try {
      const report = window._yaabParseReport;
      const factionName = (result && result.factionName) ||
        (result && result.name) || '(unknown)';
      const units = (result && result.units) || [];

      report.parsedFactions.push({
        factionName,
        unitCount: units.length,
        at: Date.now(),
      });

      const anyEmpty = units.some(u => {
        const noWeapons = !u || !Array.isArray(u.weapons) || u.weapons.length === 0;
        const noStats   = !u || !u.stats || Object.keys(u.stats).length === 0;
        return noWeapons || noStats;
      });

      if (anyEmpty) {
        report.warnings.push({
          factionName,
          reason: 'empty-weapons-or-stats',
        });
        units.forEach(u => {
          if (!u) return;
          const noWeapons = !Array.isArray(u.weapons) || u.weapons.length === 0;
          const noStats = !u.stats || Object.keys(u.stats).length === 0;
          if (noWeapons || noStats) {
            report.emptyUnits.push({
              faction: factionName,
              unit: u.name || u.id || '(unnamed)',
              noWeapons,
              noStats,
            });
          }
        });
      }

      // Detachments with zero enhancements. Almost every 10e detachment
      // ships ≥ 3 enhancements; an empty list is overwhelmingly the
      // diacritic-mismatch class of bug (Needgaârd → Needgaard) rather
      // than legitimate. Flagging zero-enhancement detachments turns
      // those into a noisy warning instead of silent loss.
      const detachments = (result && result.detachments) || [];
      detachments.forEach(d => {
        if (!d || !Array.isArray(d.enhancements)) return;
        if (d.enhancements.length === 0) {
          report.warnings.push({
            factionName,
            reason: 'detachment-no-enhancements',
            detachment: d.name,
          });
        }
      });

      // Weapon-profile names that still start with the "➤" variant glyph.
      // stats.js strips this when parsing; surviving entries indicate a
      // path that bypasses parseDirectProfiles (custom collector, future
      // BSData encoding change, etc.).
      const variantRe = /^[➤▶►▸>]/;
      let variantPrefixed = 0;
      units.forEach(u => {
        if (!u || !Array.isArray(u.weapons)) return;
        u.weapons.forEach(w => { if (w && variantRe.test(w.name || '')) variantPrefixed++; });
      });
      if (variantPrefixed > 0) {
        report.warnings.push({
          factionName,
          reason: 'weapons-with-variant-glyph',
          count: variantPrefixed,
        });
      }
    } catch (_) {}
    return result;
  };

  const App = window.App;
  if (App && App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(function () {
      if (!debugEnabled()) return;
      const r = window._yaabParseReport;
      console.group('[Parser Report]');
      console.table(r.emptyUnits);
      console.groupEnd();
    });
  }

  Object.defineProperty(P, 'lastReport', {
    get: function () { return window._yaabParseReport; },
    configurable: true,
  });
})();
