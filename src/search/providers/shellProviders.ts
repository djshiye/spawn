// ShellProviders: bridges GNOME's remote (D-Bus, org.gnome.Shell.SearchProvider2) search
// providers such as Calculator or Characters into SearchProviders; ids 'shell:<appId>'.
//
// The providers are created with GNOME's own loader (ui/remoteSearch.js
// loadRemoteSearchProviders), which already honours org.gnome.desktop.search-providers
// (disabled / enabled / disable-external). That module is a shell internal with no typings,
// so it is imported dynamically and everything touching it is guarded: any failure leaves
// the list empty and is logged once, never thrown. Nothing is patched or monkey-patched.
//
// Loading is lazy and asynchronous. warmUp() (menu open) starts it in an idle callback; a
// query that arrives before it finished AWAITS it (ready() returns a promise, capped at 5 s
// by the loader) instead of silently skipping the shell providers. When installed apps or the
// GNOME search settings change, the previous provider list is KEPT and used until the reload
// (started by the next ready() / warmUp()) has replaced it. A TRANSIENT failure (the loader
// timed out, threw or rejected: slow session start, bus not ready) is not cached as "ready,
// empty": the state stays idle and the load is retried by the next ready() / warmUp() after
// 30 s (or at once when installed apps / the GNOME search settings change). A missing module
// or loader (this shell has none) is permanent until such a change.
//
// Public API:
//   new ShellProviders(scope: Scope, settings: SpawnSettings)   does no work at construction
//   provider.ready(): SearchProvider[] | Promise<SearchProvider[]>
//        the bridged providers now when known (also a stale list during a reload), else a
//        promise that resolves (never rejects) once the first load finished; [] while
//        search-provider-shell is off. Wire with engine.addProviderSource(() => p.ready())
//   provider.list(): SearchProvider[]     synchronous variant: the current list ([] before the
//                                         first load finished); starts loading when idle
//   provider.warmUp(): void               start loading early (idle callback), e.g. on menu
//                                         open; no-op when search-provider-shell is off

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {error, warn} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';

const REMOTE_SEARCH_MODULE = 'resource:///org/gnome/shell/ui/remoteSearch.js';
const GNOME_SEARCH_SCHEMA = 'org.gnome.desktop.search-providers';
const LOAD_TIMEOUT_MS = 5000;
const RETRY_AFTER_FAILURE_US = 30_000_000;
const BASE_SCORE = 500;

/** Duck-typed GNOME search provider (RemoteSearchProvider2). */
interface RemoteProvider {
    id?: string;
    appInfo?: Gio.AppInfo | null;
    getInitialResultSet(terms: string[], cancellable: Gio.Cancellable | null): Promise<unknown> | unknown;
    getResultMetas(ids: string[], cancellable: Gio.Cancellable | null): Promise<unknown> | unknown;
    activateResult(id: string, terms: string[]): void;
}

interface ResultMeta {
    id: string;
    name?: string;
    description?: string;
    icon?: unknown;
    gicon?: unknown;
    createIcon?: (size: number) => unknown;
}

function isGIcon(v: unknown): v is Gio.Icon {
    return !!v && typeof (v as Gio.Icon).serialize === 'function';
}

function splitTerms(query: string): string[] {
    return query.trim().split(/\s+/).filter(t => t.length > 0);
}

class ShellProviderBridge implements SearchProvider {
    readonly id: string;
    readonly title: string;

    constructor(private readonly _remote: RemoteProvider, private readonly _settings: SpawnSettings, key: string) {
        this.id = `shell:${key}`;
        this.title = _remote.appInfo?.get_name() ?? key;
    }

    isEnabled(): boolean {
        return this._settings.get('search-provider-shell');
    }

    async search(query: string, token: CancelToken): Promise<SearchResult[]> {
        const terms = splitTerms(query);
        if (terms.length === 0)
            return [];
        try {
            const cancellable = token.cancellable ?? null;
            const initial = await this._remote.getInitialResultSet(terms, cancellable);
            if (token.cancelled || !Array.isArray(initial) || initial.length === 0)
                return [];

            const max = maxSearchResults(this._settings);
            const ids = initial.filter((i): i is string => typeof i === 'string').slice(0, max);
            if (ids.length === 0)
                return [];

            const metas = await this._remote.getResultMetas(ids, cancellable);
            if (token.cancelled || !Array.isArray(metas))
                return [];

            // Key by meta.id and keep only ids that came back; a count mismatch is normal
            // (results can vanish between the two calls) and must not throw.
            const byId = new Map<string, ResultMeta>();
            for (const meta of metas as ResultMeta[]) {
                if (meta && typeof meta.id === 'string')
                    byId.set(meta.id, meta);
            }

            const fallbackIcon = this._remote.appInfo?.get_icon() ?? null;
            const results: SearchResult[] = [];
            ids.forEach((id, i) => {
                const meta = byId.get(id);
                if (!meta)
                    return;
                const icon = isGIcon(meta.icon) ? meta.icon : isGIcon(meta.gicon) ? meta.gicon : fallbackIcon;
                results.push({
                    id,
                    providerId: this.id,
                    title: meta.name ?? id,
                    description: meta.description || undefined,
                    icon,
                    createIcon: typeof meta.createIcon === 'function' ? meta.createIcon.bind(meta) as SearchResult['createIcon'] : undefined,
                    score: Math.max(1, BASE_SCORE - i),
                    activate: () => {
                        try {
                            this._remote.activateResult(id, terms);
                        } catch (e) {
                            error(`activating ${this.id} result failed`, e);
                        }
                    },
                });
            });
            return results;
        } catch (e) {
            if (!token.cancelled)
                error(`shell search provider ${this.id} failed`, e);
            return [];
        }
    }
}

type LoadState = 'idle' | 'loading' | 'ready';

export class ShellProviders {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private _state: LoadState = 'idle';
    private _providers: SearchProvider[] = [];
    private _loading: Promise<SearchProvider[]> | null = null;
    private _invalidatedWhileLoading = false;
    private _transientFailure = false;
    private _retryNotBefore = 0;
    private _warmQueued = false;
    private _generation = 0;
    private _watching = false;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
        scope.add(() => {
            this._generation++;
            this._providers = [];
            this._loading = null;
            this._invalidatedWhileLoading = false;
            this._transientFailure = false;
            this._retryNotBefore = 0;
            this._warmQueued = false;
            this._state = 'idle';
            this._watching = false;
        }, 'shell providers');
    }

    private _isEnabled(): boolean {
        try {
            return this._settings.get('search-provider-shell');
        } catch (e) {
            error('reading search-provider-shell failed', e);
            return false;
        }
    }

    list(): SearchProvider[] {
        if (!this._isEnabled())
            return [];
        this._ensureLoading();
        return this._providers;
    }

    ready(): SearchProvider[] | Promise<SearchProvider[]> {
        if (!this._isEnabled())
            return [];
        const loading = this._ensureLoading();
        // A known list (fresh, or stale while reloading) is used at once.
        if (this._state === 'ready' || this._providers.length > 0 || !loading)
            return this._providers;
        return loading;
    }

    warmUp(): void {
        if (this._state !== 'idle' || this._warmQueued || this._inRetryWindow() || !this._isEnabled())
            return;
        this._warmQueued = true;
        this._scope.idle(() => {
            this._warmQueued = false;
            if (this._isEnabled())
                this._ensureLoading();
        });
    }

    /** Start a load when idle; returns the load in flight (or null when ready). */
    private _ensureLoading(): Promise<SearchProvider[]> | null {
        if (this._state === 'idle' && !this._inRetryWindow())
            this._startLoad();
        return this._state === 'loading' ? this._loading : null;
    }

    private _inRetryWindow(): boolean {
        return GLib.get_monotonic_time() < this._retryNotBefore;
    }

    private _startLoad(): void {
        this._state = 'loading';
        this._invalidatedWhileLoading = false;
        this._transientFailure = false;
        const generation = this._generation;
        this._watch();
        this._loading = this._load().then(
            providers => providers,
            e => {
                error('loading shell search providers failed', e);
                return [] as SearchProvider[]; // do not retry until something relevant changes
            },
        ).then(providers => {
            if (generation !== this._generation)
                return [];
            this._providers = providers;
            this._loading = null;
            if (this._transientFailure && !this._invalidatedWhileLoading) {
                this._state = 'idle';
                this._retryNotBefore = GLib.get_monotonic_time() + RETRY_AFTER_FAILURE_US;
            } else {
                this._state = this._invalidatedWhileLoading ? 'idle' : 'ready';
            }
            this._transientFailure = false;
            this._invalidatedWhileLoading = false;
            return providers;
        });
    }

    /** The list is out of date: reload on the next ready() / warmUp(), keep using the old one. */
    private _invalidate(): void {
        this._retryNotBefore = 0;
        if (this._state === 'loading')
            this._invalidatedWhileLoading = true;
        else
            this._state = 'idle';
    }

    private _watch(): void {
        if (this._watching)
            return;
        this._watching = true;
        try {
            this._scope.connect(Shell.AppSystem.get_default(), 'installed-changed', () => this._invalidate());
            const gnomeSettings = new Gio.Settings({schema_id: GNOME_SEARCH_SCHEMA});
            this._scope.connect(gnomeSettings, 'changed', () => this._invalidate());
        } catch (e) {
            warn('cannot watch shell search provider changes:', e);
        }
    }

    private async _load(): Promise<SearchProvider[]> {
        const specifier = REMOTE_SEARCH_MODULE;
        const module = await import(specifier);
        const loader = module?.loadRemoteSearchProviders;
        if (typeof loader !== 'function')
            throw new Error('loadRemoteSearchProviders is not available in this shell');

        const gnomeSettings = new Gio.Settings({schema_id: GNOME_SEARCH_SCHEMA});
        // Shell versions differ: result via callback, return value, or promise. Take the first.
        const remotes = await new Promise<unknown[]>(resolve => {
            const release = this._scope.timeout(LOAD_TIMEOUT_MS, () => {
                warn('loading shell search providers timed out');
                this._transientFailure = true;
                resolve([]);
            });
            const fail = () => {
                this._transientFailure = true;
                finish([]);
            };
            const finish = (list: unknown) => {
                release();
                resolve(Array.isArray(list) ? list : []);
            };
            try {
                const ret = loader(gnomeSettings, finish);
                if (Array.isArray(ret))
                    finish(ret);
                else if (ret && typeof ret.then === 'function')
                    ret.then(finish, fail);
            } catch (e) {
                error('loadRemoteSearchProviders threw', e);
                fail();
            }
        });

        const bridged: SearchProvider[] = [];
        const seen = new Set<string>();
        for (const remote of remotes as RemoteProvider[]) {
            try {
                if (typeof remote?.getInitialResultSet !== 'function' || typeof remote.getResultMetas !== 'function')
                    continue;
                const key = (remote.appInfo?.get_id() ?? remote.id ?? '').replace(/\.desktop$/, '');
                if (!key || seen.has(key))
                    continue;
                seen.add(key);
                bridged.push(new ShellProviderBridge(remote, this._settings, key));
            } catch (e) {
                error('skipping shell search provider', e);
            }
        }
        return bridged;
    }
}
