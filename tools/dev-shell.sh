#!/usr/bin/env bash
# Headless GNOME Shell sandbox for testing the extension WITHOUT touching the real session.
#
# Usage: tools/dev-shell.sh <scenario> [--with-dtp] [--seed]
#   scenarios:
#     smoke        enable, wait 5 s, screenshot (.dev/shots/smoke.png), open the menu and
#                  screenshot again (smoke-open.png), print extension state
#     dtp-toggle   with --with-dtp: toggle Dash to Panel off/on 10x, verify our button is
#                  still attached, screenshot (dtp-toggle.png)
#     hotkeys      Super handler blocked/unblocked in memory (setting on/off, re-enable), accelerator bind
#     theme        generated stylesheet written/regenerated/removed under $XDG_RUNTIME_DIR/spawn
#     lifecycle    enable -> open -> search -> close -> disable -> enable; works with or without
#                  --with-dtp
#     isolation    only verify that dconf writes land in .dev/ and not in the real profile
#     ui           every tools/dev/scenarios/ui-*.sh in ONE shell session (open/close 20x, keyboard
#                  navigation, drag & drop, context menu, folder rename, search, ...), seeded
#     ui-<name>    a single ui scenario
#     dtp-open     with --with-dtp, seeded: open the menu on Dash to Panel's bottom panel; the
#                  popup must open upward (arrow side BOTTOM); screenshot
#     button-menu  seeded: the panel button context menu (right click / Menu key / Shift+F10, items, Power Options,
#                  Show Desktop toggle, mutual exclusion with the Spawn popup; with --with-dtp also Panel Extension Settings)
#     runner       seeded: the standalone runner (D-Bus ToggleRunner and the runner-hotkey accelerator, typing,
#                  Return launches a probe app, Escape / outside click / main menu close it, disable while open); screenshot
#     shots        seeded: the review screenshots into .dev/shots/final/
#     bench        seeded: in-shell benchmark (Dev.Benchmark) -> table, raw JSON in .dev/bench.json
#     all          smoke, lifecycle, hotkeys, theme, dtp-toggle (with DtP), dtp-open (with DtP),
#                  ui, runner, shots, bench; each in its own fresh shell; prints a summary and exits
#                  non-zero if any scenario failed or logged a spawn error
#     <other>      any tools/dev/scenarios/<name>.sh is run as a scenario
#   --seed       load tools/dev/seed.ini (the user's pinned apps, 3 folders, shortcuts, Orchis theme
#                when installed) into the sandbox; implied by ui*, dtp-open, shots and bench
#
# Per-scenario shell logs are kept in .dev/logs/<scenario>.log.
#
# Isolation: ALL XDG dirs are exported here, in the OUTER script, before dbus-run-session
# starts its private bus daemon, because dconf-service is activated by that daemon and
# inherits ITS environment (not the inner script's).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev="${SPAWN_DEV_DIR:-$root/.dev}"; case "$dev" in "$root"/.dev*) ;; *) echo "SPAWN_DEV_DIR must be under $root/.dev" >&2; exit 2 ;; esac; mkdir -p "$dev"

scenario="${1:-smoke}"
shift || true
with_dtp=0
seed=0
for arg in "$@"; do
    case "$arg" in
        --with-dtp) with_dtp=1 ;;
        --seed) seed=1 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

case "$scenario" in
    dtp-toggle | dtp-open)
        if [ "$with_dtp" -ne 1 ]; then
            echo "$scenario needs --with-dtp" >&2
            exit 2
        fi
        ;;
esac
case "$scenario" in ui | ui-* | dtp-open | shots | bench | button-menu | runner) seed=1 ;; esac

if [ "$scenario" = "all" ]; then
    # Each scenario runs in its own fresh isolated shell (this script, recursively).
    mkdir -p "$dev/logs"
    runs=("smoke" "lifecycle" "hotkeys" "theme" "dtp-toggle --with-dtp" "dtp-open --with-dtp" "ui" "runner" "shots" "bench")
    summary=()
    failed=0
    for run in "${runs[@]}"; do
        name="${run%% *}"
        [ "$run" != "$name" ] && name="$name+dtp"
        echo "######## $name"
        start=$SECONDS
        # shellcheck disable=SC2086
        if SPAWN_LOG_NAME="$name" "$0" $run >"$dev/logs/$name.out" 2>&1; then
            res=PASS
        else
            res=FAIL
            failed=1
        fi
        summary+=("$(printf '%-12s %-5s %4ss   %s' "$name" "$res" "$((SECONDS - start))" "$dev/logs/$name.out")")
        grep -E '^(ok |FAIL|RESULT)' "$dev/logs/$name.out" | grep -E '^FAIL|^RESULT' || true
        echo "$res $name"
    done
    echo
    echo "==== summary"
    printf '%s\n' "${summary[@]}"
    [ "$failed" = 0 ] && echo "ALL SCENARIOS PASSED" || echo "SOME SCENARIOS FAILED"
    exit "$failed"
fi

# Remember the real profile locations before overriding anything.
export SPAWN_REAL_HOME="$HOME"
export SPAWN_REAL_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export SPAWN_REAL_DCONF="${XDG_CONFIG_HOME:-$HOME/.config}/dconf/user"

rm -rf "$dev/config" "$dev/cache" "$dev/runtime" "$dev/data"
mkdir -p "$dev/config" "$dev/data" "$dev/cache" "$dev/runtime" "$dev/shots" "$dev/ux"
chmod 700 "$dev/runtime"

export XDG_CONFIG_HOME="$dev/config"
export XDG_DATA_HOME="$dev/data"
export XDG_CACHE_HOME="$dev/cache"
export XDG_RUNTIME_DIR="$dev/runtime"
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS
export SPAWN_DEV="$dev"
export SPAWN_ROOT="$root"
export SPAWN_SCENARIO="$scenario"
export SPAWN_WITH_DTP="$with_dtp"
export SPAWN_SEED="$seed"

exec dbus-run-session -- "$root/tools/dev-shell-inner.sh"
