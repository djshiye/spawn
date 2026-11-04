// PanelTargets: answers "which panels should carry the menu button RIGHT NOW?".
//
// Public API:
//   new PanelTargets(scope, {isMultiMonitor: () => boolean})
//   targets.start()                      connect to the shell; idempotent
//   targets.resolve(): Resolution        builds a fresh snapshot (re-reads global.dashToPanel
//                                        and global.azTaskbar) and validates every panel;
//                                        NEVER returns cached panel references
//   targets.onChanged(scope, cb)         cb() after the target set may have changed
//                                        (debounced 150 ms, owned by `scope`)
//   targets.notifyChanged()              request a (debounced) 'changed' manually
//   readPanelGlobals()                   the single place that touches global.dashToPanel /
//                                        global.azTaskbar
//
// Triggers for 'changed': extension-state-changed of Dash to Panel / App Icons Taskbar,
// 'panels-created' of the CURRENT emitter (re-bound whenever the emitter object is
// replaced, which Dash to Panel does on every enable), and monitors-changed.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AZ_TASKBAR_UUID, DTP_UUID} from '../core/constants.js';
import {debounce, type Debounced} from '../core/debounce.js';
import {error, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import {
    type ExtensionSnapshot,
    type PanelEmitterLike,
    type PanelLike,
    type Resolution,
    resolveTargets,
} from './validate.js';

export const CHANGED_DEBOUNCE_MS = 150;

interface ConnectableEmitter extends PanelEmitterLike {
    connect?: (signal: string, cb: (...args: any[]) => void) => number;
    disconnect?: (id: number) => void;
}

export interface PanelGlobals {
    dashToPanel?: ConnectableEmitter | null;
    azTaskbar?: ConnectableEmitter | null;
}

/** Re-reads the globals on every call: they are replaced whenever the extension restarts. */
export function readPanelGlobals(): PanelGlobals {
    const g = global as unknown as PanelGlobals;
    return {dashToPanel: g.dashToPanel, azTaskbar: g.azTaskbar};
}

interface Binding {
    emitter: ConnectableEmitter;
    id: number;
}

const PROVIDERS = [
    {kind: 'dtp', uuid: DTP_UUID, global: 'dashToPanel'},
    {kind: 'aztaskbar', uuid: AZ_TASKBAR_UUID, global: 'azTaskbar'},
] as const;

export interface PanelTargetsOptions {
    isMultiMonitor: () => boolean;
}

export class PanelTargets {
    private readonly _scope: Scope;
    private readonly _options: PanelTargetsOptions;
    private readonly _listeners = new Set<() => void>();
    private readonly _bindings = new Map<string, Binding>();
    private readonly _changed: Debounced;
    private _started = false;

    constructor(scope: Scope, options: PanelTargetsOptions) {
        this._scope = scope;
        this._options = options;
        this._changed = debounce(scope, CHANGED_DEBOUNCE_MS, () => this._emit());
        scope.add(() => {
            this._unbindAll();
            this._listeners.clear();
            this._started = false;
        }, 'PanelTargets');
    }

    start(): void {
        if (this._started)
            return;
        this._started = true;

        try {
            this._scope.connect(Main.extensionManager, 'extension-state-changed', (_m: unknown, extension: {uuid?: string}) => {
                if (!PROVIDERS.some(p => p.uuid === extension?.uuid))
                    return;
                this._rebind();
                this._changed.call();
            });
        } catch (e) {
            error('cannot watch extension-state-changed', e);
        }

        try {
            this._scope.connect(Main.layoutManager, 'monitors-changed', () => this._changed.call());
        } catch (e) {
            error('cannot watch monitors-changed', e);
        }

        this._rebind();
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'PanelTargets listener');
    }

    notifyChanged(): void {
        this._changed.call();
    }

    resolve(): Resolution {
        const globals = readPanelGlobals();
        const extensions: ExtensionSnapshot[] = PROVIDERS.map(p => ({
            kind: p.kind,
            state: this._extensionState(p.uuid),
            emitter: globals[p.global],
        }));

        let primaryMonitorIndex = 0;
        try {
            primaryMonitorIndex = Main.layoutManager.primaryIndex;
        } catch {
            primaryMonitorIndex = 0;
        }

        return resolveTargets({
            main: Main.panel as unknown as PanelLike,
            extensions,
            multiMonitor: this._options.isMultiMonitor(),
            primaryMonitorIndex,
        });
    }

    private _extensionState(uuid: string): number | undefined {
        try {
            return Main.extensionManager.lookup(uuid)?.state;
        } catch {
            return undefined;
        }
    }

    private _emit(): void {
        // Iterate a copy: a listener may unsubscribe while we notify.
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                error('PanelTargets listener threw', e);
            }
        }
    }

    /** Make sure we listen to the CURRENT emitter of each provider, not an old one. */
    private _rebind(): void {
        const globals = readPanelGlobals();
        for (const p of PROVIDERS) {
            const current = globals[p.global] ?? null;
            const bound = this._bindings.get(p.kind);
            if (bound && bound.emitter === current)
                continue;
            if (bound)
                this._unbind(p.kind);
            if (!current || typeof current.connect !== 'function')
                continue;
            try {
                const id = current.connect('panels-created', () => this._changed.call());
                this._bindings.set(p.kind, {emitter: current, id});
            } catch (e) {
                warn(`cannot connect to ${p.global}`, e);
            }
        }
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

    private _unbindAll(): void {
        for (const kind of [...this._bindings.keys()])
            this._unbind(kind);
    }
}
