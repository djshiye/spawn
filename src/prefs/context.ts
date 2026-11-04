// Shared context handed to every preferences page. Prefs run in a separate process (no
// Main, no global): only gi:// and the prefs resource modules may be imported from prefs/.
//
// Public API:
//   PrefsContext: {settings: SpawnSettings, extensionDir: string, window: Adw.PreferencesWindow}

import type Adw from 'gi://Adw';

import type {SpawnSettings} from '../core/settings.js';

export interface PrefsContext {
    settings: SpawnSettings;
    extensionDir: string;
    window: Adw.PreferencesWindow;
}
