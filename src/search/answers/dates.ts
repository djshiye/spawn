// Calendar answers for the search box: countdowns, date arithmetic, week numbers, Unix time. Pure and offline;
// imports only the Answer type; unit-testable with gjs -m (tests/dates.test.js). All arithmetic is done on
// local calendar dates (year / month / day, never on instants), so daylight saving time cannot cause an off-by-one.
// Output is fixed English (UK) style, independent of the system locale: "Friday 25 December 2026".
//
// Dates accepted wherever a date is expected: today, tomorrow, yesterday, now; "25 dec", "25th december 2026",
// "dec 25", "december 25, 2026"; day first numeric "25/12/2026", "25/12", "25.12.2026", "25-12-2026"; ISO
// "2026-12-25"; weekdays "friday" (on or after today), "next friday", "last friday"; named days christmas,
// christmas eve, boxing day, new year (new year's day), new year's eve, halloween, valentine's day, easter
// (Western), optionally followed by a year. Without a year: "until" forms take the next occurrence (today counts),
// "since" forms the most recent one, everything else the current year. Invalid dates (31/02) give no answer.
//
// Text forms (one Answer each, icon x-office-calendar-symbolic):
//   until    "days until 25 dec", "days till christmas", "weeks until 25 dec", "how long until 25/12",
//            "until christmas"                           id "until",   "34 days" / "4 weeks 6 days" / "Today"
//   since    "days since 1 jan 2020", "how long since 25/12/2020"
//                                                        id "since",   "2151 days", calendar breakdown
//   between  "days between 1 mar and 25 dec", "from 1 mar to 25 dec", "1 mar 2026 to 25 dec 2026", "a - b"
//                                                        id "between", "299 days"
//   shift    "today + 90 days", "25 dec 2026 - 3 weeks", "90 days from today", "3 weeks from now", "in 3 weeks",
//            "3 weeks ago", "90 days before 25 dec", "6 months after 1 jan 2027", "today + 1 year 2 months 3 days"
//            (units day d week w wk month year y yr fortnight; a month / year step clamps the day)
//                                                        id "date",    "Friday 19 February 2027"
//   a date   "25 dec 2027", "25/12/2027", "2027-12-25", "25 december", "christmas", "easter 2027", "next friday",
//            "tomorrow", "what day is 25 dec 2027", "weekday 25/12/2027"
//            Not a bare weekday, month, "now" or a numeric pair without a year ("1/2", "12.5").
//                                                        id "date",    "Saturday 25 December 2027"
//   week     "week number", "current week", "what week is it", "week of 25 dec", "week number 25/12/2026"
//            (ISO 8601; a bare "week" is not an answer)  id "week",    "Week 47"
//   day      "day of year", "day number"                id "doy",     "Day 325"
//   unix     "unix time", "timestamp", "epoch"          id "unix",    the current seconds
//            "unix 1700000000", "epoch 1700000000000" (13 digits = ms) -> the date in UTC
//            "25 dec 2026 to unix", "unix of 25 dec 2026" -> seconds at local midnight
//
// Public API:
//   dateAnswers(query, opts?: {now?: Date}): Answer[]

import type {Answer} from './types.js';

const MAX_LENGTH = 120;
const ICON = 'x-office-calendar-symbolic';
const THIN_SPACE = ' ';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
const MONTHS_LOWER = MONTHS.map(m => m.toLowerCase());
const DAYS_LOWER = DAYS.map(d => d.toLowerCase());

// First words that can start a date query; anything else is rejected before any parsing.
const STARTERS = new Set([
    'today', 'tomorrow', 'yesterday', 'now', 'next', 'last', 'days', 'day', 'weeks', 'week', 'how', 'what',
    'whats', 'what\'s', 'which', 'from', 'between', 'in', 'until', 'till', 'christmas', 'xmas', 'boxing', 'new',
    'halloween', 'valentine', 'valentines', 'easter', 'unix', 'timestamp', 'epoch', 'weekday', 'current',
    'todays', 'today\'s', 'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june',
    'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec',
    'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const SINGLES = new Set([
    'today', 'tomorrow', 'yesterday', 'christmas', 'xmas', 'easter', 'halloween', 'valentines', 'epoch', 'timestamp',
]);

const RX_UNIX_NOW = /^(?:current )?(?:unix time|unix time ?stamp|timestamp|epoch|epoch time)(?: now)?$/;
const RX_UNIX_VALUE = /^(?:unix(?: time(?: ?stamp)?)?|timestamp|epoch(?: time)?) (\d{9,13})$/;
const RX_UNIX_OF = /^(?:unix(?: time(?: ?stamp)?)?|timestamp|epoch(?: time)?) (?:of|for) (.+)$/;
const RX_TO_UNIX = /^(.+) (?:to|as|in) (?:unix(?: time(?: ?stamp)?)?|timestamp|epoch)$/;
const RX_WEEK_NOW = /^(?:week (?:number|no|nr)(?: now)?|current week(?: (?:number|no|nr))?|what week(?: number)? is it(?: now)?|(?:whats|what is) the (?:current )?week(?: number)?)$/;
const RX_WEEK_OF = /^(?:week(?: number| no| nr)?(?: of| for)?|what week(?: number)? (?:is|was|will be)(?: on)?) (.+)$/;
const RX_OWN_DATE = /\d|^(?:next|last) /;
const RX_DOY = /^(?:day of (?:the )?year|day number|what day of the year is it)$/;
const RX_TODAY = /^(?:whats the date|what is the date|todays date|what day is it(?: today)?)$/;
const RX_WHAT_DAY = /^(?:what day (?:is|was|will be)(?: it on| on)?|weekday(?: of| for)?|day of (?:the )?week(?: of| for)?|which day (?:is|was)) (.+)$/;
const RX_UNTIL = /^(how (?:many|long) )?(?:(days?|weeks?)(?: (?:left|remaining|to go))? )?(until|till|to) (.+)$/;
const RX_SINCE = /^(?:how (?:many|long) )?(?:(days?|weeks?) )?since (.+)$/;
const RX_BETWEEN = /^(?:(?:how many )?days? )?between (.+?) and (.+)$/;
const RX_FROM_TO = /^(?:(?:how many )?days? )?from (.+?) (?:to|until|till) (.+)$/;
const RX_OP = /^(.+?) (plus|minus|\+|-) (.+)$/;
const RX_OP_TIGHT = /^([^+]+?)\+(.+)$/;
const RX_PAIR = /^(.+?) (?:to|until|till|-) (.+)$/;
const RX_DUR_FROM = /^(.+?) (from|after|before) (.+)$/;
const RX_AGO = /^(.+) ago$/;
const RX_IN = /^in (.+)$/;
const RX_TERM = /(?:(\d{1,6})|an?)\s*(fortnights?|days?|weeks?|wks?|months?|years?|yrs?|d|w|y)(?![a-z])\s*(?:\+|,|and|&)?\s*/y;
const RX_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RX_NUMERIC = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/;
const RX_DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/;
const RX_MONTH_DAY = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/;
const RX_NAMED = /^([a-z ]+?)(?: (\d{4}))?$/;

// ---------------------------------------------------------------------------------------------------------------
// Calendar maths on day numbers (days since 1970-01-01)

function daysFromCivil(year: number, m: number, d: number): number {
    const y = year - (m <= 2 ? 1 : 0);
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): [number, number, number] {
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

function isLeap(y: number): boolean {
    return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
    return m === 2 ? (isLeap(y) ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);
}

function validDate(y: number, m: number, d: number): boolean {
    return y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** 0 = Sunday. */
function weekdayOf(days: number): number {
    return (((days + 4) % 7) + 7) % 7;
}

/** ISO 8601 week number of a day. */
function isoWeek(days: number): number {
    const wd = weekdayOf(days) || 7;
    const thursday = days - wd + 4;
    const year = civilFromDays(thursday)[0];
    return Math.floor((thursday - daysFromCivil(year, 1, 1)) / 7) + 1;
}

/** Western Easter Sunday of a year (anonymous Gregorian algorithm). */
function easterDay(y: number): number {
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return daysFromCivil(y, month, day);
}

/** Add months (clamping the day) and then days. Null when the result leaves years 1..9999. */
function shift(day: number, dur: Duration, sign: number): number | null {
    const [y, m, d] = civilFromDays(day);
    const total = y * 12 + (m - 1) + sign * (dur.years * 12 + dur.months);
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12 + 1;
    if (ny < 1 || ny > 9999)
        return null;
    const result = daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm))) + sign * dur.days;
    const year = civilFromDays(result)[0];
    return year >= 1 && year <= 9999 ? result : null;
}

/** Calendar difference between two days (a <= b) as years, months, days. */
function calendarDiff(a: number, b: number): string {
    const [y1, m1, d1] = civilFromDays(a);
    const [y2, m2, d2] = civilFromDays(b);
    let years = y2 - y1;
    let months = m2 - m1;
    let days = d2 - d1;
    if (days < 0) {
        months--;
        const pm = m2 === 1 ? 12 : m2 - 1;
        days += daysInMonth(m2 === 1 ? y2 - 1 : y2, pm);
    }
    if (months < 0) {
        years--;
        months += 12;
    }
    return joinParts([[years, 'year'], [months, 'month'], [days, 'day']]);
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting

function plural(n: number, unit: string): string {
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function joinParts(parts: Array<[number, string]>): string {
    return parts.filter(p => p[0] > 0).map(p => plural(p[0], p[1])).join(' ');
}

function weeksText(n: number): string {
    return joinParts([[Math.floor(n / 7), 'week'], [n % 7, 'day']]);
}

function fmtInt(n: number): string {
    const s = String(n);
    return n >= 10000 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE) : s;
}

function fmtLong(day: number): string {
    const [y, m, d] = civilFromDays(day);
    return `${DAYS[weekdayOf(day)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

function fmtShort(day: number): string {
    const [y, m, d] = civilFromDays(day);
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function answer(id: string, title: string, copy: string, description: string): Answer {
    return {id, title, copy, description, icon: ICON};
}

function dateAnswer(day: number, today: number, description?: string): Answer {
    let rel: string;
    const diff = day - today;
    if (diff === 0)
        rel = 'today';
    else
        rel = diff > 0 ? `in ${plural(diff, 'day')}` : `${plural(-diff, 'day')} ago`;
    return answer('date', fmtLong(day), fmtShort(day), description ?? `${rel} · week ${isoWeek(day)}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing dates

type Mode = 'until' | 'since' | 'default';

interface DateSpec {
    /** Day number, or null when the date does not exist. */
    resolve(mode: Mode, today: number): number | null;
    /** May the date be an answer on its own? */
    standalone: boolean;
    /** Text for descriptions; '' = format the resolved date. */
    label: string;
}

function monthOf(word: string): number {
    for (let i = 0; i < 12; i++) {
        const full = MONTHS_LOWER[i];
        if (word === full || word === full.slice(0, 3) || (i === 8 && word === 'sept'))
            return i + 1;
    }
    return 0;
}

function weekdayIndex(word: string): number {
    for (let i = 0; i < 7; i++) {
        const full = DAYS_LOWER[i];
        if (word === full || word === full.slice(0, 3) || (i === 2 && word === 'tues') ||
            (i === 4 && (word === 'thur' || word === 'thurs')))
            return i;
    }
    return -1;
}

/** A date that recurs every year: `make(year)` gives its day number or null. */
function recurring(year: number | null, standalone: boolean, make: (y: number) => number | null): DateSpec {
    return {
        standalone,
        label: '',
        resolve(mode, today) {
            if (year !== null)
                return make(year);
            const ty = civilFromDays(today)[0];
            if (mode === 'default')
                return make(ty);
            for (let k = 0; k < 9; k++) {
                const c = make(mode === 'until' ? ty + k : ty - k);
                if (c !== null && (mode === 'until' ? c >= today : c <= today))
                    return c;
            }
            return null;
        },
    };
}

function fixedDay(year: number | null, m: number, d: number, standalone: boolean): DateSpec | null {
    if (year !== null && !validDate(year, m, d))
        return null;
    if (m < 1 || m > 12 || d < 1 || d > 31)
        return null;
    return recurring(year, standalone, y => validDate(y, m, d) ? daysFromCivil(y, m, d) : null);
}

function relative(offset: number, label: string, standalone: boolean): DateSpec {
    return {standalone, label, resolve: (_mode, today) => today + offset};
}

function weekdaySpec(wd: number, dir: 'next' | 'last' | 'on', label: string): DateSpec {
    return {
        standalone: dir !== 'on',
        label,
        resolve(mode, today) {
            const cur = weekdayOf(today);
            if (dir === 'next')
                return today + (((wd - cur + 6) % 7) + 1);
            if (dir === 'last')
                return today - (((cur - wd + 6) % 7) + 1);
            return mode === 'since' ? today - ((cur - wd + 7) % 7) : today + ((wd - cur + 7) % 7);
        },
    };
}

const NAMED: Record<string, [number, number]> = {
    'christmas': [12, 25], 'christmas day': [12, 25], 'xmas': [12, 25], 'christmas eve': [12, 24],
    'boxing day': [12, 26], 'new year': [1, 1], 'new years': [1, 1], 'new year day': [1, 1],
    'new years day': [1, 1], 'new years eve': [12, 31], 'new year eve': [12, 31], 'halloween': [10, 31],
    'valentine': [2, 14], 'valentines': [2, 14], 'valentine day': [2, 14], 'valentines day': [2, 14],
};

function parseDate(s: string): DateSpec | null {
    switch (s) {
        case 'today': return relative(0, 'today', true);
        case 'now': return relative(0, 'today', false);
        case 'tomorrow': return relative(1, 'tomorrow', true);
        case 'yesterday': return relative(-1, 'yesterday', true);
    }
    let m: RegExpExecArray | null;
    if ((m = /^(next|last) ([a-z]+)$/.exec(s))) {
        const wd = weekdayIndex(m[2]);
        return wd < 0 ? null : weekdaySpec(wd, m[1] as 'next' | 'last', s);
    }
    if ((m = RX_ISO.exec(s)))
        return fixedDay(Number(m[1]), Number(m[2]), Number(m[3]), true);
    if ((m = RX_NUMERIC.exec(s)))
        return fixedDay(m[3] ? Number(m[3]) : null, Number(m[2]), Number(m[1]), !!m[3]);
    if ((m = RX_DAY_MONTH.exec(s))) {
        const month = monthOf(m[2]);
        return month ? fixedDay(m[3] ? Number(m[3]) : null, month, Number(m[1]), true) : null;
    }
    if ((m = RX_MONTH_DAY.exec(s))) {
        const month = monthOf(m[1]);
        return month ? fixedDay(m[3] ? Number(m[3]) : null, month, Number(m[2]), true) : null;
    }
    const wd = weekdayIndex(s);
    if (wd >= 0)
        return weekdaySpec(wd, 'on', s);
    if ((m = RX_NAMED.exec(s))) {
        const year = m[2] ? Number(m[2]) : null;
        if (m[1] === 'easter' || m[1] === 'easter sunday')
            return (year === null || year >= 1) ? recurring(year, true, y => y >= 1 && y <= 9999 ? easterDay(y) : null) : null;
        const named = NAMED[m[1]];
        if (named)
            return fixedDay(year, named[0], named[1], true);
    }
    return null;
}

/** A date label for descriptions: the typed word for relative dates, otherwise "25 December 2026". */
function labelOf(spec: DateSpec, day: number): string {
    return spec.label || fmtShort(day);
}

// ---------------------------------------------------------------------------------------------------------------
// Durations

interface Duration {
    years: number;
    months: number;
    days: number;
    /** Normalised text: "1 year 2 months 3 days". */
    text: string;
}

function parseDuration(s: string): Duration | null {
    const dur: Duration = {years: 0, months: 0, days: 0, text: ''};
    const pieces: string[] = [];
    let pos = 0;
    while (pos < s.length) {
        RX_TERM.lastIndex = pos;
        const m = RX_TERM.exec(s);
        if (!m)
            return null;
        pos = RX_TERM.lastIndex;
        const n = m[1] ? Number(m[1]) : 1;
        const unit = m[2];
        let name: string;
        if (unit.startsWith('fortnight')) {
            dur.days += n * 14;
            name = 'fortnight';
        } else if (unit.startsWith('d')) {
            dur.days += n;
            name = 'day';
        } else if (unit.startsWith('w')) {
            dur.days += n * 7;
            name = 'week';
        } else if (unit.startsWith('m')) {
            dur.months += n;
            name = 'month';
        } else {
            dur.years += n;
            name = 'year';
        }
        pieces.push(plural(n, name));
    }
    if (!pieces.length)
        return null;
    dur.text = pieces.join(' ');
    return dur;
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

function untilAnswer(spec: DateSpec, today: number, weeksForm: boolean): Answer[] {
    const target = spec.resolve('until', today);
    if (target === null)
        return [];
    const n = target - today;
    const abs = Math.abs(n);
    const body = weeksForm ? weeksText(abs) || '0 days' : plural(abs, 'day');
    if (n < 0)
        return [answer('until', `${body} ago`, String(n), `was ${fmtLong(target)}`)];
    let description = `until ${fmtLong(target)}`;
    if (weeksForm)
        description += n > 0 ? ` · ${plural(n, 'day')}` : '';
    else if (n >= 7)
        description += ` · ${weeksText(n)}`;
    const title = n === 0 ? 'Today' : weeksForm ? body : `${fmtInt(n)} ${n === 1 ? 'day' : 'days'}`;
    return [answer('until', title, String(n), description)];
}

function sinceAnswer(spec: DateSpec, today: number, weeksForm: boolean): Answer[] {
    const target = spec.resolve('since', today);
    if (target === null || target > today)
        return [];
    const n = today - target;
    const breakdown = calendarDiff(target, today);
    const title = n === 0 ? 'Today' : weeksForm ? weeksText(n) : `${fmtInt(n)} ${n === 1 ? 'day' : 'days'}`;
    return [answer('since', title, String(n), `since ${fmtLong(target)}${breakdown ? ` · ${breakdown}` : ''}`)];
}

function betweenAnswer(a: DateSpec, b: DateSpec, today: number): Answer[] {
    const da = a.resolve('default', today);
    const db = b.resolve('default', today);
    if (da === null || db === null)
        return [];
    const n = Math.abs(db - da);
    const lead = n >= 7 ? ` · ${weeksText(n)}` : '';
    return [answer('between', plural(n, 'day').replace(/^(\d{5,})/, m => fmtInt(Number(m))), String(n),
        `${fmtLong(da)} → ${fmtLong(db)}${lead}`)];
}

function shiftAnswer(spec: DateSpec, dur: Duration, sign: number, today: number): Answer[] {
    const base = spec.resolve('default', today);
    if (base === null)
        return [];
    const result = shift(base, dur, sign);
    if (result === null)
        return [];
    return [dateAnswer(result, today, `${labelOf(spec, base)} ${sign > 0 ? '+' : '-'} ${dur.text}`)];
}

function weekAnswer(day: number): Answer[] {
    const start = day - ((weekdayOf(day) || 7) - 1);
    const end = start + 6;
    const [y1, m1, d1] = civilFromDays(start);
    const [y2, m2, d2] = civilFromDays(end);
    let range: string;
    if (y1 !== y2)
        range = `${fmtLong(start)} – ${fmtLong(end)}`;
    else if (m1 !== m2)
        range = `${DAYS[1]} ${d1} ${MONTHS[m1 - 1]} – ${DAYS[0]} ${d2} ${MONTHS[m2 - 1]} ${y2}`;
    else
        range = `${DAYS[1]} ${d1} – ${DAYS[0]} ${d2} ${MONTHS[m2 - 1]} ${y2}`;
    const week = isoWeek(day);
    return [answer('week', `Week ${week}`, String(week), range)];
}

function unixAnswer(ms: number, label: string): Answer[] {
    if (!(Math.abs(ms) < 253402300800000))
        return [];
    const sec = Math.floor(ms / 1000);
    const frac = ms - sec * 1000;
    const days = Math.floor(sec / 86400);
    const rest = sec - days * 86400;
    const clock = `${pad2(Math.floor(rest / 3600))}:${pad2(Math.floor(rest / 60) % 60)}:${pad2(rest % 60)}`;
    const [y, m, d] = civilFromDays(days);
    const fracText = frac ? `.${String(frac).padStart(3, '0')}` : '';
    const iso = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}T${clock}${fracText}Z`;
    return [answer('unix', `${fmtLong(days)}, ${clock} UTC`, iso, label)];
}

function standalone(spec: DateSpec, today: number, requireStandalone: boolean): Answer[] {
    if (requireStandalone && !spec.standalone)
        return [];
    const day = spec.resolve('default', today);
    return day === null ? [] : [dateAnswer(day, today)];
}

function compute(lower: string, nowDate: Date): Answer[] {
    const text = lower.replace(/['’‘`´]/g, '').replace(/[,?!]/g, ' ').replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
    const today = daysFromCivil(nowDate.getFullYear(), nowDate.getMonth() + 1, nowDate.getDate());
    let m: RegExpExecArray | null;
    let spec: DateSpec | null;

    // Unix time
    if (RX_UNIX_NOW.test(text)) {
        const sec = Math.floor(nowDate.getTime() / 1000);
        return [answer('unix', String(sec), String(sec), 'Unix time now')];
    }
    if ((m = RX_UNIX_VALUE.exec(text))) {
        const ms = m[1].length === 13 ? Number(m[1]) : m[1].length === 10 || m[1].length === 9 ? Number(m[1]) * 1000 : NaN;
        return isNaN(ms) ? [] : unixAnswer(ms, `Unix time ${m[1]}${m[1].length === 13 ? ' ms' : ''}`);
    }
    if ((m = RX_UNIX_OF.exec(text)) || (m = RX_TO_UNIX.exec(text))) {
        spec = parseDate(m[1]);
        const day = spec ? spec.resolve('default', today) : null;
        if (day === null)
            return [];
        const [y, mo, d] = civilFromDays(day);
        const secs = Math.floor(new Date(y, mo - 1, d).getTime() / 1000);
        if (y < 100 || isNaN(secs))
            return [];
        return [answer('unix', String(secs), String(secs), `Unix time at local midnight on ${fmtLong(day)}`)];
    }

    // Week number, day of the year, today
    if (RX_WEEK_NOW.test(text))
        return weekAnswer(today);
    if (RX_DOY.test(text)) {
        const [y] = civilFromDays(today);
        const doy = today - daysFromCivil(y, 1, 1) + 1;
        const total = isLeap(y) ? 366 : 365;
        return [answer('doy', `Day ${doy}`, String(doy), `of ${total} · ${plural(total - doy, 'day')} left in ${y}`)];
    }
    if (RX_TODAY.test(text))
        return [dateAnswer(today, today)];
    if ((m = RX_WEEK_OF.exec(text))) {
        spec = parseDate(m[1]);
        const day = spec ? spec.resolve('default', today) : null;
        return day === null ? [] : weekAnswer(day);
    }
    if ((m = RX_WHAT_DAY.exec(text))) {
        spec = parseDate(m[1]);
        return spec ? standalone(spec, today, false) : [];
    }

    // Countdowns
    if ((m = RX_UNTIL.exec(text)) && (m[3] !== 'to' || m[1] || m[2])) {
        spec = parseDate(m[4]);
        if (spec)
            return untilAnswer(spec, today, !!m[2] && m[2].startsWith('w'));
    }
    if ((m = RX_SINCE.exec(text))) {
        spec = parseDate(m[2]);
        if (spec)
            return sinceAnswer(spec, today, !!m[1] && m[1].startsWith('w'));
    }
    if ((m = RX_BETWEEN.exec(text)) || (m = RX_FROM_TO.exec(text))) {
        const a = parseDate(m[1]);
        const b = parseDate(m[2]);
        if (a && b)
            return betweenAnswer(a, b, today);
    }

    // Date arithmetic
    if ((m = RX_IN.exec(text))) {
        const dur = parseDuration(m[1]);
        if (dur)
            return shiftAnswer(relative(0, 'today', true), dur, 1, today);
    }
    if ((m = RX_AGO.exec(text))) {
        const dur = parseDuration(m[1]);
        if (dur)
            return shiftAnswer(relative(0, 'today', true), dur, -1, today);
    }
    if ((m = RX_DUR_FROM.exec(text))) {
        const dur = parseDuration(m[1]);
        spec = dur ? parseDate(m[3]) : null;
        if (dur && spec)
            return shiftAnswer(spec, dur, m[2] === 'before' ? -1 : 1, today);
    }
    if ((m = RX_OP.exec(text))) {
        spec = parseDate(m[1]);
        const dur = spec ? parseDuration(m[3]) : null;
        if (spec && dur)
            return shiftAnswer(spec, dur, m[2] === '+' || m[2] === 'plus' ? 1 : -1, today);
    }
    if ((m = RX_OP_TIGHT.exec(text))) {
        spec = parseDate(m[1].trim());
        const dur = spec ? parseDuration(m[2].trim()) : null;
        if (spec && dur)
            return shiftAnswer(spec, dur, 1, today);
    }

    // Two dates, or a date on its own
    if ((m = RX_PAIR.exec(text))) {
        const a = parseDate(m[1]);
        const b = a ? parseDate(m[2]) : null;
        if (a && b && a.standalone && b.standalone)
            return betweenAnswer(a, b, today);
    }
    // A date on its own needs a number or "next" / "last": "today", "christmas" or "easter" alone may be the
    // start of a name ("Today", "Christmas Tree"); "what day is christmas" and "days until easter" still answer.
    if (!RX_OWN_DATE.test(text))
        return [];
    spec = parseDate(text);
    return spec ? standalone(spec, today, true) : [];
}

export function dateAnswers(query: string, opts: {now?: Date} = {}): Answer[] {
    if (query.length > MAX_LENGTH || query.length < 4)
        return [];
    const lower = query.trim().toLowerCase();
    const c = lower.charCodeAt(0);
    if (c < 48 || c > 57) {
        // the leading letters (apostrophes ignored) must be a known first word; a lone word must be a known single
        let end = 0;
        while (end < lower.length && ((lower.charCodeAt(end) >= 97 && lower.charCodeAt(end) <= 122) || lower.charCodeAt(end) === 39))
            end++;
        let word = lower.slice(0, end);
        if (word.indexOf('\'') >= 0)
            word = word.replace(/'/g, '');
        if (!STARTERS.has(word) || (end === lower.length && !SINGLES.has(word)))
            return [];
    }
    try {
        const now = opts.now ?? new Date();
        if (isNaN(now.getTime()))
            return [];
        return compute(lower, now);
    } catch {
        return [];
    }
}
