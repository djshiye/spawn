# After a package update the shell keeps the OLD code: when metadata.json on disk gets a different version, Spawn
# shows ONE polite notification ("Spawn was updated to X. Log out and back in to finish the update."); nothing
# at start-up or when the file is rewritten unchanged. The running version is published on D-Bus (RunningVersion,
# read-only) for the settings window (src/prefs/updateToast.ts). Screenshots: update-notice.png (banner), update-notice-list.png (in the notification list)
hk() { dev_call HotkeyStatus | sed -E "s/^\('(.*)',\)$/\1/" | json_get "$1"; }
meta="$XDG_DATA_HOME/gnome-shell/extensions/$uuid/metadata.json"
running="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version-name"])' "$meta")"
notices() { hk notifications | python3 -c 'import json,sys; print(sum("was updated to" in n for n in json.load(sys.stdin)))'; }
leave_overview
close_menu
sleep 1

expect "nothing at start-up" "$(notices)" 0
rv="$(gdbus call --session --dest "$dest" --object-path "$path" --method org.freedesktop.DBus.Properties.Get io.github.djshiye.Spawn RunningVersion 2>&1)"
expect "the running version is published on D-Bus" "$rv" "(<'$running'>,)"

echo "-- the same version rewritten: nothing"
python3 - "$meta" "$running" <<'PY'
import json, sys
p, v = sys.argv[1:3]
d = json.load(open(p))
d["version-name"] = v
open(p + ".new", "w").write(json.dumps(d, indent=2))
PY
mv "$meta.new" "$meta"
sleep 3
expect "no notice for an unchanged version" "$(notices)" 0

echo "-- a package update replaces metadata.json with a newer version"
python3 - "$meta" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["version-name"] = "9.9.9"
open(p + ".new", "w").write(json.dumps(d, indent=2))
PY
mv "$meta.new" "$meta"
sleep 4
expect "one notice" "$(notices)" 1
screenshot update-notice
click_class clock-display 0
sleep 1
screenshot update-notice-list
click_class clock-display 0
sleep 0.8
hk notifications | python3 -c 'import json,sys; print([n for n in json.load(sys.stdin) if "updated" in n])'

echo "-- further changes do not repeat it"
sed -i 's/9\.9\.9/9.9.10/' "$meta"
sleep 4
expect "still one notice" "$(notices)" 1
expect "the running version is unchanged (old code)" "$(gdbus call --session --dest "$dest" --object-path "$path" --method org.freedesktop.DBus.Properties.Get io.github.djshiye.Spawn RunningVersion 2>&1)" "(<'$running'>,)"
