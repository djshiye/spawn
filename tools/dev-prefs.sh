#!/usr/bin/env bash
# Opens the Spawn preferences window inside an ISOLATED headless GNOME Shell (same isolation
# as tools/dev-shell.sh: every XDG dir lives under .dev/) and screenshots each page.
#
# Usage: tools/dev-prefs.sh [--no-arcmenu] [pages...]
#   pages        page indices to capture (default: 0 1 2 3 4 5 6 = General..About)
#   --tall       use a 1600x2600 virtual monitor and stretch the prefs window to nearly full
#                height, so whole pages fit in one screenshot
#   --apply-import  run the real migration against the sandbox dconf (tools/dev-prefs-import.js), check that
#                Reset / Undo / Import leave the settings writable (tools/dev-prefs-reset.js), and print the resulting spawn dconf dump before opening the prefs
#   --dialogs    also screenshot the standalone dialogs (icon picker, app list, folder editor,
#                shortcut capture, rename prompt, preset manager) as dialog-<name>.png
#   --no-arcmenu do not load docs/research/user-arcmenu-settings.ini into the sandbox dconf
#
# It builds privately into .dev/prefs/build (so it never clobbers or depends on build/), loads
# the user's ArcMenu fixture into the SANDBOX dconf, and writes shots to .dev/prefs/shots/.
# Prefs errors end up in .dev/prefs/prefs.log (grep for JS ERROR / Gjs-CRITICAL).
set -euo pipefail
[ -n "${SPAWN_TRACE:-}" ] && set -x

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev="$(realpath -m "${SPAWN_DEV_DIR:-$root/.dev/prefs}")" # resolves '..', so the check below cannot be bypassed
case "$dev" in "$root"/.dev/*) ;; *) echo "SPAWN_DEV_DIR must be under $root/.dev/" >&2; exit 2 ;; esac

if [ "${1:-}" != "--inner" ]; then
    load_arc=1
    tall=0
    apply_import=0
    dialogs=0
    pages=()
    for arg in "$@"; do
        case "$arg" in
            --no-arcmenu) load_arc=0 ;;
            --tall) tall=1 ;;
            --dialogs) dialogs=1 ;;
            --apply-import) apply_import=1 ;;
            [0-9]*) pages+=("$arg") ;;
            *) echo "unknown argument: $arg" >&2; exit 2 ;;
        esac
    done
    [ ${#pages[@]} -eq 0 ] && pages=(0 1 2 3 4 5 6)

    mkdir -p "$dev"
    rm -rf "$dev/config" "$dev/cache" "$dev/runtime" "$dev/data" "$dev/shots" "$dev/build"
    mkdir -p "$dev/config" "$dev/data" "$dev/cache" "$dev/runtime" "$dev/shots" "$dev/build"
    chmod 700 "$dev/runtime"

    # Private build (tsc errors in other modules must not stop the prefs check).
    (cd "$root" && npx tsc -p tsconfig.json --outDir "$dev/build" >"$dev/tsc.log" 2>&1) || echo "tsc reported errors (see $dev/tsc.log); continuing"
    cp "$root/metadata.json" "$root/stylesheet.css" "$dev/build/"
    mkdir -p "$dev/build/schemas"
    cp "$root"/schemas/*.gschema.xml "$dev/build/schemas/"
    glib-compile-schemas --strict "$dev/build/schemas"
    cp -r "$root/data" "$dev/build/data"

    export SPAWN_REAL_DCONF="${XDG_CONFIG_HOME:-$HOME/.config}/dconf/user"
    export XDG_CONFIG_HOME="$dev/config"
    export XDG_DATA_HOME="$dev/data"
    export XDG_CACHE_HOME="$dev/cache"
    export XDG_RUNTIME_DIR="$dev/runtime"
    unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS
    export SPAWN_DEV="$dev" SPAWN_ROOT="$root" SPAWN_LOAD_ARC="$load_arc" SPAWN_TALL="$tall" SPAWN_APPLY_IMPORT="$apply_import" SPAWN_DIALOGS="$dialogs" SPAWN_PAGES="${pages[*]}"
    rc=0
    dbus-run-session -- "$root/tools/dev-prefs.sh" --inner 2>&1 | tee "$dev/run.log" || rc=$?
    # The prefs process logs to the session bus' stderr, which lands in run.log.
    if grep -E 'JS ERROR|Failed to open preferences|TypeError|ReferenceError|SyntaxError|Gjs-CRITICAL' "$dev/run.log" >"$dev/errors.log"; then
        echo "RESULT: errors found in the prefs run (see $dev/errors.log):"
        cut -c1-300 "$dev/errors.log" | head -20
        exit 1
    fi
    echo "RESULT: no JS errors in the prefs run (exit $rc)"
    exit "$rc"
fi

# ---------------------------------------------------------------- inner (isolated bus)
: "${SPAWN_DEV:?run tools/dev-prefs.sh instead}"
dev="$SPAWN_DEV"
root="$SPAWN_ROOT"
for v in XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR; do
    case "${!v}" in "$dev"/*) ;; *) echo "refusing to run: $v=${!v} is outside $dev" >&2; exit 3 ;; esac
done
uuid="$(node -p "require('$root/metadata.json').uuid")"
log="$dev/shell.log"
plog="$dev/prefs.log"
shots="$dev/shots"
status=0
gshell_pid=""

dbus-update-activation-environment XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR

cleanup() {
    if [ -n "$gshell_pid" ]; then
        kill "$gshell_pid" 2>/dev/null || true
        sleep 1
        kill -9 "$gshell_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT

mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions"
cp -r "$dev/build" "$XDG_DATA_HOME/gnome-shell/extensions/$uuid"

dconf write /org/gnome/shell/enabled-extensions "['$uuid']"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/welcome-dialog-last-shown-version "'999'"
dconf write /org/gnome/shell/extensions/spawn/dev-mode true
if [ "$SPAWN_LOAD_ARC" = 1 ]; then
    dconf load /org/gnome/shell/extensions/arcmenu/ <"$root/docs/research/user-arcmenu-settings.ini"
fi
if [ ! -f "$dev/config/dconf/user" ]; then
    echo "dconf did not write into the sandbox; aborting" >&2
    exit 3
fi

vmon=1600x900
[ "$SPAWN_TALL" = 1 ] && vmon=1600x2600
gnome-shell --headless --wayland --virtual-monitor "$vmon" --no-x11 --unsafe-mode >"$log" 2>&1 &
gshell_pid=$!
for ((i = 0; i < 60; i++)); do
    kill -0 "$gshell_pid" 2>/dev/null || { echo "gnome-shell exited early"; exit 1; }
    gdbus call --session --timeout 2 --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1 && break
    sleep 0.5
done
echo "org.gnome.Shell is on the bus"
for ((i = 0; i < 40; i++)); do
    gnome-extensions info "$uuid" 2>/dev/null | grep -q 'State: *ACTIVE' && break
    sleep 0.5
done

# The prefs service is D-Bus activated: it must find the headless compositor's socket.
export WAYLAND_DISPLAY=wayland-0
dbus-update-activation-environment WAYLAND_DISPLAY
export GSK_RENDERER="${GSK_RENDERER:-cairo}"
dbus-update-activation-environment GSK_RENDERER

prefs_pid() {
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.GetConnectionUnixProcessID org.gnome.Shell.Extensions 2>/dev/null |
        sed -nE 's/^\(uint32 ([0-9]+),\)$/\1/p'
}

if [ "$SPAWN_APPLY_IMPORT" = 1 ]; then
    gjs -m "$root/tools/dev-prefs-import.js" "$dev/build" 2>&1 | grep -v 'a11y'
    echo "---- Reset / Undo / Import must leave the prefs settings writable (separate-process dconf read) ----"
    gjs -m "$root/tools/dev-prefs-reset.js" "$dev/build" 2>&1 | grep -v 'a11y' || status=1
    echo "---- DisableExtension on the sandbox shell (ArcMenu is not installed there: expect (false,)) ----"
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Extensions.DisableExtension 'arcmenu@arcmenu.com' 2>&1 | head -3
    echo "---- sandbox dconf dump: /org/gnome/shell/extensions/spawn/ ----"
    dconf dump /org/gnome/shell/extensions/spawn/ | cut -c1-200
fi

for page in $SPAWN_PAGES; do
    dconf write /org/gnome/shell/extensions/spawn/prefs-visible-page "$page"
    gnome-extensions prefs "$uuid" >>"$plog" 2>&1 || true
    sleep 3
    # Leave the startup overview so the window is shown at its real size (needs --unsafe-mode).
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval 'Main.overview.hide()' >/dev/null 2>&1 || true
    if [ "$SPAWN_TALL" = 1 ]; then
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
            "global.get_window_actors().map(a => a.meta_window).filter(w => w.get_title() === 'Spawn').forEach(w => w.move_resize_frame(false, 320, 40, 960, 2500))" >/dev/null 2>&1 || true
    fi
    sleep 2
    f="$shots/page-$page.png"
    gdbus call --session --dest io.github.djshiye.Spawn --object-path /io/github/djshiye/Spawn \
        --method io.github.djshiye.Spawn.Dev.Screenshot "$f" >/dev/null 2>&1 || true
    if [ -s "$f" ]; then echo "screenshot: $f"; else echo "screenshot FAILED: $f"; status=1; fi
    pid="$(prefs_pid || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    sleep 1.5
done

if [ "$SPAWN_DIALOGS" = 1 ]; then
    # extensionDir for these standalone runs is the private build dir (it contains data/icons).
    for d in icons apps folder shortcut prompt presets; do
        gjs -m "$root/tools/dev-prefs-dialog.js" "$dev/build" "$d" >>"$plog" 2>&1 &
        dpid=$!
        sleep 4
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval 'Main.overview.hide()' >/dev/null 2>&1 || true
        sleep 1
        f="$shots/dialog-$d.png"
        gdbus call --session --dest io.github.djshiye.Spawn --object-path /io/github/djshiye/Spawn \
            --method io.github.djshiye.Spawn.Dev.Screenshot "$f" >/dev/null 2>&1 || true
        if [ -s "$f" ]; then echo "screenshot: $f"; else echo "screenshot FAILED: $f"; status=1; fi
        kill "$dpid" 2>/dev/null || true
        wait "$dpid" 2>/dev/null || true
    done
fi

echo "---- shell log (prefs related) ----"
grep -E 'JS ERROR|spawn|Gjs-CRITICAL|prefs' "$log" | head -40 || true
echo "---- prefs log ----"
cat "$plog" 2>/dev/null | head -60 || true
exit "$status"
