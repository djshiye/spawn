# Power bar fit ("Buttons at the bottom"): with 4 / 5 / 8 buttons enabled in a 180 / 200 / 260 px right pane every
# visible power button must lie inside the pane (compact surfaces, or a "More" button for the overflow), Power Off
# stays visible, and the row is unchanged when everything fits. Screenshots: .dev/shots/power-fit-<n>-<w>.png.
K=/org/gnome/shell/extensions/spawn
leave_overview

# power-options ids: 0 LogOut 1 Lock 2 Restart 3 PowerOff 4 Suspend 5 HybridSleep 6 Hibernate 7 SwitchUser
declare -A OPTS=(
    [4]="[(0, true), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false)]"
    [5]="[(0, true), (1, true), (2, true), (3, true), (4, true), (5, false), (6, false), (7, false)]"
    [8]="[(0, true), (1, true), (2, true), (3, true), (4, true), (5, true), (6, true), (7, true)]"
)

dconf write $K/power-display-style "'Default'"

# fit_check <n> <width>: every visible .spawn-power-button inside .spawn-right-pane; prints mode info
fit_check() {
    local n="$1" w="$2" total pane i boxes=""
    total="$(count spawn-power-button)"
    pane="$(rect spawn-right-pane 0)"
    for ((i = 0; i < total; i++)); do
        boxes+="$(rect spawn-power-button $i)"$'\n'
    done
    python3 - "$pane" "$n" "$w" "$boxes" <<'PY'
import json, sys
pane = json.loads(sys.argv[1])
boxes = [json.loads(l) for l in sys.argv[4].splitlines() if l.strip()]
px, py, pw, ph = pane
bad = [b for b in boxes if b[0] < px - 0.5 or b[0] + b[2] > px + pw + 0.5]
print(f'{sys.argv[2]} buttons, pane {sys.argv[3]} px (allocated {pw:g}): {len(boxes)} visible, pane x {px:g}..{px + pw:g}')
for b in bad:
    print('   outside the pane:', b)
sys.exit(0 if boxes and not bad else 1)
PY
}

for n in 4 5 8; do
    for w in 180 200 260; do
        echo "-- $n buttons, right pane $w px"
        close_menu
        dconf write $K/right-panel-width "$w"
        dconf write $K/power-options "${OPTS[$n]}"
        sleep 1.5
        open_menu 1.8
        fit_check "$n" "$w"; check "$n buttons @ $w px: all visible power buttons are inside the pane" $?
        shown="$(count spawn-power-button)"
        [ "$shown" -ge 2 ] && ok=0 || ok=1
        check "$n buttons @ $w px: at least 2 buttons shown ($shown)" $ok
        [ "$(count spawn-power-destructive)" -ge 1 ] && ok=0 || ok=1
        check "$n buttons @ $w px: Power Off stays on the row" $ok
        if [ "$(count spawn-power-more)" -gt 0 ]; then
            echo "   overflow: More button present, $shown buttons incl. More"
        fi
        screenshot power-fit-$n-$w
    done
done

echo "-- 8 buttons, 200 px: the More menu lists the rest"
close_menu
dconf write $K/right-panel-width 200
dconf write $K/power-options "${OPTS[8]}"
sleep 1.5
open_menu 1.8
move_class spawn-power-more 0 0.6
screenshot power-fit-more-hover
click_class spawn-power-more
expect "More menu shows the 4 hidden actions" "$(count popup-menu-item)" 4
screenshot power-fit-more-open
key Escape 0.6

echo "-- 4 buttons, 260 px: unchanged (normal) layout"
close_menu
dconf write $K/right-panel-width 260
dconf write $K/power-options "${OPTS[4]}"
sleep 1.5
open_menu 1.8
expect "no More button when everything fits" "$(count spawn-power-more)" 0
expect "all 4 buttons shown" "$(count spawn-power-button)" 4

close_menu
dconf reset $K/right-panel-width
dconf reset $K/power-options
dconf reset $K/power-display-style
