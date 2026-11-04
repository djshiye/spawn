# Dash to Panel (bottom panel by default): the popup must open UPWARD, arrow side BOTTOM.
if ! wait_active "$dtp_uuid" 30; then
    echo "FAIL Dash to Panel did not become ACTIVE in the headless shell"
    ext_state "$dtp_uuid"
    status=1
else
    sleep 4
    leave_overview
    echo "attachments: $(attachment_status)"
    open_menu 1.5
    echo "popup: $(ui_state)"
    expect_state "menu open on the DtP button" open true
    expect_state "arrow side is BOTTOM (St.Side.BOTTOM = 2)" side 2
    mkdir -p "$shots/final"
    screenshot final/dtp-bottom
fi
