// PanelTargets: answers "which panels should carry the menu button RIGHT NOW?".
//
// Public API:
//   new PanelTargets(scope, {isMultiMonitor: () => boolean})
//   targets.start()                      connect to the shell; idempotent
//   targets.resolve(): Resolution        builds a fresh snapshot (re-reads global.dashToPanel
//                                        and global.azTaskbar) and validates every panel;
//                                        NEVER returns cached panel references; also re-binds
//                                        to the current emitters (see panel/emitterBinding.ts)
//   targets.onChanged(scope, cb)         cb() after the target set may have changed
//                                        (debounced 150 ms, owned by `scope`)
//   targets.notifyChanged()              request a (debounced) 'changed' manually
//   readPanelGlobals()                   the single place that touches global.dashToPanel /
//                                        global.azTaskbar
//   createIntellihideHold(scope)         IntellihideHold (panel/intellihide.ts) wired to the live
//                                        Dash to Panel panels and the pointer
//   createFullscreenReveal(scope)        FullscreenReveal (panel/fullscreenReveal.ts) wired to the shell's
//                                        own panel box and the live Dash to Panel panel boxes
//   panelClickDeps()                     PanelClickDeps (panel/panelClick.ts) for the live stage and panels
//   closeOtherShellPopups(keep?)         close the calendar / quick settings / any other open shell menu
//                                        (panel/shellPopups.ts) before Spawn opens
//   dtpWrapperOfPanel(panel)             the current Dash to Panel wrapper of an inner panel, or null
//
// Triggers for 'changed': extension-state-changed of Dash to Panel / App Icons Taskbar,
// 'panels-created' of the CURRENT emitter (re-bound whenever the emitter object is
// replaced, which Dash to Panel does on every enable), and monitors-changed.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AZ_TASKBAR_UUID, DTP_UUID} from '../core/constants.js';
import {debounce, type Debounced} from '../core/debounce.js';
import {error} from '../core/log.js';
import {closeMenu} from '../ui/menuParams.js';
import type {Scope} from '../core/scope.js';
import {type ConnectableEmitter, EmitterBindings} from './emitterBinding.js';
import {FullscreenReveal, type PanelBoxInfo} from './fullscreenReveal.js';
import type {PanelClickDeps} from './panelClick.js';
import {closeShellPopups, menusOfStatusArea, type ShellPopupDeps} from './shellPopups.js';
import {type DtpWrapper, IntellihideHold, wrapperOfPanel} from './intellihide.js';
import {
    type ExtensionSnapshot,
    type PanelEmitterLike,
    type PanelLike,
    type Resolution,
    isActorAlive,
    resolveTargets,
} from './validate.js';

export const CHANGED_DEBOUNCE_MS = 150;

type ProviderEmitter = ConnectableEmitter & PanelEmitterLike;

export interface PanelGlobals {
    dashToPanel?: ProviderEmitter | null;
    azTaskbar?: ProviderEmitter | null;
}

/** Re-reads the globals on every call: they are replaced whenever the extension restarts. */
export function readPanelGlobals(): PanelGlobals {
    const g = global as unknown as PanelGlobals;
    return {dashToPanel: g.dashToPanel, azTaskbar: g.azTaskbar};
}

function dtpPanels(): unknown {
    return readPanelGlobals().dashToPanel?.panels;
}

export function createIntellihideHold(scope: Scope): IntellihideHold {
    return new IntellihideHold(scope, {
        panels: dtpPanels,
        pointer,
    });
}

function pointer(): [number, number] {
    const [x, y] = global.get_pointer();
    return [x, y];
}

/** The shell's top bar box (on the primary monitor) and every Dash to Panel panel box with its monitor. */
function panelBoxes(): PanelBoxInfo[] {
    const out: PanelBoxInfo[] = [];
    const panels = dtpPanels();
    if (Array.isArray(panels)) {
        for (const w of panels as DtpWrapper[])
            out.push({box: w?.panelBox as PanelBoxInfo['box'], monitor: w?.monitor});
    }
    out.push({box: Main.layoutManager.panelBox as unknown as PanelBoxInfo['box'], monitor: Main.layoutManager.primaryMonitor});
    return out;
}

export function createFullscreenReveal(scope: Scope): FullscreenReveal {
    return new FullscreenReveal(scope, {
        panels: panelBoxes,
        overviewVisible: () => Main.overview.visible,
        alive: box => isActorAlive(box as Parameters<typeof isActorAlive>[0]),
    });
}

export function panelClickDeps(): PanelClickDeps {
    return {
        panels: () => panelBoxes().map(p => p.box).filter(Boolean),
        actorAt: (x, y) => global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y),
        isButton: actor => actor instanceof St.Button,
    };
}

function shellPopupDeps(): ShellPopupDeps {
    return {
        menus: () => {
            const menus = menusOfStatusArea(Main.panel.statusArea);
            // Every panel's menu manager knows the menu that holds its grab right now (also one that is not an
            // indicator's: a Dash to Panel app's context menu).
            const wrappers = dtpPanels();
            const panels: unknown[] = [Main.panel, ...(Array.isArray(wrappers) ? (wrappers as DtpWrapper[]).map(w => w?.panel) : [])];
            for (const panel of panels) {
                const active = (panel as {menuManager?: {activeMenu?: unknown}} | null | undefined)?.menuManager?.activeMenu;
                if (active)
                    menus.push(active);
            }
            return menus;
        },
        close: menu => closeMenu(menu as PopupMenu.PopupMenu, false),
    };
}

/** Closes every other open shell menu (not those in `keep`), without animation. Returns how many it closed. */
export function closeOtherShellPopups(keep: readonly unknown[] = []): number {
    return closeShellPopups(shellPopupDeps(), keep);
}

export function dtpWrapperOfPanel(panel: unknown): DtpWrapper | null {
    return wrapperOfPanel(dtpPanels(), panel);
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
    private readonly _bindings: EmitterBindings;
    private readonly _changed: Debounced;
    private _started = false;

    constructor(scope: Scope, options: PanelTargetsOptions) {
        this._scope = scope;
        this._options = options;
        this._changed = debounce(scope, CHANGED_DEBOUNCE_MS, () => this._emit());
        this._bindings = new EmitterBindings(() => {
            const globals = readPanelGlobals();
            return Object.fromEntries(PROVIDERS.map(p => [p.kind, globals[p.global]]));
        }, () => this._changed.call());
        scope.add(() => {
            this._bindings.clear();
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
                this._bindings.sync();
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

        this._bindings.sync();
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'PanelTargets listener');
    }

    notifyChanged(): void {
        this._changed.call();
    }

    resolve(): Resolution {
        // Every reconcile/retry re-binds to the CURRENT emitter: the shell's extension rebase
        // swaps emitters without any extension-state-changed.
        if (this._started)
            this._bindings.sync();
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
}
