# App descriptions are searchable: "flatpak" finds Flatseal ("Manage Flatpak permissions").
# Needs Flatseal installed (skipped otherwise).
if [ ! -e /var/lib/flatpak/exports/share/applications/com.github.tchx84.Flatseal.desktop ]; then
    echo "skip: Flatseal is not installed"
else
    open_menu 1.5
    ui_call Search flatpak >/dev/null; sleep 1.5
    n="$(state_get layout.results)"
    check "'flatpak' has results ($n)" "$([ "$n" -ge 1 ] && echo 0 || echo 1)"
    screenshot search-description-flatpak
fi
