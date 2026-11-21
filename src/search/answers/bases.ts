// Number base conversion for the search box: "0xFF", "255 in hex", "hex 255", "0b1010 to decimal",
// "255 in base 36", "zz base 36 in decimal", "ascii A", "chr 65". Pure (imports only the Answer type);
// unit-testable with gjs -m (tests/bases.test.js).
//
// Text forms (case-insensitive, values up to 128 bits, a leading "-" is a plain sign, not two's complement):
//   0xFF | 0b1010 | 0o17          a prefixed literal on its own: one row per other base (Decimal, Hexadecimal,
//                                 Binary, Octal)
//   <number> (in | to | as) <target>      one row for the target; the number is decimal unless prefixed
//                                 (0x / 0b / 0o) or written "<digits> base N"
//   <target> <number>             keyword first: "hex 255", "bin 255", "oct 255", "dec 0xff" (the keyword is the TARGET)
//   target: hex hexadecimal bin binary oct octal dec decimal | base N (2..36)
//   ascii <char> | ascii <code> | chr <code>     rows for a character, or the character for a code (32..126)
// A bare "255", "ff", "hex" or "binary" is not an answer.
//
// Public API:
//   baseAnswers(query): Answer[]      [] unless the whole query is a complete, valid conversion

import type {Answer} from './types.js';

const ICON = 'accessories-calculator-symbolic';
const MAX_LENGTH = 120;

const PREFIXED = /^(-?)0([xbo])([0-9a-f]+)$/;
const DECIMAL = /^-?\d+$/;
const SOURCE_BASE = /^(-?)([0-9a-z]+) +base +(\d{1,2})$/;
const KEY_FIRST = /^(hex|hexadecimal|bin|binary|oct|octal|dec|decimal) +(\S.*)$/;
const TARGETED = /^(.+?) +(?:in|to|as) +(\S.*)$/;
const TARGET_BASE = /^base +(\d{1,2})$/;
const ASCII = /^(ascii|chr) +(\S.*)$/i;

let limit: bigint | null = null;

function parseDigits(digits: string, base: number, negative: boolean): bigint | null {
    if (limit === null)
        limit = 1n << 128n;
    const b = BigInt(base);
    let value = 0n;
    for (let i = 0; i < digits.length; i++) {
        const c = digits.charCodeAt(i);
        const d = c <= 57 ? c - 48 : c - 87;
        if (d < 0 || d >= base)
            return null;
        value = value * b + BigInt(d);
    }
    if (value >= limit)
        return null;
    return negative ? -value : value;
}

/** A number on the left of the conversion (lower-case text): prefixed, decimal, or "<digits> base N". */
function parseSource(text: string): bigint | null {
    let m = PREFIXED.exec(text);
    if (m)
        return parseDigits(m[3], m[2] === 'x' ? 16 : m[2] === 'b' ? 2 : 8, m[1] === '-');
    if (DECIMAL.test(text)) {
        const neg = text.charCodeAt(0) === 45;
        return parseDigits(neg ? text.slice(1) : text, 10, neg);
    }
    m = SOURCE_BASE.exec(text);
    if (m) {
        const base = parseInt(m[3], 10);
        if (base < 2 || base > 36)
            return null;
        return parseDigits(m[2], base, m[1] === '-');
    }
    return null;
}

function targetBase(word: string): number {
    switch (word) {
        case 'hex': case 'hexadecimal': return 16;
        case 'bin': case 'binary': return 2;
        case 'oct': case 'octal': return 8;
        case 'dec': case 'decimal': return 10;
    }
    const m = TARGET_BASE.exec(word);
    if (!m)
        return 0;
    const base = parseInt(m[1], 10);
    return base >= 2 && base <= 36 ? base : 0;
}

function row(value: bigint, base: number): Answer {
    const sign = value < 0n ? '-' : '';
    const abs = value < 0n ? -value : value;
    switch (base) {
        case 10:
            return {id: 'dec', title: value.toString(), copy: value.toString(), description: 'Decimal', icon: ICON};
        case 16: {
            const t = `${sign}0x${abs.toString(16).toUpperCase()}`;
            return {id: 'hex', title: t, copy: t, description: 'Hexadecimal', icon: ICON};
        }
        case 2: {
            let digits = abs.toString(2);
            const pad = (4 - digits.length % 4) % 4;
            digits = '0'.repeat(pad) + digits;
            const groups = digits.match(/.{4}/g) as string[];
            return {
                id: 'bin', title: sign + groups.join(' '), copy: sign + abs.toString(2),
                description: 'Binary', icon: ICON,
            };
        }
        case 8: {
            const t = `${sign}0o${abs.toString(8)}`;
            return {id: 'oct', title: t, copy: t, description: 'Octal', icon: ICON};
        }
        default: {
            const t = value.toString(base);
            return {id: `base${base}`, title: t, copy: t, description: `Base ${base}`, icon: ICON};
        }
    }
}

function asciiAnswers(rest: string): Answer[] {
    const v = parseSource(rest.toLowerCase());
    if (v !== null && v >= 32n && v <= 126n) {
        const code = Number(v);
        const ch = String.fromCharCode(code);
        return [{id: 'char', title: ch, copy: ch, description: `ASCII ${code}`, icon: ICON}];
    }
    if (rest.length === 1) {
        const code = rest.charCodeAt(0);
        if (code >= 32 && code <= 126) {
            const n = BigInt(code);
            return [row(n, 10), row(n, 16), row(n, 2)];
        }
    }
    return [];
}

function convert(text: string): Answer[] {
    const m0 = PREFIXED.exec(text);
    if (m0) {
        const own = m0[2] === 'x' ? 16 : m0[2] === 'b' ? 2 : 8;
        const v = parseDigits(m0[3], own, m0[1] === '-');
        if (v === null)
            return [];
        const out: Answer[] = [];
        for (const b of [10, 16, 2, 8])
            if (b !== own)
                out.push(row(v, b));
        return out;
    }
    const k = KEY_FIRST.exec(text);
    if (k) {
        const v = parseSource(k[2]);
        if (v !== null)
            return [row(v, targetBase(k[1]))];
    }
    const t = TARGETED.exec(text);
    if (t) {
        const base = targetBase(t[2]);
        if (base === 0)
            return [];
        const v = parseSource(t[1]);
        return v === null ? [] : [row(v, base)];
    }
    return [];
}

export function baseAnswers(query: string): Answer[] {
    if (query.length > MAX_LENGTH || query.length < 3)
        return [];
    const text = query.trim();
    // Cheap reject: apart from a prefixed literal, every form has a space; app names rarely do.
    const c = text.charCodeAt(0);
    if (text.indexOf(' ') < 0 && c !== 48 && c !== 45)
        return [];
    try {
        const a = ASCII.exec(text);
        if (a)
            return asciiAnswers(a[2].trim());
        return convert(text.toLowerCase().replace(/\s+/g, ' '));
    } catch {
        return [];
    }
}
