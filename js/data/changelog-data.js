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
    version:     '2026.05.06-2',
    lastUpdated: '2026-05-06T01:00:00Z',
    entries: [
      // ── 2026-05-06 ──────────────────────────────────────────────────────
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
