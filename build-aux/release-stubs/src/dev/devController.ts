// RELEASE replacement for src/dev/devController.ts: no dev methods exist on the controller in a release build.
// Copied over the real file by tools/build.sh --release.

import type St from 'gi://St';

import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {Hotkeys} from '../input/hotkeys.js';
import type {MenuController} from '../input/dbus.js';
import type {SpawnPopup} from '../ui/menu.js';
import type {SpawnRunner} from '../ui/runner.js';

export interface DevControllerContext {
    root: Scope;
    services: Services;
    popup: SpawnPopup | null;
    runner: SpawnRunner | null;
    runnerAccelBound(): boolean;
    firstButton(): St.Widget | null;
    enableMs(): number;
    startMs(): Record<string, number>;
}

export function installDevController(_controller: MenuController, _ctx: DevControllerContext): void {
}

export interface DevHotkeyContext {
    hotkeys: Hotkeys;
    popupOpen(): boolean;
    anchorButton(): St.Widget | null;
}

export function installDevHotkeyHooks(_scope: Scope, _controller: MenuController, _ctx: DevHotkeyContext): void {
}
