#!/usr/bin/env bash
# Compile, then run every tests/*.test.js with `gjs -m`.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

npx tsc -p tsconfig.json || exit 1

# Tests that load GTK / libadwaita (through build/prefs/*) need those typelibs. Where they are not installed the
# test is skipped with a visible notice, unless SPAWN_REQUIRE_ALL_TESTS=1 (CI sets it), which makes a missing
# typelib a failure instead.
needs_typelibs() {
    case "$1" in
    tests/prefs.test.js) echo "Adw Gtk?version=4.0" ;;
    esac
}

probe="$(mktemp --suffix=.mjs)"
trap 'rm -f "$probe"' EXIT
fail=0
skipped=0
for t in tests/*.test.js; do
    echo "== $t"
    missing=""
    for ns in $(needs_typelibs "$t"); do
        printf "import 'gi://%s';\n" "$ns" >"$probe"
        if ! gjs -m "$probe" >/dev/null 2>&1; then
            missing="$missing ${ns%%\?*}"
        fi
    done
    if [ -n "$missing" ]; then
        if [ "${SPAWN_REQUIRE_ALL_TESTS:-0}" = 1 ]; then
            echo "FAILED: $t needs typelib(s)$missing, which are not installed" >&2
            fail=1
        else
            echo "SKIPPED: $t needs typelib(s)$missing, which are not installed (set SPAWN_REQUIRE_ALL_TESTS=1 to make this fatal)" >&2
            skipped=$((skipped + 1))
        fi
        continue
    fi
    if ! gjs -m "$t"; then
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo "TESTS FAILED" >&2
    exit 1
fi
[ "$skipped" -eq 0 ] || echo "WARNING: $skipped test file(s) skipped, see SKIPPED lines above" >&2
echo "all tests passed"
