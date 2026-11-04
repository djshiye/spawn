#!/usr/bin/env bash
# Compile, then run every tests/*.test.js with `gjs -m`.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

npx tsc -p tsconfig.json || exit 1

fail=0
for t in tests/*.test.js; do
    echo "== $t"
    if ! gjs -m "$t"; then
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo "TESTS FAILED" >&2
    exit 1
fi
echo "all tests passed"
