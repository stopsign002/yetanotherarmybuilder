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
    selectedDetachment: null,
    detachmentFaction:  null,
    selectedArmyEntryIndex: null,
  };

  App.VIRTUAL_PARENTS = [
    {
      name: 'Imperium - Adeptus Astartes',
      baseChapter: 'Imperium - Adeptus Astartes - Space Marines',
    },
  ];

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
