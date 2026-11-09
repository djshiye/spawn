# Moving between the panes keeps your place (UX audit U8): Left / Right go to the item of the other pane at the
# same height; Tab follows reading order: search, the list, the right pane, the power buttons, also with the
# search entry at the bottom. (Seeded list layout: 6 pinned entries, user card + 7 shortcuts.)
K=/org/gnome/shell/extensions/spawn
name() { ui_call FocusInfo | unwrap | json_get name; }
cls() { ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1; }
open_menu 1.2
focus_class $ITEM 0
key Right 0.4
expect "Right from the first pinned app: the user card beside it" "$(cls)" "spawn-user-card"
focus_class $ITEM 2
key Right 0.4
expect "Right from Husk: the shortcut at its height" "$(name)" "Documents"
focus_class $ITEM 5
key Right 0.4
expect "Right from Tarky: the shortcut at its height" "$(name)" "Ptyxis"
key Down 0.3
key Down 0.3
key Left 0.4
expect "Left from Settings: the pinned entry nearest its height" "$(name)" "Folder: Tarky, 2 apps"
focus_class spawn-shortcut-row 0
key Left 0.4
expect "Left from Home: the pinned app beside it" "$(name)" "Claude"
focus_class spawn-power-button 0
key Left 0.4
expect "Left from the first power button: the All Apps button at the bottom of the list" "$(cls)" "spawn-nav-button"
close_menu

echo "-- Tab order, search entry at the bottom"
dconf write $K/search-entry-location "'Bottom'"
sleep 1
open_menu 1.2
expect "the entry has the focus" "$(ui_call FocusInfo | unwrap | json_get type)" "Clutter_Text"
key Tab 0.3
expect "Tab from the entry: the list" "$(cls)" "$ITEM"
key Tab 0.3
expect "Tab: the All Apps button below the list" "$(cls)" "spawn-nav-button"
key Tab 0.3
expect "Tab: the right pane" "$(cls)" "spawn-user-card"
key Tab 0.3
expect "Tab: the power buttons" "$(cls)" "spawn-power-button"
key Tab 0.3
expect "Tab wraps to the search entry" "$(ui_call FocusInfo | unwrap | json_get type)" "Clutter_Text"
key ISO_Left_Tab 0.3
expect "Shift+Tab from the entry: the power buttons" "$(cls)" "spawn-power-button"
close_menu
dconf reset $K/search-entry-location
