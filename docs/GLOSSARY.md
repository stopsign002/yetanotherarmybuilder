# Glossary — click any core ability or weapon ability to read what it does

Owner, 2026-10-25: "I want all instances of ability keywords and weapon
skills to be clickable and bring up a description of what it is. For example,
stealth being listed in a detachment enhancement. Right now I have to go
somewhere else to look up what stealth means."

Facts: the bundled ability-text store `window.DC.abilityText` holds every
core rule under its plain id with `faction: "core"` — `stealth`,
`deep-strike`, `lone-operative`, `feel-no-pain`, `fights-first`, `scouts`,
`leader`, `infiltrators`, `deadly-demise`, `firing-deck`, `hover`,
`lethal-hits`, `sustained-hits`, `devastating-wounds`, `twin-linked`,
`torrent`, `pistol`, `heavy`, `assault`, `rapid-fire`, `melta`, `lance`,
`precision`, `extra-attacks`, `ignores-cover`, `indirect-fire`, `one-shot`,
`blast`, `hazardous`, `psychic`, `close-quarters`, `cleave`, `anti`,
`benefit-of-cover`, `crushing-impact`, `epic-challenge`, `smokescreen`,
`rapid-ingress`, `heroic-intervention`, `insane-bravery`, `fire-overwatch`,
`command-re-roll`, `counter-offensive`, `super-heavy-walker`, `support`, plus
parameterised variants (`feel-no-pain-5-plus`, `scouts-6`, `deadly-demise-d6`,
`firing-deck-11` …). Entry shape `{faction, raw_text}` or `{effect, …}`;
`js/data/dc-adapter.js` `textFor(id)` = `raw_text || effect`, and
`weaponKwText(kid)` (~1137) shows the rating-strip fallback and the
synthesised ANTI-X text. Display names: `DC.abilities` entries carry `name`
("Lethal Hits", "Feel No Pain", "Close-quarters"); for a store id with no
abilities entry, title-case the id (`benefit-of-cover` → "Benefit of Cover",
small words lower-cased). Prose mentions come both bolded (`**Stealth**`,
rendered by `UI.mdBold` as `<strong>Stealth</strong>`) and plain ("gains the
Stealth ability"). Weapon keyword chips are `<span class="weapon-kw-tag
has-tooltip" data-tooltip="…">` (detail.js ~451); unit core abilities are
`<span class="core-ability-tag" data-tooltip="…">` (detail.js ~531); both
only ever show on hover, which phones never get.

## Files

New `js/ui/glossary.js` and `css/glossary.css`; `index.html` (one `<link>`
next to the other css links, one `<script defer>` placed right AFTER
`js/ui/helpers.js`'s tag and BEFORE `js/ui/detail.js`); `js/ui/detail.js`
(ONLY the two tag builders at ~451 and ~531: render them as
`<button type="button" class="weapon-kw-tag …">` / `<button type="button"
class="core-ability-tag">` so they are keyboard-reachable, keep the existing
classes and `data-tooltip`, add `data-glossary="<id>"` when known); `js/ui/
helpers.js` (ONLY the comment above `UI.mdBold` noting the glossary wraps
it); `docs/MODULE-REFERENCE.md`; `CLAUDE.md` features table (one Polish row).
Nothing else; no changelog; no commit; no git stash/checkout.

## Contract

1. **Index.** On first use (lazy; `DC` is global at load, the store is
   synchronous), build `terms`: every `DC.abilityText` id whose entry has
   `faction === 'core'`, collapsed to its base id (strip trailing
   `-\d+`, `-\d+-plus`, `-d\d+(-\d+|-plus-\d+)?`, and the
   `-szarekh-model-only` style suffixes: keep the shortest id that still
   resolves), with `name` from `DC.abilities` when present else title-cased,
   and `text` = `raw_text || effect` of the base entry. `anti` gets the
   synthesised core text from `weaponKwText` (copy the three lines) with
   "<KEYWORD>" and "N+" placeholders. Expose `UI.glossary.lookup(nameOrId)`
   → `{id, name, text}` or null: exact id, exact name (case-insensitive),
   then name with a trailing parameter stripped ("Sustained Hits 2",
   "Feel No Pain 5+", "Scouts 6\"", "Rapid Fire 1", "Anti-Infantry 4+" →
   `anti` with the parameter kept for the title).
2. **Linking prose.** `UI.linkGlossary(html)` wraps mentions in
   `<button type="button" class="glossary-term" data-glossary="<id>">…</button>`
   without touching text inside existing tags' attributes or inside an
   existing `.glossary-term`. Match whole words, longest term first. Rules to
   avoid false links:
   - Inside `<strong>…</strong>` any term matches, case-insensitive
     (40kdc bolds ability names).
   - Outside `<strong>`, a term matches only in Title Case ("Lone Operative",
     "Stealth"), and the single-word terms that are also ordinary words —
     `Leader, Support, Hover, Heavy, Pistol, Assault, Blast, Lance, Psychic,
     Precision, Torrent, Melta, Scouts, Cleave, Smokescreen` — match outside
     `<strong>` only when followed by " ability"/" abilities" or preceded by
     "the "/"has "/"gains "/"gain "/"have " AND not followed by another
     Capitalised word (so "Heavy Intercessor Squad", "Assault Intercessors",
     "Blast Master" never link).
   - A trailing parameter directly after the term (` 5+`, ` 2`, ` D6`, ` 6"`)
     is included in the button label.
   `UI.mdBold` is wrapped at load: `const base = UI.mdBold; UI.mdBold = s =>
   UI.linkGlossary(base(s))`. That covers every renderer that goes through it
   (unit abilities, wargear, rule/stratagem/enhancement detail, detachment
   sheet, Play, Waha). Cards mode also goes through it: `css/glossary.css`
   neutralises `.glossary-term` inside `#cards-mode` (inherit font, colour,
   no border/underline, `pointer-events: none`) so printed cards are
   unchanged.
3. **Chips.** The weapon-keyword and core-ability tags from detail.js open
   the same popover on click/Enter/Space (delegate on `.weapon-kw-tag,
   .core-ability-tag, .glossary-term`); lookup by `data-glossary`, then by
   the tag's text, then fall back to the tag's `data-tooltip` text with the
   tag's label as the title. The hover tooltip keeps working on desktop.
4. **Popover.** One singleton `#glossary-pop` (`role="dialog"`,
   `aria-modal="false"`, `aria-labelledby` the title): title (the term as
   written, e.g. "Feel No Pain 5+"), the rule text rendered through the
   ORIGINAL `mdBold` (no nested linking), and a × button (`aria-label="Close"`).
   Desktop (>820px): anchored under the clicked element, clamped to the
   viewport, max-width 360px, `position: fixed`, z-index above the detail
   panes and below modals; closes on ×, Esc, outside click/tap, or another
   term opening. Phone (≤820px): a bottom sheet (full width, max-height 60vh,
   scrollable, safe-area padding) with the same close paths, registered with
   `App.backTrap.opened('glossary', close)` / `closed('glossary')` so
   hardware Back closes it. Focus moves to the sheet on open and returns to
   the term on close. Tokens only (`--panel-bg`, `--border`, `--text`,
   `--text-muted`, `--accent`, `--accent-rgb`, `--font-display`); check all
   three themes.
5. **Term styling.** `.glossary-term`: inline, inherits font and colour,
   `border-bottom: 1px dotted var(--accent)`, no background, `cursor: pointer`,
   `padding: 0`, hover/focus → solid underline + faint accent wash; inside
   `<strong>` stays bold. `.weapon-kw-tag`, `.core-ability-tag`: keep today's
   look, `cursor: pointer`, and a focus-visible ring.
6. **No writes.** The module reads `DC` and the DOM only; no storage, no
   `App.state`.

## Self-check (worker)

`node --check` (docker, `node:22-alpine`) on glossary.js, detail.js,
helpers.js. Then a `browse.sh run` at 1440 and 390, no screenshots for the
record: boot the live site; in Build pick Space Marines and click a unit
with Stealth and a weapon with Lethal Hits (e.g. find one via
`App.state.allUnits`); assert `.core-ability-tag` and `.weapon-kw-tag` are
`<button>`s, clicking the Stealth tag opens `#glossary-pop` whose text equals
`DC.abilityText.stealth.raw_text`, Esc closes it, clicking the Lethal Hits
chip shows the lethal-hits text; open a datasheet whose ability prose
contains "**Stealth**" or "the Stealth ability" and assert a
`.glossary-term[data-glossary="stealth"]` exists in the abilities section and
opens the same text; `UI.linkGlossary('Heavy Intercessor Squad has Lethal Hits
and the Stealth ability. Assault Intercessors. **Leader**')` yields links for
Lethal Hits, Stealth and Leader only; in Waha open a detachment whose
enhancement text mentions Stealth (search `stealth`, Enhancements tab) and
assert the link opens the sheet on phone as a bottom sheet and
`history.back()` closes it; in Play expand a stratagem and click a linked
term. Build's Add to Army still works after your detail.js edit.

Report ≤150 words: files, function names, the term count indexed, the
self-check lines, anything in this contract that was wrong.
