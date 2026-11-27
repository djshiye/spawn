// Run: gjs -m tests/direction.test.js
import {mirrorDir, mirrorZone} from '../build/model/direction.js';
import {assertEquals, run, test} from './harness.js';

const DIRS = ['left', 'right', 'up', 'down', 'first', 'last'];

test('mirrorDir is the identity in LTR', () => {
    for (const d of DIRS)
        assertEquals(mirrorDir(d, false), d);
});

test('mirrorDir swaps only left and right in RTL', () => {
    assertEquals(mirrorDir('left', true), 'right');
    assertEquals(mirrorDir('right', true), 'left');
    for (const d of ['up', 'down', 'first', 'last'])
        assertEquals(mirrorDir(d, true), d);
});

test('mirrorZone', () => {
    for (const z of ['before', 'after', 'onto'])
        assertEquals(mirrorZone(z, false), z);
    assertEquals(mirrorZone('before', true), 'after');
    assertEquals(mirrorZone('after', true), 'before');
    assertEquals(mirrorZone('onto', true), 'onto');
});

run();
