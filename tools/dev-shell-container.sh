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
#   SPAWN_CONTAINER_BUILD=<dir>  run this build output (a complete build/ tree, mounted read-only over /work/build)
#                                instead of the repo's build/, e.g. a hand-patched copy for an experiment
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
#   - the scenarios depend on the host's installed apps (seed.ini pins them), so copies of the host's .desktop files
#     are mounted read-only as /usr/local/share/applications (the scenarios look there too);
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
dev_rel=".dev/f$rel${SPAWN_CONTAINER_BUILD:+-patched}"
dev="$root/$dev_rel"
mkdir -p "$dev"

# ---- image (cached per release)
if [ "${SPAWN_CONTAINER_REBUILD:-0}" = 1 ] || ! podman image exists "$image"; then
    echo "dev-shell-container: building $image" >&2
    podman build -q --build-arg "RELEASE=$rel" -t "$image" "$root/tools/container" >/dev/null
fi

# ---- build on the host (prefs builds its own copy inside the container)
if [ "$scenario" != prefs ] && [ -z "${SPAWN_CONTAINER_BUILD:-}" ]; then
    stamp="$root/build/.built"
    if [ ! -f "$stamp" ] || [ -n "$(find "$root/src" "$root/schemas" "$root/data" "$root/stylesheet.css" \
            "$root/metadata.json" "$root/tsconfig.json" -newer "$stamp" -print -quit)" ]; then
        echo "dev-shell-container: build/ is missing or stale, running tools/build.sh" >&2
        "$root/tools/build.sh" >&2
    fi
fi

# ---- the host's installed applications
# The host harness sees the system's application dirs (its own XDG_DATA_HOME is replaced by the sandbox), and
# seed.ini / the scenarios depend on them (pinned apps, Frequent, generic names, folders). Copy exactly those
# .desktop files (not ~/.local/share/applications, which the host harness does not see either); earlier dirs win,
# like in XDG_DATA_DIRS. They are only metadata, nothing launches them. TryExec lines are dropped and the Exec
# program is replaced by /usr/bin/true, because GIO rejects an entry whose program is missing (the programs are
# not installed in the container).
stubs="$dev/stub-apps/applications"
rm -rf "$dev/stub-apps"
mkdir -p "$stubs"
IFS=: read -r -a host_dirs <<<"${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
for d in "${host_dirs[@]}"; do
    [ -d "$d/applications" ] || continue
    for f in "$d"/applications/*.desktop; do
        [ -f "$f" ] && [ ! -e "$stubs/$(basename "$f")" ] && sed -e '/^TryExec=/d' -e 's|^Exec=[^ ]*|Exec=/usr/bin/true|' "$f" >"$stubs/$(basename "$f")"
    done
done

# ---- mounts
mounts=(-v "$root:/work" -v "$stubs:/usr/local/share/applications:ro")
[ -n "${SPAWN_CONTAINER_BUILD:-}" ] && mounts+=(-v "$(realpath "$SPAWN_CONTAINER_BUILD"):/work/build:ro")
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
# --network none: nothing here needs the network, and on 49 / 50 the shell's extension updater would otherwise
# download "updates" of the host's user-theme from extensions.gnome.org into the sandbox copy and break it.
exec podman run --rm --userns=keep-id --security-opt label=disable --network none --shm-size=1g \
    -w /work "${mounts[@]}" \
    -e HOME=/home/dev -e SPAWN_NO_BUILD=1 -e "SPAWN_DEV_DIR=$run_dev" \
    "$image" tools/container/entrypoint.sh "${cmd[@]}"
