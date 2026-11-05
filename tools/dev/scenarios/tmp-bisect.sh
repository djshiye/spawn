ts() { echo "STEP $(date +%H:%M:%S.%N | cut -c1-12) $*"; }
ts leave_overview; leave_overview
ts focusbutton; dev_call FocusButton >/dev/null; sleep 0.4
ts Return; key Return 1.2
ts search1; ui_call Search fi >/dev/null; sleep 0.8
ts close1; dev_call Close >/dev/null; sleep 0.8
ts focusbutton; dev_call FocusButton >/dev/null; sleep 0.4
ts open2; dev_call Open >/dev/null; sleep 1.2
ts search2; ui_call Search fi >/dev/null; sleep 0.8
ts close2; dev_call Close >/dev/null; sleep 0.8
ts done; sleep 1
