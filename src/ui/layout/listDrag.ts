// ListDrag: drag an app out of All Apps / a category / search results / Frequent to pin it.
//
// Responsibility: makes the rows of those lists draggable (same 200 ms press-and-move and drag actor as the
// pinned view's entries; a plain click still launches), and runs the spring-loaded navigation of such a drag:
// while it lasts the Back button (the way to Pinned) shows "Drop to pin" and is a drop target (a drop pins
// the app at the end); keeping the dragged app over it for SPRING_MS switches the left pane to Pinned with
// the drag still running, so it can be dropped between entries or onto a folder (ui/dnd.ts / model/pinnedDrop.ts
// do the rest). Dropping on a pinned app moves it (never a duplicate). The store change goes through the
// Undo banner ("Pinned “X”"). Only offered when Back leads to Pinned (a pinned start view), and a drag
// from search results does not spring (switching view would clear the query and destroy the dragged row).
//
// While it lasts the pointer carries a compact chip (icon + name) rather than a clone of the row.
//
// Public API:
//   new ListDrag(scope, services, state, deps)   deps: {leftPane, views, undo, searching()}
//   listDrag.attach(row: St.Widget, id: string, name: string): void   make `row` a drag source for desktop id `id`

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {enableDrag} from '../dnd.js';
import {lookupApp} from '../util.js';
import type {LeftPane} from './leftPane.js';
import type {UndoController} from './undo.js';
import type {ViewManager} from './views.js';
import type {LayoutState} from './types.js';

/** How long the dragged app must rest on Back before the pane switches to Pinned. */
const SPRING_MS = 500;

export interface ListDragDeps {
    leftPane: LeftPane;
    views: ViewManager;
    undo: UndoController;
    /** A query is typed (the list is the search results). */
    searching(): boolean;
}

export class ListDrag {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _deps: ListDragDeps;
    private _active = 0;
    private _cancelSpring: (() => void) | null = null;
    private _monitoring = false;
    private readonly _monitor: DND.DragMonitor = {
        dragMotion: event => {
            this._onMotion(event.targetActor);
            return DND.DragMotionResult.CONTINUE;
        },
    };

    constructor(scope: Scope, services: Services, state: LayoutState, deps: ListDragDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._deps = deps;
        scope.add(() => this._end(), 'list drag');
    }

    attach(row: St.Widget, id: string, name: string): void {
        if (!id || !this._deps.leftPane.pinnedViaBack())
            return;
        enableDrag(this._scope, row, {
            id,
            fromList: true,
            name,
            dragActor: () => this._chip(id, name),
            apply: change => {
                const msg = this._services.pinned.isPinned(id) ? _('Moved “%s”') : _('Pinned “%s”');
                this._deps.undo.changePinned(msg.format(name), change);
            },
            onDragBegin: () => this._begin(),
            onDragEnd: () => this._end(),
        });
    }

    /** What follows the pointer: the app's icon and name on an accent chip (the row itself may be hidden by the spring-load). */
    private _chip(id: string, name: string): St.Widget {
        const chip = new St.BoxLayout({style_class: 'spawn-drag-chip'});
        const gicon = lookupApp(this._services, id)?.get_icon();
        if (gicon)
            chip.add_child(new St.Icon({gicon, icon_size: 24, y_align: Clutter.ActorAlign.CENTER}));
        chip.add_child(new St.Label({text: name, style_class: 'spawn-drag-chip-label', y_align: Clutter.ActorAlign.CENTER}));
        return chip;
    }

    private _begin(): void {
        this._active++;
        this._deps.leftPane.setPinDrag(true);
        if (!this._monitoring)
            DND.addDragMonitor(this._monitor);
        this._monitoring = true;
    }

    private _end(): void {
        this._active = 0;
        this._cancelSpring?.();
        this._cancelSpring = null;
        if (this._monitoring)
            DND.removeDragMonitor(this._monitor);
        this._monitoring = false;
        if (!this._state.destroyed)
            this._deps.leftPane.setPinDrag(false);
    }

    private _onMotion(target: Clutter.Actor | null): void {
        try {
            const over = this._deps.leftPane.isBackTarget(target);
            if (!over) {
                this._cancelSpring?.();
                this._cancelSpring = null;
                return;
            }
            if (this._cancelSpring || this._deps.searching() || this._state.view === 'pinned')
                return;
            this._cancelSpring = this._scope.timeout(SPRING_MS, () => {
                this._cancelSpring = null;
                if (this._active > 0 && !this._state.destroyed)
                    this._deps.views.setView('pinned');
            });
        } catch (e) {
            error('drag spring-load failed', e);
        }
    }
}
