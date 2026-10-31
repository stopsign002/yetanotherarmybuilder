# Retiring pipeline v1 (run AFTER the v2 cutover)

Preconditions: the first v2 candidate has been approved into the LIVE tree
(`yaab-data approve <id> --app ~/sites/sites/yetanotherarmybuilder/app`), the
live site has loaded it for at least one full day with no regressions, and a
rollback has been rehearsed once. Do not start earlier: until the loader is live,
the v1 scripts are the only thing producing a working site.

Who: **S** = the Claude session (no sudo needed), **O** = owner (needs sudo or a
web UI). Paths verified with `ls` on 2026-10-31; MISSING means it does not exist
today (skip it, nothing to move).

## 0. Blockers to clear first (found while checking, not in the plan)

1. **`js/parser/` cannot be deleted yet.** `index.html` still has 11 script tags
   for it, and `WahapediaParser._internal.foldKey` (used by `attachments.js`) is
   currently a stub installed by `js/data/dc-adapter.js`. W3's
   `dataset-loader.js` must keep that stub (or `attachments.js` must stop using
   it) before the tags and the directory go. Same for `js/bsdata.js` (loaded
   before the loader, and `js/app/bsdata-load.js` is a different, live file: keep it).
2. **`~/sites/base/bug-fixer.py` and `bug-fixer-prompt.md` still target v1.**
   `bug-fixer.py` (~line 195) smoke-tests the real `dc-adapter.js` + `gdc.js`
   pipeline and reverts + escalates any fix that fails it; the prompt (lines
   92, 98, 220) tells Claude to fix data in `dc-adapter.js` and not to touch
   `dc-bundle.js`. After cutover every unattended fix would be reverted. Rewrite
   the smoke test to load `data/dataset/current/` (35 factions / ~995 units with
   intact statlines) and point the prompt at "data bugs are pipeline/source
   bugs, not app-code fixes". **S**, before step 1 below.
3. **`~/sites/base/health-sweep.py`** lines 741-744 watch `yaab-pipeline.log` and
   `refresh-40kdc.log` for staleness; remove those two rows and add the v2 daily
   log when the cron exists. **S**.
4. `~/sites/base/gap-report.sh` header describes the v1 data path; update or retire. **S**.
5. `~/sites/base/stat-checker-review.md`, `HANDOFF-stat-checker.md`,
   `HANDOFF-dump-audit.md`, `HANDOFF-faction-bleed.md`, `gw-*-report.md`,
   `errata-uncertainty-report.md` are v1 history: move them into the retired dir
   with the rest (step 3) if the owner agrees; they are not required by anything.

## 1. Cron (O or S: `crontab` is the operator's own, no sudo)

`crontab -l > ~/sites/base/crontab-before-retire-v1.txt`, then edit (`crontab -e`)
and delete:

- `35 4 * * 1 /home/stopsign002/sites/base/yaab-pipeline.sh` (live line)
- the commented v1 lines kept as back-out directly under it:
  `#35 4 * * * .../yaab-pipeline.sh`, `#45 4 * * * .../refresh-40kdc.sh ...`,
  `#15 6 * * 1 flock ... wahapedia-audit.py ...`,
  `#30 5 * * * AUDIT_MODE=report .../dump-audit-run.sh`
- the explanatory comment block that starts `# ── yaab data pipeline` and the
  stat-checker / dump-audit comment blocks above those lines (crontab lines
  6-56 area; read it before deleting, keep the unrelated lines).

Keep `bug-fixer.py` (`20 * * * *`) and issue-solver lines. Add the v2 daily
candidate cron only when M4 lands (see "Not yet wired" in `CLAUDE.md`).

## 2. Stop anything running

`pgrep -af 'yaab-pipeline|refresh-40kdc|dump-audit|wahapedia'` must be empty (**S**).
`.yaab-tree.lock` (EXISTS) is still used by `bug-fixer.py` and the issue solver:
**do not move it.**

## 3. Move scripts to `~/sites/base/retired-2026-10-31/` (S; plain `mv`, nothing is deleted)

`mkdir ~/sites/base/retired-2026-10-31` first (MISSING today). Then, from
`~/sites/base`, move each that exists (all EXIST unless marked):

```
refresh-40kdc.sh  yaab-pipeline.sh  overlay_merge.py
faq-processor.sh  faq-processor-prompt.md  faq-runs/  faq-cache/
faq-aliases.json  faq-processor.log            # EXIST, not in the original list; faq-processor family
wahapedia-audit.py  wahapedia-audit-dump.mjs  stat-checker-dismissed.json
wahapedia-aliases.json      # MISSING
nr-aliases.json             # MISSING
wahapedia-fixer.sh  wahapedia-fixer-prompt.md  wahapedia-fixer-queue.py
wahapedia-fix-queue.json  wahapedia-fix-runs/      # the wahapedia-fixer.* family
dump-audit.py  dump-audit-run.sh  dump-dismissed.json
dump-audit-report.json  dump-audit-report.txt      # the only dump-audit-*.json that exists
dump-aliases.json           # MISSING
dump-audit-cache/  dump-audit-runs/
mfm-audit.py  mfm-audit-cache/  mfm-audit-report.json  mfm-audit-report.txt
mfm-scrape-wargear.py  mfm-aliases.json  mfm-wargear-costs.json
stat-upstream-stage.py
stat-corrections.json  faq-corrections.json  dump-corrections.json  manual-corrections.json
DATA-FREEZE
pipeline-runs/  yaab-pipeline.log  refresh-40kdc.log  dump-audit.log
wahapedia-audit.log  wahapedia-audit-report.json  wahapedia-audit-report.txt
```

Also `*.bak-*` siblings of the above (e.g. `yaab-pipeline.sh.bak-20260912`).

`40kdc-build/`: it EXISTS (`40kdc-data/ abilities/ bundle/ fork/
upstream-wargear-costs-notes.md`). `yaab-data/checkouts/` now exists too (W2
created it). Move the checkout, then retire the rest:

```
mv ~/sites/base/40kdc-build/40kdc-data ~/sites/base/yaab-data/checkouts/40kdc-data   # at 709ecd9f; sources.json pins the sha
mv ~/sites/base/40kdc-build ~/sites/base/retired-2026-10-31/40kdc-build
```
Verify `git -C ~/sites/base/yaab-data/checkouts/40kdc-data rev-parse --short=8 HEAD`
prints `709ecd9f` (or whatever `pipeline/sources.json` pins) and that
`pipeline/yaab-data build` still resolves it. If the build already copied the
checkout rather than moving it, `rm`-ing the old one is enough.

`~/sites/base/backup.sh` lines 198-203 exclude `40kdc-build`, `40kdc-corrections`,
`faq-cache`, `wahapedia-audit`, `dump-audit-cache`, `mfm-audit-cache`. They are
harmless once the dirs are gone. The new `retired-2026-10-31/` dir is NOT
excluded, so the config tarball will carry its scripts (fine) and its caches:
**exclude the big ones** by adding `--exclude='sites/base/retired-2026-10-31/*cache*'`
and `--exclude='sites/base/retired-2026-10-31/40kdc-build'`, or the tarball grows
and B2's 365-day lock keeps every copy. **S** edits `backup.sh`.

## 4. Repo deletions (S; in the yaab app repo, via a normal commit)

EXIST today: `build/`, `.github/workflows/mirror-bsdata.yml`,
`scripts/mirror-bsdata.mjs`, `data/bsdata/`, `js/bsdata.js`, `js/parser/`,
`js/vendor/dc-bundle.js`, `js/data/dc-adapter.js`, `data/gdc/` (see below).
`js/vendor/dc-prose.js` is MISSING (server-only/gitignored; the `index.html` tag
at line 587 still points at it, remove with the loader change).

```
git rm -r build .github/workflows/mirror-bsdata.yml scripts/mirror-bsdata.mjs data/bsdata js/bsdata.js
git rm js/vendor/dc-bundle.js js/data/dc-adapter.js      # if W3 has not already
git rm -r js/parser                                      # ONLY after blocker 0.1 is cleared
```
Then remove the matching `<script>` tags from `index.html`
(`bsdata.js`, the 11 `js/parser/*` tags), run `node scripts/stamp-assets.mjs`
(via docker, host has no node), bump `js/data/changelog-data.js` only if this is
a user-visible release, and verify with `scripts/pwa-check.mjs`,
`scripts/play-e2e.mjs`. `data/gdc/` (the committed GDC snapshot the v1 browser
read): the v2 browser does not read it; delete it once the extractor's own
source (a `pipeline/sources.json` pin, not this folder) is confirmed. Do not
delete `js/app/bsdata-load.js` (live seam, name notwithstanding). `package.json`
under `build/` goes with `build/`; fix the `.gitignore` note in `CLAUDE.md`.

## 5. GitHub (O, web UI; `gh` cannot toggle Pages without admin scope on this token)

- Settings > Pages of `stopsign002/yetanotherarmybuilder`: set Source to **None**
  if Pages is enabled (the mirror Action's only purpose was feeding the
  now-unread `data/bsdata/`). Check first: `gh api repos/stopsign002/yetanotherarmybuilder/pages`
  (404 means nothing to disable).
- Actions tab: the `mirror-bsdata` workflow disappears with step 4; no secret to clean.

## 6. `~/sites/CLAUDE.md` paragraphs to rewrite (S)

All are bullets in "Operational notes" (current first words):

- `- **yaab data pipeline** (added 2026-08-14): ...` (line ~768) rewrite to the v2 flow, or replace with a pointer to `app/docs/DATASET.md`
- `- **yaab 40kdc data refresh**: ...` (776) delete
- `- **yaab hand-authored corrections** (added 2026-08-13): ...` (777) delete (no corrections layer)
- `- **yaab dump audit** (replaced the wahapedia audit 2026-07-28): ...` (778) delete; its checks became validator rules
- `- **yaab MFM points audit** (added 2026-07-28): ...` (779) delete; "app vs MFM" is validator invariant 6.3
- `- **yaab stat checker (retired 2026-07-28, UN-RETIRED 2026-08-14)**: ...` (782) delete
- `- **yaab wahapedia fixer**: ...` (785) delete
- `- **yaab bug fixer** (added 2026-07-28): ...` (786) keep, but fix "smoke test (the real dc-adapter + gdc.js pipeline ...)" and "never `js/vendor/dc-bundle.js`" per blocker 0.2; also its "App-tree lock ... `refresh-40kdc.sh`" sentence
- `- **Backups**: ...` (the very long one): the "media" leg sentence gains `data/dataset`; remove nothing else
- `- **Issue solver** ...`: the "yaab only if `.yaab-tree.lock` is free" text stays (the lock still exists)
- `- **Weekly health sweep** ...`: no change needed beyond the health-sweep.py edit
- In "Filing unrelated findings": the sentence "`app/js/vendor/dc-bundle.js` is generated, so a data error there is a `refresh-40kdc.sh` issue (`homewebhost`) or an upstream 40kdc one" becomes "a data error is a `pipeline/` or source issue; yaab-repo issues for `pipeline/`".
- Add one new bullet, `- **yaab dataset pipeline (v2)** ...`: where it lives, the CLI, approve/rollback, Caddy no-cache, candidate cron (when it exists), backup leg.

## 7. server-cron mirror (S; repo `~/server-cron`, private)

`~/server-cron/README.md` section `## 4. yaab data pipeline` (line ~124, incl. the
FROZEN banner), the table row `| 04:35 | [yaab data pipeline](#4-yaab-data-pipeline) | weekly (Mon) |`
(line 27) and the sentence at line ~35 ("the three that can change things by
themselves: bug fixer, the yaab data ...") must be rewritten to the v2 daily
candidate job (or marked RETIRED like section 7 "Flight tracker — RETIRED").
`~/server-cron/crontab.txt`: mirror the new `crontab -l`. In
`~/server-cron/scripts/base/` `git rm` the mirrored copies of every moved script
(EXIST there: DATA-FREEZE, dump-audit-run.sh, dump-audit.py, faq-processor-prompt.md,
faq-processor.sh, mfm-audit.py, mfm-scrape-wargear.py, overlay_merge.py,
refresh-40kdc.sh, stat-upstream-stage.py, wahapedia-audit-dump.mjs,
wahapedia-audit.py, wahapedia-fixer-prompt.md, wahapedia-fixer-queue.py,
wahapedia-fixer.sh, yaab-pipeline.sh), copy in the new `bug-fixer.py`,
`bug-fixer-prompt.md` and `health-sweep.py`, and (once it exists) the v2 cron
wrapper. Commit and push.

## 8. Monitor check (S, after M4's candidate cron exists)

`yaab-data` writes `current/manifest.json` with `sources.gdc.updated` and
`builtAt`. Add a monitor check "days since the last approved candidate vs GDC
`updated` is more than N" (suggest N=14; owner pausing approval is legitimate, so
make it a warning, not a page):

- `~/sites/sites/monitor/ops/api/sites.js`: the yaab row exists
  (`{ vhost: 'yaab', site: 'yetanotherarmybuilder', ... }`); extend or add a check
  next to it that reads `https://yaab.thewheeliebois.com/data/dataset/current/manifest.json`
  (or a `yaab_dataset_age_days` metric).
- `~/sites/sites/monitor/prometheus/rules/alerts.yml`: add the rule; reload
  Prometheus; `docker compose -f ~/sites/sites/monitor/docker-compose.yml up -d --build ops-api`.
- Do NOT add the check before the daily cron: it would alert immediately.

## 9. Caddy and backup (host)

- **Caddy `no-cache` on `/data/dataset/*`** in `~/sites/base/conf.d/yetanotherarmybuilder.caddy`
  (and `yaab-test.caddy` if it has its own file), then
  `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`. **S** (conf.d is
  operator-owned). Today that file has no `dataset` rule. Also hide `/pipeline/*`
  (`respond 404`) and confirm `Cache-Control: no-cache` with `curl -sI`.
- **Backup:** `data/dataset` is NOT in git and NOT in the tarball
  (`backup.sh` excludes `sites/sites/*/app`), so the media leg is its only copy.
  `MEDIA_GLOBS` defaults to `$HOME/sites/sites/*/uploads` (`backup.sh` line 68;
  commented in `backup.env` line 22). Set in `backup.env` (chmod 600, **S** can
  edit, no sudo):
  `MEDIA_GLOBS="$HOME/sites/sites/*/uploads $HOME/sites/sites/yetanotherarmybuilder/app/data/dataset"`.
  **Gotcha:** `backup.sh` names the remote dir `<basename of the parent>/<basename>`,
  which for this path (parent of `dataset` is `data`) is
  `b2:homewebhost/media/data/dataset`. That is unambiguous only
  for one site; acceptable, but prefer a symlink-free tweak in `backup.sh`
  (use the site dir two levels up) if a second site ever does this. Also the leg
  is `rclone copy` (never `sync`): same-named files (`current/<faction>.json`,
  `manifest.json`) are overwritten on the next run and B2 keeps old versions
  under its 365-day lock; candidate ids are unique so each is uploaded once.
  Set `MEDIA_WARN_MB` above the dataset size (13 MB x candidates kept) or it will
  warn nightly.
- Remove `RCLONE`/exclude lines only as listed in section 3.

## 10. Final checks (S)

`grep -rn "dc-bundle\|dc-adapter\|refresh-40kdc\|DATA-FREEZE\|yaab-pipeline" ~/sites/base/*.py ~/sites/base/*.sh ~/sites/base/*.md ~/sites/CLAUDE.md`
returns only historical mentions; `crontab -l | grep -i "yaab-pipeline\|refresh-40kdc\|dump-audit"` is empty;
`~/sites/base/health-sweep.py` runs clean; the live site loads, `?data=candidate:<id>` still previews,
`yaab-data rollback` still works; `~/sites/base/browser/browse.sh` shots of the live and test vhosts at both widths.
