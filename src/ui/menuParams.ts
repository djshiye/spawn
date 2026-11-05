// GNOME Shell 51 PopupMenu.open() / close() take a params object ({animate, fadeOnly, triggerEvent}),
// not a BoxPointer.PopupAnimation number; the installed @girs typings still declare the old enum, so
// calls go through these typed wrappers (a number would be destructured as an object: always animated).
//
// Public API:
//   openMenu(menu, animate = true): void
//   closeMenu(menu, animate = true): void

import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

interface ParamMenu {
    open(params?: {animate?: boolean}): boolean;
    close(params?: {animate?: boolean}): boolean;
}

export function openMenu(menu: PopupMenu.PopupMenu, animate = true): void {
    (menu as unknown as ParamMenu).open({animate});
}

export function closeMenu(menu: PopupMenu.PopupMenu, animate = true): void {
    (menu as unknown as ParamMenu).close({animate});
}
