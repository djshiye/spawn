// SearchEngine: runs the enabled providers for a query.
//
// Responsibility: debounce keystrokes (80 ms), cancel stale queries, stream results per
// provider (a slow provider never blocks a fast one), never throw into the UI.
//
// Public API:
//   new SearchEngine(scope, {debounceMs?: 80})     does no work at construction
//   engine.addProvider(p: SearchProvider): () => void   returns remove()
//   engine.addProviderSource(fn: () => SearchProvider[]): () => void
//        (addition) a dynamic list re-read on every query, e.g. `() => shellProviders.list()`.
//   engine.search(query: string, onBatch: (b: SearchBatch) => void): SearchHandle
//        Debounced (trailing, restarted by every call). Every call cancels the previous
//        handle. onBatch is called at most once per provider, as soon as that provider
//        finishes (synchronous providers deliver in registration order, async ones whenever
//        they resolve), never after cancel()/dispose. An empty / whitespace-only query
//        cancels everything pending, runs no provider, delivers NO batch (the UI shows its
//        own empty state) and returns a no-op handle. Provider exceptions / rejections are
//        logged and skipped; they never affect other providers or the caller.
//        (addition) `{immediate: true}` skips the debounce and runs the providers synchronously
//        (benchmarks / dev hooks only).
//   engine.enabledProviders(): SearchProvider[]          (addition) providers a query would run now
//   engine.cancel(): void
//   engine.clear(): void                                 drop caches in providers (menu closed)
//
// SearchProvider contract (search/providers/*.ts):
//   id, title                      stable ids: 'apps' | 'windows' | 'recentFiles' | 'shell:<appId>'
//   isEnabled(): boolean           reads settings; called per query
//   search(query, token): SearchResult[] | Promise<SearchResult[]>
//        `query` is raw user text; token.cancelled turns true when superseded, providers
//        must check it between async steps. token.cancellable (addition) is a Gio.Cancellable
//        cancelled at the same moment, to pass to D-Bus / async Gio calls.
//   clear?(): void

import Gio from 'gi://Gio';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';

export interface CancelToken {
    readonly cancelled: boolean;
    /** Cancelled together with the token; pass it to async Gio / D-Bus calls. */
    readonly cancellable?: Gio.Cancellable;
}

export interface SearchResult {
    /** Unique within its provider. */
    id: string;
    providerId: string;
    title: string;
    description?: string;
    icon?: Gio.Icon | null;
    /** Optional richer icon factory (GNOME remote providers); the UI may prefer `icon`. */
    createIcon?: (size: number) => unknown;
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

class QueryToken implements CancelToken {
    readonly cancellable = new Gio.Cancellable();
    private _cancelled = false;

    get cancelled(): boolean {
        return this._cancelled;
    }

    cancel(): void {
        if (this._cancelled)
            return;
        this._cancelled = true;
        try {
            this.cancellable.cancel();
        } catch (e) {
            error('cancelling query failed', e);
        }
    }
}

interface ActiveQuery {
    token: QueryToken;
    cancelTimer: (() => void) | null;
}

const NOOP_HANDLE: SearchHandle = {cancel: () => {}};

function isThenable(v: unknown): v is PromiseLike<SearchResult[]> {
    return typeof (v as PromiseLike<unknown> | null)?.then === 'function';
}

export class SearchEngine {
    private readonly _scope: Scope;
    private readonly _debounceMs: number;
    private readonly _providers: SearchProvider[] = [];
    private readonly _sources: Array<() => SearchProvider[]> = [];
    private _active: ActiveQuery | null = null;

    constructor(scope: Scope, options: SearchEngineOptions = {}) {
        this._scope = scope;
        this._debounceMs = options.debounceMs ?? 80;
        scope.add(() => this.cancel(), 'search engine cancel');
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

    addProviderSource(source: () => SearchProvider[]): () => void {
        this._sources.push(source);
        const remove = () => {
            const i = this._sources.indexOf(source);
            if (i >= 0)
                this._sources.splice(i, 1);
        };
        this._scope.add(remove, 'provider source');
        return remove;
    }

    search(query: string, onBatch: (batch: SearchBatch) => void, options: {immediate?: boolean} = {}): SearchHandle {
        this.cancel();
        if (!query.trim())
            return NOOP_HANDLE;

        const token = new QueryToken();
        const active: ActiveQuery = {token, cancelTimer: null};
        this._active = active;
        if (options.immediate) {
            this._run(query, token, onBatch);
            return {cancel: () => this._cancelQuery(active)};
        }
        active.cancelTimer = this._scope.timeout(this._debounceMs, () => {
            active.cancelTimer = null;
            if (!token.cancelled)
                this._run(query, token, onBatch);
        });
        return {cancel: () => this._cancelQuery(active)};
    }

    cancel(): void {
        const active = this._active;
        if (active)
            this._cancelQuery(active);
    }

    enabledProviders(): SearchProvider[] {
        return this._allProviders().filter(p => {
            try {
                return p.isEnabled();
            } catch {
                return false;
            }
        });
    }

    clear(): void {
        for (const p of this._allProviders()) {
            try {
                p.clear?.();
            } catch (e) {
                error(`provider ${p.id} clear() failed`, e);
            }
        }
    }

    private _cancelQuery(active: ActiveQuery): void {
        if (this._active === active)
            this._active = null;
        const cancelTimer = active.cancelTimer;
        active.cancelTimer = null;
        cancelTimer?.();
        active.token.cancel();
    }

    private _allProviders(): SearchProvider[] {
        const all = [...this._providers];
        for (const source of this._sources) {
            try {
                all.push(...source());
            } catch (e) {
                error('provider source failed', e);
            }
        }
        return all;
    }

    private _run(query: string, token: QueryToken, onBatch: (batch: SearchBatch) => void): void {
        const deliver = (provider: SearchProvider, results: unknown) => {
            if (token.cancelled || !Array.isArray(results))
                return;
            try {
                onBatch({providerId: provider.id, providerTitle: provider.title, query, results: results as SearchResult[]});
            } catch (e) {
                error(`search batch handler failed for ${provider.id}`, e);
            }
        };

        for (const provider of this._allProviders()) {
            if (token.cancelled)
                return;
            try {
                if (!provider.isEnabled())
                    continue;
                const out = provider.search(query, token);
                if (isThenable(out)) {
                    out.then(results => deliver(provider, results), e => {
                        if (!token.cancelled)
                            error(`search provider ${provider.id} failed`, e);
                    });
                } else {
                    deliver(provider, out);
                }
            } catch (e) {
                error(`search provider ${provider.id} failed`, e);
            }
        }
    }
}
