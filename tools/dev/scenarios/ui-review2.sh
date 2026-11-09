# Regression checks for the second UI review (ui.md #1-#8) and the layout parts of the search review:
# folder Open / Rename from the context menu, Right arrow with the search entry on top, Back with
# search-hidden, stale-result keyboard cases, ghost drop rejection, drag auto-scroll, scroll-bar settings.
K=/org/gnome/shell/extensions/spawn
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
mkdir -p "$dev/ux"

echo "-- ui2 #1: folder context menu Open / Rename act on the folder"
reset_seed
open_menu 1.5
focus_class $FOLDER 0
key Menu 1; key Return 1
expect_state "context menu Open shows the folder" layout.view folder
expect_state "... the Internet folder" layout.folder "$F_INTERNET"
expect_state "... with the focus inside the layout" layout.focusInLayout true
key Escape 0.6
expect_state "Escape leaves the folder" layout.view pinned
focus_class $FOLDER 0
key Menu 1; key Down 0.3; key Return 1
expect_state "context menu Rename shows the folder" layout.view folder
expect_state "... and starts the inline rename" layout.renaming true
key Escape 0.6
expect_state "Escape cancels the rename" layout.renaming false

echo "-- ui2 #2: Right from a pinned row with the search entry on top"
reset_seed
dconf write $K/search-entry-location "'Top'"
sleep 1
close_menu; open_menu 1.2
expect_state "search entry on top" layout.searchTop true
focus_class $ITEM 0
key Right 0.4
echo "focus after Right: $(state_get layout.focus)"
state_get layout.focus | grep -q 'spawn-power-button' && { echo "FAIL Right landed on the power bar"; status=1; } || echo "ok   Right does not skip to the power bar"
# Since 1.2.0 Right goes to the right-pane item at the same height (ui-panes): the card or the first shortcuts.
state_get layout.focus | grep -Eq 'spawn-user-card|spawn-shortcut-row' && echo "ok   Right lands at the top of the right pane" || { echo "FAIL Right did not land at the top of the right pane"; status=1; }
dconf write $K/search-entry-location "'Bottom'"

echo "-- ui2 #3: closing a folder with search-hidden focuses the list, not the invisible entry"
reset_seed
dconf write $K/search-hidden true
sleep 1
close_menu; open_menu 1.2
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "folder open" layout.view folder
click_class spawn-folder-close 0
expect_state "Close leaves the folder" layout.view pinned
expect "focus is not the hidden entry" "$(state_get layout.focus | cut -c1-12 | grep -c Clutter_Text)" 0
expect_state "focus is in the layout" layout.focusInLayout true
key a 0.9
expect_state "typing reveals the entry and searches" layout.search a
dconf write $K/search-hidden false

echo "-- search #0/#1: stale rows are not focusable or activatable, and do not resurface"
reset_seed
open_menu 1.2
ui_call Search fire >/dev/null; sleep 1.5
check "'fire' has result rows" "$([ "$(count spawn-result-row)" -ge 1 ]; echo $?)"
ui_call Search zzzqq >/dev/null
key Down 0.4
expect "Down inside the stale window does not focus an old row" "$(state_get layout.focus | cut -c1-12)" "Clutter_Text"
ui_call Search fire >/dev/null; sleep 1.5
ui_call Search zzzqq >/dev/null
key Return 0.6
expect_state "Return inside the stale window launches nothing (menu stays open)" open true
sleep 1.5
expect_state "... and not later either" open true
echo "-- old rows do not resurface after the entry was cleared"
ui_call Search fire >/dev/null; sleep 1.5
key Escape 0.5
ui_call Search zzzqq >/dev/null
expect "no old rows right after the new query starts" "$(count spawn-result-row)" 0

echo "-- ui2 #5: ghost rows reject drops (nothing falls through to append-at-end)"
reset_seed
dconf write $K/pinned-apps "[{'id': 'steam.desktop'}, {'id': 'spawn-gone1.desktop'}, {'id': 'husk.desktop'}, {'id': 'com.anthropic.Claude.desktop'}]"
sleep 1
close_menu; open_menu 1.5
before="$(pinned_ids)"
src="$(center $ITEM 0)"; dst="$(center spawn-tile-missing 0)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "dropping on a ghost changes nothing" "$(pinned_ids)" "$before"
expect "the ghost is still there" "$(count spawn-tile-missing)" 1

echo "-- ui2 #6: dragging at the bottom edge of a long pinned list scrolls it"
reset_seed
ids=""
for i in $(seq 1 24); do ids="$ids{'id': 'spawn-gone$i.desktop'}, "; done
dconf write $K/pinned-apps "[{'id': 'steam.desktop'}, $ids{'id': 'husk.desktop'}]"
sleep 1
close_menu; open_menu 1.5
expect_state "list starts at the top" layout.pinnedScroll 0
src="$(center $ITEM 0)"
r="$(rect spawn-pinned 0)"
dst="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h-6))' "$r")"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.5
scrolled="$(state_get layout.pinnedScroll)"
echo "pinned scroll after the drag: $scrolled"
check "the list scrolled while the drag sat at its bottom edge" "$(python3 -c 'import sys; print(0 if float(sys.argv[1]) > 20 else 1)' "$scrolled")"

echo "-- ui2 #7: scroll-bar settings re-apply to the existing scroll views"
reset_seed
open_menu 1.2
dconf write $K/scrollview-fade-effect false
sleep 1
expect "no vfade scroll view after switching the fade off" "$(count vfade)" 0
dconf write $K/scrollview-fade-effect true
sleep 1
check "pinned list and shortcuts get the fade back ($(count vfade) views)" "$([ "$(count vfade)" -ge 2 ]; echo $?)"

echo "-- ui2 #4: grid follows a metrics change"
set_display Grid
reset_seed
open_menu 1.5
c0="$(state_get layout.columns)"; w0="$(state_get layout.tileWidth)"
dconf write $K/left-panel-width 700
sleep 1.2
c1="$(state_get layout.columns)"; w1="$(state_get layout.tileWidth)"
echo "columns/tile width: $c0/$w0 -> $c1/$w1"
check "more columns or wider tiles with the wider pane" "$([ "$c1" -gt "$c0" ] || [ "$w1" -gt "$w0" ]; echo $?)"
tw="$(rect spawn-tile-surface 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[2]))')"
expect "the visible tiles use the new tile width" "$tw" "$w1"
set_display List

echo "-- ui2 #8: State before the popup was ever shown logged no St critical"
expect "'not in the stage' criticals in the whole log" "$(grep -c 'not in the stage' "$log" || true)" 0
