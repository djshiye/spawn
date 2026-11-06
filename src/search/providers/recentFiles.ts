// RecentFilesProvider: searches ~/.local/share/recently-used.xbel (Gtk.RecentManager is not
// available inside the shell, so the file is read with GLib.BookmarkFile).
//
// The parsed list is cached. A Gio.FileMonitor on the file only sets a dirty flag; the next
// search reparses lazily, so a search costs no I/O at all while the file is unchanged. The
// monitor and the first parse happen on the first enabled search, never at construction;
// clear() (menu closed) drops the list and the monitor again.
//
// Entries whose file no longer exists are skipped lazily: all matches are ranked, then walked
// best first, stat-ing until `max` live files are found (at most STAT_BUDGET stats per query;
// many xbel entries are typically dead). An existence result is remembered per uri for
// EXISTS_TTL_US, so typing costs no I/O, but a deleted / re-mounted file is noticed within a
// few seconds. A transient parse error is retried (at most every RETRY_US); a file larger
// than MAX_XBEL_BYTES is not parsed at all.
//
// id 'recentFiles'; enabled by search-provider-recent-files; honours show-hidden-recent-files
// (any dot-component below $HOME hides a file) and max-search-results. Results always show
// the folder as description (alwaysShowDescription) so equal names stay distinguishable.
// activate() re-checks the file, then opens it with its default application using a proper
// launch context (focus / startup notification) and reports failures with a notification.
//
// The same cache feeds the menu's Recent Files view (the "Recent files" category quick link):
// list(max) returns the newest live entries, honouring show-hidden-recent-files and GNOME's
// org.gnome.desktop.privacy remember-recent-files (off = nothing is listed), and open(entry)
// opens one with its default application. Neither depends on search-provider-recent-files.
//
// Public API:
//   new RecentFilesProvider(scope: Scope, settings: SpawnSettings)  implements SearchProvider
//   clear(): drop the parsed list, caches and the file monitor
//   list(max): RecentList                 the newest `max` live files {entries, more, remembering}
//   open(entry: RecentItem): void         open with the default application (notifies on failure)
//   RecentItem                            {uri, name, folder (~-shortened parent), path, mime, hidden, modified}
//   RecentList                            {entries, more (older live files exist), remembering (privacy switch)}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, warn} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {hasAlnum, rankItemsBy, scoreNormalized} from '../rank.js';

const MAX_ITEMS = 2000;
const MAX_XBEL_BYTES = 2 * 1024 * 1024;
const STAT_BUDGET = 100;
const EXISTS_TTL_US = 5_000_000;
const RETRY_US = 3_000_000;

export interface RecentItem {
    uri: string;
    name: string;
    /** Directory shown as description, with the home directory shortened to "~". */
    folder: string;
    path: string | null;
    mime: string;
    hidden: boolean;
    modified: number;
}

export interface RecentList {
    entries: RecentItem[];
    more: boolean;
    remembering: boolean;
}

const PRIVACY_SCHEMA = 'org.gnome.desktop.privacy';

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

    private readonly _monitorScope: Scope;
    private readonly _settings: SpawnSettings;
    private _items: RecentItem[] = [];
    private _dirty = true;
    private _retryAt = 0;
    private _monitorStarted = false;
    private _monitored = false;
    private _exists = new Map<string, {present: boolean; at: number}>();
    private _privacy: Gio.Settings | null | undefined;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._monitorScope = scope.child('recent files monitor');
        this._settings = settings;
    }

    isEnabled(): boolean {
        return this._settings.get('search-provider-recent-files');
    }

    clear(): void {
        this._monitorScope.dispose();
        this._monitorStarted = false;
        this._monitored = false;
        this._dirty = true;
        this._retryAt = 0;
        this._items = [];
        this._exists.clear();
    }

    /** GNOME's "File History" switch (org.gnome.desktop.privacy remember-recent-files); true when it cannot be read. */
    private _remembering(): boolean {
        if (this._privacy === undefined) {
            const source = Gio.SettingsSchemaSource.get_default();
            this._privacy = source?.lookup(PRIVACY_SCHEMA, true) ? new Gio.Settings({schema_id: PRIVACY_SCHEMA}) : null;
        }
        return tryGet(() => this._privacy?.get_boolean('remember-recent-files') ?? true, true);
    }

    list(max: number): RecentList {
        const remembering = this._remembering();
        if (!remembering)
            return {entries: [], more: false, remembering};
        this._ensureLoaded();
        const items = this._settings.get('show-hidden-recent-files') ? this._items : this._items.filter(i => !i.hidden);
        const entries: RecentItem[] = [];
        let more = false;
        const now = GLib.get_monotonic_time();
        let budget = STAT_BUDGET;
        for (const item of items) {
            const present = this._isPresent(item, now, budget > 0);
            if (present === null)
                break;
            if (present === 'stat' || present === 'dead')
                budget--;
            if (present === false || present === 'dead')
                continue;
            if (entries.length >= max) {
                more = true;
                break;
            }
            entries.push(item);
        }
        return {entries, more, remembering};
    }

    open(item: RecentItem): void {
        this._open(item);
    }

    search(query: string, token: CancelToken): SearchResult[] {
        if (!query.trim() || !hasAlnum(query) || !this._remembering())
            return []; // File History off: nothing is read or shown, as in list()
        this._ensureLoaded();
        if (token.cancelled)
            return [];

        const showHidden = this._settings.get('show-hidden-recent-files');
        const max = maxSearchResults(this._settings);
        const items = showHidden ? this._items : this._items.filter(i => !i.hidden);
        const ranked = rankItemsBy(query, items, (item: RecentItem, q) => scoreNormalized(q, item.name));

        const results: SearchResult[] = [];
        const now = GLib.get_monotonic_time();
        let budget = STAT_BUDGET;
        for (const {item, score} of ranked) {
            if (results.length >= max)
                break;
            const present = this._isPresent(item, now, budget > 0);
            if (present === null)
                break; // out of stat budget
            if (present === 'stat' || present === 'dead')
                budget--; // every fresh stat is charged, dead files too (a slow mount blocks the same)
            if (present === false || present === 'dead')
                continue;
            results.push({
                id: item.uri,
                providerId: this.id,
                title: item.name,
                description: item.folder,
                alwaysShowDescription: true,
                icon: item.mime ? tryGet(() => Gio.content_type_get_icon(item.mime), null) : null,
                score,
                activate: () => this._open(item),
            });
        }
        return results;
    }

    /**
     * true / false from the cache or a non-local uri; 'stat' / 'dead' when it had to stat and the
     * file exists / is missing (both cost budget); null: no budget left.
     */
    private _isPresent(item: RecentItem, now: number, canStat: boolean): boolean | 'stat' | 'dead' | null {
        if (!item.path || item.path.includes('/gvfs/'))
            return true; // non-local uri: cannot check cheaply (a stat could block), keep it
        const known = this._exists.get(item.uri);
        if (known && now - known.at < EXISTS_TTL_US)
            return known.present;
        if (!canStat)
            return null;
        const present = GLib.file_test(item.path, GLib.FileTest.EXISTS);
        this._exists.set(item.uri, {present, at: now});
        return present ? 'stat' : 'dead';
    }

    private _open(item: RecentItem): void {
        // Re-check: the cache can be a few seconds old, and an editor would happily create
        // a brand-new empty file for a path that was deleted in the meantime.
        if (item.path && !item.path.includes('/gvfs/') && !GLib.file_test(item.path, GLib.FileTest.EXISTS)) {
            this._exists.set(item.uri, {present: false, at: GLib.get_monotonic_time()});
            this._notify(`${item.name} no longer exists`, item.folder);
            return;
        }
        try {
            const context = global.create_app_launch_context(0, -1);
            Gio.AppInfo.launch_default_for_uri_async(item.uri, context, null, (_source, res) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(res);
                } catch (e) {
                    error(`opening ${item.uri} failed`, e);
                    this._notify(`Cannot open ${item.name}`, e instanceof Error ? e.message : String(e));
                }
            });
        } catch (e) {
            error(`opening ${item.uri} failed`, e);
            this._notify(`Cannot open ${item.name}`, e instanceof Error ? e.message : String(e));
        }
    }

    private _notify(title: string, body: string): void {
        try {
            Main.notifyError(title, body);
        } catch (e) {
            error('showing a notification failed', e);
        }
    }

    private _path(): string {
        return GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
    }

    private _ensureLoaded(): void {
        if (!this._monitorStarted)
            this._startMonitor();
        if (!this._dirty && this._monitored)
            return;
        const now = GLib.get_monotonic_time();
        if (now < this._retryAt)
            return; // a recent parse failed; keep what we have for a moment
        this._dirty = false;
        this._exists.clear();
        const parsed = this._parse();
        if (parsed) {
            this._items = parsed;
        } else {
            this._dirty = true; // keep the previous list while the retry window runs
            this._retryAt = now + RETRY_US;
        }
    }

    private _startMonitor(): void {
        this._monitorStarted = true;
        try {
            const monitor = Gio.File.new_for_path(this._path()).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorScope.connect(monitor, 'changed', () => {
                this._dirty = true;
                this._retryAt = 0;
            });
            this._monitorScope.add(() => monitor.cancel(), 'recent files monitor');
            this._monitored = true;
        } catch (e) {
            // Without a monitor the list could go stale; reparse on every search instead.
            warn('cannot monitor recently-used.xbel, will reparse per search:', e);
        }
    }

    /** The parsed items, or null when the file could not be read for a non-permanent reason. */
    private _parse(): RecentItem[] | null {
        const path = this._path();
        try {
            const info = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            if (info.get_size() > MAX_XBEL_BYTES) {
                warn(`recently-used.xbel is larger than ${MAX_XBEL_BYTES} bytes, recent files are skipped`);
                return [];
            }
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return []; // no file yet: the monitor fires once it exists
            return null;
        }

        const bookmarks = GLib.BookmarkFile.new();
        try {
            bookmarks.load_from_file(path);
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(GLib.BookmarkFileError, GLib.BookmarkFileError.FILE_NOT_FOUND))
                return [];
            return null; // half-written (or unreadable): retry shortly
        }

        const home = GLib.get_home_dir();
        const items: RecentItem[] = [];
        for (const uri of tryGet(() => bookmarks.get_uris(), [] as string[])) {
            try {
                const file = Gio.File.new_for_uri(uri);
                const filePath = file.get_path();
                if (filePath === '/')
                    continue;
                const name = file.get_basename() ?? bookmarks.get_title(uri);
                if (!name || name === '/')
                    continue;
                const parent = filePath ? GLib.path_get_dirname(filePath) : uri;
                const folder = parent === home ? '~' : parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
                const modified = tryGet(() => bookmarks.get_modified_date_time(uri).to_unix(), 0);
                items.push({uri, name, folder, path: filePath, mime: tryGet(() => bookmarks.get_mime_type(uri), ''), hidden: isHidden(filePath, name, home), modified});
            } catch (e) {
                error(`skipping recent entry ${uri}`, e);
            }
        }
        items.sort((a, b) => b.modified - a.modified);
        return items.slice(0, MAX_ITEMS);
    }
}

/** Hidden: the name starts with "." or any directory below $HOME does (~/.config/..., ~/.cache/...). */
function isHidden(path: string | null, name: string, home: string): boolean {
    if (name.startsWith('.'))
        return true;
    if (path?.startsWith(`${home}/`))
        return path.slice(home.length + 1).split('/').some(c => c.startsWith('.'));
    return false;
}
