// KeyRouter: key presses and focus changes inside the menu root.
//
// Responsibility: the layout's key-press handler (Ctrl+arrows / Home / End reorder a pinned entry or a
// folder's app, Ctrl+Z undo, Tab / arrows / Home / End / Page keys through the Navigator, F2 rename, Delete
// unpin, Backspace and typing go to the search entry) and what happens when the keyboard focus moves (keep
// the focused item in view, remember the pinned tile for a neighbour refocus, hand the focus on when the
// focused actor is destroyed, tie the search highlight to a focused result row).
//
// Public API:
//   new KeyRouter(scope, services, state, deps)   deps: {root, search, highlight, nav, undo, pinned, folders,
//                                                         results, tooltips, context}
//   keys.onKeyPress(event): boolean       Clutter.EVENT_STOP / EVENT_PROPAGATE for the root's key-press-event
//   keys.onFocusChanged()                 the stage's key focus changed

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {reorderTarget, type ReorderKey} from '../../model/reorder.js';
import type {AppContextMenu} from '../contextMenu.js';
import {scrollIntoView} from '../util.js';
import type {PointerHighlight} from '../widgets/highlight.js';
import type {ResultList} from '../widgets/resultList.js';
import type {SearchBox} from '../widgets/searchBox.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import type {FolderController} from './folders.js';
import type {Navigator} from './navigation.js';
import type {PinnedView} from './pinnedView.js';
import type {LayoutState} from './types.js';
import type {UndoController} from './undo.js';

/** Ctrl+<key> reorders the focused pinned entry. */
const REORDER_KEYS = new Map<number, ReorderKey>([
    [Clutter.KEY_Up, 'up'], [Clutter.KEY_Down, 'down'], [Clutter.KEY_Left, 'left'], [Clutter.KEY_Right, 'right'],
    [Clutter.KEY_Home, 'first'], [Clutter.KEY_End, 'last'],
]);

export interface KeyRouterDeps {
    /** The layout root: the focus is only handled while it is inside. */
    root: St.Widget;
    search: SearchBox;
    highlight: PointerHighlight;
    nav: Navigator;
    undo: UndoController;
    pinned: PinnedView;
    folders: FolderController;
    /** The search results list, once built. */
    results(): ResultList | null;
    tooltips: TooltipManager;
    context: AppContextMenu;
}

export class KeyRouter {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _root: St.Widget;
    private readonly _search: SearchBox;
    private readonly _highlight: PointerHighlight;
    private readonly _nav: Navigator;
    private readonly _undo: UndoController;
    private readonly _pinned: PinnedView;
    private readonly _folders: FolderController;
    private readonly _results: () => ResultList | null;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;
    /** Last keyboard-focused pinned tile and its index, to refocus a neighbour when it is destroyed. */
    private _lastTile: {widget: Clutter.Actor; index: number} | null = null;

    constructor(scope: Scope, services: Services, state: LayoutState, deps: KeyRouterDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._root = deps.root;
        this._search = deps.search;
        this._highlight = deps.highlight;
        this._nav = deps.nav;
        this._undo = deps.undo;
        this._pinned = deps.pinned;
        this._folders = deps.folders;
        this._results = deps.results;
        this._tooltips = deps.tooltips;
        this._context = deps.context;
    }

    /** True when the focus is on a reorderable pinned entry (the key is then consumed, even at an edge). */
    private _reorderFocused(key: ReorderKey): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._state.destroyed)
            return false;
        const store = this._services.pinned;
        if (this._state.view === 'pinned') {
            const tiles = this._pinned.grid.tiles();
            const loc = this._nav.locate([{id: 'tiles', items: tiles, cols: this._pinned.grid.columns}], focus);
            if (!loc)
                return false;
            const to = reorderTarget(loc.index, tiles.length, this._pinned.grid.columns, key);
            if (to !== null) {
                const widget = tiles[loc.index];
                this._tooltips.hide();
                store.moveShown(loc.index, to);
                // The store notified the layout synchronously: the rows are rebuilt around the same widgets.
                this._pinned.syncIfNeeded();
                widget.grab_key_focus();
            }
            return true;
        }
        const fv = this._state.view === 'folder' ? this._folders.view : null;
        if (fv?.uuid) {
            const tiles = fv.tiles();
            const cols = fv.columns;
            const loc = this._nav.locate([{id: 'folder', items: tiles, cols}], focus);
            if (!loc)
                return false;
            const to = reorderTarget(loc.index, tiles.length, cols, key);
            if (to !== null) {
                this._tooltips.hide();
                store.moveInFolder(fv.uuid, loc.index, to);
                // FolderView rebuilt its tiles: the moved entry is a new actor at `to`.
                fv.tiles()[to]?.grab_key_focus();
            }
            return true;
        }
        return false;
    }

    /** F2 on a pinned folder (or anywhere in its open popup): rename it. */
    private _renameFocused(): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const fv = this._folders.view;
        if (!focus)
            return false;
        if (this._state.view === 'folder' && fv?.uuid && fv.actor.contains(focus)) {
            if (!fv.renaming)
                fv.startRename();
            return true;
        }
        if (this._state.view !== 'pinned')
            return false;
        for (const [key, entry] of this._pinned.entries) {
            if (key.startsWith('f:') && entry.widget === focus) {
                this._folders.rename(key.slice(2));
                return true;
            }
        }
        return false;
    }

    /** Delete on a pinned app or command (top level): Unpin, exactly as its context menu does it. */
    private _unpinFocused(): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._state.view !== 'pinned')
            return false;
        for (const [key, entry] of this._pinned.entries) {
            if (entry.widget !== focus)
                continue;
            if (key.startsWith('f:'))
                return false;
            // a:<id>[*] (an app, * = "New" badge), m:<id> (not installed), c:<id> (command / shortcut)
            this._context.unpin(key.slice(2).replace(/\*$/, ''));
            return true;
        }
        return false;
    }

    onKeyPress(event: Clutter.Event): boolean {
        if (this._state.destroyed)
            return Clutter.EVENT_PROPAGATE;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (this._folders.view?.renaming && focus && this._folders.view.actor.contains(focus) && !(focus instanceof St.Button))
            return Clutter.EVENT_PROPAGATE;
        // Only pointed at (the layout holds the focus): the key acts on the pointed-at item.
        if (this._highlight.takeKey(event) === 'redeliver')
            return Clutter.EVENT_STOP;

        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = Boolean(state & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK));

        // Ctrl+arrows / Home / End on a pinned entry or a folder's app reorder it; Ctrl+Z undoes a folder delete.
        if ((state & Clutter.ModifierType.CONTROL_MASK) && !(state & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.MOD1_MASK))) {
            const reorder = REORDER_KEYS.get(sym);
            if (reorder && this._reorderFocused(reorder))
                return Clutter.EVENT_STOP;
            if ((sym === Clutter.KEY_z || sym === Clutter.KEY_Z) && this._undo.hasUndo()) {
                this._undo.undoLast();
                return Clutter.EVENT_STOP;
            }
        }

        // A key that moves the focus leaves it as the only highlight (no hover tint under a resting pointer).
        const moved = (handled: boolean): boolean => {
            this._highlight.keyMoved();
            return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        };
        switch (sym) {
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._nav.cyclePane(sym === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1);
            return moved(true);
        case Clutter.KEY_Up:
            return moved(this._nav.move('up'));
        case Clutter.KEY_Down:
            return moved(this._nav.move('down'));
        case Clutter.KEY_Left:
            return moved(this._nav.move('left'));
        case Clutter.KEY_Right:
            return moved(this._nav.move('right'));
        case Clutter.KEY_Home:
        case Clutter.KEY_KP_Home:
        case Clutter.KEY_End:
        case Clutter.KEY_KP_End:
        case Clutter.KEY_Page_Up:
        case Clutter.KEY_KP_Page_Up:
        case Clutter.KEY_Page_Down:
        case Clutter.KEY_KP_Page_Down:
            if (ctrl)
                break;
            return moved(this._nav.jump(sym));
        case Clutter.KEY_F2:
            if (!ctrl && this._renameFocused())
                return Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Delete:
        case Clutter.KEY_KP_Delete:
            if (!ctrl && !(state & Clutter.ModifierType.SHIFT_MASK) && this._unpinFocused())
                return Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_BackSpace:
            if (this._search.actor.visible && this._search.text.length > 0 && !this._search.hasFocus) {
                this._search.deleteBackward();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (ctrl)
            return Clutter.EVENT_PROPAGATE;
        const unicode = Clutter.keysym_to_unicode(sym);
        if (unicode >= 32 && unicode !== 127 && !this._search.hasFocus) {
            // `search-hidden`: the entry stays out of sight until the user types, then appears.
            this._search.actor.visible = true;
            this._search.insert(String.fromCodePoint(unicode));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    onFocusChanged(): void {
        if (!this._state.isOpen || this._state.destroyed)
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus) {
            // The focused actor went away (view switched, tile removed): keep the keyboard alive.
            const lost = this._lastTile;
            this._scope.idle(() => {
                if (this._state.isOpen && !this._state.destroyed && !global.stage.key_focus && !this._context.isOpen) {
                    // An open folder popup keeps the keyboard (its tiles are rebuilt on every store change).
                    if (this._state.view === 'folder') {
                        this._nav.focusMain();
                        return;
                    }
                    // A pinned tile was destroyed (Unpin, Delete Folder): focus its neighbour at the same index.
                    // Compare identities only: touching the destroyed tile itself logs a critical.
                    const current = this._state.view === 'pinned' ? this._pinned.grid.tiles() : [];
                    const tiles = lost && !current.includes(lost.widget as St.Widget) ? current : [];
                    const next = tiles[Math.min(lost?.index ?? 0, tiles.length - 1)];
                    if (next) {
                        next.grab_key_focus();
                        return;
                    }
                    if (this._search.actor.visible)
                        this._search.focus();
                    else
                        this._nav.focusMain();
                }
            });
            return;
        }
        if (!this._root.contains(focus))
            return;
        if (this._state.view === 'pinned') {
            const index = this._pinned.grid.tiles().indexOf(focus as St.Widget);
            if (index >= 0)
                this._lastTile = {widget: focus, index};
        }
        // Keep the focused item visible inside its scroll view.
        let a: Clutter.Actor | null = focus;
        while (a && a !== this._root) {
            if (a instanceof St.ScrollView) {
                scrollIntoView(a, focus);
                break;
            }
            a = a.get_parent();
        }
        // The search highlight follows a result row that takes the keyboard focus, and shows only while no
        // row has it (the focus ring is the highlight then).
        const results = this._results();
        if (results) {
            const inResults = results.actor.contains(focus);
            if (inResults)
                results.select(focus);
            results.setSelectionVisible(!inResults);
        }
    }
}
