// One highlight at a time in the menu and the runner (the rule the folder popup has had since 1.1.2,
// widgets/folderView.ts, extended to every list and grid).
//
// Pointing at an item moves THE highlight there: its hover tint shows, a keyboard focus ring on any other item
// goes away (the root takes the keyboard focus, without a ring), and the next key acts on the pointed-at item:
// Return / Space / the Menu key activate it or open its menu, an arrow key moves on from it. A key that moves
// the highlight clears the hover tint of the item under a resting pointer, so the ring is the only highlight.
// Until the pointer really moves, a crossing (the menu opening under a resting pointer, a list scrolling under
// it) shows no tint and takes nothing.
//
// Items are the buttons made by interact.ts makeItemButton(); each reports its hover and pointer motion to the
// nearest ancestor registered here, so no widget needs to know who hosts it.
//
// Public API:
//   new PointerHighlight(scope, root, opts?)     root: the content actor that holds the keyboard while an item
//                                                is only pointed at (it gets the key presses)
//     opts.ignore?(item): boolean               items it leaves alone (they have their own rule: the folder popup)
//     opts.onHover?(item): boolean              the host takes the hover (true: e.g. the search highlight moved
//                                               to that row and the typing focus stays where it is)
//   ph.hovered: St.Widget | null                the item under the pointer, while it shows as the highlight
//   ph.reset(): void                            the menu opened: nothing pointed at, the pointer has not moved
//   ph.keyMoved(keep?): void                    a key moved the highlight (to `keep`, or the focused item)
//   ph.takeKey(event): 'none' | 'focused' | 'redeliver'   call first in the root's key handler: with the root
//                                                focused and an item pointed at, the item takes the focus;
//                                                'redeliver': the key was given to the item (stop the event)
//   trackItem(item): void                       interact.ts: report this item's hover / motion

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';

interface Root {
    hover(item: St.Widget): void;
    motion(item: St.Widget): void;
}

const roots = new WeakMap<Clutter.Actor, Root>();

function rootOf(item: St.Widget): Root | null {
    for (let a = item.get_parent(); a; a = a.get_parent()) {
        const root = roots.get(a);
        if (root)
            return root;
    }
    return null;
}

export function trackItem(item: St.Widget): void {
    item.connect('notify::hover', () => rootOf(item)?.hover(item));
    item.connect('motion-event', () => {
        rootOf(item)?.motion(item);
        return Clutter.EVENT_PROPAGATE;
    });
}

/** Keys an item handles itself (St.Button: Return / Space; interact.ts wireItem: Menu, Shift+F10). */
const ITEM_KEYS = new Set([
    Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter, Clutter.KEY_space, Clutter.KEY_KP_Space,
    Clutter.KEY_Menu, Clutter.KEY_F10,
]);

/** Keys that start from the highlighted item (the root's own key handler acts on the focused item). */
const NAV_KEYS = new Set([
    Clutter.KEY_Up, Clutter.KEY_Down, Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Tab, Clutter.KEY_ISO_Left_Tab,
    Clutter.KEY_Home, Clutter.KEY_End, Clutter.KEY_Page_Up, Clutter.KEY_Page_Down, Clutter.KEY_F2, Clutter.KEY_Delete,
]);

export interface HighlightOptions {
    ignore?(item: St.Widget): boolean;
    onHover?(item: St.Widget): boolean;
}

export class PointerHighlight {
    private readonly _root: St.Widget;
    private readonly _opts: HighlightOptions;
    private _hovered: St.Widget | null = null;
    private _hoveredDestroyId = 0;
    private _moved = false;

    constructor(scope: Scope, root: St.Widget, opts: HighlightOptions = {}) {
        this._root = root;
        this._opts = opts;
        roots.set(root, {hover: item => this._onHover(item), motion: item => this._onMotion(item)});
        scope.add(() => {
            roots.delete(root);
            this._setHovered(null);
        }, 'PointerHighlight');
    }

    get hovered(): St.Widget | null {
        return this._hovered;
    }

    reset(): void {
        this._setHovered(null);
        this._moved = false;
    }

    keyMoved(keep: Clutter.Actor | null = global.stage.key_focus as Clutter.Actor | null): void {
        this._moved = false;
        const hovered = this._hovered;
        if (hovered && hovered !== keep && hovered.hover)
            hovered.hover = false;
    }

    takeKey(event: Clutter.Event): 'none' | 'focused' | 'redeliver' {
        const hovered = this._hovered;
        if (global.stage.key_focus !== this._root || !hovered || !hovered.mapped || !hovered.hover)
            return 'none';
        const sym = event.get_key_symbol();
        const item = ITEM_KEYS.has(sym);
        if (!item && !NAV_KEYS.has(sym))
            return 'none';
        hovered.grab_key_focus();
        if (!item)
            return 'focused';
        hovered.event(event, false);
        return 'redeliver';
    }

    private _onHover(item: St.Widget): void {
        if (this._opts.ignore?.(item))
            return;
        if (!item.hover) {
            if (this._hovered === item)
                this._setHovered(null);
            return;
        }
        if (!this._moved) {
            // A crossing under a resting pointer (the menu opened, a list scrolled): no tint, nothing taken.
            item.hover = false;
            return;
        }
        this._setHovered(item);
        if (this._opts.onHover?.(item))
            return;
        // A focus ring on another item goes; the entry (typing) and a rename keep the focus.
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (focus instanceof St.Button && focus !== item && this._root.contains(focus) && !item.contains(focus))
            this._root.grab_key_focus();
    }

    /** Remember the pointed-at item; forgotten when it is destroyed (rows are rebuilt all the time). */
    private _setHovered(item: St.Widget | null): void {
        if (this._hovered === item)
            return;
        if (this._hovered && this._hoveredDestroyId)
            this._hovered.disconnect(this._hoveredDestroyId);
        this._hoveredDestroyId = 0;
        this._hovered = item;
        if (item) {
            this._hoveredDestroyId = item.connect('destroy', () => {
                this._hoveredDestroyId = 0;
                this._hovered = null;
            });
        }
    }

    private _onMotion(item: St.Widget): void {
        if (this._opts.ignore?.(item))
            return;
        this._moved = true;
        // St sets `hover` only on crossings: the next motion over an item whose tint a key cleared shows it again.
        if (!item.hover && item.mapped)
            item.hover = true;
    }
}
