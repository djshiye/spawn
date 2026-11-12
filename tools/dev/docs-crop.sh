#!/usr/bin/env bash
# Cut the docs-shots scenario's full-screen pictures down to the README screenshots in docs/screenshots/.
# Usage: SPAWN_MONITOR=3200x1800 tools/dev-shell.sh docs-shots, then tools/dev/docs-crop.sh [.dev/shots]
# (the scenario runs at 200 %, so a 720 x 740 logical corner is 1440 x 1480 pixels). Needs ImageMagick.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
shots="${1:-$root/.dev/shots}"
out="$root/docs/screenshots"
mkdir -p "$out"
crop() { convert "$shots/docs-$1.png" -crop 1440x1480+0+0 +repage -strip -define png:compression-level=9 "$out/$2.png"; }
crop classic-d classic-dark
crop grid-d grid-dark
crop search-cal-d search-dark
crop allapps-d allapps-dark
crop folder-d folder-dark
crop grid-l grid-light
echo "README screenshots written to $out"
