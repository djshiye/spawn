# Panel button icon values the preferences icon picker can store: a themed name from the system icon theme
# (picked in the picker's System source), a bundled file name and an absolute file path. Each must reach the
# attachment, and the button must really render (screenshot of the panel).
set_key() { dconf write "/org/gnome/shell/extensions/spawn/$1" "$2"; }
icon_field() { attachment_status | python3 -c 'import json,sys; print(json.load(sys.stdin)["attachments"][0]["icon"]["'"$1"'"])'; }
leave_overview
close_menu

echo "-- themed name picked from the system icon theme (what the picker stores for System icons)"
set_key menu-button-icon "'start-here'"; sleep 1.2
expect "themed name reaches the button" "$(icon_field iconName)" start-here
screenshot core-button-icon-themed
set_key menu-button-icon "'start-here-symbolic'"; sleep 1.2
expect "symbolic themed name reaches the button" "$(icon_field iconName)" start-here-symbolic
screenshot core-button-icon-themed-symbolic

echo "-- bundled icon file name (Spawn / Distros sources)"
set_key menu-button-icon "'distro-fedora-symbolic.svg'"; sleep 1.2
expect "bundled icon resolves to its file" "$(icon_field file | sed 's|.*/||')" distro-fedora-symbolic.svg
screenshot core-button-icon-bundled

echo "-- absolute file path (the file chooser)"
cp "$root/data/icons/icon-apps-symbolic.svg" "$XDG_RUNTIME_DIR/own-icon.svg"
set_key menu-button-icon "'$XDG_RUNTIME_DIR/own-icon.svg'"; sleep 1.2
expect "file path used as is" "$(icon_field file)" "$XDG_RUNTIME_DIR/own-icon.svg"
screenshot core-button-icon-file

set_key menu-button-icon "'icon-apps-symbolic.svg'"; sleep 1
