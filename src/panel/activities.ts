// ActivitiesHider: hides the shell's Activities button and restores the visibility it had before we
// touched it. No GObject imports (the actors are duck-typed), so it is unit-tested under gjs -m.
//
// While hiding is on, every hidden actor is watched through `notify::visible`: ArcMenu (or anything
// else) that makes the button visible again is overruled, and the visibility it just set becomes
// the one to restore ("previous" state). Without this, disabling ArcMenu (which un-hides Activities)
// would leave a visible button although hide-activities-button is on, and a `false` recorded while
// ArcMenu still hid it would hide the button for good when Spawn is disabled.
//
// Public API:
//   new ActivitiesHider()
//   hider.apply(hide, panels): void    hide (and watch) the Activities button of every panel, or restore
//   hider.restore(): void              put every actor back, stop watching; idempotent
//   hider.size: number                 actors currently remembered (tests / diagnostics)

import {warn} from '../core/log.js';
import {type ActorLike, isActorAlive, type PanelLike} from './validate.js';

export interface ActivitiesActor extends ActorLike {
    visible?: boolean;
    connect?(signal: string, cb: () => void): number;
    disconnect?(id: number): void;
}

interface Saved {
    wasVisible: boolean;
    handler: number;
}

export class ActivitiesHider {
    private readonly _saved = new Map<ActivitiesActor, Saved>();

    get size(): number {
        return this._saved.size;
    }

    apply(hide: boolean, panels: Array<PanelLike | null | undefined>): void {
        if (!hide) {
            this.restore();
            return;
        }
        for (const actor of [...this._saved.keys()]) {
            if (!isActorAlive(actor))
                this._forget(actor);
        }
        for (const panel of panels) {
            try {
                const actor = panel?.statusArea?.['activities'] as ActivitiesActor | undefined;
                if (!actor || !isActorAlive(actor))
                    continue;
                if (!this._saved.has(actor))
                    this._saved.set(actor, {wasVisible: actor.visible !== false, handler: this._watch(actor)});
                if (actor.visible !== false)
                    actor.visible = false;
            } catch (e) {
                warn('cannot hide Activities button', e);
            }
        }
    }

    restore(): void {
        for (const [actor, saved] of [...this._saved]) {
            this._unwatch(actor, saved);
            try {
                if (isActorAlive(actor))
                    actor.visible = saved.wasVisible;
            } catch (e) {
                warn('cannot restore Activities button', e);
            }
        }
        this._saved.clear();
    }

    private _watch(actor: ActivitiesActor): number {
        return actor.connect?.('notify::visible', () => {
            const saved = this._saved.get(actor);
            if (!saved || actor.visible !== true)
                return;
            // Someone made it visible while we hide it (ArcMenu disabled): that is the state to give
            // back later, and the button stays hidden meanwhile.
            saved.wasVisible = true;
            try {
                actor.visible = false;
            } catch (e) {
                warn('cannot re-hide Activities button', e);
            }
        }) ?? 0;
    }

    private _unwatch(actor: ActivitiesActor, saved: Saved): void {
        if (!saved.handler || actor.is_destroyed?.())
            return; // a destroyed actor already dropped its handlers; disconnecting would log a CRITICAL
        try {
            actor.disconnect?.(saved.handler);
        } catch {
            // actor already disposed
        }
    }

    private _forget(actor: ActivitiesActor): void {
        const saved = this._saved.get(actor);
        if (saved)
            this._unwatch(actor, saved);
        this._saved.delete(actor);
    }
}
