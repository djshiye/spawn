// ShellProviders. STUB: signatures are final, body is inert.
//
// Bridges GNOME Shell search providers (Main.overview.searchController providers, read-only, no prototype patching); ids 'shell:<appId>'; enabled by search-provider-shell. Returns one SearchProvider per registered shell provider via list().
//
// Public API:
//   new ShellProviders(scope: Scope, settings: SpawnSettings)
//   provider.list(): SearchProvider[]     current bridged providers (re-read per query)

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchProvider} from '../engine.js';

export class ShellProviders {
    constructor(_scope: Scope, _settings: SpawnSettings) {}

    list(): SearchProvider[] {
        return [];
    }
}
