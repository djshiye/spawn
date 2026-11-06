# In-shell benchmark with the user's seeded config. Raw JSON -> .dev/bench.json, table on stdout.
# Run 1 uses the settings as seeded (search: apps only, the user's default); run 2 also turns on the
# open-windows and recent-files providers and repeats the search part; run 3 is the leak check (open / type / close 30x). GNOME Shell search providers
# are only included with SPAWN_BENCH_SHELL=1: they D-Bus-activate the real Software / Calendar /
# Characters / Nautilus / ... search services (and whatever those start), and their latency is
# dominated by those foreign processes, not by Spawn. WARNING: those activated apps (Firefox,
# Software, ...) use $HOME-based state, not the sandbox XDG dirs, and this has launched real app
# processes; run it only when you want those numbers.
sleep 4  # let the prebuild idle and the startup settle
leave_overview
bench() { # sections
    gdbus call --session --timeout 600 --dest "$dest" --object-path "$path" \
        --method io.github.djshiye.Spawn.Dev.Benchmark "$1" | unwrap
}
bench all >"$dev/bench-main.json" || { echo "FAIL benchmark call failed"; status=1; }
K=/org/gnome/shell/extensions/spawn
dconf write $K/search-provider-open-windows true
dconf write $K/search-provider-recent-files true
[ "${SPAWN_BENCH_SHELL:-0}" = 1 ] && dconf write $K/search-provider-shell true
sleep 1
bench search >"$dev/bench-search-all.json" || { echo "FAIL benchmark (all providers) call failed"; status=1; }
bench leaks >"$dev/bench-leaks.json" || { echo "FAIL benchmark (leak check) call failed"; status=1; }

gpu="$(grep -h '^DRIVER=' /sys/class/drm/renderD128/device/uevent 2>/dev/null | head -1 | cut -d= -f2)"
python3 - "$dev" "${gpu:-unknown}" <<'PY'
import json, sys
dev, gpu = sys.argv[1], sys.argv[2]
d = json.load(open(f"{dev}/bench-main.json"))
d["searchAllProviders"] = json.load(open(f"{dev}/bench-search-all.json"))["search"]
try:
    d["leaks"] = json.load(open(f"{dev}/bench-leaks.json"))["leaks"]
except (OSError, ValueError, KeyError):
    pass
d["meta"] = {"gpu": f"real GPU via renderD128 (driver {gpu})", "monitor": "virtual 1600x900"}
json.dump(d, open(f"{dev}/bench.json", "w"), indent=2)
PY
python3 "$root/tools/dev/bench-table.py" "$dev/bench.json"
echo
echo "raw JSON: $dev/bench.json"
[ -s "$dev/bench.json" ] || status=1
