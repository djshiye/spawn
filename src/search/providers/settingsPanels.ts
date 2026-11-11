// SettingsPanelsProvider ('settingsPanels'): finds the panels of GNOME Settings ("wifi", "bluetooth", "display",
// "sound", "printers"...) and opens them with `gnome-control-center <panel>`.
//
// The panels come from the installed gnome-control-center panel desktop files (search/panelIndex.ts reads both
// the GNOME 45+ naming org.gnome.Settings-<panel>-panel.desktop and the older gnome-<panel>-panel.desktop), read
// on the first query after the menu was closed. Only offered when `gnome-control-center` is in the PATH.
// The panel is opened with Gio.Subprocess and an argv array, no shell. Sections follow the provider order:
// registered after the apps, so an app that matches stays above its panel, and above windows and files.
// Enabled by search-settings-panels (on by default). Results are named after the panel (e.g. "Wi-Fi"), with
// the description "Settings".
//
// Public API:
//   new SettingsPanelsProvider(settings: SpawnSettings, options?: {panels?: () => SettingsPanel[], available?: () => boolean})
//        implements SearchProvider; the options replace the discovery (tests, dev hooks)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
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
    private readonly _options: SettingsPanelsOptions;

    constructor(private readonly _settings: SpawnSettings, options: SettingsPanelsOptions = {}) {
        this._options = options;
    }

    isEnabled(): boolean {
        return this._settings.get('search-settings-panels');
    }

    clear(): void {
        this._panels = null;
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!(this._options.available ?? (() => GLib.find_program_in_path('gnome-control-center') !== null))())
            return [];
        this._panels ??= this._options.panels?.() ?? this._discover();
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
