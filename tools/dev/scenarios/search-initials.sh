# Short queries and usage: "ff" finds Firefox first (doubled initial), "fir" stays Firefox only, and
# the usage tie-break (Shell.AppUsage via AppIndex.usageScore) runs in a sandbox without usage data
# without errors. Needs Firefox installed (skipped otherwise). The usage ordering itself is covered
# by tests/search-ranking.test.js (mocked usageOf).
mkdir -p "$dev/search"
labels() { # <query> -> the result row titles, top to bottom
    ui_call Search "$1" >/dev/null; sleep 1.5
    dump_ui "$dev/search/$1.json"
    python3 - "$dev/search/$1.json" <<'PY'
import json, sys
items = json.load(open(sys.argv[1]))["items"]
rows = sorted((e for e in items if e.get("text") and e.get("cls") == "spawn-row-label"), key=lambda e: (round(e["y"]), e["x"]))
print("\n".join(e["text"] for e in rows))
PY
}
if ! ls /usr/share/applications /var/lib/flatpak/exports/share/applications "$XDG_DATA_HOME/applications" 2>/dev/null | grep -qi firefox; then
    echo "skip: Firefox is not installed"
else
    open_menu 1.5
    expect "'ff': Firefox is the first result" "$(labels ff | head -1)" "Firefox"
    screenshot search-initials-ff
    expect "'fir': only Firefox" "$(labels fir)" "Firefox"
    n="$(state_get layout.results)"
    check "'fir' has exactly one result row ($n)" "$([ "$n" = 1 ] && echo 0 || echo 1)"
    ui_call Search fi >/dev/null; sleep 1.2
    n="$(state_get layout.results)"
    check "'fi' has a handful of results ($n)" "$([ "$n" -ge 1 ] && [ "$n" -le 12 ] && echo 0 || echo 1)"
fi
