// Settings window: after a package update the window is the NEW version while the shell still runs the old code.
// Ask the running extension which version it runs (the read-only RunningVersion property on its session-bus
// name: nothing a user setting or another program can write) and, when it differs from this window's own version,
// show a banner-like toast that stays until it is dismissed: "Spawn was updated to 1.2.0. Log out and back in to
// finish the update." No answer (the extension is off, or not running) shows nothing.
//
// Public API:
//   showUpdateNoticeIfNeeded(window, installedVersion: string | null): void   fire and forget; never throws

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {DBUS_NAME, DBUS_PATH} from '../core/constants.js';
import {RUNNING_VERSION_PROPERTY, updateMessage, updatePending} from '../core/updateNotice.js';

export function showUpdateNoticeIfNeeded(window: Adw.PreferencesWindow, installedVersion: string | null): void {
    try {
        Gio.DBus.session.call(
            DBUS_NAME, DBUS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [DBUS_NAME, RUNNING_VERSION_PROPERTY]),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 2000, null,
            (connection: Gio.DBusConnection | null, result: Gio.AsyncResult) => {
                try {
                    const reply = connection?.call_finish(result);
                    const running = (reply?.deepUnpack() as [unknown] | undefined)?.[0];
                    const version = running instanceof GLib.Variant ? running.get_string()[0] : null;
                    if (installedVersion && updatePending(version, installedVersion))
                        window.add_toast(new Adw.Toast({title: updateMessage(installedVersion), timeout: 0}));
                } catch {
                    // the extension is not running: nothing to say
                }
            },
        );
    } catch {
        // no session bus: nothing to say
    }
}
