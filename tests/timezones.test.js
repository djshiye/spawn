import {listPlaces, timeAnswers} from '../build/search/answers/timezones.js';
import {assert, assertEquals, run, test} from './harness.js';

// 2026-11-21 00:27 UTC (winter) and 2026-07-15 12:00 UTC (summer). The local zone is always injected.
const WINTER = new Date(Date.UTC(2026, 10, 21, 0, 27));
const SUMMER = new Date(Date.UTC(2026, 6, 15, 12, 0));
const SARAJEVO = 'Europe/Sarajevo';

const t = (q, opts = {}) => timeAnswers(q, {now: WINTER, localZone: SARAJEVO, ...opts});
const title = (q, opts) => {
    const r = t(q, opts);
    return r.length ? r[0].title : null;
};

test('current time in a place, several spellings', () => {
    for (const q of ['time in tokyo', 'time tokyo', 'tokyo time', 'Time In Tokyo', '  time   in   tokyo  ', 'what time is it in tokyo',
        'what time is it in Tokyo?', 'current time in tokyo', 'now in tokyo', 'whats the time in tokyo', "what's the time in tokyo"])
        assertEquals(title(q), '09:27 Tokyo', q);
    assertEquals(title('now in nyc'), '19:27 New York');
    assertEquals(title('current time in new york'), '19:27 New York');
    assertEquals(title('what time is it in london'), '00:27 London');
});

test('current time answer shape', () => {
    const [a] = t('time in tokyo');
    assertEquals(t('time in tokyo').length, 1);
    assertEquals(a.id, 'time');
    assertEquals(a.icon, 'preferences-system-time-symbolic');
    assertEquals(a.copy, '09:27');
    assert(a.description.startsWith('Saturday 21 November · '), a.description);
    assert(a.description.includes('UTC+9'), a.description);
    assert(a.description.endsWith(' · 8 hours ahead'), a.description);
});

test('difference to the local zone', () => {
    assert(t('time in new york')[0].description.endsWith('6 hours behind'));
    assert(t('time in berlin')[0].description.endsWith('same time as here'));
    assert(t('time in london')[0].description.endsWith('1 hour behind'));
    assert(t('time in india')[0].description.endsWith('4 h 30 min ahead'), t('time in india')[0].description);
    assert(t('time in kathmandu')[0].description.endsWith('4 h 45 min ahead'));
    assert(t('time in st johns')[0].description.endsWith('4 h 30 min behind'), t('time in st johns')[0].description);
});

test('hour12 option', () => {
    assertEquals(title('time in tokyo', {hour12: true}), '9:27 am Tokyo');
    assertEquals(t('time in tokyo', {hour12: true})[0].copy, '9:27 am');
    assertEquals(title('now in nyc', {hour12: true}), '7:27 pm New York');
    assertEquals(title('3pm london in tokyo', {hour12: true}), '12:00 am Tokyo');
    assertEquals(t('3pm london in tokyo', {hour12: true})[0].description, '3:00 pm London → Tokyo · next day');
    assertEquals(title('noon utc in utc', {hour12: true}), '12:00 pm UTC');
});

test('conversion between two places, winter', () => {
    const [a] = t('3pm london in tokyo');
    assertEquals(a.title, '00:00 Tokyo');
    assertEquals(a.copy, '00:00');
    assertEquals(a.description, '15:00 London → Tokyo · next day');
    assertEquals(a.id, 'time');
    assertEquals(t('15:30 utc to sarajevo')[0].title, '16:30 Sarajevo');
    assertEquals(t('15:30 utc to sarajevo')[0].description, '15:30 UTC → Sarajevo');
    assertEquals(t('3:30 pm new york in berlin')[0].title, '21:30 Berlin');
    assertEquals(t('3:30pm new york in berlin')[0].description, '15:30 New York → Berlin');
});

test('conversion respects DST of the source date', () => {
    const s = q => timeAnswers(q, {now: SUMMER, localZone: SARAJEVO});
    // July: London is on BST (UTC+1), Tokyo UTC+9
    assertEquals(s('3pm london in tokyo')[0].title, '23:00 Tokyo');
    assertEquals(s('3pm london in tokyo')[0].description, '15:00 London → Tokyo');
    // July: New York UTC-4, Berlin UTC+2
    assertEquals(s('3pm new york in berlin')[0].title, '21:00 Berlin');
    // November (same places): UTC-5 and UTC+1
    assertEquals(t('3pm new york in berlin')[0].title, '21:00 Berlin');
    assertEquals(s('3pm in london')[0].title, '14:00 London');
    assertEquals(s('time in new york')[0].title, '08:00 New York');
});

test('one place: the other side is the local zone', () => {
    // local = Sarajevo (UTC+1 in November)
    assertEquals(t('3pm in tokyo')[0].title, '23:00 Tokyo');
    assertEquals(t('3pm in tokyo')[0].description, '15:00 your time → Tokyo');
    assertEquals(t('3pm tokyo')[0].title, '07:00 your time');
    assertEquals(t('3pm tokyo')[0].description, '15:00 Tokyo → your time');
    assertEquals(t('3pm tokyo in local')[0].title, '07:00 your time');
    assertEquals(t('3pm tokyo in here')[0].title, '07:00 your time');
    assertEquals(t('3pm tokyo to here')[0].copy, '07:00');
    assertEquals(t('3pm to tokyo')[0].title, '23:00 Tokyo');
});

test('day shifts', () => {
    assert(t('11pm new york in tokyo')[0].description.endsWith(' · next day'));
    assert(t('1am tokyo in new york')[0].description.endsWith(' · previous day'));
    assert(!t('3pm utc in sarajevo')[0].description.includes('day'));
});

test('time forms', () => {
    assertEquals(title('3pm utc in utc'), '15:00 UTC');
    assertEquals(title('3 pm utc in utc'), '15:00 UTC');
    assertEquals(title('3:30pm utc in utc'), '15:30 UTC');
    assertEquals(title('15:30 utc in utc'), '15:30 UTC');
    assertEquals(title('noon utc in tokyo'), '21:00 Tokyo');
    assertEquals(title('midnight utc in tokyo'), '09:00 Tokyo');
    assertEquals(title('12am utc in utc'), '00:00 UTC');
    assertEquals(title('12pm utc in utc'), '12:00 UTC');
    assertEquals(title('9:05 am utc in utc'), '09:05 UTC');
    assertEquals(title('now utc in tokyo'), '09:27 Tokyo');
    assertEquals(title('13pm utc in tokyo'), null);
    assertEquals(title('0pm utc in tokyo'), null);
    assertEquals(title('25:00 utc in tokyo'), null);
    assertEquals(title('10:75 utc in tokyo'), null);
});

test('abbreviations', () => {
    assertEquals(title('time in utc'), '00:27 UTC');
    assertEquals(title('time in gmt'), '00:27 GMT');
    assertEquals(title('time in z'), '00:27 UTC');
    assertEquals(title('time in cet'), '01:27 CET');
    assertEquals(title('time in cest'), '01:27 CEST');
    assertEquals(title('time in est'), '19:27 EST');
    assertEquals(title('time in pst'), '16:27 PST');
    assertEquals(title('time in pt'), '16:27 PT');
    assertEquals(title('time in ist'), '05:57 IST');
    assertEquals(title('time in jst'), '09:27 JST');
    assertEquals(title('time in kst'), '09:27 KST');
    assertEquals(title('time in msk'), '03:27 MSK');
    assertEquals(title('time in hst'), '14:27 HST');
    assertEquals(title('time in aest'), '11:27 AEST');
    assertEquals(title('time in nzdt'), '13:27 NZDT');
    assertEquals(title('time in brt'), '21:27 BRT');
    // an abbreviation follows its region's current rules
    assertEquals(timeAnswers('time in cet', {now: SUMMER, localZone: 'UTC'})[0].title, '14:00 CET');
});

test('fixed offsets', () => {
    assertEquals(title('time in utc+2'), '02:27 UTC+2');
    assertEquals(title('time in gmt-5'), '19:27 UTC-5');
    assertEquals(title('time in utc+5:30'), '05:57 UTC+5:30');
    assertEquals(title('time in utc + 9'), '09:27 UTC+9');
    assertEquals(title('time in utc+0530'), '05:57 UTC+5:30');
    assertEquals(title('time in utc+15'), null);
    assertEquals(title('time in utc+2:75'), null);
    assertEquals(title('3pm utc+2 in utc-5'), '08:00 UTC-5');
    assert(t('time in utc+2')[0].description.includes('UTC+2'));
});

test('IANA names and city parts', () => {
    assertEquals(title('time in europe/sarajevo'), '01:27 Sarajevo');
    assertEquals(title('time in america/new_york'), '19:27 New York');
    assertEquals(title('time in asia/ho_chi_minh'), '07:27 Ho Chi Minh');
    assertEquals(title('time in honolulu'), '14:27 Honolulu');
    assertEquals(title('time in reykjavik'), '00:27 Reykjavik');
    assertEquals(title('time in tegucigalpa'), '18:27 Tegucigalpa');
    assertEquals(title('time in ulan bator'), null);
});

test('diacritics, aliases and case', () => {
    assertEquals(title('time in zürich'), '01:27 Zurich');
    assertEquals(title('time in ZURICH'), '01:27 Zurich');
    assertEquals(title('time in são paulo'), '21:27 Sao Paulo');
    assertEquals(title('time in kraków'), '01:27 Krakow');
    assertEquals(title('time in nyc'), '19:27 New York');
    assertEquals(title('time in la'), '16:27 Los Angeles');
    assertEquals(title('time in sf'), '16:27 San Francisco');
    assertEquals(title('time in dc'), '19:27 Washington DC');
    assertEquals(title('time in washington dc'), '19:27 Washington DC');
    assertEquals(title('time in new york city'), '19:27 New York');
    assertEquals(title('time in ho chi minh'), '07:27 Ho Chi Minh City');
    assertEquals(title('time in kiev'), '02:27 Kyiv');
    assertEquals(title('time in pristina'), '01:27 Pristina');
});

test('countries with a single zone', () => {
    assertEquals(title('time in uk'), '00:27 UK');
    assertEquals(title('time in britain'), '00:27 UK');
    assertEquals(title('time in england'), '00:27 UK');
    assertEquals(title('time in ireland'), '00:27 Ireland');
    assertEquals(title('time in germany'), '01:27 Germany');
    assertEquals(title('time in japan'), '09:27 Japan');
    assertEquals(title('time in india'), '05:57 India');
    assertEquals(title('time in bosnia'), '01:27 Bosnia');
    assertEquals(title('time in croatia'), '01:27 Croatia');
    assertEquals(title('time in serbia'), '01:27 Serbia');
    // several zones: no single answer
    for (const c of ['usa', 'us', 'america', 'russia', 'australia', 'canada', 'brazil', 'mexico', 'indonesia', 'china mainland'])
        assertEquals(title(`time in ${c}`), null, c);
});

test('local and here', () => {
    assertEquals(title('time in local'), '01:27 your time');
    assertEquals(title('time here'), '01:27 your time');
    assert(t('time here')[0].description.endsWith('same time as here'));
    assertEquals(timeAnswers('time in tokyo', {now: WINTER, localZone: 'Asia/Tokyo'})[0].description.endsWith('same time as here'), true);
    assertEquals(timeAnswers('3pm in london', {now: WINTER, localZone: 'America/New_York'})[0].title, '20:00 London');
    assertEquals(timeAnswers('time in tokyo', {now: WINTER, localZone: 'Not/AZone'}), []);
});

test('the place table', () => {
    const list = listPlaces();
    assert(list.length >= 150, `only ${list.length} places`);
    for (const {name, zone} of list) {
        const r = timeAnswers(`time in ${name}`, {now: WINTER, localZone: 'UTC'});
        assertEquals(r.length, 1, `${name} (${zone}) does not resolve`);
    }
    const capitals = ['london', 'dublin', 'lisbon', 'madrid', 'paris', 'brussels', 'amsterdam', 'luxembourg', 'berlin', 'bern',
        'vienna', 'prague', 'bratislava', 'budapest', 'warsaw', 'copenhagen', 'stockholm', 'oslo', 'helsinki', 'reykjavik', 'tallinn',
        'riga', 'vilnius', 'minsk', 'kyiv', 'chisinau', 'bucharest', 'sofia', 'athens', 'rome', 'valletta', 'monaco', 'vaduz',
        'ljubljana', 'zagreb', 'sarajevo', 'belgrade', 'podgorica', 'skopje', 'pristina', 'tirana', 'nicosia', 'moscow', 'ankara'];
    for (const c of capitals)
        assertEquals(timeAnswers(`time in ${c}`, {now: WINTER, localZone: 'UTC'}).length, 1, c);
    for (const c of ['chicago', 'houston', 'denver', 'phoenix', 'seattle', 'miami', 'boston', 'toronto', 'vancouver', 'montreal',
        'cairo', 'lagos', 'nairobi', 'johannesburg', 'dubai', 'riyadh', 'tehran', 'karachi', 'delhi', 'mumbai', 'bangkok',
        'singapore', 'seoul', 'beijing', 'sydney', 'melbourne', 'auckland', 'mexico city', 'buenos aires', 'lima', 'bogota'])
        assertEquals(timeAnswers(`time in ${c}`, {now: WINTER, localZone: 'UTC'}).length, 1, c);
});

test('southern hemisphere and half-hour zones', () => {
    assertEquals(timeAnswers('time in sydney', {now: WINTER, localZone: 'UTC'})[0].title, '11:27 Sydney');
    assertEquals(timeAnswers('time in sydney', {now: SUMMER, localZone: 'UTC'})[0].title, '22:00 Sydney');
    assertEquals(timeAnswers('time in adelaide', {now: SUMMER, localZone: 'UTC'})[0].title, '21:30 Adelaide');
});

test('false positives: nothing recognised', () => {
    for (const q of ['time', 'time in', 'time in atlantis', 'tokyo', '3pm', 'london', 'timeshift', 'time machine', 'now', 'in time',
        '3pm in 3 weeks', '5 km in miles', 'firefox', 'term', 'settings', 'files', 'gnome text editor', '2048', 'steam', 'c', 'calc',
        '', ' ', 'time in tokyo and paris', '3pm london in', '3pm in', 'in tokyo', '10 apples', '3 pm', '5 minutes', 'steam time',
        '100 f in c', '2+2', 'day and night', 'time tracker', 'world clock', 'now playing', '3pm london in tokyo please'])
        assertEquals(t(q), [], q);
    assertEquals(t('time in ' + 'x'.repeat(300)), []);
    assertEquals(timeAnswers('time in tokyo', {now: new Date(NaN), localZone: SARAJEVO}), []);
});

test('defaults do not throw', () => {
    assert(Array.isArray(timeAnswers('time in tokyo')));
    assertEquals(timeAnswers('time in tokyo').length, 1);
    assert(timeAnswers('3pm in tokyo').length === 1);
});

run();
