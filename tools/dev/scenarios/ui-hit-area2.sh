# No dead pixels outside the pinned list: the left pane's own padding (the pane has none: the pointer at
# the menu's inner edge hits the nearest row), the Frequent lists, the all-apps column and its app list
# (with and without the category column), search results with several sections, the right pane's user
# card + shortcuts and the power buttons. Every region is swept pixel row by pixel row with the in-shell
# hit test (Ui.HitSweepIn: PickMode.REACTIVE, each point must belong to an item; items must touch except
# where a section title / separator sits between them) in List and Grid mode.
# Left dead on purpose: the 1 px separator between the category column and its apps, the gap beside a
# section title / divider, the flexible spacer between the harmless and the destructive power buttons
# (a stray click must not restart the machine) and the folder header's 8 px side margins.
K=/org/gnome/shell/extensions/spawn
FREQ="org.gnome.Calculator.desktop,org.gnome.Calendar.desktop,org.gnome.Characters.desktop,org.gnome.Contacts.desktop,org.gnome.Maps.desktop,org.gnome.Weather.desktop,org.gnome.Nautilus.desktop,org.gnome.Settings.desktop"
leave_overview
ui_call SetFrequent "$FREQ" >/dev/null

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
sys.exit(0 if r["items"] >= int(sys.argv[3]) and r["total"] > 200 and not r["misses"] and r["contiguous"] else 1)
PY
    check "$1: no dead pixel" $?
}

edge() { # <what> <class> <pane class> left|right|both|top|bottom: the actor reaches the pane's edge(s)
    python3 - "$(rect "$2" 0)" "$(rect "$3" 0)" "$4" <<'PY'
import json, sys
a, p, which = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
ok = True
if which in ("left", "both"):
    ok = ok and abs(a[0] - p[0]) <= 0.5
if which in ("right", "both"):
    ok = ok and abs(a[0] + a[2] - (p[0] + p[2])) <= 0.5
if which == "bottom":
    ok = ok and abs(a[1] + a[3] - (p[1] + p[3])) <= 0.5
sys.exit(0 if ok else 1)
PY
    check "$1 reaches the pane's $4 edge" $?
}

pick_is() { # <what> <x> <y> <class fragment>: Ui.Pick at that point returns something with that class
    local got
    got="$(ui_call Pick "$2" "$3" | unwrap)"
    case "$got" in *"$4"*) echo "ok   $1 ($got)" ;; *) echo "FAIL $1 (picked '$got', expected $4)"; status=1 ;; esac
}

pane_point() { # <pane class> <dx from the left> <class whose vertical centre to use> [nth] -> "x y"
    python3 -c '
import json, sys
p, c = json.loads(sys.argv[1]), json.loads(sys.argv[2])
dx = float(sys.argv[3])
print(round(p[0] + dx if dx >= 0 else p[0] + p[2] + dx), round(c[1] + c[3] / 2))' "$(rect "$1" 0)" "$(rect "$3" "${4:-0}")" "$2"
}

view() { # menu view
    ui_call ShowView "$1" >/dev/null
    sleep 0.9
}

for disp in List Grid; do
    echo "== $disp"
    reset_seed
    set_display $disp
    close_menu
    open_menu 1.5
    ui_call SetFrequent "$FREQ" >/dev/null

    echo "-- pinned view, $disp"
    if [ "$disp" = List ]; then
        sweep_in "List: pinned rows over the whole left pane" spawn-tile-grid spawn-pinned-row spawn-left-pane 6
        edge "List: the first pinned row" spawn-pinned-row spawn-left-pane both
    else
        j="$(ui_call HitSweep spawn-tile | unwrap)"
        python3 -c 'import json,sys; r=json.loads(sys.argv[1]); print("Grid: %d/%d points hit a tile, contiguous %s" % (r["hit"], r["total"], r["contiguous"])); sys.exit(0 if r["total"] > 200 and not r["misses"] and r["contiguous"] else 1)' "$j"
        check "Grid: no dead pixel" $?
        dump_ui "$dev/ux/hit2-grid.json"
        python3 - "$dev/ux/hit2-grid.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
it = d["items"]
pane = next(i for i in it if "spawn-left-pane" in i.get("cls", "").split())
tiles = [i for i in it if "spawn-tile" in i.get("cls", "").split() and i["w"] > 0]
l, r = min(t["x"] for t in tiles), max(t["x"] + t["w"] for t in tiles)
print(f'tile hit areas span {l:g}..{r:g}, pane {pane["x"]:g}..{pane["x"] + pane["w"]:g}')
sys.exit(0 if abs(l - pane["x"]) <= 0.5 and abs(r - (pane["x"] + pane["w"])) <= 0.5 else 1)
PY
        check "Grid: the tiles' hit areas reach both edges of the left pane" $?
    fi
    pick_is "$disp: the pointer on the pane's left edge, level with the first pinned entry, hits it" $(pane_point spawn-left-pane 1 $ITEM) "$ITEM"
    pick_is "$disp: ... and on the right edge" $(pane_point spawn-left-pane -2 $ITEM) "$ITEM"
    ui_call OpenFolder 0 >/dev/null; sleep 0.8
    # the folder is a centred popup card of grid tiles (both displays): it has no full-pane hit areas to
    # sweep, and the sweeps only see the first spawn-tile-grid (the pinned one underneath)
    expect_state "$disp: the folder popup is open" layout.view folder
    key Escape 0.6

    echo "-- nav button at the pane's edge"
    edge "the All Apps button" spawn-nav-button spawn-left-pane both
    pick_is "$disp: the pointer on the pane's left edge, level with All Apps, hits the button" $(pane_point spawn-left-pane 1 spawn-nav-button) spawn-nav
    pick_is "$disp: ... and on the right edge (the whole row is the button)" $(pane_point spawn-left-pane -2 spawn-nav-button) spawn-nav

    echo "-- Pinned_And_Frequent_Apps, $disp"
    dconf write $K/default-menu-view "'Pinned_And_Frequent_Apps'"
    sleep 1
    close_menu
    open_menu 1.5
    ui_call SetFrequent "$FREQ" >/dev/null
    view default
    if [ "$disp" = List ]; then
        sweep_in "List: pinned rows above the Frequent section" spawn-pinned-box spawn-pinned-row spawn-left-pane 6
    fi
    sweep_in "$disp: the Frequent rows under the pinned entries" spawn-pinned-box spawn-list-row spawn-left-pane 5
    dconf reset $K/default-menu-view
    sleep 1

    echo "-- Frequent view, $disp"
    view frequent
    sweep_in "$disp: Frequent apps" spawn-frequent spawn-list-row spawn-left-pane 8
    edge "the Frequent rows" spawn-list-row spawn-left-pane both

    echo "-- All apps, $disp"
    view categories
    sweep_in "$disp: category column" spawn-category-column spawn-category-row spawn-category-column 8
    edge "the category column" spawn-category-column spawn-left-pane left
    sweep_in "$disp: apps of All Apps" spawn-category-apps spawn-list-row spawn-category-apps 10
    edge "the app list" spawn-category-apps spawn-left-pane right
    click_class spawn-category-row 1
    sleep 0.8
    sweep_in "$disp: apps of the Frequent category" spawn-category-apps spawn-list-row spawn-category-apps 8
    click_class spawn-category-row 4
    sleep 0.8
    sweep_in "$disp: apps of a GMenu category" spawn-category-apps spawn-list-row spawn-category-apps 1
    view all
    sweep_in "$disp: the flat all-apps list (no column) over the whole left pane" spawn-category-apps spawn-list-row spawn-left-pane 10

    echo "-- search results, $disp"
    ui_call Search a >/dev/null
    sleep 2
    sweep_in "$disp: search results over the whole left pane" spawn-results spawn-result-row spawn-left-pane 3
    edge "the search results" spawn-result-row spawn-left-pane both
    key Escape 0.8
    view default

    echo "-- right pane, $disp"
    sweep_in "$disp: user card + shortcuts over the whole right pane" spawn-right-pane "spawn-user-card|spawn-shortcut-row" spawn-right-pane 5
    edge "the first shortcut row" spawn-shortcut-row spawn-right-pane both
    edge "the user card" spawn-user-card spawn-right-pane both
    echo "-- power buttons, $disp"
    dump_ui "$dev/ux/hit2-power.json"
    python3 - "$dev/ux/hit2-power.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
it = d["items"]
pane = next(i for i in it if "spawn-right-pane" in i.get("cls", "").split())
bs = [i for i in it if "spawn-power-button" in i.get("cls", "").split() and i["w"] > 0]
print("power buttons:", [(b["x"], b["w"]) for b in bs], "pane", pane["x"], pane["w"])
ok = len(bs) >= 3
gaps = [round(b["x"] - (a["x"] + a["w"]), 1) for a, b in zip(bs, bs[1:])]
spacer = [g for g in gaps if g > 0.5]
print("gaps between buttons:", gaps, "(one flexible spacer is intended)")
ok = ok and len(spacer) <= 1
ok = ok and abs(bs[0]["x"] - pane["x"]) <= 0.5 and abs(bs[-1]["x"] + bs[-1]["w"] - (pane["x"] + pane["w"])) <= 0.5
ok = ok and all(abs(b["y"] + b["h"] - (pane["y"] + pane["h"])) <= 0.5 for b in bs)
sys.exit(0 if ok else 1)
PY
    check "$disp: power buttons touch each other (but for the spacer) and reach the pane's left / right / bottom edge" $?
    pick_is "$disp: left edge of the pane, level with the first power button" $(pane_point spawn-right-pane 1 spawn-power-button) spawn-power
    pick_is "$disp: right edge of the pane, level with the last power button" $(pane_point spawn-right-pane -2 spawn-power-button 2) spawn-power
    read -r gx gy < <(python3 -c '
import json, sys
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print(round((a[0] + a[2] + b[0]) / 2), round(a[1] + a[3] / 2))' "$(rect spawn-power-button 1)" "$(rect spawn-power-button 2)")
    pick_is "$disp: the 8 px between the two destructive buttons belong to a button" "$gx" "$gy" spawn-power
done
close_menu
