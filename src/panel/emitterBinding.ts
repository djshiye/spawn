// EmitterBindings: keeps ONE 'panels-created' connection per provider on the CURRENT emitter.
//
// Pure (no shell imports) so it can be unit-tested with fake emitters.
//
// Public API:
//   new EmitterBindings(read, onSignal)   read(): emitters by kind, called on every sync()
//   bindings.sync(): void                 bind to the emitters read() returns now; an emitter that
//                                         was replaced is disconnected and the new one connected
//   bindings.clear(): void                disconnect everything
//   bindings.kinds(): string[]            kinds that currently hold a connection (tests)
//
// Dash to Panel / App Icons Taskbar create a NEW emitter object on every enable, and the shell's
// extension "rebase" can do that without an extension-state-changed, so sync() must run on every
// reconcile (it is a cheap identity compare per provider).

import {warn} from '../core/log.js';

export interface ConnectableEmitter {
    connect?: (signal: string, cb: (...args: any[]) => void) => number;
    disconnect?: (id: number) => void;
}

interface Binding {
    emitter: ConnectableEmitter;
    id: number;
}

export const PANELS_CREATED = 'panels-created';

export class EmitterBindings {
    private readonly _bindings = new Map<string, Binding>();

    constructor(
        private readonly _read: () => Record<string, ConnectableEmitter | null | undefined>,
        private readonly _onSignal: () => void,
    ) {}

    sync(): void {
        const current = this._read();
        for (const kind of Object.keys(current)) {
            const emitter = current[kind] ?? null;
            const bound = this._bindings.get(kind);
            if (bound && bound.emitter === emitter)
                continue;
            if (bound)
                this._unbind(kind);
            if (!emitter || typeof emitter.connect !== 'function')
                continue;
            try {
                const id = emitter.connect(PANELS_CREATED, () => this._onSignal());
                this._bindings.set(kind, {emitter, id});
            } catch (e) {
                warn(`cannot connect to the ${kind} emitter`, e);
            }
        }
    }

    clear(): void {
        for (const kind of [...this._bindings.keys()])
            this._unbind(kind);
    }

    kinds(): string[] {
        return [...this._bindings.keys()];
    }

    private _unbind(kind: string): void {
        const bound = this._bindings.get(kind);
        this._bindings.delete(kind);
        if (!bound)
            return;
        try {
            bound.emitter.disconnect?.(bound.id);
        } catch (e) {
            warn(`stale emitter disconnect failed for ${kind}`, e);
        }
    }
}
