#!/usr/bin/env bash
# Runs INSIDE the isolated dbus-run-session started by tools/dev-shell.sh. Do not run directly.
set -uo pipefail

: "${SPAWN_DEV:?run tools/dev-shell.sh instead}"
root="$SPAWN_ROOT"
dev="$SPAWN_DEV"
scenario="$SPAWN_SCENARIO"
with_dtp="$SPAWN_WITH_DTP"
seeded="${SPAWN_SEED:-0}"
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
        mkdir -p "$dev/logs"
        cp "$log" "$dev/logs/${SPAWN_LOG_NAME:-$scenario}.log"
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

ui_call() { # method [args...]  (dev-only Ui interface, src/ui/devHooks.ts)
    local m="$1"
    shift
    gdbus call --session --dest "$dest" --object-path "$path/Ui" --method "io.github.djshiye.SpawnMenu.Ui.$m" "$@" 2>&1
}

# gdbus prints GVariant text, e.g. ('{"a":1}',); unwrap the single string.
unwrap() { python3 -c 'import ast, sys; print(ast.literal_eval(sys.stdin.read().strip())[0])'; }

ui_state() { ui_call State | unwrap; }

# json_get <dotted.path>  (reads JSON on stdin; booleans print as true/false)
json_get() {
    python3 -c '
import json, sys
d = json.load(sys.stdin)
for part in sys.argv[1].split("."):
    d = d[int(part)] if isinstance(d, list) else d.get(part) if isinstance(d, dict) else None
print(json.dumps(d) if isinstance(d, (dict, list, bool)) or d is None else d)' "$1"
}

state_get() { ui_state | json_get "$1"; }

# check <description> <exit-code>   ok/FAIL line; any FAIL makes the scenario fail
check() {
    if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; status=1; fi
}

# expect <description> <got> <expected>
expect() {
    if [ "$2" = "$3" ]; then echo "ok   $1 ($2)"; else echo "FAIL $1 (got '$2', expected '$3')"; status=1; fi
}

# expect_state <description> <dotted.path> <expected>
expect_state() { expect "$1" "$(state_get "$2")" "$3"; }

# Input helpers for the ui scenarios (virtual pointer / keyboard inside the shell).
key() { ui_call Key "$1" >/dev/null; sleep "${2:-0.3}"; }
click() { # x y [button]
    ui_call Move "$1" "$2" >/dev/null
    sleep 0.5
    ui_call Click "$1" "$2" "${3:-1}" >/dev/null
    sleep 0.9
}
# The headless shell starts in the Overview (no windows yet); Escape leaves it.
leave_overview() { ui_call Key Escape >/dev/null; sleep 1; }
open_menu() { dev_call Open >/dev/null; sleep "${1:-1.2}"; }
close_menu() { dev_call Close >/dev/null; sleep 0.5; }

pinned_ids() { # prints the top-level pinned-apps ids from the sandbox dconf, in order
    dconf read /org/gnome/shell/extensions/spawn-menu/pinned-apps | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

folder_ids() { # <folder-uuid>
    dconf read "/org/gnome/shell/extensions/spawn-menu/folders/$1/pinned-apps" | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

reset_seed() { # restore the seeded settings between scenarios of one session (dev-mode stays on)
    local k="/org/gnome/shell/extensions/spawn-menu/" e i
    dev_call Close >/dev/null
    for e in $(dconf list "$k"); do
        case "$e" in
            dev-mode) ;;
            */) dconf reset -f "$k$e" ;;
            *) dconf reset "$k$e" ;;
        esac
    done
    dconf load "$k" <"$root/tools/dev/seed.ini"
    for i in $(seq 20); do # the Ui interface must still be there
        ui_call State >/dev/null 2>&1 && break
        sleep 0.5
    done
    sleep 1.5
}

# Input helpers for the ui scenarios (virtual pointer / keyboard inside the shell).
key() { ui_call Key "$1" >/dev/null; sleep "${2:-0.3}"; }
click() { # x y [button]
    ui_call Move "$1" "$2" >/dev/null
    sleep 0.5
    ui_call Click "$1" "$2" "${3:-1}" >/dev/null
    sleep 0.9
}
# The headless shell starts in the Overview (no windows yet); Escape leaves it.
leave_overview() { ui_call Key Escape >/dev/null; sleep 1; }
open_menu() { dev_call Open >/dev/null; sleep "${1:-1.2}"; }
close_menu() { dev_call Close >/dev/null; sleep 0.5; }

pinned_ids() { # prints the top-level pinned-apps ids from the sandbox dconf, in order
    dconf read /org/gnome/shell/extensions/spawn-menu/pinned-apps | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

folder_ids() { # <folder-uuid>
    dconf read "/org/gnome/shell/extensions/spawn-menu/folders/$1/pinned-apps" | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

reset_seed() { # restore the seeded settings between scenarios of one session
    dev_call Close >/dev/null
    dconf reset -f /org/gnome/shell/extensions/spawn-menu/
    dconf load /org/gnome/shell/extensions/spawn-menu/ <"$root/tools/dev/seed.ini"
    dconf write /org/gnome/shell/extensions/spawn-menu/dev-mode true
    sleep 1.5
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
theme_uuid="user-theme@gnome-shell-extensions.gcampax.github.com"
theme_name="Orchis-Dark-Compact"
if [ "$seeded" = 1 ] && [ -d "$SPAWN_REAL_DATA_HOME/gnome-shell/extensions/$theme_uuid" ] && [ -d "$SPAWN_REAL_HOME/.themes/$theme_name" ]; then
    cp -r "$SPAWN_REAL_DATA_HOME/gnome-shell/extensions/$theme_uuid" "$ext_dir/$theme_uuid"
    enabled="$enabled, '$theme_uuid'"
    use_theme=1
else
    use_theme=0
fi
enabled="$enabled]"
dconf write /org/gnome/shell/enabled-extensions "$enabled"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/welcome-dialog-last-shown-version "'999'"
dconf write /org/gnome/shell/extensions/spawn-menu/dev-mode true
if [ "$seeded" = 1 ]; then
    # The user's setup: pinned apps, 3 folders, shortcuts, Fedora button icon, Orchis-Dark-Compact (when installed).
    dconf load /org/gnome/shell/extensions/spawn-menu/ <"$root/tools/dev/seed.ini"
    dconf write /org/gnome/shell/extensions/spawn-menu/dev-mode true
    [ "$use_theme" = 1 ] && dconf write /org/gnome/shell/extensions/user-theme/name "'$theme_name'"
    echo "seeded settings loaded (theme: $([ "$use_theme" = 1 ] && echo "$theme_name" || echo "default"))"
fi

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
hotkeys)
    # Super interception is in memory only: GNOME's overlay-key handler gets blocked while
    # super-key-toggle is on, and is released again when it is switched off.
    sleep 3
    hk_field() { # json field
        dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"
    }
    hk_check() { # description, field, expected
        local got
        got="$(hk_field "$2")"
        if [ "$got" = "$3" ]; then echo "ok   $1 ($2=$got)"; else echo "FAIL $1 ($2=$got, expected $3)"; status=1; fi
    }
    gnome_id="$(hk_field gnomeHandler)"
    our_id="$(hk_field ourHandler)"
    echo "hotkey status at start: $(dev_call HotkeyStatus)"
    hk_check "Super intercepted at start" superActive True
    [ "$gnome_id" != 0 ] && [ "$our_id" != 0 ] || { echo "FAIL handler ids missing"; status=1; }
    hk_check "first unblocked overlay-key handler is ours" firstUnblocked "$our_id"
    before="$(hk_field toggles)"
    dev_call EmitOverlayKey >/dev/null
    sleep 0.5
    hk_check "overlay-key fires our toggle" toggles "$((before + 1))"
    dconf write /org/gnome/shell/extensions/spawn-menu/super-key-toggle false
    sleep 1
    hk_check "Super released when setting is off" superActive False
    hk_check "GNOME handler unblocked again" firstUnblocked "$gnome_id"
    before="$(hk_field toggles)"
    dev_call EmitOverlayKey >/dev/null
    sleep 0.5
    hk_check "overlay-key no longer toggles the menu" toggles "$before"
    dconf write /org/gnome/shell/extensions/spawn-menu/super-key-toggle true
    sleep 1
    hk_check "Super intercepted again" superActive True
    hk_check "GNOME handler blocked again" firstUnblocked "$(hk_field ourHandler)"
    # custom accelerator
    dconf write /org/gnome/shell/extensions/spawn-menu/menu-hotkey "['<Super>space']"
    sleep 1.5
    hk_check "accelerator bound" accelBound True
    dconf write /org/gnome/shell/extensions/spawn-menu/menu-hotkey "@as []"
    sleep 1.5
    hk_check "accelerator unbound" accelBound False
    # disable + re-enable: the handler must be found again and be intercepted
    gnome-extensions disable "$uuid" >/dev/null 2>&1
    sleep 1
    gnome-extensions enable "$uuid" >/dev/null 2>&1
    wait_active "$uuid" 20 && sleep 2
    hk_check "Super intercepted after re-enable" superActive True
    hk_check "GNOME handler id unchanged after re-enable" gnomeHandler "$gnome_id"
    ;;
theme)
    # The generated stylesheet lives under $XDG_RUNTIME_DIR/spawn-menu/<token>/theme.css, is
    # regenerated on settings changes and removed again on disable.
    sleep 3
    rt="$XDG_RUNTIME_DIR/spawn-menu"
    theme_files() { find "$rt" -name theme.css 2>/dev/null; }
    check() { # description, condition-exit-code
        if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; status=1; fi
    }
    f1="$(theme_files)"
    echo "theme file: $f1"
    [ -n "$f1" ] && grep -q '#3584e4' "$f1"; check "accent css written" $?
    dconf write /org/gnome/shell/extensions/spawn-menu/override-menu-theme true
    dconf write /org/gnome/shell/extensions/spawn-menu/menu-button-bg-color "(true, 'rgb(10,20,30)')"
    sleep 1
    f2="$(theme_files)"
    [ "$(echo "$f2" | wc -l)" = 1 ] && grep -q 'rgb(10,20,30)' "$f2" && grep -q 'popup-menu-content' "$f2"; check "css regenerated (single file) after settings change" $?
    # Visual check of the panel button colour: vivid red, Overview closed (with Super released
    # the overlay-key goes to GNOME, which toggles the Overview), Activities button hidden.
    dconf write /org/gnome/shell/extensions/spawn-menu/menu-button-bg-color "(true, 'rgb(255,0,0)')"
    dconf write /org/gnome/shell/extensions/spawn-menu/super-key-toggle false
    dconf write /org/gnome/shell/extensions/spawn-menu/hide-activities-button true
    sleep 1
    dev_call EmitOverlayKey >/dev/null
    sleep 2
    screenshot theme-button
    dev_call Open >/dev/null
    sleep 1
    screenshot theme-open
    dev_call Close >/dev/null
    gnome-extensions disable "$uuid" >/dev/null 2>&1
    sleep 1
    [ -z "$(theme_files)" ] && [ ! -e "$rt" ]; check "stylesheet and directory removed on disable" $?
    gnome-extensions enable "$uuid" >/dev/null 2>&1
    wait_active "$uuid" 20 && sleep 2
    [ -n "$(theme_files)" ]; check "stylesheet written again after re-enable" $?
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
ui)
    # Every ui-* scenario in one shell session; the seeded settings are restored in between.
    sleep 2
    leave_overview
    for f in "$root"/tools/dev/scenarios/ui-*.sh; do
        name="$(basename "$f" .sh)"
        echo
        echo "======== $name"
        reset_seed
        # shellcheck disable=SC1090
        source "$f"
    done
    ;;
*)
    f="$root/tools/dev/scenarios/$scenario.sh"
    if [ -f "$f" ]; then
        sleep 2
        # shellcheck disable=SC1090
        source "$f"
    else
        echo "unknown scenario: $scenario" >&2
        status=2
    fi
    ;;
esac

# ---------------------------------------------------------------- verdict
sleep 1
# An uncaught exception prints "JS ERROR: ..." on a line without our path; only the stack frames
# that follow mention spawn-menu@djshiye, so look at the lines after each error marker too.
if grep -E '\[spawn-menu\]' "$log" | grep -Eq 'ERROR:|failed|threw' ||
    grep -A12 -E 'JS ERROR|TypeError|ReferenceError|SyntaxError' "$log" | grep -q 'spawn-menu@djshiye'; then
    echo "RESULT: spawn-menu errors found in the shell log"
    status=1
else
    echo "RESULT: no spawn-menu errors in the shell log"
fi
exit "$status"
