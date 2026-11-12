// Services: the shared, lazily created objects that the UI and input layers use.
//
// Responsibility: ONE place that owns construction order and lifetime. Everything heavy
// (AppIndex, PinnedStore, SearchEngine) is created on first access, inside a child scope
// of the root scope, so nothing costs anything at enable time and disable() disposes it.
//
// Public API:
//   new Services(scope, settings, info)
//   services.scope / .settings / .info
//   services.appIndex     AppIndex (lazy); follows hidden-apps / search-hidden-apps and feeds services.newApps
//   services.newApps      NewAppsStore (lazy): the "New" badge state (known-apps / new-apps)
//   services.pinned       PinnedStore (lazy)
//   services.search       SearchEngine (lazy; calculator, conversion, app actions, apps, Settings panels, windows,
//                         recent files and GNOME shell providers registered here, in this section order)
//   services.recentFiles  the RecentFilesProvider registered in services.search (also feeds the Recent Files view)
//   services.warmUp()     (call from layout onOpen) create the search engine and start loading the
//                         GNOME shell search providers in the background, so the first query of
//                         the session already includes them. Cheap, idempotent, never throws.
//   ExtensionInfo         {uuid, path, iconDir}

import Shell from 'gi://Shell';

import {AppIndex} from '../model/appIndex.js';
import {NewAppsStore} from '../model/newAppsStore.js';
import {PinnedStore} from '../model/pinned.js';
import {SearchEngine} from '../search/engine.js';
import {AppActionsProvider} from '../search/providers/appActions.js';
import {AppsProvider} from '../search/providers/apps.js';
import {CalculatorProvider, UnitConversionProvider} from '../search/providers/calculator.js';
import {RecentFilesProvider} from '../search/providers/recentFiles.js';
import {PowerActionsProvider} from '../search/providers/power.js';
import {SettingsPanelsProvider} from '../search/providers/settingsPanels.js';
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
    private _newApps: NewAppsStore | null = null;
    private _pinned: PinnedStore | null = null;
    private _search: SearchEngine | null = null;
    private _shell: ShellProviders | null = null;
    private _recent: RecentFilesProvider | null = null;

    constructor(scope: Scope, settings: SpawnSettings, info: ExtensionInfo) {
        this.scope = scope;
        this.settings = settings;
        this.info = info;
    }

    get appIndex(): AppIndex {
        if (!this._appIndex) {
            const scope = this.scope.child('appIndex');
            const index = new AppIndex(scope);
            const applyHidden = (): void => index.setHidden(this.settings.get('hidden-apps'), this.settings.get('search-hidden-apps'));
            applyHidden();
            this.settings.onChanged(scope, ['hidden-apps', 'search-hidden-apps'], applyHidden);
            // Installed since the last look? The store only writes when something changed.
            index.setAppsObserver(ids => this.newApps.sync(ids));
            this._appIndex = index;
        }
        return this._appIndex;
    }

    get newApps(): NewAppsStore {
        if (!this._newApps) {
            const scope = this.scope.child('newApps');
            const store = new NewAppsStore(scope, this.settings);
            // Any launch, from the menu or from elsewhere: the app is no longer new.
            try {
                scope.connect(Shell.AppSystem.get_default(), 'app-state-changed', (_s: Shell.AppSystem, app: Shell.App) => {
                    const id = app.get_id();
                    if (id && (app.state === Shell.AppState.STARTING || app.state === Shell.AppState.RUNNING))
                        store.markLaunched(id);
                });
            } catch (e) {
                error('cannot watch app launches', e);
            }
            this._newApps = store;
        }
        return this._newApps;
    }

    get pinned(): PinnedStore {
        this._pinned ??= new PinnedStore(this.scope.child('pinned'), this.settings);
        return this._pinned;
    }

    get search(): SearchEngine {
        if (!this._search) {
            const scope = this.scope.child('search');
            const engine = new SearchEngine(scope);
            // Section order (SearchBatch.order): answers first, then the actions of an app, then the apps.
            engine.addProvider(new CalculatorProvider(this.settings));
            engine.addProvider(new UnitConversionProvider(this.settings));
            engine.addProvider(new AppActionsProvider(this.appIndex, this.settings));
            engine.addProvider(new AppsProvider(this.appIndex, this.settings));
            engine.addProvider(new SettingsPanelsProvider(this.settings));
            engine.addProvider(new PowerActionsProvider(scope, this.settings));
            engine.addProvider(new WindowsProvider(this.settings));
            this._recent = new RecentFilesProvider(scope, this.settings);
            engine.addProvider(this._recent);
            const shell = new ShellProviders(scope, this.settings);
            engine.addProviderSource(() => shell.ready());
            this._shell = shell;
            this._search = engine;
        }
        return this._search;
    }

    get recentFiles(): RecentFilesProvider {
        void this.search;
        return this._recent as RecentFilesProvider;
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
