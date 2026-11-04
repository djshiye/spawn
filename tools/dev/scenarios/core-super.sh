# Super key with REAL key events (virtual keyboard via Ui.Key), not Dev.EmitOverlayKey:
# review findings 0 (Super must also CLOSE the open menu), 4 (Super in the Overview hides it),
# plus the in-memory overlay-key mask (restored when the setting is switched off) and the
# accelerator bookkeeping (spawn-hotkey, finding 9/10).
sendkeys() { dev_call SendKeys "$1" >/dev/null; sleep "${2:-1.2}"; }
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
set_key() { dconf write "/org/gnome/shell/extensions/spawn/$1" "$2"; }
leave_overview
close_menu
sleep 1

# Shell.ActionMode: NORMAL=1 OVERVIEW=2 POPUP=128
expect "Super intercepted at start" "$(hk superActive)" true
expect "overlay-key mask widened to NORMAL|OVERVIEW|POPUP" "$(hk overlayKeyModes)" 131
expect "menu closed at start" "$(hk popupOpen)" false
expect "Overview closed at start" "$(hk overviewVisible)" false

t0="$(hk toggles)"
key Super_L 1.2
expect "1st real Super press opens the menu" "$(hk popupOpen)" true
expect "toggle counted" "$(hk toggles)" "$((t0 + 1))"
key Super_L 1.2
expect "2nd real Super press CLOSES the menu (finding 0)" "$(hk popupOpen)" false
expect "toggle counted twice" "$(hk toggles)" "$((t0 + 2))"
key Super_L 1.2
expect "3rd press opens again" "$(hk popupOpen)" true
dev_call Close >/dev/null; sleep 0.8

# Super while the Overview is visible hides it instead of opening the menu (finding 4).
set_key super-key-toggle false; sleep 1
expect "mask restored when Super is released" "$(hk overlayKeyModes)" 3
key Super_L 1.5
expect "native Super opens the Overview" "$(hk overviewVisible)" true
set_key super-key-toggle true; sleep 1
expect "mask widened again" "$(hk overlayKeyModes)" 131
key Super_L 1.5
expect "Super in the Overview hides it" "$(hk overviewVisible)" false
expect "... and does not open the menu" "$(hk popupOpen)" false

# Accelerator via the renamed key.
# (<Super>space is GNOME's own switch-input-source default, so use an unclaimed chord.)
set_key spawn-hotkey "['<Primary><Alt><Super>m']"; sleep 1.5
expect "accelerator bound" "$(hk accelBound)" true
sendkeys "+Control_L +Alt_L +Super_L +m -m -Super_L -Alt_L -Control_L"
expect "accelerator opens the menu" "$(hk popupOpen)" true
sendkeys "+Control_L +Alt_L +Super_L +m -m -Super_L -Alt_L -Control_L"
expect "accelerator closes the menu" "$(hk popupOpen)" false
set_key spawn-hotkey "['<Primary><Alt><Super>n']"; sleep 1.5
expect "re-bound to a new accelerator" "$(hk accelBound)" true
set_key spawn-hotkey "@as []"; sleep 1.5
expect "accelerator unbound" "$(hk accelBound)" false

# Disable -> re-enable: mask put back, then widened again.
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 2.5
expect "Super intercepted after re-enable" "$(hk superActive)" true
expect "mask widened after re-enable" "$(hk overlayKeyModes)" 131
