# Folder popup highlight: only the app under the pointer (hover tint) or the one reached with the arrow
# keys (focus ring) is highlighted, never both. Opening a folder with the pointer puts no ring on the first
# app; the keyboard (Return on a folder) still starts on it. Pointing at an app takes the ring off the
# others, and the arrow keys move on from the app under the pointer.
K=/org/gnome/shell/extensions/spawn
leave_overview

focus_name() { ui_call FocusInfo | unwrap | json_get name; }
focus_cls() { ui_call FocusInfo | unwrap | json_get cls; }
hovered_count() { # visible tiles drawn with :hover
    local n h=0
    for ((n = 0; n < $(count spawn-tile); n++)); do
        ui_call Appearance spawn-tile $n | unwrap | json_get pseudo | grep -q hover && h=$((h + 1))
    done
    echo $h
}
one_highlight() { # <label>: exactly one app is highlighted (hover tint xor focus ring)
    local f h
    f="$(focus_cls | grep -c spawn-tile)"
    h="$(hovered_count)"
    expect "$1: one highlight (focused apps $f + hovered apps $h)" "$((f + h))" 1
}
hover_text() { # <app name>: pointer to the centre of that label's tile
    local r
    r="$(ui_call TextRect "$1" 0 | unwrap)"
    [ -n "$r" ] || { echo "FAIL no label '$1'"; status=1; return 1; }
    local c
    c="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y-12))' "$r")"
    ui_call Move $c >/dev/null; sleep 0.25
    ui_call Move $c >/dev/null; sleep 0.5
}

set_display Grid
close_menu; open_menu 1.5

echo "-- opened with the pointer: no app is highlighted until the pointer or the keyboard picks one"
click_class spawn-folder-tile 1
sleep 0.6
expect_state "Games folder open" layout.view folder
check "no app holds the focus after a pointer open (focus: $(focus_cls))" "$(focus_cls | grep -q spawn-tile && echo 1 || echo 0)"
# park the pointer on the scrim, away from every tile
c="$(scrim_point 6 6)"; ui_call Move $c >/dev/null; sleep 0.25; ui_call Move $c >/dev/null; sleep 0.4
screenshot folder-focus/opened-by-pointer

echo "-- hover moves the focus: one highlight"
hover_text bottles
one_highlight "pointing at bottles"
screenshot folder-focus/hover-bottles
hover_text Discord
one_highlight "pointing at Discord"
screenshot folder-focus/hover-discord

echo "-- pointer leaves the apps: the highlight goes with it"
c="$(scrim_point 6 6)"; ui_call Move $c >/dev/null; sleep 0.25; ui_call Move $c >/dev/null; sleep 0.4
check "no app holds the focus once the pointer left (focus: $(focus_cls))" "$(focus_cls | grep -q spawn-tile && echo 1 || echo 0)"
expect "nothing is highlighted once the pointer left" "$(hovered_count)" 0

echo "-- arrow keys pick up from there"
key Right 0.4
expect "Right starts on the first app" "$(focus_name)" eden
key Right 0.4
expect "Right moves on" "$(focus_name)" hgl
screenshot folder-focus/keyboard-hgl

echo "-- pointing at an app while another has the ring: the ring goes"
hover_text bottles
one_highlight "ring on hgl, then pointing at bottles"
check "the card holds the focus while bottles is pointed at (focus: $(focus_cls))" "$(focus_cls | grep -q spawn-folder-popup && echo 0 || echo 1)"
echo "-- an arrow key while the pointer rests on an app: starts from that app, the hover tint goes"
key Left 0.4
expect "Left moves on from the pointed-at app" "$(focus_name)" hgl
expect "no app keeps a hover tint under the resting pointer" "$(hovered_count)" 0
screenshot folder-focus/keyboard-over-hover
key Escape 0.6

echo "-- opened with the keyboard: starts on the first app"
focus_class spawn-folder-tile 1
key Return 0.8
expect_state "Games folder open (keyboard)" layout.view folder
expect "keyboard open focuses the first app" "$(focus_name)" eden
screenshot folder-focus/opened-by-keyboard
key Escape 0.6

echo "-- light preset"
dconf write $K/override-menu-theme true
dconf write $K/menu-background-color "'rgb(245,247,250)'"
dconf write $K/menu-foreground-color "'rgb(18,51,84)'"
dconf write $K/menu-border-color "'rgba(18,51,84,0.2)'"
close_menu; open_menu 1.5
click_class spawn-folder-tile 1
sleep 0.6
hover_text bottles
screenshot folder-focus/light-hover
key Escape 0.6
dconf reset $K/override-menu-theme
dconf reset $K/menu-background-color
dconf reset $K/menu-foreground-color
dconf reset $K/menu-border-color
