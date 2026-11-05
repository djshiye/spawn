#!/usr/bin/env bash
# Keep the version in step everywhere. package.json "version" is the single source of truth; it is
# mirrored in metadata.json "version-name" (shown by GNOME's Extensions app) and in the Version: line and
# newest %changelog entry of build-aux/spawn.spec (the RPM).
#
#   tools/bump-version.sh --check                 fail unless all of them agree (publish.sh runs this)
#   tools/bump-version.sh 1.1.0 ["changelog text"]  set the new version everywhere and add a spec changelog entry
#
# metadata.json "version" (an integer) is GNOME Shell's extension counter, unused by the RPM, so it is
# deliberately not touched here.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
spec=build-aux/spawn.spec

read_versions() {
    pkg=$(node -p "require('./package.json').version")
    meta=$(node -p "require('./metadata.json')['version-name'] ?? ''")
    specver=$(awk '/^Version:/ {print $2; exit}' "$spec")
    # newest changelog entry: "... - 1.0.0-1"
    changelog=$(awk '/^\* / {sub(/-[^-]*$/, "", $NF); print $NF; exit}' "$spec")
}

case "${1:-}" in
    --check)
        read_versions
        if [ "$pkg" != "$meta" ] || [ "$pkg" != "$specver" ] || [ "$pkg" != "$changelog" ]; then
            echo "Version mismatch (package.json is the source of truth):" >&2
            echo "  package.json                 $pkg" >&2
            echo "  metadata.json version-name   $meta" >&2
            echo "  $spec Version:    $specver" >&2
            echo "  $spec %changelog  $changelog" >&2
            echo "Fix with: tools/bump-version.sh <version>" >&2
            exit 1
        fi
        echo "version $pkg"
        ;;
    "")
        echo "usage: $0 --check | <version> [changelog text]" >&2
        exit 2
        ;;
    *)
        new=$1
        text=${2:-"Update to $new"}
        if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "version must look like 1.2.3" >&2
            exit 2
        fi
        npm version "$new" --no-git-tag-version --allow-same-version >/dev/null
        node -e '
            const fs = require("fs");
            const text = fs.readFileSync("metadata.json", "utf8");
            const out = /"version-name"/.test(text)
                ? text.replace(/("version-name":\s*")[^"]*(")/, `$1${process.argv[1]}$2`)
                : text.replace(/\n}\s*$/, `,\n  "version-name": "${process.argv[1]}"\n}\n`);
            fs.writeFileSync("metadata.json", out);
        ' "$new"
        sed -i "s/^Version:.*/Version:        $new/" "$spec"
        # a new changelog entry unless the newest one is already for this version
        read_versions
        if [ "$changelog" != "$new" ]; then
            entry="* $(LC_ALL=C date '+%a %b %d %Y') Dino Klisura <115914552+djshiye@users.noreply.github.com> - $new-1"
            awk -v entry="$entry" -v text="- $text" '
                /^%changelog/ && !done { print; print entry; print text; print ""; done = 1; next }
                { print }' "$spec" > "$spec.new"
            mv "$spec.new" "$spec"
        fi
        "$0" --check
        ;;
esac
