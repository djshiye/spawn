# Search freshness and typo tolerance in the real shell: an app installed while its search is showing
# appears without typing again, a removed one disappears, and misspelt queries still find apps.
apps="$XDG_DATA_HOME/applications"
mkdir -p "$apps"
rm -f "$apps/zqxfresh.desktop"
sleep 1
open_menu 1.5
ui_call Search zqxfresh >/dev/null; sleep 1.2
expect_state "nothing matches before the app is installed" layout.results 0
echo "-- install while the results are showing"
printf '[Desktop Entry]\nType=Application\nName=Zqxfresh Studio\nExec=/usr/bin/true\nIcon=application-x-executable\nCategories=Utility;\n' >"$apps/zqxfresh.desktop"
sleep 4  # the GMenu tree reloads 1-2.5 s after the file changes
expect_state "the new app shows up without typing again" layout.results 1
screenshot search-fresh-installed
echo "-- typo tolerance"
ui_call Search zqxfrseh >/dev/null; sleep 1.2
expect_state "a swapped pair of letters still finds it" layout.results 1
ui_call Search calculater >/dev/null; sleep 1.2
expect_state "'calculater' finds Calculator" layout.results 1
screenshot search-typo
echo "-- remove while the results are showing"
ui_call Search zqxfresh >/dev/null; sleep 1.2
rm -f "$apps/zqxfresh.desktop"
sleep 4  # without the existence check Shell.AppSystem keeps it for about 5.5 s
expect_state "the removed app is gone without typing again" layout.results 0
ui_call Search zqxfres >/dev/null; sleep 0.5
ui_call Search zqxfresh >/dev/null; sleep 1.2
expect_state "still gone after typing again" layout.results 0
close_menu
