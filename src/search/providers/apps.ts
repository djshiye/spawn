// AppsProvider: searches AppIndex.searchEntries() with rank.ts; id 'apps'.
//
// The display name is scored on its raw form (camelCase word boundaries, e.g. "LibreOffice
// Writer"); the other keys (generic name, full name, keywords, executable, id) count at 60 % and
// the description (Comment=) only as whole words / word prefixes / substrings of a word at 38 %
// (at most 380, below the name-substring band), so an app whose NAME matches always beats one
// that only matches a keyword. Punctuation-only queries match nothing. When the best hit is
// strong (>= 800), results below 25 % of it are dropped (rank.ts rankApps). Usage (Shell.AppUsage via
// AppIndex.usageScore) only breaks ties: up to 6 points, never out of the text-match tier.
//
// Public API:
//   new AppsProvider(index: AppIndex, settings: SpawnSettings, options?: {max?: number, usageOf?: UsageOf})
//        implements SearchProvider; the result cap is max-search-results unless `max` is given;
//        `usageOf(appId)` (0..1) replaces index.usageScore, e.g. to mock usage
//   Always enabled. Activation: ui/util.ts launchApp(app, settings, false), i.e. the same
//   rule as the grid (activate-on-launch: switch to a running app, else open a new window).

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {AppIndex} from '../../model/appIndex.js';
import {launchApp} from '../../ui/util.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {hasAlnum, rankApps, type UsageOf} from '../rank.js';

export interface AppsProviderOptions {
    max?: number;
    usageOf?: UsageOf;
}

export class AppsProvider implements SearchProvider {
    readonly id = 'apps';
    readonly title = 'Applications';

    private readonly _index: AppIndex;
    private readonly _settings: SpawnSettings;
    private readonly _max: number | undefined;
    private readonly _usageOf: UsageOf;

    constructor(index: AppIndex, settings: SpawnSettings, options: AppsProviderOptions = {}) {
        this._index = index;
        this._settings = settings;
        this._max = options.max;
        this._usageOf = options.usageOf ?? (id => this._index.usageScore(id));
    }

    isEnabled(): boolean {
        return true;
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim() || !hasAlnum(query))
            return [];
        if (!this._index.built)
            this._index.build();

        const ranked = rankApps(query, this._index.searchEntries(), this._max ?? maxSearchResults(this._settings), this._usageOf);
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
