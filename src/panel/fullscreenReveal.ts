// FullscreenReveal: shows the panel the menu opens on while a fullscreen window has hidden it.
//
// GNOME hides the top bar (and Dash to Panel hides its panels without intellihide) while a window on that
// monitor is fullscreen: the panel box is tracked chrome with `trackFullscreen`, so the shell sets it
// invisible. A menu opened on a button in it (Super in a fullscreen game) would float at the screen edge,
// detached from a panel that is not there. Like the Overview, which brings the panel back over a
// fullscreen window, and like ArcMenu, Spawn shows that panel box while the menu is open and hides it
// again on close if the monitor is still fullscreen. The hide is immediate, wherever the pointer is: a game
// often parks a hidden pointer at the screen edge, and a panel left over the game until the pointer moved
// would be worse than a panel that goes away with the menu (the intellihide hold also lets go at once in
// fullscreen).
//
// Only a known panel box (the shell's own `Main.layoutManager.panelBox` or a Dash to Panel `panelBox`) is
// ever touched, and only when it is hidden AND its monitor is fullscreen. Everything is duck-typed and
// wrapped in try/catch: an API change turns this into a no-op, never into an error in the menu. A Dash to
// Panel panel with intellihide stays visible in fullscreen (intellihide moves it instead), so that case is
// the IntellihideHold's (panel/intellihide.ts) and this one does nothing there.
//
// Public API:
//   new FullscreenReveal(scope, deps)  deps: {panels(): PanelBoxInfo[], overviewVisible(), alive?(box)};
//                                      the panel is put back when `scope` is disposed (the shell-bound
//                                      wiring is createFullscreenReveal() in panel/targets.ts)
//   reveal.show(anchor): void          before the menu opens on `anchor`: show its hidden fullscreen panel
//   reveal.restore(): void             menu closed: hide that panel again if its monitor is still fullscreen
//   reveal.holdWhileOpen(menu, next?)  menu closed by a click passed on to a panel button (panel/panelClick.ts):
//                                      keep the panel while that button's `menu` is open (a tray icon's menu,
//                                      the calendar), then hide it; hide it after HOLD_GRACE_MS if it never opens.
//                                      When that menu closes, `next(closed)` may name the menu that takes over
//                                      (the pointer moved on to the next icon, or a click there was passed on):
//                                      the panel is then held for that one instead of hiding under it.
//   reveal.holdUntilMenu(find, next?)  like holdWhileOpen for a menu that does not exist yet (a Dash to Panel app
//                                      icon's context menu is built when its right click is passed on): `find()`
//                                      is asked on idle for the menu; none: the panel hides again
//   reveal.shown: boolean              a panel is being shown by Spawn

import type {Scope} from '../core/scope.js';
import {warn} from '../core/log.js';

export interface PanelBoxLike {
    visible?: boolean;
    contains?: (actor: unknown) => boolean;
}

/** A panel box and the monitor it sits on (re-read on every call). */
export interface PanelBoxInfo {
    box: PanelBoxLike | null | undefined;
    monitor: {inFullscreen?: boolean} | null | undefined;
}

export interface FullscreenRevealDeps {
    panels: () => PanelBoxInfo[];
    overviewVisible: () => boolean;
    /** False for a destroyed actor (a Dash to Panel rebuild while the menu was open): never touched. */
    alive?: (box: PanelBoxLike) => boolean;
}

/** How long a passed-on click may take to open its menu (a tray icon waits out the double-click time first). */
export const HOLD_GRACE_MS = 1000;

interface MenuLike {
    isOpen?: boolean;
    connect?: (signal: string, cb: (...args: unknown[]) => void) => number;
    disconnect?: (id: number) => void;
}

export class FullscreenReveal {
    private readonly _deps: FullscreenRevealDeps;
    private readonly _scope: Scope;
    private _shown: PanelBoxInfo | null = null;
    private _hold: Scope | null = null;

    constructor(scope: Scope, deps: FullscreenRevealDeps) {
        this._deps = deps;
        this._scope = scope;
        scope.add(() => this._hideNow(), 'FullscreenReveal');
    }

    get shown(): boolean {
        return this._shown !== null;
    }

    show(anchor: unknown): void {
        try {
            this._dropHold();
            const info = this._infoOf(anchor);
            if (this._shown && info && this._shown.box === info.box)
                return; // already shown on this panel
            this._hideNow();
            if (!info?.box || info.box.visible !== false || !info.monitor?.inFullscreen)
                return;
            info.box.visible = true;
            this._shown = info;
        } catch (e) {
            warn('fullscreen panel reveal failed', e);
        }
    }

    restore(): void {
        this._hideNow();
    }

    holdWhileOpen(menu: unknown, next: ((closed: unknown) => unknown) | null = null): void {
        this._dropHold();
        if (!this._shown)
            return;
        const m = menu as MenuLike | null;
        if (typeof m?.connect !== 'function') {
            this._hideNow();
            return;
        }
        try {
            const hold = this._scope.child('hold');
            this._hold = hold;
            let opened = Boolean(m.isOpen);
            hold.connect(m as Parameters<Scope['connect']>[0], 'open-state-changed', (_m: unknown, open: unknown) => {
                if (open) {
                    opened = true;
                    return;
                }
                let following: unknown = null;
                try {
                    following = next?.(m) ?? null;
                } catch (e) {
                    warn('fullscreen panel hand-over failed', e);
                }
                if (following)
                    this.holdWhileOpen(following, next);
                else
                    this._hideNow();
            });
            hold.timeout(HOLD_GRACE_MS, () => {
                if (!opened && !m.isOpen)
                    this._hideNow();
            });
        } catch (e) {
            warn('fullscreen panel hold failed', e);
            this._hideNow();
        }
    }

    holdUntilMenu(find: () => unknown, next: ((closed: unknown) => unknown) | null = null): void {
        this._dropHold();
        if (!this._shown)
            return;
        try {
            const hold = this._scope.child('hold');
            this._hold = hold;
            // After the passed-on click was activated (that is queued first on idle).
            hold.idle(() => {
                let menu: unknown = null;
                try {
                    menu = find();
                } catch (e) {
                    warn('fullscreen panel hold: no menu', e);
                }
                if (menu)
                    this.holdWhileOpen(menu, next);
                else
                    this._hideNow();
            });
        } catch (e) {
            warn('fullscreen panel hold failed', e);
            this._hideNow();
        }
    }

    // ---- internals ----

    private _infoOf(anchor: unknown): PanelBoxInfo | null {
        for (const info of this._deps.panels()) {
            try {
                if (info?.box?.contains?.(anchor))
                    return info;
            } catch {
                // a stale panel: skip it
            }
        }
        return null;
    }

    /** Put the panel back NOW: hidden if its monitor is still fullscreen (outside the Overview). */
    private _dropHold(): void {
        const hold = this._hold;
        this._hold = null;
        hold?.dispose();
    }

    private _hideNow(): void {
        this._dropHold();
        const shown = this._shown;
        this._shown = null;
        if (!shown?.box)
            return;
        try {
            if (this._deps.alive && !this._deps.alive(shown.box))
                return;
            // Left fullscreen meanwhile (or the Overview is up): the shell wants the panel visible, keep it.
            if (shown.monitor?.inFullscreen && !this._deps.overviewVisible())
                shown.box.visible = false;
        } catch (e) {
            warn('fullscreen panel restore failed', e);
        }
    }
}
