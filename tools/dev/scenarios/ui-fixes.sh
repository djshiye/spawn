# Regression checks for the UI review findings (ui.md) and the behaviour changes of the UX pass.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
rm -f "$apps"/spawn-*.desktop   # leftovers of an earlier run (the Grid rerun of this scenario)
mkdesktop() { # id name [exec]
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=%s\nIcon=utilities-terminal\n' "$2" "${3:-true}" >"$apps/$1"
}
clutter_criticals() { grep -c "Clutter-CRITICAL\|clutter_actor_add_child" "$log" || true; }
crit0="$(clutter_criticals)"

echo "-- ui #1: type + Return inside the debounce window activates the first result"
mkdesktop spawn-probe.desktop "Zzqx Probe"
sleep 2.5
open_menu 1.2
ui_call Search zzqx >/dev/null; ui_call Key Return >/dev/null
sleep 1.2
expect_state "fast Return launched the first result and closed the menu" open false

echo "-- ui #2: installed-changed refreshes pinned tiles; missing apps are ghosted, not hidden"
reset_seed
dconf write $K/pinned-apps "[{'id': 'spawn-probe.desktop'}, {'id': 'steam.desktop'}, {'id': 'spawn-gone.desktop'}]"
sleep 1
open_menu 1.5
expect "pinned grid has the probe, steam and one ghost" "$(state_get layout.tiles)" 3
expect "one ghost tile for the uninstalled app" "$(count spawn-tile-missing)" 1
rm -f "$apps/spawn-probe.desktop"
expect "removing the .desktop file turns its tile into a ghost (2 ghosts)" "$(wait_count spawn-tile-missing 2)" 2
expect "tile count unchanged" "$(state_get layout.tiles)" 3
mkdesktop spawn-gone.desktop "Gone Again"
expect "installing it again revives the ghost (1 ghost left)" "$(wait_count spawn-tile-missing 1)" 1
screenshot ui-ghost
echo "-- ghost context menu: Unpin"
focus_class spawn-tile-missing 0
key Menu 1; key Return 0.8   # the menu opens with its first item focused
echo "pinned: $(pinned_ids)"
echo "$(pinned_ids)" | grep -q spawn-probe && { echo "FAIL ghost still pinned"; status=1; } || echo "ok   Unpin removed the ghost from pinned-apps"

echo "-- ui #5: the same id twice in pinned-apps does not break the grid"
reset_seed
before="$(clutter_criticals)"
dconf write $K/pinned-apps "[{'id': 'steam.desktop'}, {'id': 'steam.desktop'}, {'id': 'husk.desktop'}]"
sleep 1
open_menu 1.5
expect "duplicate id shows one tile" "$(state_get layout.tiles)" 2
expect "no Clutter criticals from the duplicate" "$(clutter_criticals)" "$before"

echo "-- ui #3: icon-size-grid (icon-size-apps in the list) applies to entries that already exist"
reset_seed
open_menu 1.5
if [ "$PINNED_DISPLAY" = Grid ]; then size_key=icon-size-grid; big="{'size': 96}"; none="{'size': -1}"; icon_cls=spawn-tile-icon
else size_key=icon-size-apps; big=64; none=-1; icon_cls=spawn-row-icon; fi
iw() { rect $icon_cls 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[2]))'; }
w0="$(iw)"
dconf write $K/$size_key "$big"
sleep 1.2
w1="$(iw)"
dconf write $K/$size_key "$none"
sleep 1.2
w2="$(iw)"
echo "icon widths: default=$w0 big=$w1 back=$w2"
check "bigger icons while the setting says so ($w1 > $w0)" "$([ "$w1" -gt "$w0" ]; echo $?)"
expect "back to the default size" "$w2" "$w0"

echo "-- ui #4: popup clamped to the work area (huge widths)"
reset_seed
dconf write $K/left-panel-width 1200
dconf write $K/menu-width-adjustment 800
dconf write $K/right-panel-width 600
dconf write $K/menu-height 1600
sleep 1
open_menu 1.5
dump_ui "$dev/ux/clamp.json"
python3 - "$dev/ux/clamp.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
x, y, w, h = d["menu"]
mw, mh = d["monitor"][2], d["monitor"][3]
print(f"popup {x:g},{y:g} {w:g}x{h:g} in monitor {mw}x{mh}")
sys.exit(0 if x >= 0 and y >= 0 and x + w <= mw and y + h <= mh else 1)
PY
check "huge settings still fit the monitor" $?
screenshot ui-clamp

echo "-- ui #6: keyboard leaves the category column cleanly"
reset_seed
open_menu 1.2
ui_call ShowView categories >/dev/null; sleep 0.6
n="$(count spawn-category-row)"
focus_class spawn-category-row $((n - 1))
key Down 0.4
expect "Down from the last category lands on the nav row" "$(state_get layout.focus)" "St_Button.spawn-nav-button"
focus_class spawn-category-row 0
key Up 0.4
expect "Up from the first category stays (search is at the bottom)" "$(state_get layout.focus)" "St_Button.spawn-category-row"

echo "-- ui #7: Down in the entry while results are pending/empty keeps the focus"
reset_seed
open_menu 1.2
ui_call Search zzzzqq >/dev/null; sleep 1
key Down 0.4
expect "focus stays in the entry" "$(state_get layout.focus | cut -c1-12)" "Clutter_Text"

echo "-- ui #11: Delete Folder moves the apps to the top level"
reset_seed
open_menu 1.5
focus_class $FOLDER 1
key Menu 1; key Down 0.3; key Down 0.3; key Return 0.8   # Open, Rename, Delete Folder
ids="$(pinned_ids)"
echo "pinned: $ids"
echo "$ids" | grep -q 3c2219f1 && { echo "FAIL folder still there"; status=1; } || echo "ok   folder entry gone"
echo "$ids" | grep -q com.heroicgameslauncher.hgl.desktop && echo "ok   its apps are pinned at the top level" || { echo "FAIL apps lost"; status=1; }

echo "-- ui #10: custom command tiles have a context menu and never go into folders"
reset_seed
dconf write $K/pinned-apps "[{'id': 'echo hi', 'name': 'Echo', 'icon': 'utilities-terminal'}, {'id': 'steam.desktop'}, {'id': '7d610436-4b17-46cf-99db-97578edac1c1', 'name': 'Internet', 'isFolder': 'true'}]"
sleep 1
open_menu 1.5
src="$(center $ITEM 0)"; dst="$(center $FOLDER 0)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
echo "$(folder_ids 7d610436-4b17-46cf-99db-97578edac1c1)" | grep -q "echo hi" && { echo "FAIL command dropped into a folder"; status=1; } || echo "ok   command tile rejected by the folder"
reset_seed
dconf write $K/pinned-apps "[{'id': 'echo hi', 'name': 'Echo', 'icon': 'utilities-terminal'}, {'id': 'steam.desktop'}]"
sleep 1
open_menu 1.5
focus_class $ITEM 0
key Menu 1; key Return 0.8
echo "$(pinned_ids)" | grep -q "echo hi" && { echo "FAIL command still pinned"; status=1; } || echo "ok   Unpin from Menu works on a command tile"

echo "-- ux #16: search entry position Auto follows the panel (top panel -> entry on top)"
reset_seed
dconf write $K/search-entry-location "'Auto'"
sleep 1
open_menu 1.5
expect_state "Auto under a top panel puts the entry on top" layout.searchTop true
dconf write $K/search-entry-location "'Bottom'"
sleep 1; close_menu; open_menu 1.2
expect_state "Bottom stays at the bottom" layout.searchTop false

echo "-- ux #12/#13: wired settings (generic names, multi-lined labels, button icon style)"
reset_seed
open_menu 1.2
ui_call ShowView categories >/dev/null; sleep 0.6
first_a="$(dump_ui "$dev/ux/g0.json"; python3 -c 'import json; d=json.load(open("'"$dev/ux/g0.json"'")); print([i["text"] for i in d["items"] if "spawn-row-label" in i.get("cls","")][13:])')"
dconf write $K/apps-show-generic-names true
sleep 1.2
second_a="$(dump_ui "$dev/ux/g1.json"; python3 -c 'import json; d=json.load(open("'"$dev/ux/g1.json"'")); print([i["text"] for i in d["items"] if "spawn-row-label" in i.get("cls","")][13:])')"
echo "names:   $first_a"
echo "generic: $second_a"
check "generic names change the app rows" "$([ "$first_a" != "$second_a" ]; echo $?)"
dconf write $K/icon-style-buttons "'Full_Color'"
sleep 1
screenshot ui-fullcolor-buttons

echo "-- no new Clutter criticals during all of the above"
expect "Clutter criticals" "$(clutter_criticals)" "$crit0"

echo "-- many pinned apps: scrollbar must not clip the last column"
reset_seed
ids=""
for i in $(seq 1 24); do ids="$ids{'id': 'ghost$i.desktop'}, "; done
dconf write $K/pinned-apps "[$ids{'id': 'steam.desktop'}]"
sleep 1
open_menu 1.5
dump_ui "$dev/ux/many.json"
python3 - "$dev/ux/many.json" "$ITEM" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
tiles = [i for i in d["items"] if sys.argv[2] in i.get("cls", "").split() and i["w"] > 0]
scroll = next(i for i in d["items"] if "spawn-pinned" in i.get("cls", "").split())
over = max(t["x"] + t["w"] for t in tiles) - (scroll["x"] + scroll["w"])
print(f"{len(tiles)} visible tile actors, rightmost tile edge is {over:+g} px from the scroll view edge")
sys.exit(0 if over <= 0 else 1)
PY
check "last tile column / row is not clipped by the scrollbar" $?
screenshot ui-many

echo "-- light shell theme: the popup tags itself and uses dark-on-light tints"
reset_seed
dconf write $K/override-menu-theme true
dconf write $K/menu-background-color "'rgb(246,245,244)'"
dconf write $K/menu-foreground-color "'rgb(36,31,49)'"
sleep 1.2
close_menu; open_menu 1.5
screenshot ui-light
ui_call ShowView categories >/dev/null; sleep 0.6
screenshot ui-light-allapps
