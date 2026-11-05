// DBusService: session-bus API.
//
// Public interface   io.github.djshiye.Spawn  at /io/github/djshiye/Spawn
//   Toggle()                      toggle the menu on the default button
//   ToggleRunner()                toggle the standalone runner (search-only popup, no panel button needed)
// Dev interface      io.github.djshiye.Spawn.Dev   (exported ONLY while `dev-mode` is true;
//                                 follows the setting live)
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
// Every handler checks that the service is alive and never throws into GDBus.
//
// Public API:
//   new DBusService(scope, settings, controller: MenuController)
//   service.start(): void
//   MenuController: {toggle(source?), open(), close(), search(query), attachmentStatus(): string,
//                    toggleRunner(), openRunner?(), closeRunner?(), runnerState?(): string,
//                    hotkeyStatus?(): string, emitOverlayKey?(): void}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {DBUS_NAME, DBUS_PATH} from '../core/constants.js';
import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {screenshotPath} from './paths.js';

/** Who asked for the toggle: only a Super press hands back to the Overview when it cannot open. */
export type ToggleSource = 'super' | 'accelerator' | 'dbus';

export interface MenuController {
    toggle(source?: ToggleSource): void;
    open(): void;
    close(): void;
    search(query: string): void;
    toggleRunner(): void;
    openRunner?(): void;
    closeRunner?(): void;
    runnerState?(): string;
    attachmentStatus(): string;
    hotkeyStatus?(): string;
    emitOverlayKey?(): void;
    focusButton?(): void;
    activateWorkspace?(index: number): void;
    sendKeys?(spec: string): void;
    benchmark?(sections: string): Promise<string>;
}

const MAIN_IFACE = `
<node>
  <interface name="io.github.djshiye.Spawn">
    <method name="Toggle"/>
    <method name="ToggleRunner"/>
  </interface>
</node>`;

const DEV_IFACE = `
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

type Invocation = Gio.DBusMethodInvocation;

export class DBusService {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _controller: MenuController;
    private _disposed = false;
    private _ownerId = 0;
    private _connection: Gio.DBusConnection | null = null;
    private _main: Gio.DBusExportedObject | null = null;
    private _dev: Gio.DBusExportedObject | null = null;

    constructor(scope: Scope, settings: SpawnSettings, controller: MenuController) {
        this._scope = scope;
        this._settings = settings;
        this._controller = controller;
        scope.add(() => this._dispose(), 'DBusService');
    }

    start(): void {
        if (this._ownerId || this._disposed)
            return;

        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            (connection: Gio.DBusConnection) => this._onBusAcquired(connection),
            null,
            () => log(`D-Bus name ${DBUS_NAME} not acquired`),
        );

        this._settings.onChanged(this._scope, ['dev-mode'], () => this._syncDev());
    }

    // ---- exported objects ----

    private _onBusAcquired(connection: Gio.DBusConnection): void {
        if (this._disposed)
            return;
        try {
            this._connection = connection;
            this._main = Gio.DBusExportedObject.wrapJSObject(MAIN_IFACE, this._mainImpl());
            this._main.export(connection, DBUS_PATH);
            this._syncDev();
        } catch (e) {
            error('D-Bus export failed', e);
        }
    }

    private _syncDev(): void {
        if (this._disposed || !this._connection)
            return;
        try {
            const want = this._settings.get('dev-mode');
            if (want && !this._dev) {
                this._dev = Gio.DBusExportedObject.wrapJSObject(DEV_IFACE, this._devImpl());
                this._dev.export(this._connection, DBUS_PATH);
                log('Dev D-Bus interface enabled');
            } else if (!want && this._dev) {
                this._unexport(this._dev);
                this._dev = null;
            }
        } catch (e) {
            error('Dev interface sync failed', e);
        }
    }

    private _unexport(obj: Gio.DBusExportedObject | null): void {
        try {
            obj?.unexport();
        } catch (e) {
            error('D-Bus unexport failed', e);
        }
    }

    private _dispose(): void {
        this._disposed = true;
        this._unexport(this._dev);
        this._unexport(this._main);
        this._dev = null;
        this._main = null;
        this._connection = null;
        if (this._ownerId) {
            try {
                Gio.bus_unown_name(this._ownerId);
            } catch (e) {
                error('bus_unown_name failed', e);
            }
            this._ownerId = 0;
        }
    }

    // ---- method implementations ----

    /** Runs `fn`, answering the invocation with the result or a D-Bus error. */
    private _call(invocation: Invocation, fn: () => GLib.Variant | void): void {
        if (this._disposed) {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', 'Spawn is disabled');
            return;
        }
        try {
            invocation.return_value(fn() ?? null);
        } catch (e) {
            error('D-Bus handler failed', e);
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', e instanceof Error ? e.message : String(e));
        }
    }

    private _mainImpl(): object {
        return {
            ToggleAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.toggle());
            },
            ToggleRunnerAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.toggleRunner());
            },
        };
    }

    private _devImpl(): object {
        return {
            OpenAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.open());
            },
            CloseAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.close());
            },
            SearchAsync: ([query]: [string], invocation: Invocation) => {
                this._call(invocation, () => this._controller.search(query));
            },
            AttachmentStatusAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => new GLib.Variant('(s)', [this._controller.attachmentStatus()]));
            },
            HotkeyStatusAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => new GLib.Variant('(s)', [this._controller.hotkeyStatus?.() ?? '{}']));
            },
            OpenRunnerAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.openRunner?.());
            },
            CloseRunnerAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.closeRunner?.());
            },
            RunnerStateAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => new GLib.Variant('(s)', [this._controller.runnerState?.() ?? '{}']));
            },
            EmitOverlayKeyAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.emitOverlayKey?.());
            },
            FocusButtonAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.focusButton?.());
            },
            ActivateWorkspaceAsync: ([index]: [number], invocation: Invocation) => {
                this._call(invocation, () => this._controller.activateWorkspace?.(index));
            },
            SendKeysAsync: ([spec]: [string], invocation: Invocation) => {
                this._call(invocation, () => this._controller.sendKeys?.(spec));
            },
            BenchmarkAsync: ([sections]: [string], invocation: Invocation) => {
                const run = this._controller.benchmark;
                if (!run) {
                    this._call(invocation, () => {
                        throw new Error('benchmark is not available');
                    });
                    return;
                }
                run.call(this._controller, sections).then(json => {
                    this._call(invocation, () => new GLib.Variant('(s)', [json]));
                }).catch(e => {
                    error('benchmark failed', e);
                    if (!this._disposed)
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
                this._screenshot(allowed).then(() => {
                    this._call(invocation, () => undefined);
                }).catch(e => {
                    error('screenshot failed', e);
                    if (!this._disposed)
                        invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', e instanceof Error ? e.message : String(e));
                });
            },
        };
    }

    private async _screenshot(path: string): Promise<void> {
        if (this._disposed)
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
}
