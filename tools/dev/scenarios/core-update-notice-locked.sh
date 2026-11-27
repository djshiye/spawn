# Update notice when the package is updated while Spawn is disabled (lock screen): on re-enable the old code is
# still running, so the notice must appear once (core/updateWatch.ts start() checks once). A separate scenario from
# core-update-notice because the "already told" state lasts for the whole shell session.
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
meta="$XDG_DATA_HOME/gnome-shell/extensions/$uuid/metadata.json"
notices() { hk notifications | python3 -c 'import json,sys; print(sum("was updated to" in n for n in json.load(sys.stdin)))'; }
leave_overview
close_menu
sleep 1
expect "nothing at start-up" "$(notices)" 0

echo "-- disabled (like the lock screen), the package is updated, enabled again"
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
python3 - "$meta" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["version-name"] = "9.9.9"
open(p + ".new", "w").write(json.dumps(d, indent=2))
PY
mv "$meta.new" "$meta"
sleep 1
gnome-extensions enable "$uuid" >/dev/null 2>&1
sleep 4
expect "one notice after re-enable" "$(notices)" 1

echo "-- another disable/enable does not repeat it"
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
sleep 4
expect "still one notice" "$(notices)" 1
is_active "$uuid"; check "Spawn is active" $?
