// Keyboard reordering: reorderTarget (build/model/reorder.js) and moveInFolder (build/model/pinnedOps.js).
import {reorderTarget} from '../build/model/reorder.js';
import * as ops from '../build/model/pinnedOps.js';
import {assertEquals, run, test} from './harness.js';

test('list: up/down move one position, edges are no-ops, left/right do nothing', () => {
    assertEquals(reorderTarget(2, 5, 1, 'up'), 1);
    assertEquals(reorderTarget(2, 5, 1, 'down'), 3);
    assertEquals(reorderTarget(0, 5, 1, 'up'), null);
    assertEquals(reorderTarget(4, 5, 1, 'down'), null);
    assertEquals(reorderTarget(2, 5, 1, 'left'), null);
    assertEquals(reorderTarget(2, 5, 1, 'right'), null);
});

test('home / end go to the first / last slot', () => {
    assertEquals(reorderTarget(3, 5, 1, 'first'), 0);
    assertEquals(reorderTarget(1, 5, 4, 'last'), 4);
    assertEquals(reorderTarget(0, 5, 1, 'first'), null);
    assertEquals(reorderTarget(4, 5, 4, 'last'), null);
});

test('grid: left/right one position, up/down one row', () => {
    // 4 columns, 10 entries: rows [0-3] [4-7] [8-9]
    assertEquals(reorderTarget(5, 10, 4, 'left'), 4);
    assertEquals(reorderTarget(5, 10, 4, 'right'), 6);
    assertEquals(reorderTarget(5, 10, 4, 'up'), 1);
    assertEquals(reorderTarget(5, 10, 4, 'down'), 9);
    assertEquals(reorderTarget(0, 10, 4, 'left'), null);
    assertEquals(reorderTarget(9, 10, 4, 'right'), null);
    assertEquals(reorderTarget(2, 10, 4, 'up'), null);
    assertEquals(reorderTarget(9, 10, 4, 'down'), null);
});

test('grid: a row below a short last row clamps to the last slot, the last row cannot go down', () => {
    // rows [0-3] [4-7] [8-9]: from 7 (row 1, col 3) down -> 11 does not exist -> 9
    assertEquals(reorderTarget(7, 10, 4, 'down'), 9);
    assertEquals(reorderTarget(8, 10, 4, 'down'), null);
    assertEquals(reorderTarget(6, 9, 3, 'down'), null);
});

test('bad input is a no-op', () => {
    assertEquals(reorderTarget(0, 0, 1, 'down'), null);
    assertEquals(reorderTarget(-1, 3, 1, 'down'), null);
    assertEquals(reorderTarget(3, 3, 1, 'up'), null);
    assertEquals(reorderTarget(1, 3, 0, 'down'), 2);
});

const app = id => ({id: `${id}.desktop`});
const folder = (uuid, name) => ({id: uuid, name, isFolder: 'true'});
const snap = (top, folders = {}) => ({top, folders});

test('moveInFolder reorders one folder only, with the contract of move', () => {
    const s = snap([app('a'), folder('F', 'Fold')], {F: [app('x'), app('y'), app('z')]});
    assertEquals(ops.moveInFolder(s, 'F', 0, 1).folders.F.map(e => e.id), ['y.desktop', 'x.desktop', 'z.desktop']);
    assertEquals(ops.moveInFolder(s, 'F', 2, 0).folders.F.map(e => e.id), ['z.desktop', 'x.desktop', 'y.desktop']);
    assertEquals(ops.moveInFolder(s, 'F', 0, 99).folders.F.map(e => e.id), ['y.desktop', 'z.desktop', 'x.desktop']);
    assertEquals(ops.moveInFolder(s, 'F', 1, 1) === s, true);
    assertEquals(ops.moveInFolder(s, 'F', 5, 0) === s, true);
    assertEquals(ops.moveInFolder(s, 'nope', 0, 1) === s, true);
    assertEquals(ops.moveInFolder(s, 'F', 0, 1).top, s.top);
    // the input is never mutated
    assertEquals(s.folders.F.map(e => e.id), ['x.desktop', 'y.desktop', 'z.desktop']);
});

run();
