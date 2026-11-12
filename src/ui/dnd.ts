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
//   acceptDrops(scope, target: St.Widget, store: PinnedStore, drop: DropTarget, opts?: {vertical?, enabled?}): void
//        vertical: the target is a row of a vertical list, so before / onto / after are the
//        top / middle / bottom bands (default: left / middle / right bands of a grid tile)
//        enabled: asked on every motion and drop; false = the target refuses (the Grid header's pill is a
//        drop target only in the All apps view)
//   DragPayload: {id, folderUuid?, isFolder?, isCustom?, fromList?, name?, apply?, onDragBegin?(), onDragEnd?()}
//        id = desktop id (or folder uuid when isFolder); folderUuid = folder the app is dragged from;
//        isCustom = a pinned command (it can be reordered but never goes into a folder);
//        dragActor = an actor of its own instead of a clone of the source (drags that outlive the source),
//        fromList = dragged out of All Apps / a category / results (not pinned yet, or pinned: then it moves),
//        apply wraps the store change (Undo banner). The rules live in model/pinnedDrop.ts (unit-tested).
//   DropTarget:
//     {kind: 'grid'; index: () => number; folderUuid?}   background of a grid (append; index ignored
//                                                         when below 0)
//     {kind: 'app'; id; folderUuid?; isCustom?}           an app tile (folderUuid: tile is inside that folder;
//                                                         isCustom: a command tile, edges only)
//     {kind: 'folder'; uuid}                              a folder tile
//     {kind: 'unfolder'; folderUuid}                      "take the app out of its folder" zone
//                                                         (folderUuid '' = whichever folder the app came from)
//     {kind: 'back'}                                      the Back button (Grid: the header's pill): takes the app
//                                                         out of its folder, or pins an app dragged from a list at the end
//   rejectDrops(scope, target: St.Widget): void
//        the target (a ghost row / tile of a missing app) shows "no drop" and swallows a drop on it
//        (does nothing), so it does not bubble to the list's append-at-end target
//   uniqueFolderName(store): string
//
// While a drag is held within AUTOSCROLL_EDGE px of the top / bottom edge of the St.ScrollView under the
// pointer, that view scrolls (GNOME's DND grabs the pointer, so the wheel does not work mid-drag).
//
//   setDragPaging(scope, paging: DragPaging): void
//        The Grid layout's paged pinned grid takes over: `paging.handles(view)` views are not scrolled by pixels;
//        `paging.motion(x, y, target)` sees every motion of a Spawn drag (edge zones and page dots turn whole
//        pages, see GridPager), `paging.end()` is called when the drag ends.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {PinnedStore} from '../model/pinned.js';
import {canDrop, performDrop, uniqueName, type DragPayload, type DropTarget, type Zone} from '../model/pinnedDrop.js';
import {surfaceOf} from './widgets/interact.js';

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

/** The Grid layout's pager (one at a time): pages instead of pixels. */
export interface DragPaging {
    handles(view: St.ScrollView): boolean;
    motion(x: number, y: number, target: Clutter.Actor | null): void;
    end(): void;
}

let paging: DragPaging | null = null;

export function setDragPaging(scope: Scope, p: DragPaging): void {
    paging = p;
    scope.add(() => {
        if (paging === p)
            paging = null;
    }, 'drag paging');
}

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
    return uniqueName(store, _('New Folder'));
}

export type {DragPayload, DropTarget};

export function enableDrag(scope: Scope, tile: St.Widget, payload: DragPayload): void {
    const delegate = delegateOf(tile);
    delegate.spawnPayload = payload;
    delegate.getDragActorSource = () => tile;
    delegate.getDragActor = () => {
        const [w, h] = tile.get_transformed_size();
        // A drag out of a list can outlive its source (spring-loaded navigation hides the list, and a Clone of a
        // hidden actor paints distorted): those drags bring their own actor.
        const own = payload.dragActor?.() as Clutter.Actor | undefined;
        if (own)
            return own;
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
        if (view && paging?.handles(view))
            view = null;
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
                paging?.motion(event.x, event.y, event.targetActor);
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
        if (monitoring) {
            DND.removeDragMonitor(monitor);
            paging?.end();
        }
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
    const release = scope.add(() => {
        dead = true;
        stop();
    }, 'drag monitor');
    // A row of a list that is rebuilt (All Apps, results) goes away long before the layout's scope does.
    tile.connect('destroy', () => release());
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

export function acceptDrops(scope: Scope, target: St.Widget, store: PinnedStore, drop: DropTarget, opts: {vertical?: boolean; enabled?: () => boolean} = {}): void {
    const vertical = Boolean(opts.vertical);
    const delegate = delegateOf(target);

    const canAccept = (source: Delegate | undefined, zone: Zone): boolean => {
        const p = source?.spawnPayload;
        return Boolean(p) && (opts.enabled?.() ?? true) && canDrop(p as DragPayload, drop, zone);
    };

    let last: {zone: Zone; at: number} | null = null;
    const toZone = (x: number, y: number, remember: boolean): Zone => {
        if (drop.kind === 'grid' || drop.kind === 'unfolder' || drop.kind === 'back')
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
        if (drop.kind === 'unfolder' || drop.kind === 'back' || zone === 'onto')
            face.add_style_class_name('spawn-drop-target');
        else
            face.add_style_class_name(zone === 'before' ? 'spawn-drop-before' : 'spawn-drop-after');
        return DND.DragMotionResult.MOVE_DROP;
    };

    delegate.acceptDrop = (source, _actor, x, y) => {
        const zone = toZone(x, y, false);
        clearDropClasses(target);
        if (!canAccept(source, zone)) {
            // A refused Spawn drag on a tile is claimed and ignored: returning false would let an ancestor's
            // "append at the end" grid target take it.
            return !!source?.spawnPayload && (drop.kind === 'app' || drop.kind === 'folder');
        }
        const p = source.spawnPayload as DragPayload;
        try {
            return performDrop(store, drop, p, zone, () => _('New Folder'));
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
