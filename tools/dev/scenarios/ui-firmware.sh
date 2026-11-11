# Restart to Firmware Setup (opt-in power option): with it enabled the power row shows it before Power Off, it moves into
# the More menu first when the row overflows, and its button opens the confirmation dialog (Cancel closes it; the
# logind calls are simulated in dev builds, nothing restarts). Screenshots: .dev/shots/firmware-*.png.
K=/org/gnome/shell/extensions/spawn
leave_overview
dconf write $K/power-display-style "'Default'"
dconf write $K/right-panel-width 260
dconf write $K/power-options "[(0, true), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false), (8, true)]"
sleep 1.5
open_menu 1.8
expect "5 power buttons incl. firmware" "$(count spawn-power-button)" 5
screenshot firmware-row

click_class spawn-power-button 3
sleep 1.2
screenshot firmware-dialog
key Escape 1.0
screenshot firmware-dialog-cancelled

close_menu
dconf write $K/right-panel-width 200
dconf write $K/power-options "[(0, true), (1, true), (2, true), (3, true), (4, true), (5, true), (6, true), (7, true), (8, true)]"
sleep 1.5
open_menu 1.8
click_class spawn-power-more
sleep 0.6
screenshot firmware-more-open
key Escape 0.6

close_menu
dconf reset $K/right-panel-width
dconf reset $K/power-options
dconf reset $K/power-display-style
