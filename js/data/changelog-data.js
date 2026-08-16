// data/changelog-data.js — user-facing release notes shown by the
// "Updates" button in the topbar (js/app/changelog.js).
//
// IMPORTANT: every user-facing change (new feature, visible bug fix,
// data correction the user can notice) MUST add an entry here.
// Internal refactors, parser depth tweaks that don't change output,
// doc-only changes, and CI/build plumbing are skipped — keep the list
// aimed at things a player would actually want to know about.
//
// Conventions:
//   - `version`     : CalVer YYYY.MM.DD-N. Bump per release / deploy.
//   - `lastUpdated` : ISO 8601 timestamp of the most recent change.
//   - `entries`     : newest first. Each entry has
//       { date: 'YYYY-MM-DD', kind: 'feature' | 'fix' | 'change',
//         title: string, description?: string }
//   - `kind`:
//       'feature' → something new the user can do
//       'fix'     → bug or visible-data correction
//       'change'  → behaviour change that's not strictly a fix
//
// Same-day changes can share a date string; the modal renders day
// groups in calendar order. Keep the list to roughly the past 30 days
// so it stays scannable; older entries can be pruned when they fall
// off the window.
(function () {
  const App = window.App = window.App || {};

  App.CHANGELOG = {
    version:     '2026.08.16-1',
    lastUpdated: '2026-08-16T12:00:00Z',
    entries: [
      {
        date: '2026-08-16', kind: 'feature',
        title: 'King of the Coliseum list checker',
        description:
          'A new "King of the Coliseum" box sits under Army setup in the left ' +
          'panel. It lays out the format\'s restrictions — 600 points, one ' +
          'detachment of any size, a warlord plus at least 2 Infantry units, ' +
          'no Epic Heroes, nothing above Toughness 9 and only one unit at ' +
          'Toughness 9, and 2 copies of a Battleline datasheet but only 1 of ' +
          'anything else — and, once you tick it on, checks your list against ' +
          'every one of them as you build. Each rule shows green or red with ' +
          'exactly what is wrong (which datasheet is doubled up, which model ' +
          'is too tough), the box header carries an issue count so you can ' +
          'see a problem with the box collapsed, and a one-click button sets ' +
          'your points limit to 600. It also totals your detachment points, ' +
          'since the lower spend picks the twist. Advisory only — nothing is ' +
          'blocked or removed.',
      },
      {
        date: '2026-08-14', kind: 'fix',
        title: '126 datasheets gained abilities they were missing',
        description:
          'A batch of abilities that belong on the printed datasheet were ' +
          'simply absent from ours — Rites of Battle on Captains, Litany of ' +
          'Hate on Chaplains, Psychic Hood on Librarians, Narthecium on ' +
          'Apothecaries, Cherub on Sisters squads, Hail of Bolts on ' +
          'Intercessors, and many more across most factions. 118 datasheets ' +
          'gained a missing ability, plus a handful of weapon and ' +
          'invulnerable-save corrections. Every one of these was cross-checked ' +
          'against three independent sources and only applied where all three ' +
          'agreed, so the datasheet you see matches what GW prints.',
      },
      {
        date: '2026-08-13', kind: 'fix',
        title: 'Wargear rules now match what GW prints — 27 corrections',
        description:
          'A batch of wargear items were showing rules text shared from ' +
          'another datasheet, and in several cases it was the wrong rule ' +
          'outright. Storm Shield said "Wounds characteristic of 4" (the old ' +
          '10th-edition rule) instead of a 4+ invulnerable save on the ' +
          'Lieutenant, Thunderwolf Cavalry, Vanguard Veterans and Wolf Guard ' +
          'Headtakers — while the Wolf Guard Battle Leader’s version really ' +
          'is a Wounds change, and now says so. Simulacrum Imperialis said ' +
          '"+1 Leadership" on five Sisters units instead of generating ' +
          'Miracle dice. Also corrected: Slabshield (Wounds 7, not 4), ' +
          'Grav-talon ([LANCE]), Weavefield Crest, Teleport Crest, Cult Icon, ' +
          'Phantasm Grenade Launcher, and the T’au Battlesuit and Weapon ' +
          'Support Systems. 27 fixes across 23 datasheets in 8 factions.',
      },
      {
        date: '2026-08-13', kind: 'fix',
        title: 'Damaged profiles are back on vehicles and monsters',
        description:
          'Degrading statlines returned in 11th edition, but the ' +
          '"Damaged: X-Y wounds remaining" block was missing from every ' +
          'datasheet that has one — 220 of them, from the Tesseract Vault to ' +
          'the Exorcist to the Gladiator Lancer. It now shows up in the ' +
          'Abilities section on the datasheet and on printed data cards, so ' +
          'you can see what a model loses as it takes damage without looking ' +
          'it up.',
      },
      {
        date: '2026-08-13', kind: 'fix',
        title: 'No more abilities listed twice',
        description:
          'Some datasheets showed the same ability twice — once with its ' +
          'qualifier and once without, like "Carrier Wave (Aura)" followed by ' +
          'a second "Carrier Wave" with identical text on the Catacomb ' +
          'Command Barge. Duplicates are now recognised and dropped.',
      },
      {
        date: '2026-08-13', kind: 'fix',
        title: 'Necrons: Tesseract Vault C’tan powers, and two wrong Resurrection Orbs',
        description:
          'The Tesseract Vault’s "Powers of the C’tan" tells you to pick two ' +
          'C’tan Powers weapons each Shooting phase, but the datasheet listed ' +
          'none of them — the upstream dataset ships no profiles for them. ' +
          'Antimatter Meteor, Cosmic Fire and Time’s Arrow are now on the ' +
          'datasheet with full profiles and keywords. ' +
          'Separately, the Catacomb Command Barge and the Lokhust Lord were ' +
          'both showing the wrong Resurrection Orb rules. They were being given ' +
          'the Overlord’s wording — "while the bearer is leading a unit" — ' +
          'which is unusable on the Barge, since it is a Vehicle and cannot ' +
          'lead a unit at all. Both now show what GW actually prints: the Barge ' +
          'resurrects a NECRONS INFANTRY or MOUNTED unit within 6", and the ' +
          'Lokhust Lord resurrects its own unit.',
      },
      {
        date: '2026-08-09', kind: 'feature',
        title: 'Name your characters and units',
        description:
          'Your Blood Angels Captain can be Brother-Captain Gaius, and your ' +
          'third Intercessor Squad can be Squad Gamma. In Reserves, click a ' +
          'unit and use "Name one of these" — it splits one model off the ×N ' +
          'stack as its own unique unit with its own card, so you still own the ' +
          'same number of things, some of them just have names now. Remove the ' +
          'name and it goes back on the stack. You can also name a unit already ' +
          'in your army: click it in the army list, or click its card in Data ' +
          'cards and use the new "Card name" box. Everywhere a named unit ' +
          'appears — roster card, army list, detail panel, printed data card, ' +
          'tournament PDF — the name you gave it is the title and the real ' +
          'datasheet name sits underneath as a subtitle, so nobody is ever left ' +
          'guessing what it actually is. Names travel with army codes, share ' +
          'links and QR codes, and sync across your devices. Text and CSV ' +
          'exports print them as 1x "Squad Gamma" Intercessor Squad, keeping ' +
          'the datasheet name for your opponent and the organiser. Sharing a ' +
          'code with someone on an older version still works — they just ' +
          'won\'t see the names.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'Units could disappear from the army list while still costing points',
        description:
          'If you removed a leader, whatever it was leading stopped showing in ' +
          'the army list — but it was still in the army, still being charged ' +
          'for, and still synced. It would then reappear the next time you ' +
          'reloaded, which looked like a unit you deleted coming back on its ' +
          'own. Attachments more than three deep were dropped from the list the ' +
          'same way. Every unit in your army now always appears in the list, so ' +
          'the rows and the points total can no longer disagree. If a list has ' +
          'been mysteriously over its points, this is very likely why.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'Renaming an army and changing its points limit now actually save',
        description:
          'Renaming an army, or changing its points limit, was only ever ' +
          'changing it on the device in front of you — the change was never ' +
          'uploaded, so other devices never saw it. Worse, if you had the same ' +
          'army open in another browser, the next time this one checked in it ' +
          'would pull that other copy down and your rename would vanish, which ' +
          'looked like the other browser was blocking the edit. Both now count ' +
          'as real edits: they save straight away and sync like everything ' +
          'else. If you have been losing renames, redo the rename once and it ' +
          'will stick this time.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'Five more units get a missing datasheet ability',
        description:
          'Ancient in Terminator Armour and Company Heroes were missing ' +
          'Astartes Banner (+1 Objective Control), and Prosecutors, ' +
          'Witchseekers and the Anathema Psykana Rhino were all missing ' +
          'Daughters of the Abyss (Feel No Pain 3+ against Psychic Attacks and ' +
          'mortal wounds). The upstream data set does not link these to their ' +
          'datasheets; both of the sources we cross-check against say they ' +
          'belong there, so they are now shown with their full rules text. ' +
          'Note the Ancient’s Astartes Banner is a separate rule from Keep the ' +
          'Banner High — you should now see both.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'Four more characters get their missing datasheet abilities back',
        description:
          'Same root cause as the Wazdakka fix below, now fixed properly rather ' +
          'than one unit at a time. When the upstream data set lists no abilities ' +
          'for a character, the app fills them in from the datasheet — but a ' +
          'single correction the app itself had applied was enough to make the ' +
          'unit look already covered, so the rest of its abilities were dropped. ' +
          'The Emperor’s Champion now shows Armour of Faith and Sigismund’s ' +
          'Heir, Kor’sarro Khan shows For the Khan! and Trophy Taker, Thulia ' +
          'Ghuld shows Rod of the War Forge, Mechanicus Bodyguard and Secutor of ' +
          'Olympus, and Commissar Graves on Foot shows Icon of Discipline and ' +
          'Brutal Disciplinarian — all with full rules text. Every added ability ' +
          'was checked against two independent data sources first.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'A broken share link no longer nags you on every visit',
        description:
          'If you opened a share link that was corrupt or truncated, the app ' +
          'showed an "URL import failed" error — and then showed it again every ' +
          'single time you loaded the page, because the bad code stayed in the ' +
          'address bar (and in any bookmark of it). Short of hand-editing the URL ' +
          'there was no way to stop it. A share link now gets one attempt and is ' +
          'cleared from the address bar either way.',
      },
      {
        date: '2026-08-09', kind: 'fix',
        title: 'Wazdakka Gutsmek gets his missing abilities back',
        description:
          'Wazdakka was missing "Fixit da Grot" (he regains up to D3 lost wounds ' +
          'at the start of your Command phase) and "Throttlerokkit Shokka Engine" ' +
          '(the rule that lets you pick one of Turbo Engine, Shokk Attack Engine ' +
          'or Pulse Jet each Command phase). His datasheet in the upstream data ' +
          'set lists no abilities at all, and the backup that normally fills that ' +
          'gap was being skipped for him. Both abilities and their full rules text ' +
          'now show on his card. Thanks to dangersteve for reporting it.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'The app reopens the army you actually had open',
        description:
          'Coming back to the site after a while could drop you on a different ' +
          'army than the one you left open — usually whichever list you had ' +
          'edited most recently. The app was guessing from timestamps instead of ' +
          'remembering; simply viewing a list never updates its timestamp, so the ' +
          'guess was often wrong. It now remembers which army you were on, per ' +
          'device, and reopens that one. Starting a new empty list and stepping ' +
          'away no longer swaps you onto an old army either, and a change made in ' +
          'one browser tab now shows properly in your other tabs.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Undo sticks when you are signed in',
        description:
          'With an account, an undo could quietly come back a few seconds later ' +
          'or the next time you returned to the tab. Undo was restoring the ' +
          'old version complete with its old save time, so cloud sync decided ' +
          'your undo was the stale copy and pulled the pre-undo army back down. ' +
          'Undo now counts as a fresh edit, so it wins.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Transport capacity is back on transport datasheets',
        description:
          'Rhinos, Land Raiders, Trukks and every other transport stopped showing ' +
          'how many models they carry when we moved to the new data source — the ' +
          'datasheet and card had a Transport section ready, but nothing was ' +
          'filling it in. All 63 transports now show their capacity again, ' +
          'including the models they cannot carry (Jump Pack, Terminator and so on).',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Printed cards no longer say “unit” where the role goes',
        description:
          'Every unit card printed the literal word “unit” under its name. It now ' +
          'shows the real battlefield role — Character, Epic Hero, Battleline, ' +
          'Dedicated Transport or Fortification — and units that have no role are ' +
          'simply left blank instead of getting a placeholder.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Stratagem cards get their WHEN and TARGET back',
        description:
          '260 stratagems were showing only their effect — no “when” you may play ' +
          'them and no “target” — which is most of what makes a stratagem card ' +
          'usable. Our main data source stores those three parts separately and we ' +
          'were reading just the effect, then preferring that stub over the ' +
          'complete text we already had from our backup source. Both are now read ' +
          'in full, and the complete card always wins. Restrictions are shown too ' +
          'where they exist.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Stratagem phase filter now finds multi-phase stratagems',
        description:
          'About a fifth of stratagems can be used in more than one phase — ' +
          '“shooting or fight” is the common pair — but we only recorded the first ' +
          'one, so filtering the browser by Fight hid every shooting-or-fight ' +
          'stratagem. All of a stratagem’s phases now count, and the card lists ' +
          'them. Stratagems usable in any phase are labelled Any instead of being ' +
          'filed under Command.',
      },
      {
        date: '2026-08-08', kind: 'feature',
        title: 'Stratagem cards show whose turn, and once-per-battle limits',
        description:
          'Cards now carry the turn a stratagem may be used in — your turn, your ' +
          'opponent’s, or either — and flag the handful that are once per turn or ' +
          'once per battle rather than the usual once per phase.',
      },
      {
        date: '2026-08-08', kind: 'fix',
        title: 'Weapon abilities now show their ratings again',
        description:
          'Weapon abilities that carry a number — Sustained Hits 1, Rapid Fire 2, ' +
          'Melta 2, Anti-Infantry 4+ — were losing that number on the way into the ' +
          'app, so they read as a bare “Sustained Hits” or “Anti”. The datasheet ' +
          'usually still looked right because we prefer a second text source there, ' +
          'but everything that reads the numbers did not: the damage calculator was ' +
          'silently scoring Sustained Hits, Rapid Fire and Melta as zero and ignoring ' +
          'Anti entirely, so its expected-damage figures came out low on roughly a ' +
          'quarter of all weapons. Ratings are now carried through, the calculator ' +
          'counts them, and hovering a keyword still shows its rule. Anti abilities ' +
          'with a two-word target (Anti-Epic Hero 2+) also parse correctly now.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'Old armies now re-read corrected points',
        description:
          'A unit’s cost was copied into your army the moment you added it, ' +
          'and it stayed at that number forever — so a datasheet whose price ' +
          'we later corrected kept billing the old one. Orks Trukk was the ' +
          'clearest case: for three weeks in July it showed 65 pts, because ' +
          'our Munitorum import had picked up only its 4th-and-later surcharge ' +
          'price and missed the 55 pt base. The data was fixed on 28 July, but ' +
          'armies built before then kept charging 65. Saved armies now re-read ' +
          'the current cost for the squad size you chose, so a lone Trukk is ' +
          '55 pts again. Your own manual points overrides are left alone, and ' +
          'the app will not change a squad size you picked. Thanks to ' +
          'dangersteve for the report.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'The back button behaves properly on mobile',
        description:
          'Every time you opened a unit’s Details, the app pushed a browser ' +
          'history entry it never cleaned up. After looking at eight units, ' +
          'seven presses of Back did nothing at all and the eighth threw you ' +
          'off the site. Closing the More sheet leaked an entry too, so a ' +
          'later Back could re-open a sheet you had already dismissed. Back ' +
          'now closes exactly one thing per press — the sheet, then Details, ' +
          'then the site — and never re-opens something you closed.',
      },
      {
        date: '2026-08-07', kind: 'feature',
        title: 'Collect, Play and every tool are reachable on a phone',
        description:
          'The mode switcher lives in the top bar, which is hidden on mobile — ' +
          'so Collect (painting, crusade, kill team) and Play (match tracker, ' +
          'stratagems, damage calculator, opponent, deployment planner) had no ' +
          'way in at all on a phone. The More sheet now opens with a “Go” ' +
          'section: Build / Collect / Play, an “All tools…” entry that opens ' +
          'the full tool sheet, and “What’s new” — which is how you are ' +
          'reading this on mobile for the first time. Data cards mode also has ' +
          'a way out now, and no longer traps you there after a reload.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'Drag to reorder and attach leaders now works by touch',
        description:
          'Reordering your army list and dragging a unit onto a leader to ' +
          'attach it were mouse-only — on a phone the browser claimed the ' +
          'gesture for scrolling and the drag never started, so there was no ' +
          'way to attach a bodyguard at all. Press and hold a row for about a ' +
          'third of a second to pick it up (you get a nudge of haptic feedback ' +
          'where the device supports it), then drag; the list auto-scrolls when ' +
          'you near the top or bottom. A normal flick still scrolls as before.',
      },
      {
        date: '2026-08-07', kind: 'change',
        title: 'Bigger tap targets and real press feedback on mobile',
        description:
          'The wargear and squad-size +/− buttons were 20px squares, so ' +
          'overshooting onto the wrong one was easy — they are 44px on mobile ' +
          'now, with more space between them. The filter “clear” x, the army ' +
          'quantity box and the More sheet’s close button all grew too. ' +
          'Tapping an army row or a filter chip now visibly responds — the ' +
          'platform highlight had been switched off with nothing put in its ' +
          'place. Tapping the tab you are already on scrolls that pane back to ' +
          'the top, and switching tabs no longer loses your place in the list.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'Screen-reader, keyboard and reduced-motion fixes',
        description:
          'Status messages (“Signed in”, “Import failed”, “Sync complete”) were ' +
          'never announced to screen readers. Wargear +/− buttons rebuilt the ' +
          'panel on every press and threw away keyboard focus, so you could not ' +
          'press one twice in a row, and every one of them was announced with ' +
          'the same name. The More sheet and the sign-in dialog now trap focus ' +
          'and hand it back when they close, and the sign-in dialog closes on ' +
          'Escape or a tap outside. The “Reduced animations” setting also ' +
          'covers the whole app now — it only ever reached a handful of screens.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'Content no longer hides under the notch or the tab bar',
        description:
          'The More sheet’s title and close button rendered underneath the ' +
          'notch / Dynamic Island on newer iPhones. Collect, Play and Data ' +
          'cards ran underneath the bottom tab bar with their last rows ' +
          'unreachable, and Play and Data cards could not be scrolled to the ' +
          'bottom at all on a phone.',
      },
      {
        date: '2026-08-07', kind: 'change',
        title: 'Tidier header on detachment and stratagem detail views',
        description:
          'The points/CP badge was dropping below the name instead of sitting ' +
          'beside it, leaving the header as a stack of same-sized lines with a ' +
          'stranded number underneath. The badge now aligns to the right of ' +
          'the name, the “Detachment” / “Stratagem” label moved above the name ' +
          'as a small caption, and the name is set in the same engraved serif ' +
          'the unit datasheets use. The header block also has proper padding ' +
          'now — its text used to sit flush against the edge of its tinted ' +
          'panel.',
      },
      {
        date: '2026-08-07', kind: 'feature',
        title: 'Detachments now show their Force Disposition',
        description:
          'Every 11th-edition detachment carries a Force Disposition — Take ' +
          'and Hold, Disruption, Purge the Foe, Priority Assets or ' +
          'Reconnaissance — and a matched-play army has to have one. Click a ' +
          'detachment in the Detachments picker and it is now labelled right ' +
          'under the name, so you can see what a detachment is built to do ' +
          'before you commit to it. Hover the label for the one-line ' +
          'description. Covers all 446 detachments.',
      },
      {
        date: '2026-08-07', kind: 'fix',
        title: 'The “hide allied units” switch is now actually reachable',
        description:
          'When allied units were added on 3 August the release notes pointed ' +
          'at an “A” button in the toolbar for hiding them — but that button ' +
          'never rendered, so there was no way to turn allies off. Grey ' +
          'Knights players felt it worst: 51 of the 77 units on the Units tab ' +
          'were borrowed Imperial Agents and Imperial Knights datasheets. ' +
          'There is now a “Show allied units” switch in the Settings drawer ' +
          '(the gear in the top bar), under Display, next to “Show Legends ' +
          'units”. Turn it off and the Units tab lists only your own ' +
          'faction’s datasheets; your choice is remembered. Thanks to ' +
          'Justaskoch for reporting it.',
      },
      {
        date: '2026-08-03', kind: 'feature',
        title: 'Allied units now show up on your faction’s Units tab',
        description:
          'Bloodletters and Bloodcrushers were missing from Chaos Space ' +
          'Marines — and it turned out no allied unit in the game was ' +
          'reachable. yaab only ever showed a faction’s own datasheets, so ' +
          'the Daemonic Pact, Imperial Agents, Imperial Knights, Chaos ' +
          'Knights, Brood Brothers and every other 11e allies rule was ' +
          'invisible. All of them are now listed alongside your own units ' +
          'with a teal ALLY badge, searchable by their label (type ' +
          '“daemons” under Chaos Space Marines). Units that need a specific ' +
          'detachment say so on the badge — e.g. World Eaters see ' +
          '“Daemons of Khorne — requires Khorne Daemonkin” — and the detail ' +
          'panel spells out each rule’s points cap, warlord and enhancement ' +
          'restrictions. Going over an allied points cap now raises a ' +
          'composition warning. Use the new A button in the toolbar to hide ' +
          'allies if you want a shorter list.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Keyword corrections on 12 datasheets',
        description:
          'Checked against Games Workshop’s own app data. The Venerable ' +
          'Dreadnought’s keyword is VENERABLE DREADNOUGHT, Blue Horrors are ' +
          'BLUE (not BRIMSTONE), and the Catacomb Command Barge is a NOBLE. ' +
          'Removed keywords GW does not have: PSYKER from Corsair Voidscarred, ' +
          'SMOKE from the Defiler, GRENADES from the World Eaters Master of ' +
          'Executions, and the SPAWN/MUTANT/SORCERER tags that leaked between ' +
          'legions on datasheets shared by several of them — those shared ' +
          'sheets now carry the right keywords per legion.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Leader and Support now appear on the card as core abilities',
        description:
          'Every attaching character — 250 Leaders and 37 Support models — ' +
          'was missing the LEADER or SUPPORT keyword from its core-ability row, so ' +
          'printed cards, PDFs and exports left off a rule the official datasheet ' +
          'prints. Only the detail panel knew about it. It is now on the card, with ' +
          'the rule in the tooltip.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Support models no longer listed under “Led By”',
        description:
          'On a bodyguard unit’s datasheet, Support characters (Crypteks, ' +
          'Apothecaries, Dialogus and the rest) were listed alongside its Leaders, ' +
          'which claimed a rule that does not exist — a Support model attaches ' +
          'to the unit but does not lead it. They now get their own ' +
          '“Support Attached” section.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Support attachments show up in the synergy panel',
        description:
          'The synergy panel skipped Support characters entirely, so a Cryptek ' +
          'sitting next to the unit it can join produced no row at all. Both kinds ' +
          'of attachment are now listed — the section is called Attachments and ' +
          'each row says whether the model leads the unit or supports it.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Super-heavy Walker now listed as a core ability',
        description:
          'The Ta\u2019unar Supremacy Armour\u2019s Super-heavy Walker and the ' +
          'Seraptek Heavy Construct\u2019s Titanic Walker \u2014 the same rule ' +
          'under two names \u2014 were shown in the named-abilities list instead ' +
          'of on the core-ability row, which is where Games Workshop prints them. ' +
          'The rules text was always there and is unchanged.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Ability name no longer printed twice in its own rules text',
        description:
          'Where a rules update came from a Games Workshop faction pack, the ' +
          'ability\u2019s name was repeated at the start of its text \u2014 ' +
          '\u201cAdaptive Instincts (Once per turn, per unit): In the Fight ' +
          'phase\u2026\u201d sitting directly under the heading \u201cAdaptive ' +
          'Instincts\u201d. GW prints the name that way in the PDF; we now strip ' +
          'it, since the heading already says it.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Once-per-turn limits now shown on three abilities',
        description:
          'Games Workshop prints a usage limit as part of the ability\u2019s ' +
          'name \u2014 \u201cAdaptive Instincts (Once per turn, per unit)\u201d ' +
          '\u2014 and nowhere in the rules text, so we were showing the ability ' +
          'with no sign that it was limited at all. Fixed for Tyranid Warriors ' +
          'with Melee Bio-weapons, Boss Snikrot\u2019s Kunnin\u2019 Infiltrator ' +
          '(once per battle, per army) and the Defiler\u2019s Destroyer of ' +
          'Futures (once per phase, per unit).',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Stray ** around rules text is now proper bold',
        description:
          'Games Workshop\u2019s rules text marks emphasis with double asterisks, ' +
          'and we were printing them literally \u2014 \u201cOne **CRYPTEK** or ' +
          '**CANOPTEK** unit\u201d instead of bolding the keywords. Stratagems, ' +
          'army and detachment rules, enhancements, unit abilities, and unit ' +
          'composition and loadout lines are all affected; 6,503 pieces of rules ' +
          'text across the game now render the way the printed datacards do.',
      },
      {
        date: '2026-07-28', kind: 'feature',
        title: 'Leave your email on a bug report and we\u2019ll tell you when it\u2019s fixed',
        description:
          'The feedback form now has an optional email field. If you fill it in, ' +
          'you get one message when your report is resolved, explaining what was ' +
          'wrong and what changed. Leave it blank and nothing changes \u2014 the ' +
          'address is used for that one note and nothing else. Reports are now ' +
          'triaged automatically every hour, so most get looked at the same day.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Points corrected for 240 units — including every transport',
        description:
          'Our reader of Games Workshop’s Munitorum Field Manual was ' +
          'skipping any price GW had just changed, because changed prices are ' +
          'printed with a “▼ (-10)” marker next to them. Units ' +
          'that lost their base price fell back to a wrong figure — the ' +
          'Rhino read 75pts instead of 65, and every dedicated transport in the ' +
          'game was 10pts over. 158 units that had no official price at all now ' +
          'have one, and 82 more were corrected. All 991 priced units now match ' +
          'the MFM exactly.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Unit size options fixed (Von Ryan’s Leapers and others)',
        description:
          'Some units offered the wrong second squad size — Von Ryan’s ' +
          'Leapers showed 3 for 55pts or 4 for 105pts, when the real options are ' +
          '3 or 6. These units were missing from the official points data and ' +
          'fell back to a stale figure; they now use GW’s own sizes. ' +
          'Reported by FrumpOfWar.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Missing enhancement rules text (Synaptic Lynchpin and 6 more)',
        description:
          'Seven enhancements showed a name and cost but no rules text, because ' +
          'their name is spelled slightly differently in our dataset than in ' +
          'GW’s (“Synaptic Lynchpin” vs “Linchpin”). ' +
          'Affected Tyranids, Aeldari, Black Templars, Emperor’s Children, ' +
          'Grey Knights, Leagues of Votann and Necrons. Reported by FrumpOfWar.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Rules text filled in for 200+ unit abilities',
        description:
          'Abilities that showed a name but no rules text now have it, taken ' +
          'from Games Workshop\u2019s own data \u2014 208 abilities across 177 ' +
          'datasheets. Every ability on every unit now has its text.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'MOBILE keyword added to six characters',
        description:
          'Lion El\u2019Jonson, Roboute Guilliman, Belisarius Cawl, Fulgrim, ' +
          'Thulia Ghuld and The Red Terror were missing the 11th-edition MOBILE ' +
          'keyword. It now shows on all six, matching Games Workshop\u2019s data.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Doomhammer: Firing Deck corrected to 12',
        description:
          'The Doomhammer was showing Firing Deck 6. Games Workshop\u2019s own ' +
          'data gives it Firing Deck 12, and it now reads correctly.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Optional wargear weapons and missing core abilities restored',
        description:
          'Weapons a unit can TAKE rather than start with \u2014 the Venerable ' +
          'Dreadnought\u2019s Helfrost cannon and Fenrisian great axe, the Knight ' +
          'Destrier\u2019s Bellatus chainsword and Thundershock spear, the ' +
          'Forgefiend\u2019s Ectoplasma cannon \u2014 appeared on datasheets but were ' +
          'invisible to the damage calculator and list coach. They are now in ' +
          'the unit data, with stats taken from GW\u2019s own datasheet. Also ' +
          'added 19 missing core abilities across 13 units, including Deep ' +
          'Strike on The Red Terror and Kravek Morne, Stealth and Infiltrators ' +
          'on Cadian Recon Squads, and Lone Operative on Wazdakka Gutsmek.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Weapon values corrected against GW\u2019s own data',
        description:
          'On some weapons the datasheet showed Games Workshop\u2019s value while ' +
          'the damage calculator and list coach used a different one \u2014 the ' +
          'Defiler\u2019s guns hitting on 4+ instead of 3+, for instance. 38 weapon ' +
          'values across 9 units are now corrected in the underlying data, so ' +
          'what you see on the card is what the tools calculate with.',
      },
      {
        date: '2026-07-28', kind: 'change',
        title: 'All game data now served from yaab itself',
        description:
          'Ability and stratagem rules text, and the weapon lines on ' +
          'datasheets, were being fetched live from a third-party GitHub ' +
          'repository every time you loaded the app \u2014 so an outage there ' +
          'could blank rules text or change the weapon numbers you saw. That ' +
          'data is now bundled with yaab and served from here, versioned ' +
          'alongside everything else. The app no longer makes any external ' +
          'request for game data.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Pistols and combi-weapons now show their melee skill',
        description:
          'Weapons that are ranged but also have a melee profile \u2014 Cypher\u2019s ' +
          'bolt and plasma pistols, combi-weapons and others \u2014 showed a blank ' +
          'Weapon Skill on the melee line, and its Range read \u201cMelee\u201d with a ' +
          'stray inch mark. Both are fixed: all 1,710 melee weapon lines now ' +
          'carry the correct skill.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'FRAME keyword restored on 132 vehicles',
        description:
          'The 11th-edition FRAME keyword was missing from every vehicle that ' +
          'should have it \u2014 Rhinos, Predators, Immolators, Knights, Barges ' +
          'and 120-odd more. It is back on all 132 datasheets that carry it in ' +
          'Games Workshop\u2019s own data. (The community dataset we build on ' +
          'removed it as a non-game tag; we now keep it ourselves.)',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Flyers now show the Move that GW\u2019s own data gives them',
        description:
          'Eight aircraft were showing \u201c-\u201d for Move because we blanked it for ' +
          'everything with the AIRCRAFT keyword. Checked against Games ' +
          'Workshop\u2019s own app data, they are hover flyers with a real Move and ' +
          'the Hover ability: Valkyrie, Corvus Blackstar, Archaeopter ' +
          'Transvector, Orion Assault Dropship and Harridan at 14\u2033, the two ' +
          'Thunderhawks at 20\u2033, and the Manta at 40\u2033. The Avenger Strike ' +
          'Fighter correctly keeps \u201c-\u201d per its faction pack.',
      },
      {
        date: '2026-07-28', kind: 'feature',
        title: 'Support characters now show their own “Support” section',
        description:
          '11th edition splits attaching characters into Leaders and Support. ' +
          'Support models — Crypteks, Dialogus, Hospitaller, Apothecaries and ' +
          '34 others — were either mislabelled under a “Leader / Can lead” ' +
          'heading or showed nothing at all. They now get a proper “Support” ' +
          'section listing the units they can be attached to. All 37 Support ' +
          'datasheets are covered.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'Conditional invulnerable saves now read from official data',
        description:
          'Saves that only apply against ranged or melee attacks — Aeldari ' +
          'Rangers, the Judiciar, Knight ion shields and 34 more — were being ' +
          'annotated from a hand-maintained list. They now come straight from ' +
          'the dataset’s own ranged/melee invulnerable-save fields, so the ' +
          'value and its “Against ranged attacks only” footnote can no longer ' +
          'drift apart or go stale.',
      },
      {
        date: '2026-07-28', kind: 'fix',
        title: 'More wargear point costs, and a corrected Night Scythe',
        description:
          'Per-item wargear prices now come from the official dataset first, ' +
          'covering 49 units instead of 42 — including the Defiler’s Hades ' +
          'lascannon, Victrix Honour Guard banner, Ghostkeel cyclic ion raker ' +
          'and Riptide ion accelerator. The Night Scythe also keeps its Hover ' +
          'ability now that the upstream data ships it.',
      },
      {
        date: '2026-07-14', kind: 'fix',
        title: 'Led By: fixed missing leader attachments (Necrons and more)',
        description:
          'Necron leaders — the Chronomancer, other Crypteks, Overlords and ' +
          'named characters — were showing no “Led By” options, so you could ' +
          'not see which units they attach to (or which leaders a unit like ' +
          'Immortals or Necron Warriors can take). The app now falls back to ' +
          '40kdc’s official leader-attachment data wherever the datacard text ' +
          'source has none, restoring the correct attachments across every ' +
          'affected faction.',
      },
      {
        date: '2026-07-13', kind: 'change',
        title: 'Wargear: official text plus point-costing options you can pick',
        description:
          'One “Wargear” section, now directly under the weapons, holding the ' +
          'official datasheet wording, steppers for the options that cost ' +
          'points — grouped by the model they’re for (e.g. a squad member vs ' +
          'its pack leader) with a running points tally that feeds the army ' +
          'total — and the unit’s wargear abilities. Free options stay as text ' +
          'only; the old picker’s limits, budgets and swap logic (too many ' +
          'edge cases) are gone. “Leader” and “Led By” moved down next to ' +
          'Keywords.',
      },
      {
        date: '2026-07-13', kind: 'fix',
        title: 'Unit-upgrade enhancements no longer mistaken for character-only',
        description:
          'Some enhancements upgrade a specific unit rather than a character ' +
          '(e.g. Necrons’ “Tools of Dominion”, an IMMORTALS-only upgrade). ' +
          'When the rules text opened with a line of flavour before the ' +
          '“<UNIT> unit only” restriction, the app misread them as ' +
          'character-only. They’re now correctly tagged as unit upgrades and ' +
          'selectable on the right unit (Immortals, Sword Brethren, Armigers, ' +
          'Land Speeder Vengeance).',
      },
      {
        date: '2026-07-13', kind: 'change',
        title: 'Wargear now shown as the official datasheet wording',
        description:
          'The interactive wargear picker had too many edge cases in the ' +
          'structured options, so it’s hidden for now. Each unit’s Wargear ' +
          'section instead shows the official datasheet wording — default ' +
          'loadout and the “can be replaced with…” options — straight from ' +
          'the source. Loadouts you’d already saved on army entries are kept.',
      },
      {
        date: '2026-07-11', kind: 'change',
        title: 'Units pane opens on your faction’s units',
        description:
          'The unit-select pane now defaults to the “Faction units” view — ' +
          'the units of your selected faction — instead of your Reserves. ' +
          'New users no longer land on an empty pane or the whole-game unit ' +
          'list. If you’ve switched the view before, your choice is remembered.',
      },
      {
        date: '2026-07-11', kind: 'change',
        title: 'Mobile now opens on the Army tab',
        description:
          'On phones, first-time visitors used to land in the Units grid, ' +
          'which is confusing with no army built yet. The app now opens on ' +
          'the Army tab instead. If you’ve used the app before, it still ' +
          'remembers and restores whichever tab you were last on.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'FRAME keyword added to vehicles (11e errata)',
        description:
          '11th edition adds the FRAME keyword to most vehicles via the ' +
          'faction-pack errata; the community dataset had not applied it yet, ' +
          'so ~50 vehicles (Rhino, Razorback, Land Raiders, Battlewagon, ' +
          'Monolith, Impulsor, Predators, Storm Speeders, etc.) now carry it.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Aircraft & flyers reconciled to 11th-edition rules (from GW errata)',
        description:
          '11th edition reworked flyers, and GW applied it through the faction-' +
          'pack errata text (which overrides the datasheet cards). Two cases, ' +
          'now both handled: aircraft that stayed Aircraft lost normal movement ' +
          '(Move \u201c-\u201d, Ingress instead) and lost Hover \u2014 ' +
          'Stormhawk, Stormtalon, Doom Scythe, Valkyrie, Dakkajet, etc. Aircraft ' +
          'that were turned into hover units kept a real Move and Hover and ' +
          'dropped the Aircraft keyword \u2014 Heldrake (12"), Night Scythe ' +
          '(14"), Stormraven (14"), Lord Discordant (14"). The community ' +
          'datasets still had the old 10th-edition M20", so these were all ' +
          'wrong before.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Datasheet corrections verified against official GW faction packs',
        description:
          'Cross-checked the disputed units against Games Workshop\u2019s own ' +
          'free faction-pack and Imperial Armour PDFs. Fixes where BOTH our ' +
          'data and wahapedia were wrong (a blind spot the two-source check ' +
          'can\u2019t catch): Mutilators are M5" W5 (not M4"/W4), and the ' +
          'Skull Altar has the Infiltrators ability. (Aircraft movement was ' +
          'also flagged here and is now handled properly \u2014 see the ' +
          'flyers entry above.)',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Full-datacard verification — hundreds of missing abilities restored',
        description:
          'The two-source checker now covers the whole datacard, not just ' +
          'statlines: core abilities (Deep Strike, Scouts, Deadly Demise…), ' +
          'named abilities, wargear abilities and weapon profiles are all ' +
          'cross-checked against wahapedia AND New Recruit, and fixed when ' +
          'both agree. First pass: 584 units corrected — the upstream ' +
          'dataset systematically fails to link core abilities, so most ' +
          'datasheets gained one or more (Bloodletters and Seraphim get ' +
          'their Deep Strike back), plus ~160 named/wargear abilities with ' +
          'full rules text and six weapon-profile corrections.',
      },
      {
        date: '2026-07-11', kind: 'feature',
        title: 'Conditional invulnerable saves now shown',
        description:
          'Units whose invulnerable save only applies in certain cases (the ' +
          'Knights’ ranged-only ion shields, the Judiciar’s melee-only 4+, ' +
          'the Archon’s Shadowfield) now show an asterisk on the save in ' +
          'the details pane and on datacards, with a footnote saying when it ' +
          'applies. ~40 units gained their missing condition text.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Statline corrections confirmed by two independent sources',
        description:
          'A new weekly checker cross-references every datasheet against ' +
          'BOTH wahapedia and New Recruit’s dataset, and only auto-corrects ' +
          'when the two agree — single-source claims (like the stale ' +
          'wahapedia stats behind yesterday’s revert) go to manual review ' +
          'instead. First pass: the Defiler (CSM / Death Guard / Thousand ' +
          'Sons) is M12" T11 W18, and the Venerable Dreadnought moves 8".',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Reverted three statline changes \u2014 official datasheets win',
        description:
          'Earlier today the Defiler (CSM/Death Guard) and War Dog Moirax ' +
          'statlines were changed to match wahapedia\u2019s 11e pages. GW\u2019s ' +
          'official faction-pack PDFs contradict those pages (wahapedia is ' +
          'serving stale stats for some units), so the changes are reverted ' +
          '\u2014 the original data matches the official packs.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Combat Patrol units removed from the roster',
        description:
          'The upstream dataset\u2019s Combat Patrol datasheets (122 fixed-force ' +
          'units like \u201cAssault Force Captain\u201d at 0 points) were mixed into ' +
          'the matched-play unit list. Filtered out, same as the Combat ' +
          'Patrol detachments were.',
      },
      {
        date: '2026-07-11', kind: 'fix',
        title: 'Saved armies pick up current datasheet data',
        description:
          'Army entries kept a frozen copy of the unit from the moment it was ' +
          'added \u2014 so cards and details for older entries missed everything ' +
          'the data layer learned since (core ability flags, wargear ' +
          'abilities like the Teleport Crest\u2019s Deep Strike, corrected ' +
          'points). Entries now refresh from current data on every load.',
      },
      {
        date: '2026-07-10', kind: 'fix',
        title: 'Leagues of Votann 11e points verified current',
        description:
          'Checked against today\u2019s official Munitorum Field Manual: all 26 ' +
          'Votann datasheets carry current 11th-edition points (the MFM ' +
          'overlay re-scraped clean at a 100% match). If you\u2019re seeing old ' +
          'values, your device is running a cached copy \u2014 close all yaab ' +
          'tabs and reopen, or hard-refresh. Bug reports now also record the ' +
          'real app version so we can spot stale clients.',
      },
      {
        date: '2026-07-10', kind: 'fix',
        title: 'Combat Patrol detachments no longer clutter the picker',
        description:
          'The community dataset added Combat Patrol detachments (The ' +
          'Vardenghast Swarm and 23 more) \u2014 fixed-force mini-game content ' +
          'with no detachment rule or stratagems \u2014 and they leaked into the ' +
          'matched-play detachment list looking broken. They\u2019re excluded ' +
          'now. Thanks FrumpOfWar for the report. (A full audit of all 446 ' +
          'matched-play detachments found 397 with complete rules/stratagem/' +
          'enhancement text; the rest are missing text upstream \u2014 newest-' +
          'codex content like Librarius Conclave \u2014 and will fill in ' +
          'automatically as the community datasets author it.)',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Card back art selection is remembered',
        description:
          'The exporter now remembers which library image you had selected ' +
          'as the card back across reloads (and across devices when signed ' +
          'in) \u2014 it was saving the scale/position tuning but not the ' +
          'image choice itself.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Unit cards stop re-rendering under your cursor',
        description:
          'The units grid was being rebuilt about once a second by background ' +
          'events even when nothing visible changed, restarting the card ' +
          'glow/hover animation (\u201cgraphics keep resetting\u201d). The grid now ' +
          'skips the rebuild entirely unless the filter, unit list, points or ' +
          'loaded data actually changed \u2014 selecting a card just moves the ' +
          'highlight instead of redrawing everything.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Card exporter stops creeping and uploads work again',
        description:
          'Background events (autosave echoes, sync ticks, roster refreshes) ' +
          'were rebuilding the card exporter about once a second \u2014 nudging ' +
          'the layout/preview scroll and, worse, replacing the image-upload ' +
          'field while your file picker was open so the chosen image was ' +
          'silently dropped. The exporter now only rebuilds when the army, ' +
          'points, detachments or loaded data actually change.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Defiler no longer shows other legions\u2019 abilities',
        description:
          'The shared Defiler datasheet was flattened upstream into the union ' +
          'of every legion\u2019s abilities \u2014 the Death Guard Defiler showed ' +
          'Daemonforge and Destroyer of Futures, and all three carried Deadly ' +
          'Demise D3 instead of D6. Each legion\u2019s Defiler now matches its ' +
          'printed datasheet (CSM: Daemonforge; Death Guard: Barrage of Filth; ' +
          'Thousand Sons: Destroyer of Futures + FNP 6+; World Eaters was ' +
          'already correct).',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Nurgle\u2019s Gift shows the Contagion Range table',
        description:
          'The per-round Contagion Range values (3\u2033 / 6\u2033 / 9\u2033) are shipped ' +
          'as graphics in the community datasource, so the text version lost ' +
          'them. They\u2019re now filled in below \u201cContagion Range changes over ' +
          'the course of the battle\u201d (self-healing if the datasource inlines ' +
          'them as text).',
      },
      {
        date: '2026-07-09', kind: 'change',
        title: 'Primarch abilities are their own card section',
        description:
          'Choose-one primarch ability groups (Lord of the Death Guard, \u2026) ' +
          'now render as their own titled section on printed cards \u2014 in the ' +
          'Stencil template they were inflating the Abilities section \u2014 and ' +
          'they spill to another face independently of Abilities.',
      },
      {
        date: '2026-07-09', kind: 'change',
        title: 'Cards spill across as many pages as they need',
        description:
          'Dense datasheets (primarchs) are no longer capped at one ' +
          'continuation \u2014 in duplex mode the overflow now cascades onto ' +
          'additional cards (front and back) until everything fits. Army ' +
          'rule cards with long text (Nurgle\u2019s Gift) also paginate across ' +
          'faces instead of clipping \u2014 always on now, so the \u201csplit ' +
          'sections mid-content\u201d toggle is gone.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Primarch choose-one abilities restored',
        description:
          'Mortarion\u2019s Lord of the Death Guard options (Diseased Influence, ' +
          'Boon of Death, Inflamed Reprisal) \u2014 and the equivalent choose-one ' +
          'ability groups on other primarchs and heroes \u2014 were missing: the ' +
          'upstream dataset only carries the parent ability (\u201csee below\u201d ' +
          'with nothing below). The options are now pulled from the community ' +
          'datasource and render in the gold \u201cpick from these\u201d section on ' +
          'the details pane and printed cards.',
      },
      {
        date: '2026-07-09', kind: 'feature',
        title: 'Edit wargear on units already in your army',
        description:
          'Click a unit in your army list and its wargear picker now shows ' +
          'that squad’s saved loadout (at its actual squad size) — and ' +
          'edits apply to the squad immediately, updating its points, just ' +
          'like enhancement checkboxes. Previously the picker only ' +
          'configured a unit before adding it.',
      },
      {
        date: '2026-07-09', kind: 'change',
        title: 'Details-pane points track your wargear picks live',
        description:
          'The big points number at the top of the unit details pane now ' +
          'updates as you add or remove priced wargear (and follows the ' +
          'selected squad size), so it always shows exactly what Add to ' +
          'Army will charge — e.g. Thunderwolf Cavalry reads 100 and ticks ' +
          'up +5 per storm shield.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Unit points now match the live Munitorum Field Manual',
        description:
          'Base unit points are now sourced directly from the official MFM ' +
          'site on every data refresh, fixing ~90 stale values in the ' +
          'upstream dataset (Thunderwolf Cavalry are 100 pts, not 115 — ' +
          'storm shields are what cost +5 each; Sternguard 85, Crusader ' +
          'Squad 290 at 20 models, and more). “Your 3rd+ unit costs ' +
          'more” brackets come along too.',
      },
      {
        date: '2026-07-09', kind: 'feature',
        title: 'Wargear points costs (Munitorum Field Manual)',
        description:
          'Priced wargear from the official MFM now counts toward your army: ' +
          'squads pay for priced items in their loadout (Terminator Assault ' +
          'Squad thunder hammers +5 pts each) and get the points back when ' +
          'swapping to a free option. The wargear picker shows +/− pts on ' +
          'each choice, priced default items are labelled, and a live ' +
          '“Wargear points” line tracks the total. Costs refresh ' +
          'automatically alongside the weekly 40kdc data sync.',
      },
      {
        date: '2026-07-09', kind: 'fix',
        title: 'Cards show the full wargear counts',
        description:
          'Weapon rows on printed cards now carry \u00d7N for the squad\u2019s whole ' +
          'effective loadout \u2014 defaults at the chosen size adjusted by swaps ' +
          '(Blood Claws: bolt pistol \u00d710, chainsword \u00d79, power weapon \u00d71) \u2014 ' +
          'instead of only the swapped items. Weapons swapped away entirely ' +
          'show a dimmed \u00d70.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Big Mek in Mega Armour gets More Dakka back',
        description:
          'The upstream dataset links More Dakka on the base Big Mek but ' +
          'omits it on the Mega Armour variant. Filled in from the data’s ' +
          'own rules text (self-healing once fixed upstream).',
      },
      {
        date: '2026-07-08', kind: 'feature',
        title: '“All factions” view in the units pane',
        description:
          'A fourth button next to Reserves / Requisitions / Faction units ' +
          'shows every unit from every faction, so you can search for any ' +
          'unit even while a faction is selected.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Details pane layout overhaul',
        description:
          'Every section now uses the attached header-and-box look: the band ' +
          'header sits flush on top of its content box (weapons, abilities, ' +
          'enhancements, keywords, detachment views — all of it). The weapon ' +
          'banners house the RNG/A/BS/S/AP/D column headers. Add to Army and ' +
          'the stockpile steppers share one compact box (no more “Your ' +
          'stockpile” heading), the stats + weapons block moved up right ' +
          'under it (above the wargear picker), and the Led By box always ' +
          'shows every leader — no more “+N more” click.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Details pane polish pass',
        description:
          'All section headers now share the weapons-banner styling (the ' +
          'stray little accent line under some headers is gone and the band ' +
          'tint matches). Stats, ranged weapons and melee weapons each sit ' +
          'in their own box like the other sections. The top boxes now have ' +
          'even spacing. Hovering ANTI-X keywords (Anti-Infantry 4+, ' +
          'Anti-Vehicle 3+, …) now explains the rule. The stray arrow next ' +
          'to the faction tag and the redundant “unit” label are gone.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Removed the Σ button from the details header',
        description:
          'The “simulate attack” shortcut button is gone; the damage ' +
          'calculator is still available from the Tools menu and Play mode.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Detachments box remembers being minimized',
        description:
          'Collapsing the Detachments box now sticks across reloads, like ' +
          'Army setup and Army rules already did.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear defaults follow the selected squad size',
        description:
          'Units without authored size tiers (Wolf Guard Headtakers and ' +
          'others) showed the max-size default loadout regardless of the ' +
          'size picked — ×12 weapons on a 3-model squad. Defaults are now ' +
          'computed for every selectable size, and items the size doesn’t ' +
          'carry (0 Hunting Wolves at 3 models) are hidden.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear: official wording on hover + WGT claws fix',
        description:
          'The Wargear box now has an “official wording” hover on the right ' +
          'of its header showing the datasheet’s full wargear-options text, ' +
          'so you can read the rule then make the picks. Also corrected Wolf ' +
          'Guard Terminators: twin lightning claws / relic greataxe replace ' +
          'BOTH the storm bolter and the master-crafted power weapon, and the ' +
          'swap math + red warnings account for it.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear limits: proportional budgets + swap cascade',
        description:
          'Scaling take-limits are now proportional — “2 per 10 models” ' +
          'allows 1 at 5 models (it wrongly rounded to 0, flagging a legal ' +
          'Wolf Guard Terminators power fist + assault cannon). And swaps now ' +
          'cascade: once a pair-swap uses up a storm bolter, taking more ' +
          'storm shields than there are bolters left turns red with a “not ' +
          'enough left to swap” note.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear swaps no longer eat weapons you keep',
        description:
          'Taking a Thunderwolf Cavalry storm shield was lowering Teeth and ' +
          'Claws and Wolf Guard weapon too — but only one carried item is ' +
          'given up per swap. Swap options now distinguish “replace X, Y or ' +
          'Z” (one item, e.g. the bolt pistol) from true pair-swaps like ' +
          '“storm bolter + power weapon → power fist + assault cannon”, and ' +
          'the option text reads accordingly. Also fixed Wulfen: every model ' +
          'now starts with its Death Totem, and the stormfrag auto-launcher ' +
          'correctly replaces the totem instead of the Wulfen weapons (an ' +
          'upstream data error, self-healing once fixed there).',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear box text no longer squeezed',
        description:
          'Long limit chips (e.g. “Wolf Guard Terminator only · any number · ' +
          '2 per 10 models”) were crushing the “Replace …” line into one word ' +
          'per line. The chip now sits on its own line above and wraps ' +
          'normally.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Add row simplified — quantity box removed',
        description:
          'Add to Army now always adds one squad; click it again for a ' +
          'second copy (identical squads still stack into one ×2 entry).',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Squad size is now a +/− stepper',
        description:
          'The squad-size dropdown in the Add to Army row is now the same ' +
          '+/− stepper as the wargear rows — start at the smallest size and ' +
          'press + to step up to the next tier. Points and wargear limits ' +
          'update as you step.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Wargear picker shows your default loadout',
        description:
          'The Wargear box now opens with the squad’s default loadout at the ' +
          'chosen size (Necron Warriors start with 10× gauss flayer) and the ' +
          'counts update live as you take swaps — take 3 gauss reapers and ' +
          'the flayers drop to ×7. Where a default has exactly one swap, its ' +
          'own +/− works directly. The separate written Loadout section is ' +
          'gone for units with the picker (it duplicated this); units without ' +
          'authored options keep the written version. Also: the flavour line ' +
          'under the unit name now runs the full width and wraps instead of ' +
          'always being cut off, and the per-army pricing box matches the ' +
          'pane’s design language.',
      },
      {
        date: '2026-07-08', kind: 'feature',
        title: 'Wargear picker — build your loadout per squad',
        description:
          'Units with authored wargear options (550 datasheets) now show a ' +
          '“Wargear Options” box under Add to Army. Use the +/− steppers to ' +
          'pick weapon swaps before adding the unit; each option shows its ' +
          'limit (“Sergeant only · max 1”, “1 per 3 models”, …) and limits ' +
          'react to the squad size you pick. Going over a limit never blocks ' +
          'you — the rows just turn red so you know it’s illegal. Chosen ' +
          'counts appear as ×N next to the matching weapons on printed cards ' +
          '(toggle under Cards → Display), and they survive save / share / ' +
          'sync. Wargear point costs aren’t in the data yet — when upstream ' +
          'adds them, prices will appear here automatically.',
      },
      {
        date: '2026-07-08', kind: 'feature',
        title: 'Unit upgrade enhancements now selectable',
        description:
          '11th edition added unit-scoped “upgrade” enhancements (e.g. ' +
          '“WOLF GUARD TERMINATORS unit only”). These were wrongly locked ' +
          'behind the Character-only rule. They now unlock on the matching ' +
          'unit — including keyword targets like ADEPTUS CUSTODES WALKER — ' +
          'and carry an “Upgrade” tag so they read differently from ' +
          'character relics.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Details header uses the full card width',
        description:
          'The faction tag, unit type and the per-army pricing box were ' +
          'squeezed into the left half of the details header next to the ' +
          'points stack. They now sit on their own full-width row under the ' +
          'unit name. Enhancement point pills also right-align properly in ' +
          'their cards.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Add-to-Army box matches the redesigned pane',
        description:
          'The Add to Army box in the details pane now uses the same neutral ' +
          'card styling as the other boxes instead of the old tinted wash.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Card exporter now shows all selected detachments’ rules',
        description:
          'When more than one detachment was selected, the Cards exporter only ' +
          'included the first detachment’s rules and stratagems. It now gathers ' +
          'the full set across every selected detachment — matching the on-screen ' +
          'Army Rules box.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Wargear abilities now shown on datasheets',
        description:
          'Abilities granted by a piece of wargear — storm shield (Wounds 4), ' +
          'Astartes shield (4+ invulnerable), Reiver grav-chute (Deep Strike), ' +
          'medikits, banners, icons, Tau drones, the Wulfen’s Death Totem and ' +
          'more — now appear in a “Wargear Abilities” section on the unit detail ' +
          'pane and printed cards, matching the official datasheet. The rules ' +
          'text was in the data but never surfaced: some is attached to the ' +
          'wargear item (not the datasheet), and some was buried in the normal ' +
          'abilities list. Both are now detected and grouped. Shown for any ' +
          'wargear the unit can be equipped with — it’s up to you to know which ' +
          'options you took. 176 datasheets gained a Wargear Abilities section.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Details pane redesign — easier to read',
        description:
          'The right-hand details pane got a readability pass. Each section now ' +
          'has a tinted header band with a coloured left bar (blue for ranged, ' +
          'orange for melee, gold for stratagems). Weapons are laid out as two-' +
          'line rows so the stats line up in fixed columns and keywords sit on ' +
          'their own line instead of squeezing the table. Abilities and ' +
          'enhancements are now cards with the name on its own line, points sit ' +
          'in a right-aligned stack, and stratagems read as cards with a ' +
          'phase + CP header and a clean WHEN / TARGET / EFFECT layout.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Units pane stops jumping to the top',
        description:
          'The available-units list no longer snaps back to the top when the ' +
          'army changes, badges refresh, or a background sync runs while you’re ' +
          'scrolled down. Your scroll position is captured before the list ' +
          'redraws, and returning to the tab no longer re-filters the roster.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Weapon keyword tooltips work again',
        description:
          'Hovering a weapon keyword (Lethal Hits, Sustained Hits, Blast, Torrent, ' +
          'Melta, …) shows its rule text again. The definitions now come from the ' +
          'current data source; they had gone missing when the app switched data ' +
          'backends.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'All supplementary data now current-edition',
        description:
          'The remaining datasheet details sourced from the community layer — ' +
          'weapon profiles, loadouts, wargear options, unit composition, and ' +
          'which units a character can lead — are now pulled from the current ' +
          'edition instead of last edition’s. Coverage improved too (chapter-' +
          'specific units like Grey Hunters now get theirs).',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Filled in datasheets that were missing their abilities',
        description:
          'Some units showed no abilities at all (Emperor’s Champion, the generic ' +
          'Captain, The Red Terror, Commissar Yarrick, Wazdakka Gutsmek and more) ' +
          'because the upstream dataset hadn’t linked them. Their abilities are ' +
          'now filled in from the current data source, and abilities that were ' +
          'listed without any text now show their rules.',
      },
      // ── 2026-07-08 ──────────────────────────────────────────────────────
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Current-edition rules text for stratagems, enhancements & detachments',
        description:
          'Stratagem, enhancement, and detachment/army-rule wording now comes ' +
          'from the current 11th-edition data source instead of last edition’s. ' +
          'Enhancements that were showing with no text now have it, and for Space ' +
          'Marine chapters the generic codex detachments (Gladius, Anvil Siege, …) ' +
          'now carry their full stratagem and enhancement text on the chapter’s ' +
          'own copies, not just on vanilla Space Marines.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Army rules no longer clutter unit cards',
        description:
          'Army-wide rules (Oath of Moment, Reanimation Protocols, Waaagh!, For ' +
          'the Greater Good, Mission Tactics, Voice of Command, …) were showing ' +
          'as empty abilities on individual datasheets. They now appear only in ' +
          'the Army Rules section where they belong; genuine unit abilities are ' +
          'untouched.',
      },
      {
        date: '2026-07-08', kind: 'feature',
        title: 'Read a detachment before you pick it',
        description:
          'In the Detachments box, tick the checkbox to add a detachment to your ' +
          'army; click anywhere else on its row to read its full rule, ' +
          'enhancements, and stratagems in the Details pane — so you can compare ' +
          'options before committing. Each enhancement and stratagem is boxed so ' +
          'they’re easy to tell apart.',
      },
      {
        date: '2026-07-08', kind: 'change',
        title: 'Expanding Army or Details now hides only the Units pane',
        description:
          'The Army list and the Unit details pane work together, so expanding ' +
          'either one no longer hides the other — it tucks away the Units browser ' +
          'and shows both side by side: the Army pane takes two-thirds and lays ' +
          'your units out as a card grid, with Details as the smaller third. ' +
          'Expanding the Units pane still goes fullscreen as before.',
      },
      {
        date: '2026-07-08', kind: 'feature',
        title: 'New Detachments picker — choose more than one',
        description:
          'Detachment selection moved out of the Army setup dropdown into its own ' +
          'Detachments box. It lists every detachment available to your army; ' +
          'click to add or remove one (you can pick several). Each shows its ' +
          'detachment-points cost and the box tallies a running total. For Space ' +
          'Marine chapters, the chapter’s own detachments are listed first ' +
          '(A–Z), then the generic codex ones. All selected detachments’ ' +
          'rules, enhancements, and stratagems now show together in Army rules & ' +
          'stratagems, and their enhancements are all available to your characters.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Detachments no longer show stratagems from a different detachment',
        description:
          'Some detachments (e.g. Champions of Fenris) listed extra stratagems ' +
          'that did not belong to them — leftovers from an older edition of a ' +
          'same-named detachment in the fallback data (you would see things like ' +
          'Chilling Howl or even Armour of Contempt bleed in). The stratagem list ' +
          'now shows exactly the stratagems that detachment actually has.',
      },
      {
        date: '2026-07-08', kind: 'fix',
        title: 'Space Wolves detachment rules filled in',
        description:
          'Three Space Wolves detachments — Champions of Fenris, Legends of ' +
          'Saga and Song, and Veterans of the Fang — were selectable with their ' +
          'stratagems and enhancements listed, but the rule, enhancement, and ' +
          'stratagem text was blank. Their full rules are now written in (from ' +
          '40k.app). This is a stopgap: when the upstream dataset publishes the ' +
          'official text, it takes over automatically.',
      },
      // ── 2026-07-07 ──────────────────────────────────────────────────────
      {
        date: '2026-07-07', kind: 'feature',
        title: 'Choose how dense cards split across pages',
        description:
          'Data cards now split by whole section. Click a unit card in the ' +
          'exporter to open a panel and send whole sections (Abilities, a ' +
          'weapon block, Keywords, …) to a continuation card, card by card. An ' +
          'automatic split is offered as a starting point — keywords stay on ' +
          'the front card unless the stats and weapons need the room — and your ' +
          'per-card choices are remembered.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Weapon names line up with ability text on cards',
        description:
          'Weapon names were indented slightly further right than the ability ' +
          'text below them. They now share the same left edge.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Data card exporter remembers which cards you picked',
        description:
          'The card exporter reset to "everything selected" whenever you left ' +
          'and came back, or after a background refresh. Your selection now ' +
          'persists (per device) across navigation, refreshes and reloads — ' +
          'cards you deselect stay deselected, and newly added cards still ' +
          'appear selected by default.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Dense unit cards paginate instead of clipping',
        description:
          'A unit with a lot of abilities (e.g. Illuminor Szeras) could clip ' +
          'its keyword footer or strand it on a near-empty second card. Cards ' +
          'now fill the first page with the stats, weapons and as many ability ' +
          'rows as fit, then flow the rest — with the keywords at the bottom of ' +
          'the last card.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Stratagem cards: no more stray "&x20;" and bunched WHEN/TARGET/EFFECT',
        description:
          'Some rules text carried encoded characters — including a malformed ' +
          'encoded space ("&x20;") shipped on 30+ stratagem/rule strings — that ' +
          'printed literally on cards and, not being real whitespace, stopped ' +
          'the WHEN / TARGET / EFFECT blurbs from breaking onto their own lines. ' +
          'Those entities (well-formed and malformed) are now decoded, and each ' +
          'WHEN / TARGET / EFFECT / RESTRICTIONS / DURATION line starts its own ' +
          'stanza.',
      },
      {
        date: '2026-07-07', kind: 'change',
        title: 'Keywords are bold on data cards',
        description:
          'On printable data cards, ALL-CAPS keywords in rules and ability text ' +
          '(ADEPTUS ASTARTES, MONSTER, VEHICLE, WOLF PRIEST, …) are now bold, ' +
          'and bracketed weapon abilities like [DEVASTATING WOUNDS] or ' +
          '[SUSTAINED HITS 1] are bolded including their brackets — matching the ' +
          'printed datasheet style.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Data cards stop pushing the keyword footer to a second page',
        description:
          'A dense unit (e.g. Illuminor Szeras) could push just its KEYWORDS ' +
          'footer onto a near-empty second card while the abilities stayed on ' +
          'the first. Card pagination now only splits on long weapon lists; ' +
          'abilities never trigger a page split, so the keyword footer stays ' +
          'put on the card.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Space Wolves: Curse of the Wulfen added',
        description:
          'Space Wolves now show their Curse of the Wulfen army rule alongside ' +
          'Oath of Moment (+1 Objective Control for Infantry / +3 for Vehicles ' +
          'while near a Space Wolves Character or Wolf Priest and not ' +
          'Battle-shocked).',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Detachment rules now show for Space Marine chapters',
        description:
          'Space Marine chapter detachments (Space Wolves, Blood Angels, Dark ' +
          'Angels, Black Templars, Deathwatch, etc.) had no detachment rule ' +
          'text, so their rule cards were empty. Generic codex detachments now ' +
          'inherit the Space Marines rule text, and chapter-specific ones (e.g. ' +
          'Saga of the Great Wolf, Champions of Fenris, Inner Circle Task ' +
          'Force, Black Spear Task Force, Liberator Assault Group) now pull ' +
          'their full rules — including multi-part detachments — from the ' +
          'rules overlay. A few other factions (Chaos Knights, World Eaters) ' +
          'that were missing detachment text also benefit.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Space Marine chapter army rules corrected',
        description:
          'Every Space Marine chapter now shows its army rule correctly. Blood ' +
          'Angels and Deathwatch were showing a blank card (their "The Red ' +
          'Thirst" / "Mission Tactics" are actually detachment rules, not army ' +
          'rules) — they now show Oath of Moment, which is their real army ' +
          'rule. Black Templars now show Templar Vows (which replaces Oath of ' +
          'Moment), including all four selectable vows. (Space Wolves\' Curse ' +
          'of the Wulfen is still being confirmed and will follow.)',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Multi-profile weapons show their full name',
        description:
          'Weapons with two firing modes (e.g. Bjorn\'s "Helfrost cannon", ' +
          'plasma "Standard/Supercharge", missile "Krak/Frag") were showing ' +
          'only the mode label and dropping the weapon name. Each profile now ' +
          'reads "Weapon name – Mode" so the weapon is identifiable.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Data cards no longer show literal ** around bold text',
        description:
          'Rules and ability text on printable data cards marks keywords in ' +
          'bold using "**...**"; the cards were showing the raw asterisks ' +
          'instead of bolding the text. Those are now rendered as bold. Bare ' +
          'single asterisks in stat values (e.g. "D6+*") are left untouched.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Chapters no longer show every Space Marine unit',
        description:
          'Selecting a Space Marine chapter (Space Wolves, Blood Angels, Dark ' +
          'Angels, Black Templars, etc.) was showing the entire Space Marines ' +
          'roster — including other chapters\' unique units like Death Company, ' +
          'Deathwing Knights and Sanguinary Guard. Each chapter now shows the ' +
          'generic Codex units it can bring plus its OWN chapter-specific ' +
          'units, and hides the units locked to other chapters.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Oath of Moment now shows its full rules text',
        description:
          'The Space Marines army rule card listed "Oath of Moment" by name ' +
          'but had no description. The complete current-edition text is now ' +
          'shown, including both parts: the Hit re-roll against your Oath ' +
          'target, and the +1 to Wound that only applies with a Codex: Space ' +
          'Marines Detachment when your army has no Black Templars, Blood ' +
          'Angels, Dark Angels, Deathwatch or Space Wolves units.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Land Speeder abilities now appear',
        description:
          'The Land Speeder was missing its abilities. Its Deep Strike (core) ' +
          'and Purgation Run (shoot-then-move, no charge) abilities now show ' +
          'on its datasheet.',
      },
      {
        date: '2026-07-07', kind: 'fix',
        title: 'Eradicator Squad with Heavy Bolters shows its ability',
        description:
          'The Heavy Bolters variant of the Eradicator Squad had no abilities ' +
          'listed. Its Overlapping Detonations ability (granting [BLAST] to its ' +
          'heavy bolters against a chosen non-Monster/Vehicle unit) now appears.',
      },
      // ── 2026-06-26 ──────────────────────────────────────────────────────
      {
        date: '2026-06-26', kind: 'fix',
        title: 'Variable Attacks no longer bleed into the next stat on cards',
        description:
          'On printable data cards, a weapon with a wide Attacks value like ' +
          '"D6+*" or "2D6" overflowed its narrow column and ran on top of the ' +
          'BS stat beside it. The Attacks column is now wide enough for these ' +
          'values, and a weapon that can\'t make hit rolls (Torrent, etc.) now ' +
          'shows its BS/WS as a simple "—" instead of "N/A".',
      },
      {
        date: '2026-06-26', kind: 'fix',
        title: 'Dense data cards spill across pages more gracefully',
        description:
          'When a unit\'s weapons ran longer than one card (e.g. the Redemptor ' +
          'Dreadnought), the whole weapons block jumped to the next page and ' +
          'left the first page nearly empty. A weapon section too big to fit ' +
          'on page one alongside the stat block now keeps the stats AND fills ' +
          'the page with the weapon rows that fit, spilling only the ' +
          'remainder, and drops the FACTION KEYWORDS / KEYWORDS footer to the ' +
          'spillover page so those rows reclaim its space. Ordinary spillover ' +
          'is unchanged — whole sections move and the keywords stay on page ' +
          'one. With the "separate continuation cards" ' +
          'spillover option, a very dense unit can now flow across as many ' +
          'cards as it needs instead of getting clipped.',
      },
      // ── 2026-06-20 ──────────────────────────────────────────────────────
      {
        date: '2026-06-20', kind: 'fix',
        title: 'Nekrosor Ammentar now shows Deep Strike',
        description:
          'Nekrosor Ammentar (Necrons) was missing the Deep Strike core ability ' +
          'because the upstream dataset doesn\'t list it on that datasheet yet ' +
          '(reported upstream). Patched it back in so it shows in the unit\'s ' +
          'CORE abilities; the patch removes itself automatically once the ' +
          'dataset is corrected.',
      },
      {
        date: '2026-06-20', kind: 'change',
        title: 'Core rules show as a compact inline list on data cards',
        description:
          'Core abilities (Deep Strike, Scouts, Feel No Pain, Fights First, …) ' +
          'now render as a single inline "CORE:" list on data cards instead of ' +
          'each getting its own full ability block with rules text — matching ' +
          'the real datasheet layout and freeing up card space for the unit\'s ' +
          'unique abilities. (Their full text still appears in the unit detail ' +
          'panel.) Note: a core rule only shows if the underlying dataset lists ' +
          'it for that unit; a few brand-new provisional datasheets are still ' +
          'missing some, which will fill in as the dataset is updated.',
      },
      // ── 2026-06-18 ──────────────────────────────────────────────────────
      {
        date: '2026-06-18', kind: 'change',
        title: 'Header text prints thicker on data cards',
        description:
          'Following the section labels, the unit / stratagem name and the ' +
          'faction name on the dark header bar now print with slightly thicker ' +
          'letter strokes too, so the skinniest serif parts no longer drop out ' +
          'against the dark background on some printers.',
      },
      {
        date: '2026-06-18', kind: 'change',
        title: 'Section headers print thicker on data cards',
        description:
          'The light-on-dark section labels (RANGED WEAPONS, MELEE WEAPONS, ' +
          'ABILITIES, …) now print with slightly thicker letter strokes, so the ' +
          'skinniest parts of the serifs no longer drop out against the dark ' +
          'header background on some printers.',
      },
      {
        date: '2026-06-18', kind: 'change',
        title: 'Melee weapons show range as "M" on data cards',
        description:
          'On printable data cards, a melee weapon\'s range now reads a compact ' +
          '"M" instead of the full word "Melee", which was wide enough to crowd ' +
          'the Attacks number next to it.',
      },
      {
        date: '2026-06-18', kind: 'change',
        title: 'Weapon keywords sit on their own full-width line under the weapon',
        description:
          'On printable data cards, a weapon\'s keyword chips (Assault, Lethal ' +
          'Hits, etc.) now drop onto their own line beneath the weapon and run ' +
          'the full width of the card — like the older card layout — instead of ' +
          'trailing inline off the name and wrapping early at the narrow name ' +
          'column.',
      },
      {
        date: '2026-06-18', kind: 'fix',
        title: 'Army rules are back in the rules list and on cards',
        description:
          'Each faction\'s army rule (e.g. Grey Knights\' "Gate of Infinity", ' +
          'Space Marines\' "Oath of Moment") had gone missing from the Army ' +
          'Rules list and from printable cards after the 11th-edition data ' +
          'switch — the new dataset names the rule but omits its text, so we ' +
          'were dropping it entirely. The rule now shows again, with its full ' +
          'rules text pulled from the community card data.',
      },
      {
        date: '2026-06-18', kind: 'change',
        title: 'Stratagem cards now name their detachment, CP pinned top-right',
        description:
          'Printed/PDF detachment stratagem cards now show the detachment name ' +
          '(e.g. "Teleport Strike Force") in the subtitle instead of just the ' +
          'generic "DETACHMENT STRATAGEM", so it is clear which detachment a ' +
          'stratagem belongs to. The CP cost pill is also anchored to the ' +
          'card\'s top-right corner (inside the borderless safe margin) — it ' +
          'was previously inflating the title line and nudging the subtitle ' +
          'downward.',
      },
      {
        date: '2026-06-18', kind: 'fix',
        title: 'Leaders no longer all claim to lead Raveners',
        description:
          'Every leader (Castellan Crowe, Librarians, Captains — across all ' +
          'factions) was showing a bogus "Leader" ability saying it could be ' +
          'attached to Raveners, while its real "can lead" info was missing. ' +
          'The 11th-edition dataset tags every leader with the same generic ' +
          '"Leader" ability id, and our rules-text store held a single entry ' +
          'for it (the Tyranids\' Raveners text), so it leaked onto everyone — ' +
          'and made every leader appear under Raveners\' "Led By" list. We now ' +
          'drop that placeholder ability and source the real leader / bodyguard ' +
          'pairings from the structured data instead.',
      },
      {
        date: '2026-06-18', kind: 'fix',
        title: 'Reserves no longer flash in and disappear on load',
        description:
          'In the Reserves / Requisitions unit view, your owned units could ' +
          'appear for a moment on page load and then vanish until you switched ' +
          'browser tabs and back. Two roster renders firing in the same instant ' +
          'were collapsing all the duplicate-collapsing logic onto the second ' +
          'render, leaving it empty. The view now renders consistently on first ' +
          'paint.',
      },
      {
        date: '2026-06-18', kind: 'fix',
        title: 'Reserves & Requisitions restored after the 11th-edition data switch',
        description:
          'When the app moved to the 40kdc 11th-edition dataset, your Reserves ' +
          'and Requisition Requests could show a count (e.g. "22") but render ' +
          'empty, because they still pointed at the old unit ids. Your stockpile ' +
          'now heals itself automatically on load — the saved units reappear with ' +
          'their quantities intact. No action needed.',
      },
      // ── 2026-06-17 ──────────────────────────────────────────────────────
      {
        date: '2026-06-17', kind: 'fix',
        title: 'Army list: per-unit total now includes the scaling surcharge',
        description:
          'For datasheets with per-army scaling costs (e.g. 2 Canoptek Wraiths ' +
          '= 95 + 115 = 210), the army-list line showed only the base × count ' +
          '(190) even though the army total was right. Each line now includes ' +
          'its scaling surcharge — marked with a small ▲ — so the per-unit ' +
          'totals add up to the army total.',
      },
      {
        date: '2026-06-17', kind: 'feature',
        title: 'Scaling (per-army) points costs are now shown and counted',
        description:
          'Some 11th-edition datasheets cost more for extra copies (e.g. your ' +
          '3rd one onward). The unit detail now spells out both price bands ' +
          '(“1st–2nd in army” vs “3rd+ in army”), the squad dropdown no longer ' +
          'shows confusing duplicate sizes, and your army total automatically ' +
          'charges the higher cost for copies past the threshold — counted ' +
          'across your whole list.',
      },
      {
        date: '2026-06-17', kind: 'fix',
        title: 'Unit detail: points moved under the name',
        description:
          'The points cost now sits on its own line directly under the unit ' +
          'name instead of crowding the buttons in the top-right — multi-tier ' +
          'costs no longer overflow the header.',
      },
      {
        date: '2026-06-17', kind: 'feature',
        title: 'Better stratagem coverage (11th-edition first)',
        description:
          'Stratagems now come from the 11th-edition data first, falling back ' +
          'to the older source only where the new text isn’t written yet. New ' +
          '11th-edition detachments that previously showed no stratagems now ' +
          'list them with full rules text, CP and phase. Coverage keeps ' +
          'improving automatically as the 11th-edition data fills in.',
      },
      {
        date: '2026-06-17', kind: 'fix',
        title: 'Updated to confirmed 11th-edition launch points',
        description:
          'The first 11th-edition cut used provisional pre-launch point ' +
          'estimates. Refreshed to the confirmed launch values, so most ' +
          'points are now final (e.g. Khârn 100→115, Angron 340→350). ' +
          'Also pulled in a lot more stratagems and enhancements. A handful ' +
          'of units are still provisional and will firm up.',
      },
      {
        date: '2026-06-17', kind: 'change',
        title: '⚔ Now running on 11th edition data (new data source)',
        description:
          'Datasheets, points, weapons, abilities, detachments and enhancements ' +
          'now come from the community 40kdc 11th-edition dataset instead of the ' +
          '10th-edition BattleScribe data — so the whole roster is 11th edition. ' +
          'Stratagem rules text is still filled in from the previous source where ' +
          'it overlaps; brand-new 11th-edition detachments may be missing their ' +
          'stratagem and detachment-rule text for now while that data fills in. ' +
          'Some early-launch entries are provisional and will firm up. Spotted ' +
          'something wrong? Use the in-app bug report — we are working through ' +
          'issues as they surface.',
      },
      {
        date: '2026-06-17', kind: 'fix',
        title: 'Data cards: invuln shield on multi-statline units (Industrial Stencil)',
        description:
          'On the Industrial Stencil template, units with more than one stat ' +
          'line (e.g. the Silent King) were stretching a single invulnerable-' +
          'save shield down the side of both rows. The shield now sits at the ' +
          'end of each stat line — shown on every line for a unit-wide invuln, ' +
          'or only on the line that has it when a profile carries its own ' +
          'invulnerable save.',
      },
      {
        date: '2026-06-17', kind: 'feature',
        title: 'Data cards: borderless safe-margin + full-bleed controls',
        description:
          'New under Cards → Layout → "Borderless & bleed". The Safe margin ' +
          'slider nudges all text and data inward from the card edge while ' +
          'the background and frame still run to the edge — so a borderless ' +
          'printer that enlarges/overprints the page no longer clips your ' +
          'text. "Bleed background to sheet edge" drops the sheet margin and ' +
          'the gaps between cards to zero so the card background reaches the ' +
          'paper edge (best with one card per sheet). Both are saved with ' +
          'your presets.',
      },
      {
        date: '2026-06-17', kind: 'feature',
        title: 'Data cards: new Industrial Stencil template (faction-themed)',
        description:
          'A third card template, "Industrial Stencil" — cream cardstock with ' +
          'a near-black header bar, a faction-coloured accent rule, and ' +
          'Cinzel + EB Garamond lettering. It auto-themes to your army\'s ' +
          'faction: the accent recolours the header rule, the invulnerable-' +
          'save shield, weapon-ability pills, the stratagem CP hex badge, ' +
          'section ticks, and the keyword labels. Invuln saves now show as a ' +
          'distinct shield beside the stat line on this template, and weapon ' +
          'abilities (Lethal Hits, etc.) render as little pills. Pick it under ' +
          'Cards → Layout → Card template. It’s a light, ' +
          'printer-friendly look alongside Gilded Parchment and Grimdark Iron.',
      },
      // ── 2026-06-16 ──────────────────────────────────────────────────────
      {
        date: '2026-06-16', kind: 'feature',
        title: 'Data cards: switchable visual templates + new Grimdark Iron skin',
        description:
          'Cards mode now has a "Card template" picker (under Layout) that ' +
          're-skins every card. "Gilded Parchment" is the original light ' +
          'GW-datasheet look (now a named template, and the most ' +
          'printer-friendly). "Grimdark Iron" is a new dark, ' +
          'gothic-industrial skin — blackened-iron surface, oxidised-bronze ' +
          'frames and bars, bone-coloured ink, and dried-blood CP/invuln ' +
          'pips. Your layout, typography, and display toggles carry over ' +
          'when you switch, and the chosen template is saved with your ' +
          'presets so it follows you across devices.',
      },
      // ── 2026-06-05 ──────────────────────────────────────────────────────
      {
        date: '2026-06-05', kind: 'fix',
        title: 'Deleted armies no longer reappear after a sync',
        description:
          'When you deleted a saved army while signed in, the next time the ' +
          'app pulled from the cloud (on tab focus, re-sign-in, or another ' +
          'device check-in) it would re-upload the still-local copy and the ' +
          'army would come back. The sync layer now recognises that a ' +
          'previously-synced army that\'s missing from the cloud means it ' +
          'was deleted on another device, and propagates the deletion ' +
          'locally instead of resurrecting it.',
      },
      // ── 2026-05-28 ──────────────────────────────────────────────────────
      {
        date: '2026-05-28', kind: 'change',
        title: 'Data cards: weapon "Range" header shortened to "R"',
        description:
          'The "Range" column heading on weapon tables is now just "R" so ' +
          'it no longer crowds the "A" (Attacks) heading next to it. The ' +
          'values in the column are unchanged.',
      },
      // ── 2026-05-27 ──────────────────────────────────────────────────────
      {
        date: '2026-05-27', kind: 'fix',
        title: 'Data cards: weapon stat headers now line up with their columns',
        description:
          'On printed/preview data cards, the weapon stat letters (Range, ' +
          'A, BS/WS, S, AP, D) were offset from the numbers beneath them — ' +
          'the header row and the value table were laid out independently. ' +
          'The columns are now a fixed, shared width (with Range and Damage ' +
          'given the extra room they need), so each heading sits centred ' +
          'over its values.',
      },
      {
        date: '2026-05-27', kind: 'fix',
        title: 'Cards mode: saved presets now sync to other devices',
        description:
          'Named card-printing presets are stored in your synced account ' +
          'bag, but when you signed in on a second browser they often ' +
          'didn\'t appear until a manual reload — the code that reacts to ' +
          'a fresh cloud pull only reloaded the live card settings, not ' +
          'your saved presets. Both now refresh as soon as the pull lands, ' +
          'so your presets show up right after signing in elsewhere.',
      },
      {
        date: '2026-05-27', kind: 'fix',
        title: 'Cards mode: preview no longer jumps to the top when you tweak settings',
        description:
          'In Cards mode, every settings change (toggling a section, dragging ' +
          'an intensity slider, picking a border colour or layout) rebuilds ' +
          'the card preview — which was snapping you back to the top of the ' +
          'preview each time, making it painful to fine-tune cards while ' +
          'scrolled down. The preview now keeps your scroll position across ' +
          'these updates.',
      },
      // ── 2026-05-21 ──────────────────────────────────────────────────────
      {
        date: '2026-05-21', kind: 'fix',
        title: 'Saved armies now pick up datasheet fixes on reload',
        description:
          'Units in a saved army stored their own copy of the datasheet from ' +
          'when they were added, so corrections (like the Core Abilities fix ' +
          'below) only showed on freshly-added units — existing armies kept ' +
          'the old version until you removed and re-added the unit. Armies ' +
          'now refresh each unit\'s datasheet from the latest data on load, ' +
          'keeping your choices (count, points, enhancements, attachments) ' +
          'intact, so future fixes apply automatically.',
      },
      {
        date: '2026-05-21', kind: 'fix',
        title: 'Detachment rules no longer pollute a unit\'s Core Abilities',
        description:
          'Necron units were listing every detachment rule (Annihilation ' +
          'Protocol, Command Protocols, Hyperphasing, Power Matrix, Worthy ' +
          'Foes, Technosorcerous Augmentations, Cold Fervour, Cosmic ' +
          'Distortion) under Core Abilities, no matter which detachment was ' +
          'picked. These come from a shared "Detachment Rules" list that ' +
          'BSData hides per-detachment; the parser now honours that gating ' +
          'for rule links the same way it already did for aura profiles, so ' +
          'only true core abilities (e.g. Reanimation Protocols) remain on ' +
          'the unit. Bumped the cached-data version so the fix applies on ' +
          'next load.',
      },
      // ── 2026-05-20 ──────────────────────────────────────────────────────
      {
        date: '2026-05-20', kind: 'fix',
        title: 'Text export now shows attached leaders under their unit',
        description:
          'When you attach a character to a unit (e.g. a Royal Warden led ' +
          'into an Immortals squad), the "Copy as text" export flattened ' +
          'everything into one list, losing the attachment. Attached units ' +
          'are now indented beneath the unit they\'re attached to — matching ' +
          'how they nest in the Army list — so a leader + its squad reads as ' +
          'one cluster. Enhancements stay listed under their own unit.',
      },
      {
        date: '2026-05-20', kind: 'fix',
        title: 'Fixes now reach you on a normal reload — no more hard-refresh',
        description:
          'Some recently-fixed datasheet issues (e.g. the Votann "Firebase ' +
          'Control" / "Guerrilla Adepts" auras showing outside their ' +
          'detachment, or the Hekaton Land Fortress\'s Pan-spectral scanner) ' +
          'could keep appearing for anyone whose browser had cached the old ' +
          'app code, hiding the fix until a manual hard-refresh. The site ' +
          'now tells browsers to re-check the app code on every visit and ' +
          'tags each release with a version stamp, so a fix goes live for ' +
          'everyone on the next ordinary page load.',
      },
      {
        date: '2026-05-20', kind: 'fix',
        title: 'Deff Dread no longer shows "4 models"',
        description:
          'The Ork Deff Dread (and other single models that must take a ' +
          'fixed number of weapons) reported the wrong model count: its ' +
          '"pick 4 weapons" wargear group was being read as a 4-model unit. ' +
          'Composition now only counts groups that actually choose models, ' +
          'so the Deff Dread reads as one model. Bumped the cached-data ' +
          'version so the fix takes effect on next load.',
      },
      {
        date: '2026-05-20', kind: 'fix',
        title: 'Saved army\'s faction & detachment restore correctly on reload',
        description:
          'Reopening the app sometimes left the faction, chapter and ' +
          'detachment dropdowns blank even though the saved army had them ' +
          'set. The first restore attempt could fire before the detachment ' +
          'list had finished loading and, in doing so, wiped the saved ' +
          'picks. The app now keeps a snapshot of the saved selections and ' +
          're-applies them once everything has loaded.',
      },
      {
        date: '2026-05-20', kind: 'fix',
        title: 'Feedback form\'s submit button is reachable on mobile',
        description:
          'On phones the bottom tab bar was covering the "Send report" / ' +
          '"Send request" button at the bottom of the feedback form, making ' +
          'it impossible to submit. The form now sits above the tab bar.',
      },
      // ── 2026-05-16 ──────────────────────────────────────────────────────
      {
        date: '2026-05-16', kind: 'fix',
        title: 'Multi-statline units (Beast Snagga Boyz, etc.) now show every model\'s stats',
        description:
          'Squads where the boss model has a different statline from the ' +
          'troopers — Beast Snagga Boyz (Boy vs Nob), Kommandos (Boy / ' +
          'Nob / Bomb Squig) and similar — were only showing the first ' +
          'model\'s stats. The parser stopped at the first statline it ' +
          'found instead of collecting them all; it now aggregates every ' +
          'distinct model statline (identical lines still collapse to ' +
          'one). The unit detail panel and the printable data cards both ' +
          'render one labelled stat row per model now. Bumped the cached-' +
          'data version so the fix takes effect on next load.',
      },
      // ── 2026-05-15 ──────────────────────────────────────────────────────
      {
        date: '2026-05-15', kind: 'change',
        title: 'Army-list card: model count moved to its own line below the name',
        description:
          'The squad-size label (e.g. "20 models") used to share the ' +
          'title row with the unit name, squeezing long names like ' +
          '"Necron Warriors". It now lives on a dedicated sub-line below ' +
          'the title, sharing that row with the "+N attached" pill when ' +
          'a leader is attached. Long names get the full header width to ' +
          'themselves, and the model count + cluster-total pill line up ' +
          'nicely side-by-side. Entries with no model count and no ' +
          'attachments are unchanged.',
      },
      {
        date: '2026-05-15', kind: 'change',
        title: 'Army pane is ~10% wider by default',
        description:
          'The left army pane now defaults to 330 px (was 300 px) and ' +
          '290 px on narrow viewports (was 260 px). Gives the recently-' +
          'shipped attached-unit clusters more horizontal breathing room ' +
          'on top of the in-pane density tightenings. Drag-to-resize ' +
          'still works the same way — your manual width preference takes ' +
          'precedence until you reload.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Units pane stops jumping back to the top when you scroll',
        description:
          'The middle units pane was snapping back to the top whenever ' +
          'a re-render fired — autosave after adding a unit, cloud sync ' +
          'pulling fresh state on tab refocus, drag-to-attach saving — ' +
          'because every render unconditionally reset scrollTop to 0. ' +
          'The reset now fires ONLY when the visible filter actually ' +
          'changed (search input, faction switch, role chip, points ' +
          'filter); a re-render with the same filter preserves the ' +
          'user\'s scroll position. If the user was scrolled past the ' +
          'first batch of cards, the lazy-paginator now keeps appending ' +
          'batches until the rendered content is tall enough to land ' +
          'them where they were.',
      },
      {
        date: '2026-05-15', kind: 'change',
        title: 'Army list: attached-unit cards no longer truncate names to "NE…"',
        description:
          'After the attach-units feature shipped, nested bodyguard cards ' +
          'were cramming a drag handle, a 3-cell stats grid, a "+N attached" ' +
          'pill and the unit name into ~220 px of horizontal space — so ' +
          '"Necron Warriors" read as "NE…", "Technomancer" as "TECHNOMANC…", ' +
          'etc. Four tightenings reclaim the budget: (1) unit names now ' +
          'wrap to a second line when they don\'t fit on one (instead of ' +
          'truncating to a few letters); (2) the leader\'s "+N attached" ' +
          'pill moves to its own row below the title so the name gets the ' +
          'full header width; (3) the cosmetic drag-handle widget is ' +
          'hidden on attached cards (drag still works from anywhere on the ' +
          'card body, so no functional change); (4) the labelled Pts / Qty ' +
          '/ Total stats grid on attached cards collapses to a single ' +
          'compact inline row. Nested-attachment indent + tether line also ' +
          'tightened from 18 px / 2 px to 10 px / 1 px per level. Root ' +
          'cards without attachments look identical to before; the 2-line ' +
          'wrap rule applies everywhere so long-named root entries also ' +
          'stop truncating.',
      },
      {
        date: '2026-05-15', kind: 'feature',
        title: 'Army list: attach units to other units (Leader / Bodyguard / Necron multi-attach)',
        description:
          'You can now drag a unit card onto another in the army list to ' +
          'attach it — the dropped unit nests inside its host with a ' +
          'tether line and a small "+N attached" subtotal pill on the ' +
          'leader. The middle of an entry registers as an ATTACH drop ' +
          'zone; the top / bottom edges still trigger normal reorder. ' +
          'Multiple characters and non-character units (Necron Canoptek ' +
          'Cryptothralls, Tomb Sentinel, …) can all attach to a single ' +
          'bodyguard unit — drop them one by one. Drop targets light up ' +
          'green when the data (GDC `gdcLeadBy` first, BSData "can be ' +
          'attached to" prose as a backup) confirms the pairing, amber ' +
          'when neither source lists it — amber drops still succeed with ' +
          'a warning toast, so faction-data gaps can\'t prevent a legal ' +
          'attachment. Dragging a nested card out into the gap between ' +
          'root entries detaches it; reordering inside the parent works ' +
          'too. Points totals and Rule-of-3 still count each entry ' +
          'independently — the nesting is purely visual + reflects the ' +
          'in-game leader relationship. Share URLs and saved armies round-' +
          'trip the attachment graph; older saves render flat with no ' +
          'change in behaviour.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Updates modal: entries no longer show yesterday\'s date for non-UTC viewers',
        description:
          'A YYYY-MM-DD entry date was being parsed as UTC midnight then ' +
          'rendered in local time, so anyone west of UTC saw every entry ' +
          'one day earlier than the author wrote (e.g. a 2026-05-15 entry ' +
          'showing as "May 14, 2026"). Now built from y/m/d parts so the ' +
          'date the author wrote is the date the reader sees.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Parser sweep: characters get their wargear pickers + several silent omissions fixed',
        description:
          'A deep audit of how the parser walks BattleScribe XML turned ' +
          'up nine separate omissions that quietly cost users datasheet ' +
          'content. All fixes are in shared parser code, so every faction ' +
          'with the same XML shape benefits — Votann was the audit subject ' +
          'but Primaris characters, Eldar Phoenix Lords, Custodes Achillus ' +
          'dreadnoughts, and any future detachment with a diacritic in its ' +
          'name were vulnerable too. Specifically: (1) Needgaârd Oathband ' +
          'and any other diacritic-bearing detachment now picks up its ' +
          'enhancements (the BSData enhancement <comment> keys were ' +
          'spelled without the accent — exact-string match dropped them); ' +
          '(2) every character whose wargear sits under a "Wargear" wrapper ' +
          'with inner Crest / Melee / Ranged sub-groups now shows those ' +
          'pickers (Votann Kâhl, Einhyr Champion, Iron-master + analogues ' +
          'across factions); (3) default weapons one nesting level deep ' +
          '(Hearthkyn Theyn\'s bolter, every multi-slot leader model\'s ' +
          'pre-selected kit) are recognised; (4) multi-stance weapons like ' +
          'Buri Aegnirssen\'s "Bane" render as "Bane - strike" / "Bane - ' +
          'sweep" instead of two ugly "➤ Bane - strike" rows; (5) shared ' +
          '<infoGroup> elements (Votann detachment aura bundles) are now ' +
          'indexed; (6) conditional-hide modifiers on shared profiles are ' +
          'honoured, so Hekaton Land Fortress\'s "Firebase Control (Aura)" ' +
          'no longer leaks onto every Transport in non-Brandfast ' +
          'detachments; (7) cost-tier modifiers wrapped in <modifierGroups> ' +
          '(plus the increment-type tiers used by Crucible mode) now ' +
          'register; (8) parsed units carry a new primaryKeyword field for ' +
          'role-aware UI; (9) zero-enhancement detachments and surviving ' +
          '"➤" weapon glyphs are now flagged by the parse coverage probe ' +
          'so regressions show up in the developer console.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Reserves, requisitions, and favorites no longer wipe after sync',
        description:
          'A long-standing data-loss bug: when sync pulled a fresh bag ' +
          'from the cloud, the reserves / wishlist / favorites / collection ' +
          'modules kept a stale in-memory copy of their store. The next ' +
          'time you nudged a single unit, the module persisted that stale ' +
          'snapshot back to localStorage — wiping every entry the pull had ' +
          'just brought in — and then pushed the shrunken bag to cloud, ' +
          'overwriting the server copy too. Sync now fires a synthetic ' +
          '`storage` event for every key it pulls so the existing per-' +
          'module storage listeners re-hydrate in the same tab; the ' +
          'favorites and points-override modules also gained the listener ' +
          'they were missing.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Parser: wargear-granted abilities now surface on the unit',
        description:
          'Units whose abilities are granted via wargear (Big Mek in ' +
          'Mega Armour\'s Grot Oiler, etc.) were missing those abilities ' +
          'from their datasheet. The parser walked the unit\'s top-level ' +
          'wargear group but stopped before its nested sub-groups, so ' +
          'every ability-bearing wargear option one level deeper got ' +
          'skipped. walkSelectionEntryGroup now recurses, and the IDB ' +
          'cache version was bumped (32) so the fix takes effect on ' +
          'next reload.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Detachment dropdown stays populated after tab refocus',
        description:
          'Tabbing away and back could leave the detachment dropdown ' +
          'empty until you flipped the faction selector — the ' +
          'visibility-change cloud pull was firing a re-render before ' +
          'state.factions was fully hydrated, and updateDetachmentOptions ' +
          'cleared the list down to the "Select faction first" placeholder. ' +
          'The function now leaves an already-populated list alone while ' +
          'factions are still warming up, and sync.pullAll re-applies the ' +
          'current army\'s faction / chapter / detachment to the dropdowns ' +
          'once the pull completes.',
      },
      {
        date: '2026-05-15', kind: 'feature',
        title: 'Bug report: 50 MB image / video uploads + bug vs feature toggle',
        description:
          'The Report icon in the topbar now opens a "Send feedback" ' +
          'modal with a Type dropdown (Bug report or Feature request) ' +
          'and a file picker that accepts a single image or video up ' +
          'to 50 MB. The modal\'s title, prompts, and submit button ' +
          'wording all adapt to the chosen type. Attachment-bearing ' +
          'submissions send as multipart/form-data; the attachment-free ' +
          'path still posts plain JSON so it keeps working with the ' +
          'pre-update server.',
      },
      {
        date: '2026-05-15', kind: 'feature',
        title: 'Cards mode: save and recall named presets',
        description:
          'A new Presets section at the top of the Layout sub-tab lets ' +
          'you save the current colours, typography, layout, spillover ' +
          'settings, and back-image selection under a name (e.g. ' +
          '“steve orks”). Pick a preset from the dropdown to snap every ' +
          'setting back the next time you print a second batch for the ' +
          'same customer. Save as new, update the active preset, ' +
          'rename, and delete are all available. Presets sync across ' +
          'your devices when you’re signed in.',
      },
      {
        date: '2026-05-15', kind: 'fix',
        title: 'Cards mode: preview no longer blanks after tab-switching back',
        description:
          'Tabbing away from the browser and coming back made the card ' +
          'preview show "Nothing selected yet" until you flipped to ' +
          'another mode and back. The visibilitychange-triggered cloud ' +
          'sync was firing an armyChange that reset the picker’s ' +
          'include sets to null without re-defaulting them. The handler ' +
          'now re-runs syncIncludeDefaults() before redrawing, so the ' +
          'preview stays populated.',
      },
      {
        date: '2026-05-15', kind: 'change',
        title: 'Cards mode: subtitle baseline baked at 130%',
        description:
          'The Subtitles slider now treats 130% as the new 100%. The ' +
          'CSS base for the subtitle line was scaled up to match, and ' +
          'saved prefs are auto-migrated on load (prefsVersion stepped ' +
          '2 → 3) — a user whose slider was at 130% lands at 100%, ' +
          'custom tunes above or below stay as a relative offset.',
      },
      {
        date: '2026-05-15', kind: 'change',
        title: 'Cards mode: stratagem subtitle bolded',
        description:
          'The stratagem-card subtitle (CORE / FACTION / DETACHMENT ' +
          'STRATAGEM + PHASE: <name>) now renders at weight 700 so it ' +
          'reads cleanly against the bronze CP pill. Rule and unit ' +
          'subtitles are unchanged.',
      },
      {
        date: '2026-05-15', kind: 'change',
        title: 'Cards mode: new 100% baseline for typography + softer default corners + subtitle slider',
        description:
          'The print-tuned typography sizes that used to require pushing ' +
          'each slider to 120–150% are now baked into the CSS bases, so ' +
          '100% on every slider is the new readable-by-default size. ' +
          'Sliders all default to 100%; the "Reset typography" button ' +
          'snaps back there too. Saved prefs are auto-migrated on load — ' +
          'your old 120 / 150 / 130 / 120 / 130 / 120 set lands at exactly ' +
          '100% across the board (the new baseline), and any custom ' +
          'tuning above or below those values is preserved as relative ' +
          'offset from the new baseline. The Typography panel also gains ' +
          'a new "Subtitles" slider that scales the subtitle line (ARMY ' +
          'RULE, DETACHMENT RULE, CORE / FACTION / DETACHMENT STRATAGEM, ' +
          'PHASE: <name>, unit role / type) independently of body and ' +
          'section-head sizes. Corner-rounding defaults are also softer ' +
          '(3mm card frame, 2mm header / stat-pills / section-heads) for ' +
          'a more consistent look across the inner chrome.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'Dark Angels: Wrath of the Rock (and other chapter-exclusive detachments) show their stratagems',
        description:
          'Wrath of the Rock had no stratagems in the army-rules pinboard or ' +
          'the stratagem browser. BSData defines the detachment inside the ' +
          'parent Space Marines catalogue (gated to the Dark Angels chapter), ' +
          'while the GDC ships its stratagems under the Dark Angels file — ' +
          'the merge step only matched each faction’s stratagems against ' +
          'its own detachment list, so DA’s stratagems tried to attach to ' +
          'an empty list and SM’s "Wrath of the Rock" detachment got ' +
          'nothing. The merge now also indexes the chapter’s parent ' +
          'detachments, so chapter-exclusive detachments (Wrath of the Rock, ' +
          'Inner Circle Task Force, Lion’s Blade Task Force, Unforgiven ' +
          'Task Force, Company of Hunters, and any equivalent on other ' +
          'chapters) get their stratagems attached correctly.',
      },
      {
        date: '2026-05-14', kind: 'feature',
        title: 'Cards mode: army-rule spillover + optional mid-section splitting',
        description:
          'Long army-rule and detachment-rule cards can now overflow ' +
          'onto the back of the card the same way unit cards do. Because ' +
          'rule cards have a single body section, this is gated behind a ' +
          'new "Split sections mid-content" checkbox under Spillover ' +
          'handling — turn it on and the rule text splits paragraph-by-' +
          'paragraph between primary and continuation. The same toggle ' +
          'also lets dense unit sections (long ability lists, deep ' +
          'weapon tables) break across primary and continuation instead ' +
          'of moving the whole section to the back, so primary cards ' +
          'fill up before anything spills.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'World Eaters: Jakhals show the right squad sizes (10 / 20)',
        description:
          'Jakhals were offering "9 models — 65 pts" and "19 models — ' +
          '140 pts" in the size dropdown instead of the correct 10 / 20. ' +
          'Two parser gaps were stacking: large composition picks (e.g. ' +
          '"2 mauler chainblades, 15 chainblades") encode the mauler ' +
          'count as an inner model entry that the composition walker ' +
          'wasn\'t summing, AND the Dishonoured sub-group\'s max is ' +
          'conditionally bumped from 1 to 2 by a set-modifier that the ' +
          'count walker ignored. Both are handled now.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'T’au: Mont’ka detachment now shows its stratagems',
        description:
          'The Mont’ka detachment’s stratagem list was empty in the ' +
          'rules pinboard. The stratagem source uses a curly apostrophe ' +
          '(Mont’ka) while the BattleScribe detachment name uses a ' +
          'straight apostrophe (Mont\'ka), so the two never matched. ' +
          'Detachment matching now folds curly→straight apostrophes and ' +
          'ignores punctuation/spacing, so any apostrophe-bearing ' +
          'detachment (Kau’yon, etc.) gets its stratagems too.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'Rule detail: "ARMY RULE" / "DETACHMENT RULE" subtitle bumped to a readable size',
        description:
          'The all-caps subtitle under an army-rule, detachment-rule, ' +
          'enhancement, or stratagem name was rendering at 10px — small ' +
          'enough to feel like a stray label rather than the rule kind. ' +
          'Bumped to 13px (matching the rest of the detail meta row) and ' +
          'gave the · phase suffix the same treatment so stratagem ' +
          'phase tags read clearly too.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'Cards mode: continuation spillover now rides on the card’s back',
        description:
          'When a unit’s text overflowed and you had spillover set to ' +
          '"Continuation card", the printout produced a primary front, a ' +
          'decorative back, then the continuation as a separate card with ' +
          'its own decorative back — two backs in a row, breaking the ' +
          'evens/odds duplex workflow. The continuation now replaces the ' +
          'decorative back of its own primary, so each card has its ' +
          'overflow on its own reverse side. A back page is now also ' +
          'generated for pages that have continuations even when card ' +
          'backs are turned off. "Full card" spillover keeps the old ' +
          'behaviour (separate front card with its own back).',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'Imperial Knights Armigers: composition now shows "1 model"',
        description:
          'Armiger Warglaives, Helverins, and Moirax were showing "3 ' +
          'models" in their composition line — that came from the ' +
          'force-wide rule-of-three cap on the entry rather than a ' +
          'real model count. Single-model unit entries with a ' +
          'force-scope selection cap now correctly fall back to "1 ' +
          'model" instead of inheriting the cap.',
      },
      {
        date: '2026-05-14', kind: 'fix',
        title: 'Knight Castellan: stray "Anti-" tag removed from abilities',
        description:
          'The Knight Castellan was showing a bare "Anti-" entry in ' +
          'its core abilities row, picked up from the shieldbreaker ' +
          'missile launcher\'s weapon keyword family. The abilities ' +
          'filter now recognises that the universal "Anti-" rule ' +
          'belongs to whichever Anti-X weapon keyword the unit carries, ' +
          'and keeps it off the core-abilities chip line.',
      },
      // ── 2026-05-09 ──────────────────────────────────────────────────────
      {
        date: '2026-05-09', kind: 'fix',
        title: 'Detachments: chapters only show the ones they can actually take',
        description:
          'The detachment dropdown used to list every Space Marine ' +
          'detachment for every chapter (Inner Circle Task Force on a ' +
          'Blood Angels army, Champions of Fenris on Ultramarines, …). ' +
          'It now reads the chapter restrictions straight out of the ' +
          'BattleScribe data, so each chapter sees only its own ' +
          'detachments plus the generic Codex: Space Marines ones — and ' +
          'Black Templars correctly lose Librarius Conclave / 1st ' +
          'Company Task Force, etc.',
      },
      {
        date: '2026-05-09', kind: 'feature',
        title: 'Search box: click the × to clear it',
        description:
          'The unit-search box now shows a small × on the right when ' +
          'it has text in it — click it to clear the search without ' +
          'reaching for the keyboard.',
      },
      {
        date: '2026-05-09', kind: 'fix',
        title: 'Layout: panels now fill the screen even when the Units pane is empty',
        description:
          'The three panels (Army / Units / Details) were collapsing to ' +
          'the height of whichever had the most content, leaving a big ' +
          'dark band below — most obvious with an empty Reserves view. ' +
          'Root cause: the build-mode wrapper is a 2-row grid sized for ' +
          'a hero row that now lives in the top bar, so the panel grid ' +
          'was auto-placed into the "shrink-to-content" row. Pinned it ' +
          'to the full-height row so the panels always reach the bottom ' +
          'of the window.',
      },
      {
        date: '2026-05-09', kind: 'change',
        title: 'Units pane is now sorted by faction, then A→Z',
        description:
          'The unit roster used to render in BattleScribe file order. ' +
          'It\'s now grouped by faction and sorted alphabetically by ' +
          'unit name within each faction — handy in the "All units" / ' +
          '"All Factions" view, and consistent everywhere else.',
      },
      {
        date: '2026-05-09', kind: 'feature',
        title: 'Reserves: points total for your collection',
        description:
          'The Units pane header now shows an "≈ N pts" badge next to ' +
          'the unit count whenever the Reserves (or Requisitions) view ' +
          'is active — the summed points value of every owned (or ' +
          'wished-for) unit that matches the army/faction you currently ' +
          'have selected. It uses each unit\'s base cost, so variable-' +
          'size units could field for a bit more; hover the badge for ' +
          'the breakdown.',
      },
      {
        date: '2026-05-09', kind: 'change',
        title: 'Detachment dropdown is now sorted alphabetically',
        description:
          'The detachment picker in the Army setup panel used to list ' +
          'detachments in BattleScribe file order; it\'s now sorted ' +
          'A→Z so the one you want is easier to find.',
      },
      {
        date: '2026-05-09', kind: 'change',
        title: 'Cards: requisitions count moved to bottom-right',
        description:
          'The "×N" Requisitions badge on unit cards now sits in the ' +
          'bottom-right corner instead of the bottom-left, mirroring the ' +
          'Reserves badge in the top-right.',
      },
      {
        date: '2026-05-09', kind: 'fix',
        title: 'Units pane: empty Reserves no longer looks like a broken page',
        description:
          'When the Reserves (or Requisitions) view had nothing in it, ' +
          'the Units panel showed a thin "empty" banner at the top and ' +
          'a big dark void below — which read as the page failing to ' +
          'finish loading. The panel body is now a flex column so the ' +
          'empty-state message fills the available height and is ' +
          'centred, making it clearly a deliberate "nothing here yet" ' +
          'state. Scrolling a populated roster is unaffected.',
      },
      {
        date: '2026-05-09', kind: 'fix',
        title: 'Performance: smoother roster scrolling',
        description:
          'Reserves had two MutationObservers that were over-firing ' +
          'on roster scroll: the unit-pane toggle observer was ' +
          'rescanning on every card append (200+ times for a 200-unit ' +
          'faction), and the per-card badge decorator was iterating ' +
          'every card on every batch. The first is gone (we re-mount ' +
          'the toggle from explicit hooks instead), and the second now ' +
          'only decorates the newly-added cards. The page should feel ' +
          'snappier when scrolling long faction rosters.',
      },
      {
        date: '2026-05-09', kind: 'change',
        title: 'Cards: dropped the painting-status dot',
        description:
          'The little coloured dot in the top-right corner that ' +
          'indicated painting status (unpainted / primed / WIP / done) ' +
          'is gone. The Reserves "×N" badge in the same corner already ' +
          'covers the ownership signal that matters while building, ' +
          'and the painting status is still visible in the detail-pane ' +
          'widget and Collect-mode dashboard.',
      },
      {
        date: '2026-05-09', kind: 'fix',
        title: 'Reserves: count badge on cards, no more duplicates',
        description:
          'Cards now show a small "×N" badge in the top-left when a unit ' +
          'is in your Reserves (and a matching pink badge in the bottom-' +
          'left for Requisitions), so quantity is visible at a glance. ' +
          'Also fixed a duplicate-cards issue: BattleScribe ships some ' +
          'units (generic Marine Captain, generic Lieutenant, etc.) as ' +
          'shared entries reused across every chapter catalogue, which ' +
          'meant the Reserves view was rendering one card per faction ' +
          'that shared the same id. The Reserves and Requisitions views ' +
          'now collapse those duplicates so you see one card per unit.',
      },
      {
        date: '2026-05-09', kind: 'change',
        title: 'Reserves & Requisitions: controls moved to the Details pane',
        description:
          'The +/− steppers for owned-quantity (Reserves) and wishlist-' +
          'quantity (Requisitions) used to overlay each unit card in ' +
          'the Units pane. They now live in a single "Your stockpile" ' +
          'widget inside the Details pane — click any unit card and ' +
          'you\'ll see two rows (Reserves / Requisitions) with their ' +
          'own steppers, right under the "Add to Army" row. The Units ' +
          'pane is back to clean unit cards; the Reserves / ' +
          'Requisitions / All toggle still controls what the pane ' +
          'shows.',
      },
      {
        date: '2026-05-09', kind: 'feature',
        title: 'Mobile: back button now navigates inside the app',
        description:
          'On phones, hitting the device back button while you\'re on ' +
          'the Details panel now slides you back to the Units list ' +
          'instead of leaving the site. Tapping More opens the menu ' +
          'as a back-trappable sheet too — one back press closes it. ' +
          'Desktop is unaffected.',
      },
      {
        date: '2026-05-09', kind: 'feature',
        title: 'Reserves: build from the units you actually own',
        description:
          'The Units pane now opens on a new "Reserves" view that lists ' +
          'only the units you own, with a +/− stepper on each card to ' +
          'set how many of each you have. Switch to "All units" to ' +
          'browse the full faction roster and tap + on any card to add ' +
          'it to your Reserves. Quantities sync across devices when ' +
          'you\'re signed in. The army list also shows a soft warning ' +
          'badge ("⚠ owns N") if you build with more copies of a unit ' +
          'than you actually own — never blocks adding, just keeps you ' +
          'honest.',
      },
      {
        date: '2026-05-09', kind: 'feature',
        title: 'Requisition Requests: a per-unit wishlist',
        description:
          'A third "Requisitions" tab in the Units pane tracks the ' +
          'units you want to acquire (or paint) next. Each card gets ' +
          'a small heart-stepper so you can wish for one or many ' +
          'copies; the Requisitions view filters the roster down to ' +
          'just your wishlist. Owned and wished-for stockpiles are ' +
          'tracked separately, both sync to the cloud, and a unit can ' +
          'be in both at once.',
      },
      // ── 2026-05-07 ──────────────────────────────────────────────────────
      {
        date: '2026-05-07', kind: 'change',
        title: 'Details pane (expanded): cleaner full-screen layout',
        description:
          'Expanding the Details pane used to leave a lot of dead ' +
          'space — the stats strip sat alone in the left column while ' +
          'the weapons table claimed the right. Now the banner, the ' +
          '"Add to Army" toolbar, and the M/T/SV/W/LD/OC stats span ' +
          'the full width across the top with bigger numbers and a ' +
          'slimmer add-to-army button, and the remaining sections ' +
          '(weapons, abilities, leader, loadout, enhancements) flow ' +
          'into a 2- or 3-column grid below depending on monitor ' +
          'size. The weapons section spans 2 columns on very wide ' +
          'screens so its wide table breathes.',
      },
      {
        date: '2026-05-07', kind: 'feature',
        title: 'Army pane (expanded): card grid + auto-open rules',
        description:
          'Expanding the Army pane now lays the entries out as a card ' +
          'grid (similar to the Units pane) so most or all of your ' +
          'army is visible on one screen, and the "Army rules & ' +
          'stratagems" collapsible auto-opens so the relevant rules ' +
          'sit alongside the list. Click the header again to collapse ' +
          'back to the regular 3-pane view.',
      },
      {
        date: '2026-05-07', kind: 'change',
        title: 'Updates pane: hint about hard-refresh',
        description:
          'The "What\'s new" modal now shows a small banner at the ' +
          'top reminding you that browsers can hold on to a stale ' +
          'cached build. If a new feature doesn\'t show up yet, hit ' +
          'Ctrl+Shift+R (⌘⇧R on Mac) to force a hard refresh.',
      },
      {
        date: '2026-05-07', kind: 'fix',
        title: 'Unit cards: points now sit under the unit name',
        description:
          'Long point values (e.g. multi-model squad totals like ' +
          '"70 / 150 pts") used to push the unit name onto a second ' +
          'line and squash everything into a narrow column. Cards now ' +
          'put the points on a row of their own under the name, so ' +
          'the name has the full width to itself. The minimum card ' +
          'width has also been bumped up to keep cards readable.',
      },
      {
        date: '2026-05-07', kind: 'fix',
        title: 'Drag-to-resize panes is snappy again',
        description:
          'Dragging the column edges to resize the Army or Details ' +
          'panes felt sluggish after the new expand-pane animation ' +
          'shipped — every pixel of drag was being treated as an ' +
          'animated transition. The transition is now suppressed ' +
          'while you\'re dragging, so resize tracks the cursor ' +
          'instantly while the expand/collapse animation still plays ' +
          'when you click a header.',
      },
      {
        date: '2026-05-07', kind: 'change',
        title: 'Expanded panes now use the full screen',
        description:
          'When you expand the Army, Units, or Details pane (by ' +
          'clicking its header), the layout now fills the entire ' +
          'window instead of capping at ~1700px in the middle. The ' +
          'Units search bar and filter chips sit on a single inline ' +
          'band across the top, the unit grid widens to as many ' +
          'columns as fit, and the Army / Details panes likewise use ' +
          'the full width.',
      },
      {
        date: '2026-05-07', kind: 'feature',
        title: 'Click any pane header to expand it full-width',
        description:
          'Click the Army, Units, or Details title (or the new expand ' +
          'icon next to it) to grow that pane across the entire 3-pane ' +
          'area, with a smooth slide animation. Each pane gets a ' +
          'dedicated full-screen layout: the Army pane splits into ' +
          'setup + rules on the left and the entry list on the right; ' +
          'the Units grid widens to show more cards at once; the ' +
          'Details pane uses two columns so stats/abilities sit ' +
          'alongside weapons/wargear. Click the header again or press ' +
          'Escape to return to the 3-pane view.',
      },
      {
        date: '2026-05-07', kind: 'feature',
        title: 'Filter chips: click twice to exclude',
        description:
          'The role chips above the unit list (Battleline, Character, ' +
          'Infantry, Vehicle, Monster, Psyker) now have three states. ' +
          'First click turns the chip green and only shows units with ' +
          'that keyword. A second click turns it red and hides every ' +
          'unit with that keyword instead — handy for browsing only ' +
          'non-Characters or only non-Vehicles. A third click clears ' +
          'the chip.',
      },
      // ── 2026-05-06 ──────────────────────────────────────────────────────
      {
        date: '2026-05-06', kind: 'change',
        title: 'Faster faction loading: BSData now served from our own server',
        description:
          'Faction data used to be downloaded straight from GitHub on every ' +
          'visit, which was slow on flaky networks and could fail when too ' +
          'many users hit GitHub\'s public rate limit at once. We now mirror ' +
          'the BattleScribe XML on our own server and refresh it every 6 ' +
          'hours, so first-load is quicker and no longer affected by GitHub ' +
          'rate limits. If our mirror is ever unavailable the app still ' +
          'falls back to GitHub automatically.',
      },
      {
        date: '2026-05-06', kind: 'fix',
        title: 'Ghazghkull Thraka: Leader (attached units) restored',
        description:
          'Ghazghkull was missing his Leader entry — the list of units ' +
          'he can attach to (Boyz, Meganobz, Nobz). BSData wraps that ' +
          'block in a <infoGroup> element that the parser used to ' +
          'ignore entirely. Other Ork characters (Warboss, Big Mek, ' +
          'Beastboss, Painboy, Mad Dok, Mozrog) and a handful of T\'au ' +
          'units (bounty/pilot blocks) were missing the same ability ' +
          'profile or rule infoLinks for the same reason; they\'re all ' +
          'fixed.',
      },
      {
        date: '2026-05-06', kind: 'fix',
        title: 'Templar Vows no longer shows on non-Templar chapters',
        description:
          'BSData\'s parent Space Marines file hardcodes a Templar Vows ' +
          'rule infoLink on every Astartes unit with no conditional-hide ' +
          'modifier (110 references in total), so every chapter\'s Land ' +
          'Raider / Predator / Intercessor was inheriting it. The parser ' +
          'now recognises chapter-locked rules and only surfaces them ' +
          'when the parsed faction is the matching chapter. Black ' +
          'Templars armies still see Templar Vows; everyone else sees ' +
          'just Oath of Moment.',
      },
      {
        date: '2026-05-06', kind: 'fix',
        title: 'Vehicles: stop weapon-keyword bleed into core abilities',
        description:
          'Every Marine vehicle had Precise, Precision, and Lethal Hits ' +
          'showing up as core abilities (visible on Land Raider, Predator, ' +
          'Repulsor, Impulsor, etc.). The parser was descending into the ' +
          'Crusade-only "Weapon Modifications" upgrade hook on each ' +
          'wargear weapon and pulling the modification rules in as if ' +
          'they were unit abilities. The walker now skips that hook. ' +
          'Same fix also stops per-detachment "X Enhancements" groups ' +
          '(Headhunter Task Force) from leaking enhancements onto every ' +
          'unit; the affected detachments still extract their own ' +
          'enhancement lists correctly.',
      },
      {
        date: '2026-05-06', kind: 'change',
        title: 'Vehicles: dedicated Transport section',
        description:
          'Transport capacity now renders in its own "Transport" block ' +
          'on every unit card instead of being mixed in with regular ' +
          'abilities (Marines: Land Raider, Repulsor, Impulsor, Rhino) ' +
          'or accidentally landing in the gold "primarch" sub-ability ' +
          'box (Orks: Trukk, Battlewagon, Stompa, Gorkanaut and friends).',
      },
      {
        date: '2026-05-06', kind: 'fix',
        title: 'Vehicles: drop "Damaged: X Wounds Remaining" filler',
        description:
          'Land Raider, Repulsor, Tau Hammerhead and other 10e vehicles ' +
          'shipped with vestigial "Damaged: 1-X Wounds Remaining" ability ' +
          'profiles in the BSData files even though 10e dropped degrading ' +
          'statlines. Those entries are no longer surfaced — Land Raider ' +
          'now shows Assault Ramp as its only proper ability.',
      },
      // ── 2026-05-05 ──────────────────────────────────────────────────────
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Orks: vehicle transport capacities now surface',
        description:
          'Battlewagon, Trukk, Stompa, Gorkanaut, Morkanaut, Kill Rig, ' +
          'Hunta Rig, Big\'ed Bossbunka, and the various Legends ' +
          'transports all carry their capacity rules in a typeName=' +
          '"Transport" profile that the parser was silently dropping ' +
          '(neither "Description" nor "Effect" matched its lone ' +
          '"Capacity" characteristic). The capacity text now shows on ' +
          'the unit card.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Orks: Dread Mob "Try Dat Button!" D6 table now surfaces',
        description:
          'The Dread Mob detachment encodes its weapon-buff D6 roll ' +
          'table as <profile> siblings of the detachment rule rather ' +
          'than inside the rule prose. The parser now appends those ' +
          'sub-profiles to the matching rule, so the 1-2 / 3-4 / 5-6 ' +
          'rows show under Try Dat Button!. Future faction roll-table ' +
          'detachments encoded the same way will pick this up too.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Cross-catalogue abilities now surface',
        description:
          'Many leader abilities defined in a parent catalogue and ' +
          'referenced from a sub-faction were silently dropped — the most ' +
          'visible example is the Space Wolves Wolf Priest, which was ' +
          'missing Litany of Hate (defined in the Space Marines parent file ' +
          'and linked into every chapter). Same shape affected Blood ' +
          'Angels, Dark Angels, Black Templars, Deathwatch, Salamanders, ' +
          'Grey Knights, and Ultramarines. The parser now preloads every ' +
          'catalogue\'s shared profiles before parsing, so chapter-level ' +
          'infoLinks resolve correctly.',
      },
      {
        date: '2026-05-05', kind: 'change',
        title: 'Unit detail panel: tighter header',
        description:
          'Removed the collection-status box and favorites star from the ' +
          'unit detail pane (collection status lives in Collect mode, ' +
          'favorites still toggle from the faction-row star). The Google ' +
          'image-search button now sits inline with the points readout.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Topbar buttons match the rest of the bar',
        description:
          'The new Updates and Report buttons now use the same chrome ' +
          '(border, hover, glyph + uppercase label) as Settings, Help, ' +
          'and Account.',
      },
      {
        date: '2026-05-05', kind: 'feature',
        title: '"What\'s new" button in the topbar',
        description:
          'New ✦ icon next to the account button opens a versioned, dated ' +
          'list of recent changes (this list). A red dot appears on the icon ' +
          'while you have unseen entries.',
      },
      {
        date: '2026-05-05', kind: 'feature',
        title: 'Bug report button (signed-in users)',
        description:
          'New "!" icon in the topbar opens a bug-report form (summary + ' +
          'description + auto-attached diagnostics) that posts directly to ' +
          'the site instead of opening a GitHub URL. Sign-in required.',
      },
      {
        date: '2026-05-05', kind: 'feature',
        title: 'Admin: Reports tab + pending-approval banner',
        description:
          'Site operators see submitted bug reports in a new admin tab with ' +
          'Open / Fixed / All filters and per-report mark-fixed / reopen / ' +
          'delete actions. A top-of-page banner also pings admins when ' +
          'someone is waiting for account approval.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Multi-statline units now show every statline',
        description:
          'Marneus Calgar surfaced with Victrix Honour Guard\'s stats (T4 W3) ' +
          'instead of his own (T6 W6); Wardens of Ultramar lost its ' +
          'Sergeant-vs-private split; Terminator Assault Squad collapsed TH/SS ' +
          '(W4) and Lightning Claw (W3) into one row. The unit detail panel ' +
          'now renders one stat row per distinct profile.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Cards mode: section titles match the rest of the card',
        description: 'Section title and column abbreviation font sizes now scale together with the base font.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Sync: stop a runaway pull loop',
        description: 'When a server and client clock drifted apart, pullAll could re-fetch the same payload forever. It now stops once the timestamps converge.',
      },
      {
        date: '2026-05-05', kind: 'feature',
        title: 'Cards mode: separate font sliders for section heads and fine print',
        description: 'New typography sliders, raised the cap to 200%, retuned defaults so most printers get a usable layout out of the box.',
      },
      {
        date: '2026-05-05', kind: 'feature',
        title: 'Cards mode: 5-in-1 polish pass',
        description: 'Dedicated Rapid Fire layout, footer pinning, spillover-mode controls, separate typography and corner-radius sliders.',
      },
      {
        date: '2026-05-05', kind: 'fix',
        title: 'Mobile: sticky points pill no longer reads "0 / limit"',
        description: 'On phones the points readout could stay stuck at 0 even after adding units; it now updates live.',
      },

      // ── 2026-05-04 ──────────────────────────────────────────────────────
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: full-page printing layout',
        description:
          'Cards is now a full top-level mode (next to Build / Collect / Play) ' +
          'with native browser printing instead of a PDF export. Page borders ' +
          'support borderless printers, and backgrounds are forced on so ' +
          'textures and gradients survive the print dialog.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Data card creator',
        description:
          'Make printable cards for any unit, rule, or stratagem with a ' +
          'PDF export. The Display tab and wargear-options block are both ' +
          'wired up; blank-export bug fixed.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: card backs for duplex printing',
        description:
          'Upload an image, scale and position it, and use it as the back ' +
          'of every card. Per-account image library (cap 30 images) syncs ' +
          'across your devices, plus 16 built-in textures and an intensity ' +
          'slider so backs match your faction\'s look.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: dedicated Primarch section',
        description: 'Choose-from-N hero abilities (Guilliman, Lion, Angron, Silent King) get their own card section instead of bleeding into the regular Abilities block.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: per-category layout overrides + grimdark visual pass',
        description: 'Each card category (units, rules, stratagems) can now have its own layout overrides. Visuals refreshed across the board.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: SV+INV merge, account-synced prefs',
        description: 'Save tray now merges Armour Save and Invulnerable Save, R4 corner radius, font multipliers, and your card preferences sync with your account.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: structured ability/rule/stratagem text',
        description: 'Multi-paragraph ability and stratagem prose now formats as proper bulleted lists rather than running together.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Cards mode: section-aware spillover',
        description: 'Long unit cards now spill the overflow into a continuation card that respects which section was running over.',
      },
      {
        date: '2026-05-04', kind: 'feature',
        title: 'Account approval gating + admin panel',
        description:
          'New accounts now wait for admin approval before they can sign in. ' +
          'Site operator gets an Admin entry in the account menu with tabs for ' +
          'pending approvals, approved users, and uploaded card-back images.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Cards mode: prefs no longer vanish on reload',
        description: 'A pinned suppress-save flag was eating the first save after load.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Cards mode: texture swatches show their texture again',
        description: 'Inline-style HTML escaping was stripping the actual swatch image, leaving only labels.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Cards mode: blank print output fixed',
        description: 'Some browsers were producing entirely blank print previews; the print stylesheet now hands them a usable layout.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Cards mode: ×N count badge dropped from card titles',
        description: 'Unit-card titles no longer show the squad-count badge — that information lives in the squad summary.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Cards mode: preview no longer squashes on multi-page lists',
        description: 'Frame heights stay constant when the preview spans more than one printed page.',
      },
      {
        date: '2026-05-04', kind: 'fix',
        title: 'Hero abilities: more sub-abilities surface on cards',
        description:
          'Guilliman\'s "Author of the Codex" choose-from-N abilities, ' +
          'plus equivalents for Angron, Silent King, Lion El\'Jonson, and ' +
          'Magnus, now split into selectable sub-options instead of one ' +
          'wall of text. Several other abilities encoded with an "Effect" ' +
          'characteristic instead of "Description" also surface for the ' +
          'first time.',
      },

      // ── 2026-05-01 ──────────────────────────────────────────────────────
      {
        date: '2026-05-01', kind: 'change',
        title: 'Army Rules box expands to its full natural height',
        description: 'No more inner scrollbar inside the open Army Rules section — the panel itself grows to fit.',
      },

      // ── 2026-04-30 ──────────────────────────────────────────────────────
      {
        date: '2026-04-30', kind: 'fix',
        title: 'Load Army now sees fresh cloud data',
        description: 'Opening Load Army now pulls the latest from your account first, so you don\'t miss an army you saved on another device.',
      },
      {
        date: '2026-04-30', kind: 'fix',
        title: 'Sync: bodyless requests no longer break on strict middleware',
        description: 'GETs and DELETEs no longer carry a Content-Type: application/json header.',
      },
      {
        date: '2026-04-30', kind: 'fix',
        title: 'Mobile: Build mode fills the full panel height',
        description: 'A leftover grid layout was capping the build panel; the unit list now uses all available vertical space on phones.',
      },
    ],
  };
})();
