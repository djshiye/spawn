// Hotkeys: Super-key toggle and a custom accelerator. STUB: signatures are final.
//
// Responsibility: call `onToggle` when the user presses Super alone (setting
// `super-key-toggle`) or the accelerator(s) in `menu-hotkey`.
// HARD RULES: Super interception is IN MEMORY ONLY (block GNOME's overlay-key handler via
// signal_handler_find/block on global.display, connect ours); NEVER write mutter's
// `overlay-key` to dconf. Everything that was blocked/connected/registered is undone by the
// scope teardown, including when the setting is toggled off at runtime. Custom accelerators
// use Main.wm.addKeybinding / removeKeybinding with a private key owned by this extension.
//
// Public API:
//   new Hotkeys(scope, settings, onToggle: () => void)
//   hotkeys.start(): void       idempotent; follows super-key-toggle / menu-hotkey live
//   hotkeys.stop(): void        undo everything now (also done by scope disposal)

import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';

export class Hotkeys {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _onToggle: () => void;

    constructor(scope: Scope, settings: SpawnSettings, onToggle: () => void) {
        this._scope = scope;
        this._settings = settings;
        this._onToggle = onToggle;
    }

    start(): void {
        // TODO(input owner)
        void this._scope;
        void this._settings;
        void this._onToggle;
    }

    stop(): void {
        // TODO(input owner)
    }
}
