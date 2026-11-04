// Preferences page "Button". STUB: signatures are final, the page is empty.
//
// Icon (bundled set / custom path), size, padding, appearance, position, click actions.
//
// Public API:
//   createButtonPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createButtonPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'button',
        title: 'Button',
        icon_name: 'view-app-grid-symbolic',
    });
}
