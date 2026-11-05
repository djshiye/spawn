#!/usr/bin/env bash
# Run the headless GNOME Shell harness (tools/dev-shell.sh) or the prefs check (tools/dev-prefs.sh)
# against the GNOME Shell of another Fedora release, in a rootless podman container.
#
# Usage: tools/dev-shell-container.sh <fedora-release> <scenario|all|prefs> [flags passed through]
#   fedora-release   43 (GNOME 49), 44 (GNOME 50) or 45 (GNOME 51, the control: should behave like the host)
#   scenario         anything tools/dev-shell.sh accepts (smoke, ui-list, button-menu, all, ...); flags such as
#                    --with-dtp / --seed are passed through.
#   prefs            runs tools/dev-prefs.sh instead; the remaining arguments are its (page numbers, --tall, ...).
#
# Environment:
#   SPAWN_CONTAINER_REBUILD=1    rebuild the cached image spawn-dev:f<release> (otherwise it is built once and reused)
#   SPAWN_CONTAINER_NO_THEME=1   do not mount the host's Orchis theme / user-theme extension (the seeded runs use
#                                them when present, exactly like the host harness does)
#
# How it works:
#   - the extension is built on the HOST (tools/build.sh, same staleness rule as dev-shell.sh) and the repo is
#     mounted read-write at /work; the container runs tools/dev-shell.sh with SPAWN_NO_BUILD=1;
#   - state and logs go to .dev/f<release>/ (prefs: .dev/prefs-f<release>/), so releases and the host's .dev/ never
#     clobber each other;
#   - the image (tools/container/Containerfile) carries a gschema override that sets
#     org.gnome.shell disable-extension-version-validation, so metadata.json (shell-version ["51"]) is NOT edited
#     and Spawn / Dash to Panel / user-theme load on every release;
#   - --with-dtp mounts the host's Dash to Panel read-only where the harness looks for it ($HOME/.local/share/...);
#   - the seeded scenarios pin apps from the host (seed.ini); the container has none of them, so .desktop stubs
#     (copies of the host's files when found, else generated) are put in .dev/f<release>/stub-apps and added to
#     XDG_DATA_DIRS;
#   - software rendering only (llvmpipe): no --privileged, no /dev/dri.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rel="${1:-}"
scenario="${2:-}"
if [ -z "$rel" ] || [ -z "$scenario" ] || ! [[ "$rel" =~ ^[0-9]+$ ]]; then
    echo "usage: $0 <fedora-release> <scenario|all|prefs> [flags...]" >&2
    exit 2
fi
shift 2
image="spawn-dev:f$rel"
dev_rel=".dev/f$rel"
dev="$root/$dev_rel"
mkdir -p "$dev"

# ---- image (cached per release)
if [ "${SPAWN_CONTAINER_REBUILD:-0}" = 1 ] || ! podman image exists "$image"; then
    echo "dev-shell-container: building $image" >&2
    podman build -q --build-arg "RELEASE=$rel" -t "$image" "$root/tools/container" >/dev/null
fi

# ---- build on the host (prefs builds its own copy inside the container)
if [ "$scenario" != prefs ]; then
    stamp="$root/build/.built"
    if [ ! -f "$stamp" ] || [ -n "$(find "$root/src" "$root/schemas" "$root/data" "$root/stylesheet.css" \
            "$root/metadata.json" "$root/tsconfig.json" -newer "$stamp" -print -quit)" ]; then
        echo "dev-shell-container: build/ is missing or stale, running tools/build.sh" >&2
        "$root/tools/build.sh" >&2
    fi
fi

# ---- .desktop stubs for the apps tools/dev/seed.ini pins
stubs="$dev/stub-apps/applications"
mkdir -p "$stubs"
host_apps=("$HOME/.local/share/applications" /usr/share/applications /var/lib/flatpak/exports/share/applications
    "$HOME/.local/share/flatpak/exports/share/applications")
for id in $(grep -oE '[A-Za-z0-9._-]+\.desktop' "$root/tools/dev/seed.ini" | sort -u); do
    [ -f "$stubs/$id" ] && continue
    found=""
    for d in "${host_apps[@]}"; do
        [ -f "$d/$id" ] && { found="$d/$id"; break; }
    done
    if [ -n "$found" ]; then
        cp "$found" "$stubs/$id"
    else
        printf '[Desktop Entry]\nType=Application\nName=%s\nExec=true\nIcon=application-x-executable\n' "${id%.desktop}" >"$stubs/$id"
    fi
done

# ---- mounts
mounts=(-v "$root:/work")
ext="$HOME/.local/share/gnome-shell/extensions"
cext="/home/dev/.local/share/gnome-shell/extensions"
if [ -d "$ext/dash-to-panel@jderose9.github.com" ]; then
    mounts+=(-v "$ext/dash-to-panel@jderose9.github.com:$cext/dash-to-panel@jderose9.github.com:ro")
fi
if [ "${SPAWN_CONTAINER_NO_THEME:-0}" != 1 ] && [ -d "$HOME/.themes/Orchis-Dark-Compact" ] &&
    [ -d "$ext/user-theme@gnome-shell-extensions.gcampax.github.com" ]; then
    mounts+=(-v "$HOME/.themes/Orchis-Dark-Compact:/home/dev/.themes/Orchis-Dark-Compact:ro"
        -v "$ext/user-theme@gnome-shell-extensions.gcampax.github.com:$cext/user-theme@gnome-shell-extensions.gcampax.github.com:ro")
fi

if [ "$scenario" = prefs ]; then
    cmd=(tools/dev-prefs.sh "$@")
    run_dev="/work/.dev/prefs-f$rel"
    mkdir -p "$root/.dev"
else
    cmd=(tools/dev-shell.sh "$scenario" "$@")
    run_dev="/work/$dev_rel"
fi

# --userns=keep-id: files written to the mounted repo belong to you. label=disable instead of :Z, which
# would relabel the whole worktree on the host.
exec podman run --rm --userns=keep-id --security-opt label=disable --shm-size=1g \
    -w /work "${mounts[@]}" \
    -e HOME=/home/dev -e SPAWN_NO_BUILD=1 -e "SPAWN_DEV_DIR=$run_dev" \
    -e "XDG_DATA_DIRS=/work/$dev_rel/stub-apps:/usr/local/share:/usr/share" \
    "$image" tools/container/entrypoint.sh "${cmd[@]}"
