# Deleting a folder ("Delete Folder" in its context menu dissolves it: the apps move to the top level) shows an
# in-menu banner with Undo for 8 s. Undo restores the folder exactly (uuid, name, apps in order, slot) and takes
# the released apps off the top level again; closing the menu ends the undo window; the banner is reachable with Tab.
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
K=/org/gnome/shell/extensions/spawn/
dump_settings() { dconf dump "$K" | grep -av '^dev-mode='; }
tmp="$(mktemp -d)"

# delete_first_folder: right-click the first folder entry, choose "Delete Folder" (the third item)
delete_first_folder() {
    click_class "$FOLDER" 0 3
    check "folder context menu has three items" "$([ "$(count popup-menu-item)" -ge 3 ] && echo 0 || echo 1)"
    click_class popup-menu-item 2
    sleep 0.6
}
# focus_undo_with_tab: Tab until the Undo button holds the focus (the banner must be keyboard-reachable)
focus_undo_with_tab() {
    local i cls
    for i in $(seq 12); do
        cls="$(ui_call FocusInfo | unwrap | json_get cls)"
        case "$cls" in *spawn-undo-button*) return 0 ;; esac
        key Tab 0.25
    done
    return 1
}

for display in List Grid; do
    echo "== $display"
    PINNED_DISPLAY=$display; pin_vars
    reset_seed
    [ "$display" = Grid ] && set_display Grid
    open_menu 1.5
    dump_settings >"$tmp/before"
    check "no banner before deleting" "$([ "$(count spawn-undo-banner)" = 0 ] && echo 0 || echo 1)"

    echo "-- delete -> banner -> Undo with Tab + Return"
    delete_first_folder
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    screenshot "ui-folder-undo-banner-$display"
    check "folder uuid is gone from the pinned list" "$(pinned_ids | grep -q "$F_INTERNET" && echo 1 || echo 0)"
    check "its apps moved to the top level" "$(pinned_ids | grep -q 'slack.desktop' && echo 0 || echo 1)"
    check "its dconf path is empty" "$([ -z "$(dconf read "${K}folders/$F_INTERNET/pinned-apps")" ] && echo 0 || echo 1)"
    check "Undo is reachable with Tab" "$(focus_undo_with_tab && echo 0 || echo 1)"
    screenshot "ui-folder-undo-focus-$display"
    key Return 1.0
    expect "banner gone after Undo" "$(count spawn-undo-banner)" 0
    dump_settings >"$tmp/after"
    check "settings are identical to before the delete (uuid, name, apps, order, slot)" "$(diff -q "$tmp/before" "$tmp/after" >/dev/null && echo 0 || echo 1)"
    diff "$tmp/before" "$tmp/after"
    expect "the folder row is back" "$(count "$FOLDER")" 3
    screenshot "ui-folder-undo-restored-$display"

    echo "-- delete -> Ctrl+Z"
    delete_first_folder
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    key Ctrl+z 1.0
    expect "banner gone after Ctrl+Z" "$(count spawn-undo-banner)" 0
    dump_settings >"$tmp/after"
    check "settings are identical after Ctrl+Z" "$(diff -q "$tmp/before" "$tmp/after" >/dev/null && echo 0 || echo 1)"

    echo "-- delete -> the banner times out (8 s)"
    delete_first_folder
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    sleep 8.5
    expect "banner gone after the timeout" "$(count spawn-undo-banner)" 0
    check "folder stays deleted" "$(pinned_ids | grep -q "$F_INTERNET" && echo 1 || echo 0)"

    echo "-- delete -> close the menu -> the folder stays deleted"
    reset_seed
    [ "$display" = Grid ] && set_display Grid
    open_menu 1.5
    delete_first_folder
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    close_menu
    open_menu 1.5
    expect "no banner after reopening the menu" "$(count spawn-undo-banner)" 0
    check "folder stays deleted after the menu closed" "$(pinned_ids | grep -q "$F_INTERNET" && echo 1 || echo 0)"
    check "settings differ from the original" "$(dump_settings | diff -q "$tmp/before" - >/dev/null && echo 1 || echo 0)"

    echo "-- another change to the pinned list ends the undo window"
    reset_seed
    [ "$display" = Grid ] && set_display Grid
    open_menu 1.5
    delete_first_folder
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    dconf write "${K}pinned-apps" "[{'id': 'husk.desktop'}]"
    sleep 1
    expect "banner gone after an unrelated change" "$(count spawn-undo-banner)" 0
    close_menu
done
rm -rf "$tmp"
PINNED_DISPLAY=List; pin_vars
reset_seed
