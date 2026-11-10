# Super (or the hotkey, D-Bus Toggle / ToggleRunner) while ANOTHER shell menu is open (the calendar / date menu,
# quick settings): the other menu closes and Spawn opens, never two menus on top of each other
# (panel/shellPopups.ts). Screenshots: super-over-calendar-before.png, super-over-calendar.png,
# super-over-quick-settings.png
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
toggle_dbus() { gdbus call --session --dest "$dest" --object-path "$path" --method "io.github.djshiye.Spawn.$1" >/dev/null 2>&1; sleep 1.2; }
click_last_panel_button() { click_class panel-button "$(($(count panel-button) - 1))"; sleep 0.8; }
leave_overview
close_menu
sleep 1
expect "no shell menu open at start" "$(hk shellMenusOpen)" 0

echo "-- Super over the calendar"
click_class clock-display 0
sleep 0.8
expect "the calendar is open" "$(hk shellMenusOpen)" 1
screenshot super-over-calendar-before
key Super_L 1.5
expect "Super opens Spawn" "$(hk popupOpen)" true
expect "... and the calendar is closed (not two menus)" "$(hk shellMenusOpen)" 0
screenshot super-over-calendar
key Super_L 1.2
expect "Super closes Spawn again" "$(hk popupOpen)" false

echo "-- Super over quick settings"
click_last_panel_button
expect "quick settings are open" "$(hk shellMenusOpen)" 1
key Super_L 1.5
expect "Super opens Spawn" "$(hk popupOpen)" true
expect "... and quick settings are closed" "$(hk shellMenusOpen)" 0
screenshot super-over-quick-settings
close_menu

echo "-- the D-Bus Toggle over the calendar"
click_class clock-display 0
sleep 0.8
expect "the calendar is open" "$(hk shellMenusOpen)" 1
toggle_dbus Toggle
expect "Toggle opens Spawn" "$(hk popupOpen)" true
expect "... and the calendar is closed" "$(hk shellMenusOpen)" 0
close_menu

echo "-- the runner over the calendar"
click_class clock-display 0
sleep 0.8
expect "the calendar is open" "$(hk shellMenusOpen)" 1
toggle_dbus ToggleRunner
expect "ToggleRunner opens the runner" "$(dev_call RunnerState | sed -E "s/^\('(.*)',\)$/\1/" | json_get open)" true
expect "... and the calendar is closed" "$(hk shellMenusOpen)" 0
dev_call CloseRunner >/dev/null
sleep 0.5
