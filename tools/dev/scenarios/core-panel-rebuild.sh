# The Spawn button is destroyed and rebuilt while its menu is open (here: a position change; Dash to Panel rebuilding
# its panels does the same). Nothing may touch the destroyed button afterwards (ui/menu.ts _anchorGone): no
# Gjs-CRITICAL "already disposed" lines, the menu closes with its button, and the new button works.
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
K=/org/gnome/shell/extensions/spawn
leave_overview
close_menu
sleep 1
open_menu 1.5
expect "menu open before the rebuild" "$(hk popupOpen)" true
mark="$(wc -l <"$log")"
dconf write $K/position-in-panel "'Center'"
sleep 2
expect "menu closed with its button" "$(hk popupOpen)" false
expect "the button is back in the panel" "$(count spawn-button)" 1
tail -n +"$((mark + 1))" "$log" | grep -E 'Gjs-CRITICAL|already disposed|JS ERROR|\[spawn\].*(ERROR|failed)' \
    && { echo "FAIL log noise after the button was rebuilt with the menu open"; status=1; } \
    || echo "ok   no Gjs-CRITICAL / disposed-object noise after the rebuild"
open_menu 1.5
expect "the new button opens the menu" "$(hk popupOpen)" true
close_menu
dconf reset $K/position-in-panel
sleep 2
