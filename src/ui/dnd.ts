// Pinned-apps drag & drop.
//
// Responsibility: make tiles draggable (DND.makeDraggable, 200 ms press-and-move like the shell's
// app grid), accept drops on the grid (reorder / append), on an app tile (drop in the middle
// creates a folder from the two apps, near the left/right edge reorders), on a folder tile
// (middle adds, edges reorder) and on a "remove from folder" zone. All mutations go through
// PinnedStore. Drop feedback uses the classes spawn-drop-target (middle) and
// spawn-drop-before / spawn-drop-after (reorder).
//
// Public API:
//   enableDrag(scope, tile: St.Widget, payload: DragPayload): void
//   acceptDrops(scope, target: St.Widget, store: PinnedStore, drop: DropTarget): void
//   DragPayload: {id, folderUuid?, isFolder?, isCustom?, onDragBegin?(), onDragEnd?()}
//        id = desktop id (or folder uuid when isFolder); folderUuid = folder the app is dragged from;
//        isCustom = a pinned command (it can be reordered but never goes into a folder)
//   DropTarget:
//     {kind: 'grid'; index: () => number; folderUuid?}   background of a grid (append; index ignored
//                                                         when below 0)
//     {kind: 'app'; id; folderUuid?; isCustom?}           an app tile (folderUuid: tile is inside that folder;
//                                                         isCustom: a command tile, edges only)
//     {kind: 'folder'; uuid}                              a folder tile
//     {kind: 'unfolder'; folderUuid}                      "take the app out of its folder" zone
//                                                         (folderUuid '' = whichever folder the app came from)
//   uniqueFolderName(store): string

import Clutter from 'gi://Clutter';
import type St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {PinnedStore} from '../model/pinned.js';

export interface DragPayload {
    id: string;
    folderUuid?: string;
    isFolder?: boolean;
    isCustom?: boolean;
    onDragBegin?(): void;
    onDragEnd?(): void;
}

export type DropTarget =
    | {kind: 'grid'; index: () => number; folderUuid?: string}
    | {kind: 'app'; id: string; folderUuid?: string; isCustom?: boolean}
    | {kind: 'folder'; uuid: string}
    | {kind: 'unfolder'; folderUuid: string};

type Zone = 'before' | 'onto' | 'after';

interface Delegate {
    spawnPayload?: DragPayload;
    getDragActor?: () => Clutter.Actor;
    getDragActorSource?: () => Clutter.Actor;
    handleDragOver?: (source: Delegate, actor: Clutter.Actor, x: number, y: number) => number;
    acceptDrop?: (source: Delegate, actor: Clutter.Actor, x: number, y: number) => boolean;
}

const DROP_CLASSES = ['spawn-drop-target', 'spawn-drop-before', 'spawn-drop-after'];

function delegateOf(actor: Clutter.Actor): Delegate {
    const holder = actor as unknown as {_delegate?: Delegate};
    holder._delegate ??= {};
    return holder._delegate;
}

function clearDropClasses(widget: St.Widget | null): void {
    if (!widget)
        return;
    try {
        for (const c of DROP_CLASSES)
            widget.remove_style_class_name(c);
    } catch {
        // destroyed mid-drag
    }
}

export function uniqueFolderName(store: PinnedStore): string {
    const taken = new Set(store.items().filter(i => i.kind === 'folder').map(i => (i as {name: string}).name));
    const base = _('New Folder');
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

export function enableDrag(scope: Scope, tile: St.Widget, payload: DragPayload): void {
    const delegate = delegateOf(tile);
    delegate.spawnPayload = payload;
    delegate.getDragActorSource = () => tile;
    delegate.getDragActor = () => {
        const [w, h] = tile.get_transformed_size();
        const clone = new Clutter.Clone({source: tile, opacity: 215});
        clone.set_size(w, h);
        return clone;
    };

    let dead = false;
    const draggable = DND.makeDraggable(tile, {timeoutThreshold: 200});
    let highlighted: St.Widget | null = null;
    const monitor: DND.DragMonitor = {
        dragMotion: event => {
            clearDropClasses(highlighted);
            highlighted = null;
            let a: Clutter.Actor | null = event.targetActor;
            while (a) {
                if ((a as unknown as {_delegate?: Delegate})._delegate?.acceptDrop) {
                    highlighted = a as St.Widget;
                    break;
                }
                a = a.get_parent();
            }
            return DND.DragMotionResult.CONTINUE;
        },
    };
    let monitoring = false;
    const stop = () => {
        if (monitoring)
            DND.removeDragMonitor(monitor);
        monitoring = false;
        clearDropClasses(highlighted);
        highlighted = null;
    };

    draggable.connect('drag-begin', () => {
        try {
            if (!dead)
                tile.add_style_pseudo_class('dragging');
            if (!monitoring)
                DND.addDragMonitor(monitor);
            monitoring = true;
            payload.onDragBegin?.();
        } catch (e) {
            error('drag-begin failed', e);
        }
    });
    draggable.connect('drag-end', () => {
        try {
            stop();
            if (!dead)
                tile.remove_style_pseudo_class('dragging');
            payload.onDragEnd?.();
        } catch (e) {
            error('drag-end failed', e);
        }
    });
    scope.add(() => {
        dead = true;
        stop();
    }, 'drag monitor');
}

function zoneOf(target: St.Widget, x: number): Zone {
    const w = target.width || 1;
    if (x < w * 0.22)
        return 'before';
    if (x > w * 0.78)
        return 'after';
    return 'onto';
}

export function acceptDrops(scope: Scope, target: St.Widget, store: PinnedStore, drop: DropTarget): void {
    const delegate = delegateOf(target);

    const canAccept = (source: Delegate | undefined, zone: Zone): boolean => {
        const p = source?.spawnPayload;
        if (!p)
            return false;
        switch (drop.kind) {
        case 'grid':
            // a pinned command cannot live inside a folder (the folder view only shows apps)
            return !(drop.folderUuid && p.isCustom);
        case 'unfolder':
            return Boolean(p.folderUuid) && !p.isFolder && (!drop.folderUuid || p.folderUuid === drop.folderUuid);
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
    };

    const toZone = (x: number): Zone => drop.kind === 'grid' || drop.kind === 'unfolder' ? 'onto' : zoneOf(target, x);

    delegate.handleDragOver = (source, _actor, x) => {
        const zone = toZone(x);
        clearDropClasses(target);
        if (!canAccept(source, zone))
            return DND.DragMotionResult.NO_DROP;
        if (drop.kind === 'grid')
            return DND.DragMotionResult.MOVE_DROP;
        if (drop.kind === 'unfolder' || zone === 'onto')
            target.add_style_class_name('spawn-drop-target');
        else
            target.add_style_class_name(zone === 'before' ? 'spawn-drop-before' : 'spawn-drop-after');
        return DND.DragMotionResult.MOVE_DROP;
    };

    delegate.acceptDrop = (source, _actor, x) => {
        const zone = toZone(x);
        clearDropClasses(target);
        if (!canAccept(source, zone))
            return false;
        const p = source.spawnPayload as DragPayload;
        try {
            return perform(store, drop, p, zone);
        } catch (e) {
            error('drop failed', e);
            return false;
        }
    };

    scope.add(() => {
        delegate.handleDragOver = undefined;
        delegate.acceptDrop = undefined;
    }, 'drop target');
}

/** Index in the (visible) top-level list to insert at for a drop next to `refIndex`. */
function slotFor(zone: Zone, refIndex: number): number {
    return zone === 'after' ? refIndex + 1 : refIndex;
}

function reorderTop(store: PinnedStore, p: DragPayload, slot: number): boolean {
    if (p.folderUuid) {
        store.removeFromFolder(p.folderUuid, p.id, slot);
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

function perform(store: PinnedStore, drop: DropTarget, p: DragPayload, zone: Zone): boolean {
    switch (drop.kind) {
    case 'unfolder':
        store.removeFromFolder(drop.folderUuid || (p.folderUuid as string), p.id);
        return true;

    case 'grid': {
        if (drop.folderUuid) {
            // Append to the folder (or move to its end).
            store.addToFolder(drop.folderUuid, p.id);
            return true;
        }
        const wanted = drop.index();
        if (p.folderUuid) {
            store.removeFromFolder(p.folderUuid, p.id, wanted >= 0 ? wanted : undefined);
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
            store.createFolder(uniqueFolderName(store), [drop.id, p.id], ref);
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
