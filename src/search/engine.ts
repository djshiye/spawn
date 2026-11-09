// SearchEngine: runs the enabled providers for a query.
//
// Responsibility: debounce keystrokes (80 ms) for the providers that do I/O, run the in-memory ones
// (`immediate`) on every keystroke, cancel stale queries, stream results per provider (a slow
// provider never blocks a fast one), never throw into the UI.
//
// Public API:
//   new SearchEngine(scope, {debounceMs?: 80})     does no work at construction
//   engine.addProvider(p: SearchProvider): () => void   returns remove()
//   engine.addProviderSource(fn: () => SearchProvider[] | PromiseLike<SearchProvider[]>): () => void
//        (addition) a dynamic list re-read on every query, e.g. `() => shellProviders.ready()`.
//        A source may return a promise (providers still loading): the query then waits for
//        it WITHOUT blocking the other providers and runs those providers when it resolves
//        (a rejection is logged and skipped). enabledProviders()/clear() only see the
//        synchronous results of sources.
//   engine.search(query: string, onBatch: (b: SearchBatch) => void, options?): SearchHandle
//        Providers with `immediate: true` run synchronously inside this call (their batches are
//        delivered before it returns); the others are debounced (trailing, restarted by every
//        call). Every call cancels the previous
//        handle. onBatch is called at most once per provider, as soon as that provider
//        finishes (synchronous providers deliver in registration order, async ones whenever
//        they resolve), never after cancel()/dispose. An empty / whitespace-only query
//        cancels everything pending, runs no provider, delivers NO batch (the UI shows its
//        own empty state) and returns a no-op handle. Provider exceptions / rejections are
//        logged and skipped; they never affect other providers or the caller.
//        (addition) `{immediate: true}` skips the debounce and runs the providers synchronously
//        (benchmarks / dev hooks).
//        (addition) SearchBatch.order is the provider's position in registration order
//        (providers, then sources, as registered); sort sections by it, not by arrival.
//        (addition) SearchHandle.pending is true while the debounce timer has not fired yet (false
//        when every enabled provider is immediate); handle.flush() runs the still-debounced
//        providers NOW (synchronous providers deliver before flush() returns). Used by Return
//        pressed within the debounce window.
//   engine.enabledProviders(): SearchProvider[]          (addition) providers a query would run now
//   engine.cancel(): void
//   engine.clear(): void                                 drop caches in providers (menu closed)
//
// SearchProvider contract (search/providers/*.ts):
//   id, title                      stable ids: 'apps' | 'windows' | 'recentFiles' | 'shell:<appId>'
//   isEnabled(): boolean           reads settings; called per query
//   immediate?: boolean            (addition) in memory, synchronous and cheap (apps, open windows):
//                                  runs on every keystroke, without the debounce. Only for providers
//                                  added with addProvider(); a provider source is always debounced
//   search(query, token): SearchResult[] | Promise<SearchResult[]>
//        `query` is raw user text; token.cancelled turns true when superseded, providers
//        must check it between async steps. token.cancellable (addition) is a Gio.Cancellable
//        cancelled at the same moment, to pass to D-Bus / async Gio calls.
//   clear?(): void

import type Clutter from 'gi://Clutter';
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
    /** Optional richer icon factory (GNOME remote providers); returns an actor (St.Icon) or null. */
    createIcon?: (size: number) => Clutter.Actor | null | undefined;
    /** Show `description` even when show-search-result-details is off (e.g. the folder of a file). */
    alwaysShowDescription?: boolean;
    /** Higher is better; comparable across providers only after rank.ts normalisation. */
    score: number;
    /** Perform the default action (launch app, focus window, open file). */
    activate(): void;
}

export interface SearchProvider {
    readonly id: string;
    readonly title: string;
    /** Runs on every keystroke, without the debounce (in memory, synchronous, cheap). */
    readonly immediate?: boolean;
    isEnabled(): boolean;
    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]>;
    clear?(): void;
}

export interface SearchBatch {
    providerId: string;
    providerTitle: string;
    query: string;
    results: SearchResult[];
    /** Sort key: provider registration order (lower first). Stable across queries. */
    order: number;
}

export interface SearchHandle {
    cancel(): void;
    /** True until the debounce timer has fired (or the query was cancelled / flushed). */
    readonly pending: boolean;
    /** Run the query now if it is still waiting for the debounce; otherwise a no-op. */
    flush(): void;
}

export type ProviderSource = () => SearchProvider[] | PromiseLike<SearchProvider[]>;

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
    /** Runs the query; set only while the debounce is pending. */
    start: (() => void) | null;
}

const NOOP_HANDLE: SearchHandle = {cancel: () => {}, pending: false, flush: () => {}};

/** Providers of different slots never collide: slot * ORDER_SLOT + index inside a source. */
const ORDER_SLOT = 1000;

function isThenable<T>(v: unknown): v is PromiseLike<T> {
    return typeof (v as PromiseLike<unknown> | null)?.then === 'function';
}

export class SearchEngine {
    private readonly _scope: Scope;
    private readonly _debounceMs: number;
    private readonly _providers: SearchProvider[] = [];
    private readonly _sources: ProviderSource[] = [];
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

    addProviderSource(source: ProviderSource): () => void {
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
        const active: ActiveQuery = {token, cancelTimer: null, start: null};
        this._active = active;
        const handle: SearchHandle = {
            cancel: () => this._cancelQuery(active),
            get pending() {
                return active.start !== null;
            },
            flush: () => {
                const start = active.start;
                if (!start)
                    return;
                const cancelTimer = active.cancelTimer;
                active.cancelTimer = null;
                cancelTimer?.();
                start();
            },
        };
        if (options.immediate) {
            this._run(query, token, onBatch, 'all');
            return handle;
        }
        // The in-memory providers answer this keystroke now; the rest wait for the typing to pause.
        this._run(query, token, onBatch, 'immediate');
        if (token.cancelled || !this._hasDeferred())
            return handle;
        const start = () => {
            active.start = null;
            if (!token.cancelled)
                this._run(query, token, onBatch, 'deferred');
        };
        active.start = start;
        active.cancelTimer = this._scope.timeout(this._debounceMs, () => {
            active.cancelTimer = null;
            start();
        });
        return handle;
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
        active.start = null;
        cancelTimer?.();
        active.token.cancel();
    }

    /** A provider source, or an enabled provider that is not immediate: something for the debounced run. */
    private _hasDeferred(): boolean {
        if (this._sources.length > 0)
            return true;
        return this._providers.some(p => {
            try {
                return !p.immediate && p.isEnabled();
            } catch {
                return false;
            }
        });
    }

    private _allProviders(): SearchProvider[] {
        const all = [...this._providers];
        for (const source of this._sources) {
            try {
                const list = source();
                if (Array.isArray(list))
                    all.push(...list);
            } catch (e) {
                error('provider source failed', e);
            }
        }
        return all;
    }

    /** `which`: 'immediate' = the immediate providers only, 'deferred' = everything else, 'all' = both. */
    private _run(query: string, token: QueryToken, onBatch: (batch: SearchBatch) => void, which: 'immediate' | 'deferred' | 'all'): void {
        const runOne = (provider: SearchProvider, order: number) => {
            const deliver = (results: unknown) => {
                if (token.cancelled || !Array.isArray(results))
                    return;
                try {
                    onBatch({providerId: provider.id, providerTitle: provider.title, query, results: results as SearchResult[], order});
                } catch (e) {
                    error(`search batch handler failed for ${provider.id}`, e);
                }
            };
            try {
                if (!provider.isEnabled())
                    return;
                const out = provider.search(query, token);
                if (isThenable<SearchResult[]>(out)) {
                    out.then(deliver, e => {
                        if (!token.cancelled)
                            error(`search provider ${provider.id} failed`, e);
                    });
                } else {
                    deliver(out);
                }
            } catch (e) {
                error(`search provider ${provider.id} failed`, e);
            }
        };

        let slot = 0;
        for (const provider of [...this._providers]) {
            if (token.cancelled)
                return;
            const order = slot++ * ORDER_SLOT;
            if (which === 'all' || (which === 'immediate') === Boolean(provider.immediate))
                runOne(provider, order);
        }
        if (which === 'immediate')
            return;
        for (const source of [...this._sources]) {
            if (token.cancelled)
                return;
            const base = slot++ * ORDER_SLOT;
            let list: SearchProvider[] | PromiseLike<SearchProvider[]>;
            try {
                list = source();
            } catch (e) {
                error('provider source failed', e);
                continue;
            }
            if (isThenable<SearchProvider[]>(list)) {
                list.then(providers => {
                    if (token.cancelled || !Array.isArray(providers))
                        return;
                    providers.forEach((p, i) => runOne(p, base + i));
                }, e => {
                    if (!token.cancelled)
                        error('provider source failed', e);
                });
            } else if (Array.isArray(list)) {
                for (let i = 0; i < list.length; i++) {
                    if (token.cancelled)
                        return;
                    runOne(list[i], base + i);
                }
            }
        }
    }
}
