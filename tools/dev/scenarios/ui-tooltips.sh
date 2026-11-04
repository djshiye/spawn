# Tooltips: truncated folder-view names and the power buttons.
open_menu 1.5
ui_call OpenFolder 1 >/dev/null; sleep 0.8
ui_call Move 300 300 >/dev/null; sleep 0.5
ui_call Move 68 140 >/dev/null; sleep 1.5
echo "folder tile tooltip: $(state_get layout.tooltip)"
screenshot ui-tooltip-folder
key Escape 0.6
echo "-- power button tooltips"
ui_call Move 300 300 >/dev/null; sleep 0.4
ui_call Move 503 622 >/dev/null; sleep 1.6
tip="$(state_get layout.tooltip)"
expect "restart button tooltip" "$tip" "Restart"
screenshot ui-tooltip-power
ui_call Move 543 622 >/dev/null; sleep 1.6
expect "power off button tooltip" "$(state_get layout.tooltip)" "Power Off"
