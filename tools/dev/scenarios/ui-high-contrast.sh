# High contrast (GNOME Settings > Accessibility > High Contrast): the menu gets the `spawn-hc` class while the switch is on and
# loses it when it is off, sizes do not change (the outlines are inset shadows), and the item you point at, select or focus
# is outlined. Classic and Grid, dark and light. Screenshots: hc-<scheme>-<layout>-{pinned,hover,focus,focus-hover,search}.png
# (and -off for the same menu without high contrast, to compare). Wants the realistic app set.
K=/org/gnome/shell/extensions/spawn
A=org.gnome.desktop.a11y.interface
leave_overview
gsettings set org.gnome.desktop.notifications show-banners false 2>/dev/null
dconf write $K/pinned-apps "[{'id': 'org.mozilla.firefox.desktop'}, {'id': 'org.gnome.Nautilus.desktop'}, {'id': 'org.gnome.Ptyxis.desktop'}, {'id': 'org.gnome.TextEditor.desktop'}, {'id': 'code.desktop'}, {'id': 'org.gnome.Calendar.desktop'}, {'id': 'org.gnome.Software.desktop'}, {'id': 'org.gnome.Settings.desktop'}, {'id': 'gone.app.desktop'}, {'id': 'org.gnome.Loupe.desktop'}, {'id': 'org.libreoffice.Writer.desktop'}, {'id': 'Zoom.desktop'}]"
dconf write $K/pinned-apps-display "'Grid'"
park() { ui_call Move 1500 850 >/dev/null; sleep 0.4; }
size() { python3 -c 'import json,sys; r=json.loads(sys.argv[1]); print(r[2], r[3])' "$(rect "$1" "${2:-0}")"; }

for scheme in dark light; do
    gsettings set org.gnome.desktop.interface color-scheme prefer-$scheme; sleep 1.5
    for lay in Classic Grid; do
        dconf write $K/layout-style "'$lay'"; sleep 1.5
        ITEM=spawn-tile # pinned-apps-display is Grid: tiles in both layouts
        echo "-- $scheme, $lay"
        gsettings set $A high-contrast false; sleep 1
        open_menu 1.5; park
        expect "$scheme $lay: no spawn-hc class without high contrast" "$(count spawn-hc)" 0
        menu_off="$(size spawn-menu-popup)"; tile_off="$(size "$ITEM")"
        screenshot hc-$scheme-$lay-off
        close_menu
        gsettings set $A high-contrast true; sleep 2
        open_menu 1.5; park
        check "$scheme $lay: the menu has the spawn-hc class with high contrast" "$([ "$(count spawn-hc)" -ge 1 ] && echo 0 || echo 1)"
        expect "$scheme $lay: the menu has the same size" "$(size spawn-menu-popup)" "$menu_off"
        expect "$scheme $lay: a tile has the same size" "$(size "$ITEM")" "$tile_off"
        screenshot hc-$scheme-$lay-pinned
        move_class "$ITEM" 2 0.8; screenshot hc-$scheme-$lay-hover; park
        park; focus_class "$ITEM" 1; screenshot hc-$scheme-$lay-focus; move_class "$ITEM" 3 0.8; screenshot hc-$scheme-$lay-focus-hover; park
        ui_call Search "fi" >/dev/null; sleep 1.3; screenshot hc-$scheme-$lay-search
        ui_call Search "" >/dev/null; sleep 0.5
        gsettings set $A high-contrast false; sleep 1
        expect "$scheme $lay: switching high contrast off with the menu open drops spawn-hc at once" "$(count spawn-hc)" 0
        gsettings set $A high-contrast true; sleep 1
        check "$scheme $lay: switching it on with the menu open adds spawn-hc at once" "$([ "$(count spawn-hc)" -ge 1 ] && echo 0 || echo 1)"
        close_menu
    done
    gsettings set $A high-contrast false; sleep 1
done
dconf reset $K/layout-style
dconf reset $K/pinned-apps-display
# desktop-wide keys reset_seed does not restore: leave them as the next scenario of the sweep expects
gsettings reset org.gnome.desktop.interface color-scheme
gsettings reset $A high-contrast
gsettings reset org.gnome.desktop.notifications show-banners
sleep 1
