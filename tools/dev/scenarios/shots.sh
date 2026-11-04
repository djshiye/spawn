# The review screenshots, into .dev/shots/final/.
leave_overview
out="$shots/final"
mkdir -p "$out"
open_menu 1.5
screenshot final/pinned
ui_call ShowView categories >/dev/null; sleep 0.8
screenshot final/all-apps
ui_call ShowView default >/dev/null; sleep 0.4
ui_call OpenFolder 0 >/dev/null; sleep 0.8
screenshot final/folder-open
ui_call ShowView default >/dev/null; sleep 0.4
ui_call Search fire >/dev/null; sleep 1.5
screenshot final/search-fire
key Escape 0.8
key Down; key Menu 1.2
screenshot final/context-menu
key Escape 0.6
ui_call Move 503 622 >/dev/null; sleep 1.6
screenshot final/power-tooltip
