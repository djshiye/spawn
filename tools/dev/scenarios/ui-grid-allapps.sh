# The Grid layout's All apps (src/ui/layout/gridApps.ts): an icon grid in A-Z letter groups with the pinned grid's tiles
# and column count, a letter picker (click / Return on a heading), a category menu behind the header's title, tiles that
# launch / open the context menu / drag like pinned ones, Escape routing (picker -> category -> All apps -> Pinned), and
# Classic's All apps unchanged. Extra stub apps (letters A-W without J, Q, X, Y, Z, three categories, a "9 Lives" and an accented
# name) make the list long enough to scroll and the picker have dimmed letters. Screenshots: grid-allapps-*.png.
K=/org/gnome/shell/extensions/spawn
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
cats=(Game Utility Network)
i=0
for L in A B C D E F G H I K L M N O P R S T U V W; do
    for n in 1 2 3 4; do
        printf '[Desktop Entry]\nType=Application\nName=%s-App %s\nExec=true\nIcon=application-x-executable\nCategories=%s;\n' \
            "$L" "$n" "${cats[$((i % 3))]}" >"$apps/spawn-ga-$L$n.desktop"
        i=$((i + 1))
    done
done
printf '[Desktop Entry]\nType=Application\nName=9 Lives\nExec=true\nIcon=application-x-executable\nCategories=Game;\n' >"$apps/spawn-ga-digit.desktop"
printf '[Desktop Entry]\nType=Application\nName=\xc3\x89dito\nExec=true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/spawn-ga-accent.desktop"
sleep 5 # installed-changed, then the AppIndex rebuild

fname() { ui_call FocusInfo | unwrap | json_get name; }
fcls() { ui_call FocusInfo | unwrap | json_get cls | cut -d' ' -f1; }
# columns of the visible tile grid: the most tiles that share one top (a group's last row may be short)
row_len() {
    local i=0 r
    for i in $(seq 0 40); do
        r="$(rect spawn-tile "$i")"; [ -n "$r" ] || break
        python3 -c 'import json,sys; print(json.loads(sys.argv[1])[1])' "$r"
    done | sort | uniq -c | sort -rn | head -1 | awk '{print $1}'
}
tile_size() { python3 -c 'import json,sys; r=json.loads(sys.argv[1]); print(r[2], r[3])' "$(rect spawn-tile 0)"; }
all_app() { state_get layout.allApps."$1"; }

echo "-- Classic first: its All apps list, for comparison at the end"
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
ui_call Move 5 5 >/dev/null; sleep 0.3
focus_class spawn-list-row 0
[ "$(state_get layout.focusIndex)" = 0 ] || { sleep 1.5; focus_class spawn-list-row 0; }
key End 1.5
classic_rows="$(state_get layout.appRows)"
classic_n="$(echo "$classic_rows" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
expect "Classic All apps rows are all built after End" "$(state_get layout.appRowsPending)" "0"
echo "Classic All apps: $classic_n apps"
close_menu

echo "-- Grid on: the pinned grid's tile size and columns"
dconf write $K/layout-style "'Grid'"
sleep 1.5
open_menu 1.5
pinned_cols="$(state_get layout.gridCols)"
pinned_tile="$(tile_size)"
pinned_row="$(row_len)"
echo "pinned grid: $pinned_cols columns, tile $pinned_tile"
expect "the pinned grid shows a full first row" "$pinned_row" "$pinned_cols"

echo "-- All apps"
ui_call ShowView all >/dev/null; sleep 1.2
expect_state "the All apps view" layout.view all
expect_state "no category" layout.allApps.category all
expect "the header says All apps" "$(ui_call TextRect 'All apps' 0 | unwrap | python3 -c 'import json,sys; print("yes" if sys.stdin.read().strip() else "no")')" "yes"
expect "the tiles are the pinned grid's size" "$(tile_size)" "$pinned_tile"
expect "the first row has the pinned grid's column count" "$(row_len)" "$pinned_cols"
expect_state "All apps' column count is the pinned grid's" layout.allApps.cols "$pinned_cols"
expect "no page dots in All apps" "$(count spawn-grid-dot)" "0"
expect "no Classic category column" "$(count spawn-category-column)" "0"
check "headings exist" "$([ "$(count spawn-grid-letter)" -ge 2 ] && echo 0 || echo 1)"
built="$(all_app built)"; groups="$(all_app groups)"
echo "groups $groups, built $built, tiles $(all_app tiles) of $(all_app apps)"
check "tiles are built lazily (built $built of $groups groups)" "$([ "$built" -lt "$groups" ] && echo 0 || echo 1)"
screenshot grid-allapps-01-start

echo "-- keyboard: the first tile, arrows, Home / End, Page keys"
ui_call Move 5 5 >/dev/null; sleep 0.3
key Tab 0.3
expect "Tab from the entry: the title button (menu)" "$(fname)" "All apps, choose a category"
key Tab 0.3
expect "Tab: the grid" "$(fcls)" "spawn-nav-button"
check "the grid starts on a heading (reachable)" "$(fname | grep -q 'jump to letter' && echo 0 || echo 1)"
key Down 0.3
expect "Down from the first heading: the first tile" "$(fcls)" "spawn-tile"
check "...the digits group (9 Lives)" "$([ "$(fname)" = "9 Lives" ] && echo 0 || echo 1)"
key Down 0.3
check "Down: the next heading" "$(fname | grep -q 'jump to letter' && echo 0 || echo 1)"
key Down 0.3
expect "Down: its first tile" "$(fcls)" "spawn-tile"
first_tile="$(fname)"
key Right 0.3
check "Right: the next tile" "$([ "$(fname)" != "$first_tile" ] && [ "$(fcls)" = spawn-tile ] && echo 0 || echo 1)"
key Left 0.3
expect "Left: back" "$(fname)" "$first_tile"
key Up 0.3
check "Up from the first tile row: its heading" "$(fname | grep -q 'jump to letter' && echo 0 || echo 1)"
key Page_Down 0.5
check "Page Down moves on" "$([ "$(fcls)" = spawn-tile ] || [ "$(fcls)" = spawn-nav-button ] && echo 0 || echo 1)"
key End 0.8
last_name="$(fname)"
check "End: the last app ($last_name)" "$(echo "$last_name" | grep -q '^W' && echo 0 || echo 1)"
expect "End built every group" "$(all_app built)" "$(all_app groups)"
expect "tile count equals the visible app count of Classic" "$(all_app tiles)" "$classic_n"
expect "tile count equals the apps shown" "$(all_app tiles)" "$(all_app apps)"
expect "the last tile has the focus" "$(fcls)" "spawn-tile"
screenshot grid-allapps-02-end
key Home 0.8
check "Home: the top heading" "$(fname | grep -q 'jump to letter' && echo 0 || echo 1)"
expect_state "scrolled back to the top" layout.allApps.value 0

echo "-- letter picker (keyboard)"
key Return 0.6
expect "a card shows" "$(count spawn-grid-card)" "1"
expect_state "the letters overlay" layout.allApps.overlay letters
expect "27 keys (# and A-Z)" "$(count spawn-grid-key)" "27"
present="$(all_app letters | python3 -c 'import json,sys; print(len([l for l in json.load(sys.stdin) if l]))')"
expect "letters without apps are dimmed" "$(count spawn-grid-key-off)" "$((27 - present))"
check "the focus is on a key" "$(fname | grep -q '^Apps starting with' && echo 0 || echo 1)"
screenshot grid-allapps-03-picker
key Right 0.3
key Right 0.3
second="$(fname)"
check "arrows move between keys ($second)" "$(echo "$second" | grep -q '^Apps starting with' && echo 0 || echo 1)"
key Escape 0.6
expect "Escape closes the picker" "$(count spawn-grid-card)" "0"
expect_state "the picker is closed" layout.allApps.overlay null
check "Escape returns to the heading" "$(fname | grep -q 'jump to letter' && echo 0 || echo 1)"
expect_state "Escape closed the picker, not the view" layout.view all

echo "-- pick a letter: the group scrolls to the top, its first tile has the focus"
key Return 0.6
key End 0.3 # the last enabled letter
check "End in the picker: a key" "$(fname | grep -q '^Apps starting with W' && echo 0 || echo 1)"
key Return 0.8
expect "the picker closed" "$(count spawn-grid-card)" "0"
check "the focus is a tile of W ($(fname))" "$(fname | grep -q '^W' && [ "$(fcls)" = spawn-tile ] && echo 0 || echo 1)"
check "the view scrolled to the last group ($(all_app value))" "$([ "$(all_app value)" -gt 0 ] && echo 0 || echo 1)"
scroll_top="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[1])' "$(rect spawn-grid-apps-scroll 0)")"
screenshot grid-allapps-04-jumped

echo "-- picker with the pointer: dimmed letters do nothing; the scrim closes it"
focus_class spawn-grid-letter 0
click_class spawn-grid-letter 0
expect "clicking a heading opens the picker" "$(count spawn-grid-card)" "1"
off_before="$(all_app value)"
click_class spawn-grid-key-off 0
expect "a dimmed letter does nothing" "$(count spawn-grid-card)" "1"
expect_state "...and nothing scrolled" layout.allApps.value "$off_before"
r="$(rect spawn-grid-scrim 0)"
sp="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+8), round(y+8))' "$r")"
ui_call Move $sp >/dev/null; sleep 0.25; ui_call Move $sp >/dev/null; sleep 0.4 # the first motion after a quiet spell can land at x=0
click $sp
expect "a click on the scrim closes the picker" "$(count spawn-grid-card)" "0"
click_class spawn-grid-letter 0
expect "the picker opens again" "$(count spawn-grid-card)" "1"
click_class spawn-grid-key 4 # # A B C D
expect "clicking D closes the picker" "$(count spawn-grid-card)" "0"
d_label="$(ui_call TextRect D 0 | unwrap | python3 -c 'import json,sys; s=sys.stdin.read().strip(); print(json.loads(s)[1] if s else -999)')"
check "the D group is at the top (label y $d_label, view y $scroll_top)" "$(python3 -c "import sys; print(0 if 0 <= $d_label - $scroll_top <= 40 else 1)")"
screenshot grid-allapps-05-jumped-d

echo "-- categories"
click_class spawn-grid-title-button 0
cat_n="$(count spawn-grid-category)"
check "the menu lists All apps and the categories ($cat_n)" "$([ "$cat_n" -ge 4 ] && echo 0 || echo 1)"
expect_state "the categories overlay" layout.allApps.overlay categories
screenshot grid-allapps-06-categories
key Escape 0.6
expect "Escape closes the menu" "$(count spawn-grid-card)" "0"
expect "...and the focus returns to the title button" "$(fname)" "All apps, choose a category"
key Return 0.6
expect "Return opens the menu again" "$(count spawn-grid-card)" "1"
key Down 0.3
key Down 0.3
chosen="$(fname | sed 's/, contains new apps//')"
echo "second category: $chosen"
key Return 0.9
check "a category shows (${chosen})" "$([ "$(all_app category)" != all ] && echo 0 || echo 1)"
expect "the title shows the category's name" "$(ui_call FocusInfo >/dev/null; ui_call TextRect "$chosen" 0 | unwrap | python3 -c 'import json,sys; print("yes" if sys.stdin.read().strip() else "no")')" "yes"
expect "no letter headings in a category" "$(count spawn-grid-letter)" "0"
key End 0.8
expect "only that category's apps (tiles = apps)" "$(all_app tiles)" "$(all_app apps)"
check "fewer apps than all ($(all_app apps) < $classic_n)" "$([ "$(all_app apps)" -lt "$classic_n" ] && echo 0 || echo 1)"
expect "the first row has the pinned grid's column count" "$(row_len)" "$pinned_cols"
key Home 0.5
screenshot grid-allapps-07-category
key Escape 0.8
expect_state "Escape in a category: back to All apps" layout.allApps.category all
expect_state "...still All apps" layout.view all
expect "headings are back" "$([ "$(count spawn-grid-letter)" -ge 2 ] && echo yes)" "yes"
click_class spawn-grid-title-button 0
expect "the title button opens the menu by pointer" "$(count spawn-grid-card)" "1"
click_class spawn-grid-category 1
expect_state "the menu stayed open (popup alive)" layout.open true
check "a category by pointer" "$([ "$(all_app category)" != all ] && echo 0 || echo 1)"
click_class spawn-grid-header-button 0
sleep 0.5
expect_state "the Pinned pill goes straight to Pinned" layout.view pinned
ui_call ShowView all >/dev/null; sleep 1
expect_state "All apps opens on All apps again" layout.allApps.category all
key Escape 0.8
expect_state "Escape in All apps: Pinned" layout.view pinned

echo "-- a tile launches / opens the context menu / drags like a pinned one"
ui_call ShowView all >/dev/null; sleep 1
ui_call Move 5 5 >/dev/null; sleep 0.3
focus_class spawn-tile 0
key Menu 0.8
check "Menu key: the context menu opens" "$([ "$(count spawn-context-menu)" -ge 1 ] && echo 0 || echo 1)"
check "...with Pin to Menu" "$(ui_call TextRect 'Pin to Menu' 0 | unwrap | grep -q '\[' && echo 0 || echo 1)"
screenshot grid-allapps-08-context
key Escape 0.6
expect "Escape closes the context menu" "$(count spawn-context-menu)" "0"
expect_state "...and not the menu" layout.open true
click_class spawn-tile 1 3
check "right click: the context menu opens" "$([ "$(count spawn-context-menu)" -ge 1 ] && echo 0 || echo 1)"
key Escape 0.6
focus_class spawn-tile 0
key Shift+F10 0.8
check "Shift+F10: the context menu opens" "$([ "$(count spawn-context-menu)" -ge 1 ] && echo 0 || echo 1)"
key Escape 0.6
pins_before="$(pinned_ids)"
t0="$(center spawn-tile 0)"; t1="$(center spawn-tile 1)"
ui_call DragVia $t0 $t1 1500 $t1 >/dev/null &
drag_pid=$!
sleep 1.4
check "dragging a tile starts the pin drag (the tile is being dragged)" "$(ui_call Pseudo spawn-tile 0 | unwrap | grep -q dragging && echo 0 || echo 1)"
wait $drag_pid; sleep 0.8
expect "a drop on nothing pins nothing" "$(pinned_ids)" "$pins_before"
ui_call Move 5 5 >/dev/null; sleep 0.3
click_class spawn-tile 0
sleep 1
expect_state "a click launches and closes the menu" layout.open false

echo "-- back to Classic: its All apps is unchanged"
dconf write $K/layout-style "'Classic'"
sleep 1.5
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
ui_call Move 5 5 >/dev/null; sleep 0.3
focus_class spawn-list-row 0
key End 0.8
expect "Classic All apps: the same rows as before" "$(state_get layout.appRows)" "$classic_rows"
expect "no Grid All apps in Classic" "$(count spawn-grid-apps)" "0"
expect "...no letter headings" "$(count spawn-grid-letter)" "0"
screenshot grid-allapps-09-classic
close_menu
dconf reset $K/layout-style

rm -f "$apps"/spawn-ga-*.desktop
sleep 3
