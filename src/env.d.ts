// Ambient type setup: GNOME Shell globals + GJS + the extra globals that Dash to Panel
// and App Icons Taskbar publish. Nothing here exists at runtime.
import '@girs/gnome-shell/extensions/global';
import '@girs/gnome-shell/ambient';
import '@girs/gnome-shell/extensions/extension/ambient';
import '@girs/gnome-shell/extensions/prefs/ambient';
import '@girs/gjs';
import '@girs/gjs/dom';
