#!/usr/bin/env bash
# Fails when a RELEASE artefact contains the test hooks. Run by tools/test.sh (so by `npm test` and CI), and
# usable on its own:
#
#   tools/check-release.sh              build a release (tools/build.sh --release --out <temp>) and check its
#                                       build tree and its zip; also check that the DEV build still has the hooks
#                                       (so the checks below cannot pass by looking for something that is gone)
#   tools/check-release.sh <zip|dir>... check these already built release artefacts instead (a
#                                       .shell-extension.zip, or an installed extension directory, e.g. the one
#                                       the RPM installs under /usr/share/gnome-shell/extensions/)
#
# A release must contain: no src/ui/devHooks, no src/dev/*, no 'io.github.djshiye.Spawn.Dev' / '.Spawn.Ui'
# interface, no `dev-mode` key in the schema, and nothing that reads it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

# check_tree <label> <dir>: the release rules against an unpacked extension tree.
check_tree() {
    local label="$1" dir="$2" f
    for f in ui/devHooks.js dev/benchmark.js dev/devDbus.js dev/devController.js; do
        if [ -e "$dir/$f" ] && grep -q . "$dir/$f"; then
            # the release stubs of devDbus / devController / devHooks are tiny; the real ones are far bigger
            if [ "$(wc -c <"$dir/$f")" -gt 600 ]; then
                echo "FAIL $label: $f is the real dev code" >&2
                fail=1
            fi
        fi
    done
    [ ! -e "$dir/dev/benchmark.js" ] || { echo "FAIL $label: dev/benchmark.js is present" >&2; fail=1; }
    # Strings that only the hooks contain, anywhere in the shipped JavaScript.
    local needle
    for needle in 'io.github.djshiye.Spawn.Dev' 'io.github.djshiye.Spawn.Ui' 'dev-mode' 'Dev D-Bus' 'notify_keyval' \
                  'create_virtual_device' 'runBenchmark' 'EmitOverlayKey' 'Shell.Screenshot'; do
        if grep -rIl --include='*.js' -e "$needle" "$dir" >"$tmp/hits" 2>/dev/null && [ -s "$tmp/hits" ]; then
            echo "FAIL $label: '$needle' found in: $(tr '\n' ' ' <"$tmp/hits")" >&2
            fail=1
        fi
    done
    # The enabling setting must not exist in a packaged schema.
    if grep -rIl -e 'name="dev-mode"' "$dir" 2>/dev/null | grep -q .; then
        echo "FAIL $label: the dev-mode key is in the packaged schema" >&2
        fail=1
    fi
    [ "$fail" = 0 ] && echo "ok   $label: no test hooks"
    return 0
}

check_zip() {
    local zip="$1" dir
    dir="$(mktemp -d "$tmp/zip.XXXXXX")"
    unzip -q "$zip" -d "$dir"
    check_tree "$(basename "$zip")" "$dir"
    if unzip -Z1 "$zip" | grep -E '(^|/)(devHooks|devDbus|devController|benchmark)\.js$' | grep -Ev '^(ui/devHooks|dev/devDbus|dev/devController)\.js$' | grep -q .; then
        echo "FAIL $(basename "$zip"): unexpected dev files in the zip listing" >&2
        fail=1
    fi
}

if [ $# -gt 0 ]; then
    for a in "$@"; do
        if [ -d "$a" ]; then check_tree "$a" "$a"; else check_zip "$a"; fi
    done
else
    tools/build.sh --release --out "$tmp/release" >/dev/null
    uuid="$(node -p "require('./metadata.json').uuid")"
    check_tree "release build tree" "$tmp/release/build"
    check_zip "$tmp/release/dist/${uuid}.shell-extension.zip"

    # The dev build must still have the hooks, or the checks above prove nothing.
    tools/build.sh --out "$tmp/dev" >/dev/null
    for f in ui/devHooks.js dev/benchmark.js dev/devDbus.js dev/devController.js; do
        [ -s "$tmp/dev/build/$f" ] || { echo "FAIL dev build lost $f" >&2; fail=1; }
    done
    grep -q 'io.github.djshiye.Spawn.Dev' "$tmp/dev/build/dev/devDbus.js" || { echo "FAIL dev build has no Dev interface" >&2; fail=1; }
    grep -q 'name="dev-mode"' "$tmp/dev/build/schemas/org.gnome.shell.extensions.spawn.gschema.xml" || { echo "FAIL dev schema lost dev-mode" >&2; fail=1; }

    # The release must also behave: its schema compiles (build.sh did that) and its flavour says so.
    grep -q 'DEV_BUILD = false' "$tmp/release/build/core/flavour.js" || { echo "FAIL release flavour is not DEV_BUILD = false" >&2; fail=1; }
fi

if [ "$fail" -ne 0 ]; then
    echo "RELEASE CHECK FAILED" >&2
    exit 1
fi
echo "release check passed"
