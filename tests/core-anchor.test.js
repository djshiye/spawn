// Pointer-aware anchor choice (review finding 2).
import {pickAnchor} from '../build/panel/anchor.js';
import {assertEquals, run, test} from './harness.js';

const b = (name, monitor) => ({name, monitor});
const monitorOf = x => x.monitor;

test('prefers the button on the pointer monitor', () => {
    const buttons = [b('a', 0), b('b', 1)];
    assertEquals(pickAnchor(buttons, monitorOf, 1).name, 'b');
    assertEquals(pickAnchor(buttons, monitorOf, 0).name, 'a');
});

test('falls back to the first button when no button is on the pointer monitor', () => {
    const buttons = [b('a', 0), b('b', 1)];
    assertEquals(pickAnchor(buttons, monitorOf, 2).name, 'a');
    assertEquals(pickAnchor(buttons, monitorOf, -1).name, 'a');
});

test('null when there are no buttons; a throwing monitor lookup is skipped', () => {
    assertEquals(pickAnchor([], monitorOf, 0), null);
    const buttons = [b('a', 0), b('b', 1)];
    const bad = x => {
        if (x.name === 'a')
            throw new Error('dead actor');
        return x.monitor;
    };
    assertEquals(pickAnchor(buttons, bad, 1).name, 'b');
    assertEquals(pickAnchor(buttons, bad, 0).name, 'a');
});

run();
