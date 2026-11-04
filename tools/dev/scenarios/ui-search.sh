# Search: results appear, zero-result query, Escape/back handling, details.
open_menu 1.5
ui_call Search fire >/dev/null; sleep 1.5
expect_state "search view shown" layout.view results
n="$(state_get layout.results)"
check "'fire' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
screenshot ui-search-fire
echo "-- mouse back button returns to the default view"
click 300 300 8
expect_state "mouse button 8 leaves the results" layout.view pinned
ui_call Search zzzzqq >/dev/null; sleep 1.2
expect_state "nonsense query shows the results view" layout.view results
expect_state "nonsense query has no rows" layout.results 0
screenshot ui-search-empty
ui_call Search setting >/dev/null; sleep 1.2
n="$(state_get layout.results)"
check "'setting' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
key Escape 0.6
expect_state "Escape clears the query" layout.search ""
echo "-- Down from the search entry moves focus into the result list"
ui_call Search "setting" >/dev/null; sleep 1.2
key Down 0.4
expect_state "focus is in the layout, off the entry" layout.focusInLayout true
echo "focus: $(state_get layout.focus)"
