# uses: tray-standin
# ONE click on any panel button while the Spawn menu is open closes the menu AND activates that button
# (panel/panelClick.ts + targets.ts activatePanelButton): the clock (date menu), quick settings and Activities in the
# top bar. (Dash to Panel pinned apps and a second monitor's panel: core-fullscreen.sh --with-dtp, code review.)
# A right click on a Dash to Panel app icon closes Spawn AND opens that icon's own context menu (popupMenu()), also over
# a fullscreen game, where the panel stays until that menu closes. The real Dash to Panel cannot be installed in the
# sandbox offline, so the stand-in extension (tools/dev/tray-standin, spawn-test-dtp-launcher) copies its call.
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

trace="$XDG_RUNTIME_DIR/spawn-tray-standin.log"
traced() { grep -c "^$1\$" "$trace" 2>/dev/null || true; }
panel_shown() { count spawn-button; }
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
expect "the stand-in app icon is in the panel" "$(count spawn-test-dtp-launcher)" 1

echo "-- left click on a Dash to Panel style app icon: clicked, no menu"
rm -f "$trace"
open_menu 1.5
click_class spawn-test-dtp-launcher 0 1
sleep 0.8
expect "one left click closed Spawn" "$(hk popupOpen)" false
expect "... and clicked the app icon once" "$(traced dtp-launcher-clicked-1)" 1
expect "... without a context menu" "$(traced dtp-launcher-menu-open)" 0

echo "-- right click on an app icon: Spawn closes, the icon's context menu opens"
rm -f "$trace"
open_menu 1.5
screenshot passthrough-launcher-before
click_class spawn-test-dtp-launcher 0 3
sleep 0.8
expect "one right click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the app icon's context menu once" "$(traced dtp-launcher-menu-open)" 1
screenshot passthrough-launcher-context
key Escape 0.8
expect "the context menu closed" "$(traced dtp-launcher-menu-closed)" 1

echo "-- over a fullscreen game the panel stays while that context menu is open"
WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" Game fullscreen >"$dev/testwin.log" 2>&1 &
game=$!
for _ in $(seq 20); do [ "$(panel_shown)" = 0 ] && break; sleep 0.5; done
sleep 1
expect "the fullscreen window hides the panel" "$(panel_shown)" 0
key Super_L 1.5
expect "Super opens the menu over the game" "$(hk popupOpen)" true
expect "the panel is shown for it" "$(panel_shown)" 1
rm -f "$trace"
click_class spawn-test-dtp-launcher 0 3
sleep 1
expect "one right click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the app icon's context menu" "$(traced dtp-launcher-menu-open)" 1
expect "the panel stays while the context menu is open" "$(panel_shown)" 1
screenshot passthrough-launcher-fullscreen
key Escape 1
expect "the context menu closed" "$(traced dtp-launcher-menu-closed)" 1
expect "the panel hides again over the game" "$(panel_shown)" 0
kill "$game" 2>/dev/null
for _ in $(seq 20); do [ "$(panel_shown)" = 1 ] && break; sleep 0.5; done
expect "panel back after the game closed" "$(panel_shown)" 1
