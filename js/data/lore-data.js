// data/lore-data.js — original (non-GW-copyrighted) faction flavor text for the lore browser.
(function () {
  const App = window.App = window.App || {};

  // 35 entries — one per key in App.FACTION_COLORS (see js/app/state.js).
  // Text is deliberately generic: themes, archetypes, invented minor names.
  // Avoids specific named characters, quotes, or canonical events.
  App.FACTION_LORE = {
    'Adeptus Astartes': {
      tagline: 'Angels of death in ceramite and wrath.',
      body: 'The Adeptus Astartes stand as humanity\'s foremost sword and shield, forged through rites the civilian world will never understand. Each warrior is a monastic soldier, grown from mortal stock and remade into something that can endure void, flame, and the silence of dead worlds. Their chapters hold fortress-monasteries on a hundred grim planets, and their gene-sires\' legacies shape them more than any sermon. When a chapter\'s banner is unfurled above a burning horizon, the enemies of mankind learn what discipline married to fury can do. They are few where the foe is legion, and still they rarely break.'
    },
    'Space Marines': {
      tagline: 'A thousand chapters, a single creed.',
      body: 'Space Marines are the iron spine of the Imperium\'s wars, clad in power armour older than many of the worlds they defend. Trained in silence, drilled in blood, they fight with the cold precision of soldiers who know that mercy is a ration best spent on mortals. Each chapter guards its reliquaries, its death-lists, and its mysteries — some rigid and orthodox, others wayward and strange. They boast of no homes beyond their fortresses, and no kin beyond their battle-brothers. When chapters combine for a crusade, whole subsectors are redrawn, and long memories of the slain are quietly added to the vaults.'
    },
    'Blood Angels': {
      tagline: 'Beauty wed to carnage, forever unquiet.',
      body: 'The sons of the angel-primarch march to war beneath wings of bronze and crimson, their artistry as precise as their blades. They prize poetry, sculpture, and the painter\'s line almost as much as the chainsword\'s keen teeth, and their strategies show both. Yet a hidden tide runs beneath their civility: a thirst inherited from their lost sire, a rage that waits for any gap in discipline. Careful chaplains stand at the shoulder of every captain, watching. When the flaw breaks loose in battle, it is a terrible glory to see — and a long silence to nurse afterwards, in halls hung with their many dead.'
    },
    'Dark Angels': {
      tagline: 'Secrets older than their armour plates.',
      body: 'The Dark Angels walk with a silence that unsettles even other Astartes. Their ranks are divided into inner circles whose truths are kept from the brothers beside them, and their oldest warriors spend centuries pursuing quiet hunts across the stars. They wear robes of monastic bone over heavy plate, carry heirloom blades whose histories nobody will explain, and pursue targets whose names are never written down. No enemy of humanity receives more implacable attention — yet the greatest of their adversaries, it is whispered, are traitors from their own distant past, still pursued and still unfound.'
    },
    'Grey Knights': {
      tagline: 'A secret order against the unseen foe.',
      body: 'The Grey Knights do not exist, as far as the wider Imperium is concerned. Their fortress floats alone above a silent world, and their number is kept small by brutal selection. Every warrior is a psyker whose mind has been tempered to withstand what lesser souls cannot even perceive, and their weapons are forged with sanctified rites and nameless metals. When daemons break through into the material realm, these silver-clad knights answer. Their wars end in flame and oath: witnesses are few, survivors fewer, records rarely kept. The cost of this work is written on their pale faces and in the long list of their honoured dead.'
    },
    'Space Wolves': {
      tagline: 'A saga of ice, ale, and bared fangs.',
      body: 'From a white world of storms and forests, the sons of the wolf-primarch ride to battle with a laugh that is half a snarl. They keep sagas instead of chronicles, bards instead of scribes, and their captains are chosen as much for their voices as for their blades. They dislike the rigid doctrines of other chapters and make few friends among the Imperium\'s bureaucrats. Yet when an enemy threatens hearth or oath-brother, their fury is a thing out of older myth: helms like beasts, wolves at their heels, cold breath steaming through gritted teeth. Their dead are toasted loudly, then sung about for a thousand winters.'
    },
    'Imperial Fists': {
      tagline: 'The wall against which tyrants break.',
      body: 'The Imperial Fists are the Imperium\'s master siegers and siege-breakers, as comfortable on a crumbling rampart as on an open field. Their yellow plate is battered but meticulously maintained, and their chapter\'s pain-glories are borne with a cold pride that unnerves outsiders. Every captain is also an engineer of sorts, able to read a fortress\'s weaknesses the way a surgeon reads a ribcage. When a world must be held at any cost, they are called; when a bastion must fall, they are called for that too. They speak little, endure much, and leave behind monuments that outlast the empires they saved.'
    },
    'Black Templars': {
      tagline: 'Faith with a sword in its hand.',
      body: 'The Black Templars are always on crusade. Their fleets drift between war zones without a fixed home-world, and their warriors take vows so severe that outsiders mistake them for condemnations. They scorn sorcery of every hue, distrust the psyker, and bless every blade before it tastes xenos blood. Their chaplains, black-helmed and ever-present, speak of the Emperor with a fire that has not cooled in centuries. Entire sub-sectors have been reclaimed by their unending advance, and entire sub-sectors remember the price: cities purged, temples raised over rubble, and long lines of marked warriors marching to the next dawn.'
    },
    'Iron Hands': {
      tagline: 'Flesh is weakness; iron endures.',
      body: 'The Iron Hands trust machines more than men, and themselves less than either. Their chapter culture honours the steady replacement of vulnerable flesh with articulated metal, and their oldest warriors are as much sarcophagus as soldier. Pain is studied, catalogued, and subdued. Sentiment is a wound for the weak. They forge their own armour, their own ammunition, their own grudges — and their grudges are long. Worlds that have wronged them are not simply defeated; their names are struck from the star-charts, their histories reduced to a single cold line in the chapter\'s ledger, and any survivors remember the Iron Hands for as many generations as they can keep a candle lit.'
    },
    'Salamanders': {
      tagline: 'Hammered upon a forge of mercy and flame.',
      body: 'The sons of the drake-world live close to their mortal neighbours, sharing hearth and craft more than any other chapter. Their armourers work alongside common smiths, their captains walk the markets, and their warriors know the names of the children they protect. This closeness does not soften them: it tempers them. When genocide threatens the innocents they have grown to love, their wrath is a slow furnace — cold eyes behind a glowing helm, flamers roaring where lesser men would merely shout. They bear dark skin and blazing eyes, gifts of their world\'s fierce sun, and they carry their artisan-made blades with the care of craftsmen who built them themselves.'
    },
    'Ultramarines': {
      tagline: 'Honoured sons of a blue-and-gold oath.',
      body: 'The Ultramarines are held by many as the ideal of what a chapter should be: disciplined, literate, politically wise, and brutal only where brutality is demanded. They hold a cluster of worlds as much governed as garrisoned, and their doctrines are studied like scripture in other chapters\' libraries. To their rivals this is arrogance; to their captains it is merely correctness worn lightly. Their armies move with a clockwork grace across ruined cities and pale deserts, banners high, chapters of successors marching alongside them. No wall built by xenos hands has yet proven as unyielding as the steady advance of their serried blue lines.'
    },
    'White Scars': {
      tagline: 'Ride fast, strike once, be gone.',
      body: 'The White Scars come from a world of steppe-winds and endless horizons, and they have never quite forgiven their armour for being so heavy. They fight as cavalry in spirit if not always in form: outrider columns, bike-mounted hunters, assault squadrons that arrive at flank and rear before the enemy has marked their own front. Their captains keep the old tongues of their people, braided into their war-chants and their jokes. Mercy, to them, is speed — a swift blade rather than a slow siege. When a scarred rider raises a curved power-sword at dawn, whole enemy formations reconsider their lives before the charge arrives.'
    },
    'Raven Guard': {
      tagline: 'A shadow, then silence, then nothing.',
      body: 'The Raven Guard prefer the knife in the dark to the horn on the field. They strike from orbit by stealth lander, through forest canopy, out of the smoke of their own quiet diversions. Their armour is matte, their colours few, their voices low. They regard long attritional warfare as a failure of imagination. Their chapter suffered grievously in ages past, and some of that old sorrow has never left: they field fewer veterans than they should, train their novices more harshly than most, and trust outsiders rarely. Those who earn their trust, however, gain allies who will appear, unannounced, at the precise moment the war seemed already lost.'
    },
    'Chaos Space Marines': {
      tagline: 'Broken oaths, endless war, patient hate.',
      body: 'The traitor legions are older than the chapters that hunt them. They were once sons of primarchs too, before pride, envy, or grief opened a door they could not shut. Now they haunt the dark between stars, raiding pilgrim convoys and frontier worlds, dragging their battered warbands through decades of slow war. Their armour is gaudy, ruined, patched with trophies and curses. Their minds carry grievances centuries stale and still sharp. When they break upon an unprepared world, it is with the bitterness of exiles who believe themselves wronged — and with the skill of warriors who have been killing humanity since the first great betrayal.'
    },
    'Death Guard': {
      tagline: 'Pestilence made patient, patient made soldier.',
      body: 'The Death Guard march slowly because there is no reason to hurry. Disease wears at the galaxy on a longer calendar than any mortal can read, and they serve a patron whose generosity is measured in boils, flies, and the soft rot at the root of every living thing. Their armour is swollen, cracked, and leaking; their weapons cough more than they roar. Bolts fail to kill them; flame merely cooks the outer crust. Behind their grim, crusted helms, they claim a strange contentment, and their plodding columns, hymnals wheezing from corroded vox-horns, have outlasted whole crusades meant to end them.'
    },
    'Thousand Sons': {
      tagline: 'Minds preserved, flesh made dust.',
      body: 'The Thousand Sons are a legion of sorcerers whose bodies were long ago consumed in a half-understood catastrophe. What remains of most of them is armour animated by will, ambition, and a curl of dust that once was a man. Their sorcerer-lords command libraries older than many mortal civilisations, and they prize knowledge the way other legions prize trophies. They are proud, elegant, and precise, and their battle-plans read like theorems. Where they walk, reality itself becomes suggestion: geometry misbehaves, fires burn in colours with no name, and the last thoughts of the dying are sometimes harvested for study, filed, and never returned.'
    },
    'World Eaters': {
      tagline: 'Skulls for nobody, blood for its own sake.',
      body: 'The World Eaters have no plans beyond the next kill. Whatever sons of reason once fought beneath their old banner were long ago drowned in the implants, the rites, and the patron\'s hoarse whisper. Their warbands are more mob than formation: chained berserkers, bellowing champions, great chain-axes still hot from the last slaughter. They arrive on a world by meteoric drop-pod and by simple orbital madness, spilling out already screaming. A strange, hideous honour runs among them — the honour of the arena — but it is the honour of men who will kill you and then kill each other, and expect to be remembered for both.'
    },
    "Emperor's Children": {
      tagline: 'Perfection pursued past every sane edge.',
      body: 'Once the most disciplined of the traitor legions, the Emperor\'s Children long ago mistook sensation for excellence and never found their way back. Their armour is polished to mirror-brightness, their weapons tuned to sing as they fire, and their battle-cries are composed in keys that hurt to hear. They seek extremity in every form: speed, colour, pain, music, slaughter. Whole worlds have been reduced to concert halls of horror for their amusement. Behind their perfume and their gilded masks, however, remains the discipline of ancient soldiers — which is why, for all the pageantry, they are still extraordinarily dangerous in any real fight.'
    },
    'Necrons': {
      tagline: 'Old empire, patient, awakened, wrong.',
      body: 'Long before humanity stood upright, the necrons ruled. They traded their flesh for living metal in a bargain made under a dying sun, and slept in vaults beneath a million worlds to outlast an enemy older than the galaxy. Now those vaults are opening. The awakened emerge cold-eyed, many mad, some merely hungry, all convinced that the galaxy is rightfully theirs. Their legions march in silent lockstep across battlefields where no living thing can long remain, their gauss-weapons peeling atoms from the air. They remember being gods, and they have not forgiven the young races for making themselves comfortable in the ruins.'
    },
    "T'au Empire": {
      tagline: 'For the Greater Good, whether you agree or not.',
      body: 'The t\'au are young among the stars, and they believe it. Their empire expands in patient, managed spirals out of their homeworlds, carrying with it schools, factories, caste structures, and an unshakable belief in the improvability of lesser cultures. Their infantry wear battlesuits that walk, fly, and outgun anything a comparable mortal warrior can field. Their ideal is co-operation in service of a larger harmony; the reality, as their growing list of conquered worlds can attest, is firm. They welcome allies, tolerate subjects, and lecture the stubborn. Those who still refuse receive a gentler warning than the Imperium would give — and then, eventually, the same result.'
    },
    'Tyranids': {
      tagline: 'A great hunger between the stars.',
      body: 'From the empty dark beyond the outer arms, the hive fleets came drifting — mountains of living biomass, hungry and coordinated and without politics to bargain with. Every creature a tyranid fields is a weapon purpose-grown for the target before it: scything claws, acid spittle, armoured carapace tuned to the enemy\'s guns. Individual beasts are mortal and, on their own, not terribly clever. A swarm, however, is something else: a single mind distributed across a tide of teeth, directed by unseen overminds that fall upon a world with the patience of weather. Where they pass, the planet is eaten — seas, soil, and bone alike.'
    },
    'Orks': {
      tagline: 'Loud, green, and embarrassingly hard to kill.',
      body: 'Orks are a joke the galaxy is not quite finished laughing at. They grow from spores, reach maturity knowing how to swing a club, and form warbands at the least excuse. Their weapons are nonsense by any honest engineer\'s standards and still frequently work; their vehicles are patchwork disasters that still, somehow, drive; their paint-jobs improve performance because orks collectively believe they do. They love a good scrap and an even better brawl, and their warlords grow physically larger the more they win. Entire Imperial sectors have been burned down to ash behind rolling tides of green muscle and black-toothed laughter.'
    },
    'Aeldari': {
      tagline: 'Elegant, ancient, and running out of time.',
      body: 'The aeldari live on vast craftworld-ships, the survivors of a civilisation that destroyed itself through sheer excess. They walk paths of self-discipline so strict that a warrior may spend a lifetime on a single role before moving on, and their ghost-constructs carry the preserved spirits of their dead. Their technology is older and subtler than anything humanity can match: gravity, psycho-reactive fibres, weapons that fold space. Yet every aeldari knows that their race is dwindling, that their foes grow while they shrink, and that the shadow in the warp that devours their dead remains patient. They fight with a cold, beautiful precision against that accelerating dusk.'
    },
    'Drukhari': {
      tagline: 'Kin of the aeldari, unrepentant and cruel.',
      body: 'The drukhari live in a hidden city strung across the meeting-places of stars, and they sustain their long, beautiful lives by inflicting suffering on others. Their raiding parties strike out of unmarked gates into the wider galaxy, spend a single terrible night on some unsuspecting world, and vanish with slaves, trophies, and pain harvested by means the Imperium prefers not to catalogue. Their nobility plays elaborate games of treachery between themselves, their gladiator-covens feud openly, and their witch-priestesses keep older and stranger secrets. Where they land, the survivors tell only fragments of what they saw, and sleep badly for the rest of their lives.'
    },
    'Harlequins': {
      tagline: 'Masked players of an ancient, private tragedy.',
      body: 'The harlequins travel the old webways between worlds, performing a mythic cycle that only their own kin can fully read. They wear masks painted in arcing colour-fields that shift with the light, carry weapons that are as much stage-props as killers, and fight with a tumbling, acrobatic grace that makes mockery of heavy infantry. They are neutral in most of the wider galaxy\'s quarrels, showing up now for one faction of their kin, now for another, dancing through the battle long enough to alter something subtle and then leaving again. Outside observers rarely understand their purpose; they rarely explain, and never repeat themselves.'
    },
    'Adeptus Mechanicus': {
      tagline: 'Revere the machine; flesh is imperfect prototype.',
      body: 'The priests of the Mechanicus trace their faith to a red world of furnaces and silent cathedrals, where knowledge itself is worshipped as a sacred current flowing through the galaxy. Their adepts climb a long ladder of augmetic upgrades, shedding flesh for chrome and ceramite, trading voices for vox-horns, eyes for glowing sensoria. They maintain the ancient machines that the Imperium cannot afford to lose and would not know how to rebuild if they did. In battle their legions march alongside skitarii warriors, servitors, and walking engines older than most star-systems, crackling with the static hymns of their many-voiced creed.'
    },
    'Astra Militarum': {
      tagline: 'A trillion rifles; history\'s longest line.',
      body: 'The Astra Militarum is the mortal fist of mankind — ordinary men and women, drawn from a thousand worlds, drilled, shipped, and fed into wars they are not expected to survive. Their regiments carry the accents and superstitions of their home planets: hardened tundra grenadiers, forest-bred scouts, hive-gang veterans still tattooed under their uniforms. Their commanders plan by attrition, their commissars enforce courage at pistol-point, and their tank columns grind through mud older than their campaigns. Individually they are small; together they are the broadest and most patient tide of arms the galaxy has ever known, and they have outlasted enemies who laughed at them first.'
    },
    'Adepta Sororitas': {
      tagline: 'Faith, bolter, and flame — in that order.',
      body: 'The Sisters of Battle are a warrior-order bound by vows so deep that the boundary between soldier and saint begins to blur. Where the Astartes are gene-crafted, the Sororitas are forged by belief: long prayer-watches, fasting, drilling, and a faith in the Emperor that no heretic argument can dent. They march in heavy plate with bolter and holy flamer, accompanied by priests, chirurgeons, and banner-bearers who sing as they advance. In heretic-held cities their advance is marked by pyres of corrupt shrines, restored icons, and long columns of the reconciled. Their critics find them rigid; their enemies find them implacable.'
    },
    'Adeptus Custodes': {
      tagline: 'Golden guards of a silent throne.',
      body: 'The Custodians are fewer than any chapter, and each of them is crafted by a process older and more deliberate than any Astartes rite. They are individually as capable as squads of ordinary warriors, and they wear golden armour whose every plate is inscribed with feats of defence. Most of them will never leave their home palace: their duty is to stand watch over a single seat and the being who occupies it. Those who do march beyond the walls fight with an unhurried, fencer\'s poise — using spears that hum with contained stars, and speaking, when they speak at all, in voices that sound like distant bells.'
    },
    'Deathwatch': {
      tagline: 'One chapter of many, specialised in xenos murder.',
      body: 'The Deathwatch is a small, cold brotherhood built from veterans seconded by their parent chapters to a single, specific purpose: to fight, study, and exterminate the alien in all its uncountable forms. Each kill-team mixes warriors of different gene-lines and different temperaments, bound for the duration of a mission by vow rather than long kinship. They wear black over their original colours, keep detailed xeno-lexica, and maintain the Imperium\'s most disturbing trophy-vaults. When a sector governor reports a new alien horror, and all conventional responses are returning empty coffins, the black-armoured specialists arrive — and the reports improve.'
    },
    'Genestealer Cults': {
      tagline: 'A hidden hand waiting for the stars to fall.',
      body: 'Genestealer cults begin quietly. A single creature, delivered by some forgotten incident, seeds a small population of corrupted but still outwardly human descendants; over generations their numbers grow under hive-cities, in mining camps, and in neglected parishes. They work ordinary jobs, raise children of visibly strange appearance, and worship a patriarch hidden in deep tunnels. They drill, stockpile, and wait. When the sky finally darkens with the coming of the hive fleets, the cult rises — miners, dockers, and preachers suddenly pouring out of the underlevels with mining lasers and homemade bombs, convinced they are welcoming saviours.'
    },
    'Leagues of Votann': {
      tagline: 'Old clans, deep vaults, and very long grudges.',
      body: 'The kin of the deep leagues live on mobile hold-fleets and hollowed planetoid fortresses, clinging to a civilisation older than most of the Imperium\'s saints. They are short, broad, slow to anger, and very hard to stop once they start. Their technology is carefully maintained rather than often invented: they refurbish, recombine, and repair where other races shrug and replace. Their ancestor-cores hold the recorded minds of honoured dead, consulted before any major decision. When the kin take the field, they do so in armoured columns, grav-vehicles humming, heavy weapons forward, and a quiet, well-kept ledger of who owes them what.'
    },
    'Chaos Daemons': {
      tagline: 'Thought made flesh, flesh made nightmare.',
      body: 'Daemons are not creatures of the mortal world but of its reflection: the raging, dreaming, secret half of the galaxy, given form by belief. Each one embodies some extreme of mortal feeling — rage, despair, pleasure, scheming — and each serves a greater will that cannot easily be described. When reality thins, they spill through: fleshless things of brass and brass-chains, pale dancers with too many fingers, rot-mouthed giants, blue and pink flickering shapes that argue with themselves as they advance. They cannot be persuaded, bargained with honestly, or kept at bay by conventional walls. Fire, faith, and silver sometimes suffice; often, nothing does.'
    },
    'Chaos Knights': {
      tagline: 'Fallen nobles, betrayed houses, walking fortresses.',
      body: 'Where a loyal knightly house maintains its oaths with stern ceremony, a fallen house has traded those oaths for other, older pacts. Chaos Knight pilots sit within thrones whose contacts whisper ruined scripture, and their great war-walkers are daubed with runes no honest herald would recognise. They march at the head of warbands of cultists, traitor soldiery, and stranger things, and their fall is usually a family matter: whole bloodlines sworn to the same dark patron, generation after generation. In battle they tower over the enemy infantry, stalking through smoke, and their victories are measured less in territory than in the spectacle of crushed opposition.'
    },
    'Imperial Knights': {
      tagline: 'Feudal oaths, walking citadels, one pilot apiece.',
      body: 'Imperial Knights are relic war-engines maintained by noble houses whose traditions predate the Imperium\'s current form. A single pilot bonds with a throne that remembers every previous lord who ever sat in it, and rides to war atop dozens of tonnes of armoured hostility. Their houses keep castles, heraldry, and private feuds, and they owe loyalty to the Imperium through a complicated web of oaths of protection. When the call comes, these towering knights stride into battle with banners unfurled, lances crackling, and horns booming down the line — a deliberately anachronistic spectacle that still reliably ends armoured regiments and xenos monstrosities alike.'
    }
  };

  // Optional one-line flavor for units whose description is missing/sparse.
  // Keyed by case-insensitive name substring.
  App.UNIT_FLAVOR = {
    'space marine captain': 'A warrior-leader forged for command on a hundred battlefields.',
    'chapter master': 'The living will of a chapter, armoured in ancient relic-plate.',
    'librarian': 'A disciplined psyker whose every thought is a drilled weapon.',
    'chaplain': 'Keeper of oaths and voice of the chapter\'s burning creed.',
    'apothecary': 'Surgeon, gene-harvester, and quiet keeper of the legacy of the fallen.',
    'techmarine': 'A Mechanicus-trained brother who speaks the machine\'s half-understood tongue.',
    'terminator': 'Heavy-armoured veteran, walking slowly because nothing hurries it.',
    'dreadnought': 'An entombed hero, waking only for the worst wars.',
    'intercessor': 'Line infantry of the new mark, steady behind a wall of bolter fire.',
    'assault intercessor': 'Close-assault brother with chainsword bared and jump already coiled.',
    'scout': 'A neophyte learning quiet murder beyond the chapter\'s walls.',
    'sternguard': 'Veterans in polished plate, firing specialty rounds with surgical care.',
    'bladeguard': 'Honour-guard swordsmen whose shields are older than most worlds they defend.',
    'aggressor': 'Walking gun-platform in heavy plate, advancing unhurried into fire.',
    'hellblaster': 'Plasma-gunner who accepts the risk because the target simply has to die.',
    'inceptor': 'A drop-assault brother who arrives already shooting.',
    'reiver': 'Skull-masked terror specialist, voice modulated to unnerve.',
    'eradicator': 'Melta-gunner whose job is to end heavy armour at embarrassingly short range.',
    'outrider': 'Fast-attack rider ranging ahead of the chapter\'s advancing line.',
    'invader atv': 'A light assault vehicle built for outflanks and brutal little firefights.',
    'gladiator': 'A heavy battle-tank variant engineered for fast line-breaking.',
    'repulsor': 'A grav-lifted fortress of a transport, bristling with supporting guns.',
    'impulsor': 'A lightweight grav-transport for rapid-response operations.',
    'redemptor dreadnought': 'A newer, larger pattern of entombed walker, roaring with plasma.',
    'brutalis dreadnought': 'A close-combat walker built to kick its way through enemy lines.',
    'ballistus dreadnought': 'A long-range walker mounting anti-armour weaponry.',
    'necron warrior': 'Expendable reanimated infantry, stepping back up after most killing blows.',
    'immortal': 'An elite reanimated soldier, harder to put down than its lesser kin.',
    'lychguard': 'Royal bodyguard of deathless metal, favoured with heirloom weapons.',
    'ork boy': 'A green-skinned brawler whose enthusiasm compensates for his marksmanship.',
    'nob': 'A larger, meaner ork, trusted to lead smaller greenskins into the grinder.',
    'warboss': 'A truly huge greenskin whose authority rests on unbroken violence.',
    'guardsman': 'A common Imperial soldier, rifle steady, sergeant\'s voice a yard behind.',
    'leman russ': 'A main-pattern Imperial battle-tank, slow, durable, and always loud.',
    'sentinel': 'A light walker used for scouting and flank-guarding the massed lines.',
    'fire warrior': 'A t\'au infantry line-trooper, disciplined and well-supplied.',
    'crisis suit': 'A t\'au battlesuit pilot, engaging and disengaging with precise jet-bursts.',
    'pathfinder': 'A t\'au scout, painting targets for heavier friends over the next ridge.',
    'termagant': 'A small bio-construct, cheap, numerous, and exactly as lethal as the swarm needs.',
    'hormagaunt': 'A swift, clawed bio-beast that runs faster than most infantry can aim.',
    'tyranid warrior': 'A larger synaptic creature, coordinating the swarm\'s immediate violence.',
    'carnifex': 'An armoured bio-engine of claws and cannons, deployed where walls must fall.',
    'guardian': 'An aeldari part-time soldier, drilled just enough to carry a shuriken catapult.',
    'dire avenger': 'A path-disciplined aeldari warrior, precise and unhurried under fire.',
    'wraithguard': 'A ghost-piloted construct, fielded when aeldari lives can no longer be spent.',
    'cultist': 'A corrupt mortal soldier, badly armed and worse trained, but plentiful.'
  };
})();
