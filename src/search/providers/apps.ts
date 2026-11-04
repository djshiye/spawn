// AppsProvider. STUB: signatures are final, body is inert.
//
// Searches AppIndex.searchEntries() with rank.ts; id 'apps'.
//
// Public API:
//   new AppsProvider(index: AppIndex)  implements SearchProvider  (see search/engine.ts)

import type {AppIndex} from '../../model/appIndex.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';

export class AppsProvider implements SearchProvider {
    readonly id = 'apps';
    readonly title = 'Applications';

    constructor(_index: AppIndex) {}

    isEnabled(): boolean {
        return false;
    }

    search(_query: string, _token: CancelToken): SearchResult[] {
        return [];
    }
}
