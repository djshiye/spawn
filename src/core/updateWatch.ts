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
//   watch.start(): void    start monitoring (and check once)

import Gio from 'gi://Gio';

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

    constructor(scope: Scope, options: UpdateWatchOptions) {
        this._scope = scope;
        this._options = options;
        this._check = debounce(scope, SETTLE_MS, () => this._checkNow());
    }

    start(): void {
        try {
            const monitor = this._options.file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._scope.add(() => monitor.cancel(), 'UpdateWatch monitor');
            this._scope.connect(monitor, 'changed', () => this._check.call());
        } catch (e) {
            error('cannot watch metadata.json', e);
        }
    }

    private _checkNow(): void {
        const {file, running, notify, state} = this._options;
        if (state.notified)
            return;
        try {
            const [ok, bytes] = file.load_contents(null);
            if (!ok)
                return;
            const installed = parseMetadataVersion(new TextDecoder().decode(bytes));
            if (installed && updatePending(running, installed)) {
                state.notified = true;
                notify(installed);
            }
        } catch (e) {
            error('cannot read metadata.json', e);
        }
    }
}
