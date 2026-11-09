# One highlight at a time in every list and grid (UX audit U7; the folder popup's rule from 1.1.2): pointing
# at an item takes the focus ring off any other item, the next key acts on the pointed-at item (arrows move on
# from it, Return activates it), and a key clears the hover tint under a resting pointer.
foc() { state_get layout.focus | cut -d. -f1; }
echo "-- pinned list"
open_menu 1.2
key Down
expect_state "Down focuses the first pinned app" layout.focusIndex 0
move_class $ITEM 2 0.6
expect "pointing at another app takes the focus ring off the first (the layout holds the focus)" "$(foc)" "St_Widget"
expect "one highlight: the pointed-at app" "$(state_get layout.hoverTints)" '["Husk"]'
screenshot ui-highlight-pinned
key Down 0.4
expect_state "Down moves on from the pointed-at app" layout.focusIndex 3
expect "the key cleared the hover tint under the resting pointer" "$(state_get layout.hoverTints)" '[]'
key Up 0.3
move_class $ITEM 4 0.6
key Return 1
expect_state "Return acts on the pointed-at entry (a folder opens)" layout.view folder
key Escape 0.6
close_menu

echo "-- right pane: a focused shortcut loses its ring to a pointed-at pinned app"
open_menu 1.2
focus_class spawn-shortcut-row 1
move_class $ITEM 1 0.6
expect "the layout holds the focus" "$(foc)" "St_Widget"
expect "one highlight: the pointed-at app" "$(state_get layout.hoverTints)" '["Claude"]'
key Right 0.4
expect "Right moves on from the pointed-at app into the right pane" "$(state_get layout.focus | cut -d. -f2 | cut -d' ' -f1)" "spawn-shortcut-row"
close_menu

echo "-- All Apps: hover and arrows share one highlight"
open_menu 1.2
ui_call ShowView all >/dev/null; sleep 1
focus_class spawn-list-row 0
move_class spawn-list-row 3 0.6
expect "the layout holds the focus" "$(foc)" "St_Widget"
key Down 0.4
expect_state "Down moves on from the pointed-at row" layout.focusIndex 4
expect "no hover tint left under the resting pointer" "$(state_get layout.hoverTints)" '[]'
close_menu

echo "-- pinned grid"
set_display Grid
open_menu 1.2
key Down
move_class $ITEM 1 0.6
expect "pointing at a tile takes the ring off the first" "$(foc)" "St_Widget"
key Right 0.4
expect_state "Right moves on from the pointed-at tile" layout.focusIndex 2
screenshot ui-highlight-grid
close_menu
set_display List
