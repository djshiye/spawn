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
//   activatePanelButton(actor, button, press?)  pass the closing click on to a panelClickDeps().isButton actor
//                                        (panelClickAction: St.Button `clicked`, toggle a panel menu, or replay
//                                        `press` to a tray icon that handles presses itself); true: it acted
//   forwardNextRelease(scope, actor, button)  a tray icon that got the closing press replayed also gets the
//                                        matching release (legacy tray icons click on release), unless the
//                                        shell delivers it there itself
//   passedContextMenu(actor)            the context menu a passed-on right click opened on a Dash to Panel app icon
//                                        (read once the click was activated), or null
//   openShellMenu(except?)              the shell / panel menu that is open right now (not `except`), or null
//   setPanelHover(actor, hover)          show / clear a panel button's hover look (HoverRelay in ui/menu.ts)
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
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import type * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AZ_TASKBAR_UUID, DTP_UUID} from '../core/constants.js';
import {debounce, type Debounced} from '../core/debounce.js';
import {error} from '../core/log.js';
import {closeMenu} from '../ui/menuParams.js';
import type {Scope} from '../core/scope.js';
import {type ConnectableEmitter, EmitterBindings} from './emitterBinding.js';
import {FullscreenReveal, type PanelBoxInfo} from './fullscreenReveal.js';
import {type PanelButtonKind, type PanelClickDeps, panelClickAction} from './panelClick.js';
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
        isButton: actor => actor instanceof St.Button || actor instanceof PanelMenu.Button,
    };
}

/** The kind of a panelClickDeps().isButton actor (panel/panelClick.ts PanelButtonKind). */
export function panelButtonKind(actor: unknown): PanelButtonKind {
    if (actor instanceof St.Button)
        return {kind: 'launcher'};
    if (!(actor instanceof PanelMenu.Button))
        return null;
    if (actor === (Main.panel.statusArea as Record<string, unknown>)['activities'])
        return {kind: 'activities'};
    // GNOME 49+: a panel menu button opens its menu from a Clutter.ClickGesture. The AppIndicator extension's
    // tray icons (and legacy tray icons, and dummy-menu buttons) turn that gesture off and read raw presses.
    const gesture = (actor as unknown as {_clickGesture?: {enabled?: boolean; required_button?: number}})._clickGesture;
    if (gesture && gesture.enabled === false)
        return {kind: 'raw'};
    const required = Number(gesture?.required_button ?? 0);
    return {kind: 'gesture', gestureButton: Number.isFinite(required) ? required : 0};
}

/**
 * Pass the click that closed the menu on to a panel button (panel/panelClick.ts). `press`: a copy of the
 * closing button-press event, replayed to a tray icon that handles presses itself. True when it acted.
 */
export function activatePanelButton(actor: unknown, button: number, press: Clutter.Event | null = null): boolean {
    // Another Spawn button (a second panel's): run its own click action (it reads clicks from its own gesture).
    const own = (actor as {handlePassedClick?: (button: number) => void} | null)?.handlePassedClick;
    if (typeof own === 'function') {
        own.call(actor, button);
        return true;
    }
    const action = panelClickAction(panelButtonKind(actor), button, press !== null);
    switch (action) {
    case 'clicked':
        (actor as St.Button).emit('clicked', button);
        return true;
    case 'overview':
        // Activities has a dummy menu (toggle() does nothing): it opens the Overview itself.
        Main.overview.toggle();
        return true;
    case 'toggle': {
        const menu = (actor as PanelMenu.Button | null)?.menu as {toggle?: () => void} | null | undefined;
        if (typeof menu?.toggle !== 'function')
            return false;
        menu.toggle();
        return true;
    }
    case 'context': {
        // A Dash to Panel app icon: the same call its own right-click handler makes.
        const popup = (actor as {popupMenu?: () => void} | null)?.popupMenu;
        if (typeof popup !== 'function')
            return false;
        popup.call(actor);
        return true;
    }
    case 'replay':
        // Delivered like the real press (the `event` signal, then `button-press-event`), so the tray icon's own
        // handler decides: open its menu, activate the app, secondary-activate on a middle click.
        (actor as Clutter.Actor).event(press as Clutter.Event, false);
        return true;
    default:
        return false;
    }
}

/** The context menu a passed-on right click opened on an app icon (its `_menu`, or the shell menu now open). */
export function passedContextMenu(actor: unknown): unknown {
    const own = (actor as {_menu?: {isOpen?: boolean}} | null)?._menu;
    return own?.isOpen ? own : openShellMenu();
}

/** True when passing `button` on to `actor` opens its own context menu (it has one, see activatePanelButton). */
export function opensContextMenu(actor: unknown, button: number): boolean {
    return panelClickAction(panelButtonKind(actor), button, false) === 'context'
        && typeof (actor as {popupMenu?: unknown} | null)?.popupMenu === 'function';
}

/** How long after the closing press its release is still forwarded (a long press is not a click anymore). */
export const RELEASE_FORWARD_MS = 2000;

/**
 * The release of the press that closed the menu goes to the closed popup's grab, not to the tray icon under
 * the pointer (not even a stage handler sees it), so a legacy (XEmbed) tray icon, which clicks its app on release, would never fire. Forward the
 * next release of `button` to `actor` (after the replayed press, on idle), unless it reached `actor` anyway.
 */
export function forwardNextRelease(scope: Scope, actor: unknown, button: number): void {
    const watch = scope.child('forward release');
    try {
        const target = actor as Clutter.Actor;
        let delivered = false;
        watch.connect(target, 'button-release-event', () => {
            delivered = true;
            return Clutter.EVENT_PROPAGATE;
        });
        // An event filter sees the release before any grab routing does (a stage handler never gets it).
        const filters = Clutter.Event as unknown as {
            add_filter(stage: unknown, fn: (event: Clutter.Event) => boolean): number;
            remove_filter(id: number): void;
        };
        let pending = false;
        const id = filters.add_filter(global.stage, (event: Clutter.Event) => {
            if (pending || event.type() !== Clutter.EventType.BUTTON_RELEASE || event.get_button() !== button)
                return Clutter.EVENT_PROPAGATE;
            pending = true;
            const release = typeof event.copy === 'function' ? event.copy() : event;
            watch.idle(() => {
                const forward = !delivered && isActorAlive(target as Parameters<typeof isActorAlive>[0]);
                watch.dispose();
                if (forward)
                    target.event(release, false);
            });
            return Clutter.EVENT_PROPAGATE;
        });
        watch.add(() => filters.remove_filter(id), 'release filter');
        watch.timeout(RELEASE_FORWARD_MS, () => watch.dispose());
    } catch (e) {
        error('cannot forward the release to a tray icon', e);
        watch.dispose();
    }
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

/** The shell / panel menu that is open now (the one that took over from `except`), or null. */
export function openShellMenu(except: unknown = null): unknown {
    try {
        for (const menu of shellPopupDeps().menus()) {
            if (menu && menu !== except && (menu as {isOpen?: boolean}).isOpen)
                return menu;
        }
    } catch (e) {
        error('cannot read the open shell menu', e);
    }
    return null;
}

/** Show (or clear) the hover look of a panel button under Spawn's grab, which keeps crossing events from it. */
export function setPanelHover(actor: unknown, hover: boolean): void {
    try {
        if (actor instanceof St.Widget && isActorAlive(actor as Parameters<typeof isActorAlive>[0]))
            actor.hover = hover;
    } catch {
        // a button going away: nothing to show
    }
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
