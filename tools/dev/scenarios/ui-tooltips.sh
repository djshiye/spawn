# Tooltips: truncated folder-popup names and the power buttons.
open_menu 1.5
ui_call OpenFolder 1 >/dev/null; sleep 0.8
ui_call Move 300 300 >/dev/null; sleep 0.5
# the folder popup's tiles are spawn-tile in both displays; in Grid the 6 pinned tiles behind it come first
move_class spawn-tile "$([ "$PINNED_DISPLAY" = Grid ] && echo 6 || echo 0)" 1.5
echo "folder tile tooltip: $(state_get layout.tooltip)"
screenshot ui-tooltip-folder
key Escape 0.6
echo "-- power button tooltips"
ui_call Move 300 300 >/dev/null; sleep 0.4
move_class spawn-power-button 1 1.0
tip="$(state_get layout.tooltip)"
expect "restart button tooltip" "$tip" "Restart"
screenshot ui-tooltip-power
move_class spawn-power-button 2 1.0
expect "power off button tooltip" "$(state_get layout.tooltip)" "Power Off"
