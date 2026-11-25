# uses: recorder-standin
# ONE click on GNOME's screen recording stop button while the Spawn menu is open closes the menu AND stops the
# recording, also over a fullscreen game (Super reveals the hidden panel; panel/fullscreenReveal.ts). The stop button
# is a menu-less indicator (PanelMenu.ButtonBox) that acts on its own click gesture: Spawn fires that gesture
# (panel/panelClick.ts 'action' / 'recognize'). A menu-less extension indicator that reads raw presses gets the
# press replayed. With --with-dtp the buttons sit in Dash to Panel's panel.
# The stand-in (tools/dev/recorder-standin) shows the shell's real stop button and stubs only stopScreencast().
# Screenshots: rec-*.png
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
trace="$XDG_RUNTIME_DIR/spawn-recorder-standin.log"
panel_shown() { count spawn-button; }
traced() { grep -c "^$1\$" "$trace" 2>/dev/null || echo 0; }
recorder_uuid="spawn-recorder-standin@djshiye.github.io"
# a new recording: the stand-in shows the stop button again when it is re-enabled
new_recording() {
    gnome-extensions disable "$recorder_uuid"; sleep 0.5
    gnome-extensions enable "$recorder_uuid"; wait_active "$recorder_uuid" 10; sleep 1
}
if [ "$with_dtp" = 1 ]; then
    wait_active "$dtp_uuid" 30 || { echo "FAIL Dash to Panel did not become ACTIVE"; status=1; }
    dconf write /org/gnome/shell/extensions/dash-to-panel/intellihide false
    sleep 4
fi
leave_overview
close_menu
sleep 1
expect "the screen recording stop button is in the panel" "$(count screen-recording-indicator)" 1
expect "the stand-in menu-less indicator is in the panel" "$(count spawn-test-boxindicator)" 1
rm -f "$trace"

echo "-- left click on the stop button with the Spawn menu open"
open_menu 1.5
expect "Spawn is open" "$(hk popupOpen)" true
screenshot rec-desktop-before
click_class screen-recording-indicator 0 1
sleep 0.8
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and stopped the recording once" "$(traced recorder-stop)" 1
expect "the stop button is gone" "$(count screen-recording-indicator)" 0
screenshot rec-desktop-after

echo "-- left click on a menu-less extension indicator with the Spawn menu open"
rm -f "$trace"
open_menu 1.5
click_class spawn-test-boxindicator 0 1
sleep 0.8
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and reached the indicator once" "$(traced box-press-1)" 1

echo "-- over a fullscreen game: Super, then click the stop button"
WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" Game fullscreen >"$dev/testwin.log" 2>&1 &
game=$!
for _ in $(seq 20); do [ "$(panel_shown)" = 0 ] && break; sleep 0.5; done
sleep 1
expect "the fullscreen window hides the panel" "$(panel_shown)" 0
new_recording
rm -f "$trace"
key Super_L 1.5
expect "Super opens the menu over the game" "$(hk popupOpen)" true
expect "the panel is shown" "$(panel_shown)" 1
expect "the stop button is on the revealed panel" "$(count screen-recording-indicator)" 1
screenshot rec-game-before
click_class screen-recording-indicator 0 1
sleep 0.8
expect "one click closed Spawn" "$(hk popupOpen)" false
expect "... and stopped the recording once" "$(traced recorder-stop)" 1
screenshot rec-game-after
sleep 0.5
expect "the panel hides again over the game" "$(panel_shown)" 0

kill "$game" 2>/dev/null
