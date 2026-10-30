# Issue batch 2026-09-09 — #59, #60, #64, #70, #83

Contract for one batch of five independent fixes, picked at random from the
open `claude-found` list. Each item names its owned files; nothing else may
be touched. Non-owned surfaces must be pixel-identical in the default
(Grimdark) theme afterwards — that theme loads no theme CSS, so any change
visible there is a regression unless the item says otherwise.

House rules that apply to every item: buildless vanilla JS IIFEs on
`window.App` / `window.UI`, hook-first (no edits to `events.js`,
`detail.js`), every control wears the site's styling in all three themes
(`grimdark`, `brutalist`, `brutalist-dark` — switch with
`localStorage.yaab_theme` before load), no `waitForFunction` in Playwright
(CSP), changelog entries are added ONCE at the end by the batch's final task,
not per item.

Cheap checks (run on every review):

```
# parse check — "window is not defined" = OK, SyntaxError = FAIL
cd ~/sites/sites/yetanotherarmybuilder/app && docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  node --input-type=module -e "import('/app/js/app/sync.js').catch(e=>{console.log(e.name+': '+e.message);process.exit(e instanceof SyntaxError?1:0)})"
# screenshots / scripts
~/sites/base/browser/browse.sh shot https://yaab.thewheeliebois.com <outdir>
W=390 ~/sites/base/browser/browse.sh run <script.mjs> <outdir>
```

The site is served straight from this working tree — an edit is live the
moment it is saved. There is no staging copy.

---

## #59 — Offline pip (sync queue feedback)

**Owns:** `js/app/sync.js` (line ~711 handler + one new export), new
`js/ui/offline-pip.js`, new `css/offline-pip.css`, `index.html` (one
`<link>` + one `<script>` tag, nothing else).

- `App.Sync.queueLength()` → number of ops in `yaab_sync_queue` (0 when the
  key is absent). Sync.js dispatches `window.dispatchEvent(new CustomEvent('yaab:sync-queue'))`
  whenever the queue changes (enqueue, drain success) — the pip listens to that
  plus `online` / `offline`.
- Element `#topbar-offline` (a `<span role="status">`), inserted by the pip
  module at bootstrap immediately BEFORE the auth button's mount in the topbar.
  Hidden (`hidden` attribute) while `navigator.onLine` is true AND the queue
  is empty. Text:
  - offline, queue empty → `Offline`
  - offline, N queued → `Offline · N queued`
  - online, N queued (drain in progress / backing off) → `N queued`
  - At ≤ 480px the ` · N queued` suffix collapses to ` · N` (CSS, not JS —
    put the count in a `<span class="topbar-offline-n">`).
- Styling through existing tokens only (`--panel-bg`, `--border`,
  `--text-muted`, `--accent`): a chip the same height as the auth button,
  1px border, no fixed colours. Verify in all three themes; if brutalist needs
  its own rule, report it — do not edit `css/themes/brutalist.css` (owned by
  #64/#70).
- **Done when** a Playwright script with `context.setOffline(true)` shows the
  chip reading `Offline`, an edit while offline makes it read `Offline · 1
  queued`, and `setOffline(false)` hides it again within 5 s. Assert at 1440
  and 390. Use a fixture army named `zz-offline-pip-<ts>` and delete it after.

## #60 — iOS install guidance

**Owns:** `js/app/pwa-install.js`, `css/mobile.css` (append only). Must NOT
touch `index.html` — build the sheet DOM in JS.

- `isIOS()` = `/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)`.
- On iOS, not standalone, not dismissed: the existing install button
  (`#yaab-btn-install`) shows even though `beforeinstallprompt` never fires.
  Clicking it opens `#ios-install-sheet` (a `role="dialog"` panel, `aria-modal`,
  closed by `#ios-install-close` and by Escape) with three numbered steps:
  tap Share, tap Add to Home Screen, tap Add. Steps are an `<ol>`; the Share
  glyph is inline SVG, not an emoji. "Got it" (`#ios-install-close`) sets the
  existing `DISMISS_KEY` so the button hides afterwards, same as Android.
- Both buttons in the sheet are BUTTONS with the site's button styling, in
  all three themes.
- **Done when** a Playwright context with an iPhone user agent
  (`userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'`,
  `viewport 390x844`, `hasTouch: true`) shows the install button, click opens
  the sheet, Escape closes it, click + "Got it" hides the button and sets
  `localStorage.yaab_pwa_dismissed === '1'`; and a normal desktop context shows
  no button (no `beforeinstallprompt` in headless Chrome either).

## #64 + #70 — Neo-Brutalist theme: cards-mode chrome, two glyphs, one link

**Owns:** `css/themes/brutalist.css` only. ONE worker for both issues.

- #64: theme the Cards designer CHROME under both brutalist variants — the
  page ground (`#cards-mode.mode-page`), the left rail, `.cards-row` and its
  hover, `.cards-subtab` (+ active), the preview canvas ground, the presets
  panel and its inputs/buttons, `#cards-preset-delete`. Use the `--nb-*`
  tokens (paper/ground/ink/rule/shadow) and the existing brutalist button
  shape. The PRINT templates are out of scope and must not change: nothing
  matching `[class*="dcc-"]` may pick up a new rule — the existing
  `*:not([class*="dcc-"])` exclusion in the file explains why.
- #70: raise `.reserves-view-icon` and `.stockpile-row-icon` to ≥ 3:1 against
  their ground under `brutalist` (light) — change colour, not size; and add
  `.requisitions-empty-link` to the `.reserves-empty-link` button rule (and
  its `:hover`) at ~line 2036.
- **Done when** (a) default theme: `shot` of the Cards page and the Collect
  page are pixel-identical before/after (compare PNGs with `cmp` or a Python
  diff); (b) `brutalist`: Cards page shows a light rail/ground with no dark
  seam under the white topbar at 1440 and 390, and an element screenshot of
  one `.dcc-card` is byte-identical before/after; (c) measured contrast of
  the two glyphs ≥ 3:1 (compute from `getComputedStyle` colours in the
  script); (d) requisitions empty state renders the link as a brutalist
  button — reach it by switching the unit pane to Requisitions with none
  saved (`localStorage.yaab_units_view = 'requisitions'`, no
  `yaab_requisitions`).

## #83 — Cards-mode points chip omits wargear

**Owns:** `js/ui/cards-mode.js` (the `ptsLabel` site ~line 1420), `js/army.js`
(one new method).

- `Army.prototype.getEntryCopyWargearPts(index)` → the per-copy priced
  wargear figure `getEntryPoints` already computes as `wgPts`
  (`max(0, base + selections)`); refactor `getEntryPoints` to call it so
  there is one implementation.
- Card chip = `selectedPts (or pointsOptions[0]) + getEntryCopyWargearPts(index)`
  when the card has an army entry index; unchanged for cards rendered
  without one. Enhancements stay itemised on the card as today (their
  surcharge is printed on the row, not in the chip).
- **Done when** a Playwright script adds Orks → Gunwagon, steps the Zzap gun
  to 1 in the wargear picker, adds to army, opens Cards
  (`#topbar-mode-cards`), and the Gunwagon card's points chip reads `160`
  while the topbar reads `160`; and a unit with no priced wargear (Boyz)
  still reads its base. Army total in the roster must not change. Fixture
  army `zz-cards-pts-<ts>`, deleted after.

---

## Final task (after all four land): changelog + stamp

**Owns:** `js/data/changelog-data.js`, `index.html`, `sw.js` (stamp only).
Bump `version` to `2026.09.09-3`, `lastUpdated` to `2026-09-09`, add one
`fix` entry per issue at the top (user-facing wording, no issue numbers in
the title), run `node scripts/stamp-assets.mjs`, then
`node scripts/stamp-assets.mjs --check` must pass.
