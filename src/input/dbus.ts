// DBusService: session-bus API.
//
// Public interface   io.github.djshiye.SpawnMenu  at /io/github/djshiye/SpawnMenu
//   Toggle()                      toggle the menu on the default button
// Dev interface      io.github.djshiye.SpawnMenu.Dev   (exported ONLY while `dev-mode` is true;
//                                 follows the setting live)
//   Open() / Close()
//   Search(s query)               no-op until the search UI exists
//   Screenshot(s path)            Shell.Screenshot of the whole stage, written in-process;
//                                 the call returns after the file is complete
//   AttachmentStatus() -> s       JSON: {attachments: [{key, kind, monitorIndex, attached,
//                                 fallback, side}], pending, pendingForMs}
//   HotkeyStatus() -> s           JSON of Hotkeys.status() (overlay-key handler ids, toggles, ...)
//   Benchmark(s sections) -> s    JSON timings measured inside the shell (src/dev/benchmark.ts);
//                                 async, may take several seconds
//   EmitOverlayKey()              emits 'overlay-key' on global.display, like pressing Super alone
//
// Every handler checks that the service is alive and never throws into GDBus.
//
// Public API:
//   new DBusService(scope, settings, controller: MenuController)
//   service.start(): void
//   MenuController: {toggle(), open(), close(), search(query), attachmentStatus(): string,
//                    hotkeyStatus?(): string, emitOverlayKey?(): void}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {DBUS_NAME, DBUS_PATH} from '../core/constants.js';
import {error, log} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';

export interface MenuController {
    toggle(): void;
    open(): void;
    close(): void;
    search(query: string): void;
    attachmentStatus(): string;
    hotkeyStatus?(): string;
    emitOverlayKey?(): void;
    benchmark?(sections: string): Promise<string>;
}

const MAIN_IFACE = `
<node>
  <interface name="io.github.djshiye.SpawnMenu">
    <method name="Toggle"/>
  </interface>
</node>`;

const DEV_IFACE = `
<node>
  <interface name="io.github.djshiye.SpawnMenu.Dev">
    <method name="Open"/>
    <method name="Close"/>
    <method name="Search"><arg type="s" direction="in" name="query"/></method>
    <method name="Screenshot"><arg type="s" direction="in" name="path"/></method>
    <method name="AttachmentStatus"><arg type="s" direction="out" name="json"/></method>
    <method name="HotkeyStatus"><arg type="s" direction="out" name="json"/></method>
    <method name="EmitOverlayKey"/>
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
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', 'Spawn Menu is disabled');
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
            EmitOverlayKeyAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.emitOverlayKey?.());
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
                this._screenshot(path).then(() => {
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
            throw new Error('Spawn Menu is disabled');
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
