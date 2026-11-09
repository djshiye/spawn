// RecentFilesProvider: searches ~/.local/share/recently-used.xbel (Gtk.RecentManager is not
// available inside the shell, so the file is read with GLib.BookmarkFile).
//
// The parsed list is cached for the session (also between menu opens). A Gio.FileMonitor on the
// file only sets a dirty flag; the next search reparses lazily, so a search costs no parsing at
// all while the file is unchanged. The monitor and the first parse happen on the first enabled
// search, never at construction; clear() (menu closed) only cancels the existence checks in flight.
//
// Entries whose file no longer exists are skipped lazily: all matches are ranked, then walked
// best first until `max` live files are found. Existence is checked asynchronously (FileProbe:
// Gio's async queries with a deadline, so a hung network share can never freeze the shell; a
// file whose check overran is left out of that query), at most STAT_BUDGET checks per query (many
// xbel entries are typically dead). An existence result is remembered per uri for EXISTS_TTL_US:
// while typing, the results come straight from that cache, synchronously; a query that needs
// fresh checks returns a promise (its rows arrive a moment later, the old ones stay meanwhile).
// A deleted / re-mounted file is noticed within a few seconds. A transient parse error is retried
// (at most every RETRY_US); a file larger than MAX_XBEL_BYTES is not parsed at all.
//
// Ranking: the file name at full weight, its folder at FOLDER_WEIGHT (so "invoices" also finds the
// files inside ~/Documents/Invoices, below any file NAMED like that), and a multi-word query may mix
// both ("invoices march"). Both strings are prepared for matching once per parse, not per keystroke.
// Equal scores keep the newest file first.
//
// id 'recentFiles'; enabled by search-provider-recent-files; honours show-hidden-recent-files
// (any dot-component below $HOME hides a file) and max-search-results. Results always show
// the folder as description (alwaysShowDescription) so equal names stay distinguishable.
// activate() re-checks the file (asynchronously), then opens it with its default application
// using a proper launch context (focus / startup notification) and reports failures with a
// notification.
//
// The same cache feeds the menu's Recent Files view (the "Recent files" category quick link):
// list(max) returns the newest live entries (a promise when existence checks are needed), honouring
// show-hidden-recent-files and GNOME's
// org.gnome.desktop.privacy remember-recent-files (off = nothing is listed), and open(entry)
// opens one with its default application. Neither depends on search-provider-recent-files.
//
// Public API:
//   new RecentFilesProvider(scope: Scope, settings: SpawnSettings)  implements SearchProvider
//   clear(): cancel the existence checks in flight (the parsed list and the monitor stay)
//   list(max): RecentList | Promise<RecentList>   the newest `max` live files {entries, more, remembering}
//   open(entry: RecentItem): void         open with the default application (notifies on failure)
//   RecentItem                            {uri, name, folder (~-shortened parent), path, mime, hidden, modified}
//   RecentList                            {entries, more (older live files exist), remembering (privacy switch)}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, warn} from '../../core/log.js';
import {FileProbe} from '../../core/fileProbe.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {candidate, hasAlnum, rankFields, type Field} from '../rank.js';

const MAX_ITEMS = 2000;
const MAX_XBEL_BYTES = 2 * 1024 * 1024;
const STAT_BUDGET = 100;
const EXISTS_TTL_US = 5_000_000;
const RETRY_US = 3_000_000;
/** An existence check slower than this leaves the file out of that query (a hung share must not hold the results). */
const PROBE_TIMEOUT_MS = 400;
/** A folder match counts at half a name match. */
const FOLDER_WEIGHT = 0.5;

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
    private readonly _probe: FileProbe;
    private _items: RecentItem[] = [];
    private _dirty = true;
    private _retryAt = 0;
    private _monitorStarted = false;
    private _monitored = false;
    private _exists = new Map<string, {present: boolean; at: number}>();
    private _privacy: Gio.Settings | null | undefined;
    /** Prepared name + folder per item; items are replaced wholesale on a reparse. */
    private _fields = new WeakMap<RecentItem, readonly Field[]>();

    constructor(scope: Scope, settings: SpawnSettings) {
        this._monitorScope = scope.child('recent files monitor');
        this._settings = settings;
        this._probe = new FileProbe(scope.child('recent files probe'), {timeoutMs: PROBE_TIMEOUT_MS});
    }

    isEnabled(): boolean {
        return this._settings.get('search-provider-recent-files');
    }

    /** Menu closed: stop waiting for existence checks. The list stays parsed (the monitor keeps it current). */
    clear(): void {
        this._probe.cancel();
    }

    /** GNOME's "File History" switch (org.gnome.desktop.privacy remember-recent-files); true when it cannot be read. */
    private _remembering(): boolean {
        if (this._privacy === undefined) {
            const source = Gio.SettingsSchemaSource.get_default();
            this._privacy = source?.lookup(PRIVACY_SCHEMA, true) ? new Gio.Settings({schema_id: PRIVACY_SCHEMA}) : null;
        }
        return tryGet(() => this._privacy?.get_boolean('remember-recent-files') ?? true, true);
    }

    list(max: number): RecentList | Promise<RecentList> {
        const remembering = this._remembering();
        if (!remembering)
            return {entries: [], more: false, remembering};
        this._ensureLoaded();
        const items = this._settings.get('show-hidden-recent-files') ? this._items : this._items.filter(i => !i.hidden);
        const make = (live: RecentItem[]): RecentList => ({entries: live.slice(0, max), more: live.length > max, remembering});
        const live = this._live(items, max + 1, null);
        return Array.isArray(live) ? make(live) : live.then(make);
    }

    open(item: RecentItem): void {
        this._open(item);
    }

    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        if (!query.trim() || !hasAlnum(query) || !this._remembering())
            return []; // File History off: nothing is read or shown, as in list()
        this._ensureLoaded();
        if (token.cancelled)
            return [];

        const showHidden = this._settings.get('show-hidden-recent-files');
        const max = maxSearchResults(this._settings);
        const items = showHidden ? this._items : this._items.filter(i => !i.hidden);
        const ranked = rankFields(query, items, item => this._fieldsOf(item));
        const scores = new Map(ranked.map(r => [r.item, r.score]));
        const make = (live: RecentItem[]): SearchResult[] => live.map(item => ({
            id: item.uri,
            providerId: this.id,
            title: item.name,
            description: item.folder,
            alwaysShowDescription: true,
            icon: item.mime ? tryGet(() => Gio.content_type_get_icon(item.mime), null) : null,
            score: scores.get(item) ?? 0,
            activate: () => this._open(item),
        }));
        const live = this._live(ranked.map(r => r.item), max, token);
        return Array.isArray(live) ? make(live) : live.then(make);
    }

    /**
     * The first `want` live items of `items` (in order). From the existence cache alone when it knows
     * every item in the way (synchronous), else a promise that checks the unknown ones (STAT_BUDGET
     * checks at most; an item whose check timed out is left out this time).
     */
    private _live(items: RecentItem[], want: number, token: CancelToken | null): RecentItem[] | Promise<RecentItem[]> {
        const skip = new Set<RecentItem>();
        const first = this._scan(items, want, skip, STAT_BUDGET);
        if (first.unknown.length === 0)
            return first.live;
        return (async () => {
            let budget = STAT_BUDGET;
            let scan = first;
            while (scan.unknown.length > 0 && !token?.cancelled) {
                budget -= scan.unknown.length;
                const unknown = scan.unknown;
                const states = await Promise.all(unknown.map(i => this._probe.exists(i.path as string)));
                const at = GLib.get_monotonic_time();
                unknown.forEach((item, k) => {
                    if (states[k] === 'timeout')
                        skip.add(item);
                    else
                        this._exists.set(item.uri, {present: states[k] === 'ok', at});
                });
                scan = this._scan(items, want, skip, budget);
            }
            return token?.cancelled ? [] : scan.live;
        })();
    }

    /**
     * Walk `items` best first through the first `want` candidates (known live, or not known): `live` = the
     * known-live ones, `unknown` = the ones to check. Stops at an unknown item past `budget` checks (it and
     * everything after it stay out, as an exhausted stat budget always did).
     */
    private _scan(items: RecentItem[], want: number, skip: Set<RecentItem>, budget: number): {live: RecentItem[]; unknown: RecentItem[]} {
        const now = GLib.get_monotonic_time();
        const live: RecentItem[] = [];
        const unknown: RecentItem[] = [];
        for (const item of items) {
            if (live.length + unknown.length >= want)
                break;
            if (skip.has(item))
                continue;
            const known = this._known(item, now);
            if (known === false)
                continue;
            if (known === true) {
                live.push(item);
                continue;
            }
            if (unknown.length >= budget)
                break;
            unknown.push(item);
        }
        return {live, unknown};
    }

    private _fieldsOf(item: RecentItem): readonly Field[] {
        let fields = this._fields.get(item);
        if (!fields) {
            fields = [{candidate: candidate(item.name), weight: 1}, {candidate: candidate(item.folder), weight: FOLDER_WEIGHT}];
            this._fields.set(item, fields);
        }
        return fields;
    }

    /** true / false from the cache (or a non-local uri, which cannot be checked cheaply: kept); null = check it. */
    private _known(item: RecentItem, now: number): boolean | null {
        if (!item.path || item.path.includes('/gvfs/'))
            return true;
        const known = this._exists.get(item.uri);
        return known && now - known.at < EXISTS_TTL_US ? known.present : null;
    }

    private _open(item: RecentItem): void {
        // Re-check: the cache can be a few seconds old, and an editor would happily create
        // a brand-new empty file for a path that was deleted in the meantime. A check that does
        // not answer in time (a slow share) does not stop the launch.
        if (!item.path || item.path.includes('/gvfs/')) {
            this._launch(item);
            return;
        }
        this._probe.exists(item.path).then(state => {
            if (state === 'missing') {
                this._exists.set(item.uri, {present: false, at: GLib.get_monotonic_time()});
                this._notify(`${item.name} no longer exists`, item.folder);
                return;
            }
            this._launch(item);
        }).catch(e => error(`opening ${item.uri} failed`, e));
    }

    private _launch(item: RecentItem): void {
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
