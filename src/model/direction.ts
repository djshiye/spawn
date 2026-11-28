// Logical <-> physical horizontal directions for right-to-left layouts (Clutter mirrors horizontal boxes).
// Pure: no gi imports, unit tested.
//
// Public API:
//   mirrorDir(dir, rtl): dir      'left' <-> 'right' when rtl; any other value unchanged
//   mirrorZone(zone, rtl): Zone   'before' <-> 'after' when rtl; 'onto' unchanged

import type {Zone} from './pinnedDrop.js';

export function mirrorDir<T extends string>(dir: T, rtl: boolean): T {
    if (!rtl)
        return dir;
    return (dir === 'left' ? 'right' : dir === 'right' ? 'left' : dir) as T;
}

export function mirrorZone(zone: Zone, rtl: boolean): Zone {
    if (!rtl)
        return zone;
    return zone === 'before' ? 'after' : zone === 'after' ? 'before' : zone;
}
