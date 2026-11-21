// Matching of typed text against the quick settings switches ("dark mode", "wifi off", "turn on bluetooth").
// Pure (imports only rank.ts's normalize; unit-testable: tests/toggleQuery.test.js).
//
// Text forms: the name or a synonym of a switch, optionally with the state wanted:
//   "<name>"                         toggle (the row says which way)
//   "<name> on|off", "turn on|off <name>", "turn <name> on|off", "switch ...", "enable|disable <name>"
//   "toggle <name>"
// The name part matches like the power actions do (search/powerKeywords.ts): at least MIN_CHARS typed characters,
// a prefix of the name or of a synonym, or (from 4 typed characters) of a later word of it, on the same score bands
// so the best match can compare them with apps: name exact 1000, name prefix 880, a later word of the name 780,
// synonym exact 900, synonym prefix 800, a later word of a synonym 700. A query that also says the state is an
// unmistakable command: exact name / synonym + state scores 1000, a prefix + state 900.
//
// Public API:
//   MIN_CHARS = 3
//   interface ToggleName {name: string; synonyms: readonly string[]}
//   parseToggleQuery(query): {core: string; want: boolean | null} | null     null: cannot be a switch (fast)
//   matchToggles<T extends ToggleName>(query, entries): {item: T; score: number; want: boolean | null}[]   best first

import {normalize} from '../rank.js';

export const MIN_CHARS = 3;
/** Typed characters needed to match a word that is not the first of a name. */
const MIN_WORD_CHARS = 4;
const MAX_QUERY = 40;

export interface ToggleName {
    name: string;
    synonyms: readonly string[];
}

const STATE_FIRST = /^(?:(?:turn|switch) (on|off)|(enable|disable)) (.+)$/;
const STATE_LAST = /^(?:(?:turn|switch) )?(.+?) (on|off)$/;
const TOGGLE = /^toggle (.+)$/;

export function parseToggleQuery(query: string): {core: string; want: boolean | null} | null {
    if (query.length > MAX_QUERY || query.length < MIN_CHARS)
        return null;
    const text = normalize(query);
    if (text.length < MIN_CHARS)
        return null;
    let m = STATE_FIRST.exec(text);
    if (m)
        return {core: m[3], want: m[1] ? m[1] === 'on' : m[2] === 'enable'};
    m = STATE_LAST.exec(text);
    if (m)
        return {core: m[1], want: m[2] === 'on'};
    m = TOGGLE.exec(text);
    if (m)
        return {core: m[1], want: null};
    return {core: text, want: null};
}

/** 3 = equal, 2 = `phrase` starts with `typed`, 1 = a later word of it does, 0 = no match. */
function matchAt(typed: string, phrase: string): 0 | 1 | 2 | 3 {
    if (phrase === typed)
        return 3;
    if (phrase.startsWith(typed))
        return 2;
    // A later word needs more typed text than the start does, and "mode" alone says nothing: "not" (on the way to
    // "notes") must not offer Do Not Disturb.
    if (typed.length < MIN_WORD_CHARS || typed === 'mode')
        return 0;
    for (let i = phrase.indexOf(' '); i >= 0; i = phrase.indexOf(' ', i + 1)) {
        if (phrase.startsWith(typed, i + 1))
            return 1;
    }
    return 0;
}

const normalised = new WeakMap<ToggleName, {name: string; synonyms: string[]}>();

function folded(entry: ToggleName): {name: string; synonyms: string[]} {
    let n = normalised.get(entry);
    if (!n) {
        n = {name: normalize(entry.name), synonyms: entry.synonyms.map(normalize).filter(Boolean)};
        normalised.set(entry, n);
    }
    return n;
}

export function matchToggles<T extends ToggleName>(query: string, entries: readonly T[]): {item: T; score: number; want: boolean | null}[] {
    const parsed = parseToggleQuery(query);
    if (!parsed || parsed.core.replace(/ /g, '').length < MIN_CHARS)
        return [];
    const {core, want} = parsed;
    const out: {item: T; score: number; want: boolean | null}[] = [];
    for (const item of entries) {
        const f = folded(item);
        const at = matchAt(core, f.name);
        let score = at === 3 ? 1000 : at === 2 ? 880 : at === 1 ? 780 : 0;
        let exact = at === 3;
        for (const s of f.synonyms) {
            const sa = matchAt(core, s);
            const sc = sa === 3 ? 900 : sa === 2 ? 800 : sa === 1 ? 700 : 0;
            if (sc > score)
                score = sc;
            exact ||= sa === 3;
        }
        if (score === 0)
            continue;
        if (want !== null)
            score = exact ? 1000 : 900;
        out.push({item, score, want});
    }
    return out.sort((a, b) => b.score - a.score);
}
