# Panel button context menu (ui/buttonMenu.ts): right click, Menu key, Shift+F10, the item list of the
# seeded user setup, the Power Options submenu, Show Desktop (minimize, then restore), Spawn Settings,
# exclusion with the Spawn popup, focus return. With --with-dtp: Panel Extension Settings is present.
# Screenshots: final/button-context-menu, final/button-context-power (+ -dtp variants).
K=/org/gnome/shell/extensions/spawn
mkdir -p "$shots/final"
if [ "$SPAWN_WITH_DTP" = 1 ]; then
    wait_active "$dtp_uuid" 30 || { echo "FAIL Dash to Panel did not become ACTIVE"; status=1; }
    sleep 4 # Dash to Panel re-enters the Overview during its own startup
fi
leave_overview
close_menu

menu_items() { ui_call MenuItems spawn-button-menu | unwrap; }
menu_count() { count spawn-button-menu; }
focus_field() { ui_call FocusInfo | unwrap | json_get "$1"; }
windows() { ui_call Windows | unwrap; }
test_window_minimized() { windows | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin) if x["title"] == "SpawnTestWindow"]
print(w[0]["minimized"] if w else "missing")'; }
right_click_button() { click_class spawn-button 0 3; }
wait_menu() { # expected count, timeout s
    local i n=""
    for ((i = 0; i < ${2:-6} * 4; i++)); do
        n="$(menu_count)"
        [ "$n" = "$1" ] && break
        sleep 0.25
    done
    echo "$n"
}

# Index of the first visible row with this label among ALL visible rows (separators are .popup-menu-item too).
row_index() { menu_items | python3 -c '
import json, sys
rows = [r for r in json.load(sys.stdin) if r["visible"]]
labels = [r.get("label") for r in rows]
print(labels.index(sys.argv[1]) if sys.argv[1] in labels else -1)' "$1"; }

echo "-- right click opens the context menu"
expect "right-click action defaults to the context menu" "$(dconf read $K/menu-button-right-click-action | grep . || echo "'ContextMenu'")" "'ContextMenu'"
right_click_button
expect "context menu is open" "$(wait_menu 1)" 1

echo "-- items, labels, order, separators"
menu_items >"$dev/button-menu-items.json"
echo "items: $(cat "$dev/button-menu-items.json")"
python3 - "$dev/button-menu-items.json" "$SPAWN_WITH_DTP" "$XDG_DATA_HOME" <<'PY'
import ast, json, os, subprocess, sys
items = json.load(open(sys.argv[1]))
with_dtp = sys.argv[2] == "1"
raw = subprocess.run(["dconf", "read", "/org/gnome/shell/extensions/spawn/context-menu-items"], capture_output=True, text=True).stdout.strip()
setting = ast.literal_eval(raw)
dirs = [os.path.join(d, "applications") for d in (sys.argv[3] + ":" + os.environ.get("SPAWN_REAL_DATA_HOME", "") + ":/usr/local/share:/usr/share:/var/lib/flatpak/exports/share:" + os.path.expanduser("~/.local/share/flatpak/exports/share")).split(":") if d]
def installed(desktop_id):
    return any(os.path.exists(os.path.join(d, desktop_id)) for d in dirs)
expected = []
for e in setting:
    i = e["id"]
    if i == "Spawn_Separator":
        expected.append(("separator", None))
    elif i.endswith(".desktop"):
        if installed(i):
            expected.append(("item", None))
    elif i == "Spawn_Settings":
        expected.append(("item", "Spawn Settings"))
    elif i == "Spawn_PanelExtensionSettings":
        if with_dtp:
            expected.append(("item", "Dash to Panel Settings"))
    elif i == "Spawn_ShowDesktop":
        expected.append(("item", "Show Desktop"))
    elif i == "Spawn_PowerOptions":
        expected.append(("submenu", "Power Options"))
# collapse separators exactly like the menu does
clean = []
for k in expected:
    if k[0] == "separator" and (not clean or clean[-1][0] == "separator"):
        continue
    clean.append(k)
while clean and clean[-1][0] == "separator":
    clean.pop()
shown = [(r["kind"], r["label"] if r["kind"] != "separator" else None) for r in items if r["visible"]]
print("expected:", clean)
print("shown   :", shown)
ok = len(shown) == len(clean) and all(s[0] == c[0] and (c[1] is None or s[1] == c[1]) and (s[1] is None) == (c[0] == "separator") for s, c in zip(shown, clean))
ok = ok and all(s[1] for s in shown if s[0] != "separator")
sys.exit(0 if ok else 1)
PY
check "labels / order / separators match context-menu-items" $?
if [ "$SPAWN_WITH_DTP" != 1 ]; then
    menu_items | grep -q 'Settings"' && ! menu_items | grep -q 'Dash to Panel'; check "no Panel Extension Settings without a panel extension" $?
fi
screenshot final/button-context-menu$([ "$SPAWN_WITH_DTP" = 1 ] && echo -dtp)

echo "-- Power Options submenu"
idx="$(row_index "Power Options")"
click_class popup-menu-item "$idx"
sleep 0.8
menu_items | python3 -c '
import json, sys
order = ["Switch User", "Lock", "Log Out", "Suspend", "Hybrid Sleep", "Hibernate", "Restart", "Power Off"]
sub = [r for r in json.load(sys.stdin) if r["kind"] == "submenu"][0]
shown = [r["label"] for r in sub["items"] if r["visible"]]
print("power submenu open:", sub["open"], shown)
pos = [order.index(l) for l in shown]
sys.exit(0 if sub["open"] and shown and pos == sorted(pos) else 1)'
check "Power Options opens with the available actions in severity order" $?
screenshot final/button-context-power$([ "$SPAWN_WITH_DTP" = 1 ] && echo -dtp)
key Escape 0.8
expect "Escape closes the context menu" "$(wait_menu 0)" 0

echo "-- right click toggles"
right_click_button
expect "opens again" "$(wait_menu 1)" 1
right_click_button
expect "a second right click closes it" "$(wait_menu 0)" 0

echo "-- mutual exclusion with the Spawn popup"
# (the popup's grab swallows a press on the button like any outside click: it only dismisses the popup)
open_menu 1.2
expect_state "Spawn popup open" open true
right_click_button
sleep 1
expect_state "a right click while the popup is open dismisses it" open false
expect "... without opening the context menu" "$(menu_count)" 0
right_click_button
expect "the next right click opens the context menu" "$(wait_menu 1)" 1
open_menu 1.2
expect_state "Spawn popup opened (Dev Open) while the context menu was open" open true
expect "... the context menu closed" "$(wait_menu 0)" 0
close_menu
click_class spawn-button 0 1
sleep 1
expect_state "left click opens the Spawn popup" open true
close_menu
right_click_button
expect "context menu open" "$(wait_menu 1)" 1
click_class spawn-button 0 1
sleep 1
expect "a left click while the context menu is open dismisses it" "$(menu_count)" 0
expect_state "... without opening the Spawn popup" open false

echo "-- keyboard: Menu key and Shift+F10 on the focused button"
for k in Menu Shift+F10; do
    dev_call FocusButton >/dev/null; sleep 0.4
    key "$k" 1
    expect "$k opens the context menu" "$(wait_menu 1)" 1
    expect "$k focuses the first row" "$(focus_field cls | grep -o 'popup-menu-item' | head -1)" popup-menu-item
    key Down 0.3
    key Escape 0.8
    expect "Escape closes it ($k)" "$(wait_menu 0)" 0
    expect "focus is back on the panel button ($k)" "$(focus_field cls | grep -o 'spawn-button' | head -1)" spawn-button
done
# Return on the button afterwards still opens Spawn's popup (press-arm logic untouched)
key Return 1.2
expect_state "Return on the focused button opens the Spawn popup" open true
close_menu
dev_call FocusButton >/dev/null; sleep 0.4
key Menu 1
key Return 1
expect "Return on the first row launches it and closes the menu" "$(wait_menu 0)" 0
sleep 1

echo "-- click action settings"
dconf write $K/menu-button-right-click-action "'None'"; sleep 0.6
right_click_button
expect "right click with action None does nothing" "$(menu_count)" 0
dconf write $K/menu-button-right-click-action "'Menu'"; sleep 0.6
right_click_button
sleep 1
expect_state "right click with action Menu opens the Spawn popup" open true
close_menu
dconf write $K/menu-button-right-click-action "'None'"
dconf write $K/menu-button-left-click-action "'ContextMenu'"; sleep 0.6
click_class spawn-button 0 1
expect "left click with action ContextMenu opens it" "$(wait_menu 1)" 1
key Escape 0.8
dconf write $K/menu-button-left-click-action "'None'"
dconf write $K/menu-button-middle-click-action "'ContextMenu'"; sleep 0.6
click_class spawn-button 0 2
expect "middle click with action ContextMenu opens it" "$(wait_menu 1)" 1
key Escape 0.8
dconf reset $K/menu-button-left-click-action
dconf reset $K/menu-button-middle-click-action
dconf reset $K/menu-button-right-click-action
sleep 0.6

echo "-- edit of context-menu-items while open closes it; a new list is used on the next open"
right_click_button
expect "open" "$(wait_menu 1)" 1
dconf write $K/context-menu-items "[{'id': 'Spawn_ShowDesktop'}, {'id': 'Spawn_Separator'}, {'id': 'Spawn_Separator'}, {'id': 'Spawn_RunCommand'}, {'id': 'org.example.NotInstalled.desktop'}, {'id': 'Spawn_Separator'}]"
expect "editing the setting closes the open menu" "$(wait_menu 0)" 0
right_click_button
wait_menu 1 >/dev/null
menu_items | python3 -c '
import json, sys
rows = [(r["kind"], r.get("label")) for r in json.load(sys.stdin) if r["visible"]]
print(rows)
sys.exit(0 if rows == [("item", "Show Desktop"), ("separator", None), ("item", "Run Command")] else 1)'
check "new list: doubled and trailing separators collapsed, uninstalled app skipped" $?
key Escape 0.8
dconf write $K/context-menu-items "@aa{ss} []"
right_click_button
sleep 1
expect "an empty list opens no menu" "$(menu_count)" 0
dconf reset $K/context-menu-items
sleep 0.6

echo "-- Show Desktop: minimize, then restore"
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" >"$dev/testwin.log" 2>&1 &
testwin_pid=$!
for _ in $(seq 20); do
    [ "$(test_window_minimized)" != missing ] && break
    sleep 0.5
done
expect "test window is up and not minimized" "$(test_window_minimized)" False
right_click_button
wait_menu 1 >/dev/null
click_class popup-menu-item "$(row_index "Show Desktop")"
sleep 1.2
expect "Show Desktop minimizes the window" "$(test_window_minimized)" True
right_click_button
wait_menu 1 >/dev/null
click_class popup-menu-item "$(row_index "Show Desktop")"
sleep 1.2
expect "Show Desktop again restores it" "$(test_window_minimized)" False
# a window the user minimized himself is not touched by the restore: only what Show Desktop hid
right_click_button
wait_menu 1 >/dev/null
click_class popup-menu-item "$(row_index "Show Desktop")"
sleep 1.2
expect "third activation minimizes again" "$(test_window_minimized)" True
kill "$testwin_pid" 2>/dev/null
sleep 1
right_click_button
wait_menu 1 >/dev/null
click_class popup-menu-item "$(row_index "Show Desktop")"
sleep 1
expect "Show Desktop with the remembered window gone and no window left: no error, menu closed" "$(menu_count)" 0

echo "-- Spawn Settings"
right_click_button
wait_menu 1 >/dev/null
click_class popup-menu-item "$(row_index "Spawn Settings")"
sleep 3
expect "menu closed after Spawn Settings" "$(menu_count)" 0
echo "windows after Spawn Settings: $(windows)"

if [ "$SPAWN_WITH_DTP" = 1 ]; then
    echo "-- Panel Extension Settings (Dash to Panel)"
    right_click_button
    wait_menu 1 >/dev/null
    expect "row shown with Dash to Panel active" "$(menu_items | python3 -c 'import json,sys; print(any(r.get("label") == "Dash to Panel Settings" for r in json.load(sys.stdin)))')" True
    click_class popup-menu-item "$(row_index "Dash to Panel Settings")"
    sleep 3
    expect "menu closed after Panel Extension Settings" "$(menu_count)" 0
    echo "windows after Panel Extension Settings: $(windows)"
    gnome-extensions disable "$dtp_uuid" >/dev/null 2>&1
    sleep 4
    leave_overview
    right_click_button
    wait_menu 1 >/dev/null
    expect "row hidden once Dash to Panel is disabled" "$(menu_items | python3 -c 'import json,sys; print(any("Panel" in (r.get("label") or "") for r in json.load(sys.stdin)))')" False
    key Escape 0.8
fi
