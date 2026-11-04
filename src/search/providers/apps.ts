// AppsProvider: searches AppIndex.searchEntries() with rank.ts; id 'apps'.
//
// The display name is scored on its raw form (camelCase word boundaries, e.g. "LibreOffice
// Writer"); the other keys (generic name, keywords, executable, ...) count at 70 % so an
// app whose NAME matches always beats one that only matches a keyword.
//
// Public API:
//   new AppsProvider(index: AppIndex, options?: {max?: number})  implements SearchProvider
//        max defaults to 12 (there is no settings key for the apps cap)
//   Always enabled. Activation: running app that can open a window -> new window, else
//   Shell.App.activate() (launches it / raises it).

import Shell from 'gi://Shell';

import {error} from '../../core/log.js';
import type {AppIndex, AppSearchEntry} from '../../model/appIndex.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {rankItemsBy, scoreNormalized} from '../rank.js';

const DEFAULT_MAX = 12;
const KEY_WEIGHT = 0.7;

export interface AppsProviderOptions {
    max?: number;
}

function activateApp(app: Shell.App): void {
    try {
        if (app.state === Shell.AppState.RUNNING && app.can_open_new_window())
            app.open_new_window(-1);
        else
            app.activate();
    } catch (e) {
        error(`launching ${app.get_id()} failed`, e);
        try {
            app.activate();
        } catch (e2) {
            error(`activating ${app.get_id()} failed`, e2);
        }
    }
}

export class AppsProvider implements SearchProvider {
    readonly id = 'apps';
    readonly title = 'Applications';

    private readonly _index: AppIndex;
    private readonly _max: number;

    constructor(index: AppIndex, options: AppsProviderOptions = {}) {
        this._index = index;
        this._max = options.max ?? DEFAULT_MAX;
    }

    isEnabled(): boolean {
        return true;
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim())
            return [];
        if (!this._index.built)
            this._index.build();

        const ranked = rankItemsBy(query, this._index.searchEntries(), (entry: AppSearchEntry, q) => {
            let best = scoreNormalized(q, entry.name);
            for (const key of entry.keys) {
                const s = Math.round(scoreNormalized(q, key) * KEY_WEIGHT);
                if (s > best)
                    best = s;
            }
            return best;
        }, this._max);
        if (token.cancelled)
            return [];

        return ranked.map(({item, score}) => {
            const app = item.app;
            return {
                id: item.id,
                providerId: this.id,
                title: item.name,
                description: app.get_description() ?? undefined,
                icon: app.get_icon(),
                score,
                activate: () => activateApp(app),
            };
        });
    }
}
