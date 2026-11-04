// Preferences page "Menu". STUB: signatures are final, the page is empty.
//
// Default view, sizes and widths, search options, avatar, icon sizes.
//
// Public API:
//   createMenuPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createMenuPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'menu',
        title: 'Menu',
        icon_name: 'view-list-symbolic',
    });
}
