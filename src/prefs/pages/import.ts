// Preferences page "Import from ArcMenu". STUB: signatures are final, the page is empty.
//
// Preview of migrate/arcmenu.ts planMigration() output, Import button, optional disable ArcMenu.
//
// Public API:
//   createImportPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window}

import Adw from 'gi://Adw';

import type {PrefsContext} from '../context.js';

export function createImportPage(_ctx: PrefsContext): Adw.PreferencesPage {
    return new Adw.PreferencesPage({
        name: 'import',
        title: 'Import from ArcMenu',
        icon_name: 'document-open-symbolic',
    });
}
