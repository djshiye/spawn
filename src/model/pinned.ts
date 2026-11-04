// PinnedStore: pinned apps and folders over `pinned-apps` + the relocatable folder
// schema (folders/<uuid>/). Value formats are described in docs/SETTINGS.md:
// app = {id: 'x.desktop'}, folder = {id: '<uuid>', name, isFolder: 'true'},
// custom item = {id, name, icon}. The pure list manipulation lives in pinnedOps.ts
// (unit-tested); this class reads a snapshot, applies one op and writes back only what
// changed.
//
// Public API:
//   new PinnedStore(scope, settings, opts?)         opts: {exists?, newUuid?} (tests)
//   store.items(includeMissing?): PinnedItem[]      top level, in order
//   store.folderApps(uuid, includeMissing?): Entry[]
//   store.isPinned(id): boolean                     anywhere, including inside folders
//   store.pin(id, index?): void
//   store.unpin(id): void                           also removes it from a folder
//   store.move(fromIndex, toIndex): void            reorder top level
//   store.createFolder(name, ids, index?): string   returns the new uuid; ids move into it
//   store.renameFolder(uuid, name): void
//   store.deleteFolder(uuid): void                  contained apps are unpinned
//   store.dissolveFolder(uuid): void                folder removed, its apps move to the top level
//                                                   at the folder's slot (menu "Delete Folder")
//   store.invalidate(): void                        forget cached "desktop file exists" answers
//                                                   (call on Shell.AppSystem 'installed-changed')
//   store.addToFolder(uuid, id, index?): void       moves from top level / other folder
//   store.removeFromFolder(uuid, id, toIndex?): void  moves the app back to the top level
//   store.onChanged(scope, cb)                      cb() when pinned-apps or any folder changes
//
// Missing apps: an app entry whose desktop file no longer exists is NEVER deleted from
// settings (the app may come back, e.g. an unmounted Flatpak remote). items() and
// folderApps() leave such entries out unless `includeMissing` is true, in which case app
// items carry `missing: true`. All index arguments of the methods above refer to the list
// returned by items() WITHOUT missing entries (what the UI shows), and index semantics
// are those documented in pinnedOps.ts (index into the list before the operation).

import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';

import {Scope} from '../core/scope.js';
import {debounce} from '../core/debounce.js';
import {isValidFolderId} from '../core/folderId.js';
import type {Entry, FolderSettings, SpawnSettings} from '../core/settings.js';
import * as ops from './pinnedOps.js';

export type PinnedItem =
    | {kind: 'app'; id: string; missing?: boolean}
    | {kind: 'folder'; uuid: string; name: string}
    | {kind: 'custom'; entry: Entry};

export interface PinnedStoreOptions {
    /** Does the desktop file for this id exist? Default: GioUnix.DesktopAppInfo.new(id) !== null (cached until invalidate()). */
    exists?: (id: string) => boolean;
    /** Folder uuid generator. Default: GLib.uuid_string_random. */
    newUuid?: () => string;
}

const EXTERNAL_COALESCE_MS = 30;

function isAppEntry(e: Entry): boolean {
    return !ops.isFolderEntry(e) && e.id.endsWith('.desktop') && !e.name;
}

function sameEntries(a: readonly Entry[], b: readonly Entry[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

interface FolderWatch {
    folder: FolderSettings;
    release: () => void;
}

export class PinnedStore {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _exists: (id: string) => boolean;
    private readonly _existsCache = new Map<string, boolean>();
    private readonly _newUuid: () => string;
    private readonly _folders = new Map<string, FolderWatch>();
    private readonly _listeners = new Set<() => void>();
    private _writing = 0;
    private readonly _externalEmit: {call(): void};

    constructor(scope: Scope, settings: SpawnSettings, opts: PinnedStoreOptions = {}) {
        this._scope = scope;
        this._settings = settings;
        this._exists = opts.exists ?? (id => this._desktopFileExists(id));
        this._newUuid = opts.newUuid ?? (() => GLib.uuid_string_random());

        this._externalEmit = debounce(scope, EXTERNAL_COALESCE_MS, () => this._emit());
        settings.onChanged(scope, ['pinned-apps'], () => {
            if (this._writing > 0)
                return;
            this._watchFolders(this._settings.get('pinned-apps'));
            this._externalEmit.call();
        });
        scope.add(() => {
            for (const w of [...this._folders.values()])
                w.release();
            this._folders.clear();
            this._listeners.clear();
        }, 'pinned store');
        this._watchFolders(settings.get('pinned-apps'));
    }

    items(includeMissing = false): PinnedItem[] {
        const out: PinnedItem[] = [];
        for (const entry of this._settings.get('pinned-apps')) {
            if (ops.isFolderEntry(entry)) {
                // A hand-edited / imported id that cannot be a dconf path element has no folder settings.
                if (!isValidFolderId(entry.id))
                    continue;
                out.push({kind: 'folder', uuid: entry.id, name: entry.name || this._folderName(entry.id)});
            } else if (isAppEntry(entry)) {
                const missing = !this._exists(entry.id);
                if (missing && !includeMissing)
                    continue;
                out.push(missing ? {kind: 'app', id: entry.id, missing: true} : {kind: 'app', id: entry.id});
            } else {
                out.push({kind: 'custom', entry});
            }
        }
        return out;
    }

    folderApps(uuid: string, includeMissing = false): Entry[] {
        const top = this._settings.get('pinned-apps');
        if (!isValidFolderId(uuid) || !top.some(e => ops.isFolderEntry(e) && e.id === uuid))
            return [];
        const list = this._watch(uuid).folder.pinnedApps;
        return includeMissing ? list : list.filter(e => !isAppEntry(e) || this._exists(e.id));
    }

    isPinned(id: string): boolean {
        return ops.isPinnedIn(this._snapshot(), id);
    }

    pin(id: string, index?: number): void {
        this._apply(s => ops.pin(s, id, this._rawIndex(s, index)));
    }

    unpin(id: string): void {
        this._apply(s => ops.unpin(s, id));
    }

    move(fromIndex: number, toIndex: number): void {
        this._apply(s => {
            const visible = this._visibleRaw(s);
            const from = visible[fromIndex];
            if (from === undefined)
                return s;
            return ops.move(s, from, ops.visibleToRawMove(visible, s.top.length, toIndex));
        });
    }

    createFolder(name: string, ids: string[], index?: number): string {
        const uuid = this._newUuid();
        this._apply(s => ops.createFolder(s, uuid, name, ids, this._rawIndex(s, index)));
        return uuid;
    }

    renameFolder(uuid: string, name: string): void {
        this._apply(s => ops.renameFolder(s, uuid, name));
    }

    deleteFolder(uuid: string): void {
        this._apply(s => ops.deleteFolder(s, uuid));
    }

    dissolveFolder(uuid: string): void {
        this._apply(s => ops.dissolveFolder(s, uuid));
    }

    invalidate(): void {
        this._existsCache.clear();
    }

    addToFolder(uuid: string, id: string, index?: number): void {
        this._apply(s => ops.addToFolder(s, uuid, id, index));
    }

    removeFromFolder(uuid: string, id: string, toIndex?: number): void {
        this._apply(s => ops.removeFromFolder(s, uuid, id, this._rawIndex(s, toIndex)));
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'pinned listener');
    }

    // -- internals -----------------------------------------------------------------------

    /** Parsing a .desktop file per entry on every sync / drop is wasteful: remember the answer. */
    private _desktopFileExists(id: string): boolean {
        let v = this._existsCache.get(id);
        if (v === undefined) {
            v = GioUnix.DesktopAppInfo.new(id) !== null;
            this._existsCache.set(id, v);
        }
        return v;
    }

    private _emit(): void {
        for (const cb of [...this._listeners])
            cb();
    }

    private _folderName(uuid: string): string {
        try {
            return this._watch(uuid).folder.name;
        } catch {
            return '';
        }
    }

    /** Cached FolderSettings with its 'changed' connection owned by a per-folder scope. */
    private _watch(uuid: string): FolderWatch {
        let w = this._folders.get(uuid);
        if (w)
            return w;
        const folder = this._settings.folder(uuid);
        const child = new Scope(`pinned/${uuid}`);
        const release = this._scope.add(() => child.dispose(), `folder ${uuid}`);
        folder.onChanged(child, () => {
            if (this._writing === 0)
                this._externalEmit.call();
        });
        w = {folder, release};
        this._folders.set(uuid, w);
        return w;
    }

    private _unwatch(uuid: string): void {
        this._folders.get(uuid)?.release();
        this._folders.delete(uuid);
    }

    /** Keep exactly one watcher per folder entry in `top`. */
    private _watchFolders(top: readonly Entry[]): void {
        const wanted = new Set(ops.folderUuids(top).filter(isValidFolderId));
        for (const uuid of [...this._folders.keys()]) {
            if (!wanted.has(uuid))
                this._unwatch(uuid);
        }
        for (const uuid of wanted)
            this._watch(uuid);
    }

    private _snapshot(): ops.PinnedSnapshot {
        const top = this._settings.get('pinned-apps');
        this._watchFolders(top);
        const folders: Record<string, Entry[]> = {};
        for (const uuid of ops.folderUuids(top).filter(isValidFolderId))
            folders[uuid] = this._watch(uuid).folder.pinnedApps;
        return {top, folders};
    }

    /** Full-list indices of the entries the UI sees (missing apps left out). */
    private _visibleRaw(s: ops.PinnedSnapshot): number[] {
        const out: number[] = [];
        s.top.forEach((e, i) => {
            if (!isAppEntry(e) || this._exists(e.id))
                out.push(i);
        });
        return out;
    }

    private _rawIndex(s: ops.PinnedSnapshot, visibleIndex: number | undefined): number | undefined {
        if (visibleIndex === undefined)
            return undefined;
        return ops.visibleToRaw(this._visibleRaw(s), s.top.length, visibleIndex);
    }

    private _apply(op: (s: ops.PinnedSnapshot) => ops.PinnedSnapshot): void {
        const prev = this._snapshot();
        const next = op(prev);
        if (next === prev)
            return;

        let changed = false;
        this._writing++;
        try {
            const nameOf = (s: ops.PinnedSnapshot, uuid: string) => s.top.find(e => e.id === uuid)?.name ?? '';

            // Folder contents first, so anything that sees the new top list finds them.
            for (const [uuid, list] of Object.entries(next.folders)) {
                const old = prev.folders[uuid];
                const folder = this._watch(uuid).folder;
                if (!old || !sameEntries(old, list)) {
                    folder.pinnedApps = [...list];
                    changed = true;
                }
                if (!old || nameOf(prev, uuid) !== nameOf(next, uuid)) {
                    folder.name = nameOf(next, uuid);
                    changed = true;
                }
            }
            if (!sameEntries(prev.top, next.top)) {
                this._settings.set('pinned-apps', [...next.top]);
                changed = true;
            }
            for (const uuid of Object.keys(prev.folders)) {
                if (uuid in next.folders)
                    continue;
                this._unwatch(uuid);
                this._settings.deleteFolder(uuid);
                changed = true;
            }
            this._watchFolders(next.top);
        } finally {
            this._writing--;
        }
        if (changed)
            this._emit();
    }
}
