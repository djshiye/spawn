// DBusService: session-bus API.
//
// Public interface   io.github.djshiye.Spawn  at /io/github/djshiye/Spawn
//   Toggle()                      toggle the menu on the default button
//   ToggleRunner()                toggle the standalone runner (search-only popup, no panel button needed)
//   RunningVersion (property, read-only)  the version of the code the shell is running; the settings window
//                                 compares it with its own to say "log out and back in" after an update
// A dev interface for the headless test sandbox lives in src/dev/devDbus.ts. It is DEV BUILDS ONLY: a release package
// has none of it (see src/core/flavour.ts).
//
// Every handler checks that the service is alive and never throws into GDBus.
//
// Public API:
//   new DBusService(scope, settings, controller: MenuController, runningVersion?: string)
//   service.start(): void
//   MenuController: {toggle(source?), open(), close(), search(query), attachmentStatus(): string,
//                    toggleRunner(), openRunner?(), closeRunner?(), runnerState?(): string,
//                    hotkeyStatus?(): string, emitOverlayKey?(): void}

import Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import {DBUS_NAME, DBUS_PATH} from '../core/constants.js';
import {error, log} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {DevExporter} from '../dev/devDbus.js';

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
    <property name="RunningVersion" type="s" access="read"/>
  </interface>
</node>`;

type Invocation = Gio.DBusMethodInvocation;

export class DBusService {
    private readonly _controller: MenuController;
    private readonly _runningVersion: string;
    private _disposed = false;
    private _ownerId = 0;
    private _main: Gio.DBusExportedObject | null = null;
    private readonly _devExport: DevExporter;

    constructor(scope: Scope, settings: SpawnSettings, controller: MenuController, runningVersion = '') {
        this._controller = controller;
        this._runningVersion = runningVersion;
        this._devExport = new DevExporter(scope, settings, {
            controller,
            disposed: () => this._disposed,
            call: (invocation, fn) => this._call(invocation, fn),
        });
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

        this._devExport.start();
    }

    // ---- exported objects ----

    private _onBusAcquired(connection: Gio.DBusConnection): void {
        if (this._disposed)
            return;
        try {
            this._main = Gio.DBusExportedObject.wrapJSObject(MAIN_IFACE, this._mainImpl());
            this._main.export(connection, DBUS_PATH);
            this._devExport.attach(connection);
        } catch (e) {
            error('D-Bus export failed', e);
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
        this._devExport.dispose();
        this._unexport(this._main);
        this._main = null;
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
        const running = this._runningVersion;
        return {
            ToggleAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.toggle());
            },
            ToggleRunnerAsync: (_params: unknown[], invocation: Invocation) => {
                this._call(invocation, () => this._controller.toggleRunner());
            },
            get RunningVersion(): string {
                return running;
            },
        };
    }
}
