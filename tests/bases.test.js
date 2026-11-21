import {baseAnswers} from '../build/search/answers/bases.js';
import {assert, assertEquals, run, test} from './harness.js';

const flat = q => baseAnswers(q).map(a => [a.id, a.title, a.copy, a.description]);

test('prefixed literal gives the other bases in order', () => {
    assertEquals(flat('0xFF'), [['dec', '255', '255', 'Decimal'], ['bin', '1111 1111', '11111111', 'Binary'],
        ['oct', '0o377', '0o377', 'Octal']]);
    assertEquals(flat('0b1010').map(r => r[0]), ['dec', 'hex', 'oct']);
    assertEquals(flat('0b1010')[1], ['hex', '0xA', '0xA', 'Hexadecimal']);
    assertEquals(flat('0o17').map(r => r[1]), ['15', '0xF', '1111']);
});

test('binary is padded to a multiple of four and grouped', () => {
    assertEquals(flat('0b101 to bin')[0][1], '0101');
    assertEquals(flat('5 to binary')[0], ['bin', '0101', '101', 'Binary']);
    assertEquals(flat('256 to binary')[0][1], '0001 0000 0000');
    assertEquals(flat('0 to bin')[0][1], '0000');
});

test('explicit targets', () => {
    assertEquals(flat('255 in hex'), [['hex', '0xFF', '0xFF', 'Hexadecimal']]);
    assertEquals(flat('255 to binary')[0][1], '1111 1111');
    assertEquals(flat('255 as octal'), [['oct', '0o377', '0o377', 'Octal']]);
    assertEquals(flat('0xFF in decimal'), [['dec', '255', '255', 'Decimal']]);
    assertEquals(flat('0b1010 to hex')[0][1], '0xA');
    assertEquals(flat('255 in hexadecimal')[0][1], '0xFF');
    assertEquals(flat('255 IN HEX')[0][1], '0xFF');
});

test('arbitrary bases', () => {
    assertEquals(flat('255 in base 36'), [['base36', '73', '73', 'Base 36']]);
    assertEquals(flat('zz base 36 in decimal')[0][1], '1295');
    assertEquals(flat('1010 base 2 to hex')[0][1], '0xA');
    assertEquals(flat('255 in base 2')[0][1], '1111 1111');
    assertEquals(flat('35 in base 36')[0][1], 'z');
});

test('keyword first means the target', () => {
    assertEquals(flat('hex 255'), [['hex', '0xFF', '0xFF', 'Hexadecimal']]);
    assertEquals(flat('bin 255')[0][1], '1111 1111');
    assertEquals(flat('oct 255')[0][1], '0o377');
    assertEquals(flat('dec 0xff')[0][1], '255');
});

test('negative values and 128 bits', () => {
    assertEquals(flat('-255 in hex')[0][1], '-0xFF');
    assertEquals(flat('-5 to bin')[0].slice(1, 3), ['-0101', '-101']);
    assertEquals(flat('-0xff in dec')[0][1], '-255');
    const max = (1n << 128n) - 1n;
    assertEquals(flat(`${max} in hex`)[0][1], '0x' + 'F'.repeat(32));
    assertEquals(flat(`${max + 1n} in hex`), []);
});

test('ascii helper', () => {
    assertEquals(flat('ascii A'), [['dec', '65', '65', 'Decimal'], ['hex', '0x41', '0x41', 'Hexadecimal'],
        ['bin', '0100 0001', '1000001', 'Binary']]);
    assertEquals(flat('ascii 65'), [['char', 'A', 'A', 'ASCII 65']]);
    assertEquals(flat('chr 65'), [['char', 'A', 'A', 'ASCII 65']]);
    assertEquals(flat('chr 0x7e')[0][1], '~');
    assertEquals(flat('ascii 31'), []);
    assertEquals(flat('ascii 127'), []);
});

test('false positives', () => {
    for (const q of ['255', 'ff', 'hex', 'binary', 'bin', '0x', '0b2', 'in hex', 'base 64', '255 in', '255 in base 1',
        '255 in base 37', 'decimal', 'hexchat', 'hex editor', 'binary ninja', '5 km in miles', 'ascii', 'ascii art',
        'firefox', 'term', 'settings', 'files', 'gnome text editor', '2048', 'steam', 'c', 'calc', '', '   ',
        'ff hex in decimal', '0xZZ', '0o8', 'x'.repeat(500)])
        assertEquals(flat(q), [], q);
});

test('never throws on odd input', () => {
    for (const q of ['0x' + 'f'.repeat(300), '- 0x1', '0b', '\u0000', 'hex  ', 'ascii é', 'ascii  '])
        assert(Array.isArray(baseAnswers(q)));
});

run();
