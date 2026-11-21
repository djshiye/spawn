// Emoji and special characters by name for the search box, offline. The data file (data/characters.tsv, made by
// tools/gen-characters.py) is read by the provider only when someone asks; this module is pure and unit-testable
// with gjs -m (tests/characters.test.js). Imports only the Answer type.
//
// Text forms (an explicit keyword, so ordinary app searches are never affected):
//   emoji <words>                                  e.g. "emoji party popper"
//   char|chars|character|characters|symbol|symbols|sym|unicode <words>    e.g. "char arrow right"
//   U+2192 | u+1f600 | unicode 2192                a code point (also answered when it is not in the data)
// Every word must be the start of a word of the name or the keywords (case and diacritics ignored). Ranking:
// exact name, name starts with the query, all words in the name, then keyword-only matches; ties keep data order.
//
// Public API:
//   parseCharQuery(query): CharQuery | null
//   parseCharacters(tsv): CharEntry[]            tsv lines: glyph TAB kind (e|c) TAB name TAB keywords
//   searchCharacters(db, q, limit): Answer[]

import type {Answer} from './types.js';

export interface CharEntry {
    glyph: string;
    kind: 'e' | 'c';
    name: string;
    keywords: string;
}

export interface CharQuery {
    kind: 'e' | 'c' | 'any';
    terms: string[];
    codePoint?: number;
}

interface Indexed extends CharEntry {
    /** Folded name with a leading space: " grinning face". */
    nameFolded?: string;
    /** Folded name and keywords, each word preceded by a space. */
    haystack?: string;
}

const MAX_QUERY = 80;
const ICON = 'preferences-desktop-font-symbolic';
const CODE_POINT = /^(?:u\+|unicode\s+u?\+?)([0-9a-f]{1,6})$/i;
const PREFIX = /^(emoji|emojis|chars?|characters?|symbols?|sym|unicode)\s+(.+)$/i;

function fold(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseCharQuery(query: string): CharQuery | null {
    const n = query.length;
    if (n < 3 || n > MAX_QUERY)
        return null;
    const c = query.charCodeAt(0) | 32;
    // e(moji) c(har) s(ymbol) u(+ / unicode)
    if (c !== 0x65 && c !== 0x63 && c !== 0x73 && c !== 0x75)
        return null;
    const q = query.trim();
    let m = CODE_POINT.exec(q);
    if (m) {
        const hex = m[1];
        const isForm = (q.charCodeAt(0) | 32) === 0x75 && (q.charCodeAt(1) === 0x2b || /\d/.test(hex));
        const cp = parseInt(hex, 16);
        if (isForm && cp <= 0x10ffff)
            return {kind: 'any', terms: [], codePoint: cp};
        if (q.charCodeAt(1) === 0x2b)
            return null;
    }
    m = PREFIX.exec(q);
    if (!m)
        return null;
    const word = m[1].toLowerCase();
    const terms = fold(m[2]).split(' ').filter(t => t !== '');
    if (!terms.some(t => t.length >= 2))
        return null;
    if (word !== 'emoji' && word !== 'emojis' && terms.length === 1 && terms[0] === 'map' && word.startsWith('char'))
        return null;
    const kind = word.startsWith('emoji') ? 'e' : 'c';
    return {kind, terms};
}

export function parseCharacters(tsv: string): CharEntry[] {
    const out: CharEntry[] = [];
    for (const line of tsv.split('\n')) {
        if (line === '' || line.charCodeAt(0) === 0x23)
            continue;
        const f = line.split('\t');
        if (f.length < 3 || f[0] === '' || (f[1] !== 'e' && f[1] !== 'c'))
            continue;
        out.push({glyph: f[0], kind: f[1], name: f[2], keywords: f[3] ?? ''});
    }
    return out;
}

function codePointsOf(glyph: string): number[] {
    const out: number[] = [];
    for (const ch of glyph)
        out.push(ch.codePointAt(0) as number);
    return out;
}

function hex(cp: number): string {
    return cp.toString(16).toUpperCase().padStart(4, '0');
}

function describeCodes(cps: number[]): string {
    const shown = cps.slice(0, 4).map(cp => `U+${hex(cp)}`).join(' ');
    return cps.length > 4 ? `${shown} …` : shown;
}

function capital(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Below an app whose name starts with the typed text (850+): "emoji picker" must still launch Emoji Picker.
const SCORE_EXACT = 845;
const SCORE_MATCH = 840;

function row(e: CharEntry, score: number): Answer {
    const cps = codePointsOf(e.glyph);
    return {
        id: cps.map(cp => cp.toString(16)).join('-'),
        title: capital(e.name),
        copy: e.glyph,
        description: `${e.kind === 'e' ? 'Emoji' : 'Character'} · ${describeCodes(cps)}`,
        icon: ICON,
        glyph: e.glyph,
        score,
    };
}

function byCodePoint(db: readonly CharEntry[], cp: number): Answer[] {
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff)
        return [];
    const glyph = String.fromCodePoint(cp);
    for (const e of db) {
        if (e.glyph === glyph)
            return [row(e, 1000)];
    }
    return [{
        id: cp.toString(16), title: `U+${hex(cp)}`, copy: glyph, description: `Character · U+${hex(cp)}`,
        icon: ICON, glyph, score: 1000,
    }];
}

export function searchCharacters(db: readonly CharEntry[], q: CharQuery, limit: number): Answer[] {
    if (limit <= 0)
        return [];
    if (q.codePoint !== undefined)
        return byCodePoint(db, q.codePoint);
    const terms = q.terms.map(t => ` ${t}`);
    // "smile" also finds "smiling", "dance" finds "dancing".
    const ing = q.terms.map(t => t.length >= 4 && t.endsWith('e') ? ` ${t.slice(0, -1)}ing` : null);
    const full = ` ${q.terms.join(' ')}`;
    const wantKind = q.kind;
    const buckets: CharEntry[][] = [[], [], [], []];
    for (let i = 0; i < db.length; i++) {
        const e = db[i] as Indexed;
        if (wantKind !== 'any' && e.kind !== wantKind)
            continue;
        let h = e.haystack;
        if (h === undefined) {
            e.nameFolded = ` ${fold(e.name)}`;
            h = e.haystack = `${e.nameFolded}${e.keywords ? ` ${fold(e.keywords)}` : ''}`;
        }
        let ok = true;
        for (let t = 0; t < terms.length; t++) {
            if (!h.includes(terms[t]) && !(ing[t] !== null && h.includes(ing[t] as string))) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        const name = e.nameFolded as string;
        let rank: number;
        if (name === full) {
            rank = 0;
        } else if (name.startsWith(full)) {
            rank = 1;
        } else {
            rank = 2;
            for (let t = 0; t < terms.length; t++) {
                if (!name.includes(terms[t]) && !(ing[t] !== null && name.includes(ing[t] as string))) {
                    rank = 3;
                    break;
                }
            }
        }
        const b = buckets[rank];
        if (b.length < limit)
            b.push(e);
    }
    const out: Answer[] = [];
    for (let r = 0; r < 4 && out.length < limit; r++) {
        for (const e of buckets[r]) {
            if (out.length >= limit)
                break;
            out.push(row(e, r === 0 ? SCORE_EXACT : SCORE_MATCH));
        }
    }
    return out;
}
