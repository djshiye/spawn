// Hotkeys: Super-key toggle and a custom accelerator.
//
// Responsibility: call `onToggle` when the user presses Super alone (setting
// `super-key-toggle`) or the accelerator(s) in `spawn-hotkey`.
// HARD RULES: Super interception is IN MEMORY ONLY (block GNOME's overlay-key handler via
// signal_handler_find/block on global.display, connect ours); NEVER write mutter's
// `overlay-key` to dconf. Everything that was blocked/connected/registered is undone by the
// scope teardown, including when the setting is toggled off at runtime. Custom accelerators
// use Main.wm.addKeybinding / removeKeybinding with a private key owned by this extension.
//
// Super handling details:
//   * The 'overlay-key' signal is emitted by mutter for whatever the user configured as the
//     overlay key ('Super', 'Super_L', ...), so we never read or compare that setting.
//   * We look for GNOME's handler BEFORE connecting ours (so we cannot find ourselves). If it
//     cannot be found we log and do nothing: GNOME's behaviour stays intact and no handler of
//     ours is connected (no double action).
//   * On disable (setting off, stop(), scope disposal) we disconnect ours and unblock GNOME's,
//     but only if that handler is still connected (the shell may have replaced it).
//
// Accelerator details (input/accelerator.ts): the `spawn-hotkey` key (as) of our own schema is bound
// under the name 'spawn-hotkey' with modes NORMAL | OVERVIEW | POPUP, so it works in the Overview and
// can also close the open menu. Changes re-bind (debounced); an empty list means no binding.
//
//   * mutter drops the overlay-key binding while a modal grab with a mode outside the allowed
//     mask is active (WindowManager._filterKeybinding), and the open menu's PopupMenuManager
//     grab uses Shell.ActionMode.POPUP, which GNOME's mask (NORMAL | OVERVIEW) does not include:
//     a second Super press would never arrive. So while intercepting we widen the mask with
//     Main.wm.allowKeybinding('overlay-key', NORMAL | OVERVIEW | POPUP) and restore the saved mask
//     on release (in memory only).
//
// Public API:
//   new Hotkeys(scope, settings, onToggle: (source: HotkeySource) => void)
//   hotkeys.start(): void       idempotent; follows super-key-toggle / spawn-hotkey live
//   hotkeys.stop(): void        undo everything now (also done by scope disposal)
//   hotkeys.status(): HotkeyStatus   diagnostics for the Dev interface (see below)
//
// HotkeyStatus: {superActive, gnomeHandler, ourHandler, firstUnblocked, accelerators,
//                accelBound, toggles, overlayKeyModes}
//   gnomeHandler/ourHandler: signal handler ids (0 = none); firstUnblocked: the id of the first
//   unblocked 'overlay-key' handler on global.display (== ourHandler while we intercept,
//   == gnomeHandler once released); toggles: how many times onToggle was fired from a hotkey;
//   overlayKeyModes: the Shell.ActionMode mask currently allowed for 'overlay-key' (-1 unknown).

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {Accelerator} from './accelerator.js';

export const ACCEL_KEY = 'spawn-hotkey';
export type HotkeySource = 'super' | 'accelerator';
const OVERLAY_KEY = 'overlay-key';
/** What GNOME Shell itself allows for the overlay key (Main._sessionUpdated). */
const GNOME_OVERLAY_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
const INTERCEPT_OVERLAY_MODES = GNOME_OVERLAY_MODES | Shell.ActionMode.POPUP;

/** The mask the window manager currently holds for the overlay key (a private field; -1 if unreadable). */
function overlayModes(): number {
    const allowed = (Main.wm as unknown as {_allowedKeybindings?: Record<string, number>})._allowedKeybindings;
    return allowed?.[OVERLAY_KEY] ?? -1;
}

/**
 * Id of the first (oldest) 'overlay-key' handler on global.display; 0 when there is none.
 * GJS ignores `unblocked` in the object form, so that query uses the explicit mask form.
 */
function findHandler(unblockedOnly: boolean): number {
    const display = global.display;
    if (!unblockedOnly)
        return Number(GObject.signal_handler_find(display, {signalId: 'overlay-key'} as never)) || 0;
    const signalId = GObject.signal_lookup('overlay-key', Meta.Display.$gtype);
    const mask = GObject.SignalMatchType.ID | GObject.SignalMatchType.UNBLOCKED;
    return Number(GObject.signal_handler_find(display, mask, signalId, 0, null, null, null)) || 0;
}

export interface HotkeyStatus {
    superActive: boolean;
    gnomeHandler: number;
    ourHandler: number;
    firstUnblocked: number;
    accelerators: string[];
    accelBound: boolean;
    toggles: number;
    overlayKeyModes: number;
}

export class Hotkeys {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _onToggle: (source: HotkeySource) => void;

    private _run: Scope | null = null;
    private _accel: Accelerator | null = null;
    private _gnomeHandler = 0;
    private _ourHandler = 0;
    private _toggles = 0;
    /** The overlay-key mask to put back on release; null while we have not widened it. */
    private _savedModes: number | null = null;

    constructor(scope: Scope, settings: SpawnSettings, onToggle: (source: HotkeySource) => void) {
        this._scope = scope;
        this._settings = settings;
        this._onToggle = onToggle;
        scope.add(() => this.stop(), 'Hotkeys');
    }

    start(): void {
        if (this._run)
            return;
        const run = this._scope.child('hotkeys');
        this._run = run;

        this._settings.onChanged(run, ['super-key-toggle'], () => this._guard('super sync', () => this._syncSuper()));

        this._guard('super sync', () => this._syncSuper());
        this._accel = new Accelerator(run, this._settings, ACCEL_KEY, () => this._fire('accelerator'));
        this._accel.start();
    }

    stop(): void {
        const run = this._run;
        this._run = null;
        const accel = this._accel;
        this._accel = null;
        this._guard('release super', () => this._releaseSuper());
        this._guard('unbind accelerator', () => accel?.stop());
        run?.dispose();
    }

    status(): HotkeyStatus {
        let firstUnblocked = 0;
        try {
            firstUnblocked = findHandler(true);
        } catch {
            firstUnblocked = 0;
        }
        let accelerators: string[] = [];
        try {
            accelerators = this._settings.get(ACCEL_KEY);
        } catch {
            accelerators = [];
        }
        return {
            superActive: this._ourHandler !== 0,
            gnomeHandler: this._gnomeHandler,
            ourHandler: this._ourHandler,
            firstUnblocked,
            accelerators,
            accelBound: this._accel?.bound ?? false,
            toggles: this._toggles,
            overlayKeyModes: overlayModes(),
        };
    }

    // ---- Super key ----

    private _syncSuper(): void {
        if (!this._run)
            return;
        if (this._settings.get('super-key-toggle'))
            this._interceptSuper();
        else
            this._releaseSuper();
    }

    private _interceptSuper(): void {
        if (this._ourHandler)
            return;
        const display = global.display;
        // Must run before connecting our own handler, or we could find ourselves.
        const gnome = findHandler(false);
        if (!gnome) {
            warn("GNOME's overlay-key handler was not found; leaving the Super key alone");
            return;
        }
        GObject.signal_handler_block(display, gnome);
        try {
            this._ourHandler = display.connect('overlay-key', () => this._fire('super'));
        } catch (e) {
            // Never leave GNOME's handler blocked without a replacement.
            GObject.signal_handler_unblock(display, gnome);
            throw e;
        }
        this._gnomeHandler = gnome;
        this._guard('widen overlay-key modes', () => {
            const saved = overlayModes();
            this._savedModes = saved >= 0 ? saved : GNOME_OVERLAY_MODES;
            Main.wm.allowKeybinding(OVERLAY_KEY, INTERCEPT_OVERLAY_MODES);
        });
        log(`Super key intercepted (GNOME handler ${gnome} blocked, ours ${this._ourHandler})`);
    }

    private _releaseSuper(): void {
        const ours = this._ourHandler;
        const gnome = this._gnomeHandler;
        this._ourHandler = 0;
        this._gnomeHandler = 0;
        const saved = this._savedModes;
        this._savedModes = null;
        if (saved !== null)
            this._guard('restore overlay-key modes', () => Main.wm.allowKeybinding(OVERLAY_KEY, saved));
        if (!ours && !gnome)
            return;
        const display = global.display;
        if (ours) {
            this._guard('disconnect overlay-key', () => {
                if (GObject.signal_handler_is_connected(display, ours))
                    display.disconnect(ours);
            });
        }
        if (gnome) {
            this._guard('unblock overlay-key', () => {
                if (GObject.signal_handler_is_connected(display, gnome))
                    GObject.signal_handler_unblock(display, gnome);
            });
        }
        log('Super key released');
    }

    // ---- helpers ----

    private _fire(source: HotkeySource): void {
        this._toggles++;
        try {
            this._onToggle(source);
        } catch (e) {
            error('hotkey toggle failed', e);
        }
    }

    private _guard(what: string, fn: () => void): void {
        try {
            fn();
        } catch (e) {
            error(`${what} failed`, e);
        }
    }
}
