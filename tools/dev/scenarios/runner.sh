# The standalone runner (src/ui/runner.ts): opened by the D-Bus method ToggleRunner and by the
# runner-hotkey accelerator (a real chord through the virtual keyboard), real typing, Return launches
# a harmless probe app, Escape / a click outside / the main menu close it, the main menu closes it
# (and it closes the menu), disable/enable while open leaves nothing behind. Seeded (see dev-shell.sh).
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
marker="$XDG_RUNTIME_DIR/spawn-runner-launched"
mkdir -p "$apps"
rm -f "$apps"/spawn-runner-*.desktop "$marker"
mkdesktop() { # id name exec
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=%s\nIcon=utilities-terminal\n' "$2" "$3" >"$apps/$1"
}
rs() { dev_call RunnerState | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
toggle_runner() { gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.ToggleRunner >/dev/null 2>&1; sleep "${1:-1}"; }
sendkeys() { dev_call SendKeys "$1" >/dev/null; sleep "${2:-1.2}"; }
type_text() { local c; for c in $(echo "$1" | sed 's/./& /g'); do key "$c" 0.12; done; sleep "${2:-1.2}"; }
runner_count() { count spawn-runner; }
CHORD="+Control_L +Alt_L +Super_L +r -r -Super_L -Alt_L -Control_L"

mkdesktop spawn-runner-probe.desktop "Zzqx Runner Probe" "/usr/bin/touch $marker"
sleep 3
leave_overview
close_menu
mark="$(wc -l <"$log")"

echo "-- nothing is built before the first open"
expect "runner not built at start" "$(rs built)" false
expect "runner closed at start" "$(rs open)" false

echo "-- ToggleRunner opens it (default: Top, nothing but the search box)"
toggle_runner 1.2
expect "runner open" "$(rs open)" true
expect "runner built now" "$(rs built)" true
expect "one runner popup visible" "$(runner_count)" 1
expect "the search box has the focus" "$(rs focus)" entry
expect "no results before typing" "$(rs view)" default
read -r rx ry rw rh < <(rs rect | python3 -c 'import json, sys; print(*json.load(sys.stdin))')
echo "runner rect: $rx $ry $rw $rh"
check "runner is centred horizontally on the 1600 px monitor" "$(python3 -c "import sys; sys.exit(0 if abs(($rx + $rw / 2) - 800) < 4 else 1)"; echo $?)"
check "runner sits at the top of the work area (y=$ry)" "$([ "${ry%.*}" -lt 120 ] && echo 0 || echo 1)"
check "runner is 500 px wide plus its popup padding ($rw)" "$([ "${rw%.*}" -ge 500 ] && [ "${rw%.*}" -le 540 ] && echo 0 || echo 1)"

echo "-- typing searches; the probe app is the first result"
type_text zzqx 1.5
expect "query reaches the box" "$(rs query)" zzqx
expect "results view" "$(rs view)" results
n="$(rs results)"
check "'zzqx' has a result ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
screenshot runner-results

echo "-- Down moves into the rows, Up back to the entry, typing from a row returns to the entry"
key Down 0.4
expect "Down focuses a row" "$(rs focus)" row
key Up 0.4
expect "Up returns to the entry" "$(rs focus)" entry
key Down 0.4
key q 0.4
expect "typing from a row goes back to the entry" "$(rs focus)" entry
expect "... and appends to the query" "$(rs query)" zzqxq
key BackSpace 0.8
expect "BackSpace removes it" "$(rs query)" zzqx
key Tab 0.4
expect "Tab moves into the rows" "$(rs focus)" row

echo "-- Escape closes and resets"
key Escape 0.8
expect "Escape closes the runner" "$(rs open)" false
expect "no runner popup left" "$(runner_count)" 0
toggle_runner 1.2
expect "reopened with an empty box" "$(rs query)" ""
expect "reopened in the default view" "$(rs view)" default

echo "-- Return launches the first result and closes the runner"
type_text zzqx 1.2
key Return 1.5
expect "Return closed the runner" "$(rs open)" false
check "the probe app was launched ($marker)" "$([ -e "$marker" ] && echo 0 || echo 1)"
rm -f "$marker"

echo "-- Return inside the debounce window still activates the current query"
toggle_runner 1.2
for c in z z q x; do key "$c" 0.02; done
key Return 1.8
expect "fast Return closed the runner" "$(rs open)" false
check "... and launched the probe app" "$([ -e "$marker" ] && echo 0 || echo 1)"
rm -f "$marker"

echo "-- a click outside closes it"
toggle_runner 1.2
expect "open again" "$(rs open)" true
click 60 860
expect "click outside closed the runner" "$(rs open)" false

echo "-- mutual exclusion with the main menu"
toggle_runner 1.2
open_menu 1.5
expect "opening the main menu closed the runner" "$(rs open)" false
expect "main menu is open" "$(rs popupOpen)" true
toggle_runner 1.5
expect "opening the runner closed the main menu" "$(rs popupOpen)" false
expect "runner is open" "$(rs open)" true
close_menu
expect "Dev.Close leaves the runner alone (it is not the main menu)" "$(rs open)" true
key Escape 0.8

echo "-- the runner-hotkey accelerator (real chord)"
expect "no accelerator bound by default" "$(rs accelBound)" false
dconf write $K/runner-hotkey "['<Primary><Alt><Super>r']"; sleep 1.5
expect "accelerator bound" "$(rs accelBound)" true
sendkeys "$CHORD"
expect "the chord opens the runner" "$(rs open)" true
sendkeys "$CHORD"
expect "the chord closes it again (POPUP action mode)" "$(rs open)" false
dconf write $K/runner-hotkey "['<Primary><Alt><Super>t']"; sleep 1.5
expect "re-bound" "$(rs accelBound)" true
sendkeys "$CHORD"
expect "the old chord does nothing" "$(rs open)" false
dconf write $K/runner-hotkey "@as []"; sleep 1.5
expect "unbound again" "$(rs accelBound)" false

echo "-- settings: Centered position, width, default view"
dconf write $K/runner-position "'Centered'"
dconf write $K/runner-menu-width 700
dconf write $K/runner-default-view "'Pinned_Apps'"
dconf write $K/pinned-apps "[{'id': 'spawn-runner-probe.desktop'}]"
sleep 1
toggle_runner 1.5
read -r cx cy cw ch < <(rs rect | python3 -c 'import json, sys; print(*json.load(sys.stdin))')
echo "centred rect: $cx $cy $cw $ch"
check "Centered: lower than Top (y=$cy)" "$([ "${cy%.*}" -gt 200 ] && echo 0 || echo 1)"
check "width follows runner-menu-width ($cw)" "$([ "${cw%.*}" -ge 700 ] && [ "${cw%.*}" -le 740 ] && echo 0 || echo 1)"
expect "Pinned_Apps lists the pinned probe app" "$(rs defaultRows)" 1
screenshot runner-pinned-centered
key Return 1.5
expect "Return on the empty box launches the first listed app" "$(rs open)" false
check "... the probe app ran" "$([ -e "$marker" ] && echo 0 || echo 1)"
rm -f "$marker"
dconf reset $K/runner-position; dconf reset $K/runner-menu-width; dconf reset $K/runner-default-view
sleep 0.5

echo "-- disable / enable while open leaves no leaks"
toggle_runner 1.2
type_text zz 1
expect "open before disabling" "$(rs open)" true
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 2
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
leave_overview
expect "runner is unbuilt after re-enable" "$(rs built)" false
expect "no runner popup actor after re-enable" "$(runner_count)" 0
toggle_runner 1.5
expect "runner opens after re-enable" "$(rs open)" true
type_text zzqx 1.2
screenshot runner-reenabled
key Escape 0.8
expect "closed again" "$(rs open)" false

echo "-- the main menu still works"
open_menu 1.5
expect "main menu opens" "$(rs popupOpen)" true
close_menu

echo "-- log: nothing after the start of this scenario"
sleep 1
tail -n +"$((mark + 1))" "$log" | grep -a -E 'Gjs-CRITICAL|Clutter-CRITICAL|St-CRITICAL|-CRITICAL|already disposed|JS ERROR|\[spawn\].*(ERROR|failed|threw)' && { echo "FAIL log noise during the runner scenario"; status=1; } || echo "ok   no CRITICAL / disposed-object / spawn errors in the log"
dconf reset $K/pinned-apps
rm -f "$apps"/spawn-runner-*.desktop "$marker"
