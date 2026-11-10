# U1 regression: after a row's context menu was opened and closed, the row's own keys still work (GNOME 51's
# PopupMenu leaves a Clutter.KeyController on its source actor; Spawn removes it). Each dead key press used to
# log a Gjs-CRITICAL ("BoxPointer ... already disposed"), which also fails the run.
open_menu 1.5
key Down
expect "Down focuses the first pinned app" "$(state_get layout.focusIndex)" "0"
key Menu 0.8
key Escape 0.6
expect_state "Escape closes only the context menu" open true
key Down
expect "Down after the Menu-key context menu moves on" "$(state_get layout.focusIndex)" "1"
key Up
key Shift+F10 0.8
key Escape 0.6
key Down
expect "Down after the Shift+F10 context menu moves on" "$(state_get layout.focusIndex)" "1"
echo "-- folder entry: right click, Escape, then the keys"
click_class $FOLDER 0 3
key Escape 0.6
focus_class $FOLDER 0
key Down
expect "Down after the folder's context menu moves on" "$(state_get layout.focusIndex)" "4"
echo "-- the same row after the menu closed and opened again; Return / Space launch"
close_menu
open_menu 1.2
key Down
key Menu 0.8
key Escape 0.6
key Return 1
expect_state "Return on the row launches the app (menu closes)" open false
open_menu 1.2
key Down
key Menu 0.8
key Escape 0.6
key space 1
expect_state "Space on the row launches the app (menu closes)" open false
echo "-- power options as a menu: Return opens it from the keyboard, Up moves on (the shell's own key handling is off)"
dconf write /org/gnome/shell/extensions/spawn/power-display-style "'Menu'"
sleep 1
open_menu 1.2
focus_class spawn-power-menu-button 0
key Return 0.8
expect "Return on Power Off opens its menu with the first item focused" "$(ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1)" "popup-menu-item"
key Escape 0.6
expect "Escape returns to the Power Off button" "$(ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1)" "spawn-power-button"
key Up 0.6
expect "Up on Power Off moves the focus up, it does not open the menu" "$(ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1)" "spawn-shortcut-row"
close_menu
