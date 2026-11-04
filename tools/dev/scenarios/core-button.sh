# Panel button: keyboard activation (finding 11), icon fallbacks, Dev Screenshot path policy
# (finding 7), stale theme directory sweep (finding 8), Toggle semantics (findings 2/3).
set_key() { dconf write "/org/gnome/shell/extensions/spawn/$1" "$2"; }
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
icon_field() { attachment_status | python3 -c 'import json,sys; print(json.load(sys.stdin)["attachments"][0]["icon"]["'"$1"'"])'; }
leave_overview
close_menu

echo "-- keyboard activation (Return / Space on the focused button)"
dev_call FocusButton >/dev/null; sleep 0.4
key Return 1.2
expect "Return opens the menu" "$(hk popupOpen)" true
dev_call Close >/dev/null; sleep 0.8
dev_call FocusButton >/dev/null; sleep 0.4
key space 1.2
expect "Space opens the menu" "$(hk popupOpen)" true
dev_call Close >/dev/null; sleep 0.8

# Return INSIDE the menu activates a result and closes it; the release of that Return must not
# reach the (re-focused) button and reopen the menu.
dev_call FocusButton >/dev/null; sleep 0.4
key Return 1.2
ui_call Search fi >/dev/null; sleep 0.8
key Return 1.5
expect "Return inside the menu does not reopen it" "$(hk popupOpen)" false
sleep 1
expect "... and it stays closed" "$(hk popupOpen)" false

echo "-- D-Bus Toggle opens, then closes"
gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.Toggle >/dev/null; sleep 1.2
expect "Toggle opens" "$(hk popupOpen)" true
gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.Toggle >/dev/null; sleep 1.2
expect "Toggle closes" "$(hk popupOpen)" false

echo "-- icon fallbacks"
bad="$XDG_RUNTIME_DIR/not-an-image.svg"
echo "this is not an image" >"$bad"
set_key menu-button-icon "'distro-fedora-symbolic.svg'"; sleep 1
expect "bundled icon file used" "$(icon_field file | sed 's|.*/||')" distro-fedora-symbolic.svg
set_key menu-button-icon "'/nonexistent/dir/icon.svg'"; sleep 1
expect "missing file -> fallback themed icon" "$(icon_field iconName)" start-here-symbolic
set_key menu-button-icon "'$bad'"; sleep 1
expect "undecodable file -> fallback themed icon" "$(icon_field iconName)" start-here-symbolic
set_key menu-button-icon "'no-such-icon-in-any-theme-symbolic'"; sleep 1
expect "unknown themed name is kept (St falls back via fallback-icon-name)" "$(icon_field iconName)" no-such-icon-in-any-theme-symbolic
screenshot core-icon-missing-name
set_key menu-button-icon "''"; sleep 1
expect "empty value -> fallback themed icon" "$(icon_field iconName)" start-here-symbolic
set_key menu-button-icon "'distro-fedora-symbolic.svg'"; sleep 1

echo "-- Dev Screenshot path policy"
ok="$shots/core-allowed.png"
rm -f "$ok"
dev_call Screenshot "$ok" >/dev/null; [ -s "$ok" ]; check "screenshot under .dev allowed" $?
out="$(dev_call Screenshot "/tmp/spawn-core-denied.png")"
echo "$out" | grep -q 'AccessDenied'; check "screenshot to /tmp denied ($out)" $?
[ ! -e /tmp/spawn-core-denied.png ]; check "nothing written to /tmp" $?
out="$(dev_call Screenshot "$shots/../../../../tmp/spawn-core-denied.png")"
echo "$out" | grep -q 'AccessDenied'; check "screenshot with .. escape denied" $?
out="$(dev_call Screenshot "relative.png")"
echo "$out" | grep -q 'AccessDenied'; check "relative path denied" $?

echo "-- stale theme directory sweep"
rt="$XDG_RUNTIME_DIR/spawn"
mkdir -p "$rt/deadbeef"
echo "/* stale */" >"$rt/deadbeef/theme.css"
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 2.5
[ ! -e "$rt/deadbeef" ]; check "stale theme dir removed on start" $?
[ "$(find "$rt" -name theme.css | wc -l)" = 1 ]; check "exactly our own theme.css present" $?
