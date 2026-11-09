// openExtensionPrefs(uuid): open an extension's preferences window.
//
// GNOME 51's Main.extensionManager.openExtensionPrefs() makes the same D-Bus call but
// catches failures with logError, so the expected "Already showing a prefs dialog"
// rejection (any prefs window is already open) lands in the log as a CRITICAL. We make
// the call ourselves and treat that one case as a no-op; anything else is logged.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {error} from './log.js';
import type {SpawnSettings} from './settings.js';

/** Index of the Pinned page in prefs.ts PAGES (general, button, menu, pinned, ...): where the shortcut lists are edited. */
export const PREFS_PAGE_PINNED = 3;

/**
 * Open Spawn's own settings window, on `page` (an index into prefs.ts PAGES) when given. The window opens on
 * `prefs-visible-page`, so the page is chosen by writing that key first; a window that is already open stays where it is.
 */
export function openSpawnPrefs(settings: SpawnSettings, uuid: string, page?: number): void {
    try {
        if (page !== undefined && settings.get('prefs-visible-page') !== page)
            settings.set('prefs-visible-page', page);
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
