# icon-size-* keys: 0 hides the category and shortcut icons (rows keep their height), icon-size-misc sizes the
# search box icons and the Back / All Apps button icons, icon-size-buttons = 0 (power buttons are icon-only)
# means the default size, never an empty button.
K=/org/gnome/shell/extensions/spawn
leave_overview
tmpd="$(mktemp -d)"

# icon_sizes <cls of an ancestor>: sizes of the St.Icon actors below the first visible actor with that class
icon_sizes() {
    dump_ui "$tmpd/dump.json"
    python3 - "$tmpd/dump.json" "$1" <<'PY'
import json, sys
items = json.load(open(sys.argv[1]))["items"]
start = next((k for k, i in enumerate(items) if sys.argv[2] in i.get("cls", "").split()), None)
if start is None:
    print("none")
    sys.exit(0)
depth = items[start]["d"]
out = []
for i in items[start + 1:]:
    if i["d"] <= depth:
        break
    if i["type"] == "St_Icon" or "isize" in i:
        out.append(i["isize"])
print(*out)
PY
}
row_height() { python3 -c 'import json, sys; print(json.loads(sys.argv[1])[3])' "$(rect "$1" 0)"; }

echo "-- shortcut icons: icon-size-shortcuts = 0"
open_menu 1.5
n_default="$(count spawn-shortcut-icon)"
h_default="$(row_height spawn-shortcut-row)"
check "shortcut icons are shown by default ($n_default)" "$([ "$n_default" -ge 3 ] && echo 0 || echo 1)"
screenshot ui-icons-default
close_menu
dconf write $K/icon-size-shortcuts 0
sleep 1.5
open_menu 1.5
expect "icon-size-shortcuts 0: no shortcut icon" "$(count spawn-shortcut-icon)" 0
expect "... the rows are still there" "$(count spawn-shortcut-row)" "$(python3 -c "print($n_default)")"
expect "... and keep their height" "$(row_height spawn-shortcut-row)" "$h_default"
screenshot ui-icons-no-shortcut-icons
close_menu
dconf write $K/icon-size-shortcuts 24
sleep 1.5
open_menu 1.5
expect "icon-size-shortcuts 24: icons are back, 24 px" "$(icon_sizes spawn-shortcut-row | cut -d' ' -f1)" 24
close_menu
dconf reset $K/icon-size-shortcuts

echo "-- category icons: icon-size-categories = 0 (All Apps with the category column)"
sleep 1.5
open_menu 1.5
ui_call ShowView categories >/dev/null; sleep 1
c_default="$(count spawn-category-icon)"
ch_default="$(row_height spawn-category-row)"
check "category icons are shown by default ($c_default)" "$([ "$c_default" -ge 3 ] && echo 0 || echo 1)"
dconf write $K/icon-size-categories 0
sleep 1.5
close_menu
open_menu 1.5
ui_call ShowView categories >/dev/null; sleep 1
expect "icon-size-categories 0: no category icon" "$(count spawn-category-icon)" 0
check "... and there are some" "$([ "$(count spawn-category-row)" -ge 3 ] && echo 0 || echo 1)"
expect "... with the same height" "$(row_height spawn-category-row)" "$ch_default"
screenshot ui-icons-no-category-icons
close_menu
dconf reset $K/icon-size-categories

echo "-- icon-size-misc: search box icons and the Back / All Apps buttons"
sleep 1
open_menu 1.5
expect "default search icon: no explicit size (the stylesheet's 16 px applies)" "$(icon_sizes spawn-search-box | cut -d' ' -f1)" -1
expect "default All Apps icon size" "$(icon_sizes spawn-nav-button | cut -d' ' -f1)" 16
dconf write $K/icon-size-misc 24
sleep 1
expect "icon-size-misc 24: search icon follows live" "$(icon_sizes spawn-search-box | cut -d' ' -f1)" 24
expect "icon-size-misc 24: All Apps icon follows live" "$(icon_sizes spawn-nav-button | cut -d' ' -f1)" 24
screenshot ui-icons-misc-24
dconf write $K/icon-size-misc 0
sleep 1
expect "icon-size-misc 0: back to the stylesheet's size (search)" "$(icon_sizes spawn-search-box | cut -d' ' -f1)" -1
expect "icon-size-misc 0: back to the default (nav)" "$(icon_sizes spawn-nav-button | cut -d' ' -f1)" 16
dconf reset $K/icon-size-misc
close_menu

echo "-- icon-size-buttons = 0: the icon-only power buttons keep a default icon"
dconf write $K/icon-size-buttons 0
sleep 1.5
open_menu 1.5
expect "power button icon is 16 px with icon-size-buttons 0" "$(icon_sizes spawn-power-button | cut -d' ' -f1)" 16
dconf reset $K/icon-size-buttons
close_menu
rm -rf "$tmpd"
