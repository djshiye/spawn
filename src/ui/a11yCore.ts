// Pure parts of the accessibility helpers (no gi imports, so the unit tests can load them).
//
// Public API:
//   CountAnnouncer       debounces "N results" announcements so typing does not spam a screen reader
//   itemName(name, description?)   "Name, description": the accessible name of a row or tile that shows both
//   REDUCED_MOTION_CLASS           style class that zeroes the stylesheet's transitions (see stylesheet.css)

/** Added to the menu / runner root while GNOME's "Reduce animation" is on. */
export const REDUCED_MOTION_CLASS = 'spawn-reduce-motion';

/** How long the result count must stay unchanged before it is announced (ms). */
export const ANNOUNCE_DELAY_MS = 600;

export type Schedule = (ms: number, cb: () => void) => () => void;

/** "Name, description" (or just the name); blank parts are dropped. */
export function itemName(name: string, description?: string | null): string {
    const n = name.trim();
    const d = description?.trim() ?? '';
    return n && d ? `${n}, ${d}` : n || d;
}

/**
 * Announces how many results a search has, once it has settled.
 *
 *   note(count)   the result count is `count` now (called after every batch of results): the announcement
 *                 fires `delay` ms after the LAST call, and only when the count differs from the one last
 *                 said, so a longer query with the same number of results stays quiet
 *   hold()        a new query started: drop what is pending (nothing is said for a count that is stale)
 *   reset()       the search ended (entry cleared): drop what is pending and forget what was said, so the
 *                 next search announces again
 */
export class CountAnnouncer {
    private readonly _schedule: Schedule;
    private readonly _say: (count: number) => void;
    private readonly _delay: number;
    private _cancel: (() => void) | null = null;
    private _said: number | null = null;

    constructor(schedule: Schedule, say: (count: number) => void, delay = ANNOUNCE_DELAY_MS) {
        this._schedule = schedule;
        this._say = say;
        this._delay = delay;
    }

    note(count: number, delay = this._delay): void {
        this.hold();
        if (count === this._said)
            return;
        this._cancel = this._schedule(delay, () => {
            this._cancel = null;
            this._said = count;
            this._say(count);
        });
    }

    hold(): void {
        this._cancel?.();
        this._cancel = null;
    }

    reset(): void {
        this.hold();
        this._said = null;
    }
}
