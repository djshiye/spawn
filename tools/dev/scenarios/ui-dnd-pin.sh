# Drag an app that is not pinned yet out of All Apps to pin it (virtual pointer, targets from the live actor tree):
#   1. drop on the Back button ("Drop to pin" while dragging) -> pinned at the end, Undo banner, Undo works
#   2. rest on Back for the spring-load delay -> the pane switches to Pinned mid-drag -> drop at an exact slot
#   3. the same onto a folder
#   4. an already pinned app dragged from All Apps moves instead of duplicating
#   5. a drop on nothing (the search entry) cancels cleanly; a plain click on a row still launches nothing odd
#   6. the same in the pinned GRID
back_c() { center spawn-nav-button 0; }
row_c() { center spawn-list-row "$1"; }
# Where an entry of the PINNED view sits, measured before the drag (while All Apps shows, those entries are hidden):
# `pinned_pt <class> <nth> <fx> <fy>` = point at fraction fx / fy of the entry, after a round trip through the view.
pinned_pt() {
    ui_call ShowView pinned >/dev/null; sleep 0.9
    python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w*float(sys.argv[2])), round(y+h*float(sys.argv[3])))' "$(rect "$1" "$2")" "$3" "$4"
    ui_call ShowView all >/dev/null; sleep 1.2
}
count_in() { python3 -c 'import sys; ids=sys.argv[2].split(); print(ids.count(sys.argv[1]))' "$1" "$2"; }

echo "== List: drop on the Back button"
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
expect_state "All Apps shows" layout.view all
before="$(pinned_ids)"
echo "pinned before: $before"
src="$(row_c 2)"; dst="$(back_c)"
echo "source row at $src, Back at $dst"
ui_call Move $src >/dev/null; sleep 0.4
ui_call Drag $src $dst >/dev/null
sleep 0.78 # the pointer has just arrived on Back (the drop follows 250 ms later, before the spring-load delay)
echo "label while dragging: $(ui_call TextRect 'Drop to pin' 0 | unwrap)"
screenshot ui-dnd-pin-1-over-back
sleep 2.2
after="$(pinned_ids)"
echo "pinned after: $after"
set -- $before; nb=$#; set -- $after; na=$#
expect "one app more after dropping on Back" "$na" "$((nb + 1))"
new="$(python3 -c 'import sys; b=sys.argv[1].split(); print(" ".join(x for x in sys.argv[2].split() if x not in b))' "$before" "$after")"
echo "new: $new"
expect "the new app is last" "$(echo "$after" | awk '{print $NF}')" "$new"
screenshot ui-dnd-pin-2-after-drop
expect_state "the view did not change (drop on Back)" layout.view all
check "the nav button reads Back again" "$([ -n "$(ui_call TextRect Back 0 | unwrap)" ] && echo 0 || echo 1)"
echo "-- Undo"
key Ctrl+z 0.8
expect "Ctrl+Z restores the list" "$(pinned_ids)" "$before"

echo "== List: spring-load, drop between two pinned apps"
reset_seed
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
before="$(pinned_ids)"
slot="$(pinned_pt spawn-pinned-row 1 0.5 0.08)"
src="$(row_c 2)"; dst="$(back_c)"
ui_call Move $src >/dev/null; sleep 0.4
# rest on Back (the pane springs to Pinned), then move to the top edge of the second pinned row
ui_call DragVia $src $dst 1800 $slot >/dev/null
sleep 2.9
expect_state "the pane sprang to Pinned while the drag continues" layout.view pinned
screenshot ui-dnd-pin-3-sprung
sleep 1.6
after="$(pinned_ids)"
echo "pinned after: $after"
set -- $after
expect "second slot holds the dropped app" "$(echo "$after" | awk '{print $1" "$3}')" "$(echo "$before" | awk '{print $1" "$2}')"
set -- $before; nb=$#; set -- $after; na=$#
expect "one app more" "$na" "$((nb + 1))"
screenshot ui-dnd-pin-4-slot

echo "== List: spring-load, drop onto a folder"
reset_seed
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
onto="$(pinned_pt spawn-folder-row 0 0.5 0.5)"
src="$(row_c 2)"; dst="$(back_c)"
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
fb="$(folder_ids $F_INTERNET)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call DragVia $src $dst 1800 $onto >/dev/null
sleep 5
fa="$(folder_ids $F_INTERNET)"
echo "Internet folder: $fb -> $fa"
set -- $fb; nb=$#; set -- $fa; na=$#
expect "the folder got one app more" "$na" "$((nb + 1))"
expect "no new top-level entry" "$(pinned_ids | wc -w)" "$(echo "6")"
screenshot ui-dnd-pin-5-folder

echo "== List: an already pinned app dragged from All Apps moves, no duplicate"
reset_seed
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
before="$(pinned_ids)"
r="$(ui_call TextRect Claude 0 | unwrap)"
echo "Claude label rect: $r"
if [ -n "$r" ]; then
    src="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+10), round(y+h/2))' "$r")"
    ui_call Move $src >/dev/null; sleep 0.4
    ui_call Drag $src $(back_c) >/dev/null; sleep 2.6
    after="$(pinned_ids)"
    echo "pinned after: $after"
    expect "Claude is still pinned exactly once" "$(count_in com.anthropic.Claude.desktop "$after")" 1
    expect "Claude moved to the end" "$(echo "$after" | awk '{print $NF}')" "com.anthropic.Claude.desktop"
else
    echo "FAIL no Claude row"; status=1
fi

echo "== List: a drop on nothing cancels"
reset_seed
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
before="$(pinned_ids)"
src="$(row_c 2)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call Drag $src $(center spawn-search-box 0) >/dev/null; sleep 2.6
expect "nothing pinned" "$(pinned_ids)" "$before"
expect_state "still All Apps" layout.view all
expect_state "menu stays open" open true

echo "== Grid: drop on Back, and spring-load onto a tile edge"
set_display Grid
reset_seed
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
before="$(pinned_ids)"
slot="$(pinned_pt spawn-tile 1 0.04 0.5)"
src="$(row_c 2)"; dst="$(back_c)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call DragVia $src $dst 1800 $slot >/dev/null
sleep 3.2
screenshot ui-dnd-pin-6-grid-sprung
sleep 1.6
after="$(pinned_ids)"
echo "pinned after: $after"
expect "grid: second slot holds the dropped app" "$(echo "$after" | awk '{print $1" "$3}')" "$(echo "$before" | awk '{print $1" "$2}')"
screenshot ui-dnd-pin-7-grid-after

echo "== Light menu colours: the same drag, mid-drag over Back and sprung to Pinned"
K=/org/gnome/shell/extensions/spawn
set_display List
reset_seed
dconf write $K/override-menu-theme true
dconf write $K/menu-background-color "'rgb(245,247,250)'"
dconf write $K/menu-foreground-color "'rgb(18,51,84)'"
dconf write $K/menu-border-color "'rgba(18,51,84,0.2)'"
close_menu; open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
src="$(row_c 2)"; dst="$(back_c)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call Drag $src $dst >/dev/null
sleep 0.78
screenshot ui-dnd-pin-8-light-over-back
sleep 2.2
ui_call ShowView all >/dev/null; sleep 1.2
src="$(row_c 4)"; slot="$(pinned_pt spawn-pinned-row 1 0.5 0.08)"
ui_call Move $src >/dev/null; sleep 0.4
ui_call DragVia $src $dst 1800 $slot >/dev/null
sleep 3.2
screenshot ui-dnd-pin-9-light-sprung
sleep 1.6
dconf reset $K/override-menu-theme; dconf reset $K/menu-background-color; dconf reset $K/menu-foreground-color; dconf reset $K/menu-border-color
