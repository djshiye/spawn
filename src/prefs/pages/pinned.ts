// Preferences page "Pinned & Shortcuts". STUB: signatures are final, the page is empty.
//
// Pinned apps and folders, directory and application shortcuts, power options.
//
// Public API:
//   createPinnedPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createPinnedPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'pinned',
        title: 'Pinned & Shortcuts',
        icon_name: 'starred-symbolic',
    });
}
