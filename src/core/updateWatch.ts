// UpdateWatch: tells the user, once, that Spawn was updated on disk while an older version is still running.
//
// The running version is the one the extension was LOADED with (Extension.metadata at load time, handed in by
// extension.ts); the installed version is read from metadata.json again whenever that file changes (a package
// update replaces it). When the two differ, `notify(version)` is called ONCE per login session (`state` outlives
// disable / enable, which do not reload the code). A first install or a normal login never differs, so nothing is
// shown then.
//
// Public API:
//   new UpdateWatch(scope, {file, running, notify, state})
//     file:    Gio.File of the installed metadata.json
//     running: version-name this code was loaded with
//     notify:  (installedVersion) => void, shows the message
//     state:   {notified: boolean}, kept by the Extension object so a disable / enable does not repeat the message
//   watch.start(): void    start monitoring; metadata.json is read asynchronously (after a settle delay), and the
//                          monitor is stopped once the message was shown

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {debounce} from './debounce.js';
import {error} from './log.js';
import type {Scope} from './scope.js';
import {parseMetadataVersion, updatePending} from './updateNotice.js';

const SETTLE_MS = 1500; // a package update writes several files; look once they are done

export interface UpdateWatchOptions {
    file: Gio.File;
    running: string | null;
    notify: (installed: string) => void;
    state: {notified: boolean};
}

export class UpdateWatch {
    private readonly _scope: Scope;
    private readonly _options: UpdateWatchOptions;
    private readonly _check: {call(): void};
    private _monitor: Gio.FileMonitor | null = null;
    private _disposed = false;
    private readonly _cancellable = new Gio.Cancellable();

    constructor(scope: Scope, options: UpdateWatchOptions) {
        this._scope = scope;
        this._options = options;
        this._check = debounce(scope, SETTLE_MS, () => this._checkNow());
        scope.add(() => {
            this._disposed = true;
            this._cancellable.cancel();
        }, 'UpdateWatch read');
    }

    start(): void {
        try {
            const monitor = this._options.file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor = monitor;
            this._scope.add(() => monitor.cancel(), 'UpdateWatch monitor');
            this._scope.connect(monitor, 'changed', () => this._check.call());
        } catch (e) {
            error('cannot watch metadata.json', e);
        }
    }

    private _checkNow(): void {
        if (this._options.state.notified)
            return;
        const {file} = this._options;
        file.load_contents_async(this._cancellable, (_f: Gio.File | null, res: Gio.AsyncResult) => {
            if (this._disposed)
                return;
            try {
                const [ok, bytes] = file.load_contents_finish(res);
                if (ok)
                    this._read(bytes);
            } catch (e) {
                if (!(e instanceof GLib.Error) || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    error('cannot read metadata.json', e);
            }
        });
    }

    private _read(bytes: Uint8Array): void {
        const {running, notify, state} = this._options;
        if (state.notified)
            return;
        const installed = parseMetadataVersion(new TextDecoder().decode(bytes));
        if (installed && updatePending(running, installed)) {
            state.notified = true;
            // Nothing more to say this session: later checks would return at once, so stop listening.
            this._monitor?.cancel();
            this._monitor = null;
            notify(installed);
        }
    }
}
