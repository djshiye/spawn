// SpawnPopup: the ONE popup shared by every panel button, re-anchored to whichever button
// was clicked. Built lazily: nothing exists until the first open().
//
// Responsibility: own the PopupMenu + PopupMenuManager (outside click / Escape handling,
// modal grab) for the current anchor, host the SpawnLayout, report open/close.
// NOTE for the UI owner: the arrow side is hard-coded to St.Side.TOP; pick it from the target
// panel's position (e.g. BOTTOM for a Dash to Panel bottom panel).
// Re-anchoring recreates the PopupMenu shell for the new anchor and re-parents the (already
// built, expensive) layout actor into it; the layout itself is built once.
//
// Public API:
//   new SpawnPopup(scope, services)
//   popup.isOpen: boolean
//   popup.anchor: St.Widget | null     the button the popup is currently attached to
//   popup.open(anchor): void           never throws; ignores dead anchors
//   popup.close(): void
//   popup.toggle(anchor): void         close if open on this anchor, otherwise open there
//   popup.onOpenStateChanged(scope, cb(open: boolean, anchor: St.Widget | null))
//   popup.prebuild(): void             optional: build the layout on idle (no UI shown)

import St from 'gi://St';

import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {Services} from '../core/services.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import {isActorAlive} from '../panel/validate.js';
import {SpawnLayout} from './layout.js';

type OpenListener = (open: boolean, anchor: St.Widget | null) => void;

export class SpawnPopup {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _listeners = new Set<OpenListener>();

    private _anchorScope: Scope | null = null;
    private _anchor: St.Widget | null = null;
    private _menu: PopupMenu.PopupMenu | null = null;
    private _layout: SpawnLayout | null = null;
    private _layoutScope: Scope | null = null;
    private _open = false;

    constructor(scope: Scope, services: Services) {
        this._scope = scope;
        this._services = services;
        scope.add(() => this._teardown(), 'SpawnPopup');
    }

    get isOpen(): boolean {
        return this._open;
    }

    get anchor(): St.Widget | null {
        return this._anchor;
    }

    onOpenStateChanged(scope: Scope, cb: OpenListener): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'SpawnPopup listener');
    }

    prebuild(): void {
        try {
            this._ensureLayout();
        } catch (e) {
            error('popup prebuild failed', e);
        }
    }

    open(anchor: St.Widget): void {
        try {
            if (!isActorAlive(anchor))
                return;
            if (this._anchor !== anchor)
                this._attach(anchor);
            this._menu?.open(PopupAnimation.FULL);
        } catch (e) {
            error('popup open failed', e);
        }
    }

    close(): void {
        try {
            this._menu?.close(PopupAnimation.FULL);
        } catch (e) {
            error('popup close failed', e);
        }
    }

    toggle(anchor: St.Widget): void {
        if (this._open && this._anchor === anchor)
            this.close();
        else
            this.open(anchor);
    }

    private _ensureLayout(): SpawnLayout {
        if (!this._layout) {
            this._layoutScope = this._scope.child('layout');
            this._layout = new SpawnLayout(this._layoutScope, this._services, {close: () => this.close()});
        }
        return this._layout;
    }

    private _attach(anchor: St.Widget): void {
        this._release();

        const layout = this._ensureLayout();
        const anchorScope = this._scope.child('anchor');
        const menu = new PopupMenu.PopupMenu(anchor, 0.5, St.Side.TOP);
        const manager = new PopupMenu.PopupMenuManager(anchor);

        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        menu.actor.add_style_class_name('spawn-menu-popup');
        manager.addMenu(menu);

        layout.actor.get_parent()?.remove_child(layout.actor);
        menu.box.add_child(layout.actor);

        anchorScope.connect(menu, 'open-state-changed', (_menu: unknown, open: boolean) => this._onOpenState(open));
        // A destroyed anchor (panel extension restart) takes the popup shell with it.
        anchorScope.connect(anchor, 'destroy', () => this._release());
        anchorScope.add(() => {
            // Rescue the layout before the shell around it is destroyed.
            if (layout.actor.get_parent())
                layout.actor.get_parent()?.remove_child(layout.actor);
            manager.removeMenu(menu);
            menu.close(PopupAnimation.NONE);
            menu.destroy();
        }, 'popup menu');

        this._anchorScope = anchorScope;
        this._anchor = anchor;
        this._menu = menu;
    }

    private _release(): void {
        const wasOpen = this._open;
        const anchor = this._anchor;
        const scope = this._anchorScope;
        this._anchorScope = null;
        this._anchor = null;
        this._menu = null;
        scope?.dispose();
        if (wasOpen)
            this._onOpenState(false, anchor);
    }

    private _onOpenState(open: boolean, anchor: St.Widget | null = this._anchor): void {
        this._open = open;
        try {
            if (anchor && isActorAlive(anchor)) {
                if (open)
                    anchor.add_style_pseudo_class('active');
                else
                    anchor.remove_style_pseudo_class('active');
            }
            if (open)
                this._layout?.onOpen();
            else
                this._layout?.onClosed();
        } catch (e) {
            error('popup open-state handler failed', e);
        }
        for (const cb of [...this._listeners]) {
            try {
                cb(open, anchor);
            } catch (e) {
                error('popup listener threw', e);
            }
        }
    }

    private _teardown(): void {
        this._release();
        this._layoutScope?.dispose();
        this._layoutScope = null;
        this._layout = null;
        this._listeners.clear();
    }
}
