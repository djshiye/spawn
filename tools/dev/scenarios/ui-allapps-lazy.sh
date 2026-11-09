# All Apps builds its rows as needed: a long list holds the rows that fill the view (plus a few), the keyboard
# still reaches every row (Down past the built ones, Up from a search entry at the bottom onto the very last
# app), and after the menu closed only the first screenful is left. 120 extra stub apps make the list long.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
for i in $(seq 0 119); do
    printf '[Desktop Entry]\nType=Application\nName=Lazy Row %03d\nExec=true\nIcon=application-x-executable\nCategories=Utility;\n' "$i" \
        >"$apps/spawn-lazy-row-$i.desktop"
done
sleep 3 # installed-changed, then the AppIndex rebuild (500 ms debounce)

open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
built="$(count spawn-list-row)"
pending="$(state_get layout.appRowsPending)"
echo "All Apps: $built rows built, $pending pending"
check "All Apps builds the visible rows, not all of them (built $built, pending $pending)" "$([ "$built" -ge 8 ] && [ "$built" -le 60 ] && [ "${pending:-0}" -ge 100 ] && echo 0 || echo 1)"
check "the built rows carry their names" "$(state_get layout.appRows | grep -q '"' && echo 0 || echo 1)"

echo "-- Down past the built rows: the keyboard stays in the list and the rows follow"
ui_call Move 5 5 >/dev/null; sleep 0.3 # the pointer off the list: a row scrolled under it would take the focus
focus_class spawn-list-row 0
steps=$((built + 6))
trace=""
for i in $(seq 1 "$steps"); do key Down 0.15; trace="$trace $(state_get layout.focusIndex)"; done
echo "focus index after each Down:$trace"
sleep 0.4
focus="$(state_get layout.focus)"
index="$(state_get layout.focusIndex)"
case "$focus" in St_Button.spawn-list-row*) r=0 ;; *) r=1 ;; esac
check "after $steps x Down the focus is still an app row ($focus, index $index)" "$r"
expect "the focus moved $steps rows down" "$index" "$steps"
check "more rows were built on the way ($(count spawn-list-row) > $built)" "$([ "$(count spawn-list-row)" -gt "$built" ] && echo 0 || echo 1)"
screenshot ui-allapps-lazy-down

echo "-- the menu closed: only the first screenful stays"
close_menu; sleep 1
open_menu 1.2
ui_call ShowView all >/dev/null; sleep 1
again="$(count spawn-list-row)"
check "reopened All Apps has a screenful of rows again ($again)" "$([ "$again" -le 60 ] && echo 0 || echo 1)"

echo "-- Up from a search entry at the bottom lands on the very last app"
close_menu
dconf write $K/search-entry-location "'Bottom'"
sleep 1
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
key Up 0.6
expect_state "the search entry is at the bottom" layout.searchTop false
pending="$(state_get layout.appRowsPending)"
name="$(ui_call FocusInfo | unwrap | json_get name)"
last="$(state_get layout.appRows | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1])')"
expect "every row exists once Up entered from below" "$pending" "0"
expect "Up from the bottom search entry focuses the last app" "$name" "$last"
screenshot ui-allapps-lazy-last
close_menu
dconf reset $K/search-entry-location

rm -f "$apps"/spawn-lazy-row-*.desktop
sleep 3
