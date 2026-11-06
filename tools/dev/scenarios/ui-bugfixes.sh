# Regression checks for the bug-hunt fixes: refused drops leave the order alone, and pinned built-in
# shortcuts (ArcMenu's "Show All Applications", "Home", ...) run as shortcuts instead of as command lines.
K=/org/gnome/shell/extensions/spawn

echo "-- grid: an app dropped back on its own tile stays where it is"
set_display Grid
open_menu 1.5
before="$(pinned_ids)"
read -r cx cy <<<"$(center spawn-tile 0)"
ui_call Move $((cx - 12)) "$cy" >/dev/null; sleep 0.5
ui_call Drag $((cx - 12)) "$cy" $((cx + 12)) "$cy" >/dev/null; sleep 2.2
expect "pinned order unchanged after dropping an app on itself" "$(pinned_ids)" "$before"

echo "-- grid: a folder dropped onto the middle of an app stays where it is"
src="$(center spawn-folder-tile 0)"; dst="$(center spawn-tile 1)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "pinned order unchanged after a refused folder-onto-app drop" "$(pinned_ids)" "$before"
close_menu

echo "-- list: an app dropped back on its own row stays where it is"
set_display List
open_menu 1.5
read -r cx cy <<<"$(center spawn-pinned-row 1)"
ui_call Move "$cx" "$cy" >/dev/null; sleep 0.5
ui_call Drag "$cx" "$cy" $((cx + 40)) "$cy" >/dev/null; sleep 2.2
expect "pinned order unchanged after dropping a row on itself" "$(pinned_ids)" "$before"
close_menu

echo "-- a pinned Show All Applications shortcut opens All Apps and keeps the menu open"
dconf write $K/pinned-apps "[{'id': 'Spawn_ShowAllApplications'}, {'id': 'steam.desktop'}]"; sleep 1.2
open_menu 1.5
expect_state "starts on the pinned view" layout.view pinned
click_class spawn-pinned-row 0; sleep 1
expect_state "menu still open after the shortcut" open true
check "view switched away from Pinned" "$([ "$(state_get layout.view)" != pinned ] && echo 0 || echo 1)"
screenshot ui-bugfixes-showall
close_menu

echo "-- a pinned Home shortcut closes the menu and opens the folder (no command-line launch)"
# A stand-in file manager (the sandbox has none) that records the URI it was asked to open.
fm_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; mkdir -p "$fm_dir"
marker="$XDG_RUNTIME_DIR/spawn-fm-opened"; rm -f "$marker"
printf '[Desktop Entry]\nType=Application\nName=Stub Files\nExec=sh -c "echo %%u > %s"\nMimeType=inode/directory;\nNoDisplay=true\n' "$marker" >"$fm_dir/spawn-stub-files.desktop"
printf '[Default Applications]\ninode/directory=spawn-stub-files.desktop\n' >"${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
sleep 1.5
dconf write $K/pinned-apps "[{'id': 'Spawn_Home'}, {'id': 'steam.desktop'}]"; sleep 1.2
open_menu 1.5
screenshot ui-bugfixes-home-tile
click_class spawn-pinned-row 0; sleep 1
expect_state "menu closed after the Home shortcut" open false
check "Home was not launched as a command line" "$(grep -q 'could not run Spawn_Home' "$log" 2>/dev/null && echo 1 || echo 0)"
sleep 1.5
expect "the Home folder was opened" "$(sed "s|^file://||" "$marker" 2>/dev/null)" "$HOME"
reset_seed
