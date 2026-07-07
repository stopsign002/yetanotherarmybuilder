// app/sm-chapter-filter.js — Space Marine chapter roster delineation.
//
// WHY: In the 40kdc 11e dataset ALL Space Marine units (generic codex units +
// every chapter's unique units) live under one faction: display name
// `Imperium - Adeptus Astartes - Space Marines`. The individual chapter
// factions (Space Wolves, Blood Angels, …) ship ZERO units of their own, and
// App.CHAPTER_PARENTS maps each chapter → the SM parent so getEffectiveFilter
// surfaces the parent's ENTIRE roster for any chapter. Result: selecting Space
// Wolves showed the full ~174-unit SM roster including OTHER chapters' unique
// units (Death Company, Deathwing, Sanguinary Guard…).
//
// FIX: a rosterFilters predicate that, when a Space Marines chapter is the
// current context, keeps a unit only if it is generic (no chapter keyword) OR
// carries the current chapter's keyword. The keywords are already on each unit
// (dc-adapter.js folds faction_keywords into unit.keywords); chapter-specific
// units carry their chapter as a keyword, generic units do not.
//
// Detachment-level chapter filtering is handled separately
// (App.SM_CHAPTER_EXCLUSIVE_TOKENS + filterSMDetachmentsForChapter in
// selections.js) — this module is UNIT roster delineation only.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !Array.isArray(App.hooks.rosterFilters)) return;

  const SM_PREFIX = 'Imperium - Adeptus Astartes';

  // Fall back to a local set if state.js didn't define one (defensive — leaf
  // load order is not guaranteed, though state.js loads first in index.html).
  const CHAPTERS = App.SM_CHAPTER_KEYWORDS || new Set([
    'Blood Angels', 'Dark Angels', 'Space Wolves', 'Black Templars',
    'Deathwatch', 'Imperial Fists', 'Iron Hands', 'Raven Guard',
    'Salamanders', 'Ultramarines', 'White Scars',
  ]);

  App.hooks.rosterFilters.push(function (unit) {
    try {
      const state = App.state || {};
      // Current SM chapter context: an explicit chapter, else the active
      // faction filter (unless "all").
      const ctx = state.selectedChapter
        || (state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : null);

      // No-op for the "all" view and every non-SM faction — keeps this
      // predicate completely inert outside the Space Marines context.
      if (!ctx || ctx.indexOf(SM_PREFIX) !== 0) return true;

      // Current chapter keyword = tail of the faction name. Vanilla/unaligned
      // Space Marines has tail "Space Marines", which is NOT a chapter keyword,
      // so `cur` becomes null and only generic units survive.
      let cur = ctx.split(' - ').pop();
      if (!CHAPTERS.has(cur)) cur = null;

      // A unit's chapter lock-set = its keywords that are chapter keywords.
      // Empty = generic (any chapter can take it) → keep. Otherwise keep only
      // if it locks to the current chapter.
      const kws = (unit && unit.keywords) || [];
      let lockedToOther = false;
      let hasCur = false;
      for (let i = 0; i < kws.length; i++) {
        const k = kws[i];
        if (!CHAPTERS.has(k)) continue;
        if (k === cur) hasCur = true;
        else lockedToOther = true;
      }
      // Generic (no chapter keyword) OR carries the current chapter → keep.
      return hasCur || !lockedToOther;
    } catch (_) {
      return true; // never throw / never accidentally hide everything
    }
  });
})();
