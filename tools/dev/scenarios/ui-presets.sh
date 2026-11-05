# Theme presets, menu placement and the runner font.
#  1. Each of the four built-in `menu-themes` presets (read from the schema default) is applied the way the
#     prefs do it (override-menu-theme = true + the eleven colour / shape keys, written to the sandbox dconf);
#     the open menu is screenshotted for each and the popup's computed colours are compared with the preset.
#  2. `menu-position-alignment` moves the menu under a button centred in the panel (position-in-panel = Center),
#     `menu-arrow-rise` moves the layout away from the panel, both live while the menu is open.
#  3. `runner-font-size` changes the runner's font; 0 gives the menu font back.
K=/org/gnome/shell/extensions/spawn
leave_overview

# apply_preset <index>: writes what prefs/presets.ts applyPreset writes; prints "name|background|text" of the preset
apply_preset() {
    python3 - "$root/schemas/org.gnome.shell.extensions.spawn.gschema.xml" "$1" <<'PY'
import ast, re, subprocess, sys
xml = open(sys.argv[1]).read()
block = re.search(r'<key name="menu-themes" type="aas">.*?<default>(.*?)</default>', xml, re.S).group(1)
themes = ast.literal_eval(block)
t = themes[int(sys.argv[2])]
K = "/org/gnome/shell/extensions/spawn/"
keys = ["menu-background-color", "menu-foreground-color", "menu-border-color", "menu-border-width", "menu-border-radius",
        "menu-font-size", "menu-separator-color", "menu-item-hover-bg-color", "menu-item-hover-fg-color",
        "menu-item-active-bg-color", "menu-item-active-fg-color"]
subprocess.run(["dconf", "write", K + "override-menu-theme", "true"], check=True)
for key, value in zip(keys, t[1:]):
    subprocess.run(["dconf", "write", K + key, value if key.endswith(("width", "radius", "size")) else "'" + value + "'"], check=True)
print("|".join([t[0], t[1], t[2]]))
PY
}

# colour_of <css colour> -> "r g b a" (a in 0..255, as St reports it)
colour_of() {
    python3 - "$1" <<'PY'
import re, sys
c = sys.argv[1].strip()
m = re.match(r'rgba?\(([^)]*)\)', c)
p = [float(x) for x in m.group(1).split(',')]
print(round(p[0]), round(p[1]), round(p[2]), round((p[3] if len(p) > 3 else 1) * 255))
PY
}

# popup_colour bg|fg: the computed background / foreground of the first .popup-menu-content in the dump, as "r g b a"
popup_colour() {
    dump_ui "$tmpd/dump.json"
    python3 - "$tmpd/dump.json" "$1" <<'PY'
import json, sys
items = json.load(open(sys.argv[1]))["items"]
e = next(i for i in items if "popup-menu-content" in i.get("cls", ""))
print(*[round(v) for v in e[sys.argv[2]]])
PY
}

tmpd="$(mktemp -d)"
open_menu 1.5
screenshot ui-preset-0-desktop-theme
base_bg="$(popup_colour bg)"
echo "desktop theme popup background: $base_bg"

for i in 0 1 2 3; do
    # the menu is closed while the preference changes (the way prefs work); the tone (light / dark text) is read on open
    close_menu
    IFS='|' read -r name want_bg want_fg < <(apply_preset "$i")
    sleep 1.5
    open_menu 1.5
    screenshot "ui-preset-$((i + 1))-$(echo "$name" | tr ' ' '-' | tr 'A-Z' 'a-z')"
    got_bg="$(popup_colour bg)"
    got_fg="$(popup_colour fg)"
    # the popup background may be quantised (alpha 0.98 -> 250); allow a small tolerance per channel
    python3 - "$(colour_of "$want_bg")" "$got_bg" "$(colour_of "$want_fg")" "$got_fg" <<'PY'
import sys
w1, g1, w2, g2 = [list(map(int, a.split())) for a in sys.argv[1:5]]
sys.exit(0 if all(abs(a - b) <= 3 for a, b in zip(w1 + w2, g1 + g2)) else 1)
PY
    rc=$?
    check "preset '$name': popup background $got_bg ~ $(colour_of "$want_bg"), text $got_fg ~ $(colour_of "$want_fg")" $rc
    expect "preset '$name': override is on" "$(dconf read $K/override-menu-theme)" true
    check "preset '$name': menu-themes itself was not written" "$([ -z "$(dconf read $K/menu-themes)" ] && echo 0 || echo 1)"
done

echo "-- back to the desktop theme (override off)"
close_menu
dconf write $K/override-menu-theme false
sleep 1.5
open_menu 1.5
screenshot ui-preset-5-back-to-desktop
expect "popup background is the desktop theme's again" "$(popup_colour bg)" "$base_bg"
dconf reset $K/menu-background-color
close_menu

echo "-- placement: menu-position-alignment (button centred in the panel)"
dconf write $K/position-in-panel "'Center'"
sleep 2
open_menu 1.5
geom() { # menu x, width, anchor centre x of the open popup
    dump_ui "$tmpd/dump.json"
    python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
m, a = d["menu"], d["anchor"]
print(round(m[0], 1), round(m[2], 1), round(a[0] + a[2] / 2, 1))' "$tmpd/dump.json"
}
read -r mx mw ax < <(geom)
echo "default alignment 50: menu x=$mx w=$mw, button centre=$ax"
check "alignment 50 centres the menu on the button" "$(python3 -c "import sys; sys.exit(0 if abs($mx + $mw / 2 - $ax) <= 2 else 1)"; echo $?)"
screenshot ui-placement-50
dconf write $K/menu-position-alignment 100
sleep 1
read -r mx100 mw100 ax100 < <(geom)
echo "alignment 100: menu x=$mx100 (the menu starts at the button centre and extends right)"
check "alignment 100 moves the menu right (x $mx -> $mx100)" "$(python3 -c "import sys; sys.exit(0 if $mx100 - $mx > $mw / 3 else 1)"; echo $?)"
check "alignment 100: the menu starts within 80 px of the button centre" "$(python3 -c "import sys; sys.exit(0 if abs($mx100 - $ax100) <= 80 else 1)"; echo $?)"
screenshot ui-placement-100
dconf write $K/menu-position-alignment 0
sleep 1
read -r mx0 mw0 ax0 < <(geom)
echo "alignment 0: menu x=$mx0 w=$mw0"
check "alignment 0 moves the menu left (x $mx -> $mx0)" "$(python3 -c "import sys; sys.exit(0 if $mx - $mx0 > $mw / 3 else 1)"; echo $?)"
check "alignment 0: the menu ends within 80 px of the button centre" "$(python3 -c "import sys; sys.exit(0 if abs($mx0 + $mw0 - $ax0) <= 80 else 1)"; echo $?)"
screenshot ui-placement-0
dconf write $K/menu-position-alignment 50
sleep 1
read -r mxb mwb axb < <(geom)
check "back to 50: centred again" "$(python3 -c "import sys; sys.exit(0 if abs($mxb + $mwb / 2 - $axb) <= 2 else 1)"; echo $?)"
close_menu
dconf write $K/position-in-panel "'Left'"
sleep 2
dconf write $K/menu-position-alignment 100
open_menu 1.5
read -r mxl mwl axl < <(geom)
dconf write $K/menu-position-alignment 50
sleep 1
read -r mxl2 mwl2 axl2 < <(geom)
check "alignment is ignored while the button is not centred (x $mxl = $mxl2)" "$([ "$mxl" = "$mxl2" ] && echo 0 || echo 1)"
close_menu
dconf reset $K/menu-position-alignment
dconf reset $K/position-in-panel
sleep 2

echo "-- placement: menu-arrow-rise moves the layout away from the panel (read on the next open)"
layout_y() { python3 -c 'import json, sys; print(json.loads(sys.argv[1])[1])' "$(rect spawn-layout 0)"; }
with_rise() { # <(bi) value> : set it, reopen the menu
    close_menu
    dconf write $K/menu-arrow-rise "$1"
    sleep 1.5
    open_menu 1.5
}
open_menu 1.5
y0="$(layout_y)"
echo "layout y with the theme's own rise: $y0"
with_rise "(false, 30)"
check "a disabled arrow rise changes nothing (y=$(layout_y) vs $y0)" "$([ "$(layout_y)" = "$y0" ] && echo 0 || echo 1)"
with_rise "(true, 0)"
y_0="$(layout_y)"
check "rise 0 sits above the theme's own rise ($y_0 < $y0)" "$([ "${y_0%.*}" -lt "${y0%.*}" ] && echo 0 || echo 1)"
screenshot ui-arrow-rise-0
with_rise "(true, 30)"
y30="$(layout_y)"
check "rise 30 puts the layout 30 px further from the panel than rise 0 ($y_0 -> $y30)" "$(python3 -c "import sys; sys.exit(0 if abs($y30 - $y_0 - 30) <= 1 else 1)"; echo $?)"
screenshot ui-arrow-rise-30
with_rise "(true, -20)"
y_m="$(layout_y)"
check "a negative rise is clamped to 0 (menu not pulled over the panel: $y_m = $y_0)" "$([ "$y_m" = "$y_0" ] && echo 0 || echo 1)"
dconf reset $K/menu-arrow-rise
sleep 1
close_menu

echo "-- runner-font-size"
runner_fs() { # font size (px) of the runner content, from the dump
    dump_ui "$tmpd/dump.json"
    python3 -c '
import json, sys
items = json.load(open(sys.argv[1]))["items"]
e = next(i for i in items if "spawn-runner-content" in i.get("cls", ""))
print(round(e["fs"], 1))' "$tmpd/dump.json"
}
toggle_runner() { gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.ToggleRunner >/dev/null 2>&1; sleep "${1:-1}"; }
toggle_runner 1.3
fs_default="$(runner_fs)"
echo "runner font: $fs_default px"
toggle_runner 0.8
dconf write $K/runner-font-size 20
sleep 0.5
toggle_runner 1.3
fs20="$(runner_fs)"
echo "runner font with runner-font-size 20: $fs20 px (20 pt = 26.7 px)"
check "runner-font-size 20 gives a 20 pt font ($fs20 px)" "$(python3 -c "import sys; sys.exit(0 if abs($fs20 - 20 * 96 / 72) < 0.6 else 1)"; echo $?)"
screenshot ui-runner-font-20
toggle_runner 0.8
dconf write $K/runner-font-size 0
sleep 0.5
toggle_runner 1.3
expect "runner-font-size 0 returns to the menu font" "$(runner_fs)" "$fs_default"
toggle_runner 0.8
dconf reset $K/runner-font-size
rm -rf "$tmpd"
