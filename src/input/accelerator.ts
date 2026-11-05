// Accelerator: one custom keyboard shortcut (an `as` setting) bound through Main.wm.addKeybinding.
//
// Responsibility: bind the accelerator(s) stored in the settings key `key` under that same name,
// with modes NORMAL | OVERVIEW | POPUP (so it works in the Overview and can also close an open
// popup), and follow the setting live. Changes re-bind, debounced 300 ms; an empty list means no
// binding. Everything is undone by stop() or by the scope's disposal. The binding name is the
// settings key (Main.wm.addKeybinding reads the accelerators from `settings.raw` under that key),
// so two Accelerators must use two different keys.
//
// Public API:
//   new Accelerator(scope, settings, key: SettingKey, onFire: () => void)
//   acc.start(): void       idempotent
//   acc.stop(): void        unbind now (also done by scope disposal); start() works again afterwards
//   acc.bound: boolean      mutter accepted the binding

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {debounce, type Debounced} from '../core/debounce.js';
import {error, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';

const REBIND_DEBOUNCE_MS = 300;

export class Accelerator {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _key: 'spawn-hotkey' | 'runner-hotkey';
    private readonly _onFire: () => void;
    private _run: Scope | null = null;
    private _rebind: Debounced | null = null;
    private _bound = false;

    constructor(scope: Scope, settings: SpawnSettings, key: 'spawn-hotkey' | 'runner-hotkey', onFire: () => void) {
        this._scope = scope;
        this._settings = settings;
        this._key = key;
        this._onFire = onFire;
        scope.add(() => this.stop(), `Accelerator ${key}`);
    }

    get bound(): boolean {
        return this._bound;
    }

    start(): void {
        if (this._run)
            return;
        const run = this._scope.child(`accelerator ${this._key}`);
        this._run = run;
        this._rebind = debounce(run, REBIND_DEBOUNCE_MS, () => this._guard('accelerator sync', () => this._sync()));
        this._settings.onChanged(run, [this._key], () => this._rebind?.call());
        this._guard('accelerator sync', () => this._sync());
    }

    stop(): void {
        const run = this._run;
        this._run = null;
        this._rebind = null;
        this._guard('unbind accelerator', () => this._unbind());
        run?.dispose();
    }

    private _sync(): void {
        if (!this._run)
            return;
        this._unbind();
        const accels = this._settings.get(this._key).filter(a => typeof a === 'string' && a !== '');
        if (accels.length === 0)
            return;
        const action = Main.wm.addKeybinding(
            this._key,
            this._settings.raw,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._fire(),
        );
        // NONE: mutter refused the binding (invalid accelerator, or the name is taken).
        this._bound = action !== Meta.KeyBindingAction.NONE;
        if (!this._bound)
            warn(`mutter refused the '${this._key}' keybinding (${accels.join(', ')})`);
    }

    private _unbind(): void {
        if (!this._bound)
            return;
        this._bound = false;
        Main.wm.removeKeybinding(this._key);
    }

    private _fire(): void {
        try {
            this._onFire();
        } catch (e) {
            error(`'${this._key}' hotkey failed`, e);
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
