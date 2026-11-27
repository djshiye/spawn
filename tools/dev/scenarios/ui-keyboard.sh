# Keyboard on the pinned GRID (ui-list.sh does the list): Down from the search entry into the pinned grid, arrows, Tab cycle, type-to-search, Escape.
set_display Grid
open_menu 1.5
expect "focus starts in the search entry" "$(state_get layout.focus | cut -c1-12)" "Clutter_Text"
key Down
expect "Down moves focus to the first tile" "$(state_get layout.focus)" "St_Button.spawn-tile"
key Right; key Right; key Right
expect "Right x3 lands on the folder tile" "$(state_get layout.focus)" "St_Button.spawn-tile spawn-folder-tile"
key Down
expect "Down moves to the row below" "$(state_get layout.focus)" "St_Button.spawn-tile spawn-folder-tile"
screenshot ui-keyboard-nav
echo "-- Tab cycle (focus stays inside the layout)"
for i in 1 2 3 4 5 6; do
    key Tab 0.25
    echo "tab $i: $(state_get layout.focus)"
done
expect_state "focus still in the layout after Tab cycle" layout.focusInLayout true
echo "-- type anywhere goes to search"
key Escape 0.5
close_menu
open_menu 1.2
key Down
key f
key i 0.8
expect_state "typing starts a search" layout.view results
expect_state "search text is 'fi'" layout.search fi
echo "-- Escape clears the search, a second Escape closes the menu"
key Escape 0.6
expect_state "Escape clears the search" layout.search ""
expect_state "back to the default view" layout.view pinned
expect_state "menu still open after the first Escape" open true
key Escape 0.8
expect_state "second Escape closes the menu" open false

echo "-- Down from any tile of the last row into Frequent lands on its first row (U2)"
K=/org/gnome/shell/extensions/spawn
dconf write $K/default-menu-view "'Pinned_And_Frequent_Apps'"
dconf write $K/pinned-apps "[{'id': 'org.gnome.Calculator.desktop'}, {'id': 'org.gnome.Calendar.desktop'}, {'id': 'org.gnome.Characters.desktop'}]"
sleep 1
close_menu
ui_call SetFrequent "org.gnome.Nautilus.desktop,org.gnome.Settings.desktop,org.gnome.Calculator.desktop,org.gnome.Calendar.desktop" >/dev/null
open_menu 1.5
focus_class spawn-tile 2
expect_state "third tile focused" layout.focusIndex 2
key Down
expect "Down from the third tile: a Frequent row" "$(ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1)" "spawn-list-row"
expect_state "...its first row" layout.focusIndex 0
focus_class spawn-tile 1
key Down
expect_state "Down from the second tile: the first Frequent row too" layout.focusIndex 0
dconf reset $K/default-menu-view
dconf reset $K/pinned-apps
sleep 1
