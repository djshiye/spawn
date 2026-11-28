# A "New" app launched with Ctrl (menu kept open) leaves All Apps where it was: same scroll offset, same row focused.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
dconf write $K/keep-open-on-ctrl-click true
# 1. seed known-apps first, so the stub apps below can be told apart from the probe
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
close_menu
for i in $(seq 0 59); do
    printf '[Desktop Entry]\nType=Application\nName=Keep Place %03d\nExec=true\nIcon=application-x-executable\nCategories=Utility;\n' "$i" \
        >"$apps/spawn-keep-place-$i.desktop"
done
sleep 4
dconf reset $K/new-apps          # the stubs are not new
printf '[Desktop Entry]\nType=Application\nName=Zzzq Keep Probe\nExec=true\nIcon=application-x-executable\nCategories=Utility;\n' \
    >"$apps/zzzq-keep-probe.desktop"
sleep 4

open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
ui_call Move 5 5 >/dev/null; sleep 0.3
focus_class spawn-list-row 0
key End 0.8
name="$(ui_call FocusInfo | unwrap | json_get name)"
expect "End focuses the new probe row" "$name" "Zzzq Keep Probe, new"
before="$(state_get layout.appsScroll)"
check "All Apps is scrolled down ($before)" "$(python3 -c 'import sys; print(0 if float(sys.argv[1]) > 0 else 1)' "$before")"
key Ctrl+Return 2
expect_state "the menu stays open after Ctrl+Return" layout.open true
check "new-apps no longer holds the probe" "$(dconf read $K/new-apps | grep -qF zzzq-keep-probe.desktop; [ $? = 1 ]; echo $?)"
after="$(state_get layout.appsScroll)"
check "the list kept its scroll offset ($before -> $after)" \
    "$(python3 -c 'import sys; b,a=map(float,sys.argv[1:]); print(0 if abs(a-b) <= 2 else 1)' "$before" "$after")"
name="$(ui_call FocusInfo | unwrap | json_get name)"
expect "the same row keeps the keyboard focus, without the badge" "$name" "Zzzq Keep Probe"
expect "no New pill left" "$(count spawn-new-badge)" 0
prev="$(state_get layout.appRows | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[r.index("Zzzq Keep Probe") - 1])')"
key Up 0.4
expect "the keyboard still walks the list (Up)" "$(ui_call FocusInfo | unwrap | json_get name)" "$prev"
close_menu

dconf reset $K/keep-open-on-ctrl-click
dconf reset $K/new-apps
rm -f "$apps"/spawn-keep-place-*.desktop "$apps/zzzq-keep-probe.desktop"
sleep 3
