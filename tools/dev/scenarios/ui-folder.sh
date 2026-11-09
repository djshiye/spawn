# Folders (a popup card over a dimmed scrim): open, grid columns, Tab stays inside, rename through the header, Escape / scrim click back; empty-folder fallback icon.
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
open_menu 1.5
screenshot ui-pinned-folders
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "folder view is showing the Internet folder" layout.folder "$F_INTERNET"
n="$(state_get layout.folderTiles)"
check "folder view lists the installed Internet apps ($n of 4 resolve)" "$([ "$n" -ge 1 ] && [ "$n" -le 4 ] && echo 0 || echo 1)"
expect_state "the Internet folder (4 apps) has 2 columns" layout.folderColumns 2
expect "the popup card is shown" "$(count spawn-folder-popup)" 1
expect "the scrim is shown" "$(count spawn-folder-scrim)" 1
expect "the close button replaces Back" "$(count spawn-folder-close)" 1
expect "no old Back button in the folder" "$(count spawn-folder-back)" 0
expect_state "focus starts on the first app" layout.focusIndex 0
screenshot ui-folder-open
echo "-- Tab stays inside the popup: tiles -> header -> tiles"
key Tab 0.4
expect "Tab from the first tile goes to the header" "$(state_get layout.focus | grep -c spawn-folder-name)" 1
expect_state "... still in the layout" layout.focusInLayout true
key Tab 0.4
expect "Tab from the header goes back to the tiles" "$(state_get layout.focus | grep -c 'spawn-tile')" 1
expect_state "... still in the layout" layout.focusInLayout true
expect_state "... still in the folder" layout.view folder
echo "-- rename: click the folder title, type, Return"
click_class spawn-folder-name 0
screenshot ui-folder-rename
key Ctrl+a 0.2
for c in G a m e s 2; do key "$c" 0.1; done
key Return 0.8
screenshot ui-folder-renamed
name="$(dconf read "/org/gnome/shell/extensions/spawn/folders/$F_INTERNET/name")"
expect "folder name stored in dconf" "$name" "'Games2'"
key Escape 0.6
expect_state "Escape leaves the folder" layout.view pinned
expect "Escape puts the focus on the folder's entry in the pinned view" "$(state_get layout.focus | grep -c spawn-folder-)" 1
echo "-- a click on the scrim outside the card closes the folder"
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "folder open again" layout.view folder
click $(scrim_point 10 10)
expect_state "scrim click leaves the folder" layout.view pinned
expect "the popup is gone" "$(count spawn-folder-popup)" 0
# closed with the pointer: no focus ring is left on the folder, the search entry has the focus again
# (Escape, above, is the keyboard path that returns to the folder)
expect "no focus ring left on the folder after a click outside" "$(state_get layout.focus | grep -c spawn-folder-)" 0
expect_state "... the focus is inside the layout" layout.focusInLayout true
echo "-- the close button leaves the folder too"
ui_call OpenFolder 0 >/dev/null; sleep 0.8
click_class spawn-folder-close 0
expect_state "close button leaves the folder" layout.view pinned
echo "-- Tarky folder has no resolvable apps: folder-symbolic fallback (see screenshot)"
screenshot ui-folder-fallback
