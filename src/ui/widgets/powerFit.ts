// powerFit: how many power buttons fit a row of width W (logical px). Pure math, no gi:// imports (unit-tested).
//
// Each button = `surface` px (40 normally) + gaps between buttons + 8 px at both pane edges, so n buttons
// need 48n+8 px at the default 8 px gaps. Three tiers:
//   normal    48n+8 <= W: unchanged (40 px surfaces, 8 px gaps)
//   compact   4 px gaps, surfaces shrink to w = min(40, floor((W-16-4(n-1))/n)) while w >= 32
//   overflow  k = floor((W-12)/36) slots (min 1): k-1 buttons + a "More" button; the rest (OVERFLOW_ORDER,
//             Power Off last) go into the More menu
//
// Public API:
//   fitPowerRow(width, types): PowerFit   `types` already in rank order
//   OVERFLOW_ORDER: readonly number[]     power types in the order they move into "More"

import {PowerType} from '../../core/constants.js';

export type PowerFitMode = 'normal' | 'compact' | 'overflow';

export interface PowerFit {
    mode: PowerFitMode;
    /** width of every button's drawn surface, px */
    surface: number;
    /** gap between neighbouring surfaces, px (8 normal, 4 otherwise) */
    gap: number;
    /** buttons shown, in the given order (not counting "More") */
    visible: number[];
    /** buttons moved into "More", in the given order */
    overflow: number[];
    /** surfaces drawn: visible, plus one for "More" in overflow mode */
    slots: number;
}

/** Hidden first to last: the harmless, rarely used ones first; Power Off is never hidden before the rest. */
export const OVERFLOW_ORDER: readonly number[] = [
    PowerType.HYBRID_SLEEP, PowerType.HIBERNATE, PowerType.SWITCH_USER, PowerType.LOGOUT,
    PowerType.SUSPEND, PowerType.RESTART, PowerType.LOCK, PowerType.POWER_OFF,
];

const MAX_SURFACE = 40;
const MIN_SURFACE = 32;
const EDGE = 8;
const COMPACT_GAP = 4;

export function fitPowerRow(width: number, types: number[]): PowerFit {
    const n = types.length;
    if (n === 0)
        return {mode: 'normal', surface: MAX_SURFACE, gap: 8, visible: [], overflow: [], slots: 0};
    if (48 * n + 8 <= width)
        return {mode: 'normal', surface: MAX_SURFACE, gap: 8, visible: types.slice(), overflow: [], slots: n};

    const w = Math.min(MAX_SURFACE, Math.floor((width - 2 * EDGE - COMPACT_GAP * (n - 1)) / n));
    if (w >= MIN_SURFACE)
        return {mode: 'compact', surface: w, gap: COMPACT_GAP, visible: types.slice(), overflow: [], slots: n};

    const k = Math.max(1, Math.floor((width - 2 * EDGE + COMPACT_GAP) / (MIN_SURFACE + COMPACT_GAP)));
    const hide = new Set<number>();
    for (const t of OVERFLOW_ORDER) {
        if (n - hide.size <= k - 1)
            break;
        if (types.includes(t))
            hide.add(t);
    }
    // types outside OVERFLOW_ORDER (unknown ids): hide from the end of the row
    for (let i = n - 1; i >= 0 && n - hide.size > k - 1; i--)
        hide.add(types[i]);
    const surface = Math.max(1, Math.min(MAX_SURFACE, Math.floor((width - 2 * EDGE - COMPACT_GAP * (k - 1)) / k)));
    return {
        mode: 'overflow', surface, gap: COMPACT_GAP,
        visible: types.filter(t => !hide.has(t)), overflow: types.filter(t => hide.has(t)), slots: k,
    };
}
