// openExtensionPrefs(uuid): open an extension's preferences window.
//
// GNOME 51's Main.extensionManager.openExtensionPrefs() makes the same D-Bus call but
// catches failures with logError, so the expected "Already showing a prefs dialog"
// rejection (any prefs window is already open) lands in the log as a CRITICAL. We make
// the call ourselves and treat that one case as a no-op; anything else is logged.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {error} from './log.js';
import {type PrefsPageName, prefsPageIndex} from './prefsPages.js';
import type {SpawnSettings} from './settings.js';

/**
 * Open Spawn's own settings window, on the page called `page` (core/prefsPages.ts) when given. The window opens on
 * `prefs-visible-page`, so the page is chosen by writing that key first; a window that is already open follows the key
 * (prefs.ts listens for it) and switches page.
 */
export function openSpawnPrefs(settings: SpawnSettings, uuid: string, page?: PrefsPageName): void {
    try {
        const index = page === undefined ? -1 : prefsPageIndex(page);
        if (index >= 0 && settings.get('prefs-visible-page') !== index)
            settings.set('prefs-visible-page', index);
    } catch (e) {
        error('could not choose the preferences page', e);
    }
    openExtensionPrefs(uuid);
}

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
