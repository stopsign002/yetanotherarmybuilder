// app/flavor.js — faction flavor quotes on empty army + save toast.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const QUOTES = {
    'Adeptus Astartes':     ['We are the Emperor\'s shield and sword.', 'No pity. No remorse. No fear.', 'Courage honours the fallen.'],
    'Space Marines':        ['We are the Emperor\'s shield and sword.', 'No pity. No remorse. No fear.', 'Courage honours the fallen.'],
    'Blood Angels':         ['The Red Thirst rides with us.', 'For Sanguinius, and the Throne.', 'Our wrath is a bright flame.'],
    'Dark Angels':          ['The Lion\'s watch never breaks.', 'Secrets kept. Oaths kept.', 'Repent in silence, strike in shadow.'],
    'Grey Knights':         ['Daemons flee where silver walks.', 'Purity is our only shield.', 'We are the wall between worlds.'],
    'Space Wolves':         ['Howl for the All-Father.', 'Sagas are written in blood and snow.', 'The wolf time is now.'],
    'Imperial Fists':       ['Stone holds. Fist holds. Line holds.', 'No wall unbreached, no oath unkept.', 'The siege is our sermon.'],
    'Black Templars':       ['Faith is the sharpest edge.', 'No mercy for the apostate.', 'The Emperor guides our blades.'],
    'Iron Hands':           ['The flesh is weak. The machine is sure.', 'Steel over sinew.', 'We endure where others fall.'],
    'Salamanders':          ['Into the fires of battle.', 'By flame, by forge, by faith.', 'Vulkan\'s embers never cool.'],
    'Ultramarines':         ['Courage and honour, brothers.', 'The Codex guides every blade.', 'Theoretical, then practical.'],
    'White Scars':          ['The wind favours the swift.', 'Ride them down, every last one.', 'We strike and are gone.'],
    'Raven Guard':          ['From shadow, death.', 'They never see the blade.', 'Victory through stealth.'],
    'Chaos Space Marines':  ['Chains are broken, oaths forsaken.', 'The Long War ends in blood.', 'We were legion. We are eternal.'],
    'Death Guard':          ['Embrace the gift, brother.', 'Nurgle smiles on patient rot.', 'Plague is a slow mercy.'],
    'Thousand Sons':        ['All is dust, all is known.', 'Magnus sees farther than fate.', 'Knowledge is the sharpest weapon.'],
    'World Eaters':         ['Skulls. Skulls for the throne.', 'Blood runs. We run faster.', 'No thought — only slaughter.'],
    "Emperor's Children":   ['Sensation without limit.', 'Perfection is a wound to chase.', 'The song of pain is beautiful.'],
    'Necrons':              ['Silent legions remember.', 'The stars were ours once. They will be again.', 'Flesh is a passing error.'],
    "T'au Empire":          ['For the Greater Good.', 'The Tau\'va unites all.', 'Progress is inevitable.'],
    'Tyranids':             ['Hunger moves through the void.', 'The swarm does not reason. It consumes.', 'Every world is food.'],
    'Orks':                 ['If it ain\'t dead, hit it again.', 'WAAAGH! is da answer.', 'Red wunz go fasta, everyone knows.', 'Dakka fixes most fings.'],
    'Aeldari':              ['The skein bends, but it does not break.', 'We dance at the edge of doom.', 'Our paths are chosen, our fates sharper.'],
    'Drukhari':             ['Pain is a currency. We are rich.', 'Flee. It will only sweeten the hunt.', 'The sky bleeds for us.'],
    'Harlequins':           ['The Great Fool laughs last.', 'Every step is a verse in the Rhana Dandra.', 'Masks on. The play begins.'],
    'Adeptus Mechanicus':   ['Praise the Omnissiah.', 'Flesh is fallible. Steel is certain.', 'From the knowledge of the ancients.'],
    'Astra Militarum':      ['For the Emperor, onward!', 'A million bayonets, one will.', 'Hold the line. Hold it again.'],
    'Adepta Sororitas':     ['Faith is our armour.', 'By our suffering, the Emperor is known.', 'No faith, no forgiveness.'],
    'Adeptus Custodes':     ['We guard the Throne itself.', 'Ten thousand never falter.', 'The Emperor\'s own sword and shield.'],
    'Deathwatch':           ['Suffer not the alien to live.', 'One chapter, one purpose.', 'Chosen for the worst wars.'],
    'Genestealer Cults':    ['The Day of Ascension draws near.', 'All as one, below and above.', 'The Patriarch\'s kiss waits.'],
    'Leagues of Votann':    ['By debt, by hearth, by oath.', 'The ancestors weigh every deed.', 'Measure twice, strike once.'],
    'Chaos Daemons':        ['The veil thins. We step through.', 'The Ruinous Powers feast.', 'Reality was never meant to hold.'],
    'Chaos Knights':        ['The Fallen Houses ride to war.', 'No throne, no leash, no master.', 'Our pact is written in ichor.'],
    'Imperial Knights':     ['Honour the pact, honour the throne.', 'A Knight keeps their word.', 'The god-engines march.'],
  };

  const GENERIC = ['For the Emperor, and glory.', 'The galaxy burns. Pick a side.', 'Begin. The battle waits.'];

  function shortName(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function pick(arr) {
    if (!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function currentFactionShort() {
    const s = App.state || {};
    const name = s.selectedChapter || (s.factionFilter && s.factionFilter !== 'all' ? s.factionFilter : null);
    return shortName(name);
  }

  function quoteFor(name) {
    const bank = QUOTES[name];
    if (bank && bank.length) return pick(bank);
    return pick(GENERIC);
  }

  function decorateEmpty(army) {
    const el = document.getElementById('army-list-empty');
    if (!el) return;
    if (army && army.entries && army.entries.length > 0) return;
    const q = quoteFor(currentFactionShort());
    if (!q) return;
    el.innerHTML =
      'No units added yet.<br/>Select a unit, then &ldquo;Add to Army&rdquo;.' +
      '<div class="flavor-quote">&ldquo;' + escapeHtml(q) + '&rdquo;</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // armyChange fires BEFORE renderArmyList rebuilds the list, so defer.
  App.hooks.armyChange.push(function (army) {
    setTimeout(() => decorateEmpty(army), 0);
  });

  App.hooks.selectionChange.push(function () {
    const army = App.state && App.state.currentArmy;
    setTimeout(() => decorateEmpty(army), 0);
  });

  App.hooks.bootstrap.push(function (state) {
    decorateEmpty(state && state.currentArmy);
    const btn = document.getElementById('btn-save-army');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const q = quoteFor(currentFactionShort());
      if (!q || !window.UI || typeof UI.toast !== 'function') return;
      setTimeout(() => UI.toast(q, 'info', 3500), 450);
    });
  });
})();
