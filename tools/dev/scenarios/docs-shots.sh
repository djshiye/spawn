# README screenshots (docs/screenshots/). Not a test: it sets up a tidy menu and takes the pictures the README shows.
# Run it with a realistic app set (real names and icons) mounted at /usr/local/share/applications, and with GNOME's
# wallpapers at /usr/share/backgrounds/gnome, on SPAWN_MONITOR=3200x1800 (it switches that monitor to 200 %). Then
# tools/dev/docs-crop.sh cuts each picture down to the panel corner and the menu. A "crop" line per shot logs the
# menu's rectangle (logical pixels) in case the menu grows.
K=/org/gnome/shell/extensions/spawn
SHOTS_PREFIX=docs

crop_line() { # name: the open menu's rectangle, for the crop step
    echo "crop $1 $(rect spawn-menu-popup 0)"
}

wallpaper() { # l|d
    gsettings set org.gnome.desktop.background picture-uri "file:///usr/share/backgrounds/gnome/adwaita-l.jpg" 2>/dev/null
    gsettings set org.gnome.desktop.background picture-uri-dark "file:///usr/share/backgrounds/gnome/adwaita-d.jpg" 2>/dev/null
    if [ "$1" = l ]; then
        gsettings set org.gnome.desktop.interface color-scheme prefer-light
    else
        gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    fi
    sleep 1.5
}

scale2() { # 3200x1800 virtual monitor (SPAWN_MONITOR) at 200 %: sharp pictures for high-density screens
    gjs -c '
const {Gio, GLib} = imports.gi;
const bus = Gio.DBus.session;
const call = (m, args, t) => bus.call_sync("org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
    "org.gnome.Mutter.DisplayConfig", m, args, t ? new GLib.VariantType(t) : null, Gio.DBusCallFlags.NONE, -1, null);
const [serial, monitors] = call("GetCurrentState", null, "(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})").deep_unpack();
const [spec, modes] = monitors[0];
const current = modes.find(m => { const p = m[6]["is-current"]; return p && p.deep_unpack(); }) ?? modes[0];
const cfg = new GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", [serial, 1,
    [[0, 0, 2.0, 0, true, [[spec[0], current[0], {}]]]], {}]);
call("ApplyMonitorsConfig", cfg, null);
' && sleep 2
}

leave_overview
gsettings set org.gnome.desktop.notifications show-banners false 2>/dev/null
[ "${SPAWN_MONITOR:-}" = 3200x1800 ] && scale2

dconf write $K/pinned-apps "[{'id': 'org.mozilla.firefox.desktop'}, {'id': 'org.gnome.Nautilus.desktop'}, {'id': 'org.gnome.Ptyxis.desktop'}, {'id': 'org.gnome.TextEditor.desktop'}, {'id': 'code.desktop'}, {'id': 'org.gnome.Calendar.desktop'}, {'id': 'org.gnome.Software.desktop'}, {'id': 'org.gnome.Settings.desktop'}, {'id': 'com.spotify.Client.desktop'}, {'id': 'org.gimp.GIMP.desktop'}, {'id': 'obsidian.desktop'}, {'id': 'org.gnome.Weather.desktop'}, {'id': 'org.gnome.Calculator.desktop'}, {'id': 'org.gnome.Loupe.desktop'}, {'id': 'org.gnome.Maps.desktop'}, {'id': 'org.libreoffice.Writer.desktop'}, {'id': 'org.signal.Signal.desktop'}, {'id': 'org.gnome.Boxes.desktop'}, {'id': 'b1f0c6a2-5d7e-4c1a-9a43-2d6f1e0a7c11', 'name': 'Games', 'isFolder': 'true'}, {'id': 'c27e1d90-3b5a-4e2f-8c61-7a9d0b4e2f35', 'name': 'Chat', 'isFolder': 'true'}]"
dconf write $K/folders/b1f0c6a2-5d7e-4c1a-9a43-2d6f1e0a7c11/name "'Games'"
dconf write $K/folders/b1f0c6a2-5d7e-4c1a-9a43-2d6f1e0a7c11/pinned-apps "[{'id': 'steam.desktop'}, {'id': 'com.heroicgameslauncher.hgl.desktop'}, {'id': 'org.prismlauncher.PrismLauncher.desktop'}, {'id': 'com.usebottles.bottles.desktop'}, {'id': 'org.gnome.Chess.desktop'}, {'id': 'org.gnome.Sudoku.desktop'}]"
dconf write $K/folders/c27e1d90-3b5a-4e2f-8c61-7a9d0b4e2f35/name "'Chat'"
dconf write $K/folders/c27e1d90-3b5a-4e2f-8c61-7a9d0b4e2f35/pinned-apps "[{'id': 'com.discordapp.Discord.desktop'}, {'id': 'slack.desktop'}, {'id': 'org.signal.Signal.desktop'}]"
dconf write $K/application-shortcuts "[{'id': 'org.gnome.Software.desktop'}, {'id': 'org.gnome.Settings.desktop'}, {'id': 'org.gnome.Ptyxis.desktop'}]"
dconf write $K/directory-shortcuts "[{'id': 'Spawn_Home', 'name': 'Home', 'icon': 'Spawn_Home'}, {'id': 'Spawn_Documents', 'name': 'Documents', 'icon': 'Spawn_Documents'}, {'id': 'Spawn_Downloads', 'name': 'Downloads', 'icon': 'Spawn_Downloads'}, {'id': 'Spawn_Pictures', 'name': 'Pictures', 'icon': 'Spawn_Pictures'}]"
dconf write $K/power-options "[(0, true), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false)]"
dconf write $K/pinned-apps-display "'Grid'"
dconf write $K/layout-style "'Classic'"
# the sandbox image ships ImageMagick's viewer, which no desktop needs in a picture of the menu
dconf write $K/hidden-apps "['display-im7.q16.desktop']"
dconf write $K/search-hidden-apps false
sleep 2

for scheme in d l; do
    wallpaper $scheme
    echo "-- Classic ($scheme)"
    dconf write $K/layout-style "'Classic'"; sleep 1.5
    open_menu 1.8
    ui_call Move 1500 850 >/dev/null; sleep 0.4
    crop_line "classic-$scheme"; screenshot "$SHOTS_PREFIX-classic-$scheme"
    ui_call Search "" >/dev/null; sleep 0.5
    close_menu

    echo "-- Grid ($scheme)"
    dconf write $K/layout-style "'Grid'"; sleep 1.5
    open_menu 1.8
    ui_call Move 1500 850 >/dev/null; sleep 0.4
    crop_line "grid-$scheme"; screenshot "$SHOTS_PREFIX-grid-$scheme"
    ui_call ShowView all >/dev/null; sleep 1.5
    crop_line "allapps-$scheme"; screenshot "$SHOTS_PREFIX-allapps-$scheme"
    ui_call ShowView pinned >/dev/null; sleep 0.8
    ui_call OpenFolder 0 >/dev/null; sleep 1.2
    ui_call Move 1500 850 >/dev/null; sleep 0.4
    crop_line "folder-$scheme"; screenshot "$SHOTS_PREFIX-folder-$scheme"
    key Escape 0.6
    for q in cal set display; do
        ui_call Search "$q" >/dev/null; sleep 1.2
        crop_line "search-$q-$scheme"; screenshot "$SHOTS_PREFIX-search-$q-$scheme"
    done
    ui_call Search "5 km in miles" >/dev/null; sleep 1.2
    crop_line "calc-$scheme"; screenshot "$SHOTS_PREFIX-calc-$scheme"
    ui_call Search "" >/dev/null; sleep 0.5
    close_menu
done
dconf write $K/layout-style "'Classic'"
