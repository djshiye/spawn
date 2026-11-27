# Tile names under multi-lined-labels: a long name wraps onto a second line at normal scale (the label is always two
# lines tall, so short and long names give tiles of one height), in the Classic pinned grid, the Grid layout's pinned
# grid and All apps, and a folder card. Wants the realistic app set (long.name.one, "Visual Studio Code", ...).
# Screenshots: tile-labels-*.png.
K=/org/gnome/shell/extensions/spawn
LONG='International Business Communications Suite Professional Edition'
F1=7d1c5a0e-2b4f-4a86-9c3d-0e5f6a7b8c91

# lab <text> [nth]: "height lines" of the label with that text
lab() {
    local r l
    r="$(ui_call TextRect "$1" "${2:-0}" | unwrap)"
    l="$(ui_call TextLines "$1" "${2:-0}" | tr -dc '0-9')"
    [ -n "$r" ] || { echo "0 0"; return; }
    echo "$(python3 -c 'import json,sys; print(round(json.loads(sys.argv[1])[3]))' "$r") $l"
}

# labels_ok <where> <long text> <short text>: the long name takes two lines, both labels are as tall as two lines,
# and the tiles of the first row have one height
labels_ok() {
    local lh ll sh sl
    read -r lh ll <<<"$(lab "$2")"
    read -r sh sl <<<"$(lab "$3")"
    check "$1: a long name shows two lines ($ll lines)" "$([ "$ll" = 2 ] && echo 0 || echo 1)"
    check "$1: long and short names have labels of one height ($lh and $sh px)" "$([ "$lh" -gt 0 ] && [ "$lh" = "$sh" ] && echo 0 || echo 1)"
    local hs
    hs="$(for i in 0 1 2 3; do python3 -c 'import json,sys; r=json.loads(sys.argv[1] or "[0,0,0,0]"); print(round(r[3]))' "$(rect spawn-tile "$i")"; done | sort -u | wc -l)"
    check "$1: the tiles of a row are equally tall" "$([ "$hs" = 1 ] && echo 0 || echo 1)"
}

leave_overview
dconf write $K/pinned-apps "[{'id': 'long.name.one.desktop'}, {'id': 'Zoom.desktop'}, {'id': 'code.desktop'}, {'id': 'org.gnome.Loupe.desktop'}, {'id': 'org.libreoffice.Writer.desktop'}, {'id': 'org.mozilla.firefox.desktop'}, {'id': '$F1', 'name': 'Long folder name for the test', 'isFolder': 'true'}]"
dconf write $K/folders/$F1/name "'Long folder name for the test'"
dconf write $K/folders/$F1/pinned-apps "[{'id': 'long.name.one.desktop'}, {'id': 'Zoom.desktop'}, {'id': 'code.desktop'}]"
dconf write $K/multi-lined-labels true

echo "-- Classic, pinned apps as a grid"
dconf write $K/layout-style "'Classic'"
dconf write $K/pinned-apps-display "'Grid'"
sleep 1.5
open_menu 1.5
labels_ok "classic grid" "$LONG" Zoom
read -r h l <<<"$(lab 'Visual Studio Code')"
check "classic grid: Visual Studio Code is not cut to one line ($l lines)" "$([ "$l" = 2 ] && echo 0 || echo 1)"
read -r h l <<<"$(lab 'Long folder name for the test')"
check "classic grid: a long folder name wraps too ($l lines)" "$([ "$l" = 2 ] && echo 0 || echo 1)"
screenshot tile-labels-classic
close_menu

echo "-- Grid layout: pinned and All apps"
dconf write $K/layout-style "'Grid'"
sleep 1.5
open_menu 1.5
labels_ok "grid pinned" "$LONG" Zoom
read -r sh sl <<<"$(lab Zoom)"
state_rows="$(state_get layout.pager.rows)"
echo "pager rows: $state_rows"
screenshot tile-labels-grid
ui_call ShowView all >/dev/null; sleep 1.5
# the letter groups are built lazily, so only the first rows exist: a short name still has the two-line label, and
# the "#" row (an Arabic and a CJK-less name that wraps) has tiles of one height
read -r ah al <<<"$(lab Bottles)"
check "grid all apps: a short name's label is as tall as in the pinned grid ($ah px, pinned $sh px)" "$([ "$ah" = "$sh" ] && echo 0 || echo 1)"
t0="$(rect spawn-tile 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3]))')"
t1="$(rect spawn-tile 1 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3]))')"
check "grid all apps: the first row's tiles are equally tall ($t0 and $t1 px)" "$([ "$t0" = "$t1" ] && echo 0 || echo 1)"
screenshot tile-labels-grid-all
ui_call ShowView pinned >/dev/null; sleep 1
ui_call OpenFolder 0 >/dev/null; sleep 0.9
read -r h l <<<"$(lab "$LONG" 1)"
check "folder card: a long name shows two lines ($l lines)" "$([ "$l" = 2 ] && echo 0 || echo 1)"
screenshot tile-labels-folder
key Escape 0.6
close_menu

echo "-- one-line labels stay one line"
dconf write $K/multi-lined-labels false
sleep 1; open_menu 1.5
read -r h l <<<"$(lab "$LONG")"
check "multi-lined-labels off: the long name is one line ($l lines)" "$([ "$l" = 1 ] && echo 0 || echo 1)"
close_menu
dconf reset $K/multi-lined-labels
dconf reset $K/layout-style
dconf reset $K/pinned-apps-display
