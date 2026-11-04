# Folders: open, tooltips, rename through the header, Escape back; empty-folder fallback icon.
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
open_menu 1.5
screenshot ui-pinned-folders
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "folder view is showing the Internet folder" layout.folder "$F_INTERNET"
n="$(state_get layout.folderTiles)"
check "folder view lists the installed Internet apps ($n of 4 resolve)" "$([ "$n" -ge 1 ] && [ "$n" -le 4 ] && echo 0 || echo 1)"
screenshot ui-folder-open
echo "-- rename: click the folder title, type, Return"
click 100 66
screenshot ui-folder-rename
key Ctrl+a 0.2
for c in G a m e s 2; do key "$c" 0.1; done
key Return 0.8
screenshot ui-folder-renamed
name="$(dconf read "/org/gnome/shell/extensions/spawn-menu/folders/$F_INTERNET/name")"
expect "folder name stored in dconf" "$name" "'Games2'"
key Escape 0.6
expect_state "Escape leaves the folder" layout.view pinned
echo "-- Tarky folder has no resolvable apps: folder-symbolic fallback (see screenshot)"
screenshot ui-folder-fallback
