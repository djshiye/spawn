// RecentFilesProvider: searches ~/.local/share/recently-used.xbel (Gtk.RecentManager is not
// available inside the shell, so the file is read with GLib.BookmarkFile).
//
// The parsed list is cached. A Gio.FileMonitor on the file only sets a dirty flag; the next
// search reparses lazily, so a search costs no I/O at all while the file is unchanged. The
// monitor and the first parse happen on the first enabled search, never at construction.
// Missing files are skipped lazily: only the top few ranked candidates are checked, and the
// result (per uri) is remembered until the next reparse, so there is no per-keystroke stat.
//
// id 'recentFiles'; enabled by search-provider-recent-files; honours show-hidden-recent-files
// and max-search-results. activate() opens the file with its default application.
//
// Public API:
//   new RecentFilesProvider(scope: Scope, settings: SpawnSettings)  implements SearchProvider

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {error, warn} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {rankItemsBy, scoreNormalized} from '../rank.js';

const MAX_ITEMS = 2000;
/** Candidates examined per wanted result when skipping files that no longer exist. */
const EXISTENCE_OVERSAMPLE = 3;

interface RecentItem {
    uri: string;
    name: string;
    /** Directory shown as description, with the home directory shortened to "~". */
    folder: string;
    path: string | null;
    mime: string;
    hidden: boolean;
    modified: number;
}

function tryGet<T>(fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

export class RecentFilesProvider implements SearchProvider {
    readonly id = 'recentFiles';
    readonly title = 'Recent Files';

    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private _items: RecentItem[] = [];
    private _dirty = true;
    private _monitorStarted = false;
    private _monitored = false;
    private _exists = new Map<string, boolean>();

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
    }

    isEnabled(): boolean {
        return this._settings.get('search-provider-recent-files');
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim())
            return [];
        this._ensureLoaded();
        if (token.cancelled)
            return [];

        const showHidden = this._settings.get('show-hidden-recent-files');
        const max = this._settings.get('max-search-results');
        const items = showHidden ? this._items : this._items.filter(i => !i.hidden);
        const ranked = rankItemsBy(query, items, (item: RecentItem, q) => scoreNormalized(q, item.name), max * EXISTENCE_OVERSAMPLE);

        const results: SearchResult[] = [];
        for (const {item, score} of ranked) {
            if (results.length >= max)
                break;
            if (!this._isPresent(item))
                continue;
            results.push({
                id: item.uri,
                providerId: this.id,
                title: item.name,
                description: item.folder,
                icon: item.mime ? tryGet(() => Gio.content_type_get_icon(item.mime), null) : null,
                score,
                activate: () => {
                    try {
                        Gio.AppInfo.launch_default_for_uri(item.uri, null);
                    } catch (e) {
                        error(`opening ${item.uri} failed`, e);
                    }
                },
            });
        }
        return results;
    }

    private _isPresent(item: RecentItem): boolean {
        if (!item.path)
            return true; // non-local uri: cannot check cheaply, keep it
        let known = this._exists.get(item.uri);
        if (known === undefined) {
            known = GLib.file_test(item.path, GLib.FileTest.EXISTS);
            this._exists.set(item.uri, known);
        }
        return known;
    }

    private _path(): string {
        return GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
    }

    private _ensureLoaded(): void {
        if (!this._monitorStarted)
            this._startMonitor();
        if (!this._dirty && this._monitored)
            return;
        this._dirty = false;
        this._exists.clear();
        this._items = this._parse();
    }

    private _startMonitor(): void {
        this._monitorStarted = true;
        try {
            const monitor = Gio.File.new_for_path(this._path()).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._scope.connect(monitor, 'changed', () => {
                this._dirty = true;
            });
            this._scope.add(() => monitor.cancel(), 'recent files monitor');
            this._monitored = true;
        } catch (e) {
            // Without a monitor the list could go stale; reparse on every search instead.
            warn('cannot monitor recently-used.xbel, will reparse per search:', e);
        }
    }

    private _parse(): RecentItem[] {
        const bookmarks = GLib.BookmarkFile.new();
        try {
            bookmarks.load_from_file(this._path());
        } catch {
            return []; // missing or half-written: the monitor fires again once it exists
        }

        const home = GLib.get_home_dir();
        const items: RecentItem[] = [];
        for (const uri of tryGet(() => bookmarks.get_uris(), [] as string[])) {
            try {
                const file = Gio.File.new_for_uri(uri);
                const path = file.get_path();
                const name = file.get_basename() ?? bookmarks.get_title(uri);
                if (!name)
                    continue;
                const parent = path ? GLib.path_get_dirname(path) : uri;
                const folder = parent === home ? '~' : parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
                const hidden = name.startsWith('.');
                const modified = tryGet(() => bookmarks.get_modified_date_time(uri).to_unix(), 0);
                items.push({uri, name, folder, path, mime: tryGet(() => bookmarks.get_mime_type(uri), ''), hidden, modified});
            } catch (e) {
                error(`skipping recent entry ${uri}`, e);
            }
        }
        items.sort((a, b) => b.modified - a.modified);
        return items.slice(0, MAX_ITEMS);
    }
}
