// SettingsPanelsProvider ('settingsPanels'): finds the panels of GNOME Settings ("wifi", "bluetooth", "display",
// "sound", "printers"...) and opens them with `gnome-control-center <panel>`.
//
// The panels come from the installed gnome-control-center panel desktop files (search/panelIndex.ts reads both
// the GNOME 45+ naming org.gnome.Settings-<panel>-panel.desktop and the older gnome-<panel>-panel.desktop), read
// once and kept (with whether `gnome-control-center` is in the PATH, which it must be for the panels to be
// offered) until Shell.AppSystem reports installed-changed (a .desktop file was added, changed or removed).
// warmUp() (menu open) reads them in an idle, so the first keystroke does not. Without a scope (tests) the
// list is read again on the first query after clear() (menu closed), as before.
// The panel is opened with Gio.Subprocess and an argv array, no shell. Sections follow the provider order:
// registered after the apps, so an app that matches stays above its panel, and above windows and files.
// Enabled by search-settings-panels (on by default). Results are named after the panel (e.g. "Wi-Fi"), with
// the description "Settings".
//
// Public API:
//   new SettingsPanelsProvider(settings: SpawnSettings, options?: {panels?: () => SettingsPanel[], available?: () => boolean},
//        scope?: Scope)  implements SearchProvider; the options replace the discovery (tests, dev hooks); with a
//        scope the list is kept across menu opens (see above)
//   provider.warmUp(): read the panels in an idle now (no-op when they are read or the provider is off)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {builtinPanels, loadPanels, matchPanels, panelArgv, panelDirs, type SettingsPanel} from '../panelIndex.js';

export interface SettingsPanelsOptions {
    panels?: () => SettingsPanel[];
    available?: () => boolean;
}

export class SettingsPanelsProvider implements SearchProvider {
    readonly id = 'settingsPanels';
    readonly title = _('Settings');
    readonly immediate = true;

    private _panels: SettingsPanel[] | null = null;
    /** Whether gnome-control-center is in the PATH; null = not looked up since the last invalidation. */
    private _available: boolean | null = null;
    private readonly _options: SettingsPanelsOptions;
    private readonly _scope: Scope | null;
    private _warming: (() => void) | null = null;

    constructor(private readonly _settings: SpawnSettings, options: SettingsPanelsOptions = {}, scope?: Scope) {
        this._options = options;
        this._scope = scope ?? null;
        if (scope) {
            scope.connect(Shell.AppSystem.get_default(), 'installed-changed', () => this._invalidate());
            scope.add(() => this._warming?.(), 'settings panels warm-up');
        }
    }

    isEnabled(): boolean {
        return this._settings.get('search-settings-panels');
    }

    clear(): void {
        if (!this._scope)
            this._invalidate();
    }

    warmUp(): void {
        if (!this._scope || this._warming || (this._panels && this._available !== null) || !this.isEnabled())
            return;
        this._warming = this._scope.idle(() => {
            this._warming = null;
            if (this._isAvailable())
                this._panels ??= this._load();
        });
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!this._isAvailable())
            return [];
        this._panels ??= this._load();
        const ranked = matchPanels(query, this._panels, maxSearchResults(this._settings));
        if (token.cancelled)
            return [];
        return ranked.map(({item, score}) => ({
            id: item.id,
            providerId: this.id,
            title: item.name,
            description: _('Settings'),
            icon: item.icon,
            score,
            activate: () => openPanel(item.id),
        }));
    }

    private _invalidate(): void {
        this._panels = null;
        this._available = null;
    }

    private _isAvailable(): boolean {
        if (this._options.available)
            return this._options.available();
        this._available ??= GLib.find_program_in_path('gnome-control-center') !== null;
        return this._available;
    }

    private _load(): SettingsPanel[] {
        return this._options.panels?.() ?? this._discover();
    }

    private _discover(): SettingsPanel[] {
        try {
            const found = loadPanels(panelDirs());
            return found.length > 0 ? found : builtinPanels();
        } catch (e) {
            error('reading the Settings panels failed', e);
            return builtinPanels();
        }
    }
}

export function openPanel(id: string): void {
    try {
        Gio.Subprocess.new(panelArgv(id), Gio.SubprocessFlags.NONE);
    } catch (e) {
        error(`opening the ${id} settings panel failed`, e);
    }
}
