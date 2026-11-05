// Shared interaction wiring for focusable menu items (tiles, rows, shortcuts).
//
// Public API:
//   makeItemButton(styleClass): St.Button       focusable, reactive, left/middle/right capable
//   wireItem(button, handlers)                  click / Return -> activate(ctrl, button);
//                                               right click, Menu key, Shift+F10 -> context()
//   applyStyleVariant(widget, className, on)    toggle a style class
//   makeSurface(styleClass): St.Bin             the visible face of a pinned grid tile (see below)
//   surfaceOf(widget): St.Widget                the face of a pinned entry, else the widget itself
//
// Pinned entries (list rows, grid tiles) have no dead zones: St only hit-tests an actor's
// allocation (padding included, margins and container spacing excluded), so the St.Button stays the
// OUTER, reactive actor and carries the transparent gap around the item as padding, while its single
// child, the SURFACE (`.spawn-surface`), draws the visible row / tile (radius, tint, focus ring).
// stylesheet.css and the theme module style the surface through the button's state, with
// descendant selectors (`.spawn-pinned-row:hover .spawn-row-surface`), so hover / pressed / focus
// need no JS mirroring. Drag & drop feedback goes to the surface (dnd.ts, via surfaceOf).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {isCtrlPressed} from '../util.js';

export interface ItemHandlers {
    /** `ctrl`: Ctrl held or middle click. `button`: 0 keyboard, 1 left, 2 middle. */
    activate(ctrl: boolean, button: number): void;
    context?(): void;
}

export function makeItemButton(styleClass: string): St.Button {
    return new St.Button({
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
        button_mask: St.ButtonMask.PRIMARY | St.ButtonMask.MIDDLE | St.ButtonMask.SECONDARY,
        x_expand: true,
    });
}

/** The visible face of a pinned grid tile: a Bin around the icon + label box (a list row uses its row box). */
export function makeSurface(styleClass: string): St.Bin {
    return new St.Bin({style_class: `spawn-surface ${styleClass}`, x_expand: true, y_expand: true});
}

/** The child of a pinned entry's button that draws it (`.spawn-surface`); any other widget is its own face. */
export function surfaceOf(widget: St.Widget): St.Widget {
    const child = widget instanceof St.Bin ? widget.get_child() : null;
    return child instanceof St.Widget && child.has_style_class_name('spawn-surface') ? child : widget;
}

export function wireItem(button: St.Button, handlers: ItemHandlers): void {
    button.connect('clicked', (_b: St.Button, which: number) => {
        if (which === 3) {
            handlers.context?.();
            return;
        }
        handlers.activate(isCtrlPressed() || which === 2, which);
    });
    button.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
        const sym = event.get_key_symbol();
        const shift = Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
        if (handlers.context && (sym === Clutter.KEY_Menu || (sym === Clutter.KEY_F10 && shift))) {
            handlers.context();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

export function applyStyleVariant(widget: St.Widget, className: string, on: boolean): void {
    if (on)
        widget.add_style_class_name(className);
    else
        widget.remove_style_class_name(className);
}
