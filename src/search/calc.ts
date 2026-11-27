// Calculator core: a hand-written tokenizer and recursive-descent parser for arithmetic.
// No imports (unit-testable with gjs -m, tests/calc.test.js), no eval / Function / external process.
//
// Grammar (lowest to highest precedence):
//   expr    := xor ('|' xor)*                                 bitwise operators work on integers (|n| <= 2^53)
//   xor     := and ('xor' and)*
//   and     := shift ('&' shift)*
//   shift   := sum (('<<' | '>>') sum)*
//   sum     := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%' | 'mod' | 'of' | 'off' | <implicit>) unary)*
//                                                             '%' here is modulo, 'of' / 'off' follow a percentage
//   unary   := ('-' | '+') unary | power
//   power   := postfix ('^' unary)?                           right-associative; -2^2 = -(2^2); 2^-1 works
//   postfix := primary ('%' | '!' | '°' | 'deg' | '²' | '³' | 'squared' | 'cubed')*
//                                                             a % is a percentage unless a value follows it (a number,
//                                                             '(', a constant, a function, √ or ∛): then it is modulo;
//                                                             ° and deg convert degrees to radians
//   primary := number | constant | '(' expr ')'
//            | ('√' | '∛' | function) ( '(' expr (',' expr)* ')' | unary )
// A function or root sign followed by "(" takes the bracketed argument list; otherwise it takes ONE unary-level
// operand: "sqrt 16 + 9" = 13, "sin 30°" = 0.5, "log 100" = 2, "√16" = 4.
//
// Implicit multiplication (counted as an operation): a number or ")" directly followed by "(", a constant other
// than e, a function name, √ or ∛: "2pi", "2(3+4)" = 14, "(1+2)(3+4)" = 21, "3 sqrt(4)" = 6. Never "2e" / "2 e"
// and never between two numbers ("2 3").
//
// Percentages: "15% of 80" = 12, "20% off 80" = 64, "50%" = 0.5, "200 + 10%" = 220 (10 % of 200),
// "200 - 10%" = 180, "200 + 10% + 5" = 225, "10% * 50" = 5, "10 % 3" = 1 (modulo: the % is followed by a value).
//
// Numbers use "." as the decimal point and have no thousands separator ("1,5" is rejected). An exponent is
// allowed ("4e2", "1.5E-3"), and so are 0x (hex), 0b (binary) and 0o (octal) integers, any case. A bare literal
// is not a calculation, "0xFF + 1" is.
//
// Operators: + - * / ^ % ! & | << >>, the characters × ÷ − · and ** (power), and the words plus, minus, times,
// "divided by", "to the power of", mod (infix: "10 mod 3"), xor, squared, cubed (postfix), "of" / "off".
// Bitwise operators compute through BigInt; operands must be integers with |n| <= 2^53, shift counts 0..1100.
//   1 << 10 = 1024, 0xF0 | 0x0F = 255, 6 & 3 = 2, 5 xor 1 = 4
//
// Constants: pi (π), e, tau (τ), phi (φ, the golden ratio).
// Functions (case-insensitive; trigonometry in radians; results of sin, cos and tan within 1e-15 of zero
// snap to 0 so that "sin pi" prints 0):
//   one argument: sqrt cbrt abs floor ceil trunc sign sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh
//                 exp ln log2 deg (radians to degrees) rad (degrees to radians) fact (alias factorial, 0..170)
//   log(x) base 10, log(x, base); round(x), round(x, places)
//   several:      min max sum avg (alias mean) hypot (any count), gcd lcm (2 or more non-negative integers),
//                 pow(x, y), root(x, n), mod(a, b), atan2(y, x), ncr(n, k), npr(n, k)
// A wrong argument count or a domain error (fact(-1), gcd(1.5, 2), log(0)) is an error.
//
// Input tidying before parsing: a leading "=" or "what is" / "whats" / "what's" / "calc" / "calculate" and a
// trailing "=" or "?" are stripped ("what is 15% of 80?" = 12). The same "is it a calculation" rule applies after.
//
// Limits: 200 characters, 64 levels of nesting (brackets, unary signs, chains such as "sin sin sin 1" or
// "√√√4" all count), 120 tokens; NaN and Infinity are errors (1/0 has no answer).
//
// Public API:
//   evaluate(text): number | null            the value, or null for anything that is not a complete, finite expression
//   isCalculation(text): boolean             true when text is an expression WITH an operator, percentage or function
//                                            (a bare number or constant is not a calculation: "2048" must find apps)
//   calculate(text): {value, text} | null    isCalculation + evaluate + formatNumber; null when not a calculation
//   formatNumber(x, digits = 12): string     `digits` significant digits, except whole numbers up to 2^53, which
//                                            keep every digit; no trailing zeros, "." decimal, never locale
//                                            dependent, no floating point noise (0.1+0.2 -> 0.3), no "-0"
//   groupDigits(text): string                display only: U+00A0 thousands separators in the integer part of a
//                                            formatNumber() result with 5 or more integer digits; fraction and
//                                            exponent forms are left alone

export const MAX_LENGTH = 200;
export const MAX_DEPTH = 64;
const MAX_TOKENS = 120;
const MAX_SHIFT = 1100;
const MAX_BIT_VALUE = 2 ** 53;

type Token =
    | {t: 'num'; v: number}
    | {t: 'id'; v: string}
    | {t: 'op'; v: string};

class CalcError extends Error {}

function fail(message: string): never {
    throw new CalcError(message);
}

function check(v: number): void {
    if (!Number.isFinite(v))
        fail('not a finite number');
}

// Trigonometric noise such as sin(pi) = 1.2e-16 is not an answer: snap it to 0.
function snap(x: number): number {
    return Math.abs(x) < 1e-15 ? 0 : x;
}

function whole(x: number, max = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isInteger(x) || x < 0 || x > max)
        fail('needs a non-negative integer');
    return x;
}

function factorial(x: number): number {
    let r = 1;
    for (let i = 2; i <= whole(x, 170); i++)
        r *= i;
    return r;
}

function gcd2(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return a;
}

function lcm2(a: number, b: number): number {
    if (a === 0 || b === 0)
        return 0;
    const r = a / gcd2(a, b) * b;
    return whole(r);
}

function nthRoot(x: number, n: number): number {
    if (n === 0)
        fail('zeroth root');
    if (n === 2)
        return Math.sqrt(x);
    if (n === 3)
        return Math.cbrt(x);
    if (x < 0 && Number.isInteger(n) && n % 2 !== 0)
        return -Math.pow(-x, 1 / n);
    return Math.pow(x, 1 / n);
}

function roundTo(x: number, places: number): number {
    if (!Number.isInteger(places) || Math.abs(places) > 15)
        fail('bad number of places');
    if (Math.abs(x) >= 1e15)
        return x;
    const s = String(x);
    if (s.includes('e')) // tiny values such as 1e-7: scale the plain way
        return Math.round(x * 10 ** places) / 10 ** places;
    // Decimal-exponent shifting avoids binary noise: round(1.005, 2) = 1.01
    return Number(`${Math.round(Number(`${s}e${places}`))}e${-places}`);
}

function combinations(n: number, k: number): number {
    whole(n);
    whole(k, n);
    const m = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= m; i++) {
        r = r * (n - m + i) / i;
        check(r);
    }
    return Math.round(r);
}

function permutations(n: number, k: number): number {
    whole(n);
    whole(k, n);
    let r = 1;
    for (let i = 0; i < k; i++) {
        r *= n - i;
        check(r);
    }
    return r;
}

interface Fn {
    min: number;
    max: number;
    f: (a: number[]) => number;
}

const one = (f: (x: number) => number): Fn => ({min: 1, max: 1, f: a => f(a[0])});
const trig = (f: (x: number) => number): Fn => one(x => snap(f(x)));
const two = (f: (x: number, y: number) => number): Fn => ({min: 2, max: 2, f: a => f(a[0], a[1])});
const many = (min: number, f: (a: number[]) => number): Fn => ({min, max: Infinity, f});

const SUM = many(1, a => a.reduce((s, x) => s + x, 0));
const AVG = many(1, a => a.reduce((s, x) => s + x, 0) / a.length);
const FACT = one(factorial);

const FUNCTIONS: Record<string, Fn> = {
    sqrt: one(Math.sqrt),
    cbrt: one(Math.cbrt),
    abs: one(Math.abs),
    floor: one(Math.floor),
    ceil: one(Math.ceil),
    trunc: one(Math.trunc),
    sign: one(Math.sign),
    sin: trig(Math.sin),
    cos: trig(Math.cos),
    tan: trig(Math.tan),
    asin: one(Math.asin),
    acos: one(Math.acos),
    atan: one(Math.atan),
    sinh: one(Math.sinh),
    cosh: one(Math.cosh),
    tanh: one(Math.tanh),
    asinh: one(Math.asinh),
    acosh: one(Math.acosh),
    atanh: one(Math.atanh),
    exp: one(Math.exp),
    ln: one(Math.log),
    log2: one(Math.log2),
    deg: one(x => x * 180 / Math.PI),
    rad: one(x => x * Math.PI / 180),
    fact: FACT,
    factorial: FACT,
    log: {min: 1, max: 2, f: a => a.length === 1 ? Math.log10(a[0]) : Math.log(a[0]) / Math.log(a[1])},
    round: {min: 1, max: 2, f: a => a.length === 1 ? Math.round(a[0]) : roundTo(a[0], a[1])},
    min: many(1, a => Math.min(...a)),
    max: many(1, a => Math.max(...a)),
    sum: SUM,
    avg: AVG,
    mean: AVG,
    hypot: many(1, a => Math.hypot(...a)),
    gcd: many(2, a => a.map(x => whole(x, MAX_BIT_VALUE)).reduce(gcd2)),
    lcm: many(2, a => a.map(x => whole(x, MAX_BIT_VALUE)).reduce(lcm2)),
    pow: two(Math.pow),
    root: two(nthRoot),
    mod: two((a, b) => a % b),
    atan2: two(Math.atan2),
    ncr: two(combinations),
    npr: two(permutations),
};

const TAU = 2 * Math.PI;
const PHI = (1 + Math.sqrt(5)) / 2;

const CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
    tau: TAU,
    'τ': TAU,
    phi: PHI,
    'φ': PHI,
};

const OPERATOR_ALIASES: Record<string, string> = {
    '×': '*',
    '·': '*',
    '÷': '/',
    '−': '-',
    '–': '-',
    '∕': '/',
};

// Words that are plain operators.
const WORD_OPERATORS: Record<string, string> = {
    plus: '+',
    minus: '-',
    times: '*',
};

// Phrases of several words that are operators.
const PHRASE_OPERATORS: Record<string, string> = {
    divided: '/',
    to: '^',
};

const SINGLE_OPS = '+-*/^%(),!&|°²³√∛';
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const RADIX_NUMBER = /^0(?:x[\da-f]+|b[01]+|o[0-7]+)(?![\da-z])/i;
const IDENT = /^(?:(?:log2|atan2)(?![a-zπτφ\d])|[a-zπτφ]+)/i;
const PHRASE = /^(?:divided\s+by|to\s+the\s+power\s+of)(?![a-zπτφ])/i;

// Binary bitwise operator levels, loosest first.
const BIT_LEVELS = [['|'], ['xor'], ['&'], ['<<', '>>']];

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === ' ' || c === ' ') {
            i++;
            continue;
        }
        if (out.length >= MAX_TOKENS)
            fail('too long');
        const rest = text.slice(i);
        const radix = c === '0' ? RADIX_NUMBER.exec(rest) : null;
        const num = radix ?? NUMBER.exec(rest);
        if (num) {
            const v = Number(num[0]); // handles the 0x / 0b / 0o prefixes in any case
            if (!Number.isFinite(v))
                fail('number too large');
            out.push({t: 'num', v});
            i += num[0].length;
            continue;
        }
        const id = IDENT.exec(rest);
        if (id) {
            const word = id[0].toLowerCase();
            const phrase = Object.hasOwn(PHRASE_OPERATORS, word) ? PHRASE.exec(rest) : null;
            if (phrase) {
                out.push({t: 'op', v: PHRASE_OPERATORS[word]});
                i += phrase[0].length;
            } else if (Object.hasOwn(WORD_OPERATORS, word)) {
                out.push({t: 'op', v: WORD_OPERATORS[word]});
                i += id[0].length;
            } else {
                out.push({t: 'id', v: word});
                i += id[0].length;
            }
            continue;
        }
        const pair = rest.slice(0, 2);
        if (pair === '**' || pair === '<<' || pair === '>>') {
            out.push({t: 'op', v: pair === '**' ? '^' : pair});
            i += 2;
            continue;
        }
        const op = OPERATOR_ALIASES[c] ?? c;
        if (SINGLE_OPS.includes(op)) {
            out.push({t: 'op', v: op});
            i++;
            continue;
        }
        fail(`unexpected character ${c}`);
    }
    return out;
}

function bitwise(op: string, a: number, b: number): number {
    for (const x of [a, b]) {
        if (!Number.isInteger(x) || Math.abs(x) > MAX_BIT_VALUE)
            fail('bitwise operators need integers up to 2^53');
    }
    const x = BigInt(a);
    const y = BigInt(b);
    switch (op) {
    case '|': return Number(x | y);
    case 'xor': return Number(x ^ y);
    case '&': return Number(x & y);
    default:
        if (b < 0 || b > MAX_SHIFT)
            fail('bad shift count');
        return Number(op === '<<' ? x << y : x >> y);
    }
}

interface Value {
    v: number;
    /** The value is a bare percentage literal ("10%"); "200 + 10%" adds 10 % OF 200. */
    pct: boolean;
}

const plain = (v: number): Value => ({v, pct: false});

/** Tokens after which a "%" is a percentage: anything that cannot start a value (a value means modulo). */
const PERCENT_BEFORE_OPS = new Set([')', ',', '+', '-', '*', '/', '^', '&', '|', '<<', '>>']);
const PERCENT_BEFORE_WORDS = new Set(['of', 'off', 'mod', 'xor']);

class Parser {
    private _i = 0;
    private _depth = 0;
    /** Operators, percentages and function calls seen (what makes the text a calculation). */
    operations = 0;

    constructor(private readonly _tokens: Token[]) {}

    parse(): number {
        const r = this._expr();
        if (this._i < this._tokens.length)
            fail('unexpected token');
        return r.v;
    }

    private _peek(): Token | undefined {
        return this._tokens[this._i];
    }

    private _isOp(v: string, at = this._i): boolean {
        const t = this._tokens[at];
        return t?.t === 'op' && t.v === v;
    }

    private _enter(): void {
        if (++this._depth > MAX_DEPTH)
            fail('too deep');
    }

    private _leave(): void {
        this._depth--;
    }

    /** A full expression: every bracket, argument and operand chain recurses through here or _unary. */
    private _expr(): Value {
        this._enter();
        const r = this._bitwise(0);
        this._leave();
        return r;
    }

    private _bitwise(level: number): Value {
        if (level === BIT_LEVELS.length)
            return this._sum();
        let left = this._bitwise(level + 1);
        for (;;) {
            const t = this._peek();
            const name = t && t.t !== 'num' ? t.v : '';
            if (!BIT_LEVELS[level].includes(name))
                break;
            this._i++;
            this.operations++;
            const right = this._bitwise(level + 1);
            left = plain(bitwise(name, left.v, right.v));
            check(left.v);
        }
        return left;
    }

    private _sum(): Value {
        let left = this._term();
        for (;;) {
            const t = this._peek();
            if (t?.t !== 'op' || (t.v !== '+' && t.v !== '-'))
                break;
            this._i++;
            this.operations++;
            const right = this._term();
            const rv = right.pct && !left.pct ? left.v * right.v : right.v;
            left = plain(t.v === '+' ? left.v + rv : left.v - rv);
            check(left.v);
        }
        return left;
    }

    /** Which multiplicative operator comes next ('' = implicit multiplication), or null for none. */
    private _termOperator(left: Value): string | null {
        const t = this._peek();
        if (!t || t.t === 'num')
            return null;
        if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%'))
            return t.v;
        if (t.t === 'id') {
            if (t.v === 'mod')
                return '%';
            if ((t.v === 'of' || t.v === 'off') && left.pct)
                return t.v;
        }
        // Implicit multiplication only follows a number or ")"
        const prev = this._tokens[this._i - 1];
        if (prev.t !== 'num' && !(prev.t === 'op' && prev.v === ')'))
            return null;
        const starts = t.t === 'op'
            ? t.v === '(' || t.v === '√' || t.v === '∛'
            : (Object.hasOwn(CONSTANTS, t.v) && t.v !== 'e') || Object.hasOwn(FUNCTIONS, t.v);
        return starts ? '' : null;
    }

    private _term(): Value {
        let left = this._unary();
        for (;;) {
            const op = this._termOperator(left);
            if (op === null)
                break;
            if (op !== '')
                this._i++;
            this.operations++;
            const right = this._unary();
            let v: number;
            if (op === '/')
                v = left.v / right.v;
            else if (op === '%')
                v = left.v % right.v;
            else if (op === 'off')
                v = right.v * (1 - left.v);
            else
                v = left.v * right.v;
            check(v);
            left = plain(v);
        }
        return left;
    }

    private _unary(): Value {
        const t = this._peek();
        if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
            this._i++;
            this._enter();
            const r = this._unary();
            this._leave();
            return plain(t.v === '-' ? -r.v : r.v);
        }
        return this._power();
    }

    private _power(): Value {
        const base = this._postfix();
        if (this._isOp('^')) {
            this._i++;
            this.operations++;
            this._enter();
            const exp = this._unary();
            this._leave();
            const v = Math.pow(base.v, exp.v);
            check(v);
            return plain(v);
        }
        return base;
    }

    private _postfix(): Value {
        let r = this._primary();
        for (;;) {
            const t = this._peek();
            if (!t || t.t === 'num')
                break;
            if (t.t === 'op' && t.v === '%' && this._percentFollows(this._i + 1)) {
                // A % is a percentage when nothing that starts a value follows it.
                r = {v: r.v / 100, pct: true};
            } else if (t.v === '!') {
                r = plain(factorial(r.v));
            } else if (t.v === '°' || (t.t === 'id' && t.v === 'deg' && !this._isOp('(', this._i + 1))) {
                this._i++; // degrees to radians: a unit, so not an operation by itself
                r = plain(r.v * Math.PI / 180);
                continue;
            } else if (t.v === '²' || t.v === '³' || t.v === 'squared' || t.v === 'cubed') {
                r = plain(Math.pow(r.v, t.v === '²' || t.v === 'squared' ? 2 : 3));
            } else {
                break;
            }
            this._i++;
            this.operations++;
            check(r.v);
        }
        return r;
    }

    private _percentFollows(at: number): boolean {
        const n = this._tokens[at];
        if (!n)
            return true;
        if (n.t === 'op')
            return PERCENT_BEFORE_OPS.has(n.v);
        return n.t === 'id' && PERCENT_BEFORE_WORDS.has(n.v);
    }

    private _primary(): Value {
        const t = this._peek();
        if (!t)
            fail('unexpected end');
        this._i++;
        if (t.t === 'num')
            return plain(t.v);
        if (t.t === 'op') {
            if (t.v === '(') {
                const r = this._expr();
                this._close();
                return plain(r.v);
            }
            if (t.v === '√')
                return this._call('sqrt');
            if (t.v === '∛')
                return this._call('cbrt');
        } else if (Object.hasOwn(FUNCTIONS, t.v)) {
            return this._call(t.v);
        } else if (Object.hasOwn(CONSTANTS, t.v)) {
            return plain(CONSTANTS[t.v]);
        }
        return fail('unexpected token');
    }

    private _close(): void {
        if (!this._isOp(')'))
            fail('missing )');
        this._i++;
    }

    /** Arguments of a function whose name was just consumed: a bracketed list or one unary-level operand. */
    private _call(name: string): Value {
        const fn = FUNCTIONS[name];
        const args: number[] = [];
        if (this._isOp('(')) {
            this._i++;
            args.push(this._expr().v);
            while (this._isOp(',')) {
                this._i++;
                args.push(this._expr().v);
            }
            this._close();
        } else {
            // Only where one argument is the whole point: "max 3" or "sum 0" is more likely the start of a name.
            if (fn.max === Infinity)
                fail('function needs (');
            this._enter();
            args.push(this._unary().v);
            this._leave();
        }
        if (args.length < fn.min || args.length > fn.max)
            fail('wrong number of arguments');
        this.operations++;
        const v = fn.f(args);
        check(v);
        return plain(v);
    }
}

const LEADING_WORD = /^\s*([a-zπτφ]+)\s*/i;
const START_WORDS = new Set(['what', 'whats', 'calc', 'calculate']);
const LEADING_NOISE = /^\s*(?:=|(?:what\s+is|what['’]?s|calculate|calc)(?![a-zπτφ\d]))/i;
const TRAILING_NOISE = /\s*[=?]+\s*$/;

/** Cheap rejection (no exception) of a lone word or of a first word that can never start an expression: app names. */
function mayBeCalculation(text: string, loneWordOk: boolean): boolean {
    const m = LEADING_WORD.exec(text);
    if (!m)
        return true;
    if (m[0].length === text.length)
        return loneWordOk; // a lone word is never a calculation ("sin", "pi", "calc"), though pi has a value
    const w = m[1].toLowerCase();
    return Object.hasOwn(FUNCTIONS, w) || Object.hasOwn(CONSTANTS, w) || START_WORDS.has(w);
}

function tidy(text: string): string {
    return text.replace(LEADING_NOISE, '').replace(TRAILING_NOISE, '');
}

function parseText(text: string): Parser & {value: number} {
    if (text.length > MAX_LENGTH)
        fail('too long');
    const parser = new Parser(tokenize(tidy(text)));
    const value = parser.parse();
    check(value);
    return Object.assign(parser, {value});
}

export function evaluate(text: string): number | null {
    if (!mayBeCalculation(text, true))
        return null;
    try {
        return parseText(text).value;
    } catch (e) {
        if (e instanceof CalcError)
            return null;
        if (e instanceof RangeError)
            return null; // a stack overflow can never happen below MAX_DEPTH, but never throw into the UI
        throw e;
    }
}

export function isCalculation(text: string): boolean {
    return calculate(text) !== null;
}

export function calculate(text: string): {value: number; text: string} | null {
    if (!mayBeCalculation(text, false))
        return null;
    try {
        const p = parseText(text);
        // "-5" and "+5" are numbers, not calculations: only the operators the parser counted qualify.
        if (p.operations === 0)
            return null;
        return {value: p.value, text: formatNumber(p.value)};
    } catch (e) {
        if (e instanceof CalcError || e instanceof RangeError)
            return null;
        throw e;
    }
}

export function formatNumber(x: number, digits = 12): string {
    if (!Number.isFinite(x))
        return '';
    const r = Number(x.toPrecision(digits));
    if (r === 0)
        return '0';
    // Whole numbers up to 2^53 are exact in a double: show every digit ("2^40" is 1099511627776, not
    // 1099511627780), unless the difference from the rounded value is small enough to be float noise
    // ("sqrt(2)^2*4e15" is 8000000000000002 in floating point and stays 8000000000000000). Known limit: a real
    // integer within a few units of a round number above 1e15 is still shown rounded.
    if (Number.isInteger(x) && Math.abs(x) <= 2 ** 53 && Math.abs(x - r) > 4 * Number.EPSILON * Math.abs(x))
        return String(x);
    // String() is plain decimal from 1e-7 up to 1e21 and "1.5e+21" outside; both are locale independent.
    return String(r).replace('e+', 'e');
}

const GROUPABLE = /^(-?)(\d{5,})(\.\d*)?$/;

/** Thousands separators (U+00A0) for display; takes a formatNumber() result. */
export function groupDigits(text: string): string {
    const m = GROUPABLE.exec(text);
    if (!m)
        return text;
    return m[1] + m[2].replace(/\B(?=(?:\d{3})+$)/g, ' ') + (m[3] ?? '');
}
