# Grid footer power bar follows its buttons: turning power buttons on / off and the Menu style in Grid resizes the
# bar (no compact squeeze, no "More", no ellipsised "Power Off"). Screenshots: grid-power-*.png.
K=/org/gnome/shell/extensions/spawn
leave_overview
FOUR="[(0, true), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false)]"
SIX="[(0, true), (1, true), (2, true), (3, true), (4, true), (5, false), (6, false), (7, true)]"
TWO="[(0, false), (1, true), (2, false), (3, true), (4, false), (5, false), (6, false), (7, false)]"
width() { python3 -c 'import json,sys; print(round(json.loads(sys.argv[1])[2]))' "$1"; }

# natural width of the Menu button's label in Classic, for comparison
dconf write $K/power-display-style "'Menu'"
sleep 1; open_menu 1.5
natural="$(width "$(ui_call TextRect 'Power Off' 0 | unwrap)")"
close_menu

dconf write $K/power-display-style "'Default'"
dconf write $K/power-options "$FOUR"
dconf write $K/layout-style "'Grid'"
sleep 1.5; open_menu 1.5
expect "Grid, 4 buttons: bar 200 px" "$(width "$(rect spawn-power-bar 0)")" 200

echo "-- turn on Suspend and Switch User while in Grid"
close_menu
dconf write $K/power-options "$SIX"
sleep 1.5; open_menu 1.5
expect "6 buttons: no compact squeeze" "$(count spawn-power-compact)" 0
expect "6 buttons: no More button" "$(count spawn-power-more)" 0
expect "6 buttons: all shown" "$(count spawn-power-button)" "$(( $(count spawn-grid-icon-button) + 6 ))"
expect "6 buttons: bar 296 px" "$(width "$(rect spawn-power-bar 0)")" 296
screenshot grid-power-six

echo "-- turn most off again"
close_menu
dconf write $K/power-options "$TWO"
sleep 1.5; open_menu 1.5
expect "2 buttons: bar shrinks to 104 px" "$(width "$(rect spawn-power-bar 0)")" 104

echo "-- Menu style in Grid"
close_menu
dconf write $K/power-display-style "'Menu'"
sleep 1.5; open_menu 1.5
expect "Menu style: 'Power Off' label at its natural width (not ellipsised)" \
    "$(width "$(ui_call TextRect 'Power Off' 0 | unwrap)")" "$natural"
screenshot grid-power-menu

close_menu
dconf reset $K/power-display-style
dconf reset $K/power-options
dconf reset $K/layout-style
