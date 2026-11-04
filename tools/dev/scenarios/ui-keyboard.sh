# Keyboard: Down from the search entry into the pinned grid, arrows, Tab cycle, type-to-search, Escape.
open_menu 1.5
expect "focus starts in the search entry" "$(state_get layout.focus | cut -c1-12)" "Clutter_Text"
key Down
expect "Down moves focus to the first tile" "$(state_get layout.focus)" "St_Button.spawn-menu-tile"
key Right; key Right; key Right
expect "Right x3 lands on the folder tile" "$(state_get layout.focus)" "St_Button.spawn-menu-tile spawn-menu-folder-tile"
key Down
expect "Down moves to the row below" "$(state_get layout.focus)" "St_Button.spawn-menu-tile spawn-menu-folder-tile"
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
