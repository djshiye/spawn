# Dash to Panel (bottom panel by default): the popup must open UPWARD, arrow side BOTTOM.
if ! wait_active "$dtp_uuid" 30; then
    echo "FAIL Dash to Panel did not become ACTIVE in the headless shell"
    ext_state "$dtp_uuid"
    status=1
else
    sleep 4
    leave_overview
    echo "attachments: $(attachment_status)"
    open_menu 1.5
    echo "popup: $(ui_state)"
    expect_state "menu open on the DtP button" open true
    expect_state "arrow side is BOTTOM (St.Side.BOTTOM = 2)" side 2
    mkdir -p "$shots/final" "$dev/ux"
    screenshot final/dtp-bottom-list
    dump_ui "$dev/ux/dtp.json"
    python3 "$root/tools/dev/ux-measure.py" "$dev/ux/dtp.json" --check; check "DtP bottom popup meets the UX targets" $?
    python3 - "$dev/ux/dtp.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
m, a = d["menu"], d["anchor"]
# content box of the popup (boxpointer minus its shadow margins) vs the panel top
box = next(i for i in d["items"] if "popup-menu-content" in i.get("cls", ""))
gap = a[1] - (box["y"] + box["h"])
print(f"gap between popup content and the bottom panel: {gap:g} px (top panel: 4 px)")
sys.exit(0 if abs(gap - 4) <= 1 else 1)
PY
    check "popup sits 4 px above the bottom panel (as 4 px below a top panel)" $?
    dconf write /org/gnome/shell/extensions/spawn/search-entry-location "'Auto'"
    close_menu; open_menu 1.5
    expect_state "Auto under a bottom panel keeps the entry at the bottom" layout.searchTop false
    dconf write /org/gnome/shell/extensions/spawn/search-entry-location "'Top'"
    close_menu; open_menu 1.5
    expect_state "Top puts it on top even under a bottom panel" layout.searchTop true
    screenshot final/dtp-bottom-search-top
    dconf write /org/gnome/shell/extensions/spawn/search-entry-location "'Bottom'"
    set_display Grid
    close_menu; open_menu 1.5
    screenshot final/dtp-bottom-grid
    set_display List
fi
