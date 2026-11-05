// Pinned-apps drag & drop.
//
// Responsibility: make tiles draggable (DND.makeDraggable, 200 ms press-and-move like the shell's
// app grid), accept drops on the grid or list (reorder / append), on an app tile or row (drop in
// the middle creates a folder from the two apps, near the left/right edge - top/bottom edge in a
// vertical list - reorders; the bands are fractions of the entry's visible face, with a little
// hysteresis so the pointer resting on a band edge does not flicker), on a folder tile / row (middle adds, edges reorder) and on a "remove
// from folder" zone. All mutations go through PinnedStore. Drop feedback uses the classes
// spawn-drop-target (middle) and spawn-drop-before / spawn-drop-after (reorder).
//
// Public API:
//   enableDrag(scope, tile: St.Widget, payload: DragPayload): void
//   acceptDrops(scope, target: St.Widget, store: PinnedStore, drop: DropTarget, opts?: {vertical?}): void
//        vertical: the target is a row of a vertical list, so before / onto / after are the
//        top / middle / bottom bands (default: left / middle / right bands of a grid tile)
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
//   rejectDrops(scope, target: St.Widget): void
//        the target (a ghost row / tile of a missing app) shows "no drop" and swallows a drop on it
//        (does nothing), so it does not bubble to the list's append-at-end target
//   uniqueFolderName(store): string
//
// While a drag is held within AUTOSCROLL_EDGE px of the top / bottom edge of the St.ScrollView under the
// pointer, that view scrolls (GNOME's DND grabs the pointer, so the wheel does not work mid-drag).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {PinnedStore} from '../model/pinned.js';
import {surfaceOf} from './widgets/interact.js';

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

/** Distance from a scroll view's top / bottom edge where a drag starts scrolling it, and the speed. */
const AUTOSCROLL_EDGE = 28;
const AUTOSCROLL_STEP = 14;
const AUTOSCROLL_TICK_MS = 40;

const DROP_CLASSES = ['spawn-drop-target', 'spawn-drop-before', 'spawn-drop-after'];

/**
 * Hysteresis of the before / onto / after bands: the band the pointer is in keeps this many px of
 * extra room, so hovering exactly on a band edge does not flicker between "reorder" and "onto".
 * The memory is dropped when no motion came for ZONE_MEMORY_MS (the pointer was elsewhere).
 */
const ZONE_HYSTERESIS = 3;
const ZONE_MEMORY_MS = 250;

function delegateOf(actor: Clutter.Actor): Delegate {
    const holder = actor as unknown as {_delegate?: Delegate};
    holder._delegate ??= {};
    return holder._delegate;
}

function clearDropClasses(widget: St.Widget | null): void {
    if (!widget)
        return;
    try {
        // pinned rows / tiles show the feedback on their visible face, not on the transparent button
        const face = surfaceOf(widget);
        for (const c of DROP_CLASSES)
            face.remove_style_class_name(c);
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
    let scrolling: {view: St.ScrollView; dir: number} | null = null;
    let cancelScroll: (() => void) | null = null;
    const stopScroll = () => {
        scrolling = null;
        cancelScroll?.();
        cancelScroll = null;
    };
    const nudge = (view: St.ScrollView, dir: number) => {
        const adj = view.vadjustment;
        adj.value = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, adj.value + dir * AUTOSCROLL_STEP));
    };
    // Scroll the view under the pointer while it sits in the edge band; keeps going without motion.
    const updateScroll = (event: DND.DragEvent) => {
        let view: St.ScrollView | null = null;
        for (let a: Clutter.Actor | null = event.targetActor; a && !view; a = a.get_parent()) {
            if (a instanceof St.ScrollView)
                view = a;
        }
        let dir = 0;
        if (view) {
            const [, top] = view.get_transformed_position();
            const [, height] = view.get_transformed_size();
            if (event.y < top + AUTOSCROLL_EDGE)
                dir = -1;
            else if (event.y > top + height - AUTOSCROLL_EDGE)
                dir = 1;
        }
        if (!view || dir === 0) {
            stopScroll();
            return;
        }
        scrolling = {view, dir};
        nudge(view, dir);
        cancelScroll ??= scope.interval(AUTOSCROLL_TICK_MS, () => {
            if (!scrolling || dead) {
                cancelScroll = null;
                return false;
            }
            nudge(scrolling.view, scrolling.dir);
            return true;
        });
    };
    const monitor: DND.DragMonitor = {
        dragMotion: event => {
            clearDropClasses(highlighted);
            highlighted = null;
            try {
                updateScroll(event);
            } catch (e) {
                error('drag auto-scroll failed', e);
                stopScroll();
            }
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
        stopScroll();
        clearDropClasses(highlighted);
        highlighted = null;
    };

    // The 49 typings declare these two signal callbacks as returning `boolean | undefined`, hence `undefined`.
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
        return undefined;
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
        return undefined;
    });
    scope.add(() => {
        dead = true;
        stop();
    }, 'drag monitor');
}

/**
 * Bands of a grid tile (left / middle / right) or, `vertical`, of a list row (top / middle /
 * bottom): 22 % / 30 % of the VISIBLE face on each side, so they scale with the row height. The
 * transparent gap around the face counts as the nearest outer band. `prev` (the zone of the last
 * motion over this target) widens its own band by ZONE_HYSTERESIS px.
 */
function zoneOf(target: St.Widget, x: number, y: number, vertical: boolean, prev: Zone | null): Zone {
    const face = surfaceOf(target);
    const inner = face !== target;
    const origin = inner ? (vertical ? face.y : face.x) : 0;
    const size = (vertical ? (inner ? face.height : target.height) : (inner ? face.width : target.width)) || 1;
    const pos = (vertical ? y : x) - origin;
    const edge = size * (vertical ? 0.3 : 0.22);
    const before = edge + (prev === 'before' ? ZONE_HYSTERESIS : prev === 'onto' ? -ZONE_HYSTERESIS : 0);
    const after = size - edge - (prev === 'after' ? ZONE_HYSTERESIS : prev === 'onto' ? -ZONE_HYSTERESIS : 0);
    if (pos < before)
        return 'before';
    if (pos > after)
        return 'after';
    return 'onto';
}

export function acceptDrops(scope: Scope, target: St.Widget, store: PinnedStore, drop: DropTarget, opts: {vertical?: boolean} = {}): void {
    const vertical = Boolean(opts.vertical);
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

    let last: {zone: Zone; at: number} | null = null;
    const toZone = (x: number, y: number, remember: boolean): Zone => {
        if (drop.kind === 'grid' || drop.kind === 'unfolder')
            return 'onto';
        const now = GLib.get_monotonic_time() / 1000;
        const prev = last && now - last.at <= ZONE_MEMORY_MS ? last.zone : null;
        const zone = zoneOf(target, x, y, vertical, prev);
        last = remember ? {zone, at: now} : null;
        return zone;
    };

    delegate.handleDragOver = (source, _actor, x, y) => {
        const zone = toZone(x, y, true);
        clearDropClasses(target);
        if (!canAccept(source, zone))
            return DND.DragMotionResult.NO_DROP;
        if (drop.kind === 'grid')
            return DND.DragMotionResult.MOVE_DROP;
        const face = surfaceOf(target);
        if (drop.kind === 'unfolder' || zone === 'onto')
            face.add_style_class_name('spawn-drop-target');
        else
            face.add_style_class_name(zone === 'before' ? 'spawn-drop-before' : 'spawn-drop-after');
        return DND.DragMotionResult.MOVE_DROP;
    };

    delegate.acceptDrop = (source, _actor, x, y) => {
        const zone = toZone(x, y, false);
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

/**
 * A target that refuses every drop. Ghost rows (pinned apps that are no longer installed) use it:
 * they are not part of the store's visible index, so letting the drag fall through to the list's
 * "append at the end" target would silently move the dragged app to the end. The shell's DND only
 * stops at the first ancestor whose acceptDrop returns true (false means "try the parent"), so the
 * drop is claimed and then ignored.
 */
export function rejectDrops(scope: Scope, target: St.Widget): void {
    const delegate = delegateOf(target);
    delegate.handleDragOver = () => {
        clearDropClasses(target);
        return DND.DragMotionResult.NO_DROP;
    };
    delegate.acceptDrop = () => {
        clearDropClasses(target);
        return true;
    };
    scope.add(() => {
        delegate.handleDragOver = undefined;
        delegate.acceptDrop = undefined;
    }, 'reject drops');
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
