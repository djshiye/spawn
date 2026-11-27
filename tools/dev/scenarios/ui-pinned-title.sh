# Back at the top of a long Classic pinned list (End, then Home) the list is scrolled to 0 again: the "Pinned" title
# shows and the first row is not under the top fade (scrollIntoView used to stop 8 px short of the first row).
K=/org/gnome/shell/extensions/spawn/
reset_seed
entries=""
for i in $(seq 1 24); do
    entries="$entries{'id': 'echo $i', 'name': 'Pin row $i', 'icon': 'utilities-terminal'}, "
done
dconf write "${K}pinned-apps-display" "'List'"
dconf write "${K}pinned-apps" "[${entries%, }]"
sleep 1; open_menu 1.5
title0="$(ui_call TextRect Pinned 0 | unwrap)"
check "the Pinned title is on screen at a fresh open ($title0)" "$([ -n "$title0" ] && [ "$title0" != null ] && echo 0 || echo 1)"
focus_class spawn-pinned-row 0
key End 0.6
check "End scrolled the list down" "$([ "$(state_get layout.pinnedScroll | cut -d. -f1)" -gt 0 ] && echo 0 || echo 1)"
key Home 0.8
title1="$(ui_call TextRect Pinned 0 | unwrap)"
expect "the Pinned title is back where it was after End, Home" "$title1" "$title0"
check "the list is scrolled to the very top ($(state_get layout.pinnedScroll))" \
    "$(python3 -c 'import sys; print(0 if abs(float(sys.argv[1])) < 0.5 else 1)' "$(state_get layout.pinnedScroll)")"
screenshot ui-pinned-title
close_menu
