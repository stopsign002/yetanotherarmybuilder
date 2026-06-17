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
    version:     '2026.06.17-5',
    lastUpdated: '2026-06-17T00:00:00Z',
    entries: [
      // ── 2026-06-17 ──────────────────────────────────────────────────────
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
