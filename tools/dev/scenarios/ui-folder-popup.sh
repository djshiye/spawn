# Folder popup look and placement: the card opens next to the folder it came from (below a grid tile, or
# above it when there is no room below; beside a list row, like a submenu), stays inside the menu, and
# stays opaque with see-through custom menu colours. Screenshots for list and grid display, dark custom colours and the light preset.
K=/org/gnome/shell/extensions/spawn
leave_overview

# card_vs <folder class> <index>: prints "gap_below gap_above inside" for the open card and that folder
card_vs() {
    python3 -c '
import json, sys
c = json.loads(sys.argv[1]); f = json.loads(sys.argv[2]); s = json.loads(sys.argv[3])
below = c[1] - (f[1] + f[3]); above = f[1] - (c[1] + c[3])
inside = c[0] >= s[0] and c[1] >= s[1] and c[0] + c[2] <= s[0] + s[2] and c[1] + c[3] <= s[1] + s[3]
print(round(below), round(above), "yes" if inside else "no")' "$(rect spawn-folder-popup 0)" "$(rect "$1" "$2")" "$(rect spawn-folder-scrim 0)"
}

# near <class> <index> <label>: the card sits right below or right above the folder, inside the menu
near() {
    read -r below above inside <<<"$(card_vs "$1" "$2")"
    check "$3: card next to its folder (gap below $below px, above $above px)" \
        "$({ [ "$below" -ge 0 ] && [ "$below" -le 12 ]; } || { [ "$above" -ge 0 ] && [ "$above" -le 12 ]; } && echo 0 || echo 1)"
    expect "$3: card inside the menu" "$inside" yes
}

# beside <index> <label>: a list row's card opens beside the row like a submenu: it leaves the row's icon and
# name uncovered (starts right of the row's middle), its header is level with the row (within 8 px, unless
# the menu edge pushed it), and it stays inside the menu
beside() {
    read -r xoff dy inside <<<"$(python3 -c '
import json, sys
c = json.loads(sys.argv[1]); f = json.loads(sys.argv[2]); s = json.loads(sys.argv[3]); h = json.loads(sys.argv[4])
xoff = c[0] - (f[0] + f[2] / 2)
dy = (h[1] + h[3] / 2) - (f[1] + f[3] / 2)
inside = c[0] >= s[0] and c[1] >= s[1] and c[0] + c[2] <= s[0] + s[2] and c[1] + c[3] <= s[1] + s[3]
print(round(xoff), round(dy), "yes" if inside else "no")' "$(rect spawn-folder-popup 0)" "$(rect spawn-folder-row "$1")" "$(rect spawn-folder-scrim 0)" "$(rect spawn-folder-header 0)")"
    check "$2: card beside the row, clear of its icon and name (card starts $xoff px right of the row centre)" "$([ "$xoff" -ge 0 ] && echo 0 || echo 1)"
    check "$2: header level with the row (off by $dy px)" "$([ "${dy#-}" -le 8 ] || [ "$dy" -gt 0 ] && echo 0 || echo 1)"
    expect "$2: card inside the menu" "$inside" yes
}

echo "-- custom colours with a see-through dark background (the reported case)"
dconf write $K/override-menu-theme true
dconf write $K/menu-background-color "'rgba(14,14,17,0.55)'"
dconf write $K/menu-border-color "'rgba(14,14,17,0.55)'"
set_display List
close_menu; open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.9
beside 0 "list, first folder"
screenshot folder-popup/list-dark
key Escape 0.6
ui_call OpenFolder 2 >/dev/null; sleep 0.9
beside 2 "list, last folder"
screenshot folder-popup/list-dark-last
key Escape 0.6

set_display Grid
close_menu; open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.9
near spawn-folder-tile 0 "grid, first folder"
screenshot folder-popup/grid-dark
key Escape 0.6
ui_call OpenFolder 1 >/dev/null; sleep 0.9
near spawn-folder-tile 1 "grid, Games (5 apps)"
screenshot folder-popup/grid-dark-games
key Escape 0.6

echo "-- two-line labels (multi-lined-labels on): long names wrap once instead of being cut"
dconf write $K/multi-lined-labels true
close_menu; open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.9
screenshot folder-popup/grid-dark-multiline
key Escape 0.6
ui_call OpenFolder 1 >/dev/null; sleep 0.9
h="$(ui_call TextRect 'Heroic Games Launcher' 0 | unwrap | python3 -c 'import json,sys; print(round(json.loads(sys.stdin.read())[3]))')"
check "a long name wraps onto a second line (label height $h px)" "$([ "${h:-0}" -ge 28 ] && echo 0 || echo 1)"
screenshot folder-popup/grid-dark-multiline-games
key Escape 0.6
dconf reset $K/multi-lined-labels

echo "-- a short menu: no room below the last folder, so the card opens above it and stays inside"
dconf write $K/menu-height 500
close_menu; open_menu 1.5
ui_call OpenFolder 2 >/dev/null; sleep 0.9
read -r below above inside <<<"$(card_vs spawn-folder-tile 2)"
expect "short menu: card inside the menu" "$inside" yes
check "short menu: card does not cover its folder from below (gap above $above px)" "$([ "$above" -ge 0 ] || [ "$below" -ge 0 ] && echo 0 || echo 1)"
screenshot folder-popup/grid-dark-short
key Escape 0.6
dconf reset $K/menu-height

echo "-- light preset"
dconf write $K/menu-background-color "'rgb(245,247,250)'"
dconf write $K/menu-foreground-color "'rgb(18,51,84)'"
dconf write $K/menu-border-color "'rgba(18,51,84,0.2)'"
set_display List
close_menu; open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.9
screenshot folder-popup/list-light
key Escape 0.6

echo "-- theme colours (no override)"
dconf write $K/override-menu-theme false
close_menu; open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.9
beside 0 "theme colours"
screenshot folder-popup/list-theme
key Escape 0.6
expect_state "Escape closes the folder" layout.view pinned
close_menu
