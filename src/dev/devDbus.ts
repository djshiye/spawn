// The dev D-Bus interface io.github.djshiye.Spawn.Dev: Open/Close, Search, Screenshot, SendKeys, Benchmark ...
// DEV BUILDS ONLY. tools/build.sh --release replaces this file with build-aux/release-stubs/src/dev/devDbus.ts, so
// a release package contains none of it (and src/core/flavour.ts makes the `dev-mode` setting inert there).
// The interface is exported only while the dev build's `dev-mode` setting is true (following it live).
//
//   Open() / Close()
//   Search(s query)               no-op until the search UI exists
//   Screenshot(s path)            Shell.Screenshot of the whole stage, written in-process;
//                                 the call returns after the file is complete. The path must be
//                                 under $XDG_RUNTIME_DIR or contain a '/.dev/' directory
//                                 (input/paths.ts); anything else is an AccessDenied D-Bus error.
//   AttachmentStatus() -> s       JSON: {attachments: [{key, kind, monitorIndex, attached,
//                                 fallback, side}], pending, pendingForMs}
//   HotkeyStatus() -> s           JSON of Hotkeys.status() (overlay-key handler ids, toggles, ...)
//   OpenRunner() / CloseRunner()  open / close the standalone runner (ToggleRunner toggles)
//   RunnerState() -> s            JSON: SpawnRunner.debugState() plus accelBound (the runner-hotkey binding)
//   Benchmark(s sections) -> s    JSON timings measured inside the shell (src/dev/benchmark.ts);
//                                 async, may take several seconds
//   EmitOverlayKey()              emits 'overlay-key' on global.display, like pressing Super alone
//                                 (bypasses mutter's keybinding filter: use Ui.Key Super_L for a real press)
//   SendKeys(s spec)              virtual-keyboard events, e.g. "+Super_L +space -space -Super_L"
//                                 ('+' press, '-' release, Clutter.KEY_* names); chords for accelerators
//   ActivateWorkspace(i i)        switch to workspace i (Show Desktop per-workspace tests)
//   FocusButton()                 give the panel button the key focus (keyboard activation tests)
//

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {DBUS_PATH} from '../core/constants.js';
import {isDevMode} from '../core/flavour.js';
import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {screenshotPath} from '../input/paths.js';
import type {MenuController} from '../input/dbus.js';

type Invocation = Gio.DBusMethodInvocation;

/** What input/dbus.ts lends the dev interface. */
export interface DevHost {
    controller: MenuController;
    disposed(): boolean;
    call(invocation: Invocation, fn: () => GLib.Variant | void): void;
}

export const DEV_IFACE = `
<node>
  <interface name="io.github.djshiye.Spawn.Dev">
    <method name="Open"/>
    <method name="Close"/>
    <method name="Search"><arg type="s" direction="in" name="query"/></method>
    <method name="Screenshot"><arg type="s" direction="in" name="path"/></method>
    <method name="AttachmentStatus"><arg type="s" direction="out" name="json"/></method>
    <method name="HotkeyStatus"><arg type="s" direction="out" name="json"/></method>
    <method name="OpenRunner"/>
    <method name="CloseRunner"/>
    <method name="RunnerState"><arg type="s" direction="out" name="json"/></method>
    <method name="EmitOverlayKey"/>
    <method name="FocusButton"/>
    <method name="ActivateWorkspace"><arg type="i" direction="in" name="index"/></method>
    <method name="SendKeys"><arg type="s" direction="in" name="spec"/></method>
    <method name="Benchmark"><arg type="s" direction="in" name="sections"/><arg type="s" direction="out" name="json"/></method>
  </interface>
</node>`;

export function createDevImpl(host: DevHost): object {
    return {
        OpenAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.open());
        },
        CloseAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.close());
        },
        SearchAsync: ([query]: [string], invocation: Invocation) => {
            host.call(invocation, () => host.controller.search(query));
        },
        AttachmentStatusAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => new GLib.Variant('(s)', [host.controller.attachmentStatus()]));
        },
        HotkeyStatusAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => new GLib.Variant('(s)', [host.controller.hotkeyStatus?.() ?? '{}']));
        },
        OpenRunnerAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.openRunner?.());
        },
        CloseRunnerAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.closeRunner?.());
        },
        RunnerStateAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => new GLib.Variant('(s)', [host.controller.runnerState?.() ?? '{}']));
        },
        EmitOverlayKeyAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.emitOverlayKey?.());
        },
        FocusButtonAsync: (_params: unknown[], invocation: Invocation) => {
            host.call(invocation, () => host.controller.focusButton?.());
        },
        ActivateWorkspaceAsync: ([index]: [number], invocation: Invocation) => {
            host.call(invocation, () => host.controller.activateWorkspace?.(index));
        },
        SendKeysAsync: ([spec]: [string], invocation: Invocation) => {
            host.call(invocation, () => host.controller.sendKeys?.(spec));
        },
        BenchmarkAsync: ([sections]: [string], invocation: Invocation) => {
            const run = host.controller.benchmark;
            if (!run) {
                host.call(invocation, () => {
                    throw new Error('benchmark is not available');
                });
                return;
            }
            run.call(host.controller, sections).then(json => {
                host.call(invocation, () => new GLib.Variant('(s)', [json]));
            }).catch(e => {
                error('benchmark failed', e);
                if (!host.disposed())
                    invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', e instanceof Error ? e.message : String(e));
            });
        },
        ScreenshotAsync: ([path]: [string], invocation: Invocation) => {
            const allowed = screenshotPath(path, GLib.get_user_runtime_dir());
            if (allowed === null) {
                warn(`screenshot path rejected: ${path}`);
                invocation.return_dbus_error(
                    'org.freedesktop.DBus.Error.AccessDenied',
                    'path must be under $XDG_RUNTIME_DIR or a directory containing /.dev/');
                return;
            }
            screenshot(host,allowed).then(() => {
                host.call(invocation, () => undefined);
            }).catch(e => {
                error('screenshot failed', e);
                if (!host.disposed())
                    invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', e instanceof Error ? e.message : String(e));
            });
        },
    };
}

async function screenshot(host: DevHost, path: string): Promise<void> {
    if (host.disposed())
        throw new Error('Spawn is disabled');
    const file = Gio.File.new_for_path(path);
    const dir = file.get_parent();
    if (dir && !dir.query_exists(null))
        dir.make_directory_with_parents(null);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    try {
        const shooter = new Shell.Screenshot();
        await shooter.screenshot(false, stream);
    } finally {
        stream.close(null);
    }
}

/** Exports / withdraws the dev interface as the `dev-mode` setting (dev builds only) changes. */
export class DevExporter {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _host: DevHost;
    private _connection: Gio.DBusConnection | null = null;
    private _dev: Gio.DBusExportedObject | null = null;
    private _gone = false;

    constructor(scope: Scope, settings: SpawnSettings, host: DevHost) {
        this._scope = scope;
        this._settings = settings;
        this._host = host;
    }

    start(): void {
        this._settings.onChanged(this._scope, ['dev-mode'], () => this._sync());
    }

    attach(connection: Gio.DBusConnection): void {
        this._connection = connection;
        this._sync();
    }

    dispose(): void {
        this._gone = true;
        this._withdraw();
        this._connection = null;
    }

    private _sync(): void {
        if (this._gone || !this._connection)
            return;
        try {
            const want = isDevMode(this._settings);
            if (want && !this._dev) {
                this._dev = Gio.DBusExportedObject.wrapJSObject(DEV_IFACE, createDevImpl(this._host));
                this._dev.export(this._connection, DBUS_PATH);
                log('Dev D-Bus interface enabled');
            } else if (!want) {
                this._withdraw();
            }
        } catch (e) {
            error('Dev interface sync failed', e);
        }
    }

    private _withdraw(): void {
        try {
            this._dev?.unexport();
        } catch (e) {
            error('D-Bus unexport failed', e);
        }
        this._dev = null;
    }
}
