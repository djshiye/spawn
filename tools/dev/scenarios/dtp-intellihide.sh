# Dash to Panel with intellihide (needs --with-dtp, seeded): the panel stays revealed while the menu is open on it,
# and hides again after the menu closed, but only once the pointer is off the panel. Also: the menu is placed
# like under an always-visible panel, and toggling Dash to Panel with the menu open leaks no hold and logs no
# error. Not testable headless: a fullscreen monitor (the hold is then released at once, see panel/intellihide.ts).
K=/org/gnome/shell/extensions/dash-to-panel
AWAY="800 300"      # mid-screen, far from the bottom panel
ON_PANEL="800 888"  # inside the bottom panel (1600x900 virtual monitor, 40 px panel)

pointer() { # x y: the first virtual motion after a quiet period can land at x=0, so move twice
    ui_call Move "$1" "$2" >/dev/null; sleep 0.25
    ui_call Move "$1" "$2" >/dev/null; sleep 0.25
}

# ih <field>: a field of the first attachment's intellihide state (visible / hold / enabled / translation)
ih() {
    attachment_status | python3 -c '
import json, sys
s = json.load(sys.stdin)
d = (s["attachments"][0] if s["attachments"] else {}).get("intellihide")
print("none" if d is None else json.dumps(d[sys.argv[1]]))' "$1"
}

# wait_ih <field> <expected> [timeout s]
wait_ih() {
    local i v=""
    for ((i = 0; i < ${3:-10} * 4; i++)); do
        v="$(ih "$1")"
        [ "$v" = "$2" ] && break
        sleep 0.25
    done
    echo "$v"
}

if ! wait_active "$dtp_uuid" 30; then
    echo "FAIL Dash to Panel did not become ACTIVE in the headless shell"
    ext_state "$dtp_uuid"
    status=1
else
    sleep 4
    # The first virtual motion starts at the top-left corner and trips the hot corner (Overview): move
    # first, then leave the Overview (a visible Overview keeps an intellihide panel revealed).
    pointer $AWAY
    leave_overview
    pointer $AWAY

    # No windows exist: without these two the panel counts as "no window overlaps" and never hides.
    dconf write $K/intellihide-hide-from-windows false
    dconf write $K/intellihide-hide-from-monitor-windows false
    dconf write $K/intellihide-revealed-hover false
    dconf write $K/intellihide-animation-time 100
    dconf write $K/intellihide-close-delay 0
    dconf write $K/intellihide-reveal-delay 0
    dconf write $K/intellihide-enable-start-delay 200
    dconf write $K/intellihide true
    expect "intellihide is enabled on the attached DtP panel" "$(wait_ih enabled true 10)" true
    expect "the panel hides by itself (no menu, pointer away)" "$(wait_ih visible false 10)" false
    echo "status: $(attachment_status)"

    echo "== menu open: the panel is revealed and held"
    open_menu 1.5
    expect_state "menu open" open true
    echo "status (menu open): $(attachment_status)"
    expect "panel box visible while the menu is open" "$(ih visible)" true
    expect "panel box not translated away" "$(ih translation)" "[0, 0]"
    expect "temporary hold taken (bit 1)" "$(( $(ih hold) & 1 ))" 1
    mkdir -p "$dev/ux"
    dump_ui "$dev/ux/dtp-intellihide.json"
    python3 - "$dev/ux/dtp-intellihide.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
a = d["anchor"]
box = next(i for i in d["items"] if "popup-menu-content" in i.get("cls", ""))
gap = a[1] - (box["y"] + box["h"])
print(f"gap between popup content and the bottom panel (intellihide on): {gap:g} px")
sys.exit(0 if abs(gap - 4) <= 1 else 1)
PY
    check "popup sits 4 px above the panel with intellihide on (no ArcMenu-style offset needed)" $?
    screenshot dtp-intellihide-open
    sleep 1.5
    expect "panel still revealed 1.5 s into the open menu" "$(ih visible)" true

    echo "== close with the pointer away: the panel hides again"
    close_menu
    expect "hold released after close" "$(wait_ih hold 0 5)" 0
    expect "panel hides again after the menu closed" "$(wait_ih visible false 10)" false

    echo "== close with the pointer ON the panel: it stays until the pointer leaves"
    open_menu 1.5
    expect "revealed again by the second open" "$(ih visible)" true
    pointer $ON_PANEL
    close_menu
    sleep 1.5
    expect "pointer on the panel: hold kept" "$(( $(ih hold) & 1 ))" 1
    expect "pointer on the panel: panel stays visible" "$(ih visible)" true
    pointer $AWAY
    expect "pointer left: hold released" "$(wait_ih hold 0 5)" 0
    expect "pointer left: panel hides" "$(wait_ih visible false 10)" false

    echo "== reopen while a release is pending keeps a single hold"
    open_menu 1.2
    pointer $ON_PANEL
    close_menu
    open_menu 1.2
    expect "reopened: still held once" "$(ih hold)" 1
    pointer $AWAY
    close_menu
    expect "hold released after the final close" "$(wait_ih hold 0 5)" 0
    expect "and the panel hides" "$(wait_ih visible false 10)" false

    echo "== toggle Dash to Panel while the menu is open"
    open_menu 1.5
    expect_state "menu open before the toggle" open true
    for i in 1 2 3; do
        gnome-extensions disable "$dtp_uuid" >/dev/null 2>&1
        sleep 0.6
        gnome-extensions enable "$dtp_uuid" >/dev/null 2>&1
        wait_active "$dtp_uuid" 30 || { echo "FAIL Dash to Panel not ACTIVE after toggle $i"; status=1; }
        sleep 1.5
        echo "toggle $i: attachments=$(attachment_status)"
    done
    ok=0
    for _ in $(seq 1 30); do
        if attachment_status | python3 -c '
import json, sys
s = json.load(sys.stdin)
sys.exit(0 if s["attachments"] and all(a["attached"] for a in s["attachments"]) and not s["pending"] else 1)'; then
            ok=1
            break
        fi
        sleep 0.5
    done
    check "button attached again after toggling DtP with the menu open" $((1 - ok))
    expect_state "the menu is closed (its anchor was rebuilt)" open false
    pointer $AWAY
    expect "no hold left on the rebuilt panel" "$(wait_ih hold 0 5)" 0
    expect "the rebuilt panel hides by itself again" "$(wait_ih visible false 15)" false

    echo "== and the menu still works afterwards"
    open_menu 1.5
    expect_state "menu opens on the rebuilt panel" open true
    expect "panel revealed again" "$(ih visible)" true
    close_menu
    expect "hold released" "$(wait_ih hold 0 5)" 0
    expect "panel hides" "$(wait_ih visible false 10)" false
    screenshot dtp-intellihide-end
fi
