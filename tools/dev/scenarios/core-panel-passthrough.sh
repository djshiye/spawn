# ONE click on any panel button while the Spawn menu is open closes the menu AND activates that button
# (panel/panelClick.ts + targets.ts activatePanelButton): the clock (date menu), quick settings and Activities in the
# top bar. (Dash to Panel pinned apps and a second monitor's panel: core-fullscreen.sh --with-dtp, code review.)
# Screenshots: passthrough-clock-before.png (menu open), passthrough-clock.png (after ONE click)
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
leave_overview
close_menu
sleep 1

echo "-- the clock"
open_menu 1.5
expect "Spawn is open" "$(hk popupOpen)" true
screenshot passthrough-clock-before
click_class clock-display 0
sleep 0.8
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the calendar" "$(hk shellMenusOpen)" 1
screenshot passthrough-clock
click_class clock-display 0   # closes the calendar again
sleep 0.8
expect "the calendar closed" "$(hk shellMenusOpen)" 0

echo "-- quick settings (last panel button)"
open_menu 1.5
expect "Spawn is open" "$(hk popupOpen)" true
click_class panel-button "$(($(count panel-button) - 1))"
sleep 0.8
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and opened quick settings" "$(hk shellMenusOpen)" 1
screenshot passthrough-quick-settings
key Escape 0.8
expect "quick settings closed" "$(hk shellMenusOpen)" 0

echo "-- Activities"
open_menu 1.5
expect "Spawn is open" "$(hk popupOpen)" true
click_class panel-button 1
sleep 1.2
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and showed the Overview" "$(hk overviewVisible)" true
leave_overview

echo "-- the Spawn button itself still just closes the menu"
open_menu 1.5
click_class spawn-button 0
sleep 0.8
expect "clicking Spawn's own button closes it (not close-and-reopen)" "$(hk popupOpen)" false
