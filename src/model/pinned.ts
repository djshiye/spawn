// PinnedStore: pinned apps and folders over `pinned-apps` + the relocatable folder
// schema (folders/<uuid>/). STUB: signatures are final, bodies are inert.
//
// Responsibility: read/write the pinned list, keep it consistent (no duplicate ids, empty
// folders are removed), notify on change. Value formats are described in docs/SETTINGS.md:
// app = {id: 'x.desktop'}, folder = {id: '<uuid>', name, isFolder: 'true'},
// custom item = {id, name, icon}. The pure list manipulation SHOULD live in
// exported pure functions so it can be unit-tested with gjs -m.
//
// Public API:
//   new PinnedStore(scope, settings)
//   store.items(): PinnedItem[]                     top level, in order
//   store.folderApps(uuid): Entry[]
//   store.isPinned(id): boolean                     anywhere, including inside folders
//   store.pin(id, index?): void
//   store.unpin(id): void                           also removes it from a folder
//   store.move(fromIndex, toIndex): void            reorder top level
//   store.createFolder(name, ids, index?): string   returns the new uuid; ids move into it
//   store.renameFolder(uuid, name): void
//   store.deleteFolder(uuid): void                  contained apps are unpinned
//   store.addToFolder(uuid, id, index?): void       moves from top level / other folder
//   store.removeFromFolder(uuid, id, toIndex?): void  moves the app back to the top level
//   store.onChanged(scope, cb)                      cb() when pinned-apps or any folder changes

import type {Scope} from '../core/scope.js';
import type {Entry, SpawnSettings} from '../core/settings.js';

export type PinnedItem =
    | {kind: 'app'; id: string}
    | {kind: 'folder'; uuid: string; name: string}
    | {kind: 'custom'; entry: Entry};

export class PinnedStore {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
    }

    items(): PinnedItem[] {
        void this._scope;
        return this._settings.get('pinned-apps').map((entry): PinnedItem => {
            if (entry.isFolder === 'true')
                return {kind: 'folder', uuid: entry.id, name: entry.name ?? ''};
            if (entry.id.endsWith('.desktop') && !entry.name)
                return {kind: 'app', id: entry.id};
            return {kind: 'custom', entry};
        });
    }

    folderApps(_uuid: string): Entry[] {
        return [];
    }

    isPinned(id: string): boolean {
        return this._settings.get('pinned-apps').some(e => e.id === id);
    }

    pin(_id: string, _index?: number): void {
        // TODO(model owner)
    }

    unpin(_id: string): void {
        // TODO(model owner)
    }

    move(_fromIndex: number, _toIndex: number): void {
        // TODO(model owner)
    }

    createFolder(_name: string, _ids: string[], _index?: number): string {
        // TODO(model owner)
        return '';
    }

    renameFolder(_uuid: string, _name: string): void {
        // TODO(model owner)
    }

    deleteFolder(_uuid: string): void {
        // TODO(model owner)
    }

    addToFolder(_uuid: string, _id: string, _index?: number): void {
        // TODO(model owner)
    }

    removeFromFolder(_uuid: string, _id: string, _toIndex?: number): void {
        // TODO(model owner)
    }

    onChanged(_scope: Scope, _cb: () => void): void {
        // TODO(model owner)
    }
}
