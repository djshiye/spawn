# In-shell benchmark with the user's seeded config. Raw JSON -> .dev/bench.json, table on stdout.
# Stub apps: the sandbox adds BENCH_EXTRA_APPS (290) "Prefix Suffix" stub apps to its own applications dir first,
# so the All Apps numbers are measured with a realistic ~330 apps; a 2000-entry recently-used.xbel (a third of
# the files exist) feeds the recent-files numbers.
# Run 1 uses the settings as seeded (search: apps only, the user's default) and adds the All Apps and typing
# sections; run 2 also turns on the open-windows and recent-files providers and repeats the search part, then
# the recent-files first key; run 3 is the leak check (open / type / close 30x); last a disable / enable soak
# (SOAK_CYCLES cycles: stage actors and RSS before / after). GNOME Shell search providers
# are only included with SPAWN_BENCH_SHELL=1: they D-Bus-activate the real Software / Calendar /
# Characters / Nautilus / ... search services (and whatever those start), and their latency is
# dominated by those foreign processes, not by Spawn. WARNING: those activated apps (Firefox,
# Software, ...) use $HOME-based state, not the sandbox XDG dirs, and this has launched real app
# processes; run it only when you want those numbers.
python3 - "$XDG_DATA_HOME" "$HOME" "${BENCH_EXTRA_APPS:-290}" <<'PY'
import os, random, sys
data, home, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
apps = os.path.join(data, "applications")
os.makedirs(apps, exist_ok=True)
prefixes = ("Alpha Bravo Cobalt Delta Echo Fable Gamma Harbour Indigo Juniper Kestrel Lumen Mosaic Nimbus Onyx "
            "Prism Quartz Raven Sierra Tundra Umber Vertex Willow Xenon Yonder Zephyr Amber Basalt Cedar Dune").split()
suffixes = "Studio Notes Player Viewer Editor Manager Tracker Monitor Console Browser".split()
cats = ["Game", "Utility", "Network", "Office", "Graphics", "Development", "AudioVideo", "Education", "System", "Science"]
for i in range(n):
    name = f"{prefixes[i // len(suffixes) % len(prefixes)]} {suffixes[i % len(suffixes)]}"
    with open(os.path.join(apps, f"bench.stub{i:03d}.desktop"), "w") as f:
        f.write(f"[Desktop Entry]\nType=Application\nName={name}\nComment=Stub app {i} for the benchmark\n"
                f"Exec=/usr/bin/true\nIcon=application-x-executable\nCategories={cats[i % len(cats)]};\n")

docs = os.path.join(home, "Documents", "bench")
os.makedirs(docs, exist_ok=True)
words = ["report", "notes", "photo", "invoice", "draft", "slides", "budget", "letter"]
out = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" '
       'xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">']
rnd = random.Random(1)  # the same "random" xbel every run
for i in range(2000):
    path = os.path.join(docs, f"{words[i % len(words)]}-{i:04d}.txt")
    if rnd.random() < 1 / 3:  # a third of the files exist, spread over all names and dates
        open(path, "w").close()
    stamp = f"2026-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}T{rnd.randint(0, 23):02d}:{rnd.randint(0, 59):02d}:00Z"
    out.append(f'  <bookmark href="file://{path}" added="{stamp}" modified="{stamp}" visited="{stamp}">'
               '<info><metadata owner="http://freedesktop.org"><mime:mime-type type="text/plain"/></metadata></info></bookmark>')
out.append("</xbel>")
with open(os.path.join(data, "recently-used.xbel"), "w") as f:
    f.write("\n".join(out) + "\n")
PY
sleep 4  # let the prebuild idle, the app index rebuild for the stub apps and the startup settle
leave_overview
bench() { # sections
    gdbus call --session --timeout 600 --dest "$dest" --object-path "$path" \
        --method io.github.djshiye.Spawn.Dev.Benchmark "$1" | unwrap
}
bench all >"$dev/bench-main.json" || { echo "FAIL benchmark call failed"; status=1; }
bench allapps >"$dev/bench-allapps.json" || { echo "FAIL benchmark (All Apps) call failed"; status=1; }
bench typing >"$dev/bench-typing.json" || { echo "FAIL benchmark (typing) call failed"; status=1; }
K=/org/gnome/shell/extensions/spawn
dconf write $K/search-provider-open-windows true
dconf write $K/search-provider-recent-files true
[ "${SPAWN_BENCH_SHELL:-0}" = 1 ] && dconf write $K/search-provider-shell true
sleep 1
bench search >"$dev/bench-search-all.json" || { echo "FAIL benchmark (all providers) call failed"; status=1; }
bench recent >"$dev/bench-recent.json" || { echo "FAIL benchmark (recent files) call failed"; status=1; }
bench leaks >"$dev/bench-leaks.json" || { echo "FAIL benchmark (leak check) call failed"; status=1; }

# disable / enable soak (the GNOME overview's own app grid is long built by now: it adds ~2500 stage actors
# about 20 s after the start, which would otherwise show up as a Spawn leak)
SOAK_CYCLES=20
# one cycle first: "before" is then a freshly enabled extension too (not one with the menus of the runs above built)
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 0.4
gnome-extensions enable "$uuid" >/dev/null 2>&1
wait_active "$uuid" 10; sleep 3
bench mem >"$dev/bench-soak-before.json" || { echo "FAIL benchmark (soak, before) call failed"; status=1; }
for _ in $(seq 1 $SOAK_CYCLES); do
    gnome-extensions disable "$uuid" >/dev/null 2>&1
    sleep 0.4
    gnome-extensions enable "$uuid" >/dev/null 2>&1
    sleep 0.6
done
wait_active "$uuid" 10 || { echo "FAIL extension not ACTIVE after the soak"; status=1; }
sleep 3
bench mem >"$dev/bench-soak-after.json" || { echo "FAIL benchmark (soak, after) call failed"; status=1; }

gpu="$(grep -h '^DRIVER=' /sys/class/drm/renderD128/device/uevent 2>/dev/null | head -1 | cut -d= -f2)"
python3 - "$dev" "${gpu:-unknown}" "$SOAK_CYCLES" <<'PY'
import json, sys
dev, gpu, cycles = sys.argv[1], sys.argv[2], int(sys.argv[3])
def load(name, key):
    try:
        return json.load(open(f"{dev}/bench-{name}.json"))[key]
    except (OSError, ValueError, KeyError):
        return None
d = json.load(open(f"{dev}/bench-main.json"))
d["searchAllProviders"] = load("search-all", "search")
for name, key in (("leaks", "leaks"), ("allapps", "allApps"), ("typing", "typing"), ("recent", "recent")):
    v = load(name, key)
    if v is not None:
        d[key] = v
before, after = load("soak-before", "mem"), load("soak-after", "mem")
if before and after:
    d["soak"] = {"cycles": cycles, "before": before, "after": after,
                 "stageActorsDelta": after["stageActors"] - before["stageActors"],
                 "rssDeltaKiB": after["rssKiB"] - before["rssKiB"]}
d["meta"] = {"gpu": f"real GPU via renderD128 (driver {gpu})", "monitor": "virtual 1600x900"}
json.dump(d, open(f"{dev}/bench.json", "w"), indent=2)
PY
python3 "$root/tools/dev/bench-table.py" "$dev/bench.json"
echo
echo "raw JSON: $dev/bench.json"
[ -s "$dev/bench.json" ] || status=1
