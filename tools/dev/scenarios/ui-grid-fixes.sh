# Four fixes of the Grid layout (layout-style Grid), each with screenshots (grid-fix-*.png):
#   1. dragging an app out of All apps: the header's "Pinned" pill becomes "Drop to pin" (pin icon, drop-ready, accessible
#      name), a drop on it pins at the end (Undo banner), resting on it springs to Pinned mid-drag, the pill is back to
#      normal afterwards
#   2. a folder on page 2 opened while page 1 shows: the pager turns to its page first, the lit tile and the card sit
#      inside the menu (also for Add to Folder > New Folder); closing leaves the page and the focus on the folder tile
#   3. Page Down / Page Up in the (empty) search entry turn the page and leave the focus in the entry; with a query typed
#      they do not
#   4. dragging a pinned tile: resting at the bottom / top edge of the grid turns one whole page (dots stay visible,
#      the grid never rests between two pages), resting on a page dot jumps to it, a drop lands on the page that shows
# Seed: 24 pinned apps + the Internet folder = 25 entries = two pages of 4 x 6; Boxes and Music are not pinned.
K=/org/gnome/shell/extensions/spawn
leave_overview
cls() { ui_call FocusInfo | unwrap | json_get cls; }
ftype() { ui_call FocusInfo | unwrap | json_get type; }
has_text() { local r; r="$(ui_call TextRect "$1" 0 | unwrap)"; [ -n "$r" ] && [ "$r" != "null" ] && echo 0 || echo 1; }
click_text() { # label
    local r
    r="$(ui_call TextRect "$1" 0 | unwrap)"
    [ -n "$r" ] && [ "$r" != "null" ] || { echo "FAIL no visible text '$1'"; status=1; return 1; }
    click $(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h/2))' "$r")
}
# a point at fraction fx / fy of the nth visible actor with a style class
frac() { python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w*float(sys.argv[2])), round(y+h*float(sys.argv[3])))' "$(rect "$1" "$2")" "$3" "$4"; }
# "yes" when rect A lies inside rect B (2 px slack)
inside() { python3 -c '
import json, sys
a = json.loads(sys.argv[1]); b = json.loads(sys.argv[2])
print("yes" if a[0] >= b[0] - 2 and a[1] >= b[1] - 2 and a[0] + a[2] <= b[0] + b[2] + 2 and a[1] + a[3] <= b[1] + b[3] + 2 else "no")' "$1" "$2"; }

APPS="org.gnome.Nautilus org.gnome.Ptyxis org.gnome.Settings org.gnome.Software org.gnome.TextEditor org.gnome.Calendar steam
com.discordapp.Discord com.anthropic.Claude org.gnome.Calculator org.gnome.Weather org.gnome.Maps org.gnome.Clocks org.gnome.Contacts
org.gnome.Characters org.gnome.Loupe org.gnome.Papers com.usebottles.bottles eden husk com.github.tchx84.Flatseal
com.mattjakeman.ExtensionManager org.prismlauncher.PrismLauncher org.gnome.Totem"
INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
fresh() {
    reset_seed
    local list="" id
    for id in $APPS; do list="$list{'id': '$id.desktop'}, "; done
    dconf write $K/pinned-apps "[${list}{'id': '$INTERNET', 'name': 'Internet', 'isFolder': 'true'}]"
    dconf write $K/layout-style "'Grid'"
    sleep 1.5
    open_menu 1.5
}

fresh
expect_state "Grid layout" layout.layoutStyle Grid
expect_state "two pages" layout.gridPages 2
expect_state "page one shows" layout.gridPage 0

echo "== 1. drag from All apps onto the header pill"
ui_call ShowView all >/dev/null; sleep 1.5
expect_state "All apps shows" layout.view all
expect "no drop-ready pill before the drag" "$(count spawn-drop-ready)" 0
before="$(pinned_ids)"
nb=$(echo "$before" | wc -w)
src="$(center spawn-tile 1)"; dst="$(center spawn-grid-header-button 0)"
echo "second tile at $src (Boxes, not pinned; bottles sorts first), pill at $dst"
ui_call Move $src >/dev/null; sleep 0.4
ui_call Drag $src $dst >/dev/null
sleep 0.78 # the pointer has just arrived on the pill (the drop follows 250 ms later, before the spring-load delay)
check "the pill reads Drop to pin" "$(has_text 'Drop to pin')"
check "the title still says All apps" "$(has_text 'All apps')"
expect "the pill is marked drop-ready" "$(count spawn-drop-ready)" 1
check "the pill's accessible name is Drop to pin" "$(ui_call A11y | unwrap | python3 -c '
import json, sys
print(0 if any(i.get("name") == "Drop to pin" for i in json.load(sys.stdin)["items"]) else 1)')"
screenshot grid-fix-1-over-pill
sleep 2.2
after="$(pinned_ids)"
expect "one app more after the drop" "$(echo "$after" | wc -w)" "$((nb + 1))"
expect "Boxes is pinned at the end" "$(echo "$after" | awk '{print $NF}')" "org.gnome.Boxes.desktop"
expect "the Undo banner shows" "$(count spawn-undo-banner)" 1
expect_state "still All apps" layout.view all
check "the pill reads Pinned again" "$(has_text 'Pinned')"
check "no Drop to pin left" "$([ "$(has_text 'Drop to pin')" = 1 ] && echo 0 || echo 1)"
expect "no drop-ready left" "$(count spawn-drop-ready)" 0
screenshot grid-fix-1-after-drop
key Ctrl+z 0.8
expect "Ctrl+Z restores the pins" "$(pinned_ids)" "$before"

echo "-- spring-load to Pinned, drop between two tiles"
ui_call ShowView pinned >/dev/null; sleep 0.9
slot="$(frac spawn-tile 1 0.08 0.5)"
ui_call ShowView all >/dev/null; sleep 1.2
src="$(center spawn-tile 1)"; dst="$(center spawn-grid-header-button 0)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call DragVia $src $dst 1800 $slot >/dev/null
sleep 2.7
expect_state "the pane sprang to Pinned with the drag running" layout.view pinned
check "the header pill is the All apps one again" "$(has_text 'All apps')"
screenshot grid-fix-1-sprung
sleep 1.6
expect "Boxes landed between the first two tiles" "$(pinned_ids | cut -d' ' -f2)" "org.gnome.Boxes.desktop"
expect "one app more" "$(pinned_ids | wc -w)" "$((nb + 1))"
expect "the view is Pinned afterwards" "$(state_get layout.view)" pinned

echo "== 2. a folder on page two, opened from page one"
fresh
expect_state "page one shows" layout.gridPage 0
ui_call OpenFolder 0 >/dev/null; sleep 1.2
expect_state "the pager turned to the folder's page" layout.gridPage 1
expect_state "the folder popup is open" layout.view folder
paged="$(rect spawn-grid-paged 0)"
expect "the lit folder tile is inside the grid area" "$(inside "$(rect spawn-folder-open 0)" "$paged")" yes
expect "the card is inside the menu" "$(inside "$(rect spawn-folder-popup 0)" "$(rect spawn-folder-scrim 0)")" yes
footer_top="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[1])' "$(rect spawn-grid-footer 0)")"
card_bottom="$(python3 -c 'import json,sys; r=json.loads(sys.argv[1]); print(r[1]+r[3])' "$(rect spawn-folder-popup 0)")"
tile_bottom="$(python3 -c 'import json,sys; r=json.loads(sys.argv[1]); print(r[1]+r[3])' "$(rect spawn-folder-open 0)")"
check "the lit tile ends above the footer ($tile_bottom <= $footer_top)" "$([ "$tile_bottom" -le "$footer_top" ]; echo $?)"
echo "card bottom $card_bottom, footer top $footer_top"
screenshot grid-fix-2-folder-page-two
key Escape 0.8
expect_state "closing returns to Pinned" layout.view pinned
expect_state "the pager stays on the folder's page" layout.gridPage 1
check "the focus is on the folder tile" "$(cls | grep -q spawn-folder-tile && echo 0 || echo 1)"
screenshot grid-fix-2-closed

echo "-- Add to Folder > New Folder (it takes the app's slot on the page that shows; the card stays inside the menu)"
fresh
click_class spawn-tile 0 3
click_text "Add to Folder"; sleep 0.5
click_text "New Folder"; sleep 1.2
expect_state "the new folder is open" layout.view folder
expect_state "still page one" layout.gridPage 0
expect "the card is inside the menu" "$(inside "$(rect spawn-folder-popup 0)" "$(rect spawn-folder-scrim 0)")" yes
expect "the lit tile is inside the grid area" "$(inside "$(rect spawn-folder-open 0)" "$(rect spawn-grid-paged 0)")" yes
screenshot grid-fix-2-new-folder
key Escape 0.8
key Escape 0.8
expect_state "back on Pinned" layout.view pinned

echo "== 3. Page Down / Page Up in the search entry"
fresh
expect "the entry has the focus" "$(ftype)" "Clutter_Text"
key Page_Down 0.9
expect_state "Page Down: second page" layout.gridPage 1
expect "the focus stays in the entry" "$(ftype)" "Clutter_Text"
screenshot grid-fix-3-page-down-from-entry
key Page_Down 0.7
expect_state "Page Down on the last page stays" layout.gridPage 1
key Page_Up 0.9
expect_state "Page Up: first page" layout.gridPage 0
expect "the focus is still in the entry" "$(ftype)" "Clutter_Text"
ui_call Search cal >/dev/null; sleep 1.5
expect_state "results show" layout.view results
key Page_Down 0.8
expect_state "with a query typed the grid does not turn" layout.gridPage 0
expect_state "still the results" layout.view results
ui_call Search "" >/dev/null; sleep 1
expect_state "back on Pinned" layout.view pinned

echo "== 4. dragging a pinned tile across pages"
fresh
first="$(pinned_ids | cut -d' ' -f1)"
n=$(pinned_ids | wc -w)
t0="$(center spawn-tile 0)"
r="$(rect spawn-grid-paged 0)"
bottom="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h-8))' "$r")"
empty="$(frac spawn-grid-paged 0 0.8 0.3)"
ui_call Move $t0 >/dev/null; sleep 0.4
ui_call DragVia $t0 $bottom 1500 $empty >/dev/null
sleep 1.9 # the pointer rests at the bottom edge since ~1.1 s; the first turn comes after 450 ms
expect_state "the bottom edge turned to page two" layout.gridPage 1
pager="$(state_get layout.pager)"
expect "the grid rests on a whole page" "$(echo "$pager" | json_get value)" "$(echo "$pager" | json_get pageH)"
expect "the page dots are still there" "$(echo "$pager" | json_get dots)" true
expect "the dots are visible" "$(count spawn-grid-dot)" 2
screenshot grid-fix-4-edge-turned
sleep 2.2
expect_state "the drop is on page two" layout.gridPage 1
expect "the dragged app moved to the end (the page that shows)" "$(pinned_ids | awk '{print $NF}')" "$first"
expect "no app lost or doubled" "$(pinned_ids | wc -w)" "$n"

echo "-- the top edge goes back"
screenshot grid-fix-4-before-top-edge
ids="$(pinned_ids)"
t1="$(center spawn-tile $((n - 1)))" # the last entry: page two shows it only
top="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+6))' "$(rect spawn-grid-paged 0)")"
away="$(center spawn-grid-title 0 2>/dev/null || center spawn-search-box 0)" # a neutral spot: no drop target
ui_call Move $t1 >/dev/null; sleep 0.4
ui_call DragVia $t1 $top 1400 $away >/dev/null
sleep 3.6
expect_state "the top edge turned back to page one" layout.gridPage 0
echo "page after the top-edge drag: $(state_get layout.gridPage)"
expect "nothing changed (released on no target)" "$(pinned_ids)" "$ids"
pager="$(state_get layout.pager)"
expect "whole page" "$(echo "$pager" | json_get value)" "0"

echo "-- hovering a page dot"
t2="$(center spawn-tile 0)"
dot1="$(center spawn-grid-dot 1)"
ui_call Move $t2 >/dev/null; sleep 0.4
ui_call DragVia $t2 $dot1 1200 $dot1 >/dev/null
sleep 2.4
screenshot grid-fix-4-dot-hover
sleep 1
expect_state "resting on the second dot jumps to page two" layout.gridPage 1
expect "nothing changed" "$(pinned_ids)" "$ids"

echo "-- a short touch of the edge does not turn"
close_menu; open_menu 1.5
t3="$(center spawn-tile 0)"
bottom="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h-8))' "$(rect spawn-grid-paged 0)")"
ui_call Move $t3 >/dev/null; sleep 0.4
ui_call DragVia $t3 $bottom 100 $t3 >/dev/null
sleep 2.4
expect_state "no turn without resting" layout.gridPage 0

dconf reset $K/layout-style
