# Parser coverage report

Generated: `2026-05-06T21:09:56.590Z`
BSData commit: `2350f914ef702fb6e607e48c94da1b413a588a58`

Files: 47 (47 parsed OK, 0 failures)
Element names: 59, attributes: 54
Profile typeNames in XML: 28
  - handled (appeared in parser output): 12
  - **classify says 'other' (silent drop — likely real gap): 5**
  - classify says ability/stats/weapon but never in output (harness FP or extraction bug): 12
Characteristic names in XML: 27 (description carriers already filtered, **remaining unhandled: 10**)

## Real-gap typeNames (classify returned 'other', 5)

These are profiles the parser silently drops — classifyProfile said 'other' so they never reach the renderer. **Most likely fixes are in [classify.js](../js/parser/classify.js).**

| typeName | count | factions | example names | characteristic names in profile |
|---|---:|---:|---|---|
| `Orders` | 21 | 1 | `Orders`, `On My Signal` | `Orders` |
| `Threat` | 9 | 1 | `Cult Uprising`, `Diabolical Ritual`, `Arch-nemesis`, `Agent Provocateur`, `Saboteur Matrix` | `Influence Goal`, `Intrigue Goal` |
| `Marks of Chaos` | 5 | 1 | `KHORNE`, `TZEENTCH`, `NURGLE`, `SLAANESH`, `CHAOS UNDIVIDED` | `Ability` |
| `Warmaster` | 3 | 1 | `Paragon of Hatred (Aura)`, `Mark of Chaos Ascendant (Aura)`, `Lord of the Traitor Legions (Aura)` | `Ability` |
| `Try Dat Button! - D6` | 3 | 1 | `1-2`, `3-4`, `5-6` | `Button Effect` |

## Classified-but-missing typeNames (12)

classifyProfile said `ability`/`stats`/`weapon` but the typeName never appears in any output object's `_typeName`. Either the harness misses where the parser surfaces it (e.g. 'Unit' is absorbed into `u.stats` without stamping), or extraction failed somewhere downstream of classify.

| typeName | count | factions | classify verdict | example names |
|---|---:|---:|---|---|
| `Unit` | 1919 | 37 | stats:1919 | `Asurmen`, `Autarch Skyrunner`, `Autarch`, `Autarch Wayleaper`, `Avatar of Khaine` |
| `Transport` | 109 | 22 | ability:109 | `Transport`, `Starweaver`, `Wave Serpent`, `Raider`, `Venom` |
| `Assimilation Abilities` | 17 | 1 | ability:17 | `Shaken Faith`, `Stir the Flames`, `Scientific Integration`, `Review Research`, `Threat of Invasion` |
| `Blessings of Khorne` | 12 | 1 | ability:12 | `1. Unbridled Bloodlust`, `2. Rage-fuelled Invigoration`, `3. Death To Cowards (Greater Boon of Khorne)`, `3. Total Carnage`, `4. Blistering Fury (Greater Boon of Khorne)` |
| `Rituals` | 8 | 1 | ability:8 | `Destiny's Ruin (Psychic)`, `Temporal Surge (Psychic)`, `Doombolt (Psychic)`, `Twist of Fate (Psychic)`, `Shadow Puppeteer (Psychic)` |
| `Supply Line Effect` | 8 | 1 | ability:8 | `Collapse of Faith`, `A Mingling of Cultures`, `Spoils of War`, `Repurposed Infrastructure`, `Fleet Intel` |
| `Shrew Strategy Abilities` | 6 | 1 | ability:6 | `Eyes of the Cult`, `Oppress the Oppressors`, `Lurk in the Shadows`, `Booby Traps`, `Coordinated Assault` |
| `Hymn of Battle` | 6 | 1 | ability:6 | `Litany of the Emperor's Will`, `Verse of Divine Protection`, `Chorus of Perfervid Belief`, `Refrain of Righteous Guidance`, `Catechism of Holy Wrath` |
| `Archeotech Curiosity` | 6 | 1 | ability:6 | `Deceit-field`, `Warp Shroud`, `Stability Actuator`, `Divining Augur`, `Biomantic Amplifier` |
| `Hero of Hades Hive` | 3 | 1 | ability:3 | `Inspiring Hero (Aura)`, `Counterstrategist`, `Decisive Command` |
| `Deed` | 3 | 1 | ability:3 | `We pledge to reap a great tally...`, `We swear to reclaim the realm...`, `We vow to lay low the tyrant...` |
| `Quality` | 3 | 1 | ability:3 | `...and we are eager for the challenge.`, `...with our martial valour risen over all.`, `...yet shall our legacy be unsullied.` |

## Unhandled characteristic names (10)

| name | count |
|---|---:|
| `Orders` | 21 |
| `Roll` | 12 |
| `D6` | 12 |
| `Influence Goal` | 9 |
| `Intrigue Goal` | 9 |
| `Ability` | 8 |
| `Warp Charge` | 8 |
| `Planning Points` | 6 |
| `Dice Roll` | 6 |
| `Button Effect` | 3 |

## Per-faction health

| Faction | Units | Missing weapons | Missing stats | Missing abilities | Missing wargear | Zero pts |
|---|---:|---:|---:|---:|---:|---:|
| Aeldari - Aeldari Library *(stub)* | 0 | 0 | 0 | 0 | 0 | 0 |
| Aeldari - Ynnari | 0 | 0 | 0 | 0 | 0 | 0 |
| Chaos - Chaos Daemons | 0 | 0 | 0 | 0 | 0 | 0 |
| Chaos - Chaos Knights | 0 | 0 | 0 | 0 | 0 | 0 |
| Chaos - Chaos Knights Library *(stub)* | 20 | 0 | 0 | 0 | 1 | 0 |
| Chaos - Chaos Space Marines | 84 | 0 | 0 | 0 | 25 | 1 |
| Chaos - Daemons Library *(stub)* | 71 | 2 | 0 | 0 | 37 | 0 |
| Chaos - Death Guard | 50 | 0 | 0 | 0 | 18 | 0 |
| Chaos - Emperor's Children | 26 | 0 | 0 | 0 | 10 | 0 |
| Chaos - Thousand Sons | 40 | 0 | 0 | 0 | 13 | 0 |
| Chaos - Titanicus Traitoris | 0 | 0 | 0 | 0 | 0 | 0 |
| Chaos - World Eaters | 35 | 1 | 0 | 0 | 11 | 0 |
| Imperium - Adepta Sororitas | 40 | 1 | 0 | 0 | 15 | 1 |
| Imperium - Adeptus Astartes - Black Templars | 16 | 0 | 0 | 0 | 3 | 0 |
| Imperium - Adeptus Astartes - Blood Angels | 26 | 3 | 0 | 0 | 12 | 0 |
| Imperium - Adeptus Astartes - Dark Angels | 19 | 0 | 0 | 0 | 9 | 0 |
| Imperium - Adeptus Astartes - Deathwatch | 10 | 0 | 0 | 0 | 2 | 0 |
| Imperium - Adeptus Astartes - Imperial Fists | 3 | 0 | 0 | 0 | 3 | 0 |
| Imperium - Adeptus Astartes - Iron Hands | 2 | 0 | 0 | 0 | 2 | 0 |
| Imperium - Adeptus Astartes - Raven Guard | 2 | 0 | 0 | 0 | 2 | 0 |
| Imperium - Adeptus Astartes - Salamanders | 2 | 0 | 0 | 0 | 2 | 0 |
| Imperium - Adeptus Astartes - Space Marines | 128 | 1 | 0 | 0 | 8 | 1 |
| Imperium - Adeptus Astartes - Space Wolves | 41 | 2 | 0 | 0 | 16 | 0 |
| Imperium - Adeptus Astartes - Ultramarines | 12 | 0 | 0 | 0 | 11 | 0 |
| Imperium - Adeptus Astartes - White Scars | 2 | 0 | 0 | 0 | 1 | 0 |
| Imperium - Adeptus Custodes | 34 | 0 | 0 | 0 | 14 | 0 |
| Imperium - Adeptus Mechanicus | 41 | 0 | 0 | 0 | 13 | 0 |
| Imperium - Adeptus Titanicus | 0 | 0 | 0 | 0 | 0 | 0 |
| Imperium - Agents of the Imperium | 49 | 0 | 0 | 0 | 22 | 0 |
| Imperium - Astra Militarum | 0 | 0 | 0 | 0 | 0 | 0 |
| Imperium - Astra Militarum - Library *(stub)* | 0 | 0 | 0 | 0 | 0 | 0 |
| Imperium - Grey Knights | 33 | 0 | 0 | 0 | 9 | 0 |
| Imperium - Imperial Knights | 0 | 0 | 0 | 0 | 0 | 0 |
| Imperium - Imperial Knights - Library *(stub)* | 21 | 0 | 0 | 0 | 1 | 0 |
| Library - Astartes Heresy Legends *(stub)* | 0 | 0 | 0 | 0 | 0 | 0 |
| Library - Titans *(stub)* | 4 | 0 | 0 | 0 | 0 | 0 |
| Library - Tyranids *(stub)* | 0 | 0 | 0 | 0 | 0 | 0 |
| Unaligned Forces *(stub)* | 23 | 5 | 1 | 0 | 9 | 2 |
| Warhammer 40,000 10th Edition | 0 | 0 | 0 | 0 | 0 | 0 |
| Xenos - Aeldari | 0 | 0 | 0 | 0 | 0 | 0 |
| Xenos - Drukhari | 0 | 0 | 0 | 0 | 0 | 0 |
| Xenos - Genestealer Cults | 28 | 0 | 0 | 0 | 4 | 0 |
| Xenos - Leagues of Votann | 25 | 0 | 0 | 0 | 7 | 0 |
| Xenos - Necrons | 66 | 0 | 0 | 0 | 23 | 0 |
| Xenos - Orks | 92 | 1 | 0 | 0 | 18 | 0 |
| Xenos - T'au Empire | 66 | 2 | 0 | 1 | 14 | 0 |
| Xenos - Tyranids | 44 | 5 | 0 | 0 | 9 | 2 |

## Empty units (no weapons or no stats) — 23

- **Chaos - Daemons Library**: Feculent Gnarlmaw [no weapons]
- **Chaos - Daemons Library**: Skull Altar [no weapons]
- **Chaos - World Eaters**: Exalted Eightbound [no weapons]
- **Imperium - Adepta Sororitas**: Battle Sanctum [Legends] [no weapons]
- **Imperium - Adeptus Astartes - Blood Angels**: Sanguinary Priest [no weapons]
- **Imperium - Adeptus Astartes - Blood Angels**: Tycho the Lost [Legends] [no weapons]
- **Imperium - Adeptus Astartes - Blood Angels**: Death Company Marines with Jump Packs [no weapons]
- **Imperium - Adeptus Astartes - Space Marines**: Drop Pod [no weapons]
- **Imperium - Adeptus Astartes - Space Wolves**: Blood Claws [no weapons]
- **Imperium - Adeptus Astartes - Space Wolves**: Wolf Priest [no weapons]
- **Xenos - Orks**: Mekboy Workshop [Legends] [no weapons]
- **Xenos - T'au Empire**: Tidewall Shieldline [no weapons]
- **Xenos - T'au Empire**: Remote Sensor Tower [Legends] [no weapons]
- **Xenos - Tyranids**: Hive Tyrant [no weapons]
- **Xenos - Tyranids**: Spore Mines [no weapons]
- **Xenos - Tyranids**: Mucolid Spores [no weapons]
- **Xenos - Tyranids**: Spore Mines (Biovore) [no weapons]
- **Xenos - Tyranids**: Mucolid Spores (Sporocyst) [no weapons]
- **Unaligned Forces**: Skyshield Landing Pad [Legends] [no weapons]
- **Unaligned Forces**: Void Shield Generator [Legends] [no weapons]
- **Unaligned Forces**: Wall of Martyrs Defence Emplacement [Legends] [no weapons]
- **Unaligned Forces**: Wall of Martyrs Defence Line [Legends] [no weapons]
- **Unaligned Forces**: Searchlight [no weapons] [no stats]

## XML element frequency (top 30)

| tag | count |
|---|---:|
| `characteristic` | 56703 |
| `condition` | 26899 |
| `constraint` | 25694 |
| `modifier` | 21832 |
| `entryLink` | 18288 |
| `cost` | 17521 |
| `conditions` | 17272 |
| `constraints` | 14390 |
| `profile` | 13869 |
| `characteristics` | 13869 |
| `categoryLink` | 13306 |
| `selectionEntry` | 12144 |
| `infoLink` | 11217 |
| `entryLinks` | 11151 |
| `profiles` | 9793 |
| `modifiers` | 8662 |
| `conditionGroup` | 8654 |
| `conditionGroups` | 8541 |
| `infoLinks` | 5909 |
| `costs` | 5056 |
| `selectionEntryGroup` | 4559 |
| `selectionEntries` | 3961 |
| `categoryLinks` | 3904 |
| `selectionEntryGroups` | 3297 |
| `comment` | 3093 |
| `repeat` | 2797 |
| `repeats` | 2759 |
| `modifierGroup` | 2258 |
| `modifierGroups` | 1871 |
| `categoryEntry` | 1727 |
