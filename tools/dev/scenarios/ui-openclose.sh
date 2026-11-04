# Open / close 20x, then disable the extension while the menu is open and enable it again.
open_menu 1.5
close_menu
for i in $(seq 20); do
    dev_call Open >/dev/null; sleep 0.25
    [ "$(state_get open)" = true ] || { echo "FAIL open #$i did not open"; status=1; break; }
    dev_call Close >/dev/null; sleep 0.45
    [ "$(state_get open)" = false ] || { echo "FAIL close #$i did not close"; status=1; break; }
done
echo "20 open/close cycles done"
expect_state "closed after 20 cycles" open false
open_menu 0.8
ui_call Search fi >/dev/null; sleep 0.6
expect_state "search text present while open" layout.search fi
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
echo "after disable while open: $(ext_state "$uuid" | head -1 | tr -s ' ')"
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
open_menu 1.2
expect_state "menu opens after re-enable" open true
expect_state "pinned view after re-enable" layout.view pinned
screenshot ui-reenabled
