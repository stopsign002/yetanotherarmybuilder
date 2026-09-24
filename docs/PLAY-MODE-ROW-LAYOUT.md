# Play mode — row layout + wounds removal (contract, 2026-09-24)

Owner request, verbatim intent:

1. Enhancements a character took must show at the **very top** of its Play
   sheet (done in `detail.js` — `.detail-enhancements-game` renders before the
   stat strip in `gameView`).
2. **Desktop Play mode gets a second layout: every datasheet lined up in one
   horizontal row, scrolled sideways.** Switched with a toggle in the header
   next to the CP counter.
3. **The wounds counter is removed.** Wounds are tracked on the board, not in
   the app, and the stepper takes up room. The ☠ destroyed toggle stays.

Files owned by this change: `js/ui/play-mode.js`, `css/play-mode.css`, this
doc, the `play-mode.js` entry in `docs/MODULE-REFERENCE.md`. Nothing else.

## Layout toggle

- Header markup (inside `.play-header`, immediately after `.play-cp`):
  ```html
  <div class="play-layout-toggle" role="group" aria-label="Sheet layout">
    <button type="button" class="play-layout-btn" data-layout="single" aria-pressed="true">One</button>
    <button type="button" class="play-layout-btn" data-layout="row" aria-pressed="false">All</button>
  </div>
  ```
  Segmented control: same 38px height as `.play-cp-btn`, the pressed button
  filled with `var(--accent)` / `var(--accent-on)`, the other one `var(--card-bg)`
  with `var(--text-muted)`. Tokens only — no literal colours — so all three
  themes are covered. Titles: "One sheet at a time" / "All sheets in a row".
- Persisted as `layout: 'single' | 'row'` in `yaab_play_view` (device-local,
  alongside `tab` / `entryByArmy`). Default `single`.
- `.play-root` carries `data-layout="single|row"` — the **effective** layout,
  which is `row` only when the stored preference is `row` AND
  `window.matchMedia('(min-width: 821px)').matches`. Phones always get
  `single` (swipe already pages sheets there); the toggle is `display:none`
  under the existing `@media (max-width: 820px)` block. Listen to the media
  query's `change` event and re-apply so a window resize crossing 820px
  flips the layout without a re-render.
- Applies to the **Sheets tab only**. Stratagems / Rules / Enhancements tabs
  are untouched.

## Row layout behaviour (`.play-root[data-layout="row"]`, Sheets tab)

- The unit switcher rail (`.play-switcher`) is hidden — the row IS the
  navigation, and every sheet now carries its own name header (below).
- `.play-panel[data-panel="sheets"]` becomes a horizontal flex row:
  `display:flex; flex-direction:row; gap:12px; overflow-x:auto;
  overflow-y:hidden; scroll-snap-type:x proximity; align-items:stretch`.
  Every `.play-sheet` is visible (`hidden` is NOT set in row layout) with
  `flex:0 0 560px; max-width:none; margin:0; overflow-y:auto;
  scroll-snap-align:start`, so the row keeps the panel's height and each
  sheet scrolls vertically inside its own column. Long datasheets must never
  make the row itself grow.
- `setActiveEntry` stays the single hot path. In `single` it toggles `hidden`
  exactly as today; in `row` it leaves every sheet visible, marks the active
  one with `.is-on`, and `scrollIntoView({inline:'nearest', block:'nearest'})`
  scrolls it into the row. Arrow keys therefore walk the row. Implement as
  one `applyLayout()` that sets `data-layout`, pressed state on the toggle,
  and re-runs `setActiveEntry(_activeEntry)`; the toggle click, first render,
  and the media-query change all call it.
- `.play-sheet.is-on .play-sheet-head` gets a `var(--accent)` bottom border
  in row layout so the "current" sheet is visible.

## Sheet header replaces the tracker strip

`.play-tracker` (dead button + wounds stepper) is replaced by a one-row head
on every sheet, in both layouts:

```html
<div class="play-sheet-head" data-entry-id="…">
  <span class="play-sheet-name">Unit name (the same label the switcher chip shows)</span>
  <button type="button" class="play-dead" aria-pressed="false">☠ Mark destroyed</button>
</div>
```

`flex; align-items:center; justify-content:space-between; gap:10px;
padding:6px 10px; margin-bottom:8px` with the current `.play-tracker` border/
background. Name in `var(--font-display)`, 14px, 700, ellipsised. The
`touchstart` swipe guard that names `.play-tracker` must name
`.play-sheet-head` instead.

## Wounds removal

Delete outright: the `.play-wounds` markup, `.play-w-btn` / `.play-w-num` /
`.play-w-val` / `.play-chip-w` CSS and DOM, `onWounds`, the `.play-w-btn`
click branch, the chip badge logic in `applyGameState`, and the `w` field —
game state per unit becomes `{dead}` only (`unitMeta` shrinks to whatever
`renderSheets` still needs; drop `maxW`/`perModelW` if nothing reads them).
Stored bags that still carry `w` are simply ignored — no migration.
`onReset`'s confirm text becomes "Reset this game? CP and destroyed markers
will be cleared." Update the file-header comment (lines 8–9) and the
`docs/MODULE-REFERENCE.md` entry (Purpose + Storage lines) to stop
mentioning wounds and to mention the layout toggle.

## Done means

- `node --check js/ui/play-mode.js` passes; `grep -n "play-w\|onWounds\|maxW\|play-tracker" js/ui/play-mode.js css/play-mode.css` returns nothing.
- Desktop, Sheets tab, "All" pressed: every sheet visible in one row, the
  panel scrolls sideways, no vertical growth of the row, switcher hidden,
  each sheet shows its name + ☠. "One" pressed: today's behaviour minus
  the wounds stepper. Preference survives a reload.
- Phone width: toggle not shown, single layout regardless of the stored
  preference.
- Works in all three themes (grimdark, brutalist, brutalist-dark) — token-
  driven colours only.
