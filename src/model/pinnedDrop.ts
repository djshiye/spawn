// Pinned-apps drop logic: which drops are allowed and what a drop does to the PinnedStore.
//
// Responsibility: the widget-free half of ui/dnd.ts (so it is unit-tested): given what is dragged (a
// DragPayload) and where it lands (a DropTarget + Zone), `canDrop` says whether the drop is allowed and
// `performDrop` writes it through the store. A payload with `fromList` comes from a list that is not the
// pinned view (All Apps, a category, search results, Frequent): its app may not be pinned yet (the drop
// pins it at the slot) or may be pinned already (the drop moves it, never a duplicate).
//
// Public API:
//   DragPayload     {id, folderUuid?, isFolder?, isCustom?, fromList?, name?, apply?(change), onDragBegin?(), onDragEnd?()}
//                   apply: the drop runs its store change through it (the layout wraps it in the Undo banner)
//   DropTarget      {kind: 'grid'; index; folderUuid?} | {kind: 'app'; id; folderUuid?; isCustom?} |
//                   {kind: 'folder'; uuid} | {kind: 'unfolder'; folderUuid} |
//                   {kind: 'back'}   the Back button: takes an app out of its folder, or pins a list app at the end
//   Zone            'before' | 'onto' | 'after'
//   canDrop(p, drop, zone): boolean
//   performDrop(store, drop, p, zone, folderName: () => string): boolean
//   uniqueName(store, base): string   `base`, or `base 2`, `base 3`... when a folder already has that name

import type {PinnedStore} from './pinned.js';

export interface DragPayload {
    id: string;
    folderUuid?: string;
    isFolder?: boolean;
    isCustom?: boolean;
    /** Dragged out of a list that is not the pinned view (the app may not be pinned yet). */
    fromList?: boolean;
    /** Display name for the Undo banner (fromList only). */
    name?: string;
    /** Runs the store change of a drop (fromList only); without it the drop writes directly. */
    apply?(change: () => void): void;
    /** An actor to drag instead of a clone of the source (the source may be hidden while the drag lasts). */
    dragActor?(): unknown;
    onDragBegin?(): void;
    onDragEnd?(): void;
}

export type DropTarget =
    | {kind: 'grid'; index: () => number; folderUuid?: string}
    | {kind: 'app'; id: string; folderUuid?: string; isCustom?: boolean}
    | {kind: 'folder'; uuid: string}
    | {kind: 'unfolder'; folderUuid: string}
    | {kind: 'back'};

export type Zone = 'before' | 'onto' | 'after';

export function canDrop(p: DragPayload, drop: DropTarget, zone: Zone): boolean {
    switch (drop.kind) {
    case 'grid':
        // a pinned command cannot live inside a folder (the folder view only shows apps)
        return !(drop.folderUuid && p.isCustom);
    case 'unfolder':
        return Boolean(p.folderUuid) && !p.isFolder && (!drop.folderUuid || p.folderUuid === drop.folderUuid);
    case 'back':
        return Boolean(p.fromList) || (Boolean(p.folderUuid) && !p.isFolder);
    case 'app':
        if (p.id === drop.id)
            return false;
        // commands are reordered, never merged into a folder (onto) or dropped into one
        if ((drop.isCustom || p.isCustom) && (zone === 'onto' || drop.folderUuid))
            return false;
        if (drop.folderUuid)
            return !p.isFolder;
        return zone !== 'onto' || !p.isFolder;
    case 'folder':
        if (p.isFolder && p.id === drop.uuid)
            return false;
        if (p.isCustom && zone === 'onto')
            return false;
        if (!p.isFolder && p.folderUuid === drop.uuid && zone === 'onto')
            return false;
        return zone !== 'onto' || !p.isFolder;
    }
}

export function uniqueName(store: PinnedStore, base: string): string {
    const taken = new Set(store.items().filter(i => i.kind === 'folder').map(i => (i as {name: string}).name));
    if (!taken.has(base))
        return base;
    for (let n = 2; ; n++) {
        if (!taken.has(`${base} ${n}`))
            return `${base} ${n}`;
    }
}

function topIndexOf(store: PinnedStore, id: string): number {
    return store.items().findIndex(i =>
        (i.kind === 'app' && i.id === id) ||
        (i.kind === 'folder' && i.uuid === id) ||
        (i.kind === 'custom' && i.entry.id === id));
}

/** Index in the folder's FULL list (missing apps included: the folder view shows them as ghosts). */
function folderIndexOf(store: PinnedStore, uuid: string, id: string): number {
    return store.folderApps(uuid, true).findIndex(e => e.id === id);
}

/** The folder an app is pinned in when it was not dragged out of that folder's own view (a drag from a list). */
function folderOf(store: PinnedStore, p: DragPayload): string | undefined {
    if (p.folderUuid)
        return p.folderUuid;
    if (!p.fromList || p.isFolder || p.isCustom || topIndexOf(store, p.id) >= 0)
        return undefined;
    for (const item of store.items()) {
        if (item.kind === 'folder' && folderIndexOf(store, item.uuid, p.id) >= 0)
            return item.uuid;
    }
    return undefined;
}

/** Index in the (visible) top-level list to insert at for a drop next to `refIndex`. */
function slotFor(zone: Zone, refIndex: number): number {
    return zone === 'after' ? refIndex + 1 : refIndex;
}

function reorderTop(store: PinnedStore, p: DragPayload, slot: number): boolean {
    const folder = folderOf(store, p);
    if (folder) {
        store.removeFromFolder(folder, p.id, slot);
        return true;
    }
    const from = topIndexOf(store, p.id);
    if (from < 0) {
        store.pin(p.id, slot);
        return true;
    }
    const to = from < slot ? slot - 1 : slot;
    if (to !== from)
        store.move(from, to);
    return true;
}

function perform(store: PinnedStore, drop: DropTarget, p: DragPayload, zone: Zone, folderName: () => string): boolean {
    switch (drop.kind) {
    case 'unfolder':
        store.removeFromFolder(drop.folderUuid || (p.folderUuid as string), p.id);
        return true;

    case 'back':
        if (p.fromList)
            return reorderTop(store, p, store.items().length);
        store.removeFromFolder(p.folderUuid as string, p.id);
        return true;

    case 'grid': {
        if (drop.folderUuid) {
            // Append to the folder (or move to its end).
            store.addToFolder(drop.folderUuid, p.id);
            return true;
        }
        const wanted = drop.index();
        const folder = folderOf(store, p);
        if (folder) {
            store.removeFromFolder(folder, p.id, wanted >= 0 ? wanted : undefined);
            return true;
        }
        const len = store.items().length;
        return reorderTop(store, p, wanted >= 0 ? wanted : len);
    }

    case 'app': {
        if (drop.folderUuid) {
            const ref = folderIndexOf(store, drop.folderUuid, drop.id);
            if (ref < 0)
                return false;
            // Inside a folder "onto" counts as "before".
            store.addToFolder(drop.folderUuid, p.id, slotFor(zone === 'after' ? 'after' : 'before', ref));
            return true;
        }
        const ref = topIndexOf(store, drop.id);
        if (ref < 0)
            return false;
        if (zone === 'onto') {
            store.createFolder(uniqueName(store, folderName()), [drop.id, p.id], ref);
            return true;
        }
        return reorderTop(store, p, slotFor(zone, ref));
    }

    case 'folder': {
        if (zone === 'onto') {
            store.addToFolder(drop.uuid, p.id);
            return true;
        }
        const ref = topIndexOf(store, drop.uuid);
        if (ref < 0)
            return false;
        return reorderTop(store, p, slotFor(zone, ref));
    }
    }
}

/** Write a drop through the store (inside `p.apply` when the payload has one). False: nothing was dropped. */
export function performDrop(store: PinnedStore, drop: DropTarget, p: DragPayload, zone: Zone, folderName: () => string): boolean {
    if (!p.apply)
        return perform(store, drop, p, zone, folderName);
    let done = false;
    p.apply(() => {
        done = perform(store, drop, p, zone, folderName);
    });
    return done;
}
