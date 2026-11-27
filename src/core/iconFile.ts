// IconFileCheck: is a user-chosen icon file (outside Spawn's own icon folder) a regular, decodable image? Checked
// in the background with a deadline, so an icon on a hung network share can never freeze the shell.
//
// Public API:
//   new IconFileCheck(scope, options?: {timeoutMs?, query?: QueryFn, sniff?: SniffFn})
//   check.check(path): Promise<IconVerdict>     'ok' | 'bad' (missing, not a regular file, not an image) | 'timeout'
//   check.last(path): IconVerdict | undefined   the verdict of the latest finished check of `path` (this session)
//   Disposing the scope cancels everything; later checks answer 'timeout'.
//
// One instance is SHARED by every panel button: its FileProbe remembers a hung mount, so after one overrun further
// checks below that mount answer 'timeout' at once instead of parking another worker thread in it.

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import {FileProbe, type QueryFn} from './fileProbe.js';
import type {Scope} from './scope.js';

export type IconVerdict = 'ok' | 'bad' | 'timeout';
export type SniffFn = (path: string, cancellable: Gio.Cancellable, done: (isImage: boolean) => void) => void;

export interface IconFileCheckOptions {
    timeoutMs?: number;
    query?: QueryFn;
    sniff?: SniffFn;
}

const DEFAULT_TIMEOUT_MS = 2000; // only decides when the button gives up and shows the fallback; nothing blocks

const defaultSniff: SniffFn = (path, cancellable, done) => {
    GdkPixbuf.Pixbuf.get_file_info_async(path, cancellable, (_source, res) => {
        try {
            done(GdkPixbuf.Pixbuf.get_file_info_finish(res)[0] !== null);
        } catch {
            done(false); // "Failed to recognize image format", an I/O error, cancelled
        }
    });
};

export class IconFileCheck {
    private readonly _scope: Scope;
    private readonly _probe: FileProbe;
    private readonly _sniff: SniffFn;
    private readonly _timeoutMs: number;
    private readonly _cancellable = new Gio.Cancellable();
    private readonly _last = new Map<string, IconVerdict>();
    private readonly _pending = new Set<(v: IconVerdict) => void>();
    private _disposed = false;

    constructor(scope: Scope, options: IconFileCheckOptions = {}) {
        this._scope = scope;
        this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this._sniff = options.sniff ?? defaultSniff;
        this._probe = new FileProbe(scope.child('icon probe'), {timeoutMs: this._timeoutMs, query: options.query});
        scope.add(() => {
            this._disposed = true;
            this._cancellable.cancel();
            for (const resolve of [...this._pending])
                resolve('timeout');
        }, 'IconFileCheck');
    }

    last(path: string): IconVerdict | undefined {
        return this._last.get(path);
    }

    async check(path: string): Promise<IconVerdict> {
        if (this._disposed)
            return 'timeout';
        let verdict: IconVerdict;
        try {
            verdict = await this._verdict(path);
        } catch {
            verdict = 'bad';
        }
        if (!this._disposed)
            this._last.set(path, verdict);
        return verdict;
    }

    private async _verdict(path: string): Promise<IconVerdict> {
        // FileQueryInfoFlags.NONE follows symlinks, like GLib.file_test(IS_REGULAR).
        const r = await this._probe.query(Gio.File.new_for_path(path), 'standard::type');
        if (r.state === 'timeout')
            return 'timeout';
        if (r.state === 'missing' || r.info?.get_file_type() !== Gio.FileType.REGULAR)
            return 'bad';
        if (this._disposed)
            return 'timeout';
        return this._sniffWithDeadline(path);
    }

    private _sniffWithDeadline(path: string): Promise<IconVerdict> {
        return new Promise<IconVerdict>(resolve => {
            let cancelTimer = () => {};
            const finish = (v: IconVerdict): void => {
                if (!this._pending.delete(finish))
                    return; // a late answer after the first one
                cancelTimer();
                resolve(v);
            };
            this._pending.add(finish);
            cancelTimer = this._scope.timeout(this._timeoutMs, () => finish('timeout'));
            try {
                this._sniff(path, this._cancellable, isImage => finish(isImage ? 'ok' : 'bad'));
            } catch {
                finish('bad');
            }
        });
    }
}
