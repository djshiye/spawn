# Home / End / Page Up / Page Down in every list and grid, F2 renames a folder, Delete unpins (UX audit U6).
nrows() { state_get layout.appRows | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }
cls() { state_get layout.focus | cut -d. -f2 | cut -d' ' -f1; }
echo "-- All Apps"
open_menu 1.2
ui_call ShowView all >/dev/null; sleep 2.5   # the first All Apps of a session builds its lists
# All Apps builds its rows lazily (only a screenful at first): End must build the rest and reach the real last app.
shown="$(nrows)"
focus_class spawn-list-row 0
key End 0.6
n="$(nrows)"
check "All Apps lists many apps ($n, $shown built before End)" "$([ "$n" -ge 20 ] && echo 0 || echo 1)"
expect_state "End goes to the last app" layout.focusIndex "$((n - 1))"
key Home 0.6
expect_state "Home goes to the first app" layout.focusIndex 0
key Page_Down 0.6
p="$(state_get layout.focusIndex)"
check "Page Down moves one visible page ($p rows)" "$([ "$p" -ge 5 ] && [ "$p" -lt "$((n - 1))" ] && echo 0 || echo 1)"
key Page_Down 0.6
p2="$(state_get layout.focusIndex)"
check "a second Page Down moves on ($p -> $p2)" "$([ "$p2" -gt "$p" ] && echo 0 || echo 1)"
screenshot ui-listkeys-allapps
key Page_Up 0.6
expect_state "Page Up moves back one page" layout.focusIndex "$p"
key Page_Up 0.6
key Page_Up 0.6
expect_state "Page Up at the top stops on the first app" layout.focusIndex 0
close_menu

echo "-- pinned list and the right pane"
open_menu 1.2
key Down
key End 0.4
expect_state "End: the last pinned entry" layout.focusIndex 5
key Home 0.4
expect_state "Home: the first pinned entry" layout.focusIndex 0
focus_class spawn-shortcut-row 2
key Home 0.4
expect "Home in the right pane: the user card" "$(cls)" "spawn-user-card"
key End 0.4
expect "End in the right pane: the last shortcut" "$(ui_call FocusInfo | unwrap | json_get name)" "Settings"
close_menu

echo "-- F2 renames a folder (pinned entry and inside its popup)"
open_menu 1.2
focus_class $FOLDER 0
key F2 1
expect_state "F2 on a folder opens it" layout.view folder
expect_state "... and starts renaming it" layout.renaming true
key Escape 0.6
expect_state "Escape cancels the rename" layout.renaming false
key F2 0.6
expect_state "F2 inside the open folder renames it" layout.renaming true
key Escape 0.6
key Down 0.4
key End 0.4
expect "End inside the folder: its last app" "$(ui_call FocusInfo | unwrap | json_get name)" "Obsidian"
key Escape 0.6
close_menu

echo "-- Delete unpins a pinned app (the context menu's Unpin)"
open_menu 1.2
key Down; key Down
expect "the second pinned entry is Claude" "$(ui_call FocusInfo | unwrap | json_get name)" "Claude"
key Delete 1
ids="$(pinned_ids)"
check "Claude is unpinned ($ids)" "$(echo "$ids" | grep -q com.anthropic.Claude.desktop && echo 1 || echo 0)"
expect "the focus moves to the entry that took its place" "$(ui_call FocusInfo | unwrap | json_get name)" "Husk"
focus_class $FOLDER 0
key Delete 0.6
check "Delete on a folder does nothing" "$(pinned_ids | grep -q 7d610436 && echo 0 || echo 1)"
close_menu

echo "-- pinned grid"
set_display Grid
open_menu 1.2
key Down
key End 0.4
expect_state "End: the last tile" layout.focusIndex 4
key Home 0.4
expect_state "Home: the first tile" layout.focusIndex 0
close_menu
set_display List
