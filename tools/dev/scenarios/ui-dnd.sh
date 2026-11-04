# Drag and drop on the pinned grid (virtual pointer): app onto app = new folder, reorder, app into folder.
open_menu 1.5
before="$(pinned_ids)"
echo "pinned before: $before"
echo "-- drag Steam onto Claude -> a new folder"
ui_call Move 68 113 >/dev/null; sleep 0.5
ui_call Drag 68 113 166 113 >/dev/null; sleep 2.2
screenshot ui-dnd-newfolder
after="$(pinned_ids)"
echo "pinned after: $after"
n_before="$(echo "$before" | wc -w)"; n_after="$(echo "$after" | wc -w)"
expect "one entry fewer after merging two apps into a folder" "$n_after" "$((n_before - 1))"
echo "$after" | grep -q 'steam.desktop' && { echo "FAIL steam still top-level"; status=1; } || echo "ok   steam is no longer top-level"
echo "-- reorder: drag Husk to the front"
ids="$(pinned_ids)"
ui_call Move 166 113 >/dev/null; sleep 0.5
ui_call Drag 166 113 30 113 >/dev/null; sleep 2.2
now="$(pinned_ids)"
echo "pinned after reorder: $now"
check "order changed by the reorder" "$([ "$now" != "$ids" ] && echo 0 || echo 1)"
echo "-- drop an app onto a folder"
reset_seed
open_menu 1.5
ui_call Move 166 113 >/dev/null; sleep 0.5
ui_call Drag 166 113 362 113 >/dev/null; sleep 2.2
F_INTERNET=7d610436-4b17-46cf-99db-97578edac1c1
echo "Internet folder: $(folder_ids $F_INTERNET)"
echo "$(folder_ids $F_INTERNET)" | grep -q 'com.anthropic.Claude.desktop' && echo "ok   Claude dropped into the Internet folder" || { echo "FAIL Claude not in the Internet folder"; status=1; }
screenshot ui-dnd-into-folder
