// ButtonAttacher: keeps exactly one MenuButton on every valid panel target.
//
// This is the anti-ArcMenu-bug code. Rules it implements:
//   * Never trusts a cached panel: every reconcile() asks PanelTargets for a FRESH
//     resolution, compares panel identity with what each attachment was built for, and
//     rebuilds attachments whose panel object changed or whose button is no longer healthy.
//   * attach() runs synchronously in start(); later changes arrive through the debounced
//     'changed' of PanelTargets, plus a backoff retry timer (100 ms doubling to 2 s) while
//     a panel extension is active but has no valid panel yet. After GIVE_UP_MS (10 s) it falls
//     back to Main.panel.
//   * Every removal is guarded (`?.`, try/catch); one failing removal never blocks the rest.
//   * Hiding the Activities button remembers the PREVIOUS visibility and restores exactly that.
//
// Public API:
//   new ButtonAttacher(scope, deps: AttacherDeps)
//   attacher.start(): void              attach now, subscribe to changes; idempotent
//   attacher.reconcile(): void          re-evaluate targets (safe to call any time)
//   attacher.buttons(): MenuButton[]    live buttons (first one is used as popup default anchor)
//   attacher.status(): AttachmentStatus Dev/diagnostics snapshot
//   AttacherDeps: {settings, targets, createButton: () => MenuButton}

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {STATUS_AREA_ROLE} from '../core/constants.js';
import {debounce} from '../core/debounce.js';
import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SettingKey, SpawnSettings} from '../core/settings.js';
import type {MenuButton} from '../ui/button.js';
import type {PanelTargets} from './targets.js';
import {
    type ActorLike,
    GIVE_UP_MS,
    isActorAlive,
    type PanelLike,
    type PanelTarget,
    nextBackoffMs,
    panelSlot,
    targetKey,
    validatePanel,
} from './validate.js';

export interface AttacherDeps {
    settings: SpawnSettings;
    targets: PanelTargets;
    createButton: () => MenuButton;
}

export interface AttachmentInfo {
    key: string;
    kind: string;
    monitorIndex: number;
    attached: boolean;
    fallback: boolean;
}

export interface AttachmentStatus {
    attachments: AttachmentInfo[];
    pending: boolean;
    pendingForMs: number;
}

interface Attachment {
    target: PanelTarget;
    button: MenuButton;
    scope: Scope;
    fallback: boolean;
    removing: boolean;
}

const REPOSITION_KEYS: SettingKey[] = ['position-in-panel', 'menu-button-position-offset', 'multi-monitor'];
const REFRESH_KEYS: SettingKey[] = [
    'menu-button-appearance', 'menu-button-text', 'menu-button-icon', 'menu-button-icon-size', 'menu-button-padding',
];

interface ActivitiesActor extends ActorLike {
    visible?: boolean;
}

/** Hides the Activities button and restores the visibility it had before we touched it. */
class ActivitiesHider {
    private readonly _saved = new Map<ActivitiesActor, boolean>();

    apply(hide: boolean, panels: Array<PanelLike | null | undefined>): void {
        if (!hide) {
            this.restore();
            return;
        }
        for (const panel of panels) {
            try {
                const actor = panel?.statusArea?.['activities'] as ActivitiesActor | undefined;
                if (!actor || !isActorAlive(actor))
                    continue;
                if (!this._saved.has(actor))
                    this._saved.set(actor, actor.visible !== false);
                if (actor.visible !== false)
                    actor.visible = false;
            } catch (e) {
                warn('cannot hide Activities button', e);
            }
        }
    }

    restore(): void {
        for (const [actor, wasVisible] of this._saved) {
            try {
                if (isActorAlive(actor))
                    actor.visible = wasVisible;
            } catch (e) {
                warn('cannot restore Activities button', e);
            }
        }
        this._saved.clear();
    }
}

export class ButtonAttacher {
    private readonly _scope: Scope;
    private readonly _deps: AttacherDeps;
    private readonly _attachments = new Map<string, Attachment>();
    private readonly _activities = new ActivitiesHider();
    private _started = false;
    private _disposed = false;
    private _pendingSince: number | null = null;
    private _attempt = 0;
    private _cancelRetry: (() => void) | null = null;
    private _reconciling = false;
    private _again = false;

    constructor(scope: Scope, deps: AttacherDeps) {
        this._scope = scope;
        this._deps = deps;
        scope.add(() => this._dispose(), 'ButtonAttacher');
    }

    start(): void {
        if (this._started || this._disposed)
            return;
        this._started = true;

        const {settings, targets} = this._deps;

        targets.onChanged(this._scope, () => this.reconcile());

        const rebuild = debounce(this._scope, 100, () => {
            this._removeAll();
            this.reconcile();
        });
        settings.onChanged(this._scope, REPOSITION_KEYS, () => rebuild.call());
        settings.onChanged(this._scope, REFRESH_KEYS, () => {
            for (const a of this._attachments.values())
                this._guard('refresh button', () => a.button.refresh());
        });
        settings.onChanged(this._scope, ['hide-activities-button'], () => this._applyActivities());

        targets.start();
        this.reconcile();
    }

    buttons(): MenuButton[] {
        return [...this._attachments.values()].filter(a => this._isHealthy(a)).map(a => a.button);
    }

    status(): AttachmentStatus {
        return {
            attachments: [...this._attachments.values()].map(a => ({
                key: a.target.key,
                kind: a.target.kind,
                monitorIndex: a.target.monitorIndex,
                attached: this._isHealthy(a),
                fallback: a.fallback,
            })),
            pending: this._pendingSince !== null,
            pendingForMs: this._pendingSince === null ? 0 : this._now() - this._pendingSince,
        };
    }

    reconcile(): void {
        if (this._disposed)
            return;
        // Re-entrancy guard: a destroy signal fired while reconciling asks for another pass.
        if (this._reconciling) {
            this._again = true;
            return;
        }
        this._reconciling = true;
        try {
            do {
                this._again = false;
                this._reconcileOnce();
            } while (this._again && !this._disposed);
        } catch (e) {
            error('reconcile failed', e);
            this._markProblem();
        } finally {
            this._reconciling = false;
        }
    }

    // ---- internals ----

    private _now(): number {
        return Math.floor(GLib.get_monotonic_time() / 1000);
    }

    private _reconcileOnce(): void {
        const resolution = this._deps.targets.resolve();
        let desired = resolution.targets;
        let fallback = false;

        if (desired.length === 0) {
            // Nothing valid right now. Keep healthy attachments, retry with backoff, and
            // after GIVE_UP_MS fall back to Main.panel.
            this._markProblem();
            const waited = this._now() - (this._pendingSince ?? this._now());
            if (waited >= GIVE_UP_MS) {
                const main = Main.panel as unknown as PanelLike;
                if (validatePanel(main).ok) {
                    warn(`no valid panel target for ${waited} ms (${resolution.reason}); falling back to the main panel`);
                    desired = [{key: targetKey('main', 0), kind: 'main', panel: main, monitorIndex: Main.layoutManager.primaryIndex, isPrimary: true}];
                    fallback = true;
                }
            }
        }

        if (desired.length > 0) {
            // Fallback attachments keep retrying the real targets in the background.
            if (!fallback)
                this._clearProblem();
        }

        // 1. Remove attachments that are unhealthy, stale (panel object replaced), or no
        //    longer wanted. When nothing is desired yet we keep what still works.
        if (desired.length > 0) {
            for (const a of [...this._attachments.values()]) {
                const want = desired.find(t => t.key === a.target.key);
                if (!want || want.panel !== a.target.panel || !this._isHealthy(a))
                    this._remove(a);
            }
        } else {
            for (const a of [...this._attachments.values()]) {
                if (!this._isHealthy(a))
                    this._remove(a);
            }
        }

        // 2. Attach what is missing.
        for (const target of desired) {
            if (this._attachments.has(target.key))
                continue;
            try {
                this._attach(target, fallback);
            } catch (e) {
                error(`attach to ${target.key} failed`, e);
                this._markProblem();
            }
        }

        // 3. Activities button (all current panels plus the shell's own).
        this._applyActivities(desired.map(t => t.panel));

        if (this._pendingSince !== null)
            this._scheduleRetry();
    }

    private _attach(target: PanelTarget, fallback: boolean): void {
        const panel = target.panel;
        const stale = panel.statusArea?.[STATUS_AREA_ROLE] as {destroy?: () => void} | undefined;
        if (stale) {
            // A previous instance of ours that outlived its owner (or a failed removal).
            this._guard('destroy stale button', () => stale.destroy?.());
            this._guard('clear stale statusArea entry', () => {
                if (panel.statusArea?.[STATUS_AREA_ROLE] === stale)
                    delete panel.statusArea[STATUS_AREA_ROLE];
            });
        }

        const {settings} = this._deps;
        const counts = {
            left: panel._leftBox?.get_n_children?.() ?? 0,
            center: panel._centerBox?.get_n_children?.() ?? 0,
            right: panel._rightBox?.get_n_children?.() ?? 0,
        };
        const slot = panelSlot(settings.get('position-in-panel'), settings.get('menu-button-position-offset'), counts);

        const button = this._deps.createButton();
        const scope = this._scope.child(`attachment ${target.key}`);
        const attachment: Attachment = {target, button, scope, fallback, removing: false};
        try {
            panel.addToStatusArea?.(STATUS_AREA_ROLE, button, slot.index, slot.box);
        } catch (e) {
            this._guard('destroy button after failed add', () => button.destroy());
            scope.dispose();
            throw e;
        }

        // If the panel (or its extension) destroys the button behind our back, re-evaluate.
        scope.connect(button, 'destroy', () => {
            if (attachment.removing)
                return;
            attachment.removing = true;
            if (this._attachments.get(target.key) === attachment)
                this._attachments.delete(target.key);
            attachment.scope.dispose();
            if (!this._disposed)
                this._deps.targets.notifyChanged();
        });

        this._attachments.set(target.key, attachment);
        log(`attached to ${target.key}${fallback ? ' (fallback)' : ''}`);
    }

    private _remove(a: Attachment): void {
        a.removing = true;
        if (this._attachments.get(a.target.key) === a)
            this._attachments.delete(a.target.key);
        a.scope.dispose();
        this._guard(`destroy button ${a.target.key}`, () => {
            if (isActorAlive(a.button as unknown as ActorLike))
                a.button.destroy();
        });
        this._guard(`clear statusArea ${a.target.key}`, () => {
            const area = a.target.panel?.statusArea;
            if (area && area[STATUS_AREA_ROLE] === a.button)
                delete area[STATUS_AREA_ROLE];
        });
    }

    private _removeAll(): void {
        for (const a of [...this._attachments.values()])
            this._remove(a);
    }

    private _isHealthy(a: Attachment): boolean {
        try {
            if (a.removing)
                return false;
            const actor = a.button as unknown as ActorLike & {get_parent?: () => unknown};
            if (!isActorAlive(actor))
                return false;
            if (!validatePanel(a.target.panel).ok)
                return false;
            return a.target.panel.statusArea?.[STATUS_AREA_ROLE] === a.button;
        } catch {
            return false;
        }
    }

    private _applyActivities(extraPanels: PanelLike[] = []): void {
        this._guard('activities button', () => {
            const hide = this._deps.settings.get('hide-activities-button');
            const panels: PanelLike[] = [Main.panel as unknown as PanelLike];
            for (const a of this._attachments.values())
                panels.push(a.target.panel);
            panels.push(...extraPanels);
            this._activities.apply(hide, panels);
        });
    }

    private _markProblem(): void {
        if (this._pendingSince === null) {
            this._pendingSince = this._now();
            this._attempt = 0;
        }
    }

    private _clearProblem(): void {
        this._pendingSince = null;
        this._attempt = 0;
        this._cancelRetry?.();
        this._cancelRetry = null;
    }

    private _scheduleRetry(): void {
        if (this._cancelRetry || this._disposed)
            return;
        const delay = nextBackoffMs(this._attempt++);
        this._cancelRetry = this._scope.timeout(delay, () => {
            this._cancelRetry = null;
            this.reconcile();
        });
    }

    private _guard(what: string, fn: () => void): void {
        try {
            fn();
        } catch (e) {
            warn(`${what} failed`, e);
        }
    }

    private _dispose(): void {
        if (this._disposed)
            return;
        this._disposed = true;
        this._cancelRetry = null;
        this._removeAll();
        this._guard('restore Activities button', () => this._activities.restore());
    }
}
