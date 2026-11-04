// ShellProviders: bridges GNOME's remote (D-Bus, org.gnome.Shell.SearchProvider2) search
// providers such as Calculator or Characters into SearchProviders; ids 'shell:<appId>'.
//
// The providers are created with GNOME's own loader (ui/remoteSearch.js
// loadRemoteSearchProviders), which already honours org.gnome.desktop.search-providers
// (disabled / enabled / disable-external). That module is a shell internal with no typings,
// so it is imported dynamically and everything touching it is guarded: any failure leaves
// the list empty and is logged once, never thrown. Nothing is patched or monkey-patched.
//
// Loading is lazy and asynchronous: the first list() call while search-provider-shell is on
// starts it and returns []; later calls return the bridged providers. The list is dropped
// (and reloaded on the next list()) when installed apps or the GNOME search settings change.
//
// Public API:
//   new ShellProviders(scope: Scope, settings: SpawnSettings)   does no work at construction
//   provider.list(): SearchProvider[]     current bridged providers (re-read per query);
//                                         wire with engine.addProviderSource(() => p.list())
//   provider.warmUp(): void               (addition) start loading early, e.g. on menu open

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {error, warn} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';

const REMOTE_SEARCH_MODULE = 'resource:///org/gnome/shell/ui/remoteSearch.js';
const GNOME_SEARCH_SCHEMA = 'org.gnome.desktop.search-providers';
const LOAD_TIMEOUT_MS = 5000;
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

            const max = this._settings.get('max-search-results');
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
                    createIcon: typeof meta.createIcon === 'function' ? meta.createIcon.bind(meta) : undefined,
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
    private _generation = 0;
    private _watching = false;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
        scope.add(() => {
            this._generation++;
            this._providers = [];
            this._state = 'idle';
            this._watching = false;
        }, 'shell providers');
    }

    list(): SearchProvider[] {
        let enabled = false;
        try {
            enabled = this._settings.get('search-provider-shell');
        } catch (e) {
            error('reading search-provider-shell failed', e);
        }
        if (!enabled)
            return [];
        this.warmUp();
        return this._state === 'ready' ? this._providers : [];
    }

    warmUp(): void {
        if (this._state !== 'idle')
            return;
        this._state = 'loading';
        const generation = this._generation;
        this._watch();
        this._load().then(providers => {
            if (generation !== this._generation)
                return;
            this._providers = providers;
            this._state = 'ready';
        }, e => {
            if (generation !== this._generation)
                return;
            error('loading shell search providers failed', e);
            this._providers = [];
            this._state = 'ready'; // do not retry until something relevant changes
        });
    }

    /** Drop the list so the next list() reloads it. */
    private _invalidate(): void {
        this._generation++;
        this._providers = [];
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
                resolve([]);
            });
            const finish = (list: unknown) => {
                release();
                resolve(Array.isArray(list) ? list : []);
            };
            try {
                const ret = loader(gnomeSettings, finish);
                if (Array.isArray(ret))
                    finish(ret);
                else if (ret && typeof ret.then === 'function')
                    ret.then(finish, () => finish([]));
            } catch (e) {
                error('loadRemoteSearchProviders threw', e);
                finish([]);
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
