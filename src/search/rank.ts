// Pure ranking functions for app/window/file search. STUB: signatures are final.
// No imports, so it is unit-testable with gjs -m (tests/rank.test.js).
//
// Tiers (higher score wins): exact name > name prefix > word prefix > substring > fuzzy
// (ordered subsequence). Score 0 means "no match".
//
// Public API:
//   normalize(s): string                  lower-case + fold diacritics + collapse whitespace
//   scoreMatch(query, candidate): number  0..1000, 0 = no match; both args pre-normalised
//   rankItems<T>(query, items, keysOf, limit?): Ranked<T>[]  stable, best first;
//                                          `keysOf(item)` returns pre-normalised strings, the
//                                          best score over the keys is used

export interface Ranked<T> {
    item: T;
    score: number;
}

export function normalize(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function scoreMatch(_query: string, _candidate: string): number {
    // TODO(search owner)
    return 0;
}

export function rankItems<T>(_query: string, _items: readonly T[], _keysOf: (item: T) => readonly string[], _limit?: number): Ranked<T>[] {
    // TODO(search owner)
    return [];
}
