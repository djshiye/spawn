// Best match across the result sections. No imports (unit-testable: tests/bestMatch.test.js).
//
// Every provider ranks its own section, and the scores of the providers that rank names (apps, Settings
// panels, app actions, power actions) come from the same tiers of rank.ts (exact 1000 > name prefix 850..900 >
// word prefix > ... , a match on a command / keyword already scaled to 60 %, a description to 38 %,
// usage only adds up to 6 points inside the tier), so their scores can be compared directly. The section
// holding the single strongest result is the "leader": ResultList shows it first and highlights its first row.
//
// Who competes: 'apps', 'settingsPanels', 'appActions' and 'power', and the tools whose trigger is an ordinary word
// ('toggles', 'tools', 'localNetwork', 'characters': their scores sit on the same bands, a bare keyword such as
// "password" at 840, just below an app whose name starts with it). Open windows are left out (a window title
// is page / file / path text, volatile and not comparable with a name), as are recent files (a file is not
// what a name query is after; their score is a position) and the GNOME Shell providers (a rank, not a match
// quality). Those sections keep the provider order behind the leader, and when only they match, nothing moves.
// Answers ('calculator', 'conversion', 'answers') keep the top place: while one is showing there is no leader.
//
// Public API:
//   BEST_MATCH_PROVIDERS: ReadonlySet<string>      the competing provider ids
//   ANSWER_PROVIDERS: ReadonlySet<string>
//   MULTI_ROW_PROVIDERS, ANSWER_ROWS               sections that show up to ANSWER_ROWS rows whatever max-search-results says
//   interface SectionTop {providerId, order, score}   the best (first) result of a section
//   pickLeader(tops: SectionTop[]): string | null  the provider id of the leader, or null (no change of order):
//                                                  highest score; an equal score goes to the lower `order`
//                                                  (the provider registered first, i.e. apps before panels)
//   sectionRank(order, providerId, leader): number the sort key of a section: the leader first (-1), the others
//                                                  by their provider order

export const BEST_MATCH_PROVIDERS: ReadonlySet<string> = new Set(['apps', 'settingsPanels', 'appActions', 'power', 'toggles', 'tools', 'localNetwork', 'characters']);
export const ANSWER_PROVIDERS: ReadonlySet<string> = new Set(['calculator', 'conversion', 'answers']);

/** An answer made of several rows (a subnet has six) is not cut at max-search-results but at ANSWER_ROWS. */
export const MULTI_ROW_PROVIDERS: ReadonlySet<string> = new Set(['answers', 'localNetwork']);
export const ANSWER_ROWS = 8;

export interface SectionTop {
    providerId: string;
    order: number;
    score: number;
}

export function pickLeader(tops: readonly SectionTop[]): string | null {
    if (tops.some(t => ANSWER_PROVIDERS.has(t.providerId)))
        return null;
    let best: SectionTop | null = null;
    for (const t of tops) {
        if (!BEST_MATCH_PROVIDERS.has(t.providerId) || !(t.score > 0))
            continue;
        if (!best || t.score > best.score || (t.score === best.score && t.order < best.order))
            best = t;
    }
    return best ? best.providerId : null;
}

export function sectionRank(order: number, providerId: string, leader: string | null): number {
    return leader !== null && providerId === leader ? -1 : order;
}
