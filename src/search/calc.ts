// Calculator core: a hand-written tokenizer and recursive-descent parser for arithmetic.
// No imports (unit-testable with gjs -m, tests/calc.test.js), no eval / Function / external process.
//
// Grammar (lowest to highest precedence):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%' | 'of') unary)*       '%' here is modulo, 'of' follows a percentage
//   unary   := ('-' | '+') unary | power
//   power   := postfix ('^' unary)?                           right-associative; -2^2 = -(2^2); 2^-1 works
//   postfix := primary '%'*                                   a % followed by the end, ')' or 'of' is a percentage
//   primary := number | constant | function '(' expr ')' | '(' expr ')'
// Percentages: "15% of 80" = 12, "50%" = 0.5, "200 + 10%" = 220 (10 % of 200), "200 - 10%" = 180,
// "10 % 3" = 1 (modulo: the % is followed by a value).
//
// Numbers use "." as the decimal point and have no thousands separator ("1,5" is rejected). An exponent
// is allowed ("4e2", "1.5E-3"). Besides + - * / ^ % the characters × ÷ − · (U+00D7, U+00F7, U+2212, U+00B7)
// and ** (power) are accepted. Constants: pi, e (also π). Functions: sqrt abs round floor ceil sin cos tan ln log
// (log is base 10; trigonometry in radians).
//
// Limits: 200 characters, 64 levels of nesting, 120 tokens; NaN and Infinity are errors (1/0 has no answer).
//
// Public API:
//   evaluate(text): number | null            the value, or null for anything that is not a complete, finite expression
//   isCalculation(text): boolean             true when text is an expression WITH an operator, percentage or function
//                                            (a bare number or constant is not a calculation: "2048" must find apps)
//   calculate(text): {value, text} | null    isCalculation + evaluate + formatNumber; null when not a calculation
//   formatNumber(x, digits = 12): string     `digits` significant digits, no trailing zeros, "." decimal, never
//                                            locale dependent, no floating point noise (0.1+0.2 -> 0.3), no "-0"

export const MAX_LENGTH = 200;
export const MAX_DEPTH = 64;
const MAX_TOKENS = 120;

type Token =
    | {t: 'num'; v: number}
    | {t: 'id'; v: string}
    | {t: 'op'; v: string};

class CalcError extends Error {}

const FUNCTIONS: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    ln: Math.log,
    log: Math.log10,
};

const CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
};

const OPERATOR_ALIASES: Record<string, string> = {
    '×': '*',
    '·': '*',
    '÷': '/',
    '−': '-',
    '–': '-',
    '∕': '/',
};

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[a-zπ]+/i;

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === ' ') {
            i++;
            continue;
        }
        if (out.length >= MAX_TOKENS)
            throw new CalcError('too long');
        const rest = text.slice(i);
        const num = NUMBER.exec(rest);
        if (num) {
            const v = Number(num[0]);
            if (!Number.isFinite(v))
                throw new CalcError('number too large');
            out.push({t: 'num', v});
            i += num[0].length;
            continue;
        }
        const id = IDENT.exec(rest);
        if (id) {
            out.push({t: 'id', v: id[0].toLowerCase()});
            i += id[0].length;
            continue;
        }
        if (rest.startsWith('**')) {
            out.push({t: 'op', v: '^'});
            i += 2;
            continue;
        }
        const op = OPERATOR_ALIASES[c] ?? c;
        if ('+-*/^%()'.includes(op)) {
            out.push({t: 'op', v: op});
            i++;
            continue;
        }
        throw new CalcError(`unexpected character ${c}`);
    }
    return out;
}

interface Value {
    v: number;
    /** The value is a bare percentage literal ("10%"); "200 + 10%" adds 10 % OF 200. */
    pct: boolean;
}

class Parser {
    private _i = 0;
    private _depth = 0;
    /** Operators, percentages and function calls seen (what makes the text a calculation). */
    operations = 0;

    constructor(private readonly _tokens: Token[]) {}

    parse(): number {
        const r = this._expr();
        if (this._i < this._tokens.length)
            throw new CalcError('unexpected token');
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
            throw new CalcError('too deep');
    }

    private _leave(): void {
        this._depth--;
    }

    private _expr(): Value {
        this._enter();
        let left = this._term();
        for (;;) {
            const t = this._peek();
            if (t?.t !== 'op' || (t.v !== '+' && t.v !== '-'))
                break;
            this._i++;
            this.operations++;
            const right = this._term();
            const rv = right.pct ? left.v * right.v : right.v;
            left = {v: t.v === '+' ? left.v + rv : left.v - rv, pct: false};
            check(left.v);
        }
        this._leave();
        return left;
    }

    private _term(): Value {
        let left = this._unary();
        for (;;) {
            const t = this._peek();
            let op: string | null = null;
            if (t?.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%'))
                op = t.v;
            else if (t?.t === 'id' && t.v === 'of' && left.pct)
                op = '*';
            if (!op)
                break;
            this._i++;
            this.operations++;
            const right = this._unary();
            let v: number;
            if (op === '*')
                v = left.v * right.v;
            else if (op === '/')
                v = left.v / right.v;
            else
                v = left.v % right.v;
            check(v);
            left = {v, pct: false};
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
            return {v: t.v === '-' ? -r.v : r.v, pct: false};
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
            return {v, pct: false};
        }
        return base;
    }

    private _postfix(): Value {
        let r = this._primary();
        // A % is a percentage when nothing that starts a value follows it.
        while (this._isOp('%') && this._percentFollows(this._i + 1)) {
            this._i++;
            this.operations++;
            r = {v: r.v / 100, pct: true};
        }
        return r;
    }

    private _percentFollows(at: number): boolean {
        const n = this._tokens[at];
        return !n || (n.t === 'op' && n.v === ')') || (n.t === 'id' && n.v === 'of');
    }

    private _primary(): Value {
        const t = this._peek();
        if (!t)
            throw new CalcError('unexpected end');
        this._i++;
        if (t.t === 'num')
            return {v: t.v, pct: false};
        if (t.t === 'op' && t.v === '(') {
            const r = this._expr();
            if (!this._isOp(')'))
                throw new CalcError('missing )');
            this._i++;
            return {v: r.v, pct: false};
        }
        if (t.t === 'id') {
            if (Object.hasOwn(FUNCTIONS, t.v)) {
                if (!this._isOp('('))
                    throw new CalcError('function needs (');
                this._i++;
                const r = this._expr();
                if (!this._isOp(')'))
                    throw new CalcError('missing )');
                this._i++;
                this.operations++;
                const v = FUNCTIONS[t.v](r.v);
                check(v);
                return {v, pct: false};
            }
            if (Object.hasOwn(CONSTANTS, t.v))
                return {v: CONSTANTS[t.v], pct: false};
        }
        throw new CalcError('unexpected token');
    }
}

function check(v: number): void {
    if (!Number.isFinite(v))
        throw new CalcError('not a finite number');
}

function parseText(text: string): Parser & {value: number} {
    if (text.length > MAX_LENGTH)
        throw new CalcError('too long');
    const parser = new Parser(tokenize(text));
    const value = parser.parse();
    check(value);
    return Object.assign(parser, {value});
}

export function evaluate(text: string): number | null {
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
    // String() is plain decimal from 1e-7 up to 1e21 and "1.5e+21" outside; both are locale independent.
    return String(r).replace('e+', 'e');
}
