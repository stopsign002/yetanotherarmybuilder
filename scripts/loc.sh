#!/usr/bin/env bash
# loc.sh — reproducible line counts for the 2026-10-31 simplification pass
# (docs/SIMPLIFY-2026-10-31.md). Excludes vendor, data/, changelog-data.js,
# package-lock. Run from anywhere: scripts/loc.sh
set -eu
APP="$(cd "$(dirname "$0")/.." && pwd)"
API="$APP/../api"
cd "$APP"
count() { # files on stdin (NUL-separated) -> total lines
  { xargs -0 -r cat 2>/dev/null || true; } | wc -l
}
f() { find "$@" -type f -not -name 'package-lock.json' -not -name 'changelog-data.js' \
        -not -path '*/vendor/*' -not -path '*/data/*' -not -path '*/node_modules/*' -print0; }
row() { printf '| %-52s | %6s |\n' "$1" "$(cat | count | tr -d ' ' | sed -e ':a;s/\B[0-9]\{3\}\>/,&/;ta')"; }
echo '| area | lines |'; echo '|---|---|'
f js/app            | row 'app/js/app'
f js/ui             | row 'app/js/ui'
find js -maxdepth 1 -type f -name '*.js' -print0 | row 'app/js (root: army, storage, db, theme-boot, gdc stub)'
find js/data -maxdepth 1 -type f \( -name 'dataset-loader.js' -o -name 'stratagems-data.js' \) -print0 | row 'app/js/data (loader, stratagems)'
find css -type f -not -path 'css/themes/*' -print0 | row 'app/css'
f css/themes        | row 'app/css/themes'
printf '%s\0' index.html | row 'app/index.html'
# pipeline: code only (no json data/schema, no md). scripts: the top-level files
# (the contract's baseline); verify/ is listed on its own row.
f pipeline -not -name '*.json' -not -name '*.md' | row 'app/pipeline'
find scripts -maxdepth 1 -type f -print0 | row 'app/scripts'
f scripts/verify    | row 'app/scripts/verify (extra row, not in the baseline)'
find "$API" -maxdepth 1 -type f -name '*.js' -print0 | row 'api'
