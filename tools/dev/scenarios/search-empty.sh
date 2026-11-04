# Empty state: the "No results" label is centred; stale rows are replaced, not stacked.
open_menu 1.5
ui_call Search zzzzqq >/dev/null; sleep 1.5
expect_state "nonsense query has no rows" layout.results 0
screenshot search-empty-centered
ui_call Search fire >/dev/null; sleep 1.2
n="$(state_get layout.results)"
check "'fire' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
ui_call Search firex >/dev/null; sleep 0.9
n2="$(state_get layout.results)"
check "narrower query does not stack rows ($n2 <= $n)" "$([ "$n2" -le "$n" ] && echo 0 || echo 1)"
ui_call Search zzzzqq >/dev/null; sleep 1.2
expect_state "back to no rows" layout.results 0
