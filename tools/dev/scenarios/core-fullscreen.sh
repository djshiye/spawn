# Super over a fullscreen window (a game): the shell hides the panel (the top bar, or Dash to Panel without
# intellihide), and the menu must still open attached to its panel button, with the panel shown while it is
# open (panel/fullscreenReveal.ts), then hidden again once the menu closes. Runs with the stock top bar, or
# with --with-dtp against a Dash to Panel panel (intellihide off). Screenshots: fullscreen-*.png
wl="$(cd "$XDG_RUNTIME_DIR" && ls -d wayland-* 2>/dev/null | grep -v '\.lock$' | head -1)"
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
panel_shown() { count spawn-button; }   # Count walks visible actors only: 0 = the panel box is hidden
label=top-bar
if [ "$with_dtp" = 1 ]; then
    label=dtp
    wait_active "$dtp_uuid" 30 || { echo "FAIL Dash to Panel did not become ACTIVE"; status=1; }
    dconf write /org/gnome/shell/extensions/dash-to-panel/intellihide false
    sleep 4
fi
leave_overview
close_menu
sleep 1
expect "panel visible before the game" "$(panel_shown)" 1
# Where the menu sits without a fullscreen window: the reference for the fullscreen open below.
gap() { # dump.json: gap in px between the popup content and its panel button (top or bottom panel)
    python3 - "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
a = d["anchor"]
box = next(i for i in d["items"] if "popup-menu-content" in i.get("cls", ""))
gap = box["y"] - (a[1] + a[3]) if box["y"] >= a[1] else a[1] - (box["y"] + box["h"])
print(f"{gap:g}")
PY
}
mkdir -p "$dev/ux"
open_menu 1.5
dump_ui "$dev/ux/fullscreen-$label-ref.json"
ref="$(gap "$dev/ux/fullscreen-$label-ref.json")"
echo "reference gap without a fullscreen window: $ref px"
screenshot "fullscreen-$label-reference"
close_menu
sleep 0.5

WAYLAND_DISPLAY="$wl" GDK_BACKEND=wayland gjs -m "$root/tools/dev/testwin.js" Game fullscreen >"$dev/testwin.log" 2>&1 &
game=$!
for _ in $(seq 20); do [ "$(panel_shown)" = 0 ] && break; sleep 0.5; done
sleep 1
expect "the fullscreen window hides the panel" "$(panel_shown)" 0
screenshot "fullscreen-$label-game"

key Super_L 1.5
expect "Super opens the menu over the fullscreen window" "$(hk popupOpen)" true
expect "the panel is shown while the menu is open" "$(panel_shown)" 1
dump_ui "$dev/ux/fullscreen-$label.json"
expect "menu sits as far from its panel button as without a fullscreen window" "$(gap "$dev/ux/fullscreen-$label.json")" "$ref"
screenshot "fullscreen-$label-menu"

key Super_L 1.5
expect "Super closes the menu again" "$(hk popupOpen)" false
sleep 0.5
expect "the panel is hidden again over the game" "$(panel_shown)" 0
screenshot "fullscreen-$label-closed"

kill "$game" 2>/dev/null
for _ in $(seq 20); do [ "$(panel_shown)" = 1 ] && break; sleep 0.5; done
expect "panel back after the game closed" "$(panel_shown)" 1
