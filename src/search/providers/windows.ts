// WindowsProvider: searches open windows (global.display tab list, most recently used
// first); id 'windows'; enabled by search-provider-open-windows; max from max-search-results.
// Matches the window title (and the owning app's name at 80 %). activate() raises and
// focuses the window via Main.activateWindow (skipped when the window has since closed).
//
// Public API:
//   new WindowsProvider(settings: SpawnSettings)  implements SearchProvider  (see search/engine.ts)

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {hasAlnum, rankItemsBy, scoreNormalized} from '../rank.js';

const APP_NAME_WEIGHT = 0.8;

interface WindowInfo {
    window: Meta.Window;
    title: string;
    app: Shell.App | null;
    appName: string;
}

export class WindowsProvider implements SearchProvider {
    readonly id = 'windows';
    readonly title = 'Open Windows';

    private readonly _settings: SpawnSettings;

    constructor(settings: SpawnSettings) {
        this._settings = settings;
    }

    isEnabled(): boolean {
        return this._settings.get('search-provider-open-windows');
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim() || !hasAlnum(query))
            return [];
        const windows = this._windows();
        if (token.cancelled)
            return [];

        const ranked = rankItemsBy(query, windows, (info: WindowInfo, q) => {
            const byTitle = scoreNormalized(q, info.title);
            const byApp = Math.round(scoreNormalized(q, info.appName) * APP_NAME_WEIGHT);
            return Math.max(byTitle, byApp);
        }, maxSearchResults(this._settings));

        return ranked.map(({item, score}) => ({
            id: String(item.window.get_id()),
            providerId: this.id,
            title: item.title || item.appName,
            description: item.title ? item.appName || undefined : undefined,
            icon: item.app?.get_icon() ?? null,
            score,
            activate: () => {
                try {
                    // The window may have closed while the menu was open; a disposed
                    // Meta.Window must not reach Main.activateWindow.
                    if (!global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).includes(item.window))
                        return;
                    Main.activateWindow(item.window);
                } catch (e) {
                    error('activating window failed', e);
                }
            },
        }));
    }

    private _windows(): WindowInfo[] {
        const out: WindowInfo[] = [];
        const tracker = Shell.WindowTracker.get_default();
        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            try {
                const app = tracker.get_window_app(window);
                const title = window.get_title() ?? '';
                const appName = app?.get_name() ?? '';
                if (title || appName)
                    out.push({window, title, app, appName});
            } catch (e) {
                error('reading window failed', e);
            }
        }
        return out;
    }
}
