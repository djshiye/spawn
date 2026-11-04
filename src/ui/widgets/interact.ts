// Shared interaction wiring for focusable menu items (tiles, rows, shortcuts).
//
// Public API:
//   makeItemButton(styleClass): St.Button       focusable, reactive, left/middle/right capable
//   wireItem(button, handlers)                  click / Return -> activate(ctrl, button);
//                                               right click, Menu key, Shift+F10 -> context()
//   applyStyleVariant(widget, className, on)    toggle a style class

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
