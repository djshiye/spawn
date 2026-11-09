# Feedback and Undo (1.2.0): the menu says what an action did and lets it be taken back.
#   U3   Hide from Menu on a pinned app says the app is still pinned
#   U4   Unpin and Remove from Folder show the Undo banner (Ctrl+Z too) and Undo restores the exact slot / folder
#   U5   Add to Folder > New Folder opens the new folder with its name ready to type (Escape keeps "New Folder")
#   U9   nothing pinned: a friendly empty state with a button to All Apps
#   U10  Pin to Menu (All Apps, search) shows "Pinned ..." with Undo
#   U11  right-click / Menu key on a right-pane shortcut: Open, Remove from Menu (Undo), Edit Shortcuts...
#   U12  right-click on the user card: Menu Settings
#   U13c the last app out of a folder keeps the folder's slot
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
K=/org/gnome/shell/extensions/spawn/
dump_settings() { dconf dump "$K" | grep -av '^dev-mode='; }
tmp="$(mktemp -d)"
click_text() { # label [nth]
    local r
    r="$(ui_call TextRect "$1" "${2:-0}" | unwrap)"
    [ -n "$r" ] && [ "$r" != "null" ] || { echo "FAIL no visible text '$1'"; status=1; return 1; }
    click $(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h/2))' "$r")
}
has_text() { local r; r="$(ui_call TextRect "$1" 0 | unwrap)"; [ -n "$r" ] && [ "$r" != "null" ] && echo 0 || echo 1; }
items() { ui_call MenuItems spawn-context-menu | unwrap | python3 -c 'import json,sys; print(" | ".join(i["label"] for i in json.load(sys.stdin) if i.get("kind")=="item" and i.get("visible") and i.get("label")))'; }
fresh() { reset_seed; [ "$PINNED_DISPLAY" = Grid ] && set_display Grid; open_menu 1.5; }

for display in List Grid; do
    echo "== $display"
    PINNED_DISPLAY=$display; pin_vars
    fresh
    dump_settings >"$tmp/seed"

    echo "-- U3 hide a pinned app"
    click_class "$ITEM" 1 3
    click_text "Hide from Menu"; sleep 0.6
    expect "banner is showing" "$(count spawn-undo-banner)" 1
    check "banner says the app is still pinned" "$(has_text 'Hidden from All Apps, still pinned')"
    key Ctrl+z 0.8
    expect "Ctrl+Z un-hides" "$(count spawn-undo-banner)" 0

    echo "-- U4 unpin, the Undo button restores the slot"
    fresh
    before="$(pinned_ids)"
    click_class "$ITEM" 2 3
    click_text "Unpin from Menu"; sleep 0.6
    expect "banner after Unpin" "$(count spawn-undo-banner)" 1
    check "app left the pinned list" "$([ "$(pinned_ids)" != "$before" ] && echo 0 || echo 1)"
    click_class spawn-undo-button 0 1; sleep 0.8
    expect "banner gone after the Undo button" "$(count spawn-undo-banner)" 0
    expect "pinned list is exactly as before (slot kept)" "$(pinned_ids)" "$before"
    dump_settings >"$tmp/after"
    check "settings identical after Unpin + Ctrl+Z" "$(diff -q "$tmp/seed" "$tmp/after" >/dev/null && echo 0 || echo 1)"

    echo "-- U4 remove from a folder, Ctrl+Z"
    fresh
    base="$(count spawn-tile)"
    click_class "$FOLDER" 0 1; sleep 0.8
    click_class spawn-tile $((base + 1)) 3
    check "folder app menu offers Remove from Folder" "$(items | grep -q 'Remove from Folder' && echo 0 || echo 1)"
    click_text "Remove from Folder"; sleep 0.8
    expect "banner after Remove from Folder" "$(count spawn-undo-banner)" 1
    check "app moved to the top level" "$(pinned_ids | grep -q 'Zoom.desktop' && echo 0 || echo 1)"
    key Ctrl+z 0.8
    expect "banner gone after Undo" "$(count spawn-undo-banner)" 0
    dump_settings >"$tmp/after"
    check "settings identical after Remove from Folder + Undo" "$(diff -q "$tmp/seed" "$tmp/after" >/dev/null && echo 0 || echo 1)"
    diff "$tmp/seed" "$tmp/after"

    echo "-- U13c last app out of a folder keeps the folder slot"
    fresh
    dconf write "${K}folders/$F_INTERNET/pinned-apps" "[{'id': 'slack.desktop'}]"; sleep 1
    close_menu; open_menu 1.5
    base="$(count spawn-tile)"
    click_class "$FOLDER" 0 1; sleep 0.8
    click_class spawn-tile $((base)) 3
    click_text "Remove from Folder"; sleep 0.8
    expect "app takes the folder's slot (4th)" "$(pinned_ids | cut -d' ' -f4)" "slack.desktop"
    expect "the list has the games folder after it" "$(pinned_ids | wc -w)" 6
    key Ctrl+z 0.8
    check "Undo brings the folder back" "$(pinned_ids | grep -q "$F_INTERNET" && echo 0 || echo 1)"
    expect "folder has its app again" "$(folder_ids "$F_INTERNET")" "slack.desktop"

    echo "-- U5 New Folder opens ready to type"
    fresh
    click_class "$ITEM" 0 3
    click_text "Add to Folder"; sleep 0.5
    click_text "New Folder"; sleep 1.0
    expect_state "folder view is open" layout.view folder
    expect_state "its name is being edited" layout.renaming true
    key W 0.1; key o 0.1; key r 0.1; key k 0.2
    key Return 0.8
    check "the folder is called Work" "$(dconf dump "$K" | grep -aq "^name='Work'" && echo 0 || echo 1)"
    echo "   Escape keeps the default name"
    fresh
    click_class "$ITEM" 0 3
    click_text "Add to Folder"; sleep 0.5
    click_text "New Folder"; sleep 1.0
    key Escape 0.8
    check "the folder keeps its default name" "$(dconf dump "$K" | grep -aq "^name='New Folder'" && echo 0 || echo 1)"

    echo "-- U9 nothing pinned"
    fresh
    dconf write "${K}pinned-apps" "@aa{ss} []"; sleep 1
    close_menu; open_menu 1.5
    expect "empty state is showing" "$(count spawn-pinned-empty)" 1
    check "it says Nothing pinned yet" "$(has_text 'Nothing pinned yet')"
    check "it explains how to pin" "$(has_text 'Right-click an app and choose Pin to Menu')"
    screenshot "ui-feedback-empty-$display"
    click_class spawn-pinned-empty-button 0 1; sleep 0.8
    expect_state "the button opens All Apps (the nav button's view)" layout.view categories
    close_menu

    echo "-- U10 Pin to Menu from All Apps"
    fresh
    ui_call ShowView all >/dev/null; sleep 1
    n0="$(pinned_ids | wc -w)"
    click_class spawn-list-row 3 3
    click_text "Pin to Menu"; sleep 0.7
    expect "one more pinned app" "$(pinned_ids | wc -w)" $((n0 + 1))
    expect "banner after Pin" "$(count spawn-undo-banner)" 1
    screenshot "ui-feedback-pin-$display"
    key Ctrl+z 0.8
    expect "Ctrl+Z unpins again" "$(pinned_ids | wc -w)" "$n0"
    close_menu
done
PINNED_DISPLAY=List; pin_vars

echo "== U11 shortcut context menu"
fresh
dump_settings >"$tmp/seed"
click_class spawn-shortcut-row 0 3; sleep 0.5
echo "   items: $(items)"
check "Home has Open, Remove from Menu, Edit Shortcuts" "$(items | grep -q 'Open | Remove from Menu | Edit Shortcuts' && echo 0 || echo 1)"
key Escape 0.5
echo "   keyboard: Menu key"
focus_class spawn-shortcut-row 0
key Menu 0.6
expect "the Menu key opens it" "$(count spawn-context-menu)" 1
key Escape 0.5
focus_class spawn-shortcut-row 0
key Down 0.4
check "Down still moves on that row after the menu was used" "$(ui_call FocusInfo | unwrap | json_get name | grep -q Home && echo 1 || echo 0)"
echo "   an application shortcut offers New Window"
click_class spawn-shortcut-row 4 3; sleep 0.5
echo "   items: $(items)"
check "Ptyxis offers New Window" "$(items | grep -q 'New Window' && echo 0 || echo 1)"
key Escape 0.5
echo "   Remove from Menu, Undo"
n0="$(count spawn-shortcut-row)"
click_class spawn-shortcut-row 1 3
click_text "Remove from Menu"; sleep 0.7
expect "one shortcut less" "$(count spawn-shortcut-row)" $((n0 - 1))
expect "banner after Remove from Menu" "$(count spawn-undo-banner)" 1
key Ctrl+z 0.8
expect "the shortcut is back" "$(count spawn-shortcut-row)" "$n0"
dump_settings >"$tmp/after"
check "settings identical after Remove from Menu + Undo" "$(diff -q "$tmp/seed" "$tmp/after" >/dev/null && echo 0 || echo 1)"
echo "   Edit Shortcuts opens the Pinned page"
click_class spawn-shortcut-row 0 3
click_text "Edit Shortcuts…"; sleep 1.0
expect "the settings page asked for is Pinned" "$(dconf read "${K}prefs-visible-page")" 3
check "the menu closed" "$([ "$(state_get open)" = false ] && echo 0 || echo 1)"

echo "== U12 user card menu"
fresh
click_class spawn-user-card 0 3; sleep 0.5
echo "   items: $(items)"
expect "user card menu" "$(items)" "Menu Settings"
key Escape 0.5
close_menu
rm -rf "$tmp"
reset_seed
