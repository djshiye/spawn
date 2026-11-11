// AppIndex: the application catalogue.
//
// Responsibility: wrap Shell.AppSystem + the GMenu tree (categories) + Shell.AppUsage
// (frequent). Built ONCE lazily (`build()` on first menu open or on idle after
// startup-complete; every accessor also builds on demand) and rebuilt, debounced 500 ms,
// on Shell.AppSystem 'installed-changed' and GMenu tree 'changed'. No UI imports, and no
// per-app signal handlers: all state is plain arrays/maps replaced wholesale on rebuild.
//
// Public API (do not change without telling the other module owners):
//   new AppIndex(scope)
//   index.built: boolean
//   index.build(): void                     idempotent; connects change signals into `scope`
//   index.apps(): Shell.App[]               all visible apps, sorted by display name
//   index.get(id: string): Shell.App | null lookup by desktop id ("org.gnome.Nautilus.desktop")
//   index.categories(): AppCategory[]       ordered; apps inside are sorted by name
//   index.frequent(limit: number): Shell.App[]
//   index.favorites(): Shell.App[]          GNOME Shell's favourites (dash), in order (read live; the "Favorites" quick link)
//   index.setFrequentOverride(ids: string[] | null)   dev hook (Ui.SetFrequent): these apps ARE the most used; null = real usage
//   index.usageScore(id: string): number  0..1 from Shell.AppUsage's ordering (1 = most used, 0 =
//                                           unknown / usage tracking off); the ordering is re-read
//                                           from get_most_used() at most every USAGE_TTL_MS
//   index.searchEntries(): AppSearchEntry[] normalised keys for search/providers/apps; built on an idle
//                                           after every (re)build, or on demand by the first search
//   index.onChanged(scope, cb)              cb() after any incremental update (also when the hidden set changes)
//   index.setHidden(ids: Iterable<string>, searchFinds: boolean)   apps the user hid (settings `hidden-apps` /
//                                           `search-hidden-apps`, wired by Services). apps(), categories(),
//                                           categoryApps() and frequent() leave them out; searchEntries() does
//                                           too unless searchFinds. get(id) still returns them (a pinned app
//                                           stays pinned). A category left empty disappears.
//   index.installedIds(): string[]          ids of EVERY visible app, hidden ones included
//   index.setAppsObserver(cb)               cb(installedIds) after every (re)build, before onChanged listeners;
//                                           used for the "New" bookkeeping (model/newAppsStore.ts)
//
// Notes:
//   * categories() holds only the real GMenu top-level categories (sub-directories are
//     flattened into their parent, NoDisplay directories are skipped) plus a synthetic
//     "Other" category for visible apps that the menu tree does not list. The special
//     views "all" and "frequent" are NOT in that list; use apps() / frequent(), or
//     categoryApps(id, limit) which understands 'all' and 'frequent' as well.
//   * frequent() is read live from Shell.AppUsage (cheap); limit <= 0 means unlimited.
//   * A rebuild after a change signal skips apps whose desktop file no longer exists. After a file
//     is deleted the GMenu tree reloads first, while Shell.AppSystem's list (GIO's desktop-file
//     cache) lags a few seconds behind and would keep listing the removed app until its own change
//     signal. The first build skips that check (one stat per app, ~7 ms for 300 apps).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GMenu from 'gi://GMenu';
import Shell from 'gi://Shell';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {debounce} from '../core/debounce.js';
import {warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import {appInfoOf, newShellApp} from './appInfo.js';
import {prepareApps} from '../search/rank.js';
import {appKeys, descriptionKey} from './appKeys.js';
import {filterCategories, filterHidden} from './hiddenApps.js';

export interface AppCategory {
    /** GMenu directory id, e.g. "Utilities"; special ids: "all", "frequent". */
    id: string;
    name: string;
    iconName: string;
    apps: Shell.App[];
}

export interface AppSearchEntry {
    app: Shell.App;
    id: string;
    name: string;
    /** Lower-cased, diacritics-folded, deduplicated strings to match against. */
    keys: string[];
    /** Normalised Comment= text; scored word by word at low weight (rank.ts scoreDescription). */
    description: string;
}

const REBUILD_DELAY_MS = 500;
const OTHER_ID = 'Other';
/** get_most_used() sorts every tracked app: re-read it at most this often while searching. */
const USAGE_TTL_MS = 5000;

export class AppIndex {
    private readonly _scope: Scope;
    private _built = false;
    private _appSystem: Shell.AppSystem | null = null;
    private _usage: Shell.AppUsage | null = null;
    private _frequentOverride: string[] | null = null;
    private _tree: GMenu.Tree | null = null;
    private readonly _collator = new Intl.Collator();

    /** Every visible app, hidden ones included; the public lists below are these minus the hidden set. */
    private _allApps: Shell.App[] = [];
    private _allCategories: AppCategory[] = [];
    private _apps: Shell.App[] = [];
    private _byId = new Map<string, Shell.App>();
    private _categories: AppCategory[] = [];
    private _hidden: ReadonlySet<string> = new Set();
    private _searchFindsHidden = true;
    private _observer: ((ids: string[]) => void) | null = null;
    /** Built lazily (searchEntries(), or an idle after each rebuild): ~6 desktop-file reads per app. */
    private _allEntries: AppSearchEntry[] | null = null;
    private _entries: AppSearchEntry[] | null = null;
    private _cancelEntriesIdle: (() => void) | null = null;
    private readonly _listeners = new Set<() => void>();
    private _usageScores: Map<string, number> | null = null;
    private _usageStamp = 0;

    constructor(scope: Scope) {
        this._scope = scope;
    }

    get built(): boolean {
        return this._built;
    }

    build(): void {
        if (this._built)
            return;
        this._built = true;

        try {
            this._appSystem = Shell.AppSystem.get_default();
            this._usage = Shell.AppUsage.get_default();
        } catch (e) {
            warn(`AppIndex: Shell app services unavailable: ${e}`);
            return;
        }

        const rebuild = debounce(this._scope, REBUILD_DELAY_MS, () => this._rebuildAndNotify());
        this._scope.connect(this._appSystem, 'installed-changed', () => rebuild.call());

        try {
            this._tree = new GMenu.Tree({menu_basename: 'applications.menu'});
            this._scope.connect(this._tree, 'changed', () => rebuild.call());
        } catch (e) {
            warn(`AppIndex: cannot create GMenu tree: ${e}`);
            this._tree = null;
        }

        // Drop references on dispose; the index stays usable (empty) and can be re-built.
        this._scope.add(() => {
            this._listeners.clear();
            this._cancelEntriesIdle = null; // the scope cancels its own idle sources
            this._allEntries = null;
            this._entries = null;
            this._observer = null;
            this._tree = null;
            this._appSystem = null;
            this._usage = null;
            this._usageScores = null;
            this._built = false;
        }, 'appIndex state');

        this._rebuild();
    }

    apps(): Shell.App[] {
        this.build();
        return this._apps;
    }

    get(id: string): Shell.App | null {
        this.build();
        return this._byId.get(id) ?? this._lookupLive(id);
    }

    categories(): AppCategory[] {
        this.build();
        return this._categories;
    }

    /** Dev hook: a sandboxed shell has no usage history, so the Frequent lists could not be tested. */
    setFrequentOverride(ids: string[] | null): void {
        this._frequentOverride = ids;
    }

    frequent(limit: number): Shell.App[] {
        this.build();
        let used: Shell.App[] = [];
        try {
            used = this._frequentOverride
                ? this._frequentOverride.map(id => this.get(id)).filter((a): a is Shell.App => a !== null)
                : this._usage?.get_most_used() ?? [];
        } catch (e) {
            warn(`AppIndex: get_most_used failed: ${e}`);
        }
        const out: Shell.App[] = [];
        for (const app of used) {
            if (!appInfoOf(app)?.should_show() || this._hidden.has(app.get_id() ?? ''))
                continue;
            out.push(app);
            if (limit > 0 && out.length >= limit)
                break;
        }
        return out;
    }

    /** GNOME Shell's own favourites (the dash; org.gnome.shell favorite-apps), in order, installed apps only. */
    favorites(): Shell.App[] {
        this.build();
        let ids: string[] = [];
        try {
            const source = Gio.SettingsSchemaSource.get_default();
            if (source?.lookup('org.gnome.shell', true))
                ids = new Gio.Settings({schema_id: 'org.gnome.shell'}).get_strv('favorite-apps');
        } catch (e) {
            warn(`AppIndex: cannot read the GNOME favourites: ${e}`);
        }
        return ids.map(id => this.get(id)).filter((a): a is Shell.App => a !== null && Boolean(appInfoOf(a)?.should_show()));
    }

    /** Usage as 0..1 (most used app 1, linearly down; 0 = unknown). Empty when usage tracking is off. */
    usageScore(id: string): number {
        this.build();
        const now = Date.now();
        if (!this._usageScores || now - this._usageStamp > USAGE_TTL_MS) {
            const scores = new Map<string, number>();
            try {
                const used = this._usage?.get_most_used() ?? [];
                used.forEach((app, i) => {
                    const appId = app?.get_id();
                    if (appId)
                        scores.set(appId, (used.length - i) / used.length);
                });
            } catch (e) {
                warn(`AppIndex: get_most_used failed: ${e}`);
            }
            this._usageScores = scores;
            this._usageStamp = now;
        }
        return this._usageScores.get(id) ?? 0;
    }

    /** Apps of a category id; also understands the special ids 'all' and 'frequent'. */
    categoryApps(id: string, frequentLimit = 0): Shell.App[] {
        if (id === 'all')
            return this.apps();
        if (id === 'frequent')
            return this.frequent(frequentLimit);
        return this.categories().find(c => c.id === id)?.apps ?? [];
    }

    searchEntries(): AppSearchEntry[] {
        this.build();
        if (!this._allEntries) {
            this._cancelEntriesIdle?.();
            this._cancelEntriesIdle = null;
            this._allEntries = this._allApps.map(app => this._entryFor(app));
            this._entries = null;
        }
        if (this._searchFindsHidden)
            return this._allEntries;
        this._entries ??= filterHidden(this._allEntries, entry => entry.id, this._hidden);
        return this._entries;
    }

    installedIds(): string[] {
        this.build();
        return this._allApps.map(app => app.get_id() ?? '').filter(id => id !== '');
    }

    setAppsObserver(cb: ((ids: string[]) => void) | null): void {
        this._observer = cb;
    }

    setHidden(ids: Iterable<string>, searchFinds: boolean): void {
        const next = new Set(ids);
        const same = next.size === this._hidden.size && [...next].every(id => this._hidden.has(id));
        if (same && searchFinds === this._searchFindsHidden)
            return;
        this._hidden = next;
        this._searchFindsHidden = searchFinds;
        this._entries = null;
        if (!this._built)
            return;
        this._applyHidden();
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                warn(`AppIndex: change listener threw: ${e}`);
            }
        }
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'appIndex listener');
    }

    private _lookupLive(id: string): Shell.App | null {
        try {
            const app = this._appSystem?.lookup_app(id) ?? null;
            return appInfoOf(app)?.should_show() ? app : null;
        } catch {
            return null;
        }
    }

    private _rebuildAndNotify(): void {
        if (!this._built)
            return;
        this._rebuild(true);
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                warn(`AppIndex: change listener threw: ${e}`);
            }
        }
    }

    /** Sorts by display name; every name is read once (a GI call), not twice per comparison. */
    private _sortByName(apps: Shell.App[], names: Map<Shell.App, string>): void {
        for (const app of apps) {
            if (!names.has(app))
                names.set(app, app.get_name() ?? '');
        }
        apps.sort((a, b) => this._collator.compare(names.get(a) ?? '', names.get(b) ?? ''));
    }

    /** The desktop file was deleted (the GIO cache behind Shell.AppSystem may not know yet). */
    private _gone(app: Shell.App): boolean {
        try {
            const file = appInfoOf(app)?.get_filename();
            return Boolean(file) && !GLib.file_test(file as string, GLib.FileTest.EXISTS);
        } catch {
            return false;
        }
    }

    private _appFor(id: string, entry: GMenu.TreeEntry | undefined, checkFiles: boolean): Shell.App | null {
        let app = this._appSystem?.lookup_app(id) ?? null;
        if (!app && entry) {
            try {
                app = newShellApp(entry.get_app_info());
            } catch {
                app = null;
            }
        }
        return app && appInfoOf(app)?.should_show() && !(checkFiles && this._gone(app)) ? app : null;
    }

    private _rebuild(checkFiles = false): void {
        const byId = new Map<string, Shell.App>();
        const categories: AppCategory[] = [];

        // Walk one GMenu directory, flattening sub-directories into the same category.
        const collect = (dir: GMenu.TreeDirectory, into: Shell.App[], seen: Set<Shell.App>, depth: number) => {
            const iter = dir.iter();
            let type: GMenu.TreeItemType;
            while ((type = iter.next()) !== GMenu.TreeItemType.INVALID) {
                if (type === GMenu.TreeItemType.ENTRY) {
                    const entry = iter.get_entry();
                    let id: string;
                    try {
                        id = entry.get_desktop_file_id();
                    } catch {
                        continue;
                    }
                    const app = this._appFor(id, entry, checkFiles);
                    if (!app)
                        continue;
                    const appId = app.get_id() ?? id;
                    byId.set(appId, app);
                    if (!seen.has(app)) {
                        seen.add(app);
                        into.push(app);
                    }
                } else if (type === GMenu.TreeItemType.DIRECTORY && depth < 8) {
                    const sub = iter.get_directory();
                    if (!sub.get_is_nodisplay())
                        collect(sub, into, seen, depth + 1);
                }
            }
        };

        try {
            this._tree?.load_sync();
            const root = this._tree?.get_root_directory();
            if (root) {
                const iter = root.iter();
                let type: GMenu.TreeItemType;
                while ((type = iter.next()) !== GMenu.TreeItemType.INVALID) {
                    if (type !== GMenu.TreeItemType.DIRECTORY)
                        continue;
                    const dir = iter.get_directory();
                    if (dir.get_is_nodisplay())
                        continue;
                    const apps: Shell.App[] = [];
                    collect(dir, apps, new Set(), 0);
                    if (apps.length === 0)
                        continue;
                    categories.push({
                        id: dir.get_menu_id() ?? dir.get_name(),
                        name: dir.get_name(),
                        iconName: this._iconName(dir.get_icon()),
                        apps,
                    });
                }
            }
        } catch (e) {
            warn(`AppIndex: GMenu tree load failed: ${e}`);
        }

        // Visible apps the tree does not list (or everything, if the tree failed) go to Other.
        const orphans: Shell.App[] = [];
        try {
            for (const info of this._appSystem?.get_installed() ?? []) {
                const id = info.get_id();
                if (!id || byId.has(id) || !info.should_show())
                    continue;
                const app = this._appSystem?.lookup_app(id);
                if (!app || (checkFiles && this._gone(app)))
                    continue;
                byId.set(id, app);
                orphans.push(app);
            }
        } catch (e) {
            warn(`AppIndex: get_installed failed: ${e}`);
        }
        if (orphans.length > 0) {
            const other = categories.find(c => c.id === OTHER_ID);
            if (other)
                other.apps.push(...orphans);
            else
                categories.push({id: OTHER_ID, name: _('Other'), iconName: 'applications-other', apps: orphans});
        }

        const names = new Map<Shell.App, string>();
        for (const cat of categories)
            this._sortByName(cat.apps, names);

        // An app listed under two ids (lookup by an alias) appears once.
        const apps = [...new Set(byId.values())];
        this._sortByName(apps, names);

        this._byId = byId;
        this._allApps = apps;
        this._allCategories = categories;
        this._applyHidden();
        // Search keys (and rank.ts' per-app match data) are prepared on an idle, so neither the build nor
        // the first keystroke waits for them.
        this._allEntries = null;
        this._entries = null;
        this._cancelEntriesIdle?.();
        this._cancelEntriesIdle = this._scope.idle(() => {
            this._cancelEntriesIdle = null;
            if (this._built)
                prepareApps(this.searchEntries());
        });
        try {
            this._observer?.(this.installedIds());
        } catch (e) {
            warn(`AppIndex: apps observer threw: ${e}`);
        }
    }

    /** The public lists: everything except the hidden apps. */
    private _applyHidden(): void {
        const idOf = (app: Shell.App): string => app.get_id() ?? '';
        this._apps = filterHidden(this._allApps, idOf, this._hidden);
        this._categories = filterCategories(this._allCategories, idOf, this._hidden);
    }

    private _iconName(icon: Gio.Icon | null): string {
        if (!icon)
            return 'applications-other';
        if (icon instanceof Gio.ThemedIcon)
            return icon.get_names()[0] ?? 'applications-other';
        return icon.to_string() ?? 'applications-other';
    }

    private _entryFor(app: Shell.App): AppSearchEntry {
        const info = appInfoOf(app);
        const id = app.get_id() ?? '';
        const name = app.get_name() ?? '';
        let keywords: string[];
        try {
            keywords = info?.get_keywords() ?? [];
        } catch {
            keywords = [];
        }
        let fullName: string | null;
        try {
            fullName = info?.has_key('X-GNOME-FullName') ? info.get_string('X-GNOME-FullName') : null;
        } catch {
            fullName = null;
        }
        return {
            app,
            id,
            name,
            description: descriptionKey(info?.get_description()),
            keys: appKeys({
                name,
                fullName,
                genericName: info?.get_generic_name(),
                keywords,
                executable: info?.get_executable(),
                id,
            }),
        };
    }
}
