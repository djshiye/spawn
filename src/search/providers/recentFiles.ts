// RecentFilesProvider. STUB: signatures are final, body is inert.
//
// Searches Gtk.RecentManager items. The list is cached and refreshed on the manager's 'changed' signal (debounced), never read per keystroke; id 'recentFiles'; enabled by search-provider-recent-files, honours show-hidden-recent-files.
//
// Public API:
//   new RecentFilesProvider(scope: Scope, settings: SpawnSettings)  implements SearchProvider  (see search/engine.ts)

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';

export class RecentFilesProvider implements SearchProvider {
    readonly id = 'recentFiles';
    readonly title = 'Recent Files';

    constructor(_scope: Scope, _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return false;
    }

    search(_query: string, _token: CancelToken): SearchResult[] {
        return [];
    }
}
