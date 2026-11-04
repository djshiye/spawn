#!/usr/bin/env bash
# Install build/ as a GNOME Shell extension.
# Usage: tools/install.sh [data-dir]
#   data-dir defaults to $XDG_DATA_HOME or ~/.local/share; the extension lands in
#   <data-dir>/gnome-shell/extensions/<uuid>.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

uuid="$(node -p "require('./metadata.json').uuid")"
data_dir="${1:-${XDG_DATA_HOME:-$HOME/.local/share}}"
target="${data_dir}/gnome-shell/extensions/${uuid}"

if [ ! -f build/metadata.json ]; then
    echo "build/ is missing, run tools/build.sh first" >&2
    exit 1
fi

mkdir -p "$(dirname "$target")"
rm -rf "$target"
cp -r build "$target"
echo "installed to $target"
