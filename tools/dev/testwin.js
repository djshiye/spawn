// A plain GTK4 window for the dev-shell scenarios (button-menu.sh: Show Desktop minimizes / restores it).
// Run with WAYLAND_DISPLAY pointing at the sandbox shell's socket; stays until killed.
// Optional first argument: the window title (default 'SpawnTestWindow').
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

Gtk.init();
const win = new Gtk.Window({title: System.programArgs[0] ?? 'SpawnTestWindow', default_width: 420, default_height: 300});
win.set_child(new Gtk.Label({label: 'Show Desktop test window'}));
win.present();
GLib.MainLoop.new(null, false).run();
