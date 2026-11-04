# Recent files: many dead xbel entries must not hide the live ones; folders are shown; a file
# deleted while the menu is open disappears after the existence cache expires (5 s).
K=/org/gnome/shell/extensions/spawn
data="$XDG_DATA_HOME"
files="$dev/search-recent-files"
rm -rf "$files"; mkdir -p "$files/a" "$files/b" "$files/c" "$files/d"
for d in a b c d; do echo x >"$files/$d/zqxreport.txt"; done
{
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">'
    # 60 dead entries, newest: they would fill any "top N by score" window
    for i in $(seq 60); do
        echo "<bookmark href=\"file:///nonexistent-$i/zqxreport.txt\" added=\"2026-01-01T00:00:00Z\" modified=\"2026-11-0$((i % 9 + 1))T00:00:00Z\" visited=\"2026-01-01T00:00:00Z\"><info><metadata owner=\"http://freedesktop.org\"><mime:mime-type type=\"text/plain\"/></metadata></info></bookmark>"
    done
    for d in a b c d; do
        echo "<bookmark href=\"file://$files/$d/zqxreport.txt\" added=\"2025-01-01T00:00:00Z\" modified=\"2025-01-01T00:00:00Z\" visited=\"2025-01-01T00:00:00Z\"><info><metadata owner=\"http://freedesktop.org\"><mime:mime-type type=\"text/plain\"/></metadata></info></bookmark>"
    done
    echo '</xbel>'
} >"$data/recently-used.xbel"
dconf write $K/search-provider-recent-files true
# the test files live under ~/Coding/spawn/.dev: a dot directory below $HOME counts as hidden
dconf write $K/show-hidden-recent-files true
dconf write $K/max-search-results 5
sleep 1
open_menu 1.5
ui_call Search zqxreport >/dev/null; sleep 1.5
expect_state "all 4 live files are listed despite 60 newer dead entries" layout.results 4
screenshot search-recent-folders
echo "-- punctuation-only query ranks nothing"
ui_call Search . >/dev/null; sleep 1.2
expect_state "'.' matches no file or app" layout.results 0
echo "-- deleting a file drops it from the results after the cache TTL"
ui_call Search zqxreport >/dev/null; sleep 1.2
rm -f "$files/a/zqxreport.txt"
sleep 6
ui_call Search zqxreport. >/dev/null; sleep 0.3
ui_call Search zqxreport >/dev/null; sleep 1.2
expect_state "deleted file is no longer listed" layout.results 3
echo "-- clear() on close: reopening re-reads the list"
close_menu
rm -f "$files/b/zqxreport.txt"
open_menu 1.5
ui_call Search zqxreport >/dev/null; sleep 1.2
expect_state "after reopen only 2 files remain" layout.results 2
