// SpawnPopup: the ONE popup shared by every panel button, re-anchored to whichever button
// was clicked. Built lazily: nothing exists until the first open().
//
// Responsibility: own the PopupMenu + PopupMenuManager (outside click / Escape handling,
// modal grab) for the current anchor, host the SpawnLayout, report open/close.
// The arrow side comes from the anchor (`MenuButton.arrowSide`, default TOP). Escape is offered to
// the layout first (clear search / leave a sub-view); only an unconsumed Escape closes the menu.
// Re-anchoring recreates the PopupMenu shell for the new anchor and re-parents the (already
// built, expensive) layout actor into it; the layout itself is built once.
// While the popup is open on a Dash to Panel panel with intellihide, that panel is held revealed
// (panel/intellihide.ts); the hold is given back on close, once the pointer is off the panel.
// The popup actor carries `spawn-popup spawn-menu-popup` (the theme's `menu-arrow-rise` targets
// .spawn-menu-popup only; the runner shares .spawn-popup). `menu-position-alignment` moves a popup under
// a panel button that is centred in the panel (see _align).
// A popup that opens upward (bottom panel, arrow side BOTTOM) gets the class `spawn-popup-above`
// (stylesheet.css moves Orchis' 14 px shadow margin from below the content to above it, so the gap
// to the panel matches the one under a top panel). On every open the popup tells the layout which
// anchor / side it opens from (work-area clamping, search position "Auto") and tags itself
// `spawn-light` when the shell theme's popup text is dark (light shell theme).
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
//   popup.side: St.Side                the arrow side of the current attachment
//   popup.menuActor / popup.layoutActor   dev hooks: the PopupMenu actor / the layout root (or null)
//   popup.resetLayout() / popup.layoutBuilt   dev / benchmark: drop the built layout; is it built
//   popup.search(q) / popup.showView(id) / popup.showAllApps() / popup.openFolderByIndex(i) / popup.debugState() / popup.setFakePlaces(specs)
//                                      thin forwards to the layout (dev hooks, MenuController.search)

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {Services} from '../core/services.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {IntellihideHold} from '../panel/intellihide.js';
import {createIntellihideHold} from '../panel/targets.js';
import {isActorAlive} from '../panel/validate.js';
import type {FakePlace} from '../model/places.js';
import {installUiDevHooks} from './devHooks.js';
import {SpawnLayout} from './layout.js';
import {closeMenu, openMenu, silenceSourceKeys} from './menuParams.js';
import {applyTone, ownedScope} from './util.js';

type OpenListener = (open: boolean, anchor: St.Widget | null) => void;

interface KeyControllerLike {
    connect(signal: 'key-press', cb: () => boolean): number;
    get_key(): [boolean, number, number];
}

export class SpawnPopup {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _listeners = new Set<OpenListener>();

    private _anchorOwned: {scope: Scope; release(): void} | null = null;
    private _anchor: St.Widget | null = null;
    private _side: St.Side = St.Side.TOP;
    private _menu: PopupMenu.PopupMenu | null = null;
    private _layout: SpawnLayout | null = null;
    private _layoutScope: Scope | null = null;
    private _open = false;
    private readonly _intellihide: IntellihideHold;

    constructor(scope: Scope, services: Services) {
        this._scope = scope;
        this._services = services;
        this._intellihide = createIntellihideHold(scope.child('intellihide'));
        scope.add(() => this._teardown(), 'SpawnPopup');
        try {
            installUiDevHooks(scope.child('ui dev hooks'), services.settings, this, services.appIndex);
        } catch (e) {
            error('ui dev hooks failed', e);
        }
    }

    search(query: string): void {
        this._ensureLayout().search(query);
    }

    showView(id: string): void {
        this._layout?.showView(id);
    }

    /** Switch an open popup to the all-apps view (what the Spawn_ShowAllApplications shortcut does). */
    showAllApps(): void {
        this._layout?.showAllApps();
    }

    openFolderByIndex(index: number): void {
        this._layout?.openFolderByIndex(index);
    }

    /** Dev hook (Ui.SetPlaces): fake devices / bookmarks in the right pane; null = the real ones. */
    setFakePlaces(specs: FakePlace[] | null): void {
        this._ensureLayout().setFakePlaces(specs);
    }

    /** Dev / benchmark only: drop the built layout (and the anchor) so the next open() rebuilds it. */
    resetLayout(): void {
        this._release();
        this._layoutScope?.dispose();
        this._layoutScope = null;
        this._layout = null;
    }

    get layoutBuilt(): boolean {
        return this._layout !== null;
    }

    debugState(): Record<string, unknown> {
        return {
            open: this._open,
            anchor: this._anchor ? this._anchor.constructor.name : null,
            side: this._side,
            layout: this._layout?.debugState() ?? null,
        };
    }

    get isOpen(): boolean {
        return this._open;
    }

    get side(): St.Side {
        return this._side;
    }

    get menuActor(): St.Widget | null {
        return this._menu?.actor ?? null;
    }

    get layoutActor(): St.Widget | null {
        return this._layout?.actor ?? null;
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
            if (this._anchor !== anchor || this._side !== this._sideOf(anchor))
                this._attach(anchor);
            if (this._menu) {
                // Reveal an intellihide panel BEFORE the menu positions itself against the button.
                this._intellihide.hold(anchor);
                openMenu(this._menu);
                if (!this._open)
                    this._intellihide.release();
            }
        } catch (e) {
            error('popup open failed', e);
        }
    }

    close(): void {
        try {
            if (this._menu)
                closeMenu(this._menu);
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

    private _sideOf(anchor: St.Widget): St.Side {
        const side = (anchor as unknown as {arrowSide?: St.Side}).arrowSide;
        return typeof side === 'number' ? side : St.Side.TOP;
    }

    private _attach(anchor: St.Widget): void {
        this._release();
        const side = this._sideOf(anchor);

        const layout = this._ensureLayout();
        const anchorOwned = ownedScope(this._scope, 'anchor');
        const anchorScope = anchorOwned.scope;
        const menu = new PopupMenu.PopupMenu(anchor, 0.5, side);
        const manager = new PopupMenu.PopupMenuManager(anchor);
        // The shell's PopupMenu handles Return / Space / arrow on the anchor (toggles the menu), which would
        // bypass the click-action settings (button.ts handles those keys).
        silenceSourceKeys(menu);

        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        menu.actor.add_style_class_name('spawn-popup spawn-menu-popup');
        if (side === St.Side.BOTTOM)
            menu.actor.add_style_class_name('spawn-popup-above');

        // Offer Escape to the layout before the manager's own (capture-phase) handler closes the
        // menu. Added before the manager adds its handler, so it runs first.
        const escape = (): boolean => this._layout?.handleKey({get_key_symbol: () => Clutter.KEY_Escape}) ?? false;
        // Typed by hand: the 49 typings (and 50's) lack Clutter.KeyController.
        const KeyController = (Clutter as unknown as {KeyController?: new () => KeyControllerLike}).KeyController;
        if (KeyController) {
            const keys = new KeyController();
            keys.connect('key-press', () => {
                const [, sym] = keys.get_key();
                return sym === Clutter.KEY_Escape && escape() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            });
            menu.actor.add_action_full('spawn-escape', Clutter.EventPhase.CAPTURE, keys as unknown as Clutter.Action);
        } else {
            // GNOME 49 (Clutter 17) has no Clutter.KeyController (50 does, but its shell still listens for keys on
            // `captured-event`, like 49); this handler is connected first.
            menu.actor.connect('captured-event', (_actor: Clutter.Actor, event: Clutter.Event) =>
                event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape && escape()
                    ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);
        }
        manager.addMenu(menu);

        this._align(menu, anchor, side);
        this._services.settings.onChanged(anchorScope, ['position-in-panel', 'menu-position-alignment'], () => this._align(menu, anchor, side));

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
            closeMenu(menu, false);
            menu.destroy();
        }, 'popup menu');

        this._anchorOwned = anchorOwned;
        this._anchor = anchor;
        this._side = side;
        this._menu = menu;
    }

    /**
     * `menu-position-alignment` (0 = the menu extends to the left of the button, 100 = to the right):
     * only for a button centred in a horizontal panel, as in ArcMenu. The boxpointer places the arrow at
     * `arrowAlignment` of the menu's width (0.5 = centred on the button), so the menu is moved by
     * changing that fraction; it is read again on every open and applied at once to an open popup.
     */
    private _align(menu: PopupMenu.PopupMenu, anchor: St.Widget, side: St.Side): void {
        try {
            const s = this._services.settings;
            const horizontal = side === St.Side.TOP || side === St.Side.BOTTOM;
            const alignment = horizontal && s.get('position-in-panel') === 'Center'
                ? 1 - s.get('menu-position-alignment') / 100
                : 0.5;
            const m = menu as unknown as {_arrowAlignment: number; _boxPointer: {setPosition(source: St.Widget, alignment: number): void}};
            m._arrowAlignment = alignment;
            if (this._open && this._menu === menu)
                m._boxPointer.setPosition(anchor, alignment);
        } catch (e) {
            error('menu alignment failed', e);
        }
    }

    private _release(): void {
        const wasOpen = this._open;
        const anchor = this._anchor;
        const owned = this._anchorOwned;
        this._anchorOwned = null;
        this._anchor = null;
        this._menu = null;
        owned?.release();
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
            if (open) {
                if (this._menu)
                    applyTone(this._menu.actor, this._menu.box);
                this._layout?.onOpen(anchor, this._side);
            } else {
                this._layout?.onClosed();
            }
        } catch (e) {
            error('popup open-state handler failed', e);
        }
        if (!open)
            this._intellihide.release();
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
