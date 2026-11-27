// IntellihideHold: keeps a Dash to Panel panel with intellihide revealed while the menu is open on it.
//
// Dash to Panel (DtP) hides an intellihide panel by translating its panelBox off screen, so a menu anchored
// to a button in it would open next to an invisible panel, and the panel would slide away under the open
// menu. Like ArcMenu, Spawn takes DtP's own temporary hold for as long as the menu is open and gives it
// back on close, but only once the pointer is off the panel (a panel hidden under the pointer would
// flicker), and at once when the monitor is fullscreen so DtP hides it normally.
//
// Everything is duck-typed against DtP's wrapper objects (`global.dashToPanel.panels[i]`: `.panel`,
// `.panelBox`, `.monitor`, `.intellihide` with `enabled`, `revealAndHold(hold, immediate)`, `release(hold)`)
// and wrapped in try/catch: a DtP API change turns this into a no-op, never into an error in the menu.
// The wrapper is looked up fresh on every hold() and the one held on is remembered, so a release after DtP
// rebuilt its panels reaches the old (destroyed, disabled: a no-op) controller and never a new one.
//
// Public API:
//   new IntellihideHold(scope, deps)   deps: {panels: () => unknown, pointer: () => [number, number],
//                                      watch?: (scope, onChange) => void (signals that re-check a pending release)};
//                                      the hold is released when `scope` is disposed (the shell-bound
//                                      wiring is createIntellihideHold() in panel/targets.ts)
//   hold.hold(anchor): void            anchor = the panel button the menu opens on; reveals its panel
//                                      immediately and keeps it revealed; no-op without intellihide
//   hold.release(): void               menu closed: give the hold back (deferred while the pointer is on
//                                      the panel: re-checked on pointer motion and fullscreen changes (deps.watch)
//                                      with a 1 s safety poll, or every 100 ms without deps.watch; immediately
//                                      when the monitor is fullscreen)
//   hold.debugWatch                    {pending, checks}: a deferred release is waiting / looks it has made (dev)
//   hold.held: boolean                 a hold is taken (also while its release is deferred)
//   wrapperOfPanel(panels, panel)      the DtP wrapper (of `panels`) whose `.panel` is `panel` (dev status)
//   intellihideStatus(wrapper)         {enabled, hold, visible, translation} snapshot (dev status)
//   HOLD_TEMPORARY                     DtP's Hold.TEMPORARY (1), the bit the menu takes

import type {Scope} from '../core/scope.js';
import {warn} from '../core/log.js';

/** DtP's `Hold.TEMPORARY` (intellihide.js); ArcMenu takes the same bit. */
export const HOLD_TEMPORARY = 1;
const POLL_MS = 100; // re-check rate when there is no event source
const FALLBACK_MS = 1000; // safety net next to the events

interface IntellihideLike {
    enabled?: boolean;
    revealAndHold?: (hold: number, immediate?: boolean) => void;
    release?: (hold: number) => void;
    _holdStatus?: number;
}

interface Extents {
    origin?: {x: number; y: number};
    size?: {width: number; height: number};
}

interface BoxLike {
    visible?: boolean;
    translation_x?: number;
    translation_y?: number;
    get_transformed_extents?: () => Extents;
}

export interface DtpWrapper {
    panel?: {contains?: (actor: unknown) => boolean} | null;
    panelBox?: BoxLike | null;
    monitor?: {inFullscreen?: boolean} | null;
    intellihide?: IntellihideLike | null;
}

export interface IntellihideHoldDeps {
    /** `global.dashToPanel.panels`, re-read on every call. */
    panels: () => unknown;
    pointer: () => [number, number];
    /** Connect (into `scope`) the signals after which the pointer / fullscreen state may have changed; optional. */
    watch?: (scope: Scope, onChange: () => void) => void;
}

interface Held {
    wrapper: DtpWrapper;
    intellihide: IntellihideLike;
}

function wrappers(panels: unknown): DtpWrapper[] {
    return Array.isArray(panels) ? panels as DtpWrapper[] : [];
}

/** The DtP wrapper of the panel object `panel` (an inner St panel, as stored in a PanelTarget). */
export function wrapperOfPanel(panels: unknown, panel: unknown): DtpWrapper | null {
    try {
        return wrappers(panels).find(w => w?.panel === panel) ?? null;
    } catch {
        return null;
    }
}

export function intellihideStatus(wrapper: DtpWrapper | null): {enabled: boolean; hold: number | null; visible: boolean | null; translation: number[] | null} | null {
    try {
        const ih = wrapper?.intellihide;
        if (!wrapper || !ih)
            return null;
        const box = wrapper.panelBox;
        return {
            enabled: Boolean(ih.enabled),
            hold: typeof ih._holdStatus === 'number' ? ih._holdStatus : null,
            visible: box ? Boolean(box.visible) : null,
            translation: box ? [box.translation_x ?? 0, box.translation_y ?? 0] : null,
        };
    } catch {
        return null;
    }
}

export class IntellihideHold {
    private readonly _scope: Scope;
    private readonly _panels: () => unknown;
    private readonly _pointer: () => [number, number];
    private _held: Held | null = null;
    private _cancelWatch: (() => void) | null = null;
    private readonly _watch: ((scope: Scope, onChange: () => void) => void) | null;
    private _checks = 0;

    constructor(scope: Scope, deps: IntellihideHoldDeps) {
        this._scope = scope;
        this._panels = deps.panels;
        this._pointer = deps.pointer;
        this._watch = deps.watch ?? null;
        scope.add(() => this._giveBack(), 'IntellihideHold');
    }

    get held(): boolean {
        return this._held !== null;
    }

    /** Dev status: is a deferred release waiting, and how many times it looked at the pointer. */
    get debugWatch(): {pending: boolean; checks: number} {
        return {pending: this._cancelWatch !== null, checks: this._checks};
    }

    hold(anchor: unknown): void {
        try {
            const wrapper = this._wrapperOf(anchor);
            const ih = wrapper?.intellihide;
            this._stopWatch();
            if (this._held && this._held.wrapper === wrapper && this._held.intellihide === ih)
                return; // reopened on the same panel before the deferred release happened
            this._giveBack();
            if (!wrapper || !ih || !ih.enabled || typeof ih.revealAndHold !== 'function')
                return;
            ih.revealAndHold(HOLD_TEMPORARY, true);
            this._held = {wrapper, intellihide: ih};
        } catch (e) {
            warn('intellihide hold failed', e);
        }
    }

    release(): void {
        const held = this._held;
        if (!held || this._cancelWatch)
            return;
        try {
            if (this._fullscreen(held) || !this._pointerOn(held)) {
                this._giveBack();
                return;
            }
            // Pointer still on the (revealed) panel: let it go once the pointer has left.
            const watch = this._scope.child('intellihide-release');
            this._cancelWatch = () => watch.dispose();
            this._checks = 0;
            // true: keep waiting
            const check = (): boolean => {
                if (this._held !== held || this._cancelWatch === null)
                    return false;
                this._checks++;
                if (this._pointerOn(held) && !this._fullscreen(held))
                    return true;
                this._giveBack(); // disposes `watch` (signals and interval)
                return false;
            };
            let evented = false;
            if (this._watch) {
                try {
                    this._watch(watch, () => {
                        check();
                    });
                    evented = true;
                } catch (e) {
                    warn('intellihide release watch failed', e);
                }
            }
            // Event-driven: a slow safety net only. Without events: the 100 ms poll.
            watch.interval(evented ? FALLBACK_MS : POLL_MS, check);
        } catch (e) {
            warn('intellihide release failed', e);
            this._giveBack();
        }
    }

    // ---- internals ----

    private _wrapperOf(anchor: unknown): DtpWrapper | null {
        for (const w of wrappers(this._panels())) {
            try {
                if (w?.panel?.contains?.(anchor))
                    return w;
            } catch {
                // a stale wrapper: skip it
            }
        }
        return null;
    }

    private _fullscreen(held: Held): boolean {
        try {
            return Boolean(held.wrapper.monitor?.inFullscreen);
        } catch {
            return false;
        }
    }

    private _pointerOn(held: Held): boolean {
        try {
            const box = held.wrapper.panelBox;
            const rect = box?.get_transformed_extents?.();
            if (!rect?.origin || !rect.size)
                return false;
            const [x, y] = this._pointer();
            return x >= rect.origin.x && x < rect.origin.x + rect.size.width &&
                y >= rect.origin.y && y < rect.origin.y + rect.size.height;
        } catch {
            return false;
        }
    }

    private _stopWatch(): void {
        this._cancelWatch?.();
        this._cancelWatch = null;
    }

    /** Return the DtP hold NOW (a destroyed / disabled controller ignores it). */
    private _giveBack(): void {
        this._stopWatch();
        const held = this._held;
        this._held = null;
        if (!held)
            return;
        try {
            held.intellihide.release?.(HOLD_TEMPORARY);
        } catch (e) {
            warn('intellihide release failed', e);
        }
    }
}
