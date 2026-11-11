# uses: tray-standin
# Panel icons show their hover look under Spawn's grab (ui/menu.ts _relayHover). When the menu closes WITHOUT a click on
# a panel icon (Escape, a click on a window, the Spawn button), the icon under the pointer must keep that look
# (the shell only restores it on the next pointer motion), and no icon may stay lit when the pointer is elsewhere.
# Screenshots: hover-open.png (menu open, pointer on the tray icon), hover-after-escape.png (menu closed by Escape,
# pointer still on the icon: lit), hover-after-escape-elsewhere.png (pointer moved off the icon first: nothing lit)
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
lit() { ui_call Pseudo "$1" 0 | grep -q hover && echo 0 || echo 1; }     # check-style: 0 = shows hover
unlit() { ui_call Pseudo "$1" 0 | grep -q hover && echo 1 || echo 0; }
leave_overview
close_menu
sleep 1
expect "the stand-in AppIndicator icon is in the panel" "$(count spawn-test-appindicator)" 1

echo "-- Escape with the pointer resting on a panel icon"
open_menu 1.5
move_class spawn-test-appindicator 0 0.6
check "the icon under the pointer shows its hover look while Spawn is open" "$(lit spawn-test-appindicator)"
screenshot hover-open
key Escape 1
expect "Escape closed Spawn" "$(hk popupOpen)" false
check "the icon under the pointer keeps its hover look after Escape" "$(lit spawn-test-appindicator)"
screenshot hover-after-escape

echo "-- Escape with the pointer elsewhere: nothing stays lit"
open_menu 1.5
move_class spawn-test-appindicator 0 0.6
check "lit while Spawn is open" "$(lit spawn-test-appindicator)"
ui_call Move 640 400 >/dev/null; sleep 0.25; ui_call Move 640 400 >/dev/null; sleep 0.5
check "... and not lit once the pointer left it" "$(unlit spawn-test-appindicator)"
key Escape 1
check "the icon stays unlit after Escape" "$(unlit spawn-test-appindicator)"
check "... also the other panel icons" "$(unlit spawn-test-legacytray)"
screenshot hover-after-escape-elsewhere

echo "-- the same on the legacy tray icon, and the look goes when the pointer moves off"
open_menu 1.5
move_class spawn-test-legacytray 0 0.6
check "lit while Spawn is open" "$(lit spawn-test-legacytray)"
key Escape 1
check "the legacy tray icon keeps its hover look after Escape" "$(lit spawn-test-legacytray)"
ui_call Move 640 400 >/dev/null; sleep 0.25; ui_call Move 640 400 >/dev/null; sleep 0.5
check "... and loses it when the pointer moves off (the shell's own crossing events)" "$(unlit spawn-test-legacytray)"
