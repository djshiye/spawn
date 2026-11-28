# A pinned tile follows its entry: the new name after an edit of a pinned command and after an app update
# (the tile cache used to keep the first name and icon until the next login).
K=/org/gnome/shell/extensions/spawn/
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
rm -f "$apps/zqxupd.desktop"
reset_seed

has_text() { local r; r="$(ui_call TextRect "$1" 0 | unwrap)"; [ -n "$r" ] && [ "$r" != "null" ] && echo 0 || echo 1; }
wait_text() { # text [timeout s]: poll until a visible label has exactly that text
    local i
    for ((i = 0; i < ${2:-10} * 2; i++)); do
        [ "$(has_text "$1")" = 0 ] && return 0
        sleep 0.5
    done
    return 1
}

echo "-- a pinned command is renamed"
dconf write "${K}pinned-apps" "[{'id': 'echo hi', 'name': 'First name', 'icon': 'utilities-terminal'}]"
sleep 1; open_menu 1.5
check "the command shows its first name" "$(has_text 'First name')"
dconf write "${K}pinned-apps" "[{'id': 'echo hi', 'name': 'Second name', 'icon': 'utilities-terminal'}]"
wait_text "Second name" 5
check "the tile shows the second name" "$(has_text 'Second name')"
check "the first name is gone" "$([ "$(has_text 'First name')" = 1 ] && echo 0 || echo 1)"
close_menu

echo "-- the same command pinned twice with different names"
dconf write "${K}pinned-apps" "[{'id': 'echo hi', 'name': 'Twin A', 'icon': 'utilities-terminal'}, {'id': 'echo hi', 'name': 'Twin B', 'icon': 'utilities-terminal'}]"
sleep 1; open_menu 1.5
check "the duplicate command shows one tile" "$(has_text 'Twin A')"
dconf write "${K}pinned-apps" "[{'id': 'echo hi', 'name': 'Twin C', 'icon': 'utilities-terminal'}, {'id': 'echo hi', 'name': 'Twin D', 'icon': 'utilities-terminal'}]"
wait_text "Twin C" 5
check "the duplicate command follows an edit" "$(has_text 'Twin C')"
check "no disposed-object errors in the log" "$(grep -qi 'disposed' "$log" 2>/dev/null && echo 1 || echo 0)"
close_menu

echo "-- an app is updated while it is pinned"
printf '[Desktop Entry]\nType=Application\nName=Zqxupd Before\nExec=/usr/bin/true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/zqxupd.desktop"
sleep 6  # the GMenu tree reloads 1-2.5 s after the file changes
dconf write "${K}pinned-apps" "[{'id': 'zqxupd.desktop'}]"
sleep 1; open_menu 1.5
wait_text "Zqxupd Before" 10
check "the app tile shows its first name" "$(has_text 'Zqxupd Before')"
printf '[Desktop Entry]\nType=Application\nName=Zqxupd After\nExec=/usr/bin/true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/zqxupd.desktop"
wait_text "Zqxupd After" 20
check "the app tile shows its new name" "$(has_text 'Zqxupd After')"
close_menu
rm -f "$apps/zqxupd.desktop"
sleep 3
