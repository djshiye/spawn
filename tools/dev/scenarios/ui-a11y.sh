# Accessibility (roadmap item 6). What a screen reader needs, checked on the live actor tree:
#   1. every visible focusable actor (St.Button / St.Entry / menu item) of the menu, the folder popup, the context
#      menu, the runner and the panel button has an accessible_name or a label_actor (Ui.A11y);
#   2. the search result count is announced: the live region says "N results" / "No results";
#   3. keyboard focus is visible: a focused item's face differs from the unfocused one (background and a ring,
#      Ui.Appearance), with the accent theme and with custom menu colours;
#   4. GNOME's "Reduce animation" (org.gnome.desktop.interface enable-animations) zeroes the stylesheet transitions.
# Orca itself is not part of this: the headless shell has no AT-SPI bus, so what is checked is what Spawn sets on the
# actors, not what is spoken. The shell's Atk name (`atk`) is printed when the shell reports one.
K=/org/gnome/shell/extensions/spawn

appearance() { ui_call Appearance "$1" "${2:-0}" | unwrap; }

a11y_audit() { # <description> [min items]: no focusable actor may lack a name
    local json
    json="$(ui_call A11y | unwrap)"
    printf '%s' "$json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
items, bad = d["items"], d["unnamed"]
print("   %d focusable actors, %d without a name or label" % (len(items), len(bad)))
for b in bad:
    print("   UNNAMED %s [%s] role=%s" % (b["type"], b["cls"], b["role"]))
sys.exit(0 if len(items) >= int(sys.argv[1]) and not bad else 1)' "${2:-1}"
    check "$1: every focusable actor has an accessible name" $?
}

audit_json() { ui_call A11y | unwrap; }

# name_of <json> <class fragment> <field>: the first item whose class contains the fragment
name_of() {
    printf '%s' "$1" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i in d["items"]:
    if sys.argv[1] in i["cls"].split():
        print(i[sys.argv[2]]); break' "$2" "$3"
}

# focus_changes <class> <nth> <neutral class> <description>: the keyboard focus must change the face's look
focus_changes() {
    local cls="$1" nth="$2" neutral="$3" what="$4" before after
    if [ "$(count "$cls")" -le "$nth" ]; then
        echo "skip $what: no visible '$cls' #$nth"
        return
    fi
    ui_call Move 5 5 >/dev/null; sleep 0.3
    focus_class "$neutral" 0
    sleep 0.3
    before="$(appearance "$cls" "$nth")"
    focus_class "$cls" "$nth"
    sleep 0.4
    after="$(appearance "$cls" "$nth")"
    python3 - "$before" "$after" <<'PY'
import json, sys
b, a = (json.loads(x) for x in sys.argv[1:3])
print("   before: bg=%s shadow=%s border=%s outline=%s pseudo=%r" % (b["bg"], b["shadow"], b["border"], b["outline"], b["pseudo"]))
print("   after:  bg=%s shadow=%s border=%s outline=%s pseudo=%r" % (a["bg"], a["shadow"], a["border"], a["outline"], a["pseudo"]))
changed = a["bg"] != b["bg"] or a["shadow"] != b["shadow"] or a["border"] != b["border"] or a["outline"] != b["outline"]
# a ring: an inset shadow with spread, an outline, or a thicker border (a tint alone is not enough)
sh = a["shadow"]
ring = (sh is not None and sh["spread"] >= 1 and sh["color"][3] > 0) or a["outline"] >= 1 or a["border"][0] > b["border"][0]
sys.exit(0 if "focus" in a["pseudo"] and changed and ring else 1)
PY
    check "focus is visible on $what (face changes, with a ring)" $?
}

echo "-- panel button and main menu"
leave_overview
close_menu
J="$(audit_json)"
expect "the panel button is named" "$(name_of "$J" spawn-button name)" "Spawn menu"
open_menu 1.5
a11y_audit "pinned view" 10
J="$(audit_json)"
expect "search entry name" "$(name_of "$J" spawn-search-box name)" "Search apps, windows and files"
expect "first pinned entry is named after the app" "$([ -n "$(name_of "$J" "$ITEM" name)" ] && echo named)" named
expect "folder entry says what it is" "$(name_of "$J" "$FOLDER" name | cut -c1-8)" "Folder: "
printf '%s' "$J" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i in d["items"][:12]:
    print("   %-10s %-28s name=%r role=%s atk=%r" % (i["type"], i["cls"][:28], i["name"][:40], i["role"], i["atk"]))'
for n in "Games" "Power Off" "Restart"; do
    printf '%s' "$J" | python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(sys.argv[1] in i["name"] for i in d["items"]) else 1)' "$n"
    check "an item is named '$n'" $?
done

echo "-- other views"
ui_call ShowView categories >/dev/null; sleep 1.2
a11y_audit "categories view" 5
ui_call ShowView frequent >/dev/null; sleep 1
a11y_audit "frequent view" 3
ui_call ShowView pinned >/dev/null; sleep 0.8

echo "-- folder popup"
ui_call OpenFolder 1 >/dev/null; sleep 0.9
expect_state "folder view is open" layout.view folder
a11y_audit "folder popup" 5
key Escape 0.6

echo "-- context menu (menu key on the first entry)"
focus_class "$ITEM" 0
key Menu 0.8
a11y_audit "app context menu" 3
key Escape 0.6
close_menu

echo "-- search results and the announced count"
open_menu 1.2
ui_call Search fire >/dev/null; sleep 2.2
n="$(state_get layout.results)"
check "'fire' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
a11y_audit "search results" 3
live="$(ui_call A11y | unwrap | python3 -c 'import json,sys; print(" | ".join(l["text"] + " (" + l["role"] + ")" for l in json.load(sys.stdin)["live"]))')"
echo "   live regions: $live"
printf '%s' "$live" | grep -Eq '^[0-9]+ results? \(alert\)|\| [0-9]+ results? \(alert\)'
check "the result count is announced through an alert live region" $?
expect "the result count matches the rows" "$(printf '%s' "$live" | grep -Eo '[0-9]+ results?' | head -1 | grep -Eo '^[0-9]+')" "$n"
ui_call Search zzzzqq >/dev/null; sleep 2.5
live="$(ui_call A11y | unwrap | python3 -c 'import json,sys; print(" | ".join(l["text"] for l in json.load(sys.stdin)["live"]))')"
echo "   live regions: $live"
printf '%s' "$live" | grep -q 'No results'
check "an empty search announces 'No results'" $?
key Escape 0.6
close_menu

echo "-- runner"
gdbus call --session --dest "$dest" --object-path "$path" --method io.github.djshiye.Spawn.ToggleRunner >/dev/null 2>&1
sleep 1.2
key f 0.3; key i 0.8
a11y_audit "runner" 1
J="$(audit_json)"
expect "runner entry name" "$(name_of "$J" spawn-search-box name)" "Search apps, windows and files"
key Escape 0.8

echo "-- visible keyboard focus (accent theme)"
open_menu 1.5
focus_changes "$ITEM" 0 spawn-shortcut-row "a pinned entry"
focus_changes "$FOLDER" 0 spawn-shortcut-row "a folder entry"
focus_changes spawn-shortcut-row 0 spawn-power-button "a shortcut row"
focus_changes spawn-user-card 0 spawn-shortcut-row "the user card"
focus_changes spawn-power-button 0 spawn-shortcut-row "a power button"
focus_changes spawn-search-box 0 spawn-shortcut-row "the search entry"
ui_call ShowView categories >/dev/null; sleep 1.2
focus_changes spawn-category-row 1 spawn-shortcut-row "a category row"
focus_changes spawn-list-row 0 spawn-shortcut-row "an app row of a list"
focus_changes spawn-nav-button 0 spawn-shortcut-row "the Back button"
ui_call Search fire >/dev/null; sleep 1.8
focus_changes spawn-result-row 1 spawn-shortcut-row "a search result"
key Escape 0.6
screenshot ui-a11y-focus

echo "-- visible keyboard focus (custom menu colours)"
dconf write $K/menu-background-color "'rgb(250,250,250)'"
dconf write $K/menu-foreground-color "'rgb(20,20,20)'"
dconf write $K/menu-item-hover-bg-color "'rgb(220,220,235)'"
dconf write $K/menu-item-hover-fg-color "'rgb(20,20,20)'"
dconf write $K/override-menu-theme true
sleep 2
focus_changes "$ITEM" 0 spawn-shortcut-row "a pinned entry (light custom colours)"
focus_changes spawn-search-box 0 spawn-shortcut-row "the search entry (light custom colours)"
screenshot ui-a11y-focus-custom
dconf write $K/menu-background-color "'rgb(24,24,28)'"
dconf write $K/menu-foreground-color "'rgb(240,240,240)'"
dconf write $K/menu-item-hover-bg-color "'rgb(60,60,70)'"
dconf write $K/menu-item-hover-fg-color "'rgb(255,255,255)'"
sleep 2
focus_changes "$ITEM" 0 spawn-shortcut-row "a pinned entry (dark custom colours)"
dconf reset $K/override-menu-theme
for k in menu-background-color menu-foreground-color menu-item-hover-bg-color menu-item-hover-fg-color; do dconf reset "$K/$k"; done
sleep 1.5
close_menu

echo "-- Reduce animation"
open_menu 1.2
expect "animations are on by default" "$(ui_call A11y | unwrap | json_get animations)" true
expect "no reduced-motion class while animations are on" "$(count spawn-reduce-motion)" 0
on_td="$(appearance "$ITEM" 0 | json_get td)"
check "the item face has a transition when animations are on (td=$on_td)" "$([ "${on_td%.*}" -gt 0 ] && echo 0 || echo 1)"
dconf write /org/gnome/desktop/interface/enable-animations false
sleep 1.5
expect "St.Settings follows 'Reduce animation'" "$(ui_call A11y | unwrap | json_get animations)" false
check "the menu carries spawn-reduce-motion" "$([ "$(count spawn-reduce-motion)" -ge 1 ] && echo 0 || echo 1)"
off_td="$(appearance "$ITEM" 0 | json_get td)"
expect "transitions are zero with animations off" "${off_td%.*}" 0
close_menu
open_menu 1.2
expect_state "the menu still opens with animations off" open true
ui_call OpenFolder 1 >/dev/null; sleep 0.6
expect_state "the folder popup opens at once" layout.view folder
key Escape 0.4
close_menu
dconf write /org/gnome/desktop/interface/enable-animations true
sleep 1.5
open_menu 1.2
expect "animations back on" "$(ui_call A11y | unwrap | json_get animations)" true
expect "reduced-motion class removed" "$(count spawn-reduce-motion)" 0
close_menu
