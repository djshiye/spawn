# Right clicks over a fullscreen window (a game), with the Spawn menu open on its revealed panel:
#   - a right click on an app in the Spawn menu opens Spawn's context menu, and the menu and its panel stay;
#   - a right click on the Spawn button opens its own menu (Settings, Power Options), and the panel stays;
#   - the shell re-checking fullscreen while a menu is open (a game re-applying its fullscreen mode when it
#     gets focus) does not hide the panel and close the menu under the pointer;
#   - with --with-dtp, a right click on a Dash to Panel app icon closes Spawn AND opens that icon's own
#     context menu, and the panel stays until that menu is closed.
# Seeded. Screenshots: fsrc-*.png. The re-check is Dev.RecheckFullscreen (src/dev/devDbus.ts).
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
panel_shown() { count spawn-button; }   # visible actors only: 0 = the panel box is hidden
ctx_open() { count spawn-context-menu; }
if [ "$with_dtp" = 1 ]; then
    wait_active "$dtp_uuid" 30 || { echo "FAIL Dash to Panel did not become ACTIVE"; status=1; }
    dconf write /org/gnome/shell/extensions/dash-to-panel/intellihide false
    sleep 4
fi
leave_overview
close_menu
sleep 1

WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" Game fullscreen >"$dev/testwin.log" 2>&1 &
game=$!
for _ in $(seq 20); do [ "$(panel_shown)" = 0 ] && break; sleep 0.5; done
sleep 1
expect "the fullscreen window hides the panel" "$(panel_shown)" 0

echo "-- right click on an app inside the Spawn menu, over the game"
key Super_L 1.5
expect "Super opens the menu over the game" "$(hk popupOpen)" true
expect "the panel is shown" "$(panel_shown)" 1
click_class "$ITEM" 0 3
sleep 1
expect "the right click opens Spawn's context menu" "$(ctx_open)" 1
expect "the Spawn menu stays open" "$(hk popupOpen)" true
expect "the panel stays shown" "$(panel_shown)" 1
screenshot fsrc-spawn-context
key Escape 0.8
expect "Escape closes only the context menu" "$(ctx_open)" 0
expect "the Spawn menu is still open" "$(hk popupOpen)" true
key Escape 0.4
key Escape 0.8
expect "the menu closed" "$(hk popupOpen)" false
sleep 0.5
expect "the panel hides again over the game" "$(panel_shown)" 0

recheck() { dev_call RecheckFullscreen >/dev/null; sleep 0.6; }

echo "-- the shell re-checks fullscreen while the menu and its context menu are open"
key Super_L 1.5
expect "Super opens the menu over the game" "$(hk popupOpen)" true
click_class "$ITEM" 0 3
sleep 1
expect "context menu open" "$(ctx_open)" 1
recheck
screenshot fsrc-spawn-context-recheck
expect "the context menu stays open" "$(ctx_open)" 1
expect "the Spawn menu stays open" "$(hk popupOpen)" true
expect "the panel stays shown" "$(panel_shown)" 1
key Escape 0.8
key Escape 0.4
key Escape 0.8
sleep 0.5
expect "the panel hides again over the game" "$(panel_shown)" 0

echo "-- right click on the Spawn button, over the game"
key Super_L 1.5
expect "Super opens the menu over the game" "$(hk popupOpen)" true
click_class spawn-button 0 3
sleep 1
expect "the right click opens the Spawn button's menu" "$(count spawn-button-menu)" 1
expect "the panel stays shown" "$(panel_shown)" 1
screenshot fsrc-button-menu
recheck
expect "a fullscreen re-check keeps the button menu" "$(count spawn-button-menu)" 1
key Escape 0.8
expect "Escape closes the button menu" "$(count spawn-button-menu)" 0
sleep 0.5
expect "the panel hides again over the game" "$(panel_shown)" 0

if [ "$with_dtp" = 1 ]; then
    echo "-- right click on a Dash to Panel app icon, over the game"
    key Super_L 1.5
    expect "Super opens the menu over the game" "$(hk popupOpen)" true
    echo "pinned app icons in the panel: $(count overview-tile)"
    click_class overview-tile 0 3
    sleep 1.5
    expect "the right click closes Spawn" "$(hk popupOpen)" false
    expect "... opens the icon's context menu" "$(count app-menu)" 1
    expect "... and the panel stays shown" "$(panel_shown)" 1
    screenshot fsrc-dtp-context
    recheck
    screenshot fsrc-dtp-context-recheck
    expect "a fullscreen re-check keeps the icon's menu" "$(count app-menu)" 1
    expect "... and the panel" "$(panel_shown)" 1
    key Escape 0.8
    expect "Escape closes the icon's menu" "$(count app-menu)" 0
    sleep 0.5
    expect "the panel hides again over the game" "$(panel_shown)" 0
fi

kill "$game" 2>/dev/null
