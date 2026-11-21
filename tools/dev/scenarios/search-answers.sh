# The offline answers of the search box in the real shell: harder maths, more units, smart answers (subnets, number
# bases, colours, time zones, dates), quick tools (password, UUID, hash, "my ip", emoji / characters) and the quick
# settings switches. Return copies the answer (checked through Ui.ClipboardText) or flips the switch (checked in
# dconf / in the log of the stand-in services: tools/dev/net-standin/service.js plays NetworkManager and the
# Rfkill service, which do not run in the sandbox). Screenshots in the dark and the light colour scheme.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
slog="$dev/answers-standin.log"
mkdir -p "$apps"
rm -f "$slog"
touch "$slog"
gjs -m "$root/tools/dev/net-standin/service.js" "$slog" 2>"$dev/answers-standin.err" &
standin=$!
printf '[Desktop Entry]\nType=Application\nName=Passwords\nExec=/usr/bin/true\nIcon=dialog-password\n' >"$apps/zz-answers-passwords.desktop"
dconf write $K/search-power-actions false
dconf write /org/gnome/desktop/interface/color-scheme "'default'"
dconf write /org/gnome/desktop/interface/clock-format "'24h'"
dconf write /org/gnome/desktop/notifications/show-banners true
sleep 4  # the GMenu tree reloads 1-2.5 s after the files change
check "the stand-in services are up" "$([ "$(grep -c '^ready' "$slog")" = 2 ] && echo 0 || echo 1)"
leave_overview
close_menu

search() { ui_call Search "$1" >/dev/null; sleep "${2:-1.2}"; }
clip() { ui_call ClipboardText | unwrap; }
ts() { state_get layout.resultTitles; }
reopen() { close_menu; open_menu 1.2; }
first() { ts | python3 -c 'import json, sys; t = json.load(sys.stdin); print(t[0].split(", ")[0] if t else "")'; }   # the title of the first row
copies() { # query, expected clipboard text [, description]
    search "$1"
    key Return 0.8
    expect "${3:-$1}" "$(clip)" "$2"
    reopen
}
shows() { # query, text the row names must contain
    search "$1"
    if ts | python3 -c 'import json, sys; sys.exit(0 if sys.argv[1] in " | ".join(json.load(sys.stdin)) else 1)' "$2"; then
        check "$1 shows $2" 0
    else
        check "$1 shows $2 (got $(ts))" 1
    fi
}
nothing() { search "$1"; expect_state "nothing for: $1" layout.results 0; }

open_menu 1.5
echo "-- maths"
copies "sqrt(2) * sin(30°)" 0.707106781187
copies "2^10 + 5!" 1144
copies "log(1000) + ln(e^2)" 5
copies "0xFF + 1" 256
copies "hypot(3, 4)" 5
copies "20% off 80" 64
copies "1234567 * 3" 3703701 "the copied number has no grouping spaces"
search "1234567 * 3"
screenshot search-answers-maths-dark

echo "-- units"
copies "30 mpg in l/100km" "7.8404861 l/100km"
copies "5 ft 10 in in cm" "177.8 cm"
copies "1 bar in psi" "14.503774 psi"
copies "100 mbps in mb/s" "12.5 MB/s"
copies "1 acre in m2" "4046.8564 m²"
search "180 cm in ft"
screenshot search-answers-units-dark

echo "-- smart answers"
search "192.168.1.130/26"
expect_state "a subnet is six rows" layout.results 6
screenshot search-answers-subnet-dark
key Return 0.8
expect "Return copies the network" "$(clip)" "192.168.1.128/26"
reopen
shows "192.168.1.130/26" "192.168.1.129 – 192.168.1.190"
shows "10.0.0.5 255.255.255.0" "10.0.0.0/24"
shows "2001:db8::/48" "2001:db8::/48"
copies "0xFF" 255
copies "255 in binary" 11111111
search "#3584e4"
expect_state "a colour is three rows" layout.results 3
expect "a colour sample is the row icon" "$(count spawn-answer-swatch)" 3
screenshot search-answers-colour-dark
key Return 0.8
expect "Return copies the first other format" "$(clip)" "rgb(53, 132, 228)"
reopen
shows "3pm london in tokyo" "Tokyo"
screenshot search-answers-time-dark
shows "time in new york" "New York"
shows "days until 25 dec" "day"
screenshot search-answers-date-dark
shows "week number" "Week "
shows "today + 90 days" " 20"

echo "-- quick tools"
search "password 24"
expect_state "one password" layout.results 1
key Return 0.8
p1="$(clip)"
expect "a 24 character password was copied" "${#p1}" 24
reopen
search "password 24"
key Return 0.8
check "the next password is another one" "$([ "$(clip)" != "$p1" ] && echo 0 || echo 1)"
reopen
search "uuid"
key Return 0.8
check "a version 4 UUID was copied ($(clip))" "$(clip | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' && echo 0 || echo 1)"
reopen
copies "sha256 hello" 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
copies "md5 hello" 5d41402abc4b2a76b9719d911017c592
copies "base64 hello" aGVsbG8=
search "password"
expect "an app called Passwords still leads for password" "$(first)" Passwords
screenshot search-answers-password-dark
search "my ip"
shows "my ip" "192.168.1.23"
screenshot search-answers-myip-dark
key Return 0.8
expect "the local address was copied" "$(clip)" 192.168.1.23
reopen
search "emoji smile" 1.6
check "emoji are found by name ($(state_get layout.results) rows)" "$([ "$(state_get layout.results)" -ge 3 ] && echo 0 || echo 1)"
expect "the emoji is the row icon" "$([ "$(count spawn-answer-glyph)" -ge 3 ] && echo 1 || echo 0)" 1
screenshot search-answers-emoji-dark
copies "char arrow right" "→" "char arrow right copies the arrow"
copies "U+20AC" "€" "a code point copies its character"

echo "-- quick settings"
search "dark mode"
expect "dark mode offers to turn it on" "$(first)" "Turn on dark mode"
screenshot search-answers-toggle-dark
key Return 1.5
expect "Return switched to the dark style" "$(dconf read /org/gnome/desktop/interface/color-scheme)" "'prefer-dark'"
open_menu 1.2
search "dark mode off"
expect "and now offers to turn it off" "$(first)" "Turn off dark mode"
key Return 1.5
expect "Return switched back" "$(dconf read /org/gnome/desktop/interface/color-scheme)" "'default'"
open_menu 1.2
search "dark mode off"
expect "already off says so" "$(first)" "Dark mode is already off"
search "dnd"
key Return 0.8
expect "Do Not Disturb hides the banners" "$(dconf read /org/gnome/desktop/notifications/show-banners)" false
dconf write /org/gnome/desktop/notifications/show-banners true
open_menu 1.2
search "wifi off"
expect "wifi off is a command" "$(first)" "Turn off Wi-Fi"
key Return 1
expect "NetworkManager was asked to turn Wi-Fi off" "$(grep -c '^set WirelessEnabled false$' "$slog")" 1
open_menu 1.2
shows "bluetooth" "Turn off Bluetooth"
search "bluetooth off"
expect "bluetooth off is a command" "$(first)" "Turn off Bluetooth"
key Return 1
expect "the Rfkill service was asked to block Bluetooth" "$(grep -c '^set BluetoothAirplaneMode true$' "$slog")" 1
open_menu 1.2

echo "-- ordinary searches stay ordinary"
for q in not mode pass 2048 in time week may c; do
    search "$q" 0.6
    case "$(ts)" in *"Turn o"*|*"= "*|*"Week "*) check "no answer row for: $q (got $(ts))" 1 ;; *) check "no answer row for: $q" 0 ;; esac
done

echo "-- switches"
dconf write $K/search-smart-answers false
dconf write $K/search-quick-tools false
dconf write $K/search-quick-toggles false
sleep 0.5
nothing "192.168.1.0/24"
nothing "uuid"
nothing "my ip"
nothing "emoji smile"
search "dark mode"
case "$(ts)" in *"Turn o"*) check "no switch for dark mode when off" 1 ;; *) check "no switch for dark mode when off" 0 ;; esac
dconf write $K/search-smart-answers true
dconf write $K/search-quick-tools true
dconf write $K/search-quick-toggles true
close_menu

echo "-- light colour scheme"
dconf write /org/gnome/desktop/interface/color-scheme "'prefer-light'"
sleep 2
open_menu 1.5
search "1234567 * 3"; screenshot search-answers-maths-light
search "180 cm in ft"; screenshot search-answers-units-light
search "192.168.1.130/26"; screenshot search-answers-subnet-light
search "#3584e4"; screenshot search-answers-colour-light
search "3pm london in tokyo"; screenshot search-answers-time-light
search "days until 25 dec"; screenshot search-answers-date-light
search "my ip"; screenshot search-answers-myip-light
search "emoji smile" 1.6; screenshot search-answers-emoji-light
search "wifi on"; screenshot search-answers-toggle-light
close_menu
dconf write /org/gnome/desktop/interface/color-scheme "'default'"
kill "$standin" 2>/dev/null
rm -f "$apps/zz-answers-passwords.desktop"
