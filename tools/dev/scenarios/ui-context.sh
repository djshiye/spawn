# Context menus: app tile via the Menu key, right-click on tile and folder, Escape closes just the menu.
open_menu 1.5
key Down
key Menu 1
screenshot ui-context-app
n="$(ui_call Pick 120 160 | head -c 200)"
echo "pick under the context menu: $n"
key Escape 0.6
expect_state "Escape closes only the context menu" open true
echo "-- right click on the folder tile"
click_class $FOLDER 0 3
screenshot ui-context-folder
key Escape 0.6
expect_state "popup still open" open true
echo "-- right click on a shortcut"
click_class spawn-shortcut-row 1 3
screenshot ui-context-shortcut
key Escape 0.6
