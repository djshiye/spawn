// Preferences entry point (Adw). Runs in the prefs process: no Main, no global.
//
// Public API:
//   default class SpawnMenuPreferences extends ExtensionPreferences
//   fillPreferencesWindow(window): adds the pages in PAGES order; each page comes from
//   prefs/pages/<name>.ts (create<Name>Page(ctx) -> Adw.PreferencesPage)

import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SpawnSettings} from './core/settings.js';
import type {PrefsContext} from './prefs/context.js';
import {createAboutPage} from './prefs/pages/about.js';
import {createAppearancePage} from './prefs/pages/appearance.js';
import {createButtonPage} from './prefs/pages/button.js';
import {createGeneralPage} from './prefs/pages/general.js';
import {createImportPage} from './prefs/pages/import.js';
import {createMenuPage} from './prefs/pages/menu.js';
import {createPinnedPage} from './prefs/pages/pinned.js';

const PAGES = [
    createGeneralPage,
    createButtonPage,
    createMenuPage,
    createPinnedPage,
    createAppearancePage,
    createImportPage,
    createAboutPage,
];

export default class SpawnMenuPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Parameters<ExtensionPreferences['fillPreferencesWindow']>[0]): Promise<void> {
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            this.dir.get_child('schemas').get_path() ?? '',
            Gio.SettingsSchemaSource.get_default(),
            false,
        );
        const ctx: PrefsContext = {
            settings: new SpawnSettings(this.getSettings(), schemaSource),
            extensionDir: this.path,
            window,
        };
        window.set_default_size(720, 640);
        for (const create of PAGES)
            window.add(create(ctx));
    }
}
