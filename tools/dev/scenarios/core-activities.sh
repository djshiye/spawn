# Hide-Activities setting (panel/activities.ts): the Activities button disappears, comes back on the
# setting off, and is hidden again after a disable/enable (the Ui interface is gone while Spawn is disabled). (The re-hide against ArcMenu being disabled is covered by
# tests/core-activities.test.js with a fake emitter: ArcMenu cannot run in the sandbox.)
K=/org/gnome/shell/extensions/spawn
leave_overview
close_menu
base="$(count panel-button)"
echo "visible panel buttons: $base"
dconf write $K/hide-activities-button true; sleep 1.2
expect "hide on: one panel button less" "$(count panel-button)" "$((base - 1))"
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
expect "re-enabled with the setting on: hidden again" "$(count panel-button)" "$((base - 1))"
dconf write $K/hide-activities-button false; sleep 1.2
expect "hide off: button count back to the start" "$(count panel-button)" "$base"
