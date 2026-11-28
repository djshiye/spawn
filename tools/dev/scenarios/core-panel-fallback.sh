# Main-panel fallback (panel/attacher.ts): a panel provider that is active but has no valid panels -> the button
# goes to the main panel after 10 s, warned ONCE (not every 2 s), and returns to normal when panels come back.
leave_overview
close_menu
atts() { attachment_status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join("%s:%s:%s" % (a["key"], a["fallback"], a["attached"]) for a in d["attachments"]), d["pending"])'; }
expect "start: normal main attachment" "$(atts)" "main:False:True False"
mark="$(wc -l <"$log")"
dev_call ForceNoPanels true >/dev/null
sleep 13
expect "after 10 s: main-panel fallback, still pending" "$(atts)" "main:True:True True"
sleep 20
n="$(tail -n +"$((mark + 1))" "$log" | grep -c '\[spawn\].*falling back to the main panel')"
expect "fallback warned once in ~33 s (before the fix: every 2 s, ~12 lines)" "$n" 1
dev_call ForceNoPanels false >/dev/null
sleep 1
expect "panels back: normal attachment, nothing pending" "$(atts)" "main:False:True False"
n="$(tail -n +"$((mark + 1))" "$log" | grep -c 'leaving the main-panel fallback')"
expect "leaving the fallback is logged once" "$n" 1
