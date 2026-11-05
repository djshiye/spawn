// openExtensionPrefs(uuid): open an extension's preferences window.
//
// GNOME 51's Main.extensionManager.openExtensionPrefs() makes the same D-Bus call but
// catches failures with logError, so the expected "Already showing a prefs dialog"
// rejection (any prefs window is already open) lands in the log as a CRITICAL. We make
// the call ourselves and treat that one case as a no-op; anything else is logged.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {error} from './log.js';

export function openExtensionPrefs(uuid: string): void {
    try {
        Gio.DBus.session.call(
            'org.gnome.Shell.Extensions',
            '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions',
            'OpenExtensionPrefs',
            new GLib.Variant('(ssa{sv})', [uuid, '', {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    conn?.call_finish(res);
                } catch (e) {
                    if (!String(e).includes('Already showing'))
                        error(`opening preferences for ${uuid} failed`, e);
                }
            });
    } catch (e) {
        error(`opening preferences for ${uuid} failed`, e);
    }
}
