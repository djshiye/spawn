# Hide from Menu and the "New" badge, in the real shell.
#   * "Hide from Menu" in an app row's context menu: the app leaves All Apps and every category, the Undo banner
#     appears, search still finds it (search-hidden-apps), Undo / editing hidden-apps brings it back.
#   * An app installed after Spawn first saw the app list shows a "New" pill (row, tile), its accessible name is
#     "<name>, new", its category gets a dot, and launching it clears all of that (and new-apps in dconf).
# Apps are told apart by the accessible names of the rows of the visible app list (State.appRows).
apps="$XDG_DATA_HOME/applications"
k="/org/gnome/shell/extensions/spawn"
mkdir -p "$apps"
rm -f "$apps/zqxhide.desktop" "$apps/zqxnew.desktop"

row_index() { # name -> index of the row named "name" or "name, new" in the visible app list; fails when absent
    state_get layout.appRows | python3 -c '
import json, sys
name = sys.argv[1]
for i, row in enumerate(json.load(sys.stdin)):
    if row == name or row == name + ", new":
        print(i)
        sys.exit(0)
sys.exit(1)' "$1"
}
row_name() { # name -> the accessible name of that row ("Zqxnew Probe, new"); empty when absent
    state_get layout.appRows | python3 -c '
import json, sys
name = sys.argv[1]
print(next((r for r in json.load(sys.stdin) if r == name or r == name + ", new"), ""))' "$1"
}
wait_row() { # name present|absent [timeout s]: poll until the row is (not) in the visible list
    local i want=0
    [ "$2" = absent ] && want=1
    for ((i = 0; i < ${3:-20} * 2; i++)); do
        row_index "$1" >/dev/null 2>&1
        [ "$?" = "$want" ] && return 0
        sleep 0.5
    done
    return 1
}
click_text() { # text [nth]: click the centre of the nth visible label with exactly that text
    local r c
    r="$(ui_call TextRect "$1" "${2:-0}" | unwrap)"
    [ -n "$r" ] || { echo "FAIL no visible label '$1' to click"; status=1; return 1; }
    c="$(python3 -c 'import json,sys; x,y,w,h=json.loads(sys.argv[1]); print(round(x+w/2), round(y+h/2))' "$r")"
    click $c
}
focus_row() { # name: keyboard focus on the row (scrolls it into view)
    local i
    i="$(row_index "$1")" || { echo "FAIL no row '$1'"; status=1; return 1; }
    focus_class spawn-list-row "$i"
}
hide_via_context_menu() { # name. Retried: the sandbox's "running as root" notification can take the focus once
    local try
    for try in 1 2 3 4; do
        focus_row "$1" || return 1
        key Menu 1
        if [ -n "$(ui_call TextRect "Hide from Menu" 0 | unwrap)" ]; then
            if [ -n "${SHOT_CONTEXT:-}" ]; then
                screenshot "apps-hide-context-menu"
                SHOT_CONTEXT=
            fi
            click_text "Hide from Menu"
            return 0
        fi
        echo "context menu did not open (try $try), retrying"
        key Escape 0.6
        sleep 2
    done
    echo "FAIL the context menu of '$1' never opened"; status=1
}
dconf_has() { # key substring
    dconf read "$k/$1" | grep -qF "$2"
}

# --- 1. first run: known-apps is seeded from the apps installed now, nothing is new
# (All Apps builds the app catalogue if the start-up prebuild has not; the first build seeds known-apps)
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1.5
case "$(dconf read "$k/known-apps")" in
    ""|"@as []") echo "FAIL known-apps was not seeded on the first run (no installed apps?)"; status=1 ;;
    *) echo "ok   known-apps is seeded on the first run" ;;
esac
expect "no New pill on the first run" "$(count spawn-new-badge)" 0
expect "no category dot on the first run" "$(count spawn-new-dot)" 0

# the probe app that gets hidden is installed now; it counts as new, so clear that to keep the later counts exact
printf '[Desktop Entry]\nType=Application\nName=Zqxhide Probe\nExec=/usr/bin/true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/zqxhide.desktop"
sleep 4  # the GMenu tree reloads 1-2.5 s after the file changes
check "the probe app is listed" "$(wait_row 'Zqxhide Probe' present 20; echo $?)"
dconf reset "$k/new-apps"
sleep 1.5
expect "the probe app is not new any more" "$(row_name 'Zqxhide Probe')" "Zqxhide Probe"

# --- 2. Hide from Menu + Undo
echo "-- hide via the context menu"
SHOT_CONTEXT=1
hide_via_context_menu "Zqxhide Probe"
sleep 1
check "hidden-apps holds the id" "$(dconf_has hidden-apps zqxhide.desktop; echo $?)"
check "gone from All Apps" "$(row_index 'Zqxhide Probe' >/dev/null; [ $? = 1 ]; echo $?)"
expect_state "the Undo banner is showing" layout.undo true
screenshot apps-hide-banner
echo "-- Undo"
click_class spawn-undo-button
sleep 1
check "Undo removes it from hidden-apps" "$(dconf_has hidden-apps zqxhide.desktop; [ $? = 1 ]; echo $?)"
check "back in All Apps after Undo" "$(row_index 'Zqxhide Probe' >/dev/null; echo $?)"
expect_state "the banner is gone" layout.undo false

# --- 3. hidden: not in All Apps, categories; still in search
echo "-- hide again, then look everywhere"
SHOT_CONTEXT=
hide_via_context_menu "Zqxhide Probe"
sleep 1
check "gone from All Apps (second time)" "$(row_index 'Zqxhide Probe' >/dev/null; [ $? = 1 ]; echo $?)"
ui_call ShowView categories >/dev/null; sleep 1
cats="$(count spawn-category-row)"
found=0
for ((i = 0; i < cats; i++)); do
    focus_class spawn-category-row "$i"
    sleep 0.3
    row_index 'Zqxhide Probe' >/dev/null 2>&1 && found=1
done
expect "no category lists it ($cats categories checked)" "$found" 0
screenshot apps-hidden-categories
echo "-- search still finds it (search-hidden-apps on)"
ui_call Search zqxhide >/dev/null; sleep 1.5
expect_state "search finds the hidden app" layout.results 1
screenshot apps-hidden-search
dconf write "$k/search-hidden-apps" false
sleep 1.5
expect_state "search no longer finds it with search-hidden-apps off" layout.results 0
dconf write "$k/search-hidden-apps" true
sleep 1.5
expect_state "and finds it again with the switch on" layout.results 1
echo "-- restore (what the Preferences Restore button writes)"
ui_call ShowView all >/dev/null; sleep 1
dconf write "$k/hidden-apps" "@as []"
sleep 1.5
ui_call ShowView all >/dev/null; sleep 1
check "back in All Apps after the restore" "$(row_index 'Zqxhide Probe' >/dev/null; echo $?)"

# --- 4. a freshly installed app is New
echo "-- install an app while the menu is open"
printf '[Desktop Entry]\nType=Application\nName=Zqxnew Probe\nExec=/usr/bin/true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/zqxnew.desktop"
sleep 4
wait_row "Zqxnew Probe" present 20
expect "its accessible name says it is new" "$(row_name 'Zqxnew Probe')" "Zqxnew Probe, new"
check "new-apps records it" "$(dconf_has new-apps zqxnew.desktop; echo $?)"
n="$(count spawn-new-badge)"
check "a New pill is on screen ($n)" "$([ "$n" -ge 1 ]; echo $?)"
focus_row "Zqxnew Probe"
sleep 0.5
screenshot apps-new-row
ui_call ShowView categories >/dev/null; sleep 1
n="$(count spawn-new-dot)"
check "a category dot is on screen ($n)" "$([ "$n" -ge 1 ]; echo $?)"
screenshot apps-new-category-dot
echo "-- search result"
ui_call Search zqxnew >/dev/null; sleep 1.5
expect "the search result has the New pill" "$(count spawn-new-badge)" 1
screenshot apps-new-search
echo "-- tile in the pinned grid"
dconf write "$k/pinned-apps" "[{'id': 'zqxnew.desktop'}, {'id': 'org.gnome.Nautilus.desktop'}]"
set_display Grid
ui_call ShowView pinned >/dev/null; sleep 1.5
expect "the pinned tile has the New pill" "$(count spawn-new-badge)" 1
screenshot apps-new-tile
echo "-- the switch"
dconf write "$k/show-new-apps-badge" false
sleep 1.5
expect "no pill with show-new-apps-badge off" "$(count spawn-new-badge)" 0
dconf write "$k/show-new-apps-badge" true
sleep 1.5
expect "the pill is back with the switch on" "$(count spawn-new-badge)" 1
set_display List
ui_call ShowView pinned >/dev/null; sleep 1
expect "the pinned row has the New pill too" "$(count spawn-new-badge)" 1

# --- 5. launching clears it
echo "-- launch it"
ui_call ShowView all >/dev/null; sleep 1
focus_row "Zqxnew Probe"
key Return 1.5
close_menu
check "new-apps no longer holds it after the launch" "$(dconf_has new-apps zqxnew.desktop; [ $? = 1 ]; echo $?)"
open_menu 1.5
ui_call ShowView all >/dev/null; sleep 1
expect "the row lost its 'new' name" "$(row_name 'Zqxnew Probe')" "Zqxnew Probe"
expect "no pill left anywhere" "$(count spawn-new-badge)" 0
ui_call ShowView categories >/dev/null; sleep 1
expect "no category dot left" "$(count spawn-new-dot)" 0
screenshot apps-new-cleared
close_menu

dconf reset "$k/pinned-apps"
dconf reset "$k/hidden-apps"
rm -f "$apps/zqxhide.desktop" "$apps/zqxnew.desktop"
