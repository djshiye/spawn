# Keyboard reordering of pinned entries: Ctrl+arrows / Ctrl+Home / Ctrl+End on the list, the grid and inside an open
# folder; the focus stays on the moved entry; edges are no-ops; the order persists (dconf), across a menu reopen and
# across disable/enable. Names below are the seeded pinned apps: S steam, C Claude, H husk, I Internet, G Games, T Tarky.
S=steam.desktop; C=com.anthropic.Claude.desktop; H=husk.desktop
I=7d610436-4b17-46cf-99db-97578edac1c1; G=3c2219f1-a114-4e2e-a06c-51fdefa91991; T=7d76d6f0-79d7-40fb-87f8-8838ebe22b19

# step <description> <key> <expected top-level order> <expected focusIndex>
step() {
    key "$2" 0.5
    expect "$1: order" "$(pinned_ids)" "$3"
    expect_state "$1: focus follows the entry" layout.focusIndex "$4"
    expect_state "$1: focus still in the layout" layout.focusInLayout true
}

echo "== List"
open_menu 1.5
key Down
expect_state "Down from search lands on the first row" layout.focusIndex 0
expect "seed order" "$(pinned_ids)" "$S $C $H $I $G $T"
step "Ctrl+Down" Ctrl+Down "$C $S $H $I $G $T" 1
screenshot ui-reorder-list
step "Ctrl+Down again" Ctrl+Down "$C $H $S $I $G $T" 2
step "Ctrl+Up" Ctrl+Up "$C $S $H $I $G $T" 1
step "Ctrl+Home" Ctrl+Home "$S $C $H $I $G $T" 0
step "Ctrl+Up at the top is a no-op" Ctrl+Up "$S $C $H $I $G $T" 0
step "Ctrl+Left / Ctrl+Right do nothing in a list" Ctrl+Right "$S $C $H $I $G $T" 0
step "Ctrl+End" Ctrl+End "$C $H $I $G $T $S" 5
step "Ctrl+Down at the bottom is a no-op" Ctrl+Down "$C $H $I $G $T $S" 5
step "Ctrl+Home" Ctrl+Home "$S $C $H $I $G $T" 0
echo "-- a folder row moves like an app"
key Down; key Down; key Down
expect_state "focus on the Internet folder row" layout.focusIndex 3
step "Ctrl+Up on a folder" Ctrl+Up "$S $C $I $H $G $T" 2
echo "-- plain arrows still navigate"
key Down 0.4
expect_state "Down moves the focus, nothing is reordered" layout.focusIndex 3
expect "order unchanged by plain arrows" "$(pinned_ids)" "$S $C $I $H $G $T"
echo "-- persists across a menu reopen"
close_menu
open_menu 1.5
expect "order after reopen" "$(pinned_ids)" "$S $C $I $H $G $T"
key Down
step "first row reorders after reopen (UI matches the stored order)" Ctrl+End "$C $I $H $G $T $S" 5
echo "-- persists across disable/enable"
close_menu
gnome-extensions disable "$uuid" >/dev/null 2>&1; sleep 1.5
gnome-extensions enable "$uuid" >/dev/null 2>&1
check "extension ACTIVE again" "$(wait_active "$uuid" 20 && echo 0 || echo 1)"
sleep 3
expect "order after disable/enable" "$(pinned_ids)" "$C $I $H $G $T $S"
open_menu 1.5
key Down
step "first row reorders after re-enable (UI matches the stored order)" Ctrl+Down "$I $C $H $G $T $S" 1
close_menu

echo "== Grid"
reset_seed
set_display Grid
open_menu 1.5
key Down
expect_state "grid shows 4 columns" layout.columns 4
step "Ctrl+Right" Ctrl+Right "$C $S $H $I $G $T" 1
screenshot ui-reorder-grid
step "Ctrl+Down moves one row (clamped to the short last row)" Ctrl+Down "$C $H $I $G $T $S" 5
step "Ctrl+Up moves one row up" Ctrl+Up "$C $S $H $I $G $T" 1
step "Ctrl+Left" Ctrl+Left "$S $C $H $I $G $T" 0
step "Ctrl+Left at the start is a no-op" Ctrl+Left "$S $C $H $I $G $T" 0
step "Ctrl+Up on the first row is a no-op" Ctrl+Up "$S $C $H $I $G $T" 0
step "Ctrl+End" Ctrl+End "$C $H $I $G $T $S" 5
step "Ctrl+Right at the end is a no-op" Ctrl+Right "$C $H $I $G $T $S" 5
step "Ctrl+Down on the last row is a no-op" Ctrl+Down "$C $H $I $G $T $S" 5
step "Ctrl+Home" Ctrl+Home "$S $C $H $I $G $T" 0
close_menu
open_menu 1.5
expect "grid order after reopen" "$(pinned_ids)" "$S $C $H $I $G $T"

echo "== Inside a folder (grid)"
F_APPS="$(folder_ids $I)"
echo "Internet folder: $F_APPS"
read -r -a fa <<<"$F_APPS"
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "Internet folder open" layout.folder "$I"
expect_state "focus on the first app" layout.focusIndex 0
fstep() { # <description> <key> <expected folder order> <expected focusIndex>
    key "$2" 0.5
    expect "$1: order" "$(folder_ids $I)" "$3"
    expect_state "$1: focus follows the entry" layout.focusIndex "$4"
    expect_state "$1: focus still in the layout" layout.focusInLayout true
    expect_state "$1: still in the folder" layout.folder "$I"
}
fstep "Ctrl+Right" Ctrl+Right "${fa[1]} ${fa[0]} ${fa[2]} ${fa[3]}" 1
screenshot ui-reorder-folder-grid
fstep "Ctrl+End" Ctrl+End "${fa[1]} ${fa[2]} ${fa[3]} ${fa[0]}" 3
fstep "Ctrl+Right at the end is a no-op" Ctrl+Right "${fa[1]} ${fa[2]} ${fa[3]} ${fa[0]}" 3
fstep "Ctrl+Left" Ctrl+Left "${fa[1]} ${fa[2]} ${fa[0]} ${fa[3]}" 2
fstep "Ctrl+Home" Ctrl+Home "${fa[0]} ${fa[1]} ${fa[2]} ${fa[3]}" 0
fstep "Ctrl+Up on the first row is a no-op" Ctrl+Up "${fa[0]} ${fa[1]} ${fa[2]} ${fa[3]}" 0
expect "the top level is untouched by folder reordering" "$(pinned_ids)" "$S $C $H $I $G $T"
fstep "Ctrl+Right (to survive the reopen check)" Ctrl+Right "${fa[1]} ${fa[0]} ${fa[2]} ${fa[3]}" 1
close_menu
open_menu 1.5
expect "folder order after reopen" "$(folder_ids $I)" "${fa[1]} ${fa[0]} ${fa[2]} ${fa[3]}"

echo "== Inside a folder (list)"
PINNED_DISPLAY=List; pin_vars
reset_seed
open_menu 1.5
ui_call OpenFolder 0 >/dev/null; sleep 0.8
expect_state "Internet folder open (list)" layout.folder "$I"
expect_state "list display" layout.display List
fstep "Ctrl+Down" Ctrl+Down "${fa[1]} ${fa[0]} ${fa[2]} ${fa[3]}" 1
fstep "Ctrl+Down" Ctrl+Down "${fa[1]} ${fa[2]} ${fa[0]} ${fa[3]}" 2
fstep "Ctrl+Right does nothing in a list" Ctrl+Right "${fa[1]} ${fa[2]} ${fa[0]} ${fa[3]}" 2
fstep "Ctrl+Home" Ctrl+Home "${fa[0]} ${fa[1]} ${fa[2]} ${fa[3]}" 0
close_menu

echo "== Ghosts: a folder of apps that are not installed (Tarky) reorders without trouble"
open_menu 1.5
ui_call OpenFolder 2 >/dev/null; sleep 0.8
expect_state "Tarky folder open" layout.folder "$T"
key Ctrl+End 0.5
expect "Tarky order" "$(folder_ids $T)" "SPT - Launcher.desktop SPT - Server.desktop"
close_menu
PINNED_DISPLAY=List; pin_vars
reset_seed

echo "== Duplicate id in pinned-apps (hand-edited): the menu shows it once, Ctrl+arrows move the focused row"
# The tile index (one tile per distinct entry) must not be used as an index into the raw list: with
# [S S C H I G T] the focused row C is tile 1 but raw entry 2.
python3 - <<'PY'
import ast, subprocess
k = "/org/gnome/shell/extensions/spawn/pinned-apps"
entries = ast.literal_eval(subprocess.check_output(["dconf", "read", k], text=True).strip())
entries.insert(1, dict(entries[0]))
subprocess.check_call(["dconf", "write", k, repr(entries)])
PY
sleep 1
expect "duplicate seeded" "$(pinned_ids)" "$S $S $C $H $I $G $T"
open_menu 1.5
expect "the duplicate is drawn once" "$(count $ITEM)" 6
key Down; key Down
expect_state "focus on C (row 1)" layout.focusIndex 1
step "Ctrl+Up moves C, not the hidden second S" Ctrl+Up "$C $S $S $H $I $G $T" 0
step "Ctrl+Down" Ctrl+Down "$S $C $S $H $I $G $T" 1
step "Ctrl+End" Ctrl+End "$S $S $H $I $G $T $C" 5
focus_class $ITEM 0
expect_state "focus on the first row" layout.focusIndex 0
step "Ctrl+Down moves S past its own repeat: S ends up after H" Ctrl+Down "$H $S $S $I $G $T $C" 1
step "Ctrl+Up back to the top" Ctrl+Up "$S $H $S $I $G $T $C" 0
close_menu
reset_seed
