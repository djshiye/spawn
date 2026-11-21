/* global TextDecoder */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseCharQuery, parseCharacters, searchCharacters} from '../build/search/answers/characters.js';
import {assert, assertEquals, run, test} from './harness.js';

const FIXTURE = [
    '# comment line',
    '😀\te\tgrinning face\tcheerful happy laugh smile',
    '😄\te\tgrinning face with smiling eyes\thappy laugh mouth open smile',
    '🙂\te\tslightly smiling face\thappy smile',
    '😊\te\tsmiling face with smiling eyes\tblush happy',
    '👍\te\tthumbs up\t+1 hand like',
    '🇧🇦\te\tflag: bosnia & herzegovina\tflag',
    '🧑‍🍳\te\tcook\tchef',
    '→\tc\trightwards arrow\tright',
    '←\tc\tleftwards arrow\tleft',
    '€\tc\teuro sign\teuro eur',
    'é\tc\tlatin small letter e with acute\t',
    '',
].join('\n');

const db = parseCharacters(FIXTURE);
const find = (q, limit = 10, d = db) => {
    const p = parseCharQuery(q);
    assert(p, `no parse: ${q}`);
    return searchCharacters(d, p, limit);
};

test('parseCharacters', () => {
    assertEquals(db.length, 11);
    assertEquals(db[0], {glyph: '😀', kind: 'e', name: 'grinning face', keywords: 'cheerful happy laugh smile'});
    assertEquals(db[10].keywords, '');
    assertEquals(parseCharacters('# only\n\nbad line\nx\tz\tname\tk\n'), []);
});

test('parseCharQuery forms', () => {
    assertEquals(parseCharQuery('emoji smile'), {kind: 'e', terms: ['smile']});
    assertEquals(parseCharQuery('Emoji Party Popper'), {kind: 'e', terms: ['party', 'popper']});
    for (const k of ['char', 'character', 'symbol', 'sym', 'unicode', 'chars', 'symbols'])
        assertEquals(parseCharQuery(`${k} arrow`), {kind: 'c', terms: ['arrow']}, k);
    assertEquals(parseCharQuery('emoji flag bosnia & herzegovina').terms, ['flag', 'bosnia', 'herzegovina']);
    assertEquals(parseCharQuery('char café').terms, ['cafe']);
    assertEquals(parseCharQuery('U+2192'), {kind: 'any', terms: [], codePoint: 0x2192});
    assertEquals(parseCharQuery('u+1f600').codePoint, 0x1f600);
    assertEquals(parseCharQuery('unicode 2192').codePoint, 0x2192);
    assertEquals(parseCharQuery('unicode u+2192').codePoint, 0x2192);
    assertEquals(parseCharQuery('u+10ffff').codePoint, 0x10ffff);
    assertEquals(parseCharQuery('emoji a smile').terms, ['a', 'smile']);
});

test('parseCharQuery rejects ordinary queries', () => {
    for (const q of ['emoji', 'emoji ', 'char', 'characters', 'character map', 'symbol', 'symbols', 'unicode', 'emote',
        'firefox', 'u+', 'u+zzzz', 'u+110000', 'charm', 'symbolic', 'emoji x', '', 'e', 'steam', 'term', 'settings',
        'emoji   ', 'symbol a', 'unicode  '])
        assertEquals(parseCharQuery(q), null, JSON.stringify(q));
    assertEquals(parseCharQuery(`emoji ${'a'.repeat(200)}`), null);
});

test('search ranking on the fixture', () => {
    const r = find('emoji smile');
    assertEquals(r.map(a => a.copy), ['😄', '🙂', '😊', '😀']); // smiling forms first, keyword-only last
    assertEquals(r[0].score, 840);
    assertEquals(find('emoji grinning face')[0].copy, '😀');
    assertEquals(find('emoji grinning face')[0].score, 845);
    assertEquals(find('emoji grinning face')[1].score, 840);
    assertEquals(find('emoji smile', 2).length, 2);
});

test('answer shape', () => {
    const a = find('emoji grinning face with smiling')[0];
    assertEquals(a.id, '1f604');
    assertEquals(a.title, 'Grinning face with smiling eyes');
    assertEquals(a.copy, '😄');
    assertEquals(a.glyph, '😄');
    assertEquals(a.description, 'Emoji · U+1F604');
    assertEquals(a.icon, 'preferences-desktop-font-symbolic');
    const f = find('emoji bosnia')[0];
    assertEquals(f.id, '1f1e7-1f1e6');
    assertEquals(f.description, 'Emoji · U+1F1E7 U+1F1E6');
    const c = find('emoji chef')[0];
    assertEquals(c.description, 'Emoji · U+1F9D1 U+200D U+1F373');
    assertEquals(find('char euro')[0].description, 'Character · U+20AC');
    assertEquals(find('char arrow right')[0].copy, '→');
    assertEquals(find('char arrow').map(a => a.copy), ['→', '←']);
});

test('long sequences are cut after four code points', () => {
    const long = parseCharacters('👩‍👩‍👧‍👦\te\tfamily\t');
    const a = find('emoji family', 5, long)[0];
    assertEquals(a.description, 'Emoji · U+1F469 U+200D U+1F469 U+200D …');
});

test('kinds are separated, diacritics folded', () => {
    assertEquals(find('char smile'), []);
    assertEquals(find('emoji arrow'), []);
    assertEquals(find('char e acute').map(a => a.copy), ['é']);
    assertEquals(find('char ACUTE')[0].copy, 'é');
    assertEquals(find('char euro').length, 1);
});

test('code point lookups', () => {
    let a = searchCharacters(db, parseCharQuery('U+2192'), 5);
    assertEquals(a.length, 1);
    assertEquals(a[0].title, 'Rightwards arrow');
    assertEquals(a[0].glyph, '→');
    a = searchCharacters(db, parseCharQuery('u+2603'), 5);
    assertEquals(a[0].title, 'U+2603');
    assertEquals(a[0].copy, '☃');
    assertEquals(a[0].description, 'Character · U+2603');
    assertEquals(a[0].id, '2603');
    assertEquals(searchCharacters(db, parseCharQuery('u+d800'), 5), []);
    assertEquals(searchCharacters(db, parseCharQuery('u+0007'), 5), []);
    assertEquals(searchCharacters(db, parseCharQuery('u+85'), 5), []);
    assertEquals(searchCharacters(db, parseCharQuery('u+1f600'), 5)[0].title, 'Grinning face');
});

test('limit', () => {
    assertEquals(searchCharacters(db, parseCharQuery('emoji smile'), 0), []);
    assertEquals(searchCharacters(db, parseCharQuery('emoji smile'), 1).length, 1);
});

// ---- the real data -------------------------------------------------------------------------------------------

function readData() {
    const dir = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
    const [, bytes] = Gio.File.new_for_path(GLib.build_filenamev([dir, 'data', 'characters.tsv'])).load_contents(null);
    return new TextDecoder().decode(bytes);
}

const real = parseCharacters(readData());
const q = s => searchCharacters(real, parseCharQuery(s), 20);

test('real data: size and uniqueness', () => {
    assert(real.length > 2500, `${real.length} entries`);
    assertEquals(new Set(real.map(e => e.glyph)).size, real.length);
    assert(real.every(e => e.name === e.name.toLowerCase() && e.name.length > 0));
    assert(real.some(e => e.kind === 'e') && real.some(e => e.kind === 'c'));
});

test('real data: emoji searches', () => {
    const smile = q('emoji smile');
    assert(smile.length > 5);
    assert(/smil/i.test(smile[0].title) && smile[0].copy.length > 0, smile[0].title);
    assert(smile.slice(0, 3).every(a => /face/i.test(a.title)), smile.slice(0, 3).map(a => a.title).join());
    assert(q('emoji flag bosnia').some(a => a.copy === '🇧🇦'));
    assert(q('emoji thumbs up').some(a => a.copy === '👍'));
    assert(q('emoji party popper').some(a => a.copy === '🎉'));
    assertEquals(q('emoji grinning face')[0].title, 'Grinning face');
    assertEquals(q('emoji grinning face')[0].score, 845);
});

test('real data: character searches', () => {
    assert(q('char arrow right').some(a => a.copy === '→'));
    assert(q('char euro').some(a => a.copy === '€'));
    assert(q('char em dash').some(a => a.copy === '—'));
    assert(q('char degree').some(a => a.copy === '°'));
    assert(q('symbol pi').some(a => a.copy === 'π'));
    // ✓ (U+2713 check mark) is a plain character in the data; ✔ (U+2714) is an emoji, so a 'c' search finds ✓.
    assert(q('char tick').some(a => a.copy === '✓'));
    assert(q('char copyright').some(a => a.copy === '©'));
    assert(q('char infinity').some(a => a.copy === '∞'));
    assert(q('char ellipsis').some(a => a.copy === '…'));
    assert(q('char e acute').some(a => a.copy === 'é'));
    assertEquals(q('u+2192')[0].title, 'Rightwards arrow');
});

test('real data: search is fast', () => {
    for (const s of ['emoji smile', 'char arrow']) {
        const p = parseCharQuery(s);
        searchCharacters(real, p, 20); // builds the lazy haystacks
        const n = 200;
        const t0 = GLib.get_monotonic_time();
        for (let i = 0; i < n; i++)
            searchCharacters(real, p, 20);
        const us = (GLib.get_monotonic_time() - t0) / n;
        print(`    ${s}: ${us.toFixed(1)} us/search`);
        assert(us < 1000, `${s}: ${us} us`);
    }
});

test('parseCharQuery is cheap for ordinary queries', () => {
    const qs = ['firefox', 'term', 'settings', 'files', 'gnome text editor', '2048', 'steam', 'c', 'calc'];
    const n = 200000;
    const t0 = GLib.get_monotonic_time();
    for (let i = 0; i < n; i++)
        parseCharQuery(qs[i % qs.length]);
    const ns = (GLib.get_monotonic_time() - t0) * 1000 / n;
    print(`    ${ns.toFixed(0)} ns/call`);
    assert(ns < 2000, `${ns} ns/call`);
});

run();
