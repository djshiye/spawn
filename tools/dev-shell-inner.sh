#!/usr/bin/env bash
# Runs INSIDE the isolated dbus-run-session started by tools/dev-shell.sh. Do not run directly.
set -uo pipefail

: "${SPAWN_DEV:?run tools/dev-shell.sh instead}"
root="$SPAWN_ROOT"
dev="$SPAWN_DEV"
scenario="$SPAWN_SCENARIO"
with_dtp="$SPAWN_WITH_DTP"
log="$dev/shell.log"
shots="$dev/shots"

uuid="$(node -p "require('$root/metadata.json').uuid")"
dtp_uuid="dash-to-panel@jderose9.github.com"
dest="io.github.djshiye.SpawnMenu"
path="/io/github/djshiye/SpawnMenu"

dbus-update-activation-environment XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR

# Hard guard: refuse to continue unless every XDG dir points inside .dev/.
for v in XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR; do
    case "${!v}" in
        "$dev"/*) ;;
        *) echo "refusing to run: $v=${!v} is outside $dev" >&2; exit 3 ;;
    esac
done

gshell_pid=""
status=0

cleanup() {
    if [ -n "$gshell_pid" ] && kill -0 "$gshell_pid" 2>/dev/null; then
        kill "$gshell_pid" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 "$gshell_pid" 2>/dev/null || break
            sleep 0.5
        done
        kill -9 "$gshell_pid" 2>/dev/null
    fi
    if [ -f "$log" ]; then
        echo
        echo "---- shell log (filtered: spawn-menu | JS ERROR | Extension | TypeError) ----"
        grep -E 'spawn-menu|JS ERROR|Extension|TypeError' "$log" || echo "(no matching lines)"
        echo "---- end of log (full log: $log) ----"
    fi
}
trap cleanup EXIT

ext_state() {
    # Prints the "State:" line of `gnome-extensions info`.
    gnome-extensions info "$1" 2>&1 | grep -E 'State:|Error' || echo "State: (unknown)"
}

is_active() {
    gnome-extensions info "$1" 2>/dev/null | grep -q 'State: *ACTIVE'
}

wait_active() { # uuid, timeout seconds
    local i
    for ((i = 0; i < $2 * 2; i++)); do
        is_active "$1" && return 0
        sleep 0.5
    done
    return 1
}

dev_call() { # method [args...]
    local m="$1"
    shift
    gdbus call --session --dest "$dest" --object-path "$path" --method "io.github.djshiye.SpawnMenu.Dev.$m" "$@" 2>&1
}

screenshot() { # name
    local f="$shots/$1.png"
    rm -f "$f"
    dev_call Screenshot "$f" >/dev/null && [ -s "$f" ] && echo "screenshot: $f" || { echo "screenshot FAILED: $f"; status=1; }
}

attachment_status() {
    dev_call AttachmentStatus | sed -E "s/^\('(.*)',\)$/\1/"
}

# ---------------------------------------------------------------- isolation check
if [ "$scenario" = "isolation" ]; then
    before="$(stat -c '%Y %s' "$SPAWN_REAL_DCONF" 2>/dev/null || echo none)"
    dconf write /spawn-menu-isolation-test/x 1
    sleep 1
    dump="$(dconf dump /)"
    after="$(stat -c '%Y %s' "$SPAWN_REAL_DCONF" 2>/dev/null || echo none)"
    echo "dconf dump inside the sandbox:"
    echo "$dump"
    echo "real dconf db: before=[$before] after=[$after]"
    if [ "$before" = "$after" ] && [ -f "$dev/config/dconf/user" ] && echo "$dump" | grep -q 'spawn-menu-isolation-test'; then
        echo "ISOLATION OK"
        exit 0
    fi
    echo "ISOLATION FAILED"
    exit 1
fi

# ---------------------------------------------------------------- install
ext_dir="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$ext_dir"
if [ ! -f "$root/build/metadata.json" ]; then
    echo "build/ missing; run tools/build.sh first" >&2
    exit 1
fi
cp -r "$root/build" "$ext_dir/$uuid"
if [ "$with_dtp" = 1 ]; then
    src="$SPAWN_REAL_DATA_HOME/gnome-shell/extensions/$dtp_uuid"
    if [ ! -d "$src" ]; then
        echo "Dash to Panel not found at $src" >&2
        exit 1
    fi
    cp -r "$src" "$ext_dir/$dtp_uuid"
fi

# ---------------------------------------------------------------- seed the ISOLATED dconf
enabled="['$uuid'"
[ "$with_dtp" = 1 ] && enabled="$enabled, '$dtp_uuid'"
enabled="$enabled]"
dconf write /org/gnome/shell/enabled-extensions "$enabled"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/welcome-dialog-last-shown-version "'999'"
dconf write /org/gnome/shell/extensions/spawn-menu/dev-mode true

# Fail-safe: the seed must be visible in the sandbox db, not the real one.
if [ ! -f "$dev/config/dconf/user" ]; then
    echo "dconf did not write into the sandbox ($dev/config/dconf/user missing); aborting" >&2
    exit 3
fi

# ---------------------------------------------------------------- start the shell
gnome-shell --headless --wayland --virtual-monitor 1600x900 --no-x11 >"$log" 2>&1 &
gshell_pid=$!

for ((i = 0; i < 60; i++)); do
    if ! kill -0 "$gshell_pid" 2>/dev/null; then
        echo "gnome-shell exited early"
        status=1
        break
    fi
    if gdbus call --session --timeout 2 --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

if ! kill -0 "$gshell_pid" 2>/dev/null; then
    exit 1
fi
echo "org.gnome.Shell is on the bus"

if ! wait_active "$uuid" 30; then
    echo "$uuid did not become ACTIVE"
    status=1
fi

# ---------------------------------------------------------------- scenarios
case "$scenario" in
smoke)
    sleep 5
    echo "extension state:"
    gnome-extensions info "$uuid" 2>&1 | sed 's/^/  /'
    echo "attachments: $(attachment_status)"
    screenshot smoke
    dev_call Open >/dev/null
    sleep 1
    screenshot smoke-open
    dev_call Close >/dev/null
    ;;
dtp-toggle)
    if ! wait_active "$dtp_uuid" 30; then
        echo "Dash to Panel did not become ACTIVE in the headless shell (not our bug):"
        ext_state "$dtp_uuid"
        status=1
    else
        sleep 3
        echo "before toggling: $(attachment_status)"
        for i in $(seq 1 10); do
            gnome-extensions disable "$dtp_uuid" >/dev/null 2>&1
            sleep 0.4
            gnome-extensions enable "$dtp_uuid" >/dev/null 2>&1
            sleep 0.8
            echo "toggle $i: dtp=$(ext_state "$dtp_uuid" | head -1 | tr -s ' ') attachments=$(attachment_status)"
        done
        echo "rapid phase: 10 back-to-back toggles"
        for i in $(seq 1 10); do
            gnome-extensions disable "$dtp_uuid" >/dev/null 2>&1
            gnome-extensions enable "$dtp_uuid" >/dev/null 2>&1
        done
        wait_active "$dtp_uuid" 30 || echo "Dash to Panel not ACTIVE after rapid toggles"
        # Allow retries/backoff to settle, then require an attached button.
        ok=0
        for _ in $(seq 1 30); do
            if attachment_status | python3 -c '
import json, sys
s = json.load(sys.stdin)
sys.exit(0 if s["attachments"] and all(a["attached"] for a in s["attachments"]) and not s["pending"] else 1)'; then
                ok=1
                break
            fi
            sleep 0.5
        done
        echo "final attachments: $(attachment_status)"
        if [ "$ok" = 1 ]; then
            echo "RESULT dtp-toggle: button attached after 10 toggles"
        else
            echo "RESULT dtp-toggle: button NOT attached"
            status=1
        fi
        echo "extension state:"
        gnome-extensions info "$uuid" 2>&1 | sed 's/^/  /'
        screenshot dtp-toggle
    fi
    ;;
lifecycle)
    # enable -> open -> search -> close -> disable -> enable, then verify the button is back.
    sleep 3
    dev_call Open >/dev/null
    dev_call Search "fire" >/dev/null
    sleep 1
    screenshot lifecycle-open
    dev_call Close >/dev/null
    gnome-extensions disable "$uuid" >/dev/null 2>&1
    sleep 1
    echo "after disable: $(ext_state "$uuid" | head -1 | tr -s ' ')"
    gnome-extensions enable "$uuid" >/dev/null 2>&1
    if wait_active "$uuid" 20; then
        sleep 2
        dev_call Open >/dev/null
        sleep 1
        echo "after re-enable: $(attachment_status)"
        screenshot lifecycle-reenabled
        if attachment_status | python3 -c '
import json, sys
s = json.load(sys.stdin)
sys.exit(0 if s["attachments"] and all(a["attached"] for a in s["attachments"]) else 1)'; then
            echo "RESULT lifecycle: re-enabled and attached"
        else
            echo "RESULT lifecycle: NOT attached after re-enable"
            status=1
        fi
    else
        echo "RESULT lifecycle: did not become ACTIVE again"
        ext_state "$uuid"
        status=1
    fi
    ;;
*)
    echo "unknown scenario: $scenario" >&2
    status=2
    ;;
esac

# ---------------------------------------------------------------- verdict
sleep 1
# An uncaught exception prints "JS ERROR: ..." on a line without our path; only the stack frames
# that follow mention spawn-menu@djshiye, so look at the lines after each error marker too.
if grep -E '\[spawn-menu\]' "$log" | grep -Eiq 'failed|threw' ||
    grep -A12 -E 'JS ERROR|TypeError|ReferenceError|SyntaxError' "$log" | grep -q 'spawn-menu@djshiye'; then
    echo "RESULT: spawn-menu errors found in the shell log"
    status=1
else
    echo "RESULT: no spawn-menu errors in the shell log"
fi
exit "$status"
