# The review screenshots, into .dev/shots/final/ (the Dash to Panel one comes from dtp-open).
leave_overview
out="$shots/final"
mkdir -p "$out"
open_menu 1.5
screenshot final/pinned-list
ui_call OpenFolder 0 >/dev/null; sleep 0.8
screenshot final/folder-open-list
ui_call ShowView default >/dev/null; sleep 0.4
ui_call ShowView categories >/dev/null; sleep 0.8
screenshot final/all-apps
ui_call ShowView default >/dev/null; sleep 0.4
echo "-- the same views as a grid (pinned-apps-display = Grid)"
set_display Grid
close_menu; open_menu 1.5
screenshot final/pinned-grid
ui_call OpenFolder 0 >/dev/null; sleep 0.8
screenshot final/folder-open-grid
ui_call ShowView default >/dev/null; sleep 0.4
set_display List
close_menu; open_menu 1.5
ui_call Search fire >/dev/null; sleep 1.5
screenshot final/search-fire
ui_call Search zzzzqq >/dev/null; sleep 1.5
screenshot final/search-empty
key Escape 0.8
focus_class $ITEM 0
key Menu 1.2
screenshot final/context-menu
key Escape 0.6
echo "-- keyboard focus ring: row, user card, nav button"
focus_class $ITEM 1; sleep 0.3
screenshot final/focus-row
focus_class spawn-user-card 0; sleep 0.3
screenshot final/focus-user
focus_class spawn-nav-button 0; sleep 0.3
screenshot final/focus-nav
focus_class spawn-power-button 1; sleep 0.3
screenshot final/focus-power
echo "-- hover alone (no keyboard focus): restart (destructive tint + tooltip), a shortcut row"
focus_class $ITEM 0   # park the keyboard focus on a row so the hovered button is not also focused
move_class spawn-power-button 1 1.0
screenshot final/power-hover
move_class spawn-shortcut-row 1 0.6
screenshot final/shortcut-hover
