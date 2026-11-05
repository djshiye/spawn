#!/usr/bin/env bash
# Typecheck src/ against the GNOME Shell 49 or 50 typings (tsconfig.compat-<rel>.json) without any file of
# the main @girs/gnome-shell 51 tree in the program. Prints the type errors; exits 1 when there are any.
#
# Usage: tools/compat-typecheck.sh <49|50>      (run `npm run compat:install` once first)
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
rel="${1:-}"
case "$rel" in 49 | 50) ;; *) echo "usage: $0 <49|50>" >&2; exit 2 ;; esac
if [ ! -d "tools/compat/$rel/node_modules/@girs/gnome-shell" ]; then
    echo "typings missing: run npm run compat:install" >&2
    exit 2
fi

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
npx tsc -p "tsconfig.compat-$rel.json" --listFiles >"$out" 2>&1

# Isolation guard: a file from the main tree would mix two typings into the result.
if grep -q "^$root/node_modules/@girs/" "$out"; then
    echo "isolation broken: files of the main @girs tree are part of the $rel program:" >&2
    grep "^$root/node_modules/@girs/" "$out" | head -5 >&2
    exit 3
fi

if grep -q 'error TS' "$out"; then
    grep -v "^$root/" "$out"
    echo "compat $rel: $(grep -c 'error TS' "$out") type error(s)"
    exit 1
fi
echo "compat $rel: no type errors"
