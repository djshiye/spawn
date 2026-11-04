# Term highlighting on: non-BMP and accented queries must not break row creation.
K=/org/gnome/shell/extensions/spawn
dconf write $K/highlight-search-result-terms true
dconf write $K/show-search-result-details true
sleep 1
open_menu 1.5
ui_call Search fire >/dev/null; sleep 1.2
n="$(state_get layout.results)"
check "highlighted 'fire' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
screenshot search-highlight
ui_call Search "🔥 fi" >/dev/null; sleep 1.2
expect_state "emoji query does not crash the list" open true
ui_call Search "İstanbul" >/dev/null; sleep 1.2
expect_state "dotted capital I query does not crash the list" open true
