// Search indexing: the character-mask prefilter never changes a result, typo tolerance finds misspelt
// apps without adding noise to good queries, and rankFields (windows, recent files) matches across fields.
import {catalogue} from '../tools/dev/bench-catalogue.js';
import {candidate, rankApps, rankFields, setPrefilterForTests} from '../build/search/rank.js';
import {SNAPSHOT_QUERIES} from './fixtures/rank-snapshot-queries.js';
import {assert, assertEquals, run, test} from './harness.js';

const items = catalogue(400);
const top = q => rankApps(q, items, 5).map(r => r.item.name);
const ids = q => rankApps(q, items).map(r => `${r.item.id}:${r.score}`);

/** Deterministic pseudo-random numbers (mulberry32), so a failure always reproduces. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Random queries: slices of real names / keys / descriptions, with typos, digits, accents and noise. */
function randomQueries(n, seed) {
    const r = rng(seed);
    const pick = arr => arr[Math.floor(r() * arr.length)];
    const texts = items.flatMap(i => [i.name, ...i.keys, i.description]).filter(Boolean);
    const noise = 'abcdefghijklmnopqrstuvwxyz0123456789 -_.éü+#';
    const out = [];
    for (let k = 0; k < n; k++) {
        let t = pick(texts);
        const start = Math.floor(r() * t.length);
        t = t.slice(start, start + 1 + Math.floor(r() * 10));
        const mode = r();
        if (mode < 0.2 && t.length > 2) { // swap two letters
            const i = Math.floor(r() * (t.length - 1));
            t = t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2);
        } else if (mode < 0.35) { // a wrong / extra letter
            const i = Math.floor(r() * t.length);
            t = t.slice(0, i) + pick(noise) + t.slice(i + (r() < 0.5 ? 1 : 0));
        } else if (mode < 0.45) { // two words
            t = `${t} ${pick(texts).split(' ')[0].slice(0, 5)}`;
        } else if (mode < 0.5) {
            t = t.toUpperCase();
        }
        if (t.trim())
            out.push(t);
    }
    return out;
}

test('the prefilter never changes a result (snapshot queries + 3000 random ones)', () => {
    const queries = [...SNAPSHOT_QUERIES, ...randomQueries(3000, 42)];
    try {
        setPrefilterForTests(false);
        const reference = queries.map(ids);
        setPrefilterForTests(true);
        queries.forEach((q, i) => assertEquals(ids(q), reference[i], `query "${q}"`));
    } finally {
        setPrefilterForTests(true);
    }
});

test('the prefilter never changes rankFields results either', () => {
    const files = items.map(i => ({name: i.name, folder: `~/Documents/${i.keys[0] ?? ''}`}));
    const fieldsOf = f => [{candidate: candidate(f.name), weight: 1}, {candidate: candidate(f.folder), weight: 0.5}];
    const queries = randomQueries(1500, 7);
    try {
        setPrefilterForTests(false);
        const reference = queries.map(q => rankFields(q, files, fieldsOf).map(r => `${r.item.name}:${r.score}`));
        setPrefilterForTests(true);
        queries.forEach((q, i) => assertEquals(rankFields(q, files, fieldsOf).map(r => `${r.item.name}:${r.score}`), reference[i], `query "${q}"`));
    } finally {
        setPrefilterForTests(true);
    }
});

test('typos: swapped, wrong, missing and extra letters find the app', () => {
    const cases = {
        dsicord: 'Discord', obsidain: 'Obsidian', thunderbrid: 'Thunderbird', stema: 'Steam', // swapped
        calculater: 'Calculator', settinfs: 'Settings', // wrong
        teminal: 'Terminal', firfox: 'Firefox', libreofice: 'LibreOffice Writer', // missing
        steeam: 'Steam', spotifyy: 'Spotify', // extra
    };
    for (const [q, want] of Object.entries(cases))
        assertEquals(top(q)[0], want, `query "${q}"`);
});

test('typos: a multi-word query forgives one typo per word', () => {
    assertEquals(top('text edtor')[0], 'Text Editor');
    assertEquals(top('sytem monitr')[0], 'System Monitor');
});

test('typos: score in their own band, below every real substring match', () => {
    const [hit] = rankApps('dsicord', items);
    assert(hit.score >= 382 && hit.score < 400, `typo score ${hit.score}`);
});

test('typos: never for short terms, a 4-letter term only forgives a swap, the first letter must be right', () => {
    assertEquals(top('gimo').includes('GIMP'), false, '4 letters: a wrong letter is not forgiven');
    assertEquals(top('gmip')[0], 'GIMP', '4 letters: a swap is');
    assertEquals(top('setam')[0], 'Steam', 'a swap in the middle');
    assertEquals(top('tseam')[0], 'Steam', 'first two letters swapped');
    assertEquals(top('xteam').includes('Steam'), false, 'wrong first letter');
    assertEquals(top('ste').includes('Steam'), true, 'a real prefix still matches');
    assertEquals(top('dsi').includes('Discord'), false, 'three letters: no typo pass');
});

test('typos never add results to a query that already matches well', () => {
    for (const q of ['code', 'term', 'photo', 'music', 'steam', 'files', 'web', 'calc', 'mail', 'gimp'])
        assertEquals(ids(q).every(s => Number(s.split(':').pop()) >= 400 || Number(s.split(':').pop()) <= 380), true, `query "${q}"`);
});

test('rankFields: best weighted field wins, terms may be spread over fields', () => {
    const windows = [
        {title: 'Pull requests · GitHub', app: 'Firefox'},
        {title: 'Inbox (3) - Mail', app: 'Thunderbird'},
        {title: 'firefox.js - Code', app: 'Visual Studio Code'},
    ];
    const fieldsOf = w => [{candidate: candidate(w.title), weight: 1}, {candidate: candidate(w.app), weight: 0.8}];
    const rank = q => rankFields(q, windows, fieldsOf).map(r => r.item.app);
    assertEquals(rank('firefox github'), ['Firefox']);
    assertEquals(rank('firefox')[0], 'Visual Studio Code', 'a title match beats an app-name match');
    assertEquals(rank('inbox'), ['Thunderbird']);
    assertEquals(rank('zzz'), []);
});

test('rankFields: a folder match ranks below any file named like the query, ties keep the given order', () => {
    const files = [
        {name: 'march.pdf', folder: '~/Documents/Invoices'},
        {name: 'invoices-2026.ods', folder: '~/Documents'},
        {name: 'april.pdf', folder: '~/Documents/Invoices'},
    ];
    const fieldsOf = f => [{candidate: candidate(f.name), weight: 1}, {candidate: candidate(f.folder), weight: 0.5}];
    const rank = q => rankFields(q, files, fieldsOf).map(r => r.item.name);
    assertEquals(rank('invoices'), ['invoices-2026.ods', 'march.pdf', 'april.pdf']);
    assertEquals(rank('invoices march'), ['march.pdf']);
    assertEquals(rank('pdf'), ['march.pdf', 'april.pdf']);
});

run();
