import {dateAnswers} from '../build/search/answers/dates.js';
import {assert, assertEquals, run, test} from './harness.js';

// "Today" is Saturday 21 November 2026, built from local fields so the tests do not depend on the machine's zone.
const NOW = new Date(2026, 10, 21, 12, 0, 0);
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

const d = (q, now = NOW) => dateAnswers(q, {now});
const one = (q, now = NOW) => {
    const r = d(q, now);
    assertEquals(r.length, 1, `${q} gave ${r.length} answers`);
    return r[0];
};
const row = (q, now) => {
    const a = one(q, now);
    return [a.id, a.title, a.copy, a.description];
};

test('days until', () => {
    assertEquals(row('days until 25 dec'), ['until', '34 days', '34', 'until Friday 25 December 2026 · 4 weeks 6 days']);
    assertEquals(one('days till christmas').title, '34 days');
    assertEquals(one('days to 1 jan 2030').title, '1137 days');
    assertEquals(one('days to 1 jan 2030').description, 'until Tuesday 1 January 2030 · 162 weeks 3 days');
    assertEquals(one('how many days until easter').title, '127 days');
    assertEquals(one('how many days until easter').description, 'until Sunday 28 March 2027 · 18 weeks 1 day');
    assertEquals(one('how long until 25/12').title, '34 days');
    assertEquals(one('until christmas').title, '34 days');
    assertEquals(one('until christmas').id, 'until');
    assertEquals(one('days until 27 nov').description, 'until Friday 27 November 2026');
    assertEquals(one('days until 22 nov').title, '1 day');
    assertEquals(one('days until tomorrow').title, '1 day');
    assertEquals(one('days until 21 nov').title, 'Today');
    assertEquals(one('days until 21 nov').copy, '0');
    assertEquals(one('days until today').title, 'Today');
    assertEquals(one('days until 1 jan').title, '41 days');
    assertEquals(one('days until 20 nov').title, '364 days');
    assertEquals(one('days until friday').title, '6 days');
    assertEquals(one('days until next friday').title, '6 days');
    assertEquals(one('days until saturday').title, 'Today');
    assertEquals(one('days until 5 jan 2100').title, '26\u00a0708 days');
    assertEquals(one('days until 5 jan 2100').copy, '26708');
});

test('weeks until', () => {
    assertEquals(row('weeks until 25 dec'), ['until', '4 weeks 6 days', '34', 'until Friday 25 December 2026 · 34 days']);
    assertEquals(one('weeks until 28 nov').title, '1 week');
    assertEquals(one('weeks until 28 nov').description, 'until Saturday 28 November 2026 · 7 days');
    assertEquals(one('weeks until 24 nov').title, '3 days');
    assertEquals(one('weeks until 21 nov').title, 'Today');
});

test('an explicit past date in an until form', () => {
    const a = one('days until 1 jan 2026');
    assertEquals(a.title, '324 days ago');
    assertEquals(a.copy, '-324');
});

test('until: a yearless date is the next occurrence, today counts', () => {
    assertEquals(one('days until 21 nov').title, 'Today');
    assertEquals(one('days until 20 nov').title, '364 days');
    assertEquals(one('days until 29 feb').title, '465 days'); // 29 Feb 2028
    assertEquals(one('days until christmas', at(2026, 12, 25)).title, 'Today');
    assertEquals(one('days until christmas', at(2026, 12, 26)).title, '364 days');
    assertEquals(one('days until easter', at(2026, 4, 6)).title, '356 days');
});

test('days since', () => {
    const now = at(2025, 11, 21);
    assertEquals(row('days since 1 jan 2020', now),
        ['since', '2151 days', '2151', 'since Wednesday 1 January 2020 · 5 years 10 months 20 days']);
    assertEquals(one('how long since 25/12/2020', now).id, 'since');
    assertEquals(one('how long since 25/12/2020', now).title, '1792 days');
    assertEquals(one('days since 1 jan 2000').title, '9 821 days'.replace('9 821', '9821'));
    assertEquals(one('days since 1 jan 1900').title, '46\u00a0345 days');
    assertEquals(one('days since 1 jan 1900').copy, '46345');
    assertEquals(one('days since 20 nov 2026').title, '1 day');
    assertEquals(one('days since 21 nov 2026').title, 'Today');
    assertEquals(one('days since 1 jan 2026').description, 'since Thursday 1 January 2026 · 10 months 20 days');
    assertEquals(one('days since 31 jan 2026').description, 'since Saturday 31 January 2026 · 9 months 21 days');
    assertEquals(one('weeks since 1 nov 2026').title, '2 weeks 6 days');
});

test('since: a yearless date is the most recent occurrence, today counts', () => {
    assertEquals(one('days since 1 jan').title, '324 days');
    assertEquals(one('days since 21 nov').title, 'Today');
    assertEquals(one('days since 22 nov').title, '364 days');
    assertEquals(one('days since christmas').title, '331 days');
    assertEquals(one('days since 29 feb').title, '996 days'); // 29 Feb 2024
});

test('since a future date: no answer', () => {
    assertEquals(d('days since 1 jan 2030'), []);
});

test('days between', () => {
    assertEquals(row('days between 1 mar and 25 dec'),
        ['between', '299 days', '299', 'Sunday 1 March 2026 → Friday 25 December 2026 · 42 weeks 5 days']);
    assertEquals(one('from 1 mar to 25 dec').title, '299 days');
    assertEquals(one('1 mar 2026 to 25 dec 2026').title, '299 days');
    assertEquals(one('1 mar 2026 to 25 dec 2026').id, 'between');
    assertEquals(one('how many days between 1 mar and 25 dec').title, '299 days');
    assertEquals(one('25 dec 2026 - 1 mar 2026').title, '299 days');
    assertEquals(one('25 dec 2026 - 1 mar 2026').description, 'Friday 25 December 2026 → Sunday 1 March 2026 · 42 weeks 5 days');
    assertEquals(one('2026-03-01 to 2026-03-04').title, '3 days');
    assertEquals(one('2026-03-01 to 2026-03-04').description, 'Sunday 1 March 2026 → Wednesday 4 March 2026');
    assertEquals(one('1 jan 2026 to 1 jan 2026').title, '0 days');
    assertEquals(one('1 jan 2026 to 2 jan 2026').title, '1 day');
    assertEquals(one('1 jan 1900 to 1 jan 2026').title, '46\u00a0021 days');
    assertEquals(one('days between today and christmas').title, '34 days');
    assertEquals(one('from 1 mar until 25 dec').title, '299 days');
});

test('date arithmetic', () => {
    assertEquals(row('today + 90 days'), ['date', 'Friday 19 February 2027', '19 February 2027', 'today + 90 days']);
    assertEquals(one('today plus 3 weeks').title, 'Saturday 12 December 2026');
    assertEquals(one('today plus 3 weeks').description, 'today + 3 weeks');
    assertEquals(one('today+90 days').title, 'Friday 19 February 2027');
    assertEquals(row('25 dec 2026 - 3 weeks'), ['date', 'Friday 4 December 2026', '4 December 2026', '25 December 2026 - 3 weeks']);
    assertEquals(one('25 dec 2026 minus 3 weeks').title, 'Friday 4 December 2026');
    assertEquals(one('tomorrow + 2 months').title, 'Friday 22 January 2027');
    assertEquals(one('tomorrow + 2 months').description, 'tomorrow + 2 months');
    assertEquals(one('90 days from today').title, 'Friday 19 February 2027');
    assertEquals(one('90 days from today').description, 'today + 90 days');
    assertEquals(one('3 weeks from now').title, 'Saturday 12 December 2026');
    assertEquals(one('3 weeks from now').description, 'today + 3 weeks');
    assertEquals(one('2 weeks from 25 dec').title, 'Friday 8 January 2027');
    assertEquals(one('2 weeks from 25 dec').copy, '8 January 2027');
    assertEquals(one('in 3 weeks').title, 'Saturday 12 December 2026');
    assertEquals(one('in 10 days').title, 'Tuesday 1 December 2026');
    assertEquals(one('in 10 days').description, 'today + 10 days');
    assertEquals(one('3 weeks ago').title, 'Saturday 31 October 2026');
    assertEquals(one('3 weeks ago').description, 'today - 3 weeks');
    assertEquals(one('90 days before 25 dec 2026').title, 'Saturday 26 September 2026');
    assertEquals(one('90 days before 25 dec 2026').description, '25 December 2026 - 90 days');
    assertEquals(one('6 months after 1 jan 2027').title, 'Thursday 1 July 2027');
    assertEquals(one('6 months after 1 jan 2027').description, '1 January 2027 + 6 months');
    assertEquals(one('2 fortnights from today').title, 'Saturday 19 December 2026');
    assertEquals(one('1 year ago').title, 'Friday 21 November 2025');
});

test('chained durations', () => {
    assertEquals(row('today + 1 year 2 months 3 days'),
        ['date', 'Monday 24 January 2028', '24 January 2028', 'today + 1 year 2 months 3 days']);
    assertEquals(one('today + 2 weeks + 3 days').title, 'Tuesday 8 December 2026');
    assertEquals(one('today + 2 weeks + 3 days').description, 'today + 2 weeks 3 days');
    assertEquals(one('today + 2 weeks and 3 days').title, 'Tuesday 8 December 2026');
    assertEquals(one('today + 1w 2d').title, 'Monday 30 November 2026');
    assertEquals(one('today + 1yr').title, 'Sunday 21 November 2027');
    assertEquals(one('today + 10 y').title, 'Friday 21 November 2036');
});

test('month and year arithmetic clamps the day', () => {
    assertEquals(one('31 jan 2027 + 1 month').title, 'Sunday 28 February 2027');
    assertEquals(one('31 jan 2028 + 1 month').title, 'Tuesday 29 February 2028');
    assertEquals(one('29 feb 2028 + 1 year').title, 'Wednesday 28 February 2029');
    assertEquals(one('29 feb 2028 - 1 year').title, 'Sunday 28 February 2027');
    assertEquals(one('31 mar 2027 - 1 month').title, 'Sunday 28 February 2027');
    assertEquals(one('31 oct 2026 + 4 months').title, 'Sunday 28 February 2027');
    assertEquals(one('1 jan 2027 - 1 month').title, 'Tuesday 1 December 2026');
    assertEquals(one('31 dec 2026 + 2 months').title, 'Sunday 28 February 2027');
});

test('arithmetic is exact across DST changes', () => {
    // 28 March / 31 October 2026 are the European changes, 8 March / 1 November 2026 the US ones
    assertEquals(one('25 mar 2026 + 7 days').title, 'Wednesday 1 April 2026');
    assertEquals(one('25 oct 2026 + 7 days').title, 'Sunday 1 November 2026');
    assertEquals(one('days between 1 mar 2026 and 1 apr 2026').title, '31 days');
    assertEquals(one('days between 25 oct 2026 and 2 nov 2026').title, '8 days');
    assertEquals(one('today + 365 days', at(2026, 3, 1)).title, 'Monday 1 March 2027');
    assertEquals(one('today + 1 days', at(2026, 3, 28)).title, 'Sunday 29 March 2026');
    assertEquals(one('days until 1 apr 2026', at(2026, 3, 1)).title, '31 days');
});

test('a date on its own', () => {
    assertEquals(row('25 dec 2027'), ['date', 'Saturday 25 December 2027', '25 December 2027', 'in 399 days · week 51']);
    assertEquals(one('25/12/2027').title, 'Saturday 25 December 2027');
    assertEquals(one('2027-12-25').title, 'Saturday 25 December 2027');
    assertEquals(one('25.12.2027').title, 'Saturday 25 December 2027');
    assertEquals(one('25-12-2027').title, 'Saturday 25 December 2027');
    assertEquals(one('25th dec 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('dec 25 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('december 25, 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('25 December 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('25 sept 2027').title, 'Saturday 25 September 2027');
    assertEquals(one('25 december').title, 'Friday 25 December 2026');
    assertEquals(one('25 december').description, 'in 34 days · week 52');
    assertEquals(one('dec 25').title, 'Friday 25 December 2026');
    assertEquals(one('1 jan').description, '324 days ago · week 1');
    assertEquals(one('21 nov').description, 'today · week 47');
    assertEquals(one('22 nov 2026').description, 'in 1 day · week 47');
    assertEquals(one('20 nov 2026').description, '1 day ago · week 47');
    assertEquals(one('1 jan 2000').title, 'Saturday 1 January 2000');
    assertEquals(one('29 feb 2028').title, 'Tuesday 29 February 2028');
    assertEquals(one('  25   DEC   2027  ').title, 'Saturday 25 December 2027');
});

test('what day is a date', () => {
    assertEquals(one('what day is 25 dec 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('what day was 1 jan 2000').title, 'Saturday 1 January 2000');
    assertEquals(one('what day was 1 jan 2000').description, '9821 days ago · week 52');
    assertEquals(one('weekday 25/12/2027').title, 'Saturday 25 December 2027');
    assertEquals(one('what day is 25/12/2027').title, 'Saturday 25 December 2027');
    assertEquals(one('what day is it').title, 'Saturday 21 November 2026');
    assertEquals(one('what day is it').description, 'today · week 47');
    assertEquals(one('whats the date').title, 'Saturday 21 November 2026');
    assertEquals(one("today's date").title, 'Saturday 21 November 2026');
    assertEquals(one('what day is christmas').title, 'Friday 25 December 2026');
});

test('relative words and weekdays', () => {
    assertEquals(row('what day is today'), ['date', 'Saturday 21 November 2026', '21 November 2026', 'today · week 47']);
    assertEquals(one('what day is tomorrow').title, 'Sunday 22 November 2026');
    assertEquals(one('what day is yesterday').title, 'Friday 20 November 2026');
    assertEquals(one('next friday').title, 'Friday 27 November 2026');
    assertEquals(one('next saturday').title, 'Saturday 28 November 2026'); // strictly after today
    assertEquals(one('next sunday').title, 'Sunday 22 November 2026');
    assertEquals(one('last friday').title, 'Friday 20 November 2026');
    assertEquals(one('last saturday').title, 'Saturday 14 November 2026');
    assertEquals(one('next mon').title, 'Monday 23 November 2026');
    assertEquals(one('last monday').title, 'Monday 16 November 2026');
    assertEquals(one('next friday').description, 'in 6 days · week 48');
    assertEquals(d('next banana'), []);
});

test('named days', () => {
    assertEquals(one('what day is christmas').title, 'Friday 25 December 2026');
    assertEquals(one('christmas 2027').title, 'Saturday 25 December 2027');
    assertEquals(one('what day is christmas day').title, 'Friday 25 December 2026');
    assertEquals(one('what day is christmas eve').title, 'Thursday 24 December 2026');
    assertEquals(one('what day is boxing day').title, 'Saturday 26 December 2026');
    assertEquals(one('what day is new year').title, 'Thursday 1 January 2026');
    assertEquals(one("what day is new year's day").title, 'Thursday 1 January 2026');
    assertEquals(one("what day is new year's eve").title, 'Thursday 31 December 2026');
    assertEquals(one('new years eve 2027').title, 'Friday 31 December 2027');
    assertEquals(one('what day is halloween').title, 'Saturday 31 October 2026');
    assertEquals(one("what day is valentine's day").title, 'Saturday 14 February 2026');
    assertEquals(one('what day is valentines').title, 'Saturday 14 February 2026');
    assertEquals(one('days until halloween').title, '344 days');
    assertEquals(one('days until new years eve').title, '40 days');
});

test('easter', () => {
    assertEquals(one('easter 2024').copy, '31 March 2024');
    assertEquals(one('easter 2025').copy, '20 April 2025');
    assertEquals(one('easter 2026').copy, '5 April 2026');
    assertEquals(one('easter 2027').title, 'Sunday 28 March 2027');
    assertEquals(one('easter 2027').description, 'in 127 days · week 12');
    assertEquals(one('easter 2038').copy, '25 April 2038');
    assertEquals(one('easter 2019').copy, '21 April 2019');
    assertEquals(one('easter 1961').copy, '2 April 1961');
    assertEquals(one('what day is easter').copy, '5 April 2026');
    assertEquals(one('easter sunday 2027').copy, '28 March 2027');
    assertEquals(one('days since easter').title, '230 days');
});

test('invalid dates give no answer', () => {
    for (const q of ['31/02/2026', '31/02', '30 feb 2026', '29 feb 2027', '2026-02-30', '2026-13-01', '32 dec 2026', '0 jan 2026',
        'days until 31/02', 'days until 31 apr', 'days since 31 nov 2020', '25/13/2026', 'easter 0000', '1 mar 2026 to 31 feb 2026',
        'today + 99999999 years', 'week of 31/02/2026'])
        assertEquals(d(q), [], q);
    assertEquals(one('29 feb 2028').title, 'Tuesday 29 February 2028');
});

test('ISO week numbers', () => {
    assertEquals(row('week number'), ['week', 'Week 47', '47', 'Monday 16 – Sunday 22 November 2026']);
    for (const q of ['week no', 'current week', 'what week is it', 'week number', 'current week number', "what's the week number"])
        assertEquals(one(q).title, 'Week 47', q);
    assertEquals(row('week of 25 dec'), ['week', 'Week 52', '52', 'Monday 21 – Sunday 27 December 2026']);
    assertEquals(one('week number 25/12/2026').title, 'Week 52');
    assertEquals(one('week of 1 jan 2027').title, 'Week 53');
    assertEquals(one('week of 1 jan 2027').description, 'Monday 28 December 2026 – Sunday 3 January 2027');
    assertEquals(one('week of 4 jan 2027').title, 'Week 1');
    assertEquals(one('week of 30 nov 2026').description, 'Monday 30 November – Sunday 6 December 2026');
    assertEquals(one('week of 1 jan 2021').title, 'Week 53');
    assertEquals(one('week of 31 dec 2024').title, 'Week 1');
    assertEquals(one('week of 29 dec 2025').title, 'Week 1');
    assertEquals(one('week of 28 dec 2025').title, 'Week 52');
    assertEquals(one('week of 1 jan 2016').title, 'Week 53');
    assertEquals(one('week of 2 jan 2022').title, 'Week 52');
    assertEquals(one('what week is 25 dec').title, 'Week 52');
    assertEquals(one('week number now').title, 'Week 47');
});

test('day of year', () => {
    assertEquals(row('day of year'), ['doy', 'Day 325', '325', 'of 365 · 40 days left in 2026']);
    assertEquals(one('day number').title, 'Day 325');
    assertEquals(one('day of the year').title, 'Day 325');
    assertEquals(row('day of year', at(2028, 12, 31)), ['doy', 'Day 366', '366', 'of 366 · 0 days left in 2028']);
    assertEquals(one('day of year', at(2027, 12, 30)).description, 'of 365 · 1 day left in 2027');
    assertEquals(one('day of year', at(2028, 3, 1)).title, 'Day 61');
});

test('unix time', () => {
    const now = new Date(1700000000123);
    assertEquals(row('unix time', now), ['unix', '1700000000', '1700000000', 'Unix time now']);
    for (const q of ['unix timestamp', 'timestamp', 'epoch', 'unix time', 'epoch time', 'current unix time'])
        assertEquals(one(q, now).title, '1700000000', q);
    assertEquals(row('unix 1700000000'),
        ['unix', 'Tuesday 14 November 2023, 22:13:20 UTC', '2023-11-14T22:13:20Z', 'Unix time 1700000000']);
    assertEquals(one('timestamp 1700000000').title, 'Tuesday 14 November 2023, 22:13:20 UTC');
    assertEquals(one('unix timestamp 1700000000').copy, '2023-11-14T22:13:20Z');
    assertEquals(row('epoch 1700000000000'),
        ['unix', 'Tuesday 14 November 2023, 22:13:20 UTC', '2023-11-14T22:13:20Z', 'Unix time 1700000000000 ms']);
    assertEquals(one('epoch 1700000000123').copy, '2023-11-14T22:13:20.123Z');
    assertEquals(one('unix 0000000000').title, 'Thursday 1 January 1970, 00:00:00 UTC');
    assertEquals(one('unix 999999999').title, 'Sunday 9 September 2001, 01:46:39 UTC');
    assertEquals(one('unix 4102444800').title, 'Friday 1 January 2100, 00:00:00 UTC');
    assertEquals(d('unix 17000000000'), []); // 11 digits: neither seconds nor milliseconds
    assertEquals(d('unix 12345'), []);
    assertEquals(d('unix abc'), []);
});

test('date to unix: local midnight', () => {
    const expected = Math.floor(new Date(2026, 11, 25).getTime() / 1000);
    for (const q of ['25 dec 2026 to unix', 'unix of 25 dec 2026', 'timestamp of 25 dec 2026', '25 dec 2026 as timestamp', '25/12/2026 in epoch']) {
        const a = one(q);
        assertEquals(a.id, 'unix', q);
        assertEquals(a.title, String(expected), q);
        assertEquals(a.copy, String(expected), q);
        assert(a.description.includes('local midnight'), a.description);
        assert(a.description.includes('Friday 25 December 2026'), a.description);
    }
    assertEquals(one('christmas to unix').copy, String(expected));
    assertEquals(d('31/02/2026 to unix'), []);
});

test('icon, one answer, units and punctuation', () => {
    for (const q of ['days until 25 dec', 'today + 90 days', 'week number', 'day of year', 'unix time', 'what day is christmas', 'days since 1 jan 2020'])
        assertEquals(one(q).icon, 'x-office-calendar-symbolic', q);
    assertEquals(one('DAYS UNTIL 25 DEC').title, '34 days');
    assertEquals(one('Days Until Christmas?').title, '34 days');
    assertEquals(one('in 2 d').title, 'Monday 23 November 2026');
    assertEquals(one('in 1 wk').title, 'Saturday 28 November 2026');
    assertEquals(one('in 1 week').title, 'Saturday 28 November 2026');
    assertEquals(one('in 2 yrs').title, 'Tuesday 21 November 2028');
});

test('false positives: nothing recognised', () => {
    for (const q of ['firefox', 'calendar', 'date', 'days', 'week', 'march', 'may', 'friday', 'sun', 'mon', 'sat', 'dec', '1/2', '3-4',
        '12.5', '2048', 'timestamp converter', 'unix shell', 'days gone', 'until dawn', 'from dusk till dawn', 'in', 'ago', '5 km in miles',
        '3pm london in tokyo', 'time in tokyo', '100 f in c', '2+2', 'easter egg', 'new year party', 'christmas tree', 'today', 'tomorrow', 'yesterday', 'christmas', 'easter', 'halloween', 'new year', 'boxing day', 'now', 'term',
        'settings', 'files', 'gnome text editor', 'steam', 'c', 'calc', '', ' ', 'new window', 'last pass', 'next cloud', 'next', 'last',
        'today and tomorrow', 'days until', 'days since', 'weeks', 'week number xyz', 'in 3 weeks time', '3 weeks', '90 days', '25',
        '1 + 1 days', 'unix', 'epoch time converter', 'how many days', 'between', 'from', 'what day', 'weekday',
        'mar', 'march 2027', 'dec 2026', 'sunday', 'monday', 'christmas market', 'easter bunny', 'boxing', 'halloween costume',
        'may 2027 calendar', 'sept', 'in 3 km', 'days until banana', '5 days', 'dec 25 2027 extra', 'day', 'week of', 'week of banana'])
        assertEquals(d(q), [], q);
    assertEquals(d('x'.repeat(300)), []);
    assertEquals(dateAnswers('today', {now: new Date(NaN)}), []);
});

test('defaults do not throw', () => {
    assertEquals(dateAnswers('what day is today').length, 1);
    assertEquals(dateAnswers('unix time').length, 1);
});

run();
