# Layout variants: search on top, power buttons as a menu, square avatar, categories default view, hidden search.
K=/org/gnome/shell/extensions/spawn
dconf write $K/search-entry-location "'Top'"
dconf write $K/default-menu-view "'Pinned_And_Frequent_Apps'"
dconf write $K/power-display-style "'Menu'"
dconf write $K/avatar-style "'Square'"
dconf write $K/menu-height 520
sleep 1
open_menu 1.5
screenshot ui-variant-1
key Down
key Tab 0.2; key Tab 0.2; key Tab 0.2; key Tab 0.5
expect_state "focus stays in the layout (variant 1)" layout.focusInLayout true
dconf write $K/default-menu-view "'Categories_List'"
dconf write $K/search-hidden true
sleep 1
close_menu
open_menu 1.5
screenshot ui-variant-2
key x 0.6
expect_state "typing with a hidden search box reveals it and searches" layout.search x
expect_state "results view while searching" layout.view results
key Escape 0.6
expect_state "Escape clears the query" layout.search ""
expect_state "menu still open" open true
