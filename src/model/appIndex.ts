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
//   index.setFrequentOverride(ids: string[] | null)   dev hook (Ui.SetFrequent): these apps ARE the most used; null = real usage
//   index.usageScore(id: string): number  0..1 from Shell.AppUsage's ordering (1 = most used, 0 =
//                                           unknown / usage tracking off); the ordering is re-read
//                                           from get_most_used() at most every USAGE_TTL_MS
//   index.searchEntries(): AppSearchEntry[] precomputed normalised keys for search/providers/apps
//   index.onChanged(scope, cb)              cb() after any incremental update
//
// Notes:
//   * categories() holds only the real GMenu top-level categories (sub-directories are
//     flattened into their parent, NoDisplay directories are skipped) plus a synthetic
//     "Other" category for visible apps that the menu tree does not list. The special
//     views "all" and "frequent" are NOT in that list; use apps() / frequent(), or
//     categoryApps(id, limit) which understands 'all' and 'frequent' as well.
//   * frequent() is read live from Shell.AppUsage (cheap); limit <= 0 means unlimited.

import Gio from 'gi://Gio';
import GMenu from 'gi://GMenu';
import Shell from 'gi://Shell';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {debounce} from '../core/debounce.js';
import {warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import {appKeys, descriptionKey} from './appKeys.js';

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

    private _apps: Shell.App[] = [];
    private _byId = new Map<string, Shell.App>();
    private _categories: AppCategory[] = [];
    private _entries: AppSearchEntry[] = [];
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
            if (!app?.get_app_info()?.should_show())
                continue;
            out.push(app);
            if (limit > 0 && out.length >= limit)
                break;
        }
        return out;
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
        return this._entries;
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'appIndex listener');
    }

    private _lookupLive(id: string): Shell.App | null {
        try {
            const app = this._appSystem?.lookup_app(id) ?? null;
            return app?.get_app_info()?.should_show() ? app : null;
        } catch {
            return null;
        }
    }

    private _rebuildAndNotify(): void {
        if (!this._built)
            return;
        this._rebuild();
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                warn(`AppIndex: change listener threw: ${e}`);
            }
        }
    }

    private _byName = (a: Shell.App, b: Shell.App): number =>
        this._collator.compare(a.get_name() ?? '', b.get_name() ?? '');

    private _appFor(id: string, entry?: GMenu.TreeEntry): Shell.App | null {
        let app = this._appSystem?.lookup_app(id) ?? null;
        if (!app && entry) {
            try {
                app = new Shell.App({app_info: entry.get_app_info()});
            } catch {
                app = null;
            }
        }
        return app?.get_app_info()?.should_show() ? app : null;
    }

    private _rebuild(): void {
        const byId = new Map<string, Shell.App>();
        const categories: AppCategory[] = [];

        // Walk one GMenu directory, flattening sub-directories into the same category.
        const collect = (dir: GMenu.TreeDirectory, into: Shell.App[], depth: number) => {
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
                    const app = this._appFor(id, entry);
                    if (!app)
                        continue;
                    const appId = app.get_id() ?? id;
                    byId.set(appId, app);
                    if (!into.includes(app))
                        into.push(app);
                } else if (type === GMenu.TreeItemType.DIRECTORY && depth < 8) {
                    const sub = iter.get_directory();
                    if (!sub.get_is_nodisplay())
                        collect(sub, into, depth + 1);
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
                    collect(dir, apps, 0);
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
                if (!app)
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

        for (const cat of categories)
            cat.apps.sort(this._byName);

        const apps = [...byId.values()].sort(this._byName);

        this._byId = byId;
        this._apps = apps;
        this._categories = categories;
        this._entries = apps.map(app => this._entryFor(app));
    }

    private _iconName(icon: Gio.Icon | null): string {
        if (!icon)
            return 'applications-other';
        if (icon instanceof Gio.ThemedIcon)
            return icon.get_names()[0] ?? 'applications-other';
        return icon.to_string() ?? 'applications-other';
    }

    private _entryFor(app: Shell.App): AppSearchEntry {
        const info = app.get_app_info();
        const id = app.get_id() ?? '';
        const name = app.get_name() ?? '';
        let keywords: string[] = [];
        try {
            keywords = info?.get_keywords() ?? [];
        } catch {
            keywords = [];
        }
        let fullName: string | null = null;
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
