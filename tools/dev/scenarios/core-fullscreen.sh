# Super over a fullscreen window (a game): the shell hides the panel (the top bar, or Dash to Panel without
# intellihide), and the menu must still open attached to its panel button, with the panel shown while it is
# open (panel/fullscreenReveal.ts), then hidden again once the menu closes. Runs with the stock top bar, or
# with --with-dtp against a Dash to Panel panel (intellihide off). With --with-dtp it also checks that ONE
# click on a pinned app in the panel closes the menu AND launches the app (panel/panelClick.ts), on the
# normal desktop and over the fullscreen window. Screenshots: fullscreen-*.png
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
marker="$XDG_RUNTIME_DIR/spawn-fullscreen-probe-launched"
if [ "$with_dtp" = 1 ]; then
    # Make the first pinned (favourite) app leave a marker file when it runs: shadow its .desktop file in the
    # user data dir (same id), so the favourites list itself never changes (changing it at runtime trips a
    # JS error in the shell's own dash, unrelated to Spawn).
    probe_id="$(gsettings get org.gnome.shell favorite-apps | python3 -c 'import ast, sys; print(ast.literal_eval(sys.stdin.read().split("@as ")[-1])[0])')"
    echo "pinned probe app: $probe_id"
    mkdir -p "$XDG_DATA_HOME/applications"
    printf '[Desktop Entry]\nType=Application\nName=Zzqx Panel Probe\nExec=/usr/bin/touch %s\nIcon=application-x-executable\n' "$marker" \
        >"$XDG_DATA_HOME/applications/$probe_id"
    sleep 5
fi
# probe_click: with the menu open, click the pinned probe app once; it must close the menu AND launch the app.
probe_click() { # label
    rm -f "$marker"
    local c
    c="$(center "$probe_cls" 0)" || { echo "FAIL $1: no pinned app icon ($probe_cls) in the panel"; status=1; return; }
    # shellcheck disable=SC2086
    click $c
    sleep 1.5
    expect "$1: the click closes the menu" "$(hk popupOpen)" false
    check "$1: the same click launches the pinned app" "$([ -e "$marker" ] && echo 0 || echo 1)"
}
leave_overview
close_menu
sleep 1
expect "panel visible before the game" "$(panel_shown)" 1
if [ "$with_dtp" = 1 ]; then
    echo "pinned app icons in the panel: $(count overview-tile)"
    probe_cls=overview-tile  # Dash to Panel app icons; the first one is the probe
    echo "-- one click on a pinned app with the menu open (normal desktop)"
    open_menu 1.5
    expect "menu open" "$(hk popupOpen)" true
    probe_click "desktop"
fi
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

if [ "$with_dtp" = 1 ]; then
    echo "-- one click on a pinned app with the menu open over the fullscreen window"
    key Super_L 1.5
    expect "Super opens the menu over the game again" "$(hk popupOpen)" true
    probe_click "fullscreen"
    sleep 0.5
    expect "the panel hides again after the click" "$(panel_shown)" 0
    screenshot "fullscreen-$label-after-panel-click"
fi

kill "$game" 2>/dev/null
for _ in $(seq 20); do [ "$(panel_shown)" = 1 ] && break; sleep 0.5; done
expect "panel back after the game closed" "$(panel_shown)" 1
