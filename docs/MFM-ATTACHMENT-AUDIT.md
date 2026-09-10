# MFM attachment audit — contract

Written 2026-09-10. The MFM is the oracle for Leader/Support attachments as
well as points (see `docs/GDC-AUTHORITY.md`). Nothing in yaab reads it for
attachments today, so this audit answers one question for every faction:
**does yaab let you attach exactly what the MFM says you can?**

Both over- and under-permissiveness are real bugs with opposite symptoms:
allowing an attachment the MFM does not list builds an **illegal army**;
refusing one it does list means a **legal army the user cannot build**.

## Deliverable

Three files in the audit scratchpad (no app-code changes, no commits):
`mfm-attachments.json`, `yaab-attachments.json`, `attachment-diff.md`.

## Source A — the MFM (the oracle)

28 pages, `https://mfm.warhammer-community.com/en/<slug>`, slugs exactly as
`FACTION_PAGES` in `~/sites/base/mfm-scrape-wargear.py`.

**Render the page and read `document.body.innerText`. Do NOT regex the HTML** —
the attachment strings sit behind `$L<id>` lazy references in the Next.js RSC
payload and are absent from the raw markup, so a regex scrape silently returns
nothing rather than failing. Headless Chrome via `~/sites/base/browser/browse.sh
run` reaches the public internet.

Parse rules, all learned the hard way on the Ork page:

- Real content starts after the line `UNITS`.
- A unit header is an ALL-CAPS line that is not noise. Noise: `▲`, `▼`, `▲▼`,
  `UPDATED`, `NEW`, `WARGEAR COSTS REMOVED`, `LEGENDS`, `Show Legends`; any
  line starting `YOUR`; any line containing `pts`; any `^\d+ models?$`.
- A `LEADER` or `SUPPORT` line is followed by **one** line holding the
  comma-separated target unit names.
- **The trap:** those target names are ALL-CAPS too, so a naive header test
  eats them as the next unit. The line immediately after `LEADER`/`SUPPORT`
  is always the target list, never a header.
- Record the MFM version banner (e.g. `v1.4`) and turn **"Show Legends" ON**.

  **This was specified backwards in the first version of this contract and it
  invalidated most of a full audit run, so it is worth stating plainly: the
  toggle does not merely hide Legends price blocks, it also strips Legends unit
  names out of OTHER units' LEADER/SUPPORT target lists.** Measured on
  adepta-sororitas, 2026-09-10: with Legends off the Canoness leads six units;
  with Legends on she leads seven, the extra being CRUSADERS. Auditing against
  the Legends-off view therefore reports every Legends-eligible bodyguard as an
  over-permissive bug — ~143 of them on the first run. yaab ships its own
  Legends toggle and `candidateTargetsFor` is not gated on it, so Legends-ON is
  the apples-to-apples scope.

  The control is a `<label>` reading "Show Legends", not a bare checkbox:
  `page.getByText(/show legends/i).first().click()`. **Assert the click took
  effect on every page** — page text length and unit count both grow — and fail
  loudly on any page where nothing changed, rather than silently recording a
  Legends-off page.

Shape: `{ "<slug>": { "<UNIT NAME>": { "role": "LEADER"|"SUPPORT",
"targets": ["<UNIT NAME>", ...] } } }`

**Sanity gate — a blind scrape must fail loudly, never read as "no unit can be
attached".** Every page must yield at least one unit header and the run must
find attachment entries on at least 25 of the 28 pages. A page yielding zero
units is a FAILURE; report it, do not record it as an empty faction.

## Source B — yaab as users actually experience it

Query the **live site through the real adapter**, not the raw 40kdc/GDC files —
`js/app/attachments.js` layers GDC over 40kdc for allowlisted factions, and the
raw files do not reflect what the app permits.

For every faction and unit: `unit.attachmentRole` (`'leader'`/`'support'`/null)
and `App.Attachments.candidateTargetsFor(unit)`. Same JSON shape as source A,
keyed by our faction and unit names.

## The diff

Fold names for comparison: lower-case, strip apostrophes (straight and curly)
and any non-alphanumeric run. Map MFM slug → our faction name; note the Space
Marine chapter pages share a parent.

Classify every difference:

1. **Over-permissive** — we allow a target the MFM does not list. Illegal lists.
2. **Under-permissive** — the MFM lists a target we refuse. Legal list blocked.
3. **Role mismatch** — LEADER vs SUPPORT vs none.
4. **Not carried** — the MFM prices a unit yaab has no datasheet for (Legends,
   or a fresh codex). Report as context, not a defect.

## Done means

- All 28 pages scraped and the sanity gate passed.
- **Orks is the known-good control: 17 units carry an attachment list and all
  17 match.** If the harness reports an Ork mismatch, the harness is wrong —
  fix it before reporting anything else.
- Every difference classified, with the faction, the unit, what we allow and
  what the MFM says, so each one can be actioned without re-running anything.
