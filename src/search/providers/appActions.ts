// AppActionsProvider ('appActions'): the desktop actions of apps, found by "<app> <action>":
// "firefox private" -> "Firefox: New Private Window", "chrome incognito". Matching is search/appActions.ts; the
// apps are AppIndex.searchEntries() (so hidden apps follow the hidden-apps settings), the actions are read from
// the desktop file (GioUnix.DesktopAppInfo list_actions / get_action_name) only for apps that match the first words.
// Activation: Shell.App.launch_action(), so the shell tracks the new window as the app's (startup notification,
// app state), then the menu closes like for any result. Enabled by search-app-actions (on by default). Shown
// above the apps: it only ever matches queries with an action part, which the apps provider cannot answer.
//
// Public API:
//   new AppActionsProvider(index: AppIndex, settings: SpawnSettings)   implements SearchProvider

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import {appInfoOf} from '../../model/appInfo.js';
import type {AppIndex, AppSearchEntry} from '../../model/appIndex.js';
import {matchAppActions, type ActionApp, type AppAction} from '../appActions.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';

interface EntryWithActions extends ActionApp {
    entry: AppSearchEntry;
}

export class AppActionsProvider implements SearchProvider {
    readonly id = 'appActions';
    readonly title = _('App actions');
    readonly immediate = true;

    private _wrapped: WeakMap<AppSearchEntry, EntryWithActions> = new WeakMap();

    constructor(private readonly _index: AppIndex, private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-app-actions');
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!/\s/.test(query.trim()))
            return [];
        if (!this._index.built)
            this._index.build();
        const apps = this._index.searchEntries().map(e => this._wrap(e));
        const matches = matchAppActions(query, apps, maxSearchResults(this._settings));
        if (token.cancelled)
            return [];
        return matches.map(({app, action, score}) => ({
            id: `${app.id}:${action.id}`,
            providerId: this.id,
            title: `${app.name}: ${action.name}`,
            description: undefined,
            icon: app.entry.app.get_icon(),
            plainTitle: false,
            score,
            activate: () => {
                try {
                    app.entry.app.launch_action(action.id, global.get_current_time(), -1);
                } catch (e) {
                    error(`launching action ${action.id} of ${app.id} failed`, e);
                }
            },
        }));
    }

    private _wrap(entry: AppSearchEntry): EntryWithActions {
        let w = this._wrapped.get(entry);
        if (!w) {
            let cached: AppAction[] | null = null;
            w = {
                entry,
                id: entry.id,
                name: entry.name,
                keys: entry.keys,
                description: entry.description,
                actions: () => {
                    cached ??= readActions(entry);
                    return cached;
                },
            };
            this._wrapped.set(entry, w);
        }
        return w;
    }
}

function readActions(entry: AppSearchEntry): AppAction[] {
    const info = appInfoOf(entry.app);
    if (!info)
        return [];
    const out: AppAction[] = [];
    try {
        for (const id of info.list_actions()) {
            const name = info.get_action_name(id);
            if (id && name)
                out.push({id, name});
        }
    } catch (e) {
        error(`reading the actions of ${entry.id} failed`, e);
    }
    return out;
}
