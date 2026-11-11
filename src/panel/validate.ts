// Pure panel-target logic: validation of a panel object and resolution of the current
// target list from a snapshot of the world. No imports, so it runs under gjs -m tests.
//
// Public API:
//   ExtState                         numeric copies of ExtensionState values
//   isActorAlive(actor)              duck-typed "not destroyed and in a stage"
//   validatePanel(panel)             {ok: true} | {ok: false, reason}
//   targetKey(kind, monitorIndex)    stable identity string for a target, e.g. "dtp:0"
//   resolveTargets(snapshot)         -> Resolution {targets, pending, reason}
//   panelSide(panelRect, monitorRect) -> 'top' | 'bottom' | 'left' | 'right'
//   samePanel(a, b)                  identity of the underlying panel object (re-keying)
//
// The snapshot is built FRESH by PanelTargets on every call; nothing here caches.

export const ExtState = {
    ACTIVE: 1,
    INACTIVE: 2,
    ERROR: 3,
    OUT_OF_DATE: 4,
    DOWNLOADING: 5,
    INITIALIZED: 6,
    DEACTIVATING: 7,
    ACTIVATING: 8,
} as const;

export type PanelKind = 'main' | 'dtp' | 'aztaskbar';

export interface ActorLike {
    is_destroyed?: () => boolean;
    get_stage?: () => unknown;
    get_n_children?: () => number;
}

export interface PanelLike {
    statusArea?: Record<string, unknown> | null;
    _leftBox?: ActorLike | null;
    _centerBox?: ActorLike | null;
    _rightBox?: ActorLike | null;
    addToStatusArea?: (...args: any[]) => unknown;
}

/** Dash to Panel / App Icons Taskbar per-monitor wrapper. `.panel` is the St panel. */
export interface PanelWrapperLike {
    panel?: PanelLike | null;
    /** The panel's box in the layout (what intellihide translates / hides). */
    panelBox?: unknown;
    /** Dash to Panel's intellihide controller (see panel/intellihide.ts). */
    intellihide?: unknown;
    monitor?: {index?: number; inFullscreen?: boolean} | null;
    isPrimary?: boolean;
    isStandalone?: boolean;
}

/** The object published as global.dashToPanel / global.azTaskbar. */
export interface PanelEmitterLike {
    panels?: PanelWrapperLike[] | null;
}

export interface ExtensionSnapshot {
    kind: 'dtp' | 'aztaskbar';
    /** ExtensionState of the providing extension; undefined = not installed / unknown. */
    state: number | undefined;
    /** Current value of the global emitter (re-read from `global`, never cached). */
    emitter: PanelEmitterLike | null | undefined;
}

export interface TargetSnapshot {
    main: PanelLike | null | undefined;
    extensions: ExtensionSnapshot[];
    multiMonitor: boolean;
    primaryMonitorIndex: number;
}

export interface PanelTarget {
    key: string;
    kind: PanelKind;
    panel: PanelLike;
    monitorIndex: number;
    isPrimary: boolean;
}

export interface Resolution {
    targets: PanelTarget[];
    /** A panel extension is (becoming) active but has no valid panels yet: retry later. */
    pending: boolean;
    reason: string;
}

export type Validation = {ok: true} | {ok: false; reason: string};

export function isActorAlive(actor: ActorLike | null | undefined): boolean {
    if (!actor)
        return false;
    try {
        if (typeof actor.is_destroyed === 'function' && actor.is_destroyed())
            return false;
        if (typeof actor.get_stage === 'function' && !actor.get_stage())
            return false;
        return true;
    } catch {
        return false;
    }
}

export function validatePanel(panel: PanelLike | null | undefined): Validation {
    try {
        if (!panel || typeof panel !== 'object')
            return {ok: false, reason: 'no panel'};
        if (!panel.statusArea || typeof panel.statusArea !== 'object')
            return {ok: false, reason: 'no statusArea'};
        if (typeof panel.addToStatusArea !== 'function')
            return {ok: false, reason: 'no addToStatusArea'};
        for (const box of ['_leftBox', '_centerBox', '_rightBox'] as const) {
            if (!isActorAlive(panel[box]))
                return {ok: false, reason: `${box} missing or destroyed`};
        }
        return {ok: true};
    } catch (e) {
        return {ok: false, reason: `threw: ${e instanceof Error ? e.message : String(e)}`};
    }
}

export function targetKey(kind: PanelKind, monitorIndex: number): string {
    return kind === 'main' ? 'main' : `${kind}:${monitorIndex}`;
}

function isExpected(state: number | undefined): boolean {
    return state === ExtState.ACTIVE || state === ExtState.ACTIVATING || state === ExtState.DEACTIVATING;
}

function wrapperTargets(ext: ExtensionSnapshot): PanelTarget[] {
    const out: PanelTarget[] = [];
    let wrappers: PanelWrapperLike[];
    try {
        const panels = ext.emitter?.panels;
        wrappers = Array.isArray(panels) ? panels : [];
    } catch {
        wrappers = [];
    }
    wrappers.forEach((w, i) => {
        try {
            if (!w || !validatePanel(w.panel).ok)
                return;
            const monitorIndex = typeof w.monitor?.index === 'number' ? w.monitor.index : i;
            out.push({
                key: targetKey(ext.kind, monitorIndex),
                kind: ext.kind,
                panel: w.panel as PanelLike,
                monitorIndex,
                isPrimary: Boolean(w.isPrimary),
            });
        } catch {
            // A wrapper that throws on access is stale: skip it.
        }
    });
    return out;
}

function selectPrimary(targets: PanelTarget[], primaryMonitorIndex: number): PanelTarget[] {
    const pick = targets.find(t => t.isPrimary && t.monitorIndex === primaryMonitorIndex) ??
        targets.find(t => t.monitorIndex === primaryMonitorIndex) ??
        targets.find(t => t.isPrimary) ??
        targets[0];
    return pick ? [pick] : [];
}

export function resolveTargets(snapshot: TargetSnapshot): Resolution {
    let pendingReason = '';

    for (const ext of snapshot.extensions) {
        // A stale emitter of an extension that is not running must never be trusted.
        if (ext.state !== undefined && !isExpected(ext.state))
            continue;
        const targets = wrapperTargets(ext);
        if (targets.length > 0) {
            return {
                targets: snapshot.multiMonitor ? targets : selectPrimary(targets, snapshot.primaryMonitorIndex),
                pending: false,
                reason: `${ext.kind} panels`,
            };
        }
        if (isExpected(ext.state) && !pendingReason)
            pendingReason = `${ext.kind} is active but has no valid panels yet`;
    }

    if (pendingReason)
        return {targets: [], pending: true, reason: pendingReason};

    const v = validatePanel(snapshot.main);
    if (v.ok) {
        return {
            targets: [{key: targetKey('main', 0), kind: 'main', panel: snapshot.main as PanelLike, monitorIndex: snapshot.primaryMonitorIndex, isPrimary: true}],
            pending: false,
            reason: 'main panel',
        };
    }
    return {targets: [], pending: true, reason: `main panel invalid: ${v.reason}`};
}

// ---- Retry policy and slot computation (pure, shared with ButtonAttacher) ----

export const BACKOFF_START_MS = 100;
export const BACKOFF_MAX_MS = 2000;
/** After this long without any valid target the attacher falls back to Main.panel. */
export const GIVE_UP_MS = 10000;

/** attempt 0 -> 100, 1 -> 200, 2 -> 400, 3 -> 800, 4 -> 1600, 5+ -> 2000. */
export function nextBackoffMs(attempt: number): number {
    const n = Math.max(0, Math.floor(attempt));
    return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.min(n, 16));
}

export type PanelBox = 'left' | 'center' | 'right';
export type PositionSetting = 'Left' | 'Center' | 'Right';

/**
 * Where to insert the button. `offset` counts items skipped from the chosen edge: for Left
 * and Center from the start of the box, for Right from the end (offset 0 = rightmost).
 */
export function panelSlot(position: PositionSetting, offset: number, childCounts: {left: number; center: number; right: number}): {box: PanelBox; index: number} {
    const off = Math.max(0, Math.floor(offset) || 0);
    switch (position) {
    case 'Center':
        return {box: 'center', index: Math.min(off, childCounts.center)};
    case 'Right':
        return {box: 'right', index: Math.max(0, childCounts.right - off)};
    default:
        return {box: 'left', index: Math.min(off, childCounts.left)};
    }
}

// ---- Which screen edge is a panel on? (pure) ----

export type PanelSide = 'top' | 'bottom' | 'left' | 'right';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Edge of the monitor that `panel` hugs. A wider-than-tall panel is horizontal (top when its
 * centre is in the upper half of the monitor), otherwise vertical (left when in the left half).
 */
export function panelSide(panel: Rect, monitor: Rect): PanelSide {
    const cx = panel.x + panel.width / 2;
    const cy = panel.y + panel.height / 2;
    if (panel.width >= panel.height)
        return cy < monitor.y + monitor.height / 2 ? 'top' : 'bottom';
    return cx < monitor.x + monitor.width / 2 ? 'left' : 'right';
}

/** True when both targets wrap the very same underlying panel object. */
export function samePanel(a: {panel: unknown} | null | undefined, b: {panel: unknown} | null | undefined): boolean {
    return Boolean(a && b && a.panel && a.panel === b.panel);
}
