# Sidebar extras (all opt-in, all off by default): the category quick links above / below the start view's
# list, the Recent Files and Favorites views behind them, and the external devices + bookmarks of the right
# pane. Every new row follows the hit-area convention: it is swept pixel row by pixel row (Ui.HitSweepIn), must
# reach the pane's edges, is reachable with the keyboard, and the default look (everything off) is unchanged.
# Devices cannot be mounted in the headless shell: Ui.SetPlaces fakes mounts, network locations and bookmarks
# (the mount discovery itself is not exercised here); bookmarks are tested for real through a bookmarks file in
# the sandbox's XDG_CONFIG_HOME. Opening a recent file / a bookmark would start a real application, so rows are
# not clicked.
K=/org/gnome/shell/extensions/spawn
LINKS_ALL="[(0, true), (1, true), (2, true), (3, true), (4, true)]"
FREQ="org.gnome.Calculator.desktop,org.gnome.Calendar.desktop,org.gnome.Characters.desktop,org.gnome.Nautilus.desktop"
# outside any dot directory (the repo checkout lives under .claude / .dev): the provider treats those as hidden
RECENT_DIR="$(mktemp -d)"
BOOKMARKS="$XDG_CONFIG_HOME/gtk-3.0/bookmarks"

sweep_in() { # <what> <container class> <item class(es), a|b> <range class ('' = the container)> <min items>
    local j
    j="$(ui_call HitSweepIn "$2" "$3" "$4" | unwrap)"
    python3 - "$j" "$1" "$5" <<'PY'
import json, sys
r = json.loads(sys.argv[1])
x, y, w, h = r["rect"]
print(f'{sys.argv[2]}: {r["items"]} item(s) in {w:g}x{h:g} at {x:g},{y:g}, swept x {r["range"][0]:g}..{r["range"][0] + r["range"][1]:g}; '
      f'{r["hit"]}/{r["total"]} points hit an item ({r["skipped"]} on a scroll bar); items touch: {r["contiguous"]}')
for g in r["gaps"]:
    print("   dead band", g)
for m in r["misses"]:
    print("   dead point", m)
sys.exit(0 if r["items"] >= int(sys.argv[3]) and r["total"] > 100 and not r["misses"] and r["contiguous"] else 1)
PY
    check "$1: no dead pixel" $?
}

edge() { # <what> <class> <pane class> both|left|right: the first such actor reaches the pane's edge(s)
    python3 - "$(rect "$2" 0)" "$(rect "$3" 0)" "$4" <<'PY'
import json, sys
a, p, which = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
ok = True
if which in ("left", "both"):
    ok = ok and abs(a[0] - p[0]) <= 0.5
if which in ("right", "both"):
    ok = ok and abs(a[0] + a[2] - (p[0] + p[2])) <= 0.5
sys.exit(0 if ok else 1)
PY
    check "$1 reaches the pane's $4 edge" $?
}

# above <what> <class a> <class b> [nth a] [nth b]: actor a lies entirely above actor b
above() {
    python3 - "$(rect "$2" "${4:-0}")" "$(rect "$3" "${5:-0}")" <<'PY'
import json, sys
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
sys.exit(0 if a[1] + a[3] <= b[1] + 0.5 else 1)
PY
    check "$1" $?
}

# expect_places <description> <"[devices, network, bookmarks]">: poll up to 8 s (the file monitor reports a change a moment late)
expect_places() {
    local i got=""
    for i in $(seq 16); do
        got="$(state_get layout.places)"
        [ "$got" = "$3" ] && break
        sleep 0.5
    done
    expect "$1" "$got" "$3"
}

focus_cls() { ui_call FocusInfo | unwrap | json_get cls; }

fresh_menu() { # close, optionally set the view, open
    close_menu
    open_menu 1.5
    ui_call SetFrequent "$FREQ" >/dev/null
}

setup_recent() { # 30 live files, one hidden (newest), one missing; the xbel the provider reads
    rm -rf "$RECENT_DIR"
    mkdir -p "$RECENT_DIR"
    python3 - "$RECENT_DIR" "$XDG_DATA_HOME/recently-used.xbel" <<'PY'
import datetime, os, sys
d, out = sys.argv[1], sys.argv[2]
now = datetime.datetime(2026, 11, 1, 12, 0, 0)
entries = []
def add(path, minutes):
    ts = (now - datetime.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
    entries.append(f'''  <bookmark href="file://{path}" added="{ts}" modified="{ts}" visited="{ts}">
    <info><metadata owner="http://freedesktop.org"><mime:mime-type type="text/plain"/><bookmark:applications>
      <bookmark:application name="Text Editor" exec="&apos;gedit %u&apos;" modified="{ts}" count="1"/>
    </bookmark:applications></metadata></info>
  </bookmark>''')
hidden = os.path.join(d, ".secret.txt")
open(hidden, "w").write("x")
add(hidden, -1)
for i in range(30):
    p = os.path.join(d, f"report-{i:02d}.txt")
    open(p, "w").write("x")
    add(p, i)
add(os.path.join(d, "deleted-long-ago.txt"), 5)
open(out, "w").write('''<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">
''' + "\n".join(entries) + "\n</xbel>\n")
PY
}

echo "== default look: nothing extra"
reset_seed
open_menu 1.5
ui_call SetFrequent "$FREQ" >/dev/null
expect "no quick links box is visible" "$(count spawn-links)" 0
expect "no eject buttons" "$(count spawn-eject-button)" 0
BASE_ROWS="$(count spawn-shortcut-row)"
BASE_SEPS="$(count spawn-separator)"
expect_state "places: none listed" layout.places "[0, 0, 0]"
screenshot ui-extras-default

echo "== quick links at the bottom (default)"
dconf write $K/arcmenu-extra-categories-links "$LINKS_ALL"
sleep 1
expect "links box shown: the start view's own (Pinned) and All Apps (the nav button already offers it) are skipped" "$(count spawn-links)" 1
expect_state "three link rows" layout.links 3
above "the list is above the links" spawn-stack spawn-links
above "the links are above the Back / All Apps button" spawn-links spawn-nav
sweep_in "links over the whole left pane" spawn-links spawn-list-row spawn-left-pane 3
edge "the links" "spawn-links" spawn-left-pane both
screenshot ui-extras-links-bottom

echo "-- keyboard reaches the links"
focus_class spawn-pinned-row 0
reached=1
for i in 1 2 3 4 5 6; do
    key Tab 0.25
    case "$(state_get layout.focus)" in St_Button.spawn-list-row*) reached=0; break ;; esac
done
check "Tab from the pinned list reaches the first link" $reached
key Down 0.3
expect "Down moves to the next link" "$(state_get layout.focus)" "St_Button.spawn-list-row"
key Return 0.9
expect_state "Return on the second link (Favorites, Frequent, Recent Files) opens Frequent" layout.view frequent
expect "the links are hidden on another view" "$(count spawn-links)" 0
key Escape 0.8
expect_state "Escape returns to the start view" layout.view pinned
expect_state "the links are back" layout.links 3

echo "-- clicking each link (in a List pinned view the links are the only spawn-list-row actors)"
for target in "favorites:0" "frequent:1" "recent:2"; do
    want="${target%%:*}"
    idx="${target##*:}"
    ui_call ShowView default >/dev/null
    sleep 0.7
    click_class spawn-list-row "$idx"
    sleep 0.9
    expect "link $idx opens the '$want' view" "$(state_get layout.view)" "$want"
done


echo "== quick links at the top"
dconf write $K/arcmenu-extra-categories-links-location "'Top'"
sleep 1
fresh_menu
expect_state "links shown" layout.links 3
above "the links are above the list" spawn-links spawn-stack
sweep_in "top links over the whole left pane" spawn-links spawn-list-row spawn-left-pane 3
screenshot ui-extras-links-top
dconf reset $K/arcmenu-extra-categories-links-location

echo "== the link of the start view is skipped; none for the category list"
dconf write $K/default-menu-view "'Frequent_Apps'"
sleep 1
fresh_menu
expect_state "Frequent start view: no Frequent or All Apps link, Pinned stays" layout.links 3
dconf write $K/default-menu-view "'All_Programs'"
sleep 1
fresh_menu
expect_state "All_Programs start view: five minus All Apps" layout.links 4
dconf write $K/default-menu-view "'Pinned_And_Frequent_Apps'"
sleep 1
fresh_menu
expect_state "Pinned_And_Frequent_Apps: Pinned and Frequent are the start view, All Apps is the nav button" layout.links 2
dconf write $K/default-menu-view "'Categories_List'"
sleep 1
fresh_menu
expect_state "Categories_List start view: no links" layout.links 0
expect "no links box" "$(count spawn-links)" 0
dconf reset $K/default-menu-view
sleep 1
dconf write $K/arcmenu-extra-categories-links "[(0, false), (1, false), (2, false), (3, true), (4, false)]"
sleep 1
fresh_menu
expect "only the start view's own link is on: the box is hidden" "$(count spawn-links)" 0

echo "== Recent Files view"
setup_recent
dconf write $K/arcmenu-extra-categories-links "[(4, true)]"
sleep 1
fresh_menu
expect_state "one link" layout.links 1
click_class spawn-list-row "$(( $(count spawn-list-row) - 1 ))"
sleep 1.2
expect_state "the Recent Files view is showing" layout.view recent
expect_state "25 newest files + 'More Recent Files...' (hidden and deleted files left out)" layout.extraRows 26
screenshot ui-extras-recent
sweep_in "recent files over the whole left pane" spawn-frequent spawn-list-row spawn-left-pane 20
edge "the recent rows" spawn-list-row spawn-left-pane both
key Down 0.3
focus_class spawn-list-row 0
key Down 0.3
case "$(state_get layout.focus)" in St_Button.spawn-list-row*) echo "ok   arrow keys move through the recent rows" ;; *) echo "FAIL arrow keys in the recent list ($(state_get layout.focus))"; status=1 ;; esac
key Escape 0.8
expect_state "Escape goes back to the start view" layout.view pinned
echo "-- show-hidden-recent-files includes the hidden file"
dconf write $K/show-hidden-recent-files true
sleep 0.6
ui_call ShowView recent >/dev/null; sleep 1
expect_state "26 rows again (hidden file shown, still capped at 25 + More)" layout.extraRows 26
dconf reset $K/show-hidden-recent-files
echo "-- GNOME's File History switch off: nothing is listed"
dconf write /org/gnome/desktop/privacy/remember-recent-files false
sleep 0.6
ui_call ShowView pinned >/dev/null; sleep 0.5
ui_call ShowView recent >/dev/null; sleep 1
expect_state "no recent rows when remember-recent-files is off" layout.extraRows 0
expect "the empty-state label explains why" "$(count spawn-empty-label)" 1
screenshot ui-extras-recent-off
dconf reset /org/gnome/desktop/privacy/remember-recent-files

echo "== Favorites view"
dconf write $K/arcmenu-extra-categories-links "[(0, true)]"
sleep 1
fresh_menu
click_class spawn-list-row "$(( $(count spawn-list-row) - 1 ))"
sleep 1.2
expect_state "the Favorites view is showing" layout.view favorites
screenshot ui-extras-favorites
dconf reset $K/arcmenu-extra-categories-links
sleep 1

echo "== bookmarks (a real bookmarks file in the sandbox)"
mkdir -p "$(dirname "$BOOKMARKS")" "$RECENT_DIR/Photos"
rm -f "$BOOKMARKS"
reset_seed
open_menu 1.5
dconf write $K/show-bookmarks true
sleep 1
expect_state "no bookmarks file: nothing listed" layout.places "[0, 0, 0]"
printf 'file://%s Reports\nfile://%s\nfile:///no/such/folder Gone\n' "$RECENT_DIR" "$RECENT_DIR/Photos" >"$BOOKMARKS"
sleep 1.5
expect_places "the file appears: two bookmarks (the missing folder is skipped)" layout.places "[0, 0, 2]"
expect "two more shortcut rows" "$(count spawn-shortcut-row)" $((BASE_ROWS + 2))
expect "one rule more between the groups" "$(count spawn-separator)" $((BASE_SEPS + 1))
screenshot ui-extras-bookmarks
printf 'file://%s Reports\n' "$RECENT_DIR" >"$BOOKMARKS"
sleep 1.5
expect_places "the file changes: one bookmark" layout.places "[0, 0, 1]"
rm -f "$BOOKMARKS"
sleep 1.5
expect_places "the file is deleted: none" layout.places "[0, 0, 0]"
expect "back to the default rows" "$(count spawn-shortcut-row)" "$BASE_ROWS"
printf 'file://%s Reports\n' "$RECENT_DIR" >"$BOOKMARKS"
sleep 1.5
expect_places "the file is re-created: picked up again" layout.places "[0, 0, 1]"
dconf write $K/show-bookmarks false
sleep 1
expect_places "switching the setting off stops listing them" layout.places "[0, 0, 0]"
rm -f "$BOOKMARKS"

echo "== devices (faked: no removable media in the sandbox)"
reset_seed
open_menu 1.5
dconf write $K/show-external-devices true
dconf write $K/show-bookmarks true
sleep 1
ui_call SetPlaces '[{"kind":"device","name":"USB Stick","ejectable":true},{"kind":"device","name":"System Disk"},{"kind":"network","name":"files on nas","ejectable":true},{"kind":"bookmark","name":"Projects"}]' >/dev/null
sleep 1
expect_state "3 mounts + 1 bookmark" layout.places "[2, 1, 1]"
expect "two rule lines more than the default (dirs | devices | bookmarks | apps)" "$(count spawn-separator)" $((BASE_SEPS + 2))
expect "four more rows" "$(count spawn-shortcut-row)" $((BASE_ROWS + 4))
expect "two eject buttons (the system disk has none)" "$(count spawn-eject-button)" 2
screenshot ui-extras-devices
sweep_in "right pane with devices and bookmarks" spawn-right-pane "spawn-user-card|spawn-shortcut-row" spawn-right-pane 8
edge "the first device row" spawn-shortcut-row spawn-right-pane both
python3 - "$(rect spawn-shortcut-row 0)" "$(rect spawn-shortcut-row 3)" "$(rect spawn-shortcut-row 4)" "$(rect spawn-shortcut-row 6)" <<'PY'
import json, sys
hs = [json.loads(a)[3] for a in sys.argv[1:]]
print("row heights (folder shortcut, device with eject, device without, bookmark):", hs)
sys.exit(0 if len(set(hs)) == 1 else 1)
PY
check "device and bookmark rows are as tall as the folder shortcut rows (the eject button adds no height)" $?
# the eject button's face: inside the row, tall enough to hit comfortably
python3 - "$(rect spawn-eject-button 0)" "$(rect spawn-shortcut-row 3)" <<'PY'
import json, sys
b, row = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print("eject button", b, "device row", row)
sys.exit(0 if b[2] >= 24 and b[3] >= 16 and b[0] + b[2] <= row[0] + row[2] and b[1] >= row[1] and b[1] + b[3] <= row[1] + row[3] else 1)
PY
check "the eject button is at least 24x16 and lies inside its row" $?

echo "-- keyboard: Right reaches the eject button, Left comes back, Down continues"
focus_class spawn-shortcut-row 3
expect "focus is on the device row" "$(focus_cls)" "spawn-shortcut-row"
key Right 0.3
expect "Right focuses its eject button" "$(focus_cls)" "spawn-eject-button"
key Left 0.3
expect "Left returns to the row" "$(focus_cls)" "spawn-shortcut-row"
key Right 0.3
key Down 0.3
expect "Down from the eject button goes to the next row" "$(focus_cls)" "spawn-shortcut-row"
focus_class spawn-eject-button 0
screenshot ui-extras-eject-focus

echo "-- ejecting"
click_class spawn-eject-button 0
sleep 1
expect_state "the menu stays open after an eject click" layout.open true
expect_state "the device is gone" layout.places "[1, 1, 1]"
focus_class spawn-eject-button 0
key Return 1
expect_state "Return on the eject button ejects too" layout.places "[1, 0, 1]"
ui_call SetPlaces '' >/dev/null
dconf reset $K/show-external-devices
dconf reset $K/show-bookmarks
close_menu

rm -rf "$RECENT_DIR" "$BOOKMARKS"
