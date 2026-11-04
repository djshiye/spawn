// AppsProvider: searches AppIndex.searchEntries() with rank.ts; id 'apps'.
//
// The display name is scored on its raw form (camelCase word boundaries, e.g. "LibreOffice
// Writer"); the other keys (generic name, full name, keywords, executable, id) count at 70 % and the
// description (Comment=) only as whole words / word prefixes / substrings of a word at 40 %, so an
// app whose NAME matches always beats one that only matches a keyword. Punctuation-only
// queries match nothing.
//
// Public API:
//   new AppsProvider(index: AppIndex, settings: SpawnSettings, options?: {max?: number})
//        implements SearchProvider; the result cap is max-search-results unless `max` is given
//   Always enabled. Activation: ui/util.ts launchApp(app, settings, false), i.e. the same
//   rule as the grid (activate-on-launch: switch to a running app, else open a new window).

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {AppIndex, AppSearchEntry} from '../../model/appIndex.js';
import {launchApp} from '../../ui/util.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {hasAlnum, rankItemsBy, scoreApp} from '../rank.js';

const KEY_WEIGHT = 0.7;

export interface AppsProviderOptions {
    max?: number;
}

export class AppsProvider implements SearchProvider {
    readonly id = 'apps';
    readonly title = 'Applications';

    private readonly _index: AppIndex;
    private readonly _settings: SpawnSettings;
    private readonly _max: number | undefined;

    constructor(index: AppIndex, settings: SpawnSettings, options: AppsProviderOptions = {}) {
        this._index = index;
        this._settings = settings;
        this._max = options.max;
    }

    isEnabled(): boolean {
        return true;
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim() || !hasAlnum(query))
            return [];
        if (!this._index.built)
            this._index.build();

        const ranked = rankItemsBy(query, this._index.searchEntries(),
            (entry: AppSearchEntry, q) => scoreApp(q, entry.name, entry.keys, KEY_WEIGHT, entry.description),
            this._max ?? this._settings.get('max-search-results'));
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
                activate: () => {
                    try {
                        launchApp(app, this._settings, false);
                    } catch (e) {
                        error(`launching ${app.get_id()} failed`, e);
                    }
                },
            };
        });
    }
}
