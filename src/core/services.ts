// Services: the shared, lazily created objects that the UI and input layers use.
//
// Responsibility: ONE place that owns construction order and lifetime. Everything heavy
// (AppIndex, PinnedStore, SearchEngine) is created on first access, inside a child scope
// of the root scope, so nothing costs anything at enable time and disable() disposes it.
//
// Public API:
//   new Services(scope, settings, info)
//   services.scope / .settings / .info
//   services.appIndex     AppIndex (lazy)
//   services.pinned       PinnedStore (lazy)
//   services.search       SearchEngine (lazy; apps/windows/recent/shell providers registered here)
//   services.warmUp()     (call from layout onOpen) create the search engine and start loading the
//                         GNOME shell search providers in the background, so the first query of
//                         the session already includes them. Cheap, idempotent, never throws.
//   ExtensionInfo         {uuid, path, iconDir}

import {AppIndex} from '../model/appIndex.js';
import {PinnedStore} from '../model/pinned.js';
import {SearchEngine} from '../search/engine.js';
import {AppsProvider} from '../search/providers/apps.js';
import {RecentFilesProvider} from '../search/providers/recentFiles.js';
import {ShellProviders} from '../search/providers/shellProviders.js';
import {WindowsProvider} from '../search/providers/windows.js';
import {error} from './log.js';
import type {Scope} from './scope.js';
import type {SpawnSettings} from './settings.js';

export interface ExtensionInfo {
    uuid: string;
    /** Extension directory (build output when running from the dev shell). */
    path: string;
    /** `${path}/data/icons` */
    iconDir: string;
}

export class Services {
    readonly scope: Scope;
    readonly settings: SpawnSettings;
    readonly info: ExtensionInfo;

    private _appIndex: AppIndex | null = null;
    private _pinned: PinnedStore | null = null;
    private _search: SearchEngine | null = null;
    private _shell: ShellProviders | null = null;

    constructor(scope: Scope, settings: SpawnSettings, info: ExtensionInfo) {
        this.scope = scope;
        this.settings = settings;
        this.info = info;
    }

    get appIndex(): AppIndex {
        this._appIndex ??= new AppIndex(this.scope.child('appIndex'));
        return this._appIndex;
    }

    get pinned(): PinnedStore {
        this._pinned ??= new PinnedStore(this.scope.child('pinned'), this.settings);
        return this._pinned;
    }

    get search(): SearchEngine {
        if (!this._search) {
            const scope = this.scope.child('search');
            const engine = new SearchEngine(scope);
            engine.addProvider(new AppsProvider(this.appIndex, this.settings));
            engine.addProvider(new WindowsProvider(this.settings));
            engine.addProvider(new RecentFilesProvider(scope, this.settings));
            const shell = new ShellProviders(scope, this.settings);
            engine.addProviderSource(() => shell.ready());
            this._shell = shell;
            this._search = engine;
        }
        return this._search;
    }

    warmUp(): void {
        try {
            void this.search;
            this._shell?.warmUp();
        } catch (e) {
            error('warming up search failed', e);
        }
    }
}
