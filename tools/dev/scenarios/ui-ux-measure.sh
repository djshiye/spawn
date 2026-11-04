# UX audit measurements (actor allocations, not screenshots): dumps the popup tree for the pinned,
# folder and all-apps views, prints the audit table and fails when a target is missed.
mkdir -p "$dev/ux"
open_menu 1.5
dump_ui "$dev/ux/pinned.json"
echo "-- pinned view"
python3 "$root/tools/dev/ux-measure.py" "$dev/ux/pinned.json" --check; check "pinned view meets the UX targets" $?
ui_call OpenFolder 0 >/dev/null; sleep 0.8
dump_ui "$dev/ux/folder.json"
ui_call ShowView categories >/dev/null; sleep 0.8
dump_ui "$dev/ux/allapps.json"
echo "-- all apps view"
python3 "$root/tools/dev/ux-measure.py" "$dev/ux/allapps.json" --check; check "all apps view meets the UX targets" $?
ui_call ShowView default >/dev/null; sleep 0.4
echo "-- keyboard focus ring on every focusable kind"
for cls in $ITEM spawn-user-card spawn-shortcut-row spawn-power-button spawn-nav-button; do
    focus_class "$cls" 0
    dump_ui "$dev/ux/focus-$cls.json"
    python3 - "$dev/ux/focus-$cls.json" "$cls" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
# the focused item carries the :focus pseudo class: its background alpha is the 25 % accent tint
it = next(i for i in d["items"] if sys.argv[2] in i.get("cls", "").split())
bg = it["bg"]
print("focus bg", sys.argv[2], bg)
sys.exit(0 if bg[3] > 0.15 and bg[2] > bg[0] else 1)
PY
    check "$cls shows the accent focus tint" $?
done
screenshot ux-focus
