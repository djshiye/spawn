import GLib from 'gi://GLib';
import {toolAnswers} from '../build/search/answers/textTools.js';
import {assert, assertEquals, run, test} from './harness.js';

// A deterministic byte stream: a simple LCG, so tests are repeatable but cover many values.
function makeDeps(seed = 1, fixed = null) {
    let state = seed;
    let pos = 0;
    return {
        randomBytes(n) {
            const out = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
                if (fixed) {
                    out[i] = fixed[pos++ % fixed.length];
                } else {
                    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
                    out[i] = state >>> 16 & 255;
                }
            }
            return out;
        },
        checksum(algorithm, text) {
            return `${algorithm}:${text}`;
        },
    };
}

const ask = (q, deps = makeDeps()) => toolAnswers(q, deps);
const one = (q, deps) => {
    const a = ask(q, deps);
    assertEquals(a.length, 1, `${q} -> ${a.length} answers`);
    return a[0];
};

test('password defaults and shape', () => {
    const a = one('password');
    assertEquals(a.id, 'password');
    assertEquals(a.title.length, 20);
    assertEquals(a.copy, a.title);
    assertEquals(a.description, 'Random password · 20 characters · with symbols');
    assertEquals(a.icon, 'dialog-password-symbolic');
    assertEquals(a.score, 840);
    assertEquals(one('PW').score, 840);
    assertEquals(one('passwd').id, 'password');
});

test('password classes are all present and the alphabet is respected', () => {
    for (let seed = 1; seed < 200; seed++) {
        const p = one('password 8', makeDeps(seed)).title;
        assert(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[!#$%&*+\-=?@^_]/.test(p), p);
        assert(/^[A-Za-z0-9!#$%&*+\-=?@^_]{8}$/.test(p), p);
    }
    for (let seed = 1; seed < 100; seed++) {
        const a = one('password 16 simple', makeDeps(seed));
        assert(/^[A-Za-z0-9]{16}$/.test(a.title), a.title);
        assert(/[a-z]/.test(a.title) && /[A-Z]/.test(a.title) && /[0-9]/.test(a.title));
        assertEquals(a.description, 'Random password · 16 characters · letters and digits');
    }
    assertEquals(one('password 32 letters').title.length, 32);
    assertEquals(one('password 16 no symbols').description, 'Random password · 16 characters · letters and digits');
    const a = one('pw 20');
    assertEquals(a.score, 1000);
    assertEquals(a.title.length, 20);
});

test('password length limits', () => {
    assertEquals(one('password 128').title.length, 128);
    assertEquals(ask('password 7'), []);
    assertEquals(ask('password 129'), []);
    assertEquals(ask('password 0'), []);
    assertEquals(ask('password 1000'), []);
    assertEquals(ask('password 16 weird'), []);
});

test('password uses rejection sampling (no modulo bias)', () => {
    // 255 is rejected for every alphabet size that does not divide 256; the next byte is used instead.
    const deps = makeDeps(1, [255, 0]);
    let used = 0;
    const counting = {...deps, randomBytes(n) { used += n; return deps.randomBytes(n); }};
    ask('pin 3', counting);
    assert(used > 3, 'rejected bytes must be redrawn');
    // distribution check over many digits
    const counts = new Array(10).fill(0);
    const d = makeDeps(7);
    for (let i = 0; i < 3000; i++)
        for (const ch of one('pin 12', d).title) counts[+ch]++;
    const total = counts.reduce((x, y) => x + y, 0);
    for (const c of counts)
        assert(Math.abs(c / total - 0.1) < 0.01, `skewed ${counts}`);
});

test('password only draws from randomBytes and is shuffled', () => {
    // The first class guarantee positions would otherwise sit at the start: check that they move around.
    const firstIsLower = new Set();
    for (let seed = 1; seed < 60; seed++)
        firstIsLower.add(/[a-z]/.test(one('password', makeDeps(seed)).title[0]));
    assertEquals(firstIsLower.size, 2);
});

test('password rejects other words', () => {
    for (const q of ['pass', 'passwords', 'password manager', 'password safe', 'password 24 extra words'])
        assertEquals(ask(q), [], q);
});

test('pin', () => {
    let a = one('pin');
    assertEquals(a.id, 'pin');
    assert(/^\d{4}$/.test(a.title));
    assertEquals(a.description, 'Random PIN · 4 digits');
    assertEquals(a.score, 840);
    a = one('pin 6');
    assert(/^\d{6}$/.test(a.title));
    assertEquals(a.description, 'Random PIN · 6 digits');
    assertEquals(a.score, 1000);
    assertEquals(ask('pin 2'), []);
    assertEquals(ask('pin 13'), []);
    assertEquals(one('pin 12').title.length, 12);
    assertEquals(one('pin 3').title.length, 3);
});

test('uuid', () => {
    for (const q of ['uuid', 'guid', 'UUID']) {
        const a = one(q);
        assertEquals(a.id, 'uuid');
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.title), a.title);
        assertEquals(a.description, 'Random UUID (version 4)');
        assertEquals(a.score, 840);
        assertEquals(a.icon, 'dialog-password-symbolic');
    }
    const fixed = new Uint8Array(16).fill(0xff);
    const a = one('uuid', {randomBytes: () => fixed, checksum: () => ''});
    assertEquals(a.title, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    const z = one('uuid', {randomBytes: () => new Uint8Array(16), checksum: () => ''});
    assertEquals(z.title, '00000000-0000-4000-8000-000000000000');
    assertEquals(ask('uuid foo'), []);
});

test('hashes', () => {
    let a = one('sha256 hello');
    assertEquals(a.id, 'sha256');
    assertEquals(a.title, 'sha256:hello');
    assertEquals(a.description, 'SHA-256 of “hello”');
    assertEquals(a.score, 840);
    assertEquals(one('MD5 Hello World').description, 'MD5 of “Hello World”');
    assertEquals(one('MD5 Hello  World').title, 'md5:Hello  World');
    assertEquals(one('sha1 x').description, 'SHA-1 of “x”');
    assertEquals(one('sha512 x').description, 'SHA-512 of “x”');
    const h = ask('hash abc');
    assertEquals(h.map(x => x.id), ['sha256', 'sha1', 'md5']);
    assertEquals(h.map(x => x.score), [840, 840, 840]);
    a = one(`sha256 ${'a'.repeat(100)}`);
    assertEquals(a.description, `SHA-256 of “${'a'.repeat(39)}…”`);
    assertEquals(one(' sha256 trimmed ').title, 'sha256:trimmed');
});

test('base64 encode and decode', () => {
    assertEquals(one('base64 hello').title, 'aGVsbG8=');
    assertEquals(one('base64 hello').description, 'Base64 of “hello”');
    assertEquals(one('base64 hello').id, 'base64');
    assertEquals(one('base64 hello').icon, 'utilities-terminal-symbolic');
    assertEquals(one('b64 hi').title, 'aGk=');
    assertEquals(one('base64 encode Hello').title, 'SGVsbG8=');
    assertEquals(one('base64 a').title, 'YQ==');
    assertEquals(one('base64 ab').title, 'YWI=');
    assertEquals(one('base64 abc').title, 'YWJj');
    assertEquals(one('base64 héllo €').title, 'aMOpbGxvIOKCrA==');
    const d = one('base64 decode aGVsbG8=');
    assertEquals(d.id, 'base64d');
    assertEquals(d.title, 'hello');
    assertEquals(d.description, 'Decoded from Base64');
    assertEquals(one('b64 decode aGVsbG8').title, 'hello');
    assertEquals(one('unbase64 aGVsbG8=').title, 'hello');
    assertEquals(one('base64 decode aMOpbGxvIOKCrA').title, 'héllo €');
    // URL-safe alphabet: 0xfb 0xff -> "-_8" style; "?>" is "Pz4="
    assertEquals(one('base64 decode Pz4=').title, '?>');
    assertEquals(one('base64 decode Pz4').title, '?>');
    assertEquals(one('base64 DECODE aGk=').title, 'hi');
});

test('base64 invalid input', () => {
    for (const q of ['base64 decode !!!!', 'base64 decode a', 'base64 decode /w==', 'base64 decode AAEC', 'base64 decode gA==',
        'base64 decode ====', 'base64 decode aGk===', 'base64 decode', 'base64 encode', 'unbase64'])
        assertEquals(ask(q), [], q);
});

test('url encode and decode', () => {
    let a = one('url encode a b&c');
    assertEquals(a.id, 'urlenc');
    assertEquals(a.title, 'a%20b%26c');
    assertEquals(a.description, 'URL-encoded');
    assertEquals(a.score, 840);
    assertEquals(one('urlencode é').title, '%C3%A9');
    a = one('url decode a%20b');
    assertEquals(a.id, 'urldec');
    assertEquals(a.title, 'a b');
    assertEquals(a.description, 'URL-decoded');
    assertEquals(one('urldecode %C3%A9').title, 'é');
    assertEquals(ask('url decode %E0%A4%A'), []);
    assertEquals(ask('urldecode %'), []);
});

test('random numbers', () => {
    let a = one('random');
    assertEquals(a.description, 'Random number from 1 to 100');
    assertEquals(a.score, 840);
    assertEquals(a.id, 'random');
    assertEquals(a.icon, 'accessories-calculator-symbolic');
    assertEquals(one('random 10').description, 'Random number from 1 to 10');
    assertEquals(one('random 5-50').description, 'Random number from 5 to 50');
    assertEquals(one('random 5 50').description, 'Random number from 5 to 50');
    assertEquals(one('random 1 to 6').description, 'Random number from 1 to 6');
    assertEquals(one('random 5-50').score, 1000);
    assertEquals(one('random -5 5').description, 'Random number from -5 to 5');
    const d = makeDeps(3);
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
        const v = +one('random 3-5', d).title;
        assert(v >= 3 && v <= 5);
        seen.add(v);
    }
    assertEquals(seen.size, 3);
    for (let i = 0; i < 200; i++) {
        const v = +one('random 1000000000', d).title;
        assert(v >= 1 && v <= 1e9);
    }
    a = one('random -1000000000 1000000000', d);
    assert(Math.abs(+a.title) <= 1e9);
    for (const q of ['random 1', 'random 5 5', 'random 9 3', 'random 2000000000', 'random abc', 'random 1 2 3', 'random access', 'randomizer'])
        assertEquals(ask(q), [], q);
});

test('random range edge: top and bottom values are reachable', () => {
    assertEquals(one('random 1-6', makeDeps(1, [0])).title, '1');
    assertEquals(one('random 1-6', makeDeps(1, [5])).title, '6');
    // 252 is the first rejected byte for a range of 6 (252 % 6 == 0, so 0..251 are accepted)
    assertEquals(one('random 1-6', makeDeps(1, [252, 7])).title, '2');
});

test('dice', () => {
    let a = one('roll d20');
    assertEquals(a.id, 'dice');
    assert(/^d20: \d+$/.test(a.description), a.description);
    assertEquals(a.score, 1000);
    a = one('roll 2d6');
    const m = /^2d6: (\d) \+ (\d)$/.exec(a.description);
    assert(m, a.description);
    assertEquals(+a.title, +m[1] + +m[2]);
    assertEquals(one('roll').score, 840);
    assert(/^d6: [1-6]$/.test(one('roll').description));
    assertEquals(one('dice').score, 840);
    assertEquals(one('roll 20d1000').description.split('+').length, 20);
    assertEquals(one('ROLL D8').id, 'dice');
    for (const q of ['roll 21d6', 'roll d1', 'roll d1001', 'roll 0d6', 'roll 2', 'roller coaster', 'dice game', 'roll abc'])
        assertEquals(ask(q), [], q);
    assertEquals(one('roll d6', makeDeps(1, [0])).title, '1');
});

test('coin', () => {
    for (const q of ['flip a coin', 'coin flip', 'coin toss', 'flip coin', 'toss a coin', 'Flip A Coin']) {
        const a = one(q);
        assertEquals(a.id, 'coin');
        assert(a.title === 'Heads' || a.title === 'Tails');
        assertEquals(a.description, 'Coin flip');
        assertEquals(a.score, 840);
    }
    assertEquals(one('coin flip', makeDeps(1, [0])).title, 'Heads');
    assertEquals(one('coin flip', makeDeps(1, [1])).title, 'Tails');
    for (const q of ['coin', 'flip', 'toss', 'coin flipper', 'flip a coin now'])
        assertEquals(ask(q), [], q);
});

test('text tools', () => {
    let a = one('uppercase Hello there');
    assertEquals(a.id, 'upper');
    assertEquals(a.title, 'HELLO THERE');
    assertEquals(a.icon, 'preferences-desktop-font-symbolic');
    assertEquals(a.score, 840);
    assertEquals(one('upper abc').title, 'ABC');
    assertEquals(one('lowercase HeLLo').title, 'hello');
    assertEquals(one('lower ABC').id, 'lower');
    a = one('title case the quick  brown FOX');
    assertEquals(a.id, 'title');
    assertEquals(a.title, 'The Quick  Brown Fox');
    a = one('count hello world');
    assertEquals(a.id, 'count');
    assertEquals(a.title, '11 characters');
    assertEquals(a.copy, '11');
    assertEquals(a.description, '2 words · 11 bytes in UTF-8');
    a = one('length é€😀');
    assertEquals(a.title, '3 characters');
    assertEquals(a.description, '1 word · 9 bytes in UTF-8');
    assertEquals(one('count a').title, '1 character');
});

test('false positives: app-like queries return nothing', () => {
    const none = ['pass', 'passwords', 'password manager', 'password safe', 'pinta', 'pin board', 'uuidgen', 'md5', 'md5sum',
        'sha256', 'hash', 'hashcat', 'base64', 'url', 'url encode', 'random access', 'randomizer', 'roller coaster',
        'dice game', 'coin', 'upper', 'lower', 'count', 'counter strike', 'length', 'firefox', 'title', 'title case',
        'term', 'settings', 'files', 'gnome text editor', '2048', 'steam', 'c', 'calc', '', ' ', 'p', 'base64 ',
        'pinball', 'urlencode', 'urldecode', 'unbase64', 'title case '];
    for (const q of none)
        assertEquals(ask(q), [], JSON.stringify(q));
});

test('input cap', () => {
    assertEquals(ask(`md5 ${'a'.repeat(1990)}`).length, 1);
    assertEquals(ask(`md5 ${'a'.repeat(2000)}`), []);
    assertEquals(ask(`count ${'a'.repeat(5000)}`), []);
});

test('never throws', () => {
    const bad = {randomBytes() { throw new Error('no entropy'); }, checksum() { throw new Error('boom'); }};
    for (const q of ['password', 'pin', 'uuid', 'md5 x', 'hash x', 'random', 'roll', 'coin flip'])
        assertEquals(toolAnswers(q, bad), [], q);
    const short = {randomBytes: () => new Uint8Array(0), checksum: () => ''};
    assertEquals(toolAnswers('password', short), []);
    assertEquals(toolAnswers('uuid', short), []);
});

test('speed of rejecting ordinary queries', () => {
    const deps = makeDeps();
    const qs = ['firefox', 'term', 'settings', 'files', 'gnome text editor', '2048', 'steam', 'c', 'calc'];
    const n = 200000;
    const t0 = GLib.get_monotonic_time();
    for (let i = 0; i < n; i++)
        toolAnswers(qs[i % qs.length], deps);
    const ns = (GLib.get_monotonic_time() - t0) * 1000 / n;
    print(`    ${ns.toFixed(0)} ns/call`);
    assert(ns < 2000, `${ns} ns/call`);
});

run();
