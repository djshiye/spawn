# Search keyboard model (UX audit U2, U13a; U7 for the results): the typing focus stays in the entry, Up / Down
# move ONE highlight through the results (Down goes to the second, the first is highlighted already; both
# wrap), Return / Ctrl+Return activate the highlighted result, the pointer moves the same highlight, Tab goes to
# the results. With the entry at the bottom the order is mirrored (best match right above the entry) and Up
# moves to the next match. Two probe apps tell which result was launched.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
probe() { # id name marker
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=/usr/bin/touch %s\nIcon=utilities-terminal\n' "$2" "$3" >"$apps/$1"
}
mA="$XDG_RUNTIME_DIR/spawn-keys-alpha"; mB="$XDG_RUNTIME_DIR/spawn-keys-beta"
rm -f "$mA" "$mB"
probe spawn-keys-alpha.desktop "Zzqv Alpha" "$mA"
probe spawn-keys-beta.desktop "Zzqv Beta" "$mB"
sleep 3
launched() { # which marker exists: alpha / beta / none / both
    if [ -e "$mA" ] && [ -e "$mB" ]; then echo both; elif [ -e "$mA" ]; then echo alpha; elif [ -e "$mB" ]; then echo beta; else echo none; fi
}
marker_of() { case "$1" in *Alpha*) echo alpha ;; *Beta*) echo beta ;; *) echo "?" ;; esac; }
entry() { state_get layout.focus | cut -c1-12; }

dconf write $K/search-entry-location "'Top'"
sleep 1
echo "-- entry on top: Down / Up move the highlight, the focus stays in the entry"
open_menu 1.2
key s 1.2
n="$(state_get layout.results)"
check "'s' has several results ($n)" "$([ "$n" -ge 3 ] && echo 0 || echo 1)"
expect_state "the best match is highlighted" layout.selectedIndex 0
key Down 0.4
expect "Down keeps the typing focus in the entry" "$(entry)" "Clutter_Text"
expect_state "Down moves the highlight to the second result" layout.selectedIndex 1
a="$(state_get layout.announcement)"
check "the screen reader is told the highlighted row and its position ($a)" "$(echo "$a" | grep -q ", 2 of $n\$" && echo 0 || echo 1)"
screenshot ui-search-keys-top
key Up 0.3
expect_state "Up moves it back" layout.selectedIndex 0
key Up 0.3
expect_state "Up from the first wraps to the last" layout.selectedIndex "$((n - 1))"
key Down 0.3
expect_state "Down from the last wraps to the first" layout.selectedIndex 0
key t 0.8
expect_state "typing keeps editing the query" layout.search st
expect_state "a new query highlights its best match" layout.selectedIndex 0
key Tab 0.4
expect "Tab from the entry goes to the results" "$(state_get layout.focus)" "St_Button.spawn-result-row"
expect_state "... onto the highlighted one" layout.focusIndex 0
key Escape 0.5
close_menu

echo "-- Return activates the highlighted result, not the first one"
open_menu 1.2
for c in z z q v; do key $c 0.1; done
sleep 1
expect_state "two probe results" layout.results 2
first="$(state_get layout.selected)"
key Down 0.4
second="$(state_get layout.selected)"
check "Down highlights the other probe ($first -> $second)" "$([ "$first" != "$second" ] && echo 0 || echo 1)"
key Return 1.2
expect_state "Return closed the menu" open false
expect "Return launched the highlighted result" "$(launched)" "$(marker_of "$second")"
rm -f "$mA" "$mB"

echo "-- U13a: Ctrl+Return in the entry launches the highlighted result and keeps the menu open"
open_menu 1.2
for c in z z q v; do key $c 0.1; done
sleep 1
sel="$(state_get layout.selected)"
key Ctrl+Return 1.2
expect_state "the menu stays open (keep-open-on-ctrl-click)" open true
expect "Ctrl+Return in the entry launched the highlighted result" "$(launched)" "$(marker_of "$sel")"
rm -f "$mA" "$mB"
key Tab 0.4
sel="$(state_get layout.selected)"
key Ctrl+Return 1.2
expect_state "Ctrl+Return on a focused result: the menu stays open too" open true
expect "... and launched that result" "$(launched)" "$(marker_of "$sel")"
rm -f "$mA" "$mB"
close_menu

echo "-- U7: the pointer moves the same highlight (and the Return target)"
open_menu 1.2
for c in z z q v; do key $c 0.1; done
sleep 1
move_class spawn-result-row 1 0.6
expect "pointing keeps the typing focus in the entry" "$(entry)" "Clutter_Text"
pointed="$(state_get layout.selected)"
expect_state "the pointed-at result is the highlighted one" layout.selectedIndex 1
expect "one highlight: only the pointed-at row has a hover tint" "$(state_get layout.hoverTints)" "[\"$pointed\"]"
screenshot ui-search-keys-hover
key Return 1.2
expect "Return launched the pointed-at result" "$(launched)" "$(marker_of "$pointed")"
rm -f "$mA" "$mB"

echo "-- entry at the bottom: best match right above the entry, Up goes to the next match"
dconf write $K/search-entry-location "'Bottom'"
sleep 1
ui_call Move 1500 800 >/dev/null
open_menu 1.2
key s 1.2
n="$(state_get layout.results)"
expect_state "the best match is highlighted" layout.selectedIndex 0
screenshot ui-search-keys-bottom
key Up 0.4
expect "Up keeps the typing focus in the entry" "$(entry)" "Clutter_Text"
expect_state "Up (away from the entry) moves to the second result" layout.selectedIndex 1
key Down 0.3
expect_state "Down moves back to the best match" layout.selectedIndex 0
key Down 0.3
expect_state "Down from the best match wraps to the last" layout.selectedIndex "$((n - 1))"
key Up 0.3
expect_state "Up from the last wraps to the best" layout.selectedIndex 0
key Tab 0.4
expect_state "Tab (search comes first) goes to the highlighted result" layout.focusIndex "$((n - 1))"
key Down 0.4
expect "the best match is the lowest row: Down from it leaves the list" "$(state_get layout.focus)" "St_Button.spawn-nav-button"
key Escape 0.5
close_menu
dconf reset $K/search-entry-location

echo "-- the runner: the same model"
rs() { dev_call RunnerState | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.ToggleRunner >/dev/null 2>&1
sleep 1.2
for c in z z q v; do key $c 0.1; done
sleep 1
expect "runner: the best match is highlighted" "$(rs selectedIndex)" 0
key Down 0.4
expect "runner: Down keeps the typing focus in the entry" "$(rs focus)" entry
expect "runner: Down moves the highlight to the second result" "$(rs selectedIndex)" 1
key Down 0.3
expect "runner: Down wraps to the first" "$(rs selectedIndex)" 0
key Up 0.3
expect "runner: Up wraps to the last" "$(rs selectedIndex)" 1
sel="$(rs selected)"
key Return 1.2
expect "runner: Return closed it" "$(rs open)" false
expect "runner: Return launched the highlighted (second) result" "$(launched)" "$(marker_of "$sel")"
rm -f "$mA" "$mB" "$apps"/spawn-keys-*.desktop
