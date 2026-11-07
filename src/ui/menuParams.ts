// GNOME Shell 51 PopupMenu.open() / close() take a params object ({animate, fadeOnly, triggerEvent}),
// 49 and 50 a BoxPointer.PopupAnimation number (NONE 0 / FULL ~0; an object there would be masked with
// `& FULL` and silently mean "no animation"). The installed @girs typings declare only one of the two,
// so calls go through these typed wrappers, which pick the form the running shell expects.
// The shell's PopupMenu also adds its own key handling to its source actor (Return / Space / arrow
// toggles the menu), which would bypass Spawn's click-action settings; `silenceSourceKeys` turns it off
// on every release (a disabled Clutter.KeyController on 51, a key-press-event handler on 49 / 50).
//
// Public API:
//   openMenu(menu, animate = true): void      also, on 49 / 50, starts keyboard navigation when a key press
//                                             opened the menu (51 does it inside open())
//   closeMenu(menu, animate = true): void
//   Neither animates while GNOME's "Reduce animation" is on (widgets/a11y.ts animationsEnabled()).
//   silenceSourceKeys(menu): void

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {animationsEnabled} from './widgets/a11y.js';

interface ParamMenu {
    open(params?: {animate?: boolean}): boolean;
    close(params?: {animate?: boolean}): boolean;
}

interface NumberMenu {
    open(animation?: number): boolean;
    close(animation?: number): boolean;
}

// BoxPointer.PopupAnimation.FULL is ~0 (all bits), NONE is 0.
const FULL = ~0;
const NONE = 0;

/** 51 and later: the menu converts a params object itself (`_getPopupAnimationFromParams`). */
function takesParams(menu: PopupMenu.PopupMenu): boolean {
    return typeof (menu as unknown as {_getPopupAnimationFromParams?: unknown})._getPopupAnimationFromParams === 'function';
}

export function openMenu(menu: PopupMenu.PopupMenu, requestAnimate = true): void {
    const animate = requestAnimate && animationsEnabled(); // GNOME's "Reduce animation"
    if (takesParams(menu)) {
        (menu as unknown as ParamMenu).open({animate});
        return;
    }
    const wasOpen = menu.isOpen;
    (menu as unknown as NumberMenu).open(animate ? FULL : NONE);
    // 51's open() focuses the first item when the current event is a key press (Menu key, Return on
    // the anchor); 49 / 50 leave the focus on the popup itself, where Return does nothing.
    const type = Clutter.get_current_event()?.type();
    if (!wasOpen && menu.isOpen && (type === Clutter.EventType.KEY_PRESS || type === Clutter.EventType.KEY_RELEASE))
        menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
}

export function closeMenu(menu: PopupMenu.PopupMenu, requestAnimate = true): void {
    const animate = requestAnimate && animationsEnabled();
    if (takesParams(menu))
        (menu as unknown as ParamMenu).close({animate});
    else
        (menu as unknown as NumberMenu).close(animate ? FULL : NONE);
}

export function silenceSourceKeys(menu: PopupMenu.PopupMenu): void {
    const m = menu as unknown as {_keyController?: Clutter.ActorMeta};
    if (m._keyController) {
        m._keyController.set_enabled(false);
        return;
    }
    // 49 / 50: the handler is connected with connectObject(..., menu) next to a `notify::mapped` one
    // (close when the source is unmapped), so drop both and put the second back. destroy() removes it.
    const source = menu.sourceActor as unknown as {
        disconnectObject(owner: object): void;
        connectObject(signal: string, cb: () => void, owner: object): void;
        mapped: boolean;
    } | null;
    if (!source || typeof source.disconnectObject !== 'function')
        return;
    source.disconnectObject(menu);
    source.connectObject('notify::mapped', () => {
        if (!source.mapped)
            closeMenu(menu, false);
    }, menu);
}
