// Matching of typed text against the power actions ("lock", "log out", "restart", "shut down"...).
// Pure (no gi imports), unit-testable: tests/powerKeywords.test.js.
//
// A query matches an action when the typed text (normalised, at least MIN_CHARS characters, so "re" shows nothing
// and "res" shows Restart) is a prefix of the action's name or of one of its synonyms, counted from the start of
// any WORD of it: "out" finds Log Out, "log o" finds Log Out, "down" finds Power Off (shut down). The synonyms are
// English words people type for the action; the displayed name (translated) always counts too.
//
// Scores use the bands of rank.ts so the best match can compare them with apps: the name exact 1000, the name
// prefix 880, a word of the name 780, a synonym exact 900, a synonym prefix 800, a word of a synonym 700. Stable
// for equal scores: the order of `entries`.
//
// Public API:
//   MIN_CHARS = 3
//   interface PowerEntry {type: number, name: string, synonyms: readonly string[]}
//   POWER_SYNONYMS: Record<string, string[]>       English synonyms by the power type's key (see ui/widgets/powerActions.ts)
//   scorePower(query, name, synonyms): number       0 = no match
//   matchPower<T extends {name: string; synonyms: readonly string[]}>(query, entries): {item: T, score: number}[]
//                                                   best first, only matches

import {normalize} from './rank.js';

export const MIN_CHARS = 3;

/** English synonyms by action key; the English name itself is added by the provider. */
export const POWER_SYNONYMS: Record<string, readonly string[]> = {
    lock: ['lock screen', 'lock session', 'screen lock'],
    logout: ['log out', 'logout', 'sign out', 'signout', 'log off', 'logoff'],
    restart: ['reboot', 'restart computer'],
    poweroff: ['power off', 'shut down', 'shutdown', 'turn off', 'switch off'],
    suspend: ['sleep', 'standby', 'suspend to ram'],
    hybridSleep: ['hybrid sleep', 'hybrid suspend'],
    hibernate: ['hibernate', 'suspend to disk'],
    switchUser: ['switch user', 'switch account', 'change user', 'change account'],
    firmware: ['firmware', 'uefi', 'bios', 'firmware setup', 'restart to firmware setup', 'boot settings'],
};

/** Does `typed` start at a word of `phrase`? Returns 2 for the phrase start, 1 for a later word, 0 for none. */
function prefixAt(typed: string, phrase: string): 0 | 1 | 2 {
    if (phrase.startsWith(typed))
        return 2;
    for (let i = 1; i < phrase.length; i++) {
        if (phrase[i - 1] === ' ' && phrase.startsWith(typed, i))
            return 1;
    }
    return 0;
}

export function scorePower(query: string, name: string, synonyms: readonly string[]): number {
    const typed = normalize(query);
    if (typed.replace(/ /g, '').length < MIN_CHARS)
        return 0;
    const n = normalize(name);
    const nameAt = n === typed ? 3 : prefixAt(typed, n);
    let best = nameAt === 3 ? 1000 : nameAt === 2 ? 880 : nameAt === 1 ? 780 : 0;
    for (const raw of synonyms) {
        const s = normalize(raw);
        if (!s)
            continue;
        const at = s === typed ? 3 : prefixAt(typed, s);
        const score = at === 3 ? 900 : at === 2 ? 800 : at === 1 ? 700 : 0;
        if (score > best)
            best = score;
    }
    return best;
}

export function matchPower<T extends {name: string; synonyms: readonly string[]}>(query: string, entries: readonly T[]): {item: T; score: number}[] {
    const out: {item: T; score: number}[] = [];
    for (const item of entries) {
        const score = scorePower(query, item.name, item.synonyms);
        if (score > 0)
            out.push({item, score});
    }
    // Array.prototype.sort is stable: equal scores keep the order of `entries`
    return out.sort((a, b) => b.score - a.score);
}
