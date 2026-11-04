// Preferences page "About". STUB: signatures are final, the page is empty.
//
// Version, licence (GPL-2.0-or-later), credit to ArcMenu.
//
// Public API:
//   createAboutPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createAboutPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'about',
        title: 'About',
        icon_name: 'help-about-symbolic',
    });
}
