# uses: rtl
# Right-to-left: the arrow keys, Ctrl+arrow reordering, drop sides and the pinned grid's gutters follow the mirrored
# layout (the shell runs with CLUTTER_TEXT_DIRECTION=rtl, Clutter mirrors every horizontal box).
x_of() { python3 -c 'import json,sys; print(round(json.loads(sys.argv[1])[0]))' "$(rect spawn-tile "$1")"; }
name_of_tile() { focus_class spawn-tile "$1"; ui_call FocusInfo | unwrap | json_get name; }
reset_seed
set_display Grid
open_menu 1.5
screenshot ui-rtl-grid
check "RTL is on: tile 0 is drawn right of tile 1" "$([ "$(x_of 0)" -gt "$(x_of 1)" ] && echo 0 || echo 1)"

echo "-- Left moves the focus to the visual left"
t2="$(name_of_tile 2)"
focus_class spawn-tile 1
key Left 0.4
expect "Left from tile 1 lands on tile 2" "$(ui_call FocusInfo | unwrap | json_get name)" "$t2"
key Right 0.4
expect "Right goes back to tile 1" "$(ui_call FocusInfo | unwrap | json_get name)" "$(name_of_tile 1)"

echo "-- Ctrl+Left moves the app to its visual left"
a1="$(pinned_ids | awk '{print $2}')"
focus_class spawn-tile 1
key Ctrl+Left 0.6
expect "Ctrl+Left moved tile 1's app to index 2" "$(pinned_ids | awk '{print $3}')" "$a1"

echo "-- dropping on the left edge of a tile inserts after it"
reset_seed; set_display Grid; close_menu; open_menu 1.5
a3="$(pinned_ids | awk '{print $4}')"
src="$(center spawn-tile 3)"
dst="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+8), round(y+h/2))' "$(rect spawn-tile 0)")"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "left-edge drop in RTL inserts after tile 0" "$(pinned_ids | awk '{print $2}')" "$a3"

echo "-- the outer gutter is on the outer edge of each row"
close_menu; open_menu 1.5
dump_ui "$dev/ux/rtl.json"
pads="$(python3 - "$dev/ux/rtl.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
tiles = [e for e in d['items'] if 'spawn-tile' in e.get('cls', '').split()]
row = [t for t in tiles if abs(t['y'] - tiles[0]['y']) < 2]
row.sort(key=lambda t: t['x'])
# pad = top, right, bottom, left
print('left-of-leftmost', row[0]['pad'][3], 'right-of-rightmost', row[-1]['pad'][1], 'right-of-leftmost', row[0]['pad'][1], 'left-of-rightmost', row[-1]['pad'][3])
PY
)"
echo "$pads"
check "the rightmost tile carries the gutter on its right, the leftmost on its left" \
    "$(echo "$pads" | python3 -c 'import sys; w=sys.stdin.read().split(); print(0 if int(w[1])>10 and int(w[3])>10 and int(w[5])<10 and int(w[7])<10 else 1)')"
