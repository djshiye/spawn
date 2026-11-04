// Scope: LIFO disposer that owns every resource an object creates.
//
// Public API:
//   new Scope(label?)
//   scope.add(fn, label?)            register a teardown; returns `release()` which runs
//                                    that teardown NOW (once) and unregisters it
//   scope.connect(obj, sig, cb)      obj.connect + automatic disconnect; returns the
//                                    handler id
//   scope.timeout(ms, cb)            one-shot GLib timeout, owned; returns cancel()
//   scope.interval(ms, cb)           repeating GLib timeout (cb returns false to stop)
//   scope.idle(cb)                   one-shot idle; returns cancel()
//   scope.child(label?)              nested Scope disposed with its parent; disposing the child
//                                    releases its entry in the parent (no dead entries pile up),
//                                    and a child that is reused after dispose re-registers itself
//   scope.dispose()                  runs teardowns newest-first, each in try/catch;
//                                    never throws; the scope is re-usable afterwards
//   scope.size                       number of live teardowns (for tests)
//
// Callbacks passed to timeout/interval/idle/connect are wrapped in try/catch so a
// throwing callback cannot escape into the shell main loop.

import GLib from 'gi://GLib';

import {error} from './log.js';

export type Teardown = () => void;

interface SignalEmitter {
    connect(signal: string, callback: (...args: any[]) => any): number;
    disconnect(id: number): void;
}

interface Entry {
    fn: Teardown;
    label: string;
}

export class Scope {
    private _entries: Entry[] = [];
    private readonly _label: string;
    /** For a child scope: the parent and the parent's entry that disposes this scope. */
    private _parent: Scope | null = null;
    private _parentEntry: Entry | null = null;
    private _disposing = false;

    constructor(label = 'scope') {
        this._label = label;
    }

    get label(): string {
        return this._label;
    }

    get size(): number {
        return this._entries.length;
    }

    add(fn: Teardown, label = 'teardown'): () => void {
        const entry = this._register(fn, label);
        return () => {
            if (this._forget(entry))
                this._run(entry);
        };
    }

    connect(obj: SignalEmitter, signal: string, callback: (...args: any[]) => any): number {
        const id = obj.connect(signal, (...args: any[]) => {
            try {
                return callback(...args);
            } catch (e) {
                error(`handler for '${signal}' threw in ${this._label}`, e);
                return undefined;
            }
        });
        this._register(() => obj.disconnect(id), `disconnect ${signal}`);
        return id;
    }

    timeout(ms: number, callback: () => void): () => void {
        return this._source('timeout', done => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, ms), () => {
            done();
            this._call(callback);
            return GLib.SOURCE_REMOVE;
        }));
    }

    interval(ms: number, callback: () => boolean | void): () => void {
        return this._source('interval', done => GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
            if (this._call(callback) !== false)
                return GLib.SOURCE_CONTINUE;
            done();
            return GLib.SOURCE_REMOVE;
        }));
    }

    idle(callback: () => void): () => void {
        return this._source('idle', done => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            done();
            this._call(callback);
            return GLib.SOURCE_REMOVE;
        }));
    }

    child(label = 'child'): Scope {
        const c = new Scope(`${this._label}/${label}`);
        c._parent = this;
        c._attach(`child ${label}`);
        return c;
    }

    dispose(): void {
        this._disposing = true;
        try {
            // Drop our entry from the parent so disposed children do not pile up there. When the
            // parent is the one disposing us, it already popped the entry and this is a no-op.
            this._detach();
            // Teardowns may register new teardowns while running; loop until empty.
            for (let entry = this._entries.pop(); entry; entry = this._entries.pop())
                this._run(entry);
        } finally {
            this._disposing = false;
        }
    }

    private _attach(label = 'child'): void {
        this._parentEntry = this._parent?._register(() => this.dispose(), label) ?? null;
    }

    private _detach(): void {
        const entry = this._parentEntry;
        this._parentEntry = null;
        if (entry)
            this._parent?._forget(entry);
    }

    private _register(fn: Teardown, label: string): Entry {
        // A disposed child that is used again must be disposed with its parent again.
        if (this._parent && !this._parentEntry && !this._disposing)
            this._attach();
        const entry: Entry = {fn, label};
        this._entries.push(entry);
        return entry;
    }

    private _forget(entry: Entry): boolean {
        const i = this._entries.indexOf(entry);
        if (i < 0)
            return false;
        this._entries.splice(i, 1);
        return true;
    }

    private _run(entry: Entry): void {
        try {
            entry.fn();
        } catch (e) {
            error(`teardown '${entry.label}' failed in ${this._label}`, e);
        }
    }

    private _call(callback: () => boolean | void): boolean | void {
        try {
            return callback();
        } catch (e) {
            error(`callback threw in ${this._label}`, e);
            return false;
        }
    }

    // Registers a GLib source. `create` receives a `done` function that the source calls
    // when it finishes by itself, so the teardown never removes a source that is gone.
    private _source(label: string, create: (done: () => void) => number): () => void {
        let id = 0;
        let finished = false;
        let entry: Entry | null = null;
        const done = () => {
            finished = true;
            if (entry)
                this._forget(entry);
        };
        id = create(done);
        entry = this._register(() => {
            if (!finished) {
                finished = true;
                GLib.Source.remove(id);
            }
        }, label);
        const registered = entry;
        return () => {
            if (this._forget(registered))
                this._run(registered);
        };
    }
}
