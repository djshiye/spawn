# The Grid layout (layout-style Grid): one column with search, the "Pinned" header and its "All apps" pill, the
# pinned grid shown a page at a time, page dots, and a footer row (user card, folder shortcuts, power).
# Checks the arrangement, paging (wheel-free: keyboard and the dots), All apps and back, the keyboard order,
# and that switching back to Classic restores the two panes. Screenshots: grid-*.png.
K=/org/gnome/shell/extensions/spawn
cls() { ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1; }
name() { ui_call FocusInfo | unwrap | json_get name; }

# 30 pinned apps (two pages at the default height) + the seeded folders.
many=""
for id in org.gnome.Nautilus org.mozilla.firefox org.gnome.Ptyxis org.gnome.Settings org.gnome.Software org.gnome.TextEditor \
    org.gnome.Calendar steam com.discordapp.Discord com.anthropic.Claude code org.gnome.Music org.gnome.Totem org.gnome.Loupe \
    org.gnome.Calculator org.gnome.Weather org.gnome.Maps org.gnome.Clocks org.gnome.Contacts org.gnome.Characters \
    org.gnome.Builder org.gnome.Boxes com.usebottles.bottles org.gimp.GIMP org.inkscape.Inkscape org.libreoffice.Writer \
    org.gnome.Chess org.gnome.Sudoku org.kde.kdenlive org.gnome.Fonts; do
    many="$many{'id': '$id.desktop'}, "
done
dconf write $K/pinned-apps "[${many}{'id': '3c2219f1-a114-4e2e-a06c-51fdefa91991', 'name': 'Games', 'isFolder': 'true'}]"
dconf write $K/layout-style "'Grid'"
sleep 1.5

open_menu 1.5
expect_state "layout style" layout.layoutStyle Grid
expect_state "six columns at the default width" layout.gridCols 6
expect_state "start view is the pinned grid" layout.view pinned
expect "the right pane is hidden" "$(count spawn-right-pane)" "0"
expect "one header pill" "$(count spawn-grid-header-button)" "1"
expect "footer: user card" "$(count spawn-user-card)" "1"
expect "footer: three folder buttons" "$(count spawn-grid-icon-button)" "3"
pages=$(state_get layout.gridPages)
check "two pages of pinned apps (got $pages)" "$([ "${pages:-0}" -ge 2 ]; echo $?)"
expect_state "first page shows" layout.gridPage 0
screenshot grid-01-start

echo "-- keyboard order"
expect "the entry has the focus" "$(ui_call FocusInfo | unwrap | json_get type)" "Clutter_Text"
key Tab 0.3
expect "Tab: the All apps pill" "$(cls)" "spawn-nav-button"
key Tab 0.3
expect "Tab: the pinned grid" "$(cls)" "spawn-tile"
key Tab 0.3
expect "Tab: the footer" "$(cls)" "spawn-user-card"
key Right 0.3
expect "Right: the first folder button" "$(name)" "Home"
key Up 0.4
expect "Up from the footer: back into the grid" "$(cls)" "spawn-tile"
screenshot grid-02-focus-up-from-footer

echo "-- paging"
focus_class spawn-tile 0
key Page_Down 0.8
expect_state "Page Down: second page" layout.gridPage 1
screenshot grid-03-page-two
key Home 0.8
expect_state "Home: first page" layout.gridPage 0
click_class spawn-grid-dot 1
sleep 0.8
expect_state "clicking the second dot: second page" layout.gridPage 1
click_class spawn-grid-dot 0
sleep 0.8

echo "-- All apps and back"
click_class spawn-grid-header-button 0
sleep 1
expect_state "the pill opens All apps" layout.view all
screenshot grid-04-all-apps
key Escape 0.6
expect_state "Escape: back to pinned" layout.view pinned
ui_call Search cal >/dev/null; sleep 1.5
expect_state "typing shows results" layout.view results
screenshot grid-05-search
key Escape 0.6
close_menu

echo "-- folder popup in the grid"
open_menu 1.2
ui_call OpenFolder 0 >/dev/null; sleep 1
screenshot grid-06-folder
key Escape 0.6
close_menu

echo "-- back to Classic"
dconf write $K/layout-style "'Classic'"
sleep 1
open_menu 1.2
expect_state "layout style" layout.layoutStyle Classic
expect "the right pane is back" "$(count spawn-right-pane)" "1"
expect "no footer" "$(count spawn-grid-footer)" "0"
screenshot grid-07-classic-again
close_menu
dconf reset $K/layout-style
