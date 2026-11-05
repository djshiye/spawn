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
dest="io.github.djshiye.Spawn"
path="/io/github/djshiye/Spawn"

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
        echo "---- shell log (filtered: spawn | JS ERROR | Extension | TypeError) ----"
        grep -E 'spawn|JS ERROR|Extension|TypeError' "$log" || echo "(no matching lines)"
        echo "---- end of log (full log: $log) ----"
    fi
    reap_sandbox
}
trap cleanup EXIT

# Kill every process left in THIS sandbox (gvfs daemons such as wsdd, portals, dconf-service...
# outlive dbus-run-session and keep our stdout open). A process belongs to the sandbox only when its
# environment has exactly our XDG_RUNTIME_DIR (already checked to be inside $dev); this script and
# its parent are skipped. Never matches anything of the real session.
reap_sandbox() {
    local want="XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" pid i left
    case "$XDG_RUNTIME_DIR" in "$dev"/*) ;; *) return 0 ;; esac
    sandbox_pids() {
        for pid in $(ls /proc | grep -E '^[0-9]+$'); do
            [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ] || [ "$pid" = "$BASHPID" ] && continue
            [ -r "/proc/$pid/environ" ] || continue
            { tr '\0' '\n' <"/proc/$pid/environ" | grep -qxF "$want" && echo "$pid"; } 2>/dev/null
        done
    }
    left="$(sandbox_pids)"
    [ -n "$left" ] || return 0
    # shellcheck disable=SC2086
    kill $left 2>/dev/null
    for i in 1 2 3 4 5 6; do
        sleep 0.5
        left="$(sandbox_pids)"
        [ -n "$left" ] || return 0
    done
    # shellcheck disable=SC2086
    kill -9 $left 2>/dev/null
}

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
    gdbus call --session --dest "$dest" --object-path "$path" --method "io.github.djshiye.Spawn.Dev.$m" "$@" 2>&1
}

screenshot() { # name
    local f="$shots/$1.png"
    rm -f "$f"
    dev_call Screenshot "$f" >/dev/null && [ -s "$f" ] && echo "screenshot: $f" || { echo "screenshot FAILED: $f"; status=1; }
}

ui_call() { # method [args...]  (dev-only Ui interface, src/ui/devHooks.ts)
    local m="$1"
    shift
    gdbus call --session --dest "$dest" --object-path "$path/Ui" --method "io.github.djshiye.Spawn.Ui.$m" "$@" 2>&1
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
# Target lookup by style class (Ui.Rect / Ui.Count / Ui.FocusActor): scenarios find tiles, buttons and
# rows through the live actor tree instead of hard-coded pixels, so layout tweaks cannot break them.
#   rect <class> [nth]         "x y w h" (stage coordinates) of the nth visible actor with that class
#   center <class> [nth]       "cx cy" (rounded centre); prints nothing and returns 1 when absent
#   count <class>              number of visible actors with that class
#   move_class / click_class <class> [nth] [button]   pointer to the centre (click: button, default 1)
#   focus_class <class> [nth]  give that actor the keyboard focus
rect() { ui_call Rect "$1" "${2:-0}" | unwrap; }
center() {
    local r
    r="$(rect "$1" "${2:-0}")"
    [ -n "$r" ] || return 1
    python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h/2))' "$r"
}
count() { ui_call Count "$1" | tr -dc '0-9'; }
move_class() {
    local c
    c="$(center "$1" "${2:-0}")" || { echo "FAIL no visible '$1' #${2:-0} to move to"; status=1; return 1; }
    # the first virtual-pointer motion after a quiet period can land at x=0: move twice
    ui_call Move $c >/dev/null; sleep 0.25
    ui_call Move $c >/dev/null
    sleep "${3:-0.4}"
}
click_class() {
    local c
    c="$(center "$1" "${2:-0}")" || { echo "FAIL no visible '$1' #${2:-0} to click"; status=1; return 1; }
    click $c "${3:-1}"
}
focus_class() { ui_call FocusActor "$1" "${2:-0}" >/dev/null; sleep 0.3; }
# dump_ui <file>: the whole popup actor tree with allocations and theme values (JSON)
dump_ui() { ui_call Dump | unwrap >"$1"; }

# wait_count <class> <expected> [timeout s]: poll until `count` equals expected (installed-changed reaches
# the shell a few seconds after a .desktop file appears / vanishes); prints the final count
wait_count() {
    local i n=""
    for ((i = 0; i < ${3:-20} * 2; i++)); do
        n="$(count "$1")"
        [ "$n" = "$2" ] && break
        sleep 0.5
    done
    echo "$n"
}

# The headless shell starts in the Overview (no windows yet); Escape leaves it.
leave_overview() { ui_call Key Escape >/dev/null; sleep 1; }
open_menu() { dev_call Open >/dev/null; sleep "${1:-1.2}"; }
close_menu() { dev_call Close >/dev/null; sleep 0.5; }

pinned_ids() { # prints the top-level pinned-apps ids from the sandbox dconf, in order
    dconf read /org/gnome/shell/extensions/spawn/pinned-apps | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

folder_ids() { # <folder-uuid>
    dconf read "/org/gnome/shell/extensions/spawn/folders/$1/pinned-apps" | python3 -c '
import ast, sys
print(" ".join(e["id"] for e in ast.literal_eval(sys.stdin.read().strip())))'
}

# Pinned view display under test (pinned-apps-display): the seed leaves the default, List. Scenarios
# that exercise a specific display call `set_display List|Grid`; reset_seed re-applies it, and
# ITEM / FOLDER name the style class of a pinned app / folder entry in that display.
PINNED_DISPLAY=List
ITEM=spawn-pinned-row
FOLDER=spawn-folder-row
pin_vars() {
    if [ "$PINNED_DISPLAY" = Grid ]; then ITEM=spawn-tile; FOLDER=spawn-folder-tile; else ITEM=spawn-pinned-row; FOLDER=spawn-folder-row; fi
}
set_display() { # List|Grid
    PINNED_DISPLAY="$1"
    pin_vars
    dconf write /org/gnome/shell/extensions/spawn/pinned-apps-display "'$1'"
    sleep 1
}

reset_seed() { # restore the seeded settings between scenarios of one session (dev-mode stays on)
    local k="/org/gnome/shell/extensions/spawn/" e i
    dev_call Close >/dev/null
    for e in $(dconf list "$k"); do
        case "$e" in
            dev-mode) ;;
            */) dconf reset -f "$k$e" ;;
            *) dconf reset "$k$e" ;;
        esac
    done
    dconf load "$k" <"$root/tools/dev/seed.ini"
    [ "$PINNED_DISPLAY" = Grid ] && dconf write "${k}pinned-apps-display" "'Grid'"
    for i in $(seq 20); do # the Ui interface must still be there
        ui_call State >/dev/null 2>&1 && break
        sleep 0.5
    done
    sleep 1.5
}

attachment_status() {
    dev_call AttachmentStatus | sed -E "s/^\('(.*)',\)$/\1/"
}

# ---------------------------------------------------------------- isolation check
if [ "$scenario" = "isolation" ]; then
    before="$(stat -c '%Y %s' "$SPAWN_REAL_DCONF" 2>/dev/null || echo none)"
    dconf write /spawn-isolation-test/x 1
    sleep 1
    dump="$(dconf dump /)"
    after="$(stat -c '%Y %s' "$SPAWN_REAL_DCONF" 2>/dev/null || echo none)"
    echo "dconf dump inside the sandbox:"
    echo "$dump"
    echo "real dconf db: before=[$before] after=[$after]"
    if [ "$before" = "$after" ] && [ -f "$dev/config/dconf/user" ] && echo "$dump" | grep -q 'spawn-isolation-test'; then
        echo "ISOLATION OK"
        exit 0
    fi
    echo "ISOLATION FAILED"
    exit 1
fi

# ---------------------------------------------------------------- install
ext_dir="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$ext_dir"
# scenario scratch dir for measurements (ux-measure / ui-fixes dump JSON there); a fresh .dev has none
mkdir -p "$dev/ux"
# the sandbox applications dir must exist BEFORE the shell starts so GAppInfoMonitor watches it
# (scenarios create / remove test .desktop files there and expect installed-changed)
mkdir -p "$XDG_DATA_HOME/applications"
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
dconf write /org/gnome/shell/extensions/spawn/dev-mode true
if [ "$seeded" = 1 ]; then
    # The user's setup: pinned apps, 3 folders, shortcuts, Fedora button icon, Orchis-Dark-Compact (when installed).
    dconf load /org/gnome/shell/extensions/spawn/ <"$root/tools/dev/seed.ini"
    dconf write /org/gnome/shell/extensions/spawn/dev-mode true
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
    dconf write /org/gnome/shell/extensions/spawn/super-key-toggle false
    sleep 1
    hk_check "Super released when setting is off" superActive False
    hk_check "GNOME handler unblocked again" firstUnblocked "$gnome_id"
    before="$(hk_field toggles)"
    dev_call EmitOverlayKey >/dev/null
    sleep 0.5
    hk_check "overlay-key no longer toggles the menu" toggles "$before"
    dconf write /org/gnome/shell/extensions/spawn/super-key-toggle true
    sleep 1
    hk_check "Super intercepted again" superActive True
    hk_check "GNOME handler blocked again" firstUnblocked "$(hk_field ourHandler)"
    # custom accelerator
    dconf write /org/gnome/shell/extensions/spawn/spawn-hotkey "['<Super>space']"
    sleep 1.5
    hk_check "accelerator bound" accelBound True
    dconf write /org/gnome/shell/extensions/spawn/spawn-hotkey "@as []"
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
    # The generated stylesheet lives under $XDG_RUNTIME_DIR/spawn/<token>/theme.css, is
    # regenerated on settings changes and removed again on disable.
    sleep 3
    rt="$XDG_RUNTIME_DIR/spawn"
    theme_files() { find "$rt" -name theme.css 2>/dev/null; }
    check() { # description, condition-exit-code
        if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; status=1; fi
    }
    f1="$(theme_files)"
    echo "theme file: $f1"
    [ -n "$f1" ] && grep -q '#3584e4' "$f1"; check "accent css written" $?
    dconf write /org/gnome/shell/extensions/spawn/override-menu-theme true
    dconf write /org/gnome/shell/extensions/spawn/menu-button-bg-color "(true, 'rgb(10,20,30)')"
    sleep 1
    f2="$(theme_files)"
    [ "$(echo "$f2" | wc -l)" = 1 ] && grep -q 'rgb(10,20,30)' "$f2" && grep -q 'popup-menu-content' "$f2"; check "css regenerated (single file) after settings change" $?
    # Visual check of the panel button colour: vivid red, Overview closed (with Super released
    # the overlay-key goes to GNOME, which toggles the Overview), Activities button hidden.
    dconf write /org/gnome/shell/extensions/spawn/menu-button-bg-color "(true, 'rgb(255,0,0)')"
    dconf write /org/gnome/shell/extensions/spawn/super-key-toggle false
    dconf write /org/gnome/shell/extensions/spawn/hide-activities-button true
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
        PINNED_DISPLAY=List; pin_vars
        reset_seed
        # shellcheck disable=SC1090
        source "$f"
    done
    # The scenarios that are not tied to one display run again with the grid (ui-dnd / ui-keyboard
    # are grid-only, ui-list list-only: they cover their own display).
    for name in ui-context ui-folder ui-tooltips ui-views ui-fixes; do
        echo
        echo "======== $name (Grid)"
        PINNED_DISPLAY=Grid; pin_vars
        reset_seed
        # shellcheck disable=SC1090
        source "$root/tools/dev/scenarios/$name.sh"
    done
    PINNED_DISPLAY=List; pin_vars
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
# that follow mention spawn@djshiye, so look at the lines after each error marker too.
if grep -E '\[spawn\]' "$log" | grep -Eq 'ERROR:|failed|threw' ||
    grep -A12 -E 'JS ERROR|TypeError|ReferenceError|SyntaxError' "$log" | grep -q 'spawn@djshiye'; then
    echo "RESULT: spawn errors found in the shell log"
    status=1
else
    echo "RESULT: no spawn errors in the shell log"
fi
# Any GLib "-CRITICAL" line from the shell process (Clutter-, St-, Gjs-, GNOME Shell-CRITICAL, ...) fails
# the run, whoever owns it: a CRITICAL is a failed g_return_if_fail somewhere, and we have none to spare.
# Known external noise is filtered through CRITICAL_NOISE (extended regex); currently empty: none seen.
CRITICAL_NOISE='^$'
criticals="$(grep -E '^\(gnome-shell:[0-9]+\): .*-CRITICAL' "$log" | grep -Ev "$CRITICAL_NOISE")"
if [ -n "$criticals" ]; then
    echo "RESULT: CRITICAL lines in the shell log:"
    echo "$criticals" | sed 's/^/  /'
    status=1
else
    echo "RESULT: no CRITICAL lines in the shell log"
fi
exit "$status"
