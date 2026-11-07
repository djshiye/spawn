// "New" apps: the pure bookkeeping behind the badge on recently installed apps.
//
// State: `known` (every installed app Spawn has seen) and `fresh` (id -> unix time the app was first
// seen). An app is new for NEW_APP_TTL_S after it was first seen, or until it is first launched,
// whichever comes first. The first sync on a fresh install only seeds `known` (nothing is new on
// first enable). Apps that are no longer installed are pruned from both. No gi:// imports: the
// settings plumbing is in model/newAppsStore.ts, this file is unit-tested under gjs.
//
// Public API:
//   NEW_APP_TTL_S                       3 days
//   NewAppsState                        {known: string[] (sorted), fresh: Record<id, seconds>}
//   syncNewApps(state, installed, now)  -> {state, changed, seeded}; `installed` empty = unknown, state kept
//   isFresh(fresh, id, now)             first seen less than the TTL ago
//   clearLaunched(state, id)            state without `id` in fresh, or null when it was not new
//   anyFresh(fresh, ids, now)           does one of `ids` count as new (category dots)
//   sameState(a, b)                     equal known lists and fresh maps

export const NEW_APP_TTL_S = 3 * 24 * 60 * 60;

export interface NewAppsState {
    known: string[];
    fresh: Record<string, number>;
}

export interface SyncResult {
    state: NewAppsState;
    /** Does the state differ from the input (so it has to be written)? */
    changed: boolean;
    /** The first sync: `known` was empty and has been filled with every installed app. */
    seeded: boolean;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameFresh(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}

export function sameState(a: NewAppsState, b: NewAppsState): boolean {
    return sameList(a.known, b.known) && sameFresh(a.fresh, b.fresh);
}

export function isFresh(fresh: Readonly<Record<string, number>>, id: string, now: number): boolean {
    const seen = fresh[id];
    return typeof seen === 'number' && now - seen < NEW_APP_TTL_S;
}

export function anyFresh(fresh: Readonly<Record<string, number>>, ids: Iterable<string>, now: number): boolean {
    for (const id of ids) {
        if (isFresh(fresh, id, now))
            return true;
    }
    return false;
}

export function syncNewApps(state: NewAppsState, installed: readonly string[], now: number): SyncResult {
    const present = new Set(installed.filter(id => id !== ''));
    // No app list at all (the catalogue failed to load): keep what we know instead of forgetting it.
    if (present.size === 0)
        return {state, changed: false, seeded: false};

    if (state.known.length === 0) {
        const next: NewAppsState = {known: [...present].sort(), fresh: {}};
        return {state: next, changed: true, seeded: true};
    }

    const known = new Set(state.known);
    const fresh: Record<string, number> = {};
    for (const [id, seen] of Object.entries(state.fresh)) {
        if (present.has(id) && typeof seen === 'number' && now - seen < NEW_APP_TTL_S)
            fresh[id] = seen;
    }
    for (const id of present) {
        if (!known.has(id))
            fresh[id] = now;
    }
    const next: NewAppsState = {known: [...present].sort(), fresh};
    const changed = !sameList(next.known, state.known) || !sameFresh(fresh, state.fresh);
    return {state: changed ? next : state, changed, seeded: false};
}

export function clearLaunched(state: NewAppsState, id: string): NewAppsState | null {
    if (!(id in state.fresh))
        return null;
    const fresh = {...state.fresh};
    delete fresh[id];
    return {known: state.known, fresh};
}
