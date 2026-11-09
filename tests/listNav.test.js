// Keyboard navigation arithmetic (build/model/listNav.js): search highlight steps, Page Up / Down, moving
// between panes at the same height.
import {nearestIndex, pageTarget, searchStep, stepIndex} from '../build/model/listNav.js';
import {assertEquals, run, test} from './harness.js';

test('stepIndex wraps both ways; nothing picked starts at an end', () => {
    assertEquals(stepIndex(0, 1, 5), 1);
    assertEquals(stepIndex(4, 1, 5), 0);
    assertEquals(stepIndex(0, -1, 5), 4);
    assertEquals(stepIndex(-1, 1, 5), 0);
    assertEquals(stepIndex(-1, -1, 5), 4);
    assertEquals(stepIndex(0, 1, 1), 0);
    assertEquals(stepIndex(0, 1, 0), -1);
});

test('searchStep: the key pointing away from the entry goes to the next (worse) match', () => {
    assertEquals(searchStep('down', true), 1);
    assertEquals(searchStep('up', true), -1);
    assertEquals(searchStep('up', false), 1);
    assertEquals(searchStep('down', false), -1);
});

const list = n => Array.from({length: n}, (_, i) => ({x: 100, y: 20 + i * 40}));

test('pageTarget in a list: one page down / up, at least one row, clamped to the ends', () => {
    const items = list(30); // 40 px rows
    assertEquals(pageTarget(items, 0, 1, 400), 10);
    assertEquals(pageTarget(items, 10, -1, 400), 0);
    assertEquals(pageTarget(items, 25, 1, 400), 29);
    assertEquals(pageTarget(items, 29, 1, 400), 29);
    assertEquals(pageTarget(items, 3, -1, 400), 0);
    assertEquals(pageTarget(items, 0, 1, 10), 1); // a page smaller than a row still moves one row
});

test('pageTarget in a grid keeps the column', () => {
    const items = [];
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 4; c++)
            items.push({x: 50 + c * 100, y: 50 + r * 100});
    }
    items.pop(); // a short last row: 3 items
    assertEquals(pageTarget(items, 2, 1, 300), 14); // row 3, column 2
    assertEquals(pageTarget(items, 3, 1, 5000), 38); // last row has no column 3: nearest is column 2
    assertEquals(pageTarget(items, 37, -1, 5000), 1);
});

test('nearestIndex: same height first, then nearest column', () => {
    const right = [{x: 600, y: 30}, {x: 600, y: 80}, {x: 600, y: 120}, {x: 600, y: 160}];
    assertEquals(nearestIndex(right, {x: 200, y: 118}), 2);
    assertEquals(nearestIndex(right, {x: 200, y: 900}), 3);
    const grid = [{x: 50, y: 50}, {x: 150, y: 50}, {x: 250, y: 50}, {x: 50, y: 150}];
    assertEquals(nearestIndex(grid, {x: 600, y: 60}), 2);
    assertEquals(nearestIndex([], {x: 0, y: 0}), -1);
});

run();
