// The dev-only half of the MenuController behind the Dev D-Bus interface (src/dev/devDbus.ts): runner and hotkey
// state, a virtual keyboard, workspace switching and the benchmark.
// DEV BUILDS ONLY: tools/build.sh --release replaces this file with
// build-aux/release-stubs/src/dev/devController.ts, so a release package has none of it.
//
// Public API:
//   installDevController(controller, ctx)          runner / workspace / benchmark methods
//   installDevHotkeyHooks(scope, controller, ctx)  hotkey status, overlay-key, focus and virtual keyboard methods;
//                                                  removed again when `scope` is disposed

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import type St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {Hotkeys} from '../input/hotkeys.js';
import type {MenuController} from '../input/dbus.js';
import {isMenuOpen, menusOfStatusArea} from '../panel/shellPopups.js';
import type {SpawnPopup} from '../ui/menu.js';
import type {SpawnRunner} from '../ui/runner.js';
import {runBenchmark} from './benchmark.js';

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

export function installDevController(controller: MenuController, ctx: DevControllerContext): void {
    const {popup, runner} = ctx;
    controller.openRunner = () => runner?.open();
    controller.closeRunner = () => runner?.close();
    controller.runnerState = () => JSON.stringify({
        ...(runner?.debugState() ?? {open: false, built: false}),
        accelBound: ctx.runnerAccelBound(),
        popupOpen: popup?.isOpen ?? false,
    });
    controller.benchmark = sections => {
        if (!popup)
            return Promise.reject(new Error('popup unavailable'));
        const bench = ctx.root.child('benchmark');
        const result = runBenchmark({
            scope: bench,
            services: ctx.services,
            popup,
            anchor: () => ctx.firstButton(),
            enable: {totalMs: ctx.enableMs(), subsystems: ctx.startMs()},
        }, sections);
        return result.then(r => JSON.stringify(r)).finally(() => bench.dispose());
    };
    controller.activateWorkspace = index => {
        const ws = global.workspace_manager.get_workspace_by_index(index);
        if (!ws)
            throw new Error(`no workspace ${index}`);
        ws.activate(global.get_current_time());
    };
}

export interface DevHotkeyContext {
    hotkeys: Hotkeys;
    popupOpen(): boolean;
    anchorButton(): St.Widget | null;
}

export function installDevHotkeyHooks(scope: Scope, controller: MenuController, ctx: DevHotkeyContext): void {
    controller.hotkeyStatus = () => JSON.stringify({
        ...ctx.hotkeys.status(),
        popupOpen: ctx.popupOpen(),
        overviewVisible: Main.overview.visible,
        notifications: (Main.messageTray as unknown as {getSources(): Array<{notifications: Array<{title?: string; body?: string}>}>})
            .getSources().flatMap(s => s.notifications.map(n => `${n.title ?? ''}. ${n.body ?? ''}`)),
        shellMenusOpen: menusOfStatusArea(Main.panel.statusArea).filter(isMenuOpen).length,
    });
    controller.emitOverlayKey = () => global.display.emit('overlay-key');
    controller.focusButton = () => {
        const button = ctx.anchorButton();
        if (!button)
            throw new Error('no attached button');
        button.grab_key_focus();
    };
    let keyboard: Clutter.VirtualInputDevice | null = null;
    controller.sendKeys = spec => {
        keyboard ??= global.stage.get_context().get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let t = GLib.get_monotonic_time();
        for (const step of spec.split(/\s+/).filter(x => x !== '')) {
            const keyval = (Clutter as unknown as Record<string, unknown>)[`KEY_${step.slice(1)}`];
            if ((step[0] !== '+' && step[0] !== '-') || typeof keyval !== 'number')
                throw new Error(`bad key step '${step}'`);
            keyboard.notify_keyval(t++, keyval, step[0] === '+' ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
        }
    };
    scope.add(() => {
        keyboard = null;
        delete controller.sendKeys;
        delete controller.hotkeyStatus;
        delete controller.emitOverlayKey;
        delete controller.focusButton;
    }, 'hotkey dev hooks');
}
