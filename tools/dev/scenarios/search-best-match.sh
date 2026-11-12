# One best match across the result sections, power actions in the search, and the runner's Run row.
#  - best match: "display" highlights the Displays Settings panel (an app lists "display" as a keyword and is no
#    longer first), "calc" -> Calculator, "settings" -> Settings, "term" / "ptyxis" -> Ptyxis; a sum keeps the answer
#    on top; the highlight of a moved selection stays put (Down, then the list does not reorder under it)
#  - power actions (search-power-actions, off by default): nothing with the switch off; "res" shows Restart, "re"
#    nothing; synonyms (reboot, sign out, shut down); the same names as the power buttons; in the menu and the runner;
#    activating "firmware" opens Spawn's firmware confirmation (the power button's own path) and Escape cancels it.
#    The other actions go to the shell's session manager, which the sandbox lacks, so they are only checked as rows
#    (never activated: nothing may lock or log out the sandbox).
#  - runner Run row (runner-run-commands, off by default): `true` / a probe program in the PATH shows `Run “...”` as the
#    LAST row, alone and highlighted when nothing else matches; a program that does not exist shows none; Return runs
#    it (marker file); switch off: no row; a program that cannot start shows a failure notification.
# Screenshots in .dev/shots/best-match-*.png.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
log="$dev/search-best-match.log"
marker="$XDG_RUNTIME_DIR/spawn-best-match-run"
mkdir -p "$apps"
rm -f "$log" "$marker" "$apps"/org.gnome.Settings-*-panel.desktop "$apps"/zz-bm-*.desktop
touch "$log"

gcc_bin=/usr/local/bin/gnome-control-center
have_gcc=0
if printf '#!/bin/sh\necho "gcc $*" >>"%s"\n' "$log" >"$gcc_bin" 2>/dev/null && chmod +x "$gcc_bin" 2>/dev/null; then
    have_gcc=1
else
    echo "note: $gcc_bin is not writable, the Settings panel checks are skipped"
fi
mkpanel() { # panel name keywords
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=/usr/bin/true\nIcon=preferences-system-symbolic\nKeywords=%s\nNoDisplay=true\nX-GNOME-Settings-Panel=%s\n' "$2" "$3" "$1" >"$apps/org.gnome.Settings-$1-panel.desktop"
}
mkpanel display Displays "Monitor;Resolution;"
mkpanel wifi Wi-Fi "Wireless;WLAN;"
# an app that lists "display" as a keyword and runs a program called display: the old first row for "display"
printf '[Desktop Entry]\nType=Application\nName=ImageMagick\nExec=/usr/bin/true\nIcon=applications-graphics\nKeywords=display;image;\n' >"$apps/zz-bm-imagemagick.desktop"
# programs for the Run row: one with an app of the same name (so there are other results), one alone, one that cannot start
probes=(/usr/local/bin/zzbmrun /usr/local/bin/zzbmsolo /usr/local/bin/zzbmbad)
have_probes=1
printf '#!/bin/sh\ntouch "%s"\n' "$marker" >/usr/local/bin/zzbmrun 2>/dev/null || have_probes=0
printf '#!/bin/sh\nexit 0\n' >/usr/local/bin/zzbmsolo 2>/dev/null || have_probes=0
printf '#!/nonexistent/interpreter\n' >/usr/local/bin/zzbmbad 2>/dev/null || have_probes=0
[ "$have_probes" = 1 ] && chmod +x "${probes[@]}"
[ "$have_probes" = 1 ] || echo "note: /usr/local/bin is not writable, the Run row checks are skipped"
printf '[Desktop Entry]\nType=Application\nName=Zzbmrun Tools\nExec=/usr/bin/true\nIcon=utilities-terminal\n' >"$apps/zz-bm-run.desktop"
dconf write $K/search-power-actions false
dconf write $K/runner-run-commands false
dconf write $K/highlight-search-result-terms true
dconf write $K/show-search-result-details true
sleep 4  # the GMenu tree reloads 1-2.5 s after the files change
leave_overview
close_menu

search() { ui_call Search "$1" >/dev/null; sleep "${2:-1.3}"; }
ts() { state_get layout.resultTitles; }                       # JSON list of the row names, best first
sel() { state_get layout.selected; }
has_sel() { case "$(sel)" in *"$1"*) return 0 ;; esac; return 1; }
checksel() { check "$1 (highlighted: $(sel))" "$(has_sel "$2" && echo 0 || echo 1)"; }
rs() { dev_call RunnerState | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
rsel() { rs selected; }
type_text() { local c; for c in $(echo "$1" | sed 's/./& /g'); do key "$c" 0.12; done; sleep "${2:-1.4}"; }

echo "-- best match: one strongest result across the sections"
open_menu 1.5
if [ "$have_gcc" = 1 ]; then
    search display
    checksel "display -> the Displays panel" Displays
    expect_state "the highlight is the first row" layout.selectedIndex 0
    check "the ImageMagick app still shows, below ($(ts))" "$(ts | grep -q ImageMagick && echo 0 || echo 1)"
    screenshot best-match-display-dark
fi
search calc
checksel "calc -> the Calculator app" Calculator
search settings
checksel "settings -> the Settings app" Settings
search ptyxis
checksel "ptyxis -> Ptyxis" Ptyxis
search "2+2"
expect_state "a sum: only the answer" layout.results 1
checksel "a sum keeps the answer on top" "= 4"
if [ "$have_gcc" = 1 ]; then
    echo "-- the highlight the user moved stays"
    search display
    key Down 0.5
    second="$(sel)"
    check "Down moved off the Displays panel ($second)" "$([ "$second" != "" ] && ! has_sel Displays && echo 0 || echo 1)"
    sleep 0.6   # past the debounce: the recent-files / shell batches have arrived
    expect "the moved highlight stayed after the slow batches" "$(sel)" "$second"
    key Return 0.8
    expect "Return activated the highlighted row, not the best match" "$(grep -c '^gcc display$' "$log"; true)" 0
fi
close_menu

echo "-- power actions: off by default"
open_menu 1.5
search restart
expect_state "no power rows with the switch off" layout.results 0
close_menu
dconf write $K/search-power-actions true
sleep 1
echo "-- power actions: on"
open_menu 1.5
search res
check "res shows Restart ($(ts))" "$(ts | grep -q '"Restart"' && echo 0 || echo 1)"
checksel "res: Restart is highlighted" Restart
search re
check "re (2 characters) shows no power action ($(ts))" "$(ts | grep -qE '"(Restart|Lock|Log Out|Power Off)"' && echo 1 || echo 0)"
search restart
checksel "an exact restart is the best match" Restart
screenshot best-match-power-dark
for q in "reboot:Restart" "lock:Lock" "sign out:Log Out" "logout:Log Out" "shut down:Power Off" "power off:Power Off" "sleep:Suspend" "switch user:Switch User" "hibernate:Hibernate"; do
    search "${q%%:*}" 1.0
    check "'${q%%:*}' finds ${q##*:} ($(ts))" "$(ts | grep -q "\"${q##*:}\"" && echo 0 || echo 1)"
done
search "zzqxnone"
expect_state "an unrelated word shows no power action" layout.results 0

echo "-- power actions: activating one opens the power button's confirmation (firmware: Spawn's own dialog)"
search firmware 1.3
checksel "firmware is highlighted" Firmware
screenshot best-match-firmware-row
key Return 1.5
expect "the menu closed" "$(state_get open)" false
expect "the firmware confirmation is showing" "$(count spawn-firmware-dialog)" 1
screenshot best-match-firmware-dialog
key Escape 1.0
expect "Cancel closed the confirmation" "$(count spawn-firmware-dialog)" 0

echo "-- power actions in the runner"
dev_call OpenRunner >/dev/null; sleep 1.2
type_text res 1.4
check "runner: Restart shown ($(rs resultTitles))" "$(rs resultTitles | grep -q '"Restart"' && echo 0 || echo 1)"
check "runner: Restart highlighted ($(rsel))" "$(case "$(rsel)" in *Restart*) echo 0 ;; *) echo 1 ;; esac)"
screenshot best-match-power-runner
key Escape 0.6
key Escape 0.8
dconf write $K/search-power-actions false
sleep 1
dev_call OpenRunner >/dev/null; sleep 1.2
type_text res 1.4
check "runner, switch off: no power row ($(rs resultTitles))" "$(rs resultTitles | grep -q '"Restart"' && echo 1 || echo 0)"
dev_call CloseRunner >/dev/null; sleep 0.5

echo "-- runner Run row"
if [ "$have_probes" = 1 ]; then
    dev_call OpenRunner >/dev/null; sleep 1.2
    type_text zzbmsolo 1.4
    check "switch off: no Run row ($(rs resultTitles))" "$(rs resultTitles | grep -q 'Run' && echo 1 || echo 0)"
    dev_call CloseRunner >/dev/null; sleep 0.5
    dconf write $K/runner-run-commands true
    sleep 1
    dev_call OpenRunner >/dev/null; sleep 1.2
    type_text zzbmsolo 1.4
    expect "alone: one row" "$(rs results)" 1
    check "alone: Run “zzbmsolo” ($(rs resultTitles))" "$(rs resultTitles | grep -q 'Run .*zzbmsolo' && echo 0 || echo 1)"
    expect "alone: highlighted" "$(rs selectedIndex)" 0
    screenshot best-match-run-alone
    for c in 1 2 3 4 5 6 7 8; do key BackSpace 0.1; done
    sleep 0.3
    type_text zzbmnoprog 1.4
    check "a program that does not exist: no Run row ($(rs resultTitles))" "$(rs resultTitles | grep -q 'Run' && echo 1 || echo 0)"
    for c in 1 2 3 4 5 6 7 8 9 10; do key BackSpace 0.1; done
    sleep 0.3
    type_text zzbmrun 1.4
    n="$(rs results)"
    check "other results and the Run row ($n)" "$([ "$n" -ge 2 ] && echo 0 || echo 1)"
    check "the Run row is the last one ($(rs resultTitles))" "$(rs resultTitles | python3 -c 'import json,sys; t=json.load(sys.stdin); sys.exit(0 if t and t[-1].startswith("Run") and not t[0].startswith("Run") else 1)'; echo $?)"
    expect "the best match, not the Run row, is highlighted" "$(rs selectedIndex)" 0
    screenshot best-match-run-last
    key Return 1.5
    expect "Return closed the runner" "$(rs open)" false
    # Return on the best match launched the app (not the program); the Run row is reached with Down
    check "Return on the best match did not run the program" "$([ -e "$marker" ] && echo 1 || echo 0)"
    dev_call OpenRunner >/dev/null; sleep 1.2
    type_text zzbmrun 1.4
    n="$(rs results)"
    for c in $(seq 2 "$n"); do key Down 0.3; done
    key Return 1.5
    check "Down to the Run row, then Return runs the program" "$([ -e "$marker" ] && echo 0 || echo 1)"
    expect "the runner closed" "$(rs open)" false
    echo "-- a program that cannot start"
    dev_call OpenRunner >/dev/null; sleep 1.2
    type_text zzbmbad 1.4
    expect "the failing program is offered" "$(rs results)" 1
    key Return 1.5
    expect "the runner closed" "$(rs open)" false
    sleep 1   # (the sandbox shell queues startup banners first, so ours may not show in the shot)
    screenshot best-match-run-failed
else
    echo "(skipped)"
fi

dconf write $K/runner-run-commands false
dconf write $K/search-power-actions false
rm -f "$gcc_bin" "${probes[@]}"
