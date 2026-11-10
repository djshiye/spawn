# uses: tray-standin
# ONE left, middle or right click on a tray icon while the Spawn menu is open closes the menu AND reaches that
# icon (panel/panelClick.ts panelClickAction): the tray icons of the AppIndicator extension (Steam, Slack...)
# and legacy tray icons read raw presses, so the closing press is replayed to them; the shell's own panel
# buttons toggle their menu with a right click too. Also over a fullscreen game: the panel stays while the
# icon's menu is open and hides again when it closes (panel/fullscreenReveal.ts holdWhileOpen).
# The stand-in icons (tools/dev/tray-standin) copy the AppIndicator extension's click handling.
# Screenshots: tray-*.png
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
trace="$XDG_RUNTIME_DIR/spawn-tray-standin.log"
panel_shown() { count spawn-button; }
traced() { grep -c "^$1\$" "$trace" 2>/dev/null || echo 0; }
leave_overview
close_menu
sleep 1
expect "the stand-in AppIndicator icon is in the panel" "$(count spawn-test-appindicator)" 1
expect "the stand-in legacy tray icon is in the panel" "$(count spawn-test-legacytray)" 1
rm -f "$trace"

echo "-- right click on an AppIndicator icon (Steam, Slack): its menu"
open_menu 1.5
expect "Spawn is open" "$(hk popupOpen)" true
screenshot tray-before
click_class spawn-test-appindicator 0 3
sleep 0.6
expect "one right click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the tray icon's menu" "$(hk shellMenusOpen)" 1
expect "... once" "$(traced appindicator-menu-open)" 1
screenshot tray-right-click
key Escape 0.8
expect "the tray menu closed" "$(hk shellMenusOpen)" 0

echo "-- left click on an AppIndicator icon: its menu (after the double-click wait, like the real one)"
rm -f "$trace"
open_menu 1.5
click_class spawn-test-appindicator 0 1
sleep 1
expect "one left click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the tray icon's menu" "$(hk shellMenusOpen)" 1
expect "... once" "$(traced appindicator-menu-open)" 1
screenshot tray-left-click
key Escape 0.8

echo "-- middle click on an AppIndicator icon: secondary activate"
rm -f "$trace"
open_menu 1.5
click_class spawn-test-appindicator 0 2
sleep 0.8
expect "one middle click closed Spawn" "$(hk popupOpen)" false
expect "... and secondary-activated the icon once" "$(traced appindicator-secondary-activate)" 1
expect "... no menu" "$(hk shellMenusOpen)" 0

echo "-- left and right click on a legacy (XEmbed) tray icon: the app gets the click once"
for b in 1 3; do
    rm -f "$trace"
    open_menu 1.5
    click_class spawn-test-legacytray 0 "$b"
    sleep 0.8
    expect "button $b: one click closed Spawn" "$(hk popupOpen)" false
    expect "button $b: ... and the tray app got exactly one click" "$(traced "legacytray-click-$b")" 1
done

echo "-- right click on the clock (a shell panel menu): the calendar"
open_menu 1.5
click_class clock-display 0 3
sleep 0.8
expect "one right click closed Spawn" "$(hk popupOpen)" false
expect "... and opened the calendar" "$(hk shellMenusOpen)" 1
key Escape 0.8

echo "-- the Spawn button itself: a right click still just closes the menu"
open_menu 1.5
click_class spawn-button 0 3
sleep 0.8
expect "right-clicking Spawn's own button closes it" "$(hk popupOpen)" false
expect "... and opens nothing else" "$(hk shellMenusOpen)" 0

echo "-- over a fullscreen game"
WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" Game fullscreen >"$dev/testwin.log" 2>&1 &
game=$!
for _ in $(seq 20); do [ "$(panel_shown)" = 0 ] && break; sleep 0.5; done
sleep 1
expect "the fullscreen window hides the panel" "$(panel_shown)" 0
rm -f "$trace"
key Super_L 1.5
expect "Super opens Spawn over the game" "$(hk popupOpen)" true
expect "the panel is shown" "$(panel_shown)" 1
click_class spawn-test-appindicator 0 3
sleep 0.8
expect "one right click closed Spawn" "$(hk popupOpen)" false
expect "... opened the tray icon's menu" "$(hk shellMenusOpen)" 1
expect "... and the panel stays while that menu is open" "$(panel_shown)" 1
screenshot tray-fullscreen-menu
sleep 1.5
expect "the panel still stays after the grace time (menu still open)" "$(panel_shown)" 1
key Escape 0.8
expect "the tray menu closed" "$(hk shellMenusOpen)" 0
expect "... and the panel hides again over the game" "$(panel_shown)" 0
screenshot tray-fullscreen-closed

echo "-- over the game, a left click on the legacy icon (no menu): the panel hides again after a moment"
rm -f "$trace"
key Super_L 1.5
click_class spawn-test-legacytray 0 1
sleep 0.4
expect "the tray app got the click" "$(traced legacytray-click-1)" 1
sleep 1.5
expect "the panel hides again over the game" "$(panel_shown)" 0
kill "$game" 2>/dev/null
for _ in $(seq 20); do [ "$(panel_shown)" = 1 ] && break; sleep 0.5; done
expect "panel back after the game closed" "$(panel_shown)" 1
