# Pinned hit areas (no dead zones) and pinned-item-size: sweeps every pixel row of the pinned list /
# grid (and an open folder's contents) with the in-shell hit test (Ui.HitSweep: PickMode.REACTIVE,
# the point must belong to some pinned row / tile) for List at Compact / Comfortable / Large and
# Grid at Compact / Comfortable / Large; checks the row / tile sizes of each tier, that changing the
# setting applies live, and drag & drop bands at Large.
K=/org/gnome/shell/extensions/spawn
mkdir -p "$dev/ux"
leave_overview

set_size() { # Compact|Comfortable|Large (live: the menu stays open)
    dconf write $K/pinned-item-size "'$1'"
    sleep 1.8
}

sweep() { # <what> <item class>
    local j
    j="$(ui_call HitSweep "$2" | unwrap)"
    python3 - "$j" "$1" <<'PY'
import json, sys
r = json.loads(sys.argv[1])
x, y, w, h = r["rect"]
print(f'{sys.argv[2]}: {r["rows"]} row(s) over {w:g}x{h:g} at {x:g},{y:g}; {r["hit"]}/{r["total"]} points hit an item '
      f'({r["skipped"]} on a scroll bar); rows contiguous: {r["contiguous"]}')
for m in r["misses"]:
    print("   dead point", m)
sys.exit(0 if r["total"] > 200 and not r["misses"] and r["contiguous"] else 1)
PY
    check "$1: no dead pixel" $?
}

face_height() { # <face class> -> rounded height of the first visible one
    rect "$1" 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3], 1))'
}

# row height per tier: icon + 2 x padding = 40 / 48 / 56 (+ the 1 px gap that belongs to the row)
declare -A ROW_H=([Compact]=40 [Comfortable]=48 [Large]=56)

echo "== List"
set_display List
open_menu 1.5
expect_state "display is List" layout.display List
for size in Compact Comfortable Large; do
    echo "-- List, $size"
    set_size $size
    expect "$size: visible row height" "$(face_height spawn-row-surface)" "${ROW_H[$size]}"
    expect "$size: its hit area is 1 px taller (the gap to the next row)" "$(rect spawn-pinned-row 0 | python3 -c 'import json,sys; print(round(json.load(sys.stdin)[3], 1))')" "$(( ${ROW_H[$size]} + 1 ))"
    expect "$size: 6 pinned rows" "$(count spawn-pinned-row)" 6
    sweep "List $size" spawn-pinned-row
    dump_ui "$dev/ux/hit-list-$size.json"
    python3 "$root/tools/dev/ux-measure.py" "$dev/ux/hit-list-$size.json" --check >/dev/null; check "List $size meets the UX targets" $?
    screenshot ui-hit-list-$size
    ui_call OpenFolder 0 >/dev/null; sleep 0.8
    expect "$size: folder contents are rows" "$(count spawn-pinned-row)" 4
    sweep "List $size, folder contents" spawn-pinned-row
    screenshot ui-hit-list-$size-folder
    key Escape 0.6
    expect_state "back on the pinned view" layout.view pinned
done

echo "-- List: the folder plate stays as big as the row icon"
plate_ok() { # plate size expected
    rect spawn-folder-plate 0 | python3 -c 'import json,sys; r=json.load(sys.stdin); sys.exit(0 if r[2]==r[3]==float(sys.argv[1]) else 1)' "$1"
}
for pair in Compact:28 Comfortable:32 Large:40; do
    set_size "${pair%%:*}"
    plate_ok "${pair##*:}"; check "${pair%%:*}: folder plate is ${pair##*:} px" $?
done

echo "-- List, Large: drag & drop bands follow the row height"
reset_seed
dconf write $K/pinned-item-size "'Large'"
sleep 1.5
open_menu 1.5
face_edge_y() { # <class> <nth> <top|bottom>: x centre, 8 px inside the top / bottom edge of the visible face
    python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+8 if sys.argv[2]=="top" else y+h-9))' "$(rect "$1" "$2")" "$3"
}
src="$(center spawn-pinned-row 2)"; dst="$(face_edge_y spawn-pinned-row 0 top)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "Husk dropped on the top band of the first row goes first" "$(pinned_ids | cut -d' ' -f1)" "husk.desktop"
reset_seed
dconf write $K/pinned-item-size "'Large'"
sleep 1.5
open_menu 1.5
before="$(pinned_ids | wc -w)"
src="$(center spawn-pinned-row 0)"; dst="$(center spawn-pinned-row 1)"
ui_call Move $src >/dev/null; sleep 0.5
ui_call Drag $src $dst >/dev/null; sleep 2.2
expect "the middle band still merges two apps into a folder" "$(pinned_ids | wc -w)" "$(( before - 1 ))"
reset_seed
close_menu

echo "== Grid"
set_display Grid
open_menu 1.5
expect_state "display is Grid" layout.display Grid
for size in Compact Comfortable Large; do
    echo "-- Grid, $size"
    set_size $size
    expect "$size: 6 tiles" "$(count spawn-tile)" 6
    sweep "Grid $size" spawn-tile
    dump_ui "$dev/ux/hit-grid-$size.json"
    screenshot ui-hit-grid-$size
    ui_call OpenFolder 0 >/dev/null; sleep 0.8
    expect "$size: the folder shows its 4 apps as tiles" "$(count spawn-tile)" 4
    sweep "Grid $size, folder contents" spawn-tile
    key Escape 0.6
    expect_state "back on the pinned view" layout.view pinned
done
python3 - "$dev/ux/hit-grid-Compact.json" "$dev/ux/hit-grid-Large.json" <<'PY'
import json, sys
def cols(path):
    d = json.load(open(path))
    t = [i for i in d["items"] if "spawn-tile-surface" in i.get("cls", "").split() and i["w"] > 0]
    ys = sorted({round(i["y"]) for i in t})
    return len([i for i in t if round(i["y"]) == ys[0]]), t[0]["w"], [i for i in d["items"] if "spawn-tile-icon" in i.get("cls", "").split()][0]["w"]
a, b = cols(sys.argv[1]), cols(sys.argv[2])
print("columns / tile width / icon: Compact", a, " Large", b)
sys.exit(0 if a[0] > b[0] and a[2] == 48 and b[2] == 64 else 1)
PY
check "Grid: Compact keeps the 48 px icon in more columns, Large has 64 px icons in fewer" $?
set_size Compact
set_display List
close_menu
