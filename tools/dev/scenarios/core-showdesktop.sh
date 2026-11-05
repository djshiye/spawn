# Show Desktop (ui/showDesktop.ts, shared by the context menu and the right-pane shortcut), review2 core F1:
#   * survives a lock-like disable/enable of the extension (the memory lives on the extension instance)
#   * is remembered per workspace (toggling on ws2 does not forget ws1)
#   * stale memory: a window opened after Show Desktop is hidden first, then everything comes back
#   * the right-pane Spawn_ShowDesktop shortcut behaves like the context-menu row (and shares the memory)
# Run seeded: tools/dev-shell.sh core-showdesktop --seed
K=/org/gnome/shell/extensions/spawn
windows() { ui_call Windows | unwrap; }
win_min() { windows | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin) if x["title"] == sys.argv[1]]
print(w[0]["minimized"] if w else "missing")' "$1"; }
menu_count() { count spawn-button-menu; }
wait_menu() { local i n=""; for ((i = 0; i < 24; i++)); do n="$(menu_count)"; [ "$n" = "$1" ] && break; sleep 0.25; done; echo "$n"; }
row_index() { ui_call MenuItems spawn-button-menu | unwrap | python3 -c '
import json, sys
rows = [r for r in json.load(sys.stdin) if r["visible"]]
labels = [r.get("label") for r in rows]
print(labels.index(sys.argv[1]) if sys.argv[1] in labels else -1)' "$1"; }
ctx_show_desktop() {
    click_class spawn-button 0 3
    wait_menu 1 >/dev/null
    click_class popup-menu-item "$(row_index "Show Desktop")"
    sleep 1.2
}
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
start_win() { # title
    WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" "$1" >>"$dev/testwin.log" 2>&1 &
    pids+=($!)
    local i
    for i in $(seq 20); do
        [ "$(win_min "$1")" != missing ] && break
        sleep 0.5
    done
    sleep 0.8
}
pids=()
cleanup_wins() { kill "${pids[@]}" 2>/dev/null; pids=(); sleep 1; }
ws() { dev_call ActivateWorkspace "$1" >/dev/null; sleep 1.2; }

leave_overview
close_menu

echo "-- survives a lock-like disable/enable"
start_win W1
expect "W1 up" "$(win_min W1)" False
ctx_show_desktop
expect "Show Desktop minimizes W1" "$(win_min W1)" True
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
leave_overview
ctx_show_desktop
expect "after disable/enable Show Desktop restores W1" "$(win_min W1)" False

echo "-- per workspace"
ctx_show_desktop
expect "ws0: W1 hidden" "$(win_min W1)" True
ws 1
start_win W2
expect "ws1: W2 up" "$(win_min W2)" False
ctx_show_desktop
expect "ws1: Show Desktop minimizes W2" "$(win_min W2)" True
expect "ws0's W1 stays minimized" "$(win_min W1)" True
ctx_show_desktop
expect "ws1: second Show Desktop restores W2" "$(win_min W2)" False
expect "... and does not touch W1" "$(win_min W1)" True
ws 0
ctx_show_desktop
expect "ws0: Show Desktop restores W1 (memory kept across the ws1 toggles)" "$(win_min W1)" False
expect "... and does not touch W2" "$(win_min W2)" False
cleanup_wins

echo "-- stale memory: a window opened after Show Desktop"
start_win W1
ctx_show_desktop
expect "W1 hidden" "$(win_min W1)" True
start_win W3
expect "W3 (opened afterwards) is up" "$(win_min W3)" False
ctx_show_desktop
expect "Show Desktop hides W3 instead of restoring W1" "$(win_min W3)" True
expect "... W1 still hidden" "$(win_min W1)" True
ctx_show_desktop
expect "the next one restores W3" "$(win_min W3)" False
expect "... and W1" "$(win_min W1)" False

echo "-- right-pane shortcut shares the behaviour and the memory"
dconf write $K/application-shortcuts "[{'id': 'Spawn_ShowDesktop'}]"
dconf write $K/directory-shortcuts "@aa{ss} []"
sleep 1
pane_show_desktop() {
    open_menu 1.4
    click_class spawn-shortcut-row 0
    sleep 1.5
}
pane_show_desktop
expect "right pane: Show Desktop minimizes W1" "$(win_min W1)" True
expect "... and W3" "$(win_min W3)" True
expect "... popup closed" "$(state_get open)" false
ctx_show_desktop
expect "context menu restores what the right pane hid (shared memory)" "$(win_min W1)" False
pane_show_desktop
expect "right pane hides again" "$(win_min W1)" True
pane_show_desktop
expect "right pane restores" "$(win_min W1)" False
expect "... W3 too" "$(win_min W3)" False
cleanup_wins
dconf reset $K/application-shortcuts
dconf reset $K/directory-shortcuts
