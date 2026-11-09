// RELEASE replacement for src/dev/devDbus.ts: the dev D-Bus interface does not exist in a release build.
// Copied over the real file by tools/build.sh --release.

import type Gio from 'gi://Gio';
import type GLib from 'gi://GLib';

import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import type {MenuController} from '../input/dbus.js';

export interface DevHost {
    controller: MenuController;
    disposed(): boolean;
    call(invocation: Gio.DBusMethodInvocation, fn: () => GLib.Variant | void): void;
}

export class DevExporter {
    constructor(_scope: Scope, _settings: SpawnSettings, _host: DevHost) {
    }

    start(): void {
    }

    attach(_connection: Gio.DBusConnection): void {
    }

    dispose(): void {
    }
}
