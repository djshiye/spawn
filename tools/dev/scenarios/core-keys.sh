# Review2 core F7 (the shell PopupMenu key controller on the anchor must not bypass the click-action
# settings), F3 (shortcut rows must not use a disposed menu), F5 (:active stays while the popup is open),
# F6 (first context-menu open with only logind rows), F8 (Activities Overview row shows, not toggles).
K=/org/gnome/shell/extensions/spawn
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
menu_count() { count spawn-button-menu; }
wait_menu() { local i n=""; for ((i = 0; i < 24; i++)); do n="$(menu_count)"; [ "$n" = "$1" ] && break; sleep 0.25; done; echo "$n"; }
button_active() { attachment_status | json_get attachments.0.active; }
leave_overview
close_menu

echo "-- F7: left click action None, keys on the focused button do nothing (also after one popup open)"
dconf write $K/menu-button-left-click-action "'None'"; sleep 0.6
open_menu 1.2; close_menu            # the first popup open attaches the PopupMenu (and its key controller) to the button
dev_call FocusButton >/dev/null; sleep 0.4
for k in Return space Down; do
    key "$k" 1
    expect "$k does not open the popup (left click = None)" "$(hk popupOpen)" false
done
dconf write $K/menu-button-left-click-action "'ContextMenu'"; sleep 0.6
dev_call FocusButton >/dev/null; sleep 0.4
key Return 1
expect "left click = ContextMenu: Return opens the context menu, not the popup" "$(wait_menu 1)" 1
expect "... popup stays closed" "$(hk popupOpen)" false
key Escape 0.8
dconf write $K/menu-button-left-click-action "'Menu'"; sleep 0.6
dev_call FocusButton >/dev/null; sleep 0.4
key Return 1.2
expect "left click = Menu: Return still opens the popup" "$(hk popupOpen)" true
key Return 0.3 # inside the popup
close_menu
dev_call FocusButton >/dev/null; sleep 0.4
key space 1.2
expect "left click = Menu: Space opens it too" "$(hk popupOpen)" true
close_menu
dconf reset $K/menu-button-left-click-action

echo "-- F3: a shortcut row in the context menu closes the menu without disposed-object errors"
dconf write $K/context-menu-items "[{'id': 'Spawn_Home'}, {'id': 'Spawn_ActivitiesOverview'}]"; sleep 0.6
mark="$(wc -l <"$log")"
click_class spawn-button 0 3
expect "context menu open" "$(wait_menu 1)" 1
click_class popup-menu-item 0
expect "menu closed after the row" "$(wait_menu 0)" 0
sleep 1
tail -n +"$((mark + 1))" "$log" | grep -E 'Gjs-CRITICAL|already disposed|JS ERROR|\[spawn\].*(ERROR|failed)' && { echo "FAIL log noise after a shortcut row"; status=1; } || echo "ok   no Gjs-CRITICAL / disposed-object noise in the log"

echo "-- F8: Activities Overview row shows the overview (and does not hide it)"
click_class spawn-button 0 3
wait_menu 1 >/dev/null
click_class popup-menu-item 1
sleep 1.5
expect "overview visible" "$(hk overviewVisible)" true
click_class spawn-button 0 3
wait_menu 1 >/dev/null
click_class popup-menu-item 1
sleep 1.5
expect "second activation keeps it visible (show, not toggle)" "$(hk overviewVisible)" true
leave_overview
dconf reset $K/context-menu-items

echo "-- F6: a list with only Hibernate / Hybrid Sleep opens on the very first right click"
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
dconf write $K/context-menu-items "[{'id': 'Spawn_Hibernate'}, {'id': 'Spawn_HybridSleep'}]"
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
leave_overview
click_class spawn-button 0 3
n="$(wait_menu 1)"
if [ "$n" = 1 ]; then
    echo "ok   first right click opened a menu"
else
    echo "note: no menu on the first click (logind may report Hibernate / Hybrid Sleep unavailable in this sandbox): count=$n"
fi
key Escape 0.8
dconf reset $K/context-menu-items

echo "-- F5: the button keeps :active while the popup is open on it (context menu closed by the open)"
click_class spawn-button 0 3
wait_menu 1 >/dev/null
open_menu 1.3
expect "popup open" "$(hk popupOpen)" true
expect "button still :active" "$(button_active)" true
close_menu
