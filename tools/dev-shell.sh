#!/usr/bin/env bash
# Headless GNOME Shell sandbox for testing the extension WITHOUT touching the real session.
#
# Usage: tools/dev-shell.sh <scenario> [--with-dtp]
#   scenarios:
#     smoke        enable, wait 5 s, screenshot (.dev/shots/smoke.png), open the menu and
#                  screenshot again (smoke-open.png), print extension state
#     dtp-toggle   with --with-dtp: toggle Dash to Panel off/on 10x, verify our button is
#                  still attached, screenshot (dtp-toggle.png)
#     lifecycle    enable -> open -> search -> close -> disable -> enable; works with or without
#                  --with-dtp
#     isolation    only verify that dconf writes land in .dev/ and not in the real profile
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
for arg in "$@"; do
    case "$arg" in
        --with-dtp) with_dtp=1 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

if [ "$scenario" = "dtp-toggle" ] && [ "$with_dtp" -ne 1 ]; then
    echo "dtp-toggle needs --with-dtp" >&2
    exit 2
fi

# Remember the real profile locations before overriding anything.
export SPAWN_REAL_HOME="$HOME"
export SPAWN_REAL_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export SPAWN_REAL_DCONF="${XDG_CONFIG_HOME:-$HOME/.config}/dconf/user"

rm -rf "$dev/config" "$dev/cache" "$dev/runtime" "$dev/data"
mkdir -p "$dev/config" "$dev/data" "$dev/cache" "$dev/runtime" "$dev/shots"
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

exec dbus-run-session -- "$root/tools/dev-shell-inner.sh"
