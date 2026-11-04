// Preferences page "Appearance". STUB: signatures are final, the page is empty.
//
// Accent / custom colours (override-menu-theme and the colour keys).
//
// Public API:
//   createAppearancePage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createAppearancePage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'appearance',
        title: 'Appearance',
        icon_name: 'applications-graphics-symbolic',
    });
}
