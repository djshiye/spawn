# Main views (pinned / all apps by category / frequent) and the all-apps button / back button.
open_menu 1.5
expect_state "default view is pinned" layout.view pinned
expect_state "6 pinned tiles (3 apps + 3 folders)" layout.tiles 6
screenshot ui-pinned
ui_call ShowView categories >/dev/null; sleep 0.8
expect_state "categories view" layout.view categories
screenshot ui-allapps
# the column is as wide as its longest name (to a cap): needs an app set with a long category such as "Sound & Video"
cut="$(ui_call Truncated spawn-category-column 0 | unwrap)"
expect "no category name is cut off in the column" "$cut" "[]"
ui_call ShowView default >/dev/null; sleep 0.4
echo "-- All Apps button (click), then Escape goes back"
click_class spawn-nav-button 0
expect_state "All Apps button opens the categories view" layout.view categories
key Down; key Down; key Down 0.6
screenshot ui-allapps-kb
key Escape 0.6
expect_state "Escape returns to the pinned view" layout.view pinned
expect_state "menu stays open" open true
