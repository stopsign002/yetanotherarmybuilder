// js/ui/unit-card-themes.js — adds a `faction-<slug>` class to unit cards so unit-card-themes.css can paint per-faction gradients + accent stripes.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !Array.isArray(App.hooks.cardClassContributors)) return;

  // Slugify "T'au Empire" → "t-au-empire", "Imperium - Space Marines" → "space-marines".
  function slugify(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Map a unit's _factionName to its short name (last segment after " - ")
  // and emit a stable class. The matching CSS in unit-card-themes.css keys
  // off these short-name slugs so it stays in sync with App.FACTION_COLORS.
  function classForUnit(unit) {
    if (!unit) return null;
    const fac = unit._factionName || '';
    if (!fac) return null;
    const shortName = fac.includes(' - ') ? fac.split(' - ').pop().trim() : fac.trim();
    const slug = slugify(shortName);
    if (!slug) return null;
    return 'faction-' + slug;
  }

  App.hooks.cardClassContributors.push(classForUnit);
})();
