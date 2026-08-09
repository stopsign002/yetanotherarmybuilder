// app/state.js — central state object + faction color palette + theme apply.
(function () {
  const App = window.App = window.App || {};

  App.state = {
    factions:       [],
    allUnits:       [],
    factionsVersion: 0,   // bumped whenever a new faction is pushed — invalidates caches
    currentArmy:    null,
    armyManager:    null,
    selectedUnit:   null,
    factionFilter:  'all',
    selectedChapter: null,
    chaptersMap:    {},
    chapterFactions: new Set(),
    virtualBase:    {},
    // Multi-detachment selection. `selectedDetachments` is the canonical array
    // of selected detachment OBJECTS (drives the picker + the Army Rules union);
    // `selectedDetachment` mirrors the FIRST for single-detachment readers.
    selectedDetachment: null,
    selectedDetachments: [],
    detachmentFaction:  null,
    selectedArmyEntryIndex: null,
    // Which tab the BUILD-mode right panel shows: 'detail' (Unit Detail) or
    // 'rules' (Rules pinboard). Owned by js/ui/build-mode.js.
    activeBuildTab: 'detail',
  };

  // ── Remember which army is loaded, across reloads ─────────────────────
  // `App.state.currentArmy` is assigned from ~15 places (the Load modal,
  // undo/redo, URL share, starter lists, crusade, kill-team, sync
  // adoptions…). Rather than teach every one of them to persist, the
  // property itself records the id.
  //
  // Why: boot used to pick the army with the newest `updatedAt` and call it
  // "current". That is the army you last EDITED, not the one you last had
  // OPEN — loading an older list to look at it doesn't touch its timestamp,
  // and sync re-pins `updatedAt` to server clocks on every adopt. So leaving
  // the site and coming back later silently swapped you to a different army.
  // `js/app/index.js` reads this back at boot; sync's placeholder-promote
  // honours it too.
  //
  // Device-local on purpose: NOT in `SYNCED_BAG_KEYS` (see docs/SYNC.md §1) —
  // "which army am I looking at" is per-device, like the active mode/tab.
  const CURRENT_ARMY_KEY = 'yaab_current_army_id';
  let _currentArmy = null;
  Object.defineProperty(App.state, 'currentArmy', {
    configurable: true,
    enumerable: true,
    get() { return _currentArmy; },
    set(army) {
      _currentArmy = army || null;
      try {
        if (_currentArmy && _currentArmy.id) {
          localStorage.setItem(CURRENT_ARMY_KEY, _currentArmy.id);
        } else {
          localStorage.removeItem(CURRENT_ARMY_KEY);
        }
      } catch (_) { /* private mode / quota — remembering is best-effort */ }
    },
  });

  // Last army the user had open on this device, or null. Only an id — the
  // caller resolves it against `armyManager.armies` and falls back if the
  // army is gone (deleted here, or deleted on another device and pulled).
  App.getPersistedCurrentArmyId = function () {
    try { return localStorage.getItem(CURRENT_ARMY_KEY) || null; } catch (_) { return null; }
  };

  // VIRTUAL_PARENTS used to group "Imperium - Adeptus Astartes - <Chapter>"
  // sub-faction files under a synthetic parent so the UI could expose a
  // Chapter sub-dropdown. BSData (wh40k-10e) has since flattened those files
  // to top-level catalogues (e.g. `Imperium - Space Marines.cat`,
  // `Imperium - Blood Angels.cat`), so no faction names match the old
  // `<parent> - ` prefix scan in App.buildChaptersMap. The chapter dropdown
  // therefore stays permanently hidden (group.hidden = true when chapters
  // is empty — see selections.js). Each chapter is now a top-level faction
  // option. Leaving this empty is the supported "no virtual parents" shape;
  // filters.js / selections.js handle the empty map gracefully.
  App.VIRTUAL_PARENTS = [];

  // Space Marines chapters all inherit the generic Space Marines unit roster
  // (Intercessors, Tactical Marines, Captain, etc.). Each chapter ships as its
  // own BSData catalogue but only contains chapter-specific units (Grey Hunters,
  // Death Company, Sword Brethren). The map below makes App.getEffectiveFilter
  // merge the parent's units into the chapter's roster.
  //
  // Faction names match the BSData `<catalogue name="...">` attribute, which
  // for Space Marine chapters is `Imperium - Adeptus Astartes - <Chapter>`
  // (NOT `Imperium - <Chapter>` — that's just the filename). Verified against
  // the BSData wh40k-10e repo on 2026-04-28.
  App.CHAPTER_PARENTS = {
    'Imperium - Adeptus Astartes - Blood Angels':    'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Dark Angels':     'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Space Wolves':    'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Black Templars':  'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Deathwatch':      'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Imperial Fists':  'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Iron Hands':      'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Raven Guard':     'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Salamanders':     'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - Ultramarines':    'Imperium - Adeptus Astartes - Space Marines',
    'Imperium - Adeptus Astartes - White Scars':     'Imperium - Adeptus Astartes - Space Marines',
  };

  // Space Marine chapter faction_keywords, exactly as they appear folded into
  // unit.keywords by dc-adapter.js (from 40kdc faction_keywords). In the 40kdc
  // 11e dataset EVERY Space Marine unit — generic codex AND every chapter's
  // unique units — lives under the single `Imperium - Adeptus Astartes -
  // Space Marines` faction; the individual chapter factions have zero units of
  // their own. The ONLY thing that delineates a chapter's units is these
  // keywords: chapter-specific units (Grey Hunters, Death Company Marines,
  // Deathwing Knights, Sword Brethren…) carry their chapter as a keyword;
  // generic codex units (Intercessor Squad, Tactical Squad…) do not.
  // Used by js/app/sm-chapter-filter.js to hide OTHER chapters' units when a
  // chapter is selected. Verified complete against the 40kdc adapter output on
  // 2026-07-07 (enumerated every chapter faction_keyword under adeptus-astartes
  // — these 11 are the full set). Note: unit-org keywords like "Deathwing",
  // "Ravenwing", "Death Company", "Sanguinary Guard" are NOT chapter keys —
  // they always co-occur with their parent chapter's keyword, so they need no
  // separate handling.
  App.SM_CHAPTER_KEYWORDS = new Set([
    'Blood Angels',
    'Dark Angels',
    'Space Wolves',
    'Black Templars',
    'Deathwatch',
    'Imperial Fists',
    'Iron Hands',
    'Raven Guard',
    'Salamanders',
    'Ultramarines',
    'White Scars',
  ]);

  // Chapter-exclusive detachment tokens. The BSData Space Marines catalogue
  // bundles every chapter-specific detachment (Sons of Sanguinius, Inner
  // Circle Task Force, Champions of Russ, Righteous Crusaders, Black Spear
  // Task Force...) into the parent SM detachment list. getDetachmentFaction()
  // falls back to that parent for any chapter whose own catalogue ships
  // zero detachments — which means an Ultramarines player would otherwise
  // see Inner Circle Task Force in the dropdown.
  //
  // Each entry maps a chapter faction name to lowercase substrings that
  // mark a detachment as belonging exclusively to THAT chapter. The filter
  // in App.filterSMDetachmentsForChapter (selections.js) excludes any
  // detachment whose name contains a token from a DIFFERENT chapter.
  // Generic codex SM detachments (Gladius / Anvil Siege / Ironstorm /
  // Stormlance / Firestorm / 1st Company / Vanguard Spearhead / Champions
  // of Humanity) match no token and survive for every chapter.
  App.SM_CHAPTER_EXCLUSIVE_TOKENS = {
    'Imperium - Adeptus Astartes - Blood Angels':   ['sanguinius', 'liberator assault', 'angelic'],
    'Imperium - Adeptus Astartes - Dark Angels':    ['inner circle', "lion's", 'unforgiven'],
    'Imperium - Adeptus Astartes - Space Wolves':   ['champions of russ', 'wolfspear', 'hunters unleashed'],
    'Imperium - Adeptus Astartes - Black Templars': ['righteous crusaders', 'vow of honour', 'vow of honor', 'crusader spearhead', 'templar'],
    'Imperium - Adeptus Astartes - Deathwatch':     ['black spear', 'veterans of the long war', 'deathwatch'],
  };

  // Light pastel palette for readability against the dark UI. Each entry:
  // [accent, hover, dark, rgb] — tuned at HSL L ~78% / S ~55% (lower S for
  // the greyscale chapters so they stay identifiable without oversaturating).
  App.FACTION_COLORS = {
    'Adeptus Astartes'   : ['#a8bde6', '#c8d5ef', '#698cd3', '168, 189, 230'],
    'Space Marines'      : ['#a8bde6', '#c8d5ef', '#698cd3', '168, 189, 230'],
    'Blood Angels'       : ['#e6a8a8', '#efc8c8', '#d36969', '230, 168, 168'],
    'Dark Angels'        : ['#a8e6a8', '#c8efc8', '#69d369', '168, 230, 168'],
    'Grey Knights'       : ['#a8ade6', '#c8cbef', '#6972d3', '168, 173, 230'],
    'Space Wolves'       : ['#a8c7e6', '#c8dbef', '#699ed3', '168, 199, 230'],
    'Imperial Fists'     : ['#e6dba8', '#efe8c8', '#d3c269', '230, 219, 168'],
    'Black Templars'     : ['#bbc7d3', '#d3dbe3', '#899eb3', '187, 199, 211'],
    'Iron Hands'         : ['#bbc7d3', '#d3dbe3', '#899eb3', '187, 199, 211'],
    'Salamanders'        : ['#a8e6b2', '#c8efce', '#69d37b', '168, 230, 178'],
    'Ultramarines'       : ['#a8bde6', '#c8d5ef', '#698cd3', '168, 189, 230'],
    'White Scars'        : ['#d3c7bb', '#e3dbd3', '#b39e89', '211, 199, 187'],
    'Raven Guard'        : ['#c3bbd3', '#d9d3e3', '#9789b3', '195, 187, 211'],
    'Chaos Space Marines': ['#e6a8a8', '#efc8c8', '#d36969', '230, 168, 168'],
    'Death Guard'        : ['#d6e6a8', '#e5efc8', '#b9d369', '214, 230, 168'],
    'Thousand Sons'      : ['#a8bde6', '#c8d5ef', '#698cd3', '168, 189, 230'],
    'World Eaters'       : ['#e6b2a8', '#efcec8', '#d37b69', '230, 178, 168'],
    "Emperor's Children" : ['#e6a8e6', '#efc8ef', '#d369d3', '230, 168, 230'],
    'Necrons'            : ['#a8e6b7', '#c8efd1', '#69d383', '168, 230, 183'],
    "T'au Empire"        : ['#a8dbe6', '#c8e8ef', '#69c2d3', '168, 219, 230'],
    'Tyranids'           : ['#e6a8d1', '#efc8e2', '#d369b0', '230, 168, 209'],
    'Orks'               : ['#cce6a8', '#dfefc8', '#a7d369', '204, 230, 168'],
    'Aeldari'            : ['#a8d6e6', '#c8e5ef', '#69b9d3', '168, 214, 230'],
    'Drukhari'           : ['#d1a8e6', '#e2c8ef', '#b069d3', '209, 168, 230'],
    'Harlequins'         : ['#e6b7a8', '#efd1c8', '#d38369', '230, 183, 168'],
    'Adeptus Mechanicus' : ['#e6ada8', '#efcbc8', '#d37269', '230, 173, 168'],
    'Astra Militarum'    : ['#e6e6a8', '#efefc8', '#d3d369', '230, 230, 168'],
    'Adepta Sororitas'   : ['#e6a8b7', '#efc8d1', '#d36983', '230, 168, 183'],
    'Adeptus Custodes'   : ['#e6d6a8', '#efe5c8', '#d3b969', '230, 214, 168'],
    'Deathwatch'         : ['#a8c7e6', '#c8dbef', '#699ed3', '168, 199, 230'],
    'Genestealer Cults'  : ['#dba8e6', '#e8c8ef', '#c269d3', '219, 168, 230'],
    'Leagues of Votann'  : ['#e6c7a8', '#efdbc8', '#d39e69', '230, 199, 168'],
    'Chaos Daemons'      : ['#e6a8bd', '#efc8d5', '#d3698c', '230, 168, 189'],
    'Chaos Knights'      : ['#c7a8e6', '#dbc8ef', '#9e69d3', '199, 168, 230'],
    'Imperial Knights'   : ['#e6d6a8', '#efe5c8', '#d3b969', '230, 214, 168'],
  };
  App.DEFAULT_ACCENT = ['#c8c8c8', '#e0e0e0', '#909090', '200, 200, 200'];

  App.applyFactionColor = function (factionName) {
    const root = document.documentElement;
    const shortName = factionName && factionName.includes(' - ')
      ? factionName.split(' - ').pop().trim()
      : (factionName || '');
    const colors = App.FACTION_COLORS[shortName] || App.FACTION_COLORS[factionName] || App.DEFAULT_ACCENT;
    const [accent, hover, dark, rgb] = colors;
    root.style.setProperty('--accent',       accent);
    root.style.setProperty('--accent-hover', hover);
    root.style.setProperty('--accent-dark',  dark);
    root.style.setProperty('--accent-rgb',   rgb);
    const r = parseInt(accent.slice(1, 3), 16);
    const g = parseInt(accent.slice(3, 5), 16);
    const b = parseInt(accent.slice(5, 7), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.style.setProperty('--accent-on', luminance > 0.35 ? '#111111' : '#ffffff');
  };
})();
