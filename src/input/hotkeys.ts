// Hotkeys: Super-key toggle and a custom accelerator.
//
// Responsibility: call `onToggle` when the user presses Super alone (setting
// `super-key-toggle`) or the accelerator(s) in `menu-hotkey`.
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
// Accelerator details: the `menu-hotkey` key (as) of our own schema is bound under the name
// 'menu-hotkey' with modes NORMAL | OVERVIEW | POPUP, so it works in the Overview and can also
// close the open menu. Changes re-bind (debounced); an empty list means no binding.
//
// Public API:
//   new Hotkeys(scope, settings, onToggle: () => void)
//   hotkeys.start(): void       idempotent; follows super-key-toggle / menu-hotkey live
//   hotkeys.stop(): void        undo everything now (also done by scope disposal)
//   hotkeys.status(): HotkeyStatus   diagnostics for the Dev interface (see below)
//
// HotkeyStatus: {superActive, gnomeHandler, ourHandler, firstUnblocked, accelerators,
//                accelBound, toggles}
//   gnomeHandler/ourHandler: signal handler ids (0 = none); firstUnblocked: the id of the first
//   unblocked 'overlay-key' handler on global.display (== ourHandler while we intercept,
//   == gnomeHandler once released); toggles: how many times onToggle was fired from a hotkey.

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {debounce, type Debounced} from '../core/debounce.js';
import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';

export const ACCEL_KEY = 'menu-hotkey';
const REBIND_DEBOUNCE_MS = 300;

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
}

export class Hotkeys {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _onToggle: () => void;

    private _run: Scope | null = null;
    private _rebind: Debounced | null = null;
    private _gnomeHandler = 0;
    private _ourHandler = 0;
    private _accelBound = false;
    private _toggles = 0;

    constructor(scope: Scope, settings: SpawnSettings, onToggle: () => void) {
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

        this._rebind = debounce(run, REBIND_DEBOUNCE_MS, () => this._syncAccelerator());
        this._settings.onChanged(run, ['super-key-toggle'], () => this._guard('super sync', () => this._syncSuper()));
        this._settings.onChanged(run, [ACCEL_KEY], () => this._rebind?.call());

        this._guard('super sync', () => this._syncSuper());
        this._guard('accelerator sync', () => this._syncAccelerator());
    }

    stop(): void {
        const run = this._run;
        this._run = null;
        this._rebind = null;
        this._guard('release super', () => this._releaseSuper());
        this._guard('unbind accelerator', () => this._unbindAccelerator());
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
            accelBound: this._accelBound,
            toggles: this._toggles,
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
            this._ourHandler = display.connect('overlay-key', () => this._fire());
        } catch (e) {
            // Never leave GNOME's handler blocked without a replacement.
            GObject.signal_handler_unblock(display, gnome);
            throw e;
        }
        this._gnomeHandler = gnome;
        log(`Super key intercepted (GNOME handler ${gnome} blocked, ours ${this._ourHandler})`);
    }

    private _releaseSuper(): void {
        const ours = this._ourHandler;
        const gnome = this._gnomeHandler;
        this._ourHandler = 0;
        this._gnomeHandler = 0;
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

    // ---- custom accelerator ----

    private _syncAccelerator(): void {
        if (!this._run)
            return;
        this._unbindAccelerator();
        const accels = this._settings.get(ACCEL_KEY).filter(a => typeof a === 'string' && a !== '');
        if (accels.length === 0)
            return;
        Main.wm.addKeybinding(
            ACCEL_KEY,
            this._settings.raw,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._fire(),
        );
        this._accelBound = true;
    }

    private _unbindAccelerator(): void {
        if (!this._accelBound)
            return;
        this._accelBound = false;
        Main.wm.removeKeybinding(ACCEL_KEY);
    }

    // ---- helpers ----

    private _fire(): void {
        this._toggles++;
        try {
            this._onToggle();
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
