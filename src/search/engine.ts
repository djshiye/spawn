// SearchEngine: runs the enabled providers for a query. STUB: signatures are final.
//
// Responsibility: debounce keystrokes (80 ms), cancel stale queries, stream results per
// provider (a slow provider never blocks a fast one), never throw into the UI.
//
// Public API:
//   new SearchEngine(scope, {debounceMs?: 80})
//   engine.addProvider(p: SearchProvider): () => void   returns remove()
//   engine.search(query: string, onBatch: (b: SearchBatch) => void): SearchHandle
//        Debounced. Every call cancels the previous handle. onBatch is called once per
//        provider as results arrive, never after cancel()/dispose.
//   engine.cancel(): void
//   engine.clear(): void                                 drop caches in providers (menu closed)
//
// SearchProvider contract (search/providers/*.ts):
//   id, title                      stable ids: 'apps' | 'windows' | 'recentFiles' | 'shell:<appId>'
//   isEnabled(): boolean           reads settings; called per query
//   search(query, token): SearchResult[] | Promise<SearchResult[]>
//        `query` is raw user text; token.cancelled turns true when superseded, providers
//        must check it between async steps.
//   clear?(): void

import type Gio from 'gi://Gio';

import type {Scope} from '../core/scope.js';

export interface CancelToken {
    readonly cancelled: boolean;
}

export interface SearchResult {
    /** Unique within its provider. */
    id: string;
    providerId: string;
    title: string;
    description?: string;
    icon?: Gio.Icon | null;
    /** Higher is better; comparable across providers only after rank.ts normalisation. */
    score: number;
    /** Perform the default action (launch app, focus window, open file). */
    activate(): void;
}

export interface SearchProvider {
    readonly id: string;
    readonly title: string;
    isEnabled(): boolean;
    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]>;
    clear?(): void;
}

export interface SearchBatch {
    providerId: string;
    providerTitle: string;
    query: string;
    results: SearchResult[];
}

export interface SearchHandle {
    cancel(): void;
}

export interface SearchEngineOptions {
    debounceMs?: number;
}

export class SearchEngine {
    private readonly _scope: Scope;
    private readonly _providers: SearchProvider[] = [];

    constructor(scope: Scope, _options: SearchEngineOptions = {}) {
        this._scope = scope;
    }

    addProvider(provider: SearchProvider): () => void {
        this._providers.push(provider);
        const remove = () => {
            const i = this._providers.indexOf(provider);
            if (i >= 0)
                this._providers.splice(i, 1);
        };
        this._scope.add(remove, `provider ${provider.id}`);
        return remove;
    }

    search(_query: string, _onBatch: (batch: SearchBatch) => void): SearchHandle {
        // TODO(search owner)
        return {cancel: () => {}};
    }

    cancel(): void {
        // TODO(search owner)
    }

    clear(): void {
        for (const p of this._providers)
            p.clear?.();
    }
}
