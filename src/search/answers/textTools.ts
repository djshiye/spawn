// Small offline text and number tools for the search box: random passwords, PINs, UUIDs, hashes, Base64,
// URL encoding, dice, case conversion and counting. Imports only the Answer type; unit-testable with gjs -m
// (tests/textTools.test.js). These are "ranked tools": every Answer carries a score so that they compete with apps.
//
// Text forms (keyword first, case-insensitive; the argument keeps its case and inner spaces):
//   password [N] [letters|simple|no symbols]   pw, passwd; N is 8..128 (default 20), symbols are !#$%&*+-=?@^_
//   pin [N]                                    3..12 digits (default 4)
//   uuid | guid                                random version-4 UUID
//   md5|sha1|sha256|sha512 <text>              hex digest;  hash <text> gives sha256, sha1 and md5
//   base64 [encode] <text> | b64 <text>        Base64 of the UTF-8 bytes
//   base64 decode <b64> | b64 decode | unbase64   decoded text (URL-safe alphabet and missing padding accepted)
//   url encode <text> | urlencode <text>       encodeURIComponent;  url decode / urldecode: decodeURIComponent
//   random [N | A-B | A B | A to B]            integer, default 1..100;  roll [NdS], dice: dice rolls (max 20d1000)
//   flip a coin | coin flip | coin toss | flip coin | toss a coin
//   uppercase|upper <text>, lowercase|lower <text>, title case <text>, count|length <text>
// A keyword with a structured argument ("password 24", "roll 2d6") scores 1000; a bare generator keyword, or a
// keyword followed by free text ("md5 hello" could also be the start of an app's name), 840, just below an app whose
// name starts with the typed text. Queries over 2000 characters give [].
// All randomness comes from deps.randomBytes with rejection sampling (no modulo bias).
//
// Public API:
//   toolAnswers(query, deps): Answer[]     never throws
//   ToolDeps: {randomBytes(n), checksum(algorithm, text)}

import type {Answer} from './types.js';

export interface ToolDeps {
    /** n cryptographically secure random bytes (the shell passes /dev/urandom; tests pass a fixed stream). */
    randomBytes(n: number): Uint8Array;
    /** Hex digest of the UTF-8 text. */
    checksum(algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512', text: string): string;
}

const MAX_QUERY = 2000;
const MAX_KEYWORD = 11;
const SCORE_ARG = 1000;
const SCORE_BARE = 840;
/** A keyword followed by free text ("hash checker" may be an app being typed): no higher than a bare keyword. */
const SCORE_TEXT = 840;
const ICON_SECRET = 'dialog-password-symbolic';
const ICON_CODE = 'utilities-terminal-symbolic';
const ICON_NUMBER = 'accessories-calculator-symbolic';
const ICON_TEXT = 'preferences-desktop-font-symbolic';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!#$%&*+-=?@^_';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const ALGORITHMS: Record<string, [('md5' | 'sha1' | 'sha256' | 'sha512'), string]> = {
    md5: ['md5', 'MD5'],
    sha1: ['sha1', 'SHA-1'],
    sha256: ['sha256', 'SHA-256'],
    sha512: ['sha512', 'SHA-512'],
};

type Algorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

let keywords: Set<string> | null = null;
let b64Lookup: Int8Array | null = null;
let coinPhrases: Set<string> | null = null;

function keywordSet(): Set<string> {
    if (!keywords) {
        keywords = new Set(['password', 'pw', 'passwd', 'pin', 'uuid', 'guid', 'md5', 'sha1', 'sha256', 'sha512',
            'hash', 'base64', 'b64', 'unbase64', 'url', 'urlencode', 'urldecode', 'random', 'roll', 'dice',
            'flip', 'coin', 'toss', 'uppercase', 'upper', 'lowercase', 'lower', 'title', 'count', 'length']);
    }
    return keywords;
}

/** Entry point. Returns [] for anything that is not a complete, valid tool query. */
export function toolAnswers(query: string, deps: ToolDeps): Answer[] {
    if (query.length > MAX_QUERY || query.length < 2)
        return [];
    const q = query.trim();
    if (q.length < 2)
        return [];
    const space = q.indexOf(' ');
    if (space > MAX_KEYWORD || (space < 0 && q.length > MAX_KEYWORD))
        return [];
    const keyword = (space < 0 ? q : q.slice(0, space)).toLowerCase();
    if (!keywordSet().has(keyword))
        return [];
    const arg = space < 0 ? '' : q.slice(space + 1);
    try {
        return dispatch(keyword, arg, q, deps);
    } catch {
        return [];
    }
}

function dispatch(keyword: string, arg: string, q: string, deps: ToolDeps): Answer[] {
    switch (keyword) {
    case 'password':
    case 'pw':
    case 'passwd':
        return password(arg, deps);
    case 'pin':
        return pin(arg, deps);
    case 'uuid':
    case 'guid':
        return arg ? [] : uuid(deps);
    case 'md5':
    case 'sha1':
    case 'sha256':
    case 'sha512':
        return arg ? [hashRow(keyword, arg, deps)] : [];
    case 'hash':
        return arg ? [hashRow('sha256', arg, deps), hashRow('sha1', arg, deps), hashRow('md5', arg, deps)] : [];
    case 'base64':
    case 'b64':
        return base64(arg);
    case 'unbase64':
        return arg ? base64Decode(arg) : [];
    case 'url':
        return urlTool(arg);
    case 'urlencode':
        return arg ? urlEncode(arg) : [];
    case 'urldecode':
        return arg ? urlDecode(arg) : [];
    case 'random':
        return random(arg, deps);
    case 'roll':
    case 'dice':
        return dice(arg, deps);
    case 'flip':
    case 'coin':
    case 'toss':
        return coin(q, deps);
    case 'uppercase':
    case 'upper':
        return arg ? [textRow('upper', arg.toUpperCase(), 'Uppercase')] : [];
    case 'lowercase':
    case 'lower':
        return arg ? [textRow('lower', arg.toLowerCase(), 'Lowercase')] : [];
    case 'title':
        return titleCase(arg);
    case 'count':
    case 'length':
        return arg ? countRow(arg) : [];
    }
    return [];
}

// ---- randomness ----------------------------------------------------------------------------------------------

/** Uniform integer in [0, n) by rejection sampling. n in 1..2^32. */
function randInt(deps: ToolDeps, n: number): number {
    if (n <= 1)
        return 0;
    let bytes = 1;
    let span = 256;
    while (span < n) {
        span *= 256;
        bytes++;
    }
    const limit = span - span % n;
    for (let attempt = 0; attempt < 10000; attempt++) {
        const b = deps.randomBytes(bytes);
        if (b.length < bytes)
            throw new Error('short random read');
        let v = 0;
        for (let i = 0; i < bytes; i++)
            v = v * 256 + b[i];
        if (v < limit)
            return v % n;
    }
    throw new Error('random source is stuck');
}

function pick(deps: ToolDeps, set: string): string {
    return set[randInt(deps, set.length)];
}

function shuffle(deps: ToolDeps, items: string[]): void {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randInt(deps, i + 1);
        const t = items[i];
        items[i] = items[j];
        items[j] = t;
    }
}

function score(arg: string): number {
    return arg ? SCORE_ARG : SCORE_BARE;
}

// ---- password, PIN, UUID --------------------------------------------------------------------------------------

function password(arg: string, deps: ToolDeps): Answer[] {
    let length = 20;
    let symbols = true;
    if (arg) {
        const m = /^(\d{1,3})(?: (letters|simple|no symbols))?$/i.exec(arg);
        if (!m)
            return [];
        length = parseInt(m[1], 10);
        symbols = m[2] === undefined;
    }
    if (length < 8 || length > 128)
        return [];
    const classes = symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS];
    const all = classes.join('');
    const chars: string[] = [];
    for (const c of classes)
        chars.push(pick(deps, c));
    while (chars.length < length)
        chars.push(pick(deps, all));
    shuffle(deps, chars);
    const pw = chars.join('');
    return [{
        id: 'password', title: pw, copy: pw,
        description: `Random password · ${length} characters · ${symbols ? 'with symbols' : 'letters and digits'}`,
        icon: ICON_SECRET, score: score(arg),
    }];
}

function pin(arg: string, deps: ToolDeps): Answer[] {
    let length = 4;
    if (arg) {
        if (!/^\d{1,2}$/.test(arg))
            return [];
        length = parseInt(arg, 10);
    }
    if (length < 3 || length > 12)
        return [];
    let s = '';
    for (let i = 0; i < length; i++)
        s += pick(deps, DIGITS);
    return [{
        id: 'pin', title: s, copy: s, description: `Random PIN · ${length} digits`,
        icon: ICON_SECRET, score: score(arg),
    }];
}

function uuid(deps: ToolDeps): Answer[] {
    const b = deps.randomBytes(16);
    if (b.length < 16)
        return [];
    const h: string[] = [];
    for (let i = 0; i < 16; i++) {
        let v = b[i];
        if (i === 6)
            v = (v & 0x0f) | 0x40;
        else if (i === 8)
            v = (v & 0x3f) | 0x80;
        h.push((v < 16 ? '0' : '') + v.toString(16));
    }
    const s = `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-` +
        `${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
    return [{
        id: 'uuid', title: s, copy: s, description: 'Random UUID (version 4)', icon: ICON_SECRET, score: SCORE_BARE,
    }];
}

// ---- hashes ---------------------------------------------------------------------------------------------------

function shorten(text: string): string {
    if (text.length <= 40)
        return text;
    let cut = 39;
    const c = text.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff)
        cut--;
    return `${text.slice(0, cut)}…`;
}

function hashRow(algorithm: Algorithm, text: string, deps: ToolDeps): Answer {
    const digest = deps.checksum(algorithm, text);
    return {
        id: algorithm, title: digest, copy: digest, description: `${ALGORITHMS[algorithm][1]} of “${shorten(text)}”`,
        icon: ICON_SECRET, score: SCORE_TEXT,
    };
}

// ---- Base64 ---------------------------------------------------------------------------------------------------

function base64Encode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
        out += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return out;
}

function base64Bytes(text: string): Uint8Array | null {
    if (!b64Lookup) {
        b64Lookup = new Int8Array(128).fill(-1);
        for (let i = 0; i < 64; i++)
            b64Lookup[B64.charCodeAt(i)] = i;
        b64Lookup[0x2d] = 62; // '-'
        b64Lookup[0x5f] = 63; // '_'
    }
    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 0x3d)
        end--;
    if (text.length - end > 2 || end === 0 || end % 4 === 1)
        return null;
    const out = new Uint8Array(Math.floor(end * 3 / 4));
    let acc = 0;
    let bits = 0;
    let n = 0;
    for (let i = 0; i < end; i++) {
        const code = text.charCodeAt(i);
        const v = code < 128 ? b64Lookup[code] : -1;
        if (v < 0)
            return null;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[n++] = (acc >> bits) & 255;
            acc &= (1 << bits) - 1;
        }
    }
    return out;
}

function base64(arg: string): Answer[] {
    if (!arg)
        return [];
    const head = arg.slice(0, 7).toLowerCase();
    if (head === 'decode ')
        return base64Decode(arg.slice(7));
    if (head === 'encode ')
        return arg.length > 7 ? base64EncodeRow(arg.slice(7)) : [];
    if (head === 'decode' || head === 'encode')
        return [];
    return base64EncodeRow(arg);
}

function base64EncodeRow(text: string): Answer[] {
    const s = base64Encode(new TextEncoder().encode(text));
    return [{
        id: 'base64', title: s, copy: s, description: `Base64 of “${shorten(text)}”`, icon: ICON_CODE, score: SCORE_TEXT,
    }];
}

function base64Decode(b64: string): Answer[] {
    if (!b64)
        return [];
    const bytes = base64Bytes(b64);
    if (!bytes || bytes.length === 0)
        return [];
    let text: string;
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
        return [];
    }
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x20 || (c >= 0x7f && c <= 0x9f))
            return [];
    }
    return [{
        id: 'base64d', title: text, copy: text, description: 'Decoded from Base64', icon: ICON_CODE, score: SCORE_TEXT,
    }];
}

// ---- URL encoding ---------------------------------------------------------------------------------------------

function urlTool(arg: string): Answer[] {
    const head = arg.slice(0, 7).toLowerCase();
    if (head === 'encode ' && arg.length > 7)
        return urlEncode(arg.slice(7));
    if (head === 'decode ' && arg.length > 7)
        return urlDecode(arg.slice(7));
    return [];
}

function urlEncode(text: string): Answer[] {
    const s = encodeURIComponent(text);
    return [{id: 'urlenc', title: s, copy: s, description: 'URL-encoded', icon: ICON_CODE, score: SCORE_TEXT}];
}

function urlDecode(text: string): Answer[] {
    let s: string;
    try {
        s = decodeURIComponent(text);
    } catch {
        return [];
    }
    return [{id: 'urldec', title: s, copy: s, description: 'URL-decoded', icon: ICON_CODE, score: SCORE_TEXT}];
}

// ---- random numbers, dice, coin -------------------------------------------------------------------------------

function random(arg: string, deps: ToolDeps): Answer[] {
    let min = 1;
    let max = 100;
    if (arg) {
        let m = /^(\d{1,10})$/.exec(arg);
        if (m) {
            max = parseInt(m[1], 10);
        } else {
            m = /^(-?\d{1,10})\s*(?:to|-|\s)\s*(-?\d{1,10})$/i.exec(arg);
            if (!m)
                return [];
            min = parseInt(m[1], 10);
            max = parseInt(m[2], 10);
        }
    }
    if (!(min < max) || min < -1e9 || max > 1e9)
        return [];
    const v = min + randInt(deps, max - min + 1);
    const s = String(v);
    return [{
        id: 'random', title: s, copy: s, description: `Random number from ${min} to ${max}`,
        icon: ICON_NUMBER, score: score(arg),
    }];
}

function dice(arg: string, deps: ToolDeps): Answer[] {
    let count = 1;
    let sides = 6;
    if (arg) {
        const m = /^(\d{0,2})d(\d{1,4})$/i.exec(arg);
        if (!m)
            return [];
        count = m[1] === '' ? 1 : parseInt(m[1], 10);
        sides = parseInt(m[2], 10);
    }
    if (count < 1 || count > 20 || sides < 2 || sides > 1000)
        return [];
    const rolls: number[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
        const r = 1 + randInt(deps, sides);
        rolls.push(r);
        total += r;
    }
    const label = count === 1 ? `d${sides}` : `${count}d${sides}`;
    const s = String(total);
    return [{
        id: 'dice', title: s, copy: s, description: `${label}: ${rolls.join(' + ')}`,
        icon: ICON_NUMBER, score: score(arg),
    }];
}

function coin(q: string, deps: ToolDeps): Answer[] {
    if (!coinPhrases)
        coinPhrases = new Set(['flip a coin', 'coin flip', 'coin toss', 'flip coin', 'toss a coin']);
    if (!coinPhrases.has(q.toLowerCase().replace(/\s+/g, ' ')))
        return [];
    const s = randInt(deps, 2) === 0 ? 'Heads' : 'Tails';
    return [{id: 'coin', title: s, copy: s, description: 'Coin flip', icon: ICON_NUMBER, score: SCORE_BARE}];
}

// ---- text -----------------------------------------------------------------------------------------------------

function textRow(id: string, text: string, description: string): Answer {
    return {id, title: text, copy: text, description, icon: ICON_TEXT, score: SCORE_TEXT};
}

function titleCase(arg: string): Answer[] {
    if (arg.slice(0, 5).toLowerCase() !== 'case ' || arg.length <= 5)
        return [];
    const text = arg.slice(5).toLowerCase().replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase());
    return [textRow('title', text, 'Title case')];
}

function countRow(text: string): Answer[] {
    let chars = 0;
    let bytes = 0;
    for (const ch of text) {
        chars++;
        const cp = ch.codePointAt(0) as number;
        bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    const words = text.split(/\s+/).filter(w => w !== '').length;
    const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
    return [{
        id: 'count', title: plural(chars, 'character'), copy: String(chars),
        description: `${plural(words, 'word')} · ${plural(bytes, 'byte')} in UTF-8`,
        icon: ICON_TEXT, score: SCORE_TEXT,
    }];
}
