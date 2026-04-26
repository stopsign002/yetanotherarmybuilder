// app/nickname.js — army nickname auto-suggest via placeholder.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const GENERIC_ADJ = ['Iron', 'Storm', 'Silent', 'Burning', 'Ashen', 'Crimson', 'Shattered', 'Fabled'];
  const GENERIC_NOUN = ['Vanguard', 'Host', 'Crusade', 'Company', 'Brotherhood', 'Reach', 'Oath', 'March'];

  const POOLS = {
    'Space Marines':       { adj: ['Storm-Armoured', 'Stoic', 'Oath-Kept', 'Vigilant', 'Unbent'], noun: ['Vow', 'Vigil', 'Bulwark', 'Bastion', 'Company'] },
    'Adeptus Astartes':    { adj: ['Storm-Armoured', 'Stoic', 'Oath-Kept', 'Vigilant', 'Unbent'], noun: ['Vow', 'Vigil', 'Bulwark', 'Bastion'] },
    'Blood Angels':        { adj: ['Crimson', 'Thirsting', 'Sanguine', 'Winged', 'Wrathful'], noun: ['Chalice', 'Choir', 'Wrath', 'Host', 'Flight'] },
    'Dark Angels':         { adj: ['Watchful', 'Silent', 'Hooded', 'Lion-Sworn', 'Unforgiven'], noun: ['Vigil', 'Circle', 'Watch', 'Oath'] },
    'Grey Knights':        { adj: ['Silver', 'Warded', 'Pure', 'Unbroken'], noun: ['Ward', 'Circle', 'Litany', 'Aegis'] },
    'Space Wolves':        { adj: ['Howling', 'Frost-Bitten', 'Grim', 'Saga-Sung'], noun: ['Pack', 'Saga', 'Howl', 'Fang'] },
    'Imperial Fists':      { adj: ['Unbreached', 'Stone-Founded', 'Oath-Laid', 'Sieging'], noun: ['Wall', 'Bastion', 'Fist', 'Siege'] },
    'Black Templars':      { adj: ['Zealous', 'Vowed', 'Relentless', 'Cross-Bearing'], noun: ['Crusade', 'Vow', 'Fury', 'Litany'] },
    'Iron Hands':          { adj: ['Cog-Bound', 'Sinewless', 'Steel-Willed'], noun: ['Clan', 'Forge', 'Hand', 'Iron'] },
    'Salamanders':         { adj: ['Ember-Lit', 'Forge-Born', 'Smouldering'], noun: ['Forge', 'Ember', 'Pyre', 'Flame'] },
    'Ultramarines':        { adj: ['Codex-True', 'Honourable', 'Disciplined'], noun: ['Company', 'Standard', 'Vow', 'Oath'] },
    'White Scars':         { adj: ['Swift', 'Windborne', 'Hunting'], noun: ['Ride', 'Hunt', 'Wind', 'Scar'] },
    'Raven Guard':         { adj: ['Shadowed', 'Silent', 'Unseen'], noun: ['Shadow', 'Talon', 'Raven', 'Dusk'] },
    'Chaos Space Marines': { adj: ['Forsaken', 'Fell', 'Broken-Oath', 'Thrice-Damned'], noun: ['Warband', 'Legion', 'Pact', 'Scar'] },
    'Death Guard':         { adj: ['Rotting', 'Patient', 'Festering'], noun: ['Plague', 'Cohort', 'Rot', 'Gift'] },
    'Thousand Sons':       { adj: ['Dust-Bound', 'Sorcerous', 'All-Seeing'], noun: ['Cult', 'Cabal', 'Scroll', 'Dust'] },
    'World Eaters':        { adj: ['Blood-Soaked', 'Chained', 'Skull-Taking'], noun: ['Butchers', 'Wrath', 'Cage', 'Slaughter'] },
    "Emperor's Children":  { adj: ['Gilded', 'Exquisite', 'Unbound'], noun: ['Chorus', 'Song', 'Court', 'Revel'] },
    'Necrons':             { adj: ['Silent', 'Tombed', 'Deathless', 'Sleeping'], noun: ['Dynasty', 'Legion', 'Tomb', 'Silence'] },
    "T'au Empire":         { adj: ['Greater', 'United', 'Farseeing'], noun: ['Cadre', 'Hunter Cadre', 'Sept', 'Cause'] },
    'Tyranids':             { adj: ['Hungering', 'Endless', 'Voidward', 'Feeding'], noun: ['Scion', 'Swarm', 'Hunger', 'Brood'] },
    'Orks':                { adj: ['Krumpin', 'Stompin', 'Loud', 'Choppa', 'Red'], noun: ['Boyz', 'Krumpwagon', 'Waaagh', 'Mob', 'Stompaz'] },
    'Aeldari':             { adj: ['Skein-Woven', 'Mourning', 'Dawn-Spun'], noun: ['Path', 'Craftworld', 'Dance', 'Dirge'] },
    'Drukhari':            { adj: ['Barbed', 'Bleeding', 'Cruel'], noun: ['Kabal', 'Hunt', 'Feast', 'Court'] },
    'Harlequins':          { adj: ['Laughing', 'Masked', 'Dancing'], noun: ['Troupe', 'Play', 'Masquerade', 'Verse'] },
    'Adeptus Mechanicus':  { adj: ['Cog-Blessed', 'Binary', 'Sacred-Oiled'], noun: ['Cohort', 'Cortex', 'Forge', 'Canticle'] },
    'Astra Militarum':     { adj: ['Forlorn', 'Steadfast', 'Iron-Booted'], noun: ['Regiment', 'Line', 'Bayonet', 'March'] },
    'Adepta Sororitas':    { adj: ['Faithful', 'Flame-Lit', 'Martyred'], noun: ['Order', 'Hymn', 'Pyre', 'Vow'] },
    'Adeptus Custodes':    { adj: ['Golden', 'Throne-Sworn', 'Ten-Thousand'], noun: ['Vigil', 'Shield', 'Host', 'Watch'] },
    'Deathwatch':          { adj: ['Alien-Hunting', 'Black-Clad', 'Chosen'], noun: ['Kill Team', 'Vigil', 'Watch', 'Cross'] },
    'Genestealer Cults':   { adj: ['Ascending', 'Hidden', 'Kissed'], noun: ['Cult', 'Brood', 'Rising', 'Day'] },
    'Leagues of Votann':   { adj: ['Oath-Bound', 'Debt-Kept', 'Hearth-Born'], noun: ['Kin', 'League', 'Hearth', 'Ledger'] },
    'Chaos Daemons':       { adj: ['Warp-Spilled', 'Gibbering', 'Unmade'], noun: ['Tide', 'Host', 'Revel', 'Maw'] },
    'Chaos Knights':       { adj: ['Unleashed', 'Fallen', 'Pact-Bound'], noun: ['House', 'Pact', 'March', 'Lance'] },
    'Imperial Knights':    { adj: ['Noble', 'Oath-Kept', 'Ancestral'], noun: ['House', 'Lance', 'March', 'Banner'] },
  };

  const IGNORE_KW = new Set(['infantry', 'faction', 'imperium', 'chaos', 'xenos', 'adeptus astartes']);

  let userEdited = false;

  function shortName(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function currentFactionShort() {
    const s = App.state || {};
    const name = s.selectedChapter || (s.factionFilter && s.factionFilter !== 'all' ? s.factionFilter : null);
    return shortName(name);
  }

  function topKeywords(army) {
    if (!army || !army.entries || !army.entries.length) return [];
    const counts = new Map();
    for (let i = 0; i < army.entries.length; i++) {
      const e = army.entries[i];
      const u = e && e.unitData;
      const kws = (u && u.keywords) || [];
      for (let j = 0; j < kws.length; j++) {
        const k = String(kws[j] || '').trim();
        if (!k) continue;
        if (IGNORE_KW.has(k.toLowerCase())) continue;
        counts.set(k, (counts.get(k) || 0) + (e.count || 1));
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  }

  function pick(arr, seed) {
    if (!arr || !arr.length) return '';
    const i = Math.abs(seed || 0) % arr.length;
    return arr[i];
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  function buildNickname(army) {
    const faction = currentFactionShort();
    const pool = POOLS[faction] || { adj: GENERIC_ADJ, noun: GENERIC_NOUN };
    const kws = topKeywords(army);
    const seedBase = (faction || 'x') + '|' + kws.join(',');
    const seed = hashStr(seedBase);
    const adj = pick(pool.adj, seed);
    const noun = pick(pool.noun, seed >> 3);

    if (/orks/i.test(faction)) {
      // Orky phrasing: "Da <Adj> <Noun>"
      return 'Da ' + adj + ' ' + noun;
    }
    return 'The ' + adj + ' ' + noun;
  }

  function shouldSuggest(input) {
    if (!input) return false;
    if (userEdited) return false;
    const v = (input.value || '').trim();
    return v === '' || v === 'My Army';
  }

  function applySuggestion(army) {
    const input = document.getElementById('army-name-input');
    if (!input) return;
    if (!shouldSuggest(input)) return;
    const nick = buildNickname(army);
    if (nick) input.placeholder = nick;
  }

  App.hooks.bootstrap.push(function (state) {
    const input = document.getElementById('army-name-input');
    if (input) {
      input.addEventListener('input', function () {
        const v = (input.value || '').trim();
        if (v !== '' && v !== 'My Army') userEdited = true;
      });
    }
    applySuggestion(state && state.currentArmy);
  });

  App.hooks.armyChange.push(function (army) { applySuggestion(army); });
  App.hooks.selectionChange.push(function () { applySuggestion(App.state && App.state.currentArmy); });
})();
