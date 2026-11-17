// RecentFilesProvider: searches ~/.local/share/recently-used.xbel (Gtk.RecentManager is not
// available inside the shell, so the file is read with GLib.BookmarkFile).
//
// The parsed list is cached for the session (also between menu opens). A Gio.FileMonitor on the
// file only sets a dirty flag; the next search (or warmUp(), on menu open) reloads it in the
// background: the size check and the read run in GIO's worker threads, and the parse and the
// per-entry work are split over idle callbacks, so no keystroke or frame waits for the file (a
// search during a load returns a promise; its rows arrive once the load is done). Unchanged
// entries keep their objects across a reload, so their prepared name and folder are not prepared
// again. The monitor and the first parse happen on the first enabled search or menu open, never
// at construction; clear() (menu closed) only cancels the existence checks in flight. The
// provider is `immediate`: it answers every keystroke, with no debounce (ranking 2000 prepared
// entries takes ~1-3 ms).
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
//   warmUp(): menu opened: (re)load the list and prepare it for matching in the background
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
/** Entries read from the parsed file per idle (2000 entries take ~15-45 ms of GI calls in all). */
const ENTRY_CHUNK = 250;
/** Items prepared for matching per idle after a warm-up. */
const PREPARE_CHUNK = 400;

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
    readonly immediate = true;

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
    private readonly _loadScope: Scope;
    private _loading: Promise<void> | null = null;
    private _loadCancellable: Gio.Cancellable | null = null;
    /** _items without the hidden ones, built once per parse (null = not built yet). */
    private _visible: RecentItem[] | null = null;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._monitorScope = scope.child('recent files monitor');
        this._settings = settings;
        this._probe = new FileProbe(scope.child('recent files probe'), {timeoutMs: PROBE_TIMEOUT_MS});
        this._loadScope = scope.child('recent files load');
        this._loadScope.add(() => this._loadCancellable?.cancel(), 'recent files load cancel');
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
        const make = (live: RecentItem[]): RecentList => ({entries: live.slice(0, max), more: live.length > max, remembering});
        const listNow = (): RecentList | Promise<RecentList> => {
            const live = this._live(this._shown(), max + 1, null);
            return Array.isArray(live) ? make(live) : live.then(make);
        };
        const loading = this._ensureLoaded();
        return loading ? loading.then(listNow) : listNow();
    }

    open(item: RecentItem): void {
        this._open(item);
    }

    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        if (!query.trim() || !hasAlnum(query) || !this._remembering())
            return []; // File History off: nothing is read or shown, as in list()
        const loading = this._ensureLoaded();
        return loading ? loading.then(() => token.cancelled ? [] : this._searchLoaded(query, token)) : this._searchLoaded(query, token);
    }

    /** Hidden entries left out unless show-hidden-recent-files is on. */
    private _shown(): RecentItem[] {
        if (this._settings.get('show-hidden-recent-files'))
            return this._items;
        this._visible ??= this._items.filter(i => !i.hidden);
        return this._visible;
    }

    private _searchLoaded(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        const max = maxSearchResults(this._settings);
        const ranked = rankFields(query, this._shown(), item => this._fieldsOf(item));
        if (token.cancelled)
            return [];
        const scores = new Map<RecentItem, number>();
        const order: RecentItem[] = new Array(ranked.length);
        for (let i = 0; i < ranked.length; i++) {
            order[i] = ranked[i].item;
            scores.set(ranked[i].item, ranked[i].score);
        }
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
        const live = this._live(order, max, token);
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

    /**
     * Makes sure the list is current: null when it is (or a recent failure says to keep what we have), else the
     * load in flight (started now if needed). A search during a load waits for it; its rows arrive a moment later.
     */
    private _ensureLoaded(): Promise<void> | null {
        if (!this._monitorStarted)
            this._startMonitor();
        if (this._loading)
            return this._loading;
        if (!this._dirty && this._monitored)
            return null;
        const now = GLib.get_monotonic_time();
        if (now < this._retryAt)
            return null; // a recent parse failed; keep what we have for a moment
        this._dirty = false;
        const cancellable = new Gio.Cancellable();
        this._loadCancellable = cancellable;
        this._loading = this._load(cancellable).finally(() => {
            if (this._loadCancellable === cancellable) {
                this._loading = null;
                this._loadCancellable = null;
            }
        });
        return this._loading;
    }

    /** Menu opened: read and prepare the list in the background now, so the first keystroke does not wait for it. */
    warmUp(): void {
        if (!this.isEnabled() || !this._remembering())
            return;
        this._ensureLoaded()?.then(() => this._prepareFields()).catch(e => error('warming up recent files failed', e));
    }

    private async _load(cancellable: Gio.Cancellable): Promise<void> {
        let parsed: RecentItem[] | null;
        try {
            parsed = await this._parse(cancellable);
        } catch (e) {
            error('reading recently-used.xbel failed', e);
            parsed = null;
        }
        if (cancellable.is_cancelled())
            return;
        if (parsed) {
            this._items = this._reuse(parsed);
            this._visible = null;
        } else {
            this._dirty = true; // keep the previous list while the retry window runs
            this._retryAt = GLib.get_monotonic_time() + RETRY_US;
        }
    }

    /**
     * Keeps the previous object of every unchanged entry, so its prepared name and folder (the _fields WeakMap)
     * survive a reparse: the file changes whenever any app opens a file.
     */
    private _reuse(parsed: RecentItem[]): RecentItem[] {
        const old = new Map<string, RecentItem>();
        for (const item of this._items)
            old.set(item.uri, item);
        return parsed.map(item => {
            const prev = old.get(item.uri);
            return prev && prev.name === item.name && prev.folder === item.folder && prev.path === item.path &&
                prev.mime === item.mime && prev.hidden === item.hidden && prev.modified === item.modified ? prev : item;
        });
    }

    /** Prepares the name and folder of every item for matching, PREPARE_CHUNK items per idle. */
    private async _prepareFields(): Promise<void> {
        const items = this._items;
        for (let i = 0; i < items.length; i += PREPARE_CHUNK) {
            if (items !== this._items)
                return; // reparsed meanwhile; the next warm-up prepares the new list
            for (let k = i; k < Math.min(i + PREPARE_CHUNK, items.length); k++)
                this._fieldsOf(items[k]);
            await this._idle();
        }
    }

    private _idle(): Promise<void> {
        return new Promise(resolve => this._loadScope.idle(resolve));
    }

    private _startMonitor(): void {
        this._monitorStarted = true;
        try {
            const monitor = Gio.File.new_for_path(this._path()).monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorScope.connect(monitor, 'changed', () => {
                this._dirty = true;
                this._retryAt = 0;
                // A load in flight read the old contents: drop it, the next search / warm-up starts a fresh one.
                this._loadCancellable?.cancel();
                this._loadCancellable = null;
                this._loading = null;
            });
            this._monitorScope.add(() => monitor.cancel(), 'recent files monitor');
            this._monitored = true;
        } catch (e) {
            // Without a monitor the list could go stale; reparse on every search instead.
            warn('cannot monitor recently-used.xbel, will reparse per search:', e);
        }
    }

    /**
     * The parsed items, or null when the file could not be read for a non-permanent reason. The size check and the
     * read run in GIO's worker threads; the parse and the entries (main thread, GLib.BookmarkFile) are split over
     * idles, ENTRY_CHUNK entries at a time, so no frame waits for a large file.
     */
    private async _parse(cancellable: Gio.Cancellable): Promise<RecentItem[] | null> {
        const file = Gio.File.new_for_path(this._path());
        let bytes: Uint8Array;
        try {
            const info = await queryInfo(file, cancellable);
            if (info.get_size() > MAX_XBEL_BYTES) {
                warn(`recently-used.xbel is larger than ${MAX_XBEL_BYTES} bytes, recent files are skipped`);
                return [];
            }
            bytes = await loadContents(file, cancellable);
        } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return []; // no file yet: the monitor fires once it exists
            return null;
        }
        if (bytes.length > MAX_XBEL_BYTES)
            return []; // grew between the size check and the read
        await this._idle();
        if (cancellable.is_cancelled())
            return null;

        const bookmarks = GLib.BookmarkFile.new();
        try {
            bookmarks.load_from_data(bytes);
        } catch {
            return null; // half-written (or unreadable): retry shortly
        }

        const home = GLib.get_home_dir();
        const items: RecentItem[] = [];
        const uris = tryGet(() => bookmarks.get_uris(), [] as string[]);
        for (let i = 0; i < uris.length; i++) {
            if (i > 0 && i % ENTRY_CHUNK === 0) {
                await this._idle();
                if (cancellable.is_cancelled())
                    return null;
            }
            const uri = uris[i];
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

function queryInfo(file: Gio.File, cancellable: Gio.Cancellable): Promise<Gio.FileInfo> {
    return new Promise((resolve, reject) => {
        file.query_info_async('standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_f, res) => {
            try {
                resolve(file.query_info_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function loadContents(file: Gio.File, cancellable: Gio.Cancellable): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (_f, res) => {
            try {
                resolve(file.load_contents_finish(res)[1]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Hidden: the name starts with "." or any directory below $HOME does (~/.config/..., ~/.cache/...). */
function isHidden(path: string | null, name: string, home: string): boolean {
    if (name.startsWith('.'))
        return true;
    if (path?.startsWith(`${home}/`))
        return path.slice(home.length + 1).split('/').some(c => c.startsWith('.'));
    return false;
}
