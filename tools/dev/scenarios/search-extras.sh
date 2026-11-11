# The extra search results in the real shell: calculator ("2+2"), unit conversion ("5 km in miles"), GNOME Settings
# panels ("display", via a stand-in gnome-control-center and panel desktop files) and app actions ("zqxfox private").
# Return on the top result copies the answer (checked through Ui.ClipboardText) or runs the stand-in, which logs its
# arguments. Screenshots in the dark and the light colour scheme.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
log="$dev/search-extras.log"
mkdir -p "$apps"
rm -f "$log" "$apps"/org.gnome.Settings-*-panel.desktop "$apps/zqxfox.desktop"

# The stand-in goes where the shell's PATH finds it (the sandbox is disposable); without write access the panel
# checks are skipped rather than failed.
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
mkpanel bluetooth Bluetooth "Headphones;"
mkpanel wifi Wi-Fi "Wireless;WLAN;"
mkpanel display Displays "Monitor;Resolution;"
printf '[Desktop Entry]\nType=Application\nName=Zqxfox\nExec=/usr/bin/true\nIcon=utilities-terminal\nActions=private;window;\n\n[Desktop Action private]\nName=New Private Window\nExec=/bin/sh -c "echo action-private >>%s"\n\n[Desktop Action window]\nName=New Window\nExec=/bin/sh -c "echo action-window >>%s"\n' "$log" "$log" >"$apps/zqxfox.desktop"
sleep 4  # the GMenu tree reloads 1-2.5 s after the files change
leave_overview
close_menu

search() { ui_call Search "$1" >/dev/null; sleep "${2:-1.2}"; }
clip() { ui_call ClipboardText | unwrap; }
reopen() { close_menu; open_menu 1.2; }

echo "-- calculator"
open_menu 1.5
search "2+2"
expect_state "one result for 2+2" layout.results 1
screenshot search-extras-calc-dark
key Return 0.8
expect "Return copied the answer" "$(clip)" 4
reopen
search "(3.5*4)/2 + 15% of 80"
expect_state "an expression with a percentage" layout.results 1
key Return 0.8
expect "the answer is on the clipboard" "$(clip)" 19
reopen
search "0.1+0.2"
key Return 0.8
expect "no floating point noise" "$(clip)" 0.3
reopen
search "2048"
expect_state "a bare number is not a calculation" layout.results 0
search "2+"
expect_state "an incomplete expression shows nothing" layout.results 0
search "1/0"
expect_state "division by zero shows nothing" layout.results 0

echo "-- unit conversion"
search "5 km in miles"
expect_state "one result for 5 km in miles" layout.results 1
screenshot search-extras-units-dark
key Return 0.8
expect "the converted value is on the clipboard" "$(clip)" "3.106856 mi"
reopen
search "100 f in c"
key Return 0.8
expect "temperature offsets" "$(clip)" "37.777778 °C"
reopen

echo "-- app actions"
search "zqxfox private"
expect_state "one action found" layout.results 1
screenshot search-extras-action-dark
key Return 0.8
expect "the action ran" "$(grep -c action-private "$log" 2>/dev/null)" 1
reopen
search "zqxfox"
expect_state "the app alone offers no action rows" layout.results 1

echo "-- Settings panels"
if [ "$have_gcc" = 1 ]; then
    search "display"
    # the sandbox image may ship real panel files too (Color Management also lists "display" as a keyword)
    n="$(state_get layout.results)"
    check "the display panel is found ($n results)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
    screenshot search-extras-settings-dark
    key Return 0.8
    expect "gnome-control-center display was started" "$(grep -c '^gcc display$' "$log" 2>/dev/null)" 1
    reopen
    search "wireless"
    n="$(state_get layout.results)"
    check "a synonym finds Wi-Fi ($n results)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
    search "bluetooth"
    key Return 0.8
    expect "gnome-control-center bluetooth was started" "$(grep -c '^gcc bluetooth$' "$log" 2>/dev/null)" 1
    reopen
fi

echo "-- switches"
dconf write $K/search-calculator false
sleep 0.5
search "2+2"
expect_state "calculator off" layout.results 0
dconf write $K/search-calculator true
dconf write $K/search-unit-conversion false
sleep 0.5
search "5 km in miles"
expect_state "conversion off" layout.results 0
dconf write $K/search-unit-conversion true
close_menu

echo "-- the standalone runner shows and copies the same answers"
rs() { dev_call RunnerState | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
dev_call OpenRunner >/dev/null; sleep 1.2
for k in 7 asterisk 6; do key $k 0.15; done; sleep 1.5
expect "runner: one result for 7*6" "$(rs results)" 1
screenshot search-extras-runner-dark
key Return 0.8
expect "runner: Return copied 42" "$(clip)" 42
dev_call CloseRunner >/dev/null; sleep 0.5

echo "-- light colour scheme"
dconf write /org/gnome/desktop/interface/color-scheme "'prefer-light'"
sleep 2
open_menu 1.5
search "2+2"
screenshot search-extras-calc-light
search "5 km in miles"
screenshot search-extras-units-light
search "zqxfox private"
screenshot search-extras-action-light
[ "$have_gcc" = 1 ] && { search "display"; screenshot search-extras-settings-light; }
close_menu
dconf write /org/gnome/desktop/interface/color-scheme "'default'"
rm -f "$gcc_bin"
