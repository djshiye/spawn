# pinned-apps-display = List (the default): pinned apps and folders as full-width rows.
# Geometry, keyboard, context menus, vertical drag & drop (top / middle / bottom band), ghosts,
# tooltips, scrolling and live List <-> Grid switching. Targets come from the live actor tree.
set_display List
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
mkdesktop() { # id name [exec]
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=%s\nIcon=utilities-terminal\n' "$2" "${3:-true}" >"$apps/$1"
}
clutter_criticals() { grep -c "Clutter-CRITICAL\|clutter_actor_add_child" "$log" || true; }
crit0="$(clutter_criticals)"
edge_y() { # <class> <nth> <top|bottom>: x centre, 4 px inside the top / bottom edge
    python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+4 if sys.argv[2]=="top" else y+h-4))' "$(rect "$1" "$2")" "$3"
}
mkdir -p "$dev/ux"
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
F_TARKY=7d76d6f0-79d7-40fb-87f8-8838ebe22b19
# the Tarky folder's two apps exist in the sandbox for the folder-view drag & drop below
mkdesktop "SPT - Server.desktop" "Tarky Server"
mkdesktop "SPT - Launcher.desktop" "Tarky Launcher"
sleep 2.5

echo "-- list geometry"
open_menu 1.5
expect_state "display is List" layout.display List
expect_state "6 entries" layout.tiles 6
expect "6 pinned rows" "$(count spawn-pinned-row)" 6
expect "3 folder rows" "$(count spawn-folder-row)" 3
expect "no grid tiles" "$(count spawn-tile)" 0
python3 - "$(rect spawn-pinned-row 0)" "$(rect spawn-pinned 0)" "$(rect spawn-shortcut-row 0)" <<'PY'
import json, sys
r, scroll, sc = (json.loads(a) for a in sys.argv[1:4])
print(f"row {r}  scroll {scroll}  right-pane shortcut row {sc}")
ok = r[3] >= 32 and abs(r[0] - scroll[0]) <= 1 and scroll[0] + scroll[2] - (r[0] + r[2]) <= 6
sys.exit(0 if ok else 1)
PY
check "pinned rows are >= 32 high and fill the pane width" $?
dump_ui "$dev/ux/list.json"
python3 "$root/tools/dev/ux-measure.py" "$dev/ux/list.json" --check; check "pinned list meets the UX targets" $?
screenshot ui-list-pinned

echo "-- keyboard: Down walks the rows, Return opens a folder row, Escape comes back"
expect "focus starts in the search entry" "$(state_get layout.focus | cut -c1-12)" "Clutter_Text"
key Down 0.5
expect "Down focuses the first row" "$(state_get layout.focus)" "St_Button.spawn-pinned-row"
expect_state "... at index 0" layout.focusIndex 0
key Down 0.5; key Down 0.5
expect_state "Down x3 is the third row" layout.focusIndex 2
key Down 0.5
expect "the fourth row is a folder" "$(state_get layout.focus)" "St_Button.spawn-pinned-row spawn-folder-row"
key Up 0.5
expect_state "Up goes back one row" layout.focusIndex 2
key Down 0.5
expect_state "Down returns to the folder row" layout.focusIndex 3
key Return 0.8
expect_state "Return on a folder row opens the folder view" layout.view folder
expect_state "the folder is the Internet folder" layout.folder "$F_INTERNET"
expect "folder contents are rows too" "$(count spawn-pinned-row)" "$(state_get layout.folderTiles)"
expect "no tiles in the folder view" "$(count spawn-tile)" 0
screenshot ui-list-folder
key Escape 0.6
expect_state "Escape returns to the pinned list" layout.view pinned
echo "-- Right leaves the list for the right pane; Tab cycle stays in the layout"
focus_class spawn-pinned-row 0
key Right
check "Right moves to the right pane" "$([ "$(state_get layout.focus)" != "St_Button.spawn-pinned-row" ]; echo $?)"
focus_class spawn-pinned-row 0
for i in 1 2 3 4 5 6; do key Tab 0.25; done
expect_state "focus still in the layout after the Tab cycle" layout.focusInLayout true

echo "-- context menus: app row (Menu key), folder row (right click), ghost row (Unpin)"
focus_class spawn-pinned-row 0
key Menu 1
expect "context menu of an app row" "$(count spawn-context-menu)" 1
screenshot ui-list-context-app
key Escape 0.6
expect "Escape closes only the context menu" "$(count spawn-context-menu)" 0
expect_state "popup still open" open true
click_class spawn-folder-row 0 3
expect "context menu of a folder row" "$(count spawn-context-menu)" 1
screenshot ui-list-context-folder
key Escape 0.6
dconf write $K/pinned-apps "[{'id': 'steam.desktop'}, {'id': 'spawn-list-gone.desktop'}]"
sleep 1
close_menu; open_menu 1.5
expect "one ghost row" "$(count spawn-tile-missing)" 1
screenshot ui-list-ghost
focus_class spawn-tile-missing 0
key Menu 1; key Return 0.8
echo "pinned: $(pinned_ids)"
echo "$(pinned_ids)" | grep -q spawn-list-gone && { echo "FAIL ghost still pinned"; status=1; } || echo "ok   Unpin removed the ghost row"

echo "-- folder row context menu: Delete dissolves the folder"
reset_seed
open_menu 1.5
focus_class spawn-folder-row 1
key Menu 1; key Down 0.3; key Down 0.3; key Return 0.8   # Open, Rename, Delete Folder
ids="$(pinned_ids)"
echo "$ids" | grep -q 3c2219f1 && { echo "FAIL folder still there"; status=1; } || echo "ok   folder entry gone"
echo "$ids" | grep -q com.heroicgameslauncher.hgl.desktop && echo "ok   its apps are pinned at the top level" || { echo "FAIL apps lost"; status=1; }

echo "-- drag & drop: app onto app (middle band) creates a folder"
reset_seed
open_menu 1.5
before="$(pinned_ids)"
src="$(center spawn-pinned-row 0)"; dst="$(center spawn-pinned-row 1)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
screenshot ui-list-dnd-newfolder
after="$(pinned_ids)"
expect "one entry fewer after merging two apps" "$(echo "$after" | wc -w)" "$(( $(echo "$before" | wc -w) - 1 ))"
echo "$after" | grep -q 'steam.desktop' && { echo "FAIL steam still top-level"; status=1; } || echo "ok   steam is no longer top-level"

echo "-- drag & drop: top band reorders (Husk to the front)"
reset_seed
open_menu 1.5
src="$(center spawn-pinned-row 2)"; dst="$(edge_y spawn-pinned-row 0 top)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
now="$(pinned_ids)"
echo "pinned: $now"
expect "Husk is first" "$(echo "$now" | cut -d' ' -f1)" "husk.desktop"

echo "-- drag & drop: bottom band reorders (Steam below Claude)"
reset_seed
open_menu 1.5
src="$(center spawn-pinned-row 0)"; dst="$(edge_y spawn-pinned-row 1 bottom)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
now="$(pinned_ids)"
echo "pinned: $now"
expect "Claude, Steam, Husk order" "$(echo "$now" | cut -d' ' -f1-3)" "com.anthropic.Claude.desktop steam.desktop husk.desktop"

echo "-- drag & drop: app onto a folder row adds it"
reset_seed
open_menu 1.5
src="$(center spawn-pinned-row 1)"; dst="$(center spawn-folder-row 0)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
echo "Internet folder: $(folder_ids $F_INTERNET)"
echo "$(folder_ids $F_INTERNET)" | grep -q 'com.anthropic.Claude.desktop' && echo "ok   Claude dropped into the Internet folder" || { echo "FAIL Claude not in the Internet folder"; status=1; }

echo "-- drag & drop inside a folder: reorder rows, drag out onto the header"
reset_seed
open_menu 1.5
ui_call OpenFolder 2 >/dev/null; sleep 0.8
expect_state "Tarky folder open" layout.folder "$F_TARKY"
expect "two folder rows" "$(count spawn-pinned-row)" 2
echo "Tarky before: $(folder_ids $F_TARKY)"
screenshot ui-list-folder-tarky
src="$(center spawn-pinned-row 1)"; dst="$(edge_y spawn-pinned-row 0 top)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "rows swapped by the top-band drop" "$(folder_ids $F_TARKY)" "SPT - Launcher.desktop SPT - Server.desktop"
src="$(center spawn-pinned-row 0)"; dst="$(center spawn-folder-header 0)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
echo "Tarky after: $(folder_ids $F_TARKY)   top level: $(pinned_ids)"
echo "$(pinned_ids)" | grep -q 'SPT - Launcher.desktop' && echo "ok   dragged out of the folder to the top level" || { echo "FAIL not taken out of the folder"; status=1; }

echo "-- tooltips only when the name is truncated"
reset_seed
dconf write $K/pinned-apps "[{'id': 'echo hi', 'name': 'A command with a very very long name that cannot fit into one pinned list row at all', 'icon': 'utilities-terminal'}, {'id': 'steam.desktop'}]"
open_menu 1.5
ui_call Move 300 300 >/dev/null; sleep 0.4
move_class spawn-pinned-row 0 1.5
check "truncated name shows its tooltip" "$([ "$(state_get layout.tooltip)" != null ]; echo $?)"
echo "tooltip: $(state_get layout.tooltip)"
screenshot ui-list-tooltip
ui_call Move 300 300 >/dev/null; sleep 0.5
move_class spawn-pinned-row 1 1.5
expect "short name: no tooltip" "$(state_get layout.tooltip)" null

echo "-- multi-lined labels / generic names rebuild the rows"
reset_seed
printf '[Desktop Entry]\nType=Application\nName=Zq Probe\nGenericName=Zq Generic\nExec=true\nIcon=utilities-terminal\n' >"$apps/spawn-gn.desktop"
sleep 2.5
dconf write $K/pinned-apps "[{'id': 'spawn-gn.desktop'}, {'id': 'steam.desktop'}]"
sleep 1
open_menu 1.5
lbl() { dump_ui "$dev/ux/$1.json"; python3 -c 'import json; d=json.load(open("'"$dev/ux/$1.json"'")); print([i["text"] for i in d["items"] if "spawn-row-label" in i.get("cls","")][:6])'; }
n0="$(lbl l0)"
h0="$(rect spawn-pinned-row 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3]))')"
dconf write $K/apps-show-generic-names true; sleep 1.2
n1="$(lbl l1)"
echo "names:   $n0"; echo "generic: $n1"
check "generic names change the pinned rows" "$([ "$n0" != "$n1" ]; echo $?)"
dconf write $K/apps-show-generic-names false
dconf write $K/multi-lined-labels true; sleep 1.2
expect "multi-lined labels leave the one-line rows alone (same height)" "$(rect spawn-pinned-row 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3]))')" "$h0"
dconf write $K/multi-lined-labels false; sleep 1

echo "-- many pinned apps scroll; keyboard focus scrolls the row into view"
reset_seed
ids=""
for i in $(seq 1 24); do ids="$ids{'id': 'ghost$i.desktop'}, "; done
dconf write $K/pinned-apps "[$ids{'id': 'steam.desktop'}]"
sleep 1
open_menu 1.5
focus_class spawn-pinned-row 24
sleep 0.6
python3 - "$(rect spawn-pinned-row 24)" "$(rect spawn-pinned 0)" <<'PY'
import json, sys
r, s = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print(f"focused row y {r[1]:g}..{r[1] + r[3]:g}, scroll view y {s[1]:g}..{s[1] + s[3]:g}")
sys.exit(0 if r[1] >= s[1] - 1 and r[1] + r[3] <= s[1] + s[3] + 1 else 1)
PY
check "the 25th row is scrolled into view" $?
screenshot ui-list-many

echo "-- live switching List -> Grid -> List while the menu is open"
reset_seed
open_menu 1.5
dconf write $K/pinned-apps-display "'Grid'"; sleep 1.5
expect_state "display switched to Grid" layout.display Grid
expect "no list rows left" "$(count spawn-pinned-row)" 0
expect "6 tiles" "$(count spawn-tile)" 6
dconf write $K/pinned-apps-display "'List'"; sleep 1.5
expect "6 rows again" "$(count spawn-pinned-row)" 6
expect "no tiles left" "$(count spawn-tile)" 0
echo "-- ... and inside an open folder"
ui_call OpenFolder 2 >/dev/null; sleep 0.8
expect "two folder rows" "$(count spawn-pinned-row)" 2
dconf write $K/pinned-apps-display "'Grid'"; sleep 1.5
expect_state "still in the folder view" layout.view folder
expect "two folder tiles" "$(count spawn-tile)" 2
expect "no rows" "$(count spawn-pinned-row)" 0
dconf write $K/pinned-apps-display "'List'"; sleep 1.5
expect "two folder rows again" "$(count spawn-pinned-row)" 2
key Escape 0.6
expect_state "Escape leaves the folder" layout.view pinned

echo "-- no new Clutter criticals during all of the above"
expect "Clutter criticals" "$(clutter_criticals)" "$crit0"
