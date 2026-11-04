// WindowsProvider. STUB: signatures are final, body is inert.
//
// Searches open windows (global.get_window_actors / Shell.WindowTracker); id 'windows'; enabled by setting search-provider-open-windows. activate() focuses the window.
//
// Public API:
//   new WindowsProvider(settings: SpawnSettings)  implements SearchProvider  (see search/engine.ts)

import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';

export class WindowsProvider implements SearchProvider {
    readonly id = 'windows';
    readonly title = 'Open Windows';

    constructor(_settings: SpawnSettings) {}

    isEnabled(): boolean {
        return false;
    }

    search(_query: string, _token: CancelToken): SearchResult[] {
        return [];
    }
}
