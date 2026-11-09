// FileProbe: asynchronous file checks (does it exist, its display name / icon) that can never freeze
// the shell, however slow or hung the file system is (a network share that stopped answering).
//
// Every check is a Gio query_info_async (run in GIO's worker threads) with a deadline: a caller gets
// 'timeout' `timeoutMs` after its query was sent, even when the query itself is still stuck. Same file +
// attributes while a query waits or runs: the callers share it. At most `maxInFlight` queries run at once
// (the rest wait in order; an overdue query gives its slot up), so a hung mount cannot take every worker
// thread; and once a query below a path prefix (its first three components, e.g. /mnt/nas/share, or
// scheme://host) overran its deadline, further checks below that prefix answer 'timeout' at once until
// it returns.
//
// Public API:
//   new FileProbe(scope: Scope, options?: {timeoutMs?, maxInFlight?, query?})   query: injectable (tests)
//   probe.query(file: Gio.File, attributes: string): Promise<ProbeResult>   {state, info}
//   probe.exists(path: string): Promise<ProbeState>    'ok' (exists) | 'missing' | 'timeout' (unknown)
//   probe.cancel(): void           cancel the running queries and answer every waiting caller 'timeout'
//                                  (menu closed); the probe stays usable
//   probe.running: number          queries running within their deadline (tests)
//   Disposing the scope cancels everything; later calls answer 'timeout'.
//   ProbeState: 'ok' | 'missing' (any error but a cancellation: not found, no permission...) | 'timeout'

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {Scope} from './scope.js';

export type ProbeState = 'ok' | 'missing' | 'timeout';

export interface ProbeResult {
    state: ProbeState;
    info: Gio.FileInfo | null;
}

export type QueryFn = (file: Gio.File, attributes: string, cancellable: Gio.Cancellable,
    done: (info: Gio.FileInfo | null, err: unknown) => void) => void;

export interface FileProbeOptions {
    timeoutMs?: number;
    maxInFlight?: number;
    query?: QueryFn;
}

const DEFAULT_TIMEOUT_MS = 400;
const DEFAULT_MAX_IN_FLIGHT = 8;
const TIMEOUT: ProbeResult = Object.freeze({state: 'timeout', info: null}) as ProbeResult;

interface Waiter {
    resolve(r: ProbeResult): void;
    cancelTimer: () => void;
}

interface Job {
    key: string;
    file: Gio.File;
    attributes: string;
    prefix: string;
    waiters: Set<Waiter>;
    started: boolean;
    /** Ran past every caller's deadline: counted as hung below its prefix until it returns. */
    overdue: boolean;
}

const defaultQuery: QueryFn = (file, attributes, cancellable, done) => {
    file.query_info_async(attributes, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
        (_f: Gio.File | null, res: Gio.AsyncResult) => {
            try {
                done(file.query_info_finish(res), null);
            } catch (e) {
                done(null, e);
            }
        });
};

/** The part of a location that one mount most likely holds: /a/b/c of a path, scheme://host of a uri. */
export function probePrefix(file: Gio.File): string {
    const path = file.get_path();
    if (path)
        return `/${path.split('/').filter(Boolean).slice(0, 3).join('/')}`;
    const uri = file.get_uri();
    const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)/i.exec(uri);
    return m ? m[1] : uri;
}

function isCancelled(e: unknown): boolean {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class FileProbe {
    private readonly _scope: Scope;
    private readonly _timeoutMs: number;
    private readonly _max: number;
    private readonly _query: QueryFn;
    private _cancellable = new Gio.Cancellable();
    private readonly _jobs = new Map<string, Job>();
    private readonly _queue: Job[] = [];
    private readonly _hung = new Map<string, number>();
    private _running = 0;
    private _disposed = false;

    constructor(scope: Scope, options: FileProbeOptions = {}) {
        this._scope = scope;
        this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this._max = Math.max(1, options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT);
        this._query = options.query ?? defaultQuery;
        scope.add(() => {
            this.cancel();
            this._disposed = true;
        }, 'FileProbe');
    }

    get running(): number {
        return this._running;
    }

    exists(path: string): Promise<ProbeState> {
        return this.query(Gio.File.new_for_path(path), 'standard::type').then(r => r.state);
    }

    query(file: Gio.File, attributes: string): Promise<ProbeResult> {
        if (this._disposed)
            return Promise.resolve(TIMEOUT);
        const prefix = probePrefix(file);
        if ((this._hung.get(prefix) ?? 0) > 0)
            return Promise.resolve(TIMEOUT);
        const key = `${attributes}\u0000${file.get_uri()}`;
        let job = this._jobs.get(key);
        if (!job) {
            job = {key, file, attributes, prefix, waiters: new Set(), started: false, overdue: false};
            this._jobs.set(key, job);
            this._queue.push(job);
        }
        const theJob = job;
        const promise = new Promise<ProbeResult>(resolve => {
            const waiter: Waiter = {resolve, cancelTimer: () => {}};
            theJob.waiters.add(waiter);
            if (theJob.started)
                this._arm(theJob, waiter);
        });
        this._pump();
        return promise;
    }

    /**
     * The deadline runs from the moment the query is sent (a queued one waits for a slot, and a slot frees at
     * the latest when its query overruns), so a burst of local checks is never cut short by its own queue.
     */
    private _arm(job: Job, waiter: Waiter): void {
        waiter.cancelTimer = this._scope.timeout(this._timeoutMs, () => {
            job.waiters.delete(waiter);
            waiter.resolve(TIMEOUT);
            if (job.waiters.size === 0)
                this._abandon(job);
        });
    }

    cancel(): void {
        const cancellable = this._cancellable;
        this._cancellable = new Gio.Cancellable();
        const jobs = [...this._jobs.values()];
        this._jobs.clear();
        this._queue.length = 0;
        for (const job of jobs) {
            const waiters = [...job.waiters];
            job.waiters.clear();
            for (const w of waiters) {
                w.cancelTimer();
                w.resolve(TIMEOUT);
            }
            // A running query frees its slot when it returns (at once once cancelled, unless the mount hangs:
            // then it must not hold a slot, and its prefix counts as hung until it does return).
            if (job.started && !job.overdue) {
                job.overdue = true;
                this._running--;
                this._hung.set(job.prefix, (this._hung.get(job.prefix) ?? 0) + 1);
            }
        }
        cancellable.cancel();
    }

    /** Every caller of `job` gave up: drop it from the queue, or count it as hung below its prefix. */
    private _abandon(job: Job): void {
        if (!job.started) {
            const i = this._queue.indexOf(job);
            if (i >= 0)
                this._queue.splice(i, 1);
            if (this._jobs.get(job.key) === job)
                this._jobs.delete(job.key);
            return;
        }
        if (job.overdue)
            return;
        job.overdue = true;
        this._running--;
        this._hung.set(job.prefix, (this._hung.get(job.prefix) ?? 0) + 1);
        if (this._jobs.get(job.key) === job)
            this._jobs.delete(job.key);
        this._pump();
    }

    private _pump(): void {
        while (!this._disposed && this._running < this._max && this._queue.length > 0) {
            const job = this._queue.shift() as Job;
            if ((this._hung.get(job.prefix) ?? 0) > 0) {
                // the mount hung meanwhile: do not send one more query into it
                this._jobs.delete(job.key);
                for (const w of job.waiters) {
                    w.cancelTimer();
                    w.resolve(TIMEOUT);
                }
                continue;
            }
            this._start(job);
        }
    }

    private _start(job: Job): void {
        job.started = true;
        this._running++;
        for (const w of job.waiters)
            this._arm(job, w);
        let finished = false;
        const done = (info: Gio.FileInfo | null, err: unknown) => {
            if (finished)
                return;
            finished = true;
            if (job.overdue) {
                const left = (this._hung.get(job.prefix) ?? 1) - 1;
                if (left > 0)
                    this._hung.set(job.prefix, left);
                else
                    this._hung.delete(job.prefix);
            } else {
                this._running--;
            }
            if (this._jobs.get(job.key) === job)
                this._jobs.delete(job.key);
            const result: ProbeResult = info ? {state: 'ok', info} : isCancelled(err) ? TIMEOUT : {state: 'missing', info: null};
            const waiters = [...job.waiters];
            job.waiters.clear();
            for (const w of waiters) {
                w.cancelTimer();
                w.resolve(result);
            }
            this._pump();
        };
        try {
            this._query(job.file, job.attributes, this._cancellable, done);
        } catch (e) {
            done(null, e);
        }
    }
}
