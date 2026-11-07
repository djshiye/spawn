// NewAppsStore: the settings-backed state of the "New" badge (known-apps, new-apps).
//
// Responsibility: keep newApps.ts's state in memory, write it to dconf in ONE batch and only when it
// changed. Writes happen when AppIndex (re)builds its catalogue (start-up, an install or removal; both
// are already debounced there) and when a new app is launched, never on a menu open or per signal.
// Listeners are told after every change, including one made from outside (a reset in Preferences).
// Launches are reported by whoever sees them: Services listens to Shell.AppSystem's single
// 'app-state-changed' signal, and the layout calls markLaunched() for the launch it starts itself (an app
// that is already running does not change state). No Shell import here, so the tests can load this file.
//
// Public API:
//   new NewAppsStore(scope, settings, opts?)   opts.now(): unix seconds (tests)
//   store.sync(installedIds)           reconcile with the installed apps (AppIndex calls it after each build)
//   store.isNew(id)                    first seen less than 3 days ago and not launched since
//   store.showBadge(id)                isNew(id) and the show-new-apps-badge switch is on
//   store.anyNew(ids)                  does one of the ids show a badge (category dots)
//   store.markLaunched(id)             the app was launched: it is no longer new
//   store.onChanged(scope, cb)         cb() after the state changed (own writes and outside edits)

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {anyFresh, clearLaunched, isFresh, sameState, syncNewApps, type NewAppsState} from './newApps.js';

export interface NewAppsStoreOptions {
    /** Unix time in seconds; tests replace the clock. */
    now?(): number;
}

export class NewAppsStore {
    private readonly _settings: SpawnSettings;
    private readonly _now: () => number;
    private readonly _listeners = new Set<() => void>();
    private _state: NewAppsState | null = null;

    constructor(scope: Scope, settings: SpawnSettings, opts: NewAppsStoreOptions = {}) {
        this._settings = settings;
        this._now = opts.now ?? (() => Math.floor(Date.now() / 1000));
        // An edit from outside (dconf, Preferences "reset"): read it again and tell the lists. Our own
        // writes read back equal to the state in memory, so they are not announced a second time.
        settings.onChanged(scope, ['known-apps', 'new-apps'], () => {
            const before = this._state;
            this._state = null;
            if (!before || !sameState(before, this._read()))
                this._notify();
        });
        scope.add(() => this._listeners.clear(), 'NewAppsStore listeners');
    }

    sync(installed: readonly string[]): void {
        const result = syncNewApps(this._read(), installed, this._now());
        if (!result.changed)
            return;
        this._write(result.state);
        // Seeding marks nothing as new, so the lists have nothing to redraw.
        if (!result.seeded)
            this._notify();
    }

    isNew(id: string): boolean {
        return isFresh(this._read().fresh, id, this._now());
    }

    showBadge(id: string): boolean {
        return this._settings.get('show-new-apps-badge') && this.isNew(id);
    }

    anyNew(ids: Iterable<string>): boolean {
        return this._settings.get('show-new-apps-badge') && anyFresh(this._read().fresh, ids, this._now());
    }

    markLaunched(id: string): void {
        const next = clearLaunched(this._read(), id);
        if (!next)
            return;
        this._write(next);
        this._notify();
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'NewAppsStore listener');
    }

    private _read(): NewAppsState {
        this._state ??= {
            known: this._settings.get('known-apps'),
            fresh: {...this._settings.get('new-apps')},
        };
        return this._state;
    }

    private _write(state: NewAppsState): void {
        this._state = state;
        try {
            this._settings.batch(tx => {
                tx.set('known-apps', state.known);
                tx.set('new-apps', state.fresh);
            });
        } catch (e) {
            error('could not save the new apps', e);
        }
    }

    private _notify(): void {
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                error('new apps listener threw', e);
            }
        }
    }
}
