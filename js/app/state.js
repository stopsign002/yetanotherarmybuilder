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

  // [accent, hover, dark, rgb]
  App.FACTION_COLORS = {
    'Adeptus Astartes':    ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'Space Marines':       ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'Blood Angels':        ['#9b0000', '#be1a1a', '#6e0000', '155, 0, 0'],
    'Dark Angels':         ['#1a5c1a', '#267a26', '#124012', '26, 92, 26'],
    'Grey Knights':        ['#8888b8', '#a0a0d0', '#6060a0', '136, 136, 184'],
    'Space Wolves':        ['#4a6fa5', '#6088be', '#30508a', '74, 111, 165'],
    'Imperial Fists':      ['#c8a400', '#e0bc00', '#9b8000', '200, 164, 0'],
    'Black Templars':      ['#d0d0d0', '#eeeeee', '#a0a0a0', '208, 208, 208'],
    'Iron Hands':          ['#708090', '#909eb0', '#506070', '112, 128, 144'],
    'Salamanders':         ['#1a6b2a', '#268a38', '#104a1a', '26, 107, 42'],
    'Ultramarines':        ['#0062ae', '#1e82d0', '#004d8a', '0, 98, 174'],
    'White Scars':         ['#d8d8d8', '#f0f0f0', '#b0b0b0', '216, 216, 216'],
    'Raven Guard':         ['#909090', '#b0b0b0', '#686868', '144, 144, 144'],
    'Chaos Space Marines': ['#9b1a00', '#be3210', '#6e1000', '155, 26, 0'],
    'Death Guard':         ['#5a6e3a', '#728c4a', '#3e4e28', '90, 110, 58'],
    'Thousand Sons':       ['#1a4a9b', '#2a62c8', '#0e3070', '26, 74, 155'],
    'World Eaters':        ['#aa1a00', '#cc2a10', '#7a1000', '170, 26, 0'],
    "Emperor's Children":  ['#9b1a9b', '#c028c0', '#6e1070', '155, 26, 155'],
    'Necrons':             ['#00cc00', '#20ee20', '#009800', '0, 204, 0'],
    "T'au Empire":         ['#00a0b0', '#10c0d2', '#007888', '0, 160, 176'],
    'Tyranids':            ['#8b0070', '#b0009a', '#600050', '139, 0, 112'],
    'Orks':                ['#5a8700', '#70a800', '#406000', '90, 135, 0'],
    'Aeldari':             ['#0080c8', '#10a0ee', '#005898', '0, 128, 200'],
    'Drukhari':            ['#7b00b8', '#9c10e0', '#580088', '123, 0, 184'],
    'Harlequins':          ['#d44000', '#f05010', '#a02800', '212, 64, 0'],
    'Adeptus Mechanicus':  ['#cc3300', '#ee4a10', '#982200', '204, 51, 0'],
    'Astra Militarum':     ['#6b6b3a', '#8a8a4a', '#4a4a28', '107, 107, 58'],
    'Adepta Sororitas':    ['#8b0020', '#ae1030', '#620010', '139, 0, 32'],
    'Adeptus Custodes':    ['#c8a000', '#e0bc00', '#9b8000', '200, 160, 0'],
    'Deathwatch':          ['#7080a0', '#8898c0', '#505870', '112, 128, 160'],
    'Genestealer Cults':   ['#7b00a8', '#9c10d0', '#580078', '123, 0, 168'],
    'Leagues of Votann':   ['#8b6b3a', '#aa844a', '#664e28', '139, 107, 58'],
    'Chaos Daemons':       ['#9b1a4a', '#c02860', '#6e1030', '155, 26, 74'],
    'Chaos Knights':       ['#6b2a9b', '#8a40c0', '#4a1870', '107, 42, 155'],
    'Imperial Knights':    ['#c8a000', '#e0bc00', '#9b8000', '200, 160, 0'],
  };
  App.DEFAULT_ACCENT = ['#ffffff', '#cccccc', '#aaaaaa', '255, 255, 255'];

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
