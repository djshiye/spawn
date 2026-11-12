// Power actions in the search: which typed words show which action (search/powerKeywords.ts).
import {POWER_SYNONYMS, matchPower, scorePower} from '../build/search/powerKeywords.js';
import {assert, assertEquals, run, test} from './harness.js';

const ENTRIES = [
    ['switchUser', 'Switch User', 'switch user'],
    ['lock', 'Lock', 'lock'],
    ['logout', 'Log Out', 'log out'],
    ['suspend', 'Suspend', 'suspend'],
    ['hybridSleep', 'Hybrid Sleep', 'hybrid sleep'],
    ['hibernate', 'Hibernate', 'hibernate'],
    ['restart', 'Restart', 'restart'],
    ['firmware', 'Restart to Firmware Setup', 'restart to firmware setup'],
    ['poweroff', 'Power Off', 'power off'],
].map(([key, name, english]) => ({key, name, synonyms: [english, ...POWER_SYNONYMS[key]]}));

const found = q => matchPower(q, ENTRIES).map(m => m.item.key);

test('the words people type find their action', () => {
    assertEquals(found('lock')[0], 'lock');
    assertEquals(found('lock screen')[0], 'lock');
    for (const q of ['log out', 'logout', 'sign out', 'signout'])
        assertEquals(found(q)[0], 'logout', q);
    assertEquals(found('suspend')[0], 'suspend');
    assertEquals(found('sleep')[0], 'suspend');
    assertEquals(found('restart')[0], 'restart');
    assertEquals(found('reboot')[0], 'restart');
    for (const q of ['power off', 'shut down', 'shutdown'])
        assertEquals(found(q)[0], 'poweroff', q);
    assertEquals(found('switch user')[0], 'switchUser');
    assertEquals(found('hibernate')[0], 'hibernate');
    assertEquals(found('firmware')[0], 'firmware');
});

test('at least 3 typed characters: "re" shows nothing, "res" shows Restart', () => {
    assertEquals(found('re'), []);
    assertEquals(found('lo'), []);
    assertEquals(found('  r e  '), []);
    assert(found('res').includes('restart'), 'res');
    assert(found('loc').includes('lock'), 'loc');
});

test('word prefixes of the name and the synonyms count, a middle of a word does not', () => {
    assert(found('out').includes('logout'), 'out');
    assert(found('log o').includes('logout'), 'log o');
    assert(found('down').includes('poweroff'), 'down');
    assertEquals(found('ock'), []);
    assertEquals(found('oweroff'), []);
});

test('an exact name is the best match of its own query, ahead of the other actions', () => {
    const m = matchPower('restart', ENTRIES);
    assertEquals(m[0].item.key, 'restart');
    assertEquals(m[0].score, 1000);
    assertEquals(m.map(x => x.item.key), ['restart', 'firmware']);
    assert(scorePower('lock', 'Lock', ['lock']) > scorePower('loc', 'Lock', ['lock']), 'exact > prefix');
});

test('equal scores keep the order of the entries; a synonym ranks below the name', () => {
    assertEquals(found('sleep'), ['suspend', 'hybridSleep']);
    assert(scorePower('reboot', 'Restart', ['restart', 'reboot']) < scorePower('restart', 'Restart', ['restart', 'reboot']), 'synonym below name');
});

test('accents and case do not matter; unrelated words match nothing', () => {
    assertEquals(found('LÖCK')[0], 'lock');
    assertEquals(found('LOCK')[0], 'lock');
    assertEquals(found('firefox'), []);
    assertEquals(found('display'), []);
    assertEquals(found('calc'), []);
});

run();
