// Preferences page "General". STUB: signatures are final, the page is empty.
//
// Super key, hotkeys, multi-monitor, Activities button, behaviour.
//
// Public API:
//   createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createGeneralPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'general',
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });
}
