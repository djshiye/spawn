#!/usr/bin/env bash
# Build the extension into build/ and pack dist/<uuid>.shell-extension.zip.
#
#   tools/build.sh             DEV build: what the headless sandbox (tools/dev-shell.sh), CI smoke tests and the
#                              unit tests use. Contains the test hooks (Dev D-Bus interface, Ui hooks, benchmark).
#   tools/build.sh --release   RELEASE build: what is shipped (the extension zip and the RPM). The test hooks are
#                              not compiled in at all: the dev files are swapped for the stubs in
#                              build-aux/release-stubs/ before compiling (so no hook code reaches build/), and
#                              the `dev-mode` key is dropped from the packaged schema. tools/check-release.sh
#                              verifies the result.
#   --out DIR                  write DIR/build and DIR/dist instead of build/ and dist/ (used by the checks, so
#                              they never touch the build/ the unit tests and the sandbox use)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

release=0
out="$root"
while [ $# -gt 0 ]; do
    case "$1" in
        --release) release=1 ;;
        --out) shift; out="$(mkdir -p "$1" && cd "$1" && pwd)" ;;
        *) echo "usage: $0 [--release] [--out DIR]" >&2; exit 2 ;;
    esac
    shift
done

uuid="$(node -p "require('./metadata.json').uuid")"
build="$out/build"
dist="$out/dist"

rm -rf "$build"
mkdir -p "$build" "$dist"

if [ "$release" = 1 ]; then
    # Compile a copy of src/ in which every dev-only file is replaced by its release stub (same exports, no
    # hooks). It sits inside the repository so TypeScript finds node_modules and the shell typings.
    stage="$(mktemp -d "$root/.stage.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    cp -r src "$stage/src"
    rm -f "$stage/src/dev/benchmark.ts"
    (cd build-aux/release-stubs && find src -type f -name '*.ts') | while IFS= read -r f; do
        cp "build-aux/release-stubs/$f" "$stage/$f"
    done
    cat >"$stage/tsconfig.json" <<EOF
{"extends": "$root/tsconfig.json", "compilerOptions": {"rootDir": "src", "outDir": "$build"}, "include": ["src/**/*.ts"]}
EOF
    npx tsc -p "$stage/tsconfig.json"
else
    npx tsc -p tsconfig.json --outDir "$build"
fi

cp metadata.json stylesheet.css "$build/"
mkdir -p "$build/schemas"
cp schemas/*.gschema.xml "$build/schemas/"
if [ "$release" = 1 ]; then
    # No `dev-mode` key in a release: nothing reads it there, and it must not even exist to be set.
    sed -i '/<key name="dev-mode"/,/<\/key>/d' "$build"/schemas/*.gschema.xml
fi
glib-compile-schemas --strict "$build/schemas"
cp -r data "$build/data"

rm -f "$dist/${uuid}.shell-extension.zip"
(cd "$build" && zip -qr "$dist/${uuid}.shell-extension.zip" . -x '*.d.ts')

# Stamp for tools/dev-shell.sh, which rebuilds when any source is newer than this.
touch "$build/.built"

if [ "$release" = 1 ]; then
    echo "built RELEASE ${build#"$root/"} and ${dist#"$root/"}/${uuid}.shell-extension.zip"
else
    echo "built ${build#"$root/"} and ${dist#"$root/"}/${uuid}.shell-extension.zip"
fi
