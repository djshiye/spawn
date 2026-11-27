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
// (panel/intellihide.ts); the hold is given back on close, once the pointer is off the panel. A panel a
// fullscreen window has hidden (top bar, or Dash to Panel without intellihide) is shown while the popup is
// open on it and hidden again on close (panel/fullscreenReveal.ts), so Super in a fullscreen game opens the
// menu attached to its panel instead of floating at the screen edge. A click that closes the popup on a
// button in a panel (a Dash to Panel pinned app, the clock, a tray icon, with the left, middle or right
// button, or a touchscreen tap) is passed on to that button (panel/panelClick.ts), so it works in one click, also over a
// fullscreen game, where the panel then stays until a menu that click opened is closed again. A right click on the
// Spawn button itself (its "Context menu" action) closes the popup and opens the button's own menu in one click; over
// a game the panel stays for that menu too.
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
//   popup.close(takeOver?): void      takeOver() names the menu that opens in its place on the same panel (the
//                                      button's own menu): over a fullscreen game the panel is kept while it is open
//   popup.toggle(anchor): void         close if open on this anchor, otherwise open there
//   popup.onOpenStateChanged(scope, cb(open: boolean, anchor: St.Widget | null))
//   popup.prebuild(anchor?): void      optional, call on idle: build the layout; with `anchor`, also attach
//                                      to it, build the start view and resolve its styles over the next
//                                      two idles (no UI shown), so the first open is about as fast as later ones
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
import type {FullscreenReveal} from '../panel/fullscreenReveal.js';
import type {IntellihideHold} from '../panel/intellihide.js';
import {type ClosingEventKind, PRIMARY, canReplayEvent, closingClick, panelClickTarget} from '../panel/panelClick.js';
import {
    activatePanelButton,
    closeOtherShellPopups,
    createFullscreenReveal,
    createIntellihideHold,
    forwardNextRelease,
    opensContextMenu,
    openShellMenu,
    panelButtonKind,
    passedContextMenu,
    panelClickDeps,
    pointInActor,
    pointOverAnyPanel,
    setPanelHover,
} from '../panel/targets.js';
import {isActorAlive} from '../panel/validate.js';
import type {FakePlace} from '../model/places.js';
import {installUiDevHooks} from './devHooks.js';
import {SpawnLayout} from './layout.js';
import {closeMenu, openMenu, silenceSourceKeys} from './menuParams.js';
import {applyTone, ownedScope, warmStyles} from './util.js';

/** Which kind of pointer / touch event this is, when it can close the popup (a mouse press / release, a touch). */
function closingEventKind(event: Clutter.Event): ClosingEventKind | null {
    switch (event.type()) {
    case Clutter.EventType.BUTTON_PRESS:
        return 'press';
    case Clutter.EventType.BUTTON_RELEASE:
        return 'release';
    case Clutter.EventType.TOUCH_BEGIN:
        return 'touch-begin';
    case Clutter.EventType.TOUCH_END:
        return 'touch-end';
    default:
        return null;
    }
}

type OpenListener = (open: boolean, anchor: St.Widget | null) => void;

interface KeyControllerLike {
    connect(signal: 'key-press', cb: () => boolean): number;
    get_key(): [boolean, number, number];
}

export class SpawnPopup {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _listeners = new Set<OpenListener>();
    /** Spawn buttons that emitted 'destroy': never touched again (a call on a disposed wrapper logs a Gjs-CRITICAL). */
    private readonly _goneAnchors = new WeakSet<object>();

    private _anchorOwned: {scope: Scope; release(): void} | null = null;
    private _anchor: St.Widget | null = null;
    private _side: St.Side = St.Side.TOP;
    private _menu: PopupMenu.PopupMenu | null = null;
    private _layout: SpawnLayout | null = null;
    private _layoutScope: Scope | null = null;
    private _open = false;
    private readonly _intellihide: IntellihideHold;
    private readonly _fullscreen: FullscreenReveal;
    /** The panel button Spawn shows hovered while its grab hides crossing events (see _relayHover). */
    private _hovered: unknown = null;
    /** The panel menu the shell switched to under a held panel (pointer moved onto its icon), see _nextHeldMenu. */
    private _handedOver: unknown = null;
    /** The mouse button of the click _passClickOn last passed on. */
    private _passedButton = 0;
    /** close(takeOver): finds the menu that takes the popup's place (read once the popup has closed). */
    private _takeOver: (() => unknown) | null = null;

    constructor(scope: Scope, services: Services) {
        this._scope = scope;
        this._services = services;
        this._intellihide = createIntellihideHold(scope.child('intellihide'));
        this._fullscreen = createFullscreenReveal(scope.child('fullscreen reveal'));
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

    /** Dev hook (Ui.CompleteRows): build every row of the Classic app list, which is otherwise built lazily. */
    completeAppRows(): void {
        this._layout?.completeAppRows();
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
            intellihideWatch: this._intellihide.debugWatch,
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

    prebuild(anchor: St.Widget | null = null): void {
        let layout: SpawnLayout;
        try {
            layout = this._ensureLayout();
        } catch (e) {
            error('popup prebuild failed', e);
            return;
        }
        // With a button to open from, also do now what the first open would otherwise do before it can
        // paint, one step per idle so no single step stalls a frame for long: create the popup shell on
        // the button and build the start view, then resolve the styles (and with them the icons) of
        // everything the first open will show. The menu stays hidden; an open in between wins.
        const current = () => this._layout === layout && !this._open && anchor !== null && isActorAlive(anchor);
        if (!current())
            return;
        this._scope.idle(() => {
            try {
                if (!current() || !anchor)
                    return;
                if (this._anchor !== anchor || this._side !== this._sideOf(anchor))
                    this._attach(anchor);
                layout.prepare(anchor, this._side);
                this._scope.idle(() => {
                    try {
                        if (current() && this._anchor === anchor && this._menu) {
                            applyTone(this._menu.actor, this._menu.box);
                            warmStyles(this._menu.actor);
                        }
                    } catch (e) {
                        error('popup prebuild (styles) failed', e);
                    }
                });
            } catch (e) {
                error('popup prebuild (start view) failed', e);
            }
        });
    }

    open(anchor: St.Widget): void {
        try {
            if (!isActorAlive(anchor))
                return;
            if (this._anchor !== anchor || this._side !== this._sideOf(anchor))
                this._attach(anchor);
            if (this._menu) {
                // Another shell menu (calendar, quick settings, a tray icon ...) holding the grab closes first.
                closeOtherShellPopups([this._menu]);
                // Reveal an intellihide panel BEFORE the menu positions itself against the button.
                // Likewise show a panel a fullscreen window has hidden, so the menu opens attached to it.
                this._intellihide.hold(anchor);
                this._fullscreen.show(anchor);
                openMenu(this._menu);
                if (!this._open) {
                    this._intellihide.release();
                    this._fullscreen.restore();
                }
            }
        } catch (e) {
            error('popup open failed', e);
        }
    }

    close(takeOver: (() => unknown) | null = null): void {
        try {
            this._takeOver = this._open ? takeOver : null;
            if (this._menu)
                closeMenu(this._menu);
        } catch (e) {
            error('popup close failed', e);
        } finally {
            this._takeOver = null;
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
        anchorScope.connect(anchor, 'destroy', () => {
            this._goneAnchors.add(anchor);
            this._release();
        });
        anchorScope.add(() => {
            // Rescue the layout before the shell around it is destroyed.
            if (layout.actor.get_parent())
                layout.actor.get_parent()?.remove_child(layout.actor);
            manager.removeMenu(menu);
            closeMenu(menu, false);
            menu.destroy();
        }, 'popup menu');
        // The grab sends pointer motion over the panels to the popup: light up the panel button under the pointer.
        // Connected after the 'popup menu' teardown, so it is disconnected before the popup is destroyed.
        anchorScope.connect(menu.actor, 'captured-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            this._relayHover(event);
            return Clutter.EVENT_PROPAGATE;
        });

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

    private _anchorGone(anchor: unknown): boolean {
        return typeof anchor === 'object' && anchor !== null && this._goneAnchors.has(anchor);
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
        if (!open) {
            this._clearHover();
            const gone = this._anchorGone(anchor);
            // Resolve a closing click on a panel launcher BEFORE a fullscreen panel hides again (not when the button
            // itself was destroyed: that close is no click, and nothing may touch the button after this dispatch).
            const passedTo = gone ? null : this._passClickOn(anchor);
            if (!passedTo && !gone)
                this._restoreHover(anchor);
            this._intellihide.release();
            // A tray icon / indicator clicked over a fullscreen game opens its menu on that panel: keep the panel
            // until that menu closes (or, if it never opens, hide it after a moment).
            const passedMenu = (passedTo as {menu?: unknown} | null)?.menu;
            const takeOver = this._takeOver;
            this._takeOver = null;
            if (passedTo && passedTo === anchor && this._fullscreen.shown)
                // A right click on the Spawn button itself: its own menu opens on the same panel.
                this._fullscreen.holdUntilMenu(
                    () => (anchor as {contextMenu?: {openMenu?: unknown}} | null)?.contextMenu?.openMenu ?? null,
                    closed => this._nextHeldMenu(closed));
            else if (takeOver && this._fullscreen.shown)
                // The Spawn button's own menu opens in the popup's place (a right click on the button).
                this._fullscreen.holdUntilMenu(takeOver, closed => this._nextHeldMenu(closed));
            else if (passedMenu && this._fullscreen.shown)
                this._fullscreen.holdWhileOpen(passedMenu, closed => this._nextHeldMenu(closed));
            else if (passedTo && this._fullscreen.shown && opensContextMenu(passedTo, this._passedButton))
                // A right click on a Dash to Panel app icon: its context menu is built once the click is activated.
                this._fullscreen.holdUntilMenu(() => passedContextMenu(passedTo), closed => this._nextHeldMenu(closed));
            else
                this._fullscreen.restore();
        }
        for (const cb of [...this._listeners]) {
            try {
                cb(open, anchor);
            } catch (e) {
                error('popup listener threw', e);
            }
        }
    }

    /**
     * Over a fullscreen game, the tray / panel menu the panel is held for closed. Which menu takes over: one the
     * shell switched to (the pointer moved on to the next icon), or the menu of the icon a closing click landed on
     * (that click is passed on, as for Spawn's own menu). Null: none, the panel may hide.
     */
    private _nextHeldMenu(closed: unknown): unknown {
        const other = openShellMenu(closed);
        if (other) {
            this._handedOver = other;
            return other;
        }
        const handedOver = this._handedOver === closed;
        this._handedOver = null;
        const source = (closed as {sourceActor?: St.Widget} | null)?.sourceActor ?? null;
        // The shell opened this menu because the pointer moved onto its icon; the click on that icon that just
        // closed it meant "this one": open it again (over a game the panel would otherwise be gone).
        if (handedOver && source && this._clickLandsOn(source)) {
            const menu = closed as {open?: (animate?: unknown) => void};
            this._scope.idle(() => {
                if (isActorAlive(source))
                    menu.open?.(false);
            });
            return closed;
        }
        const target = this._passClickOn(source);
        return (target as {menu?: unknown} | null)?.menu ?? null;
    }

    /** The event being handled is a mouse press / release on `actor`. */
    private _clickLandsOn(actor: St.Widget): boolean {
        try {
            const event = Clutter.get_current_event();
            if (!event || !closingEventKind(event))
                return false;
            const [x, y] = event.get_coords();
            const hit = panelClickDeps().actorAt(x, y);
            return Boolean(hit && actor.contains(hit as Clutter.Actor));
        } catch {
            return false;
        }
    }

    /** While the popup holds the grab, panel buttons get no crossing events: show their hover look ourselves. */
    private _relayHover(event: Clutter.Event): void {
        try {
            if (event.type() !== Clutter.EventType.MOTION)
                return;
            const [x, y] = event.get_coords();
            // The pick is skipped where it cannot find a panel button: inside the popup, or off every panel.
            const content = this._menu?.box ?? null;
            const mayHit = this._open && !(content && pointInActor(content, x, y)) && pointOverAnyPanel(x, y);
            const target = mayHit ? panelClickTarget({x, y, button: PRIMARY}, this._anchor, panelClickDeps()) : null;
            if (target === this._hovered)
                return;
            this._clearHover();
            if (target) {
                setPanelHover(target, true);
                this._hovered = target;
            }
        } catch (e) {
            error('panel hover relay failed', e);
        }
    }

    /**
     * The menu closed without a click on a panel button (Escape, a click elsewhere): once the grab is gone, the
     * button under the pointer gets its hover look back (the shell only restores it on the next pointer motion).
     * It is cleared by the shell's own leave event when the pointer moves off; nothing is lit when the pointer is
     * not on a button.
     */
    private _restoreHover(anchor: St.Widget | null): void {
        this._scope.idle(() => {
            try {
                if (this._open || this._anchorGone(anchor))
                    return;
                const [x, y] = global.get_pointer();
                const target = panelClickTarget({x, y, button: PRIMARY}, anchor, panelClickDeps());
                if (target)
                    setPanelHover(target, true);
            } catch (e) {
                error('panel hover restore failed', e);
            }
        });
    }

    private _clearHover(): void {
        const hovered = this._hovered;
        this._hovered = null;
        if (hovered)
            setPanelHover(hovered, false);
    }

    /**
     * The menu closed because of a click outside it: when that click landed on a button in any panel (the clock,
     * quick settings, a tray icon, a Dash to Panel pinned app, on any monitor), click that button too, with the
     * same mouse button, once the grab is gone (panel/panelClick.ts). Returns the button, or null.
     */
    private _passClickOn(anchor: St.Widget | null): unknown {
        try {
            const event = Clutter.get_current_event();
            const kind = event ? closingEventKind(event) : null;
            if (!event || !kind)
                return null;
            const [x, y] = event.get_coords();
            const click = closingClick(kind, x, y, kind === 'press' || kind === 'release' ? event.get_button() : PRIMARY);
            const own = this._ownButtonClick(anchor, click);
            if (own)
                return own;
            const target = panelClickTarget(click, anchor, panelClickDeps());
            if (!target)
                return null;
            this._passedButton = click.button;
            // A tray icon that reads raw presses gets this very press again: keep a copy past this dispatch.
            let press: Clutter.Event | null = null;
            if (canReplayEvent(kind)) {
                try {
                    press = typeof event.copy === 'function' ? event.copy() : event;
                } catch {
                    press = null;
                }
                // ... and the release that follows it (a legacy tray icon clicks its app on release).
                if (press && kind === 'press' && panelButtonKind(target)?.kind === 'raw')
                    forwardNextRelease(this._scope, target, click.button);
            }
            this._scope.idle(() => {
                if (isActorAlive(target as St.Widget))
                    activatePanelButton(target, click.button, press);
            });
            return target;
        } catch (e) {
            error('panel click pass-through failed', e);
            return null;
        }
    }

    /**
     * The closing click landed on the Spawn button the popup is open on, with a mouse button whose action is not the
     * popup (a right click opens the button's own menu): do that action once the grab is gone. Returns the button.
     */
    private _ownButtonClick(anchor: St.Widget | null, click: {x: number; y: number; button: number}): unknown {
        const button = anchor as (St.Widget & {passesClick?(b: number): boolean; handlePassedClick?(b: number): void}) | null;
        if (!button || typeof button.passesClick !== 'function' || typeof button.handlePassedClick !== 'function')
            return null;
        const hit = panelClickDeps().actorAt(click.x, click.y);
        if (!hit || !button.contains(hit as Clutter.Actor) || !button.passesClick(click.button))
            return null;
        this._passedButton = click.button;
        this._scope.idle(() => {
            if (!this._anchorGone(button) && isActorAlive(button))
                button.handlePassedClick?.(click.button);
        });
        return button;
    }

    private _teardown(): void {
        this._release();
        this._layoutScope?.dispose();
        this._layoutScope = null;
        this._layout = null;
        this._listeners.clear();
    }
}
