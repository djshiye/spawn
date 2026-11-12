// Letter groups and grid stepping of the Grid layout's All apps view (build/model/letterGroups.js).
import {LETTERS, groupByLetter, letterOf, rowCount, rowIndexOf, stepRows, stepSlots} from '../build/model/letterGroups.js';
import {assertEquals, run, test} from './harness.js';

test('letterOf: letters, accents, digits and symbols', () => {
    assertEquals(letterOf('bottles'), 'B');
    assertEquals(letterOf('  Calendar'), 'C');
    assertEquals(letterOf('Édito'), 'E');
    assertEquals(letterOf('Öffnen'), 'O');
    assertEquals(letterOf('1Password'), '#');
    assertEquals(letterOf('_hidden'), '#');
    assertEquals(letterOf('日本語'), '#');
    assertEquals(letterOf(''), '#');
});

test('groupByLetter: # first, then A..Z, input order kept, empty letters omitted', () => {
    const names = ['Zeta', 'alpha', '7zip', 'Beta', 'Apple', '_x', 'Zed'];
    const groups = groupByLetter(names, n => n);
    assertEquals(groups.map(g => g.letter).join(''), '#ABZ');
    assertEquals(groups[0].items.join(','), '7zip,_x');
    assertEquals(groups[1].items.join(','), 'alpha,Apple');
    assertEquals(groups[3].items.join(','), 'Zeta,Zed');
    assertEquals(groupByLetter([], n => n).length, 0);
    assertEquals(LETTERS.length, 27);
});

test('rowCount', () => {
    assertEquals(rowCount(0, 6), 0);
    assertEquals(rowCount(1, 6), 1);
    assertEquals(rowCount(6, 6), 1);
    assertEquals(rowCount(7, 6), 2);
});

// heading (1), 4 tiles in 3 columns (3 + 1), heading, 2 tiles
const rows = [{start: 0, len: 1}, {start: 1, len: 3}, {start: 4, len: 1}, {start: 5, len: 1}, {start: 6, len: 2}];

test('rowIndexOf', () => {
    assertEquals(rowIndexOf(rows, 0), 0);
    assertEquals(rowIndexOf(rows, 3), 1);
    assertEquals(rowIndexOf(rows, 7), 4);
    assertEquals(rowIndexOf(rows, 8), -1);
});

test('stepRows: up / down keep the preferred column, clamped to short rows and headings', () => {
    let s = stepRows(rows, 3, 'down', 2); // third column of the first row -> the short second row
    assertEquals(s.index, 4);
    assertEquals(s.col, 2);
    s = stepRows(rows, 4, 'down', 2); // -> the next heading
    assertEquals(s.index, 5);
    s = stepRows(rows, 5, 'down', 2); // heading -> first tile row of the next group, column 2 clamped to 1
    assertEquals(s.index, 7);
    s = stepRows(rows, 7, 'up', 1);
    assertEquals(s.index, 5);
    assertEquals(stepRows(rows, 0, 'up', 0), null);
    assertEquals(stepRows(rows, 7, 'down', 1), null);
});

test('stepRows: left / right stay inside their row', () => {
    assertEquals(stepRows(rows, 2, 'left', 0).index, 1);
    assertEquals(stepRows(rows, 1, 'left', 0).index, 1);
    assertEquals(stepRows(rows, 3, 'right', 0).index, 3);
    assertEquals(stepRows(rows, 3, 'right', 0).col, 2);
    assertEquals(stepRows(rows, 4, 'right', 0).index, 4);
});

test('stepSlots: the picker skips letters without apps', () => {
    // 3 columns: [# A B] [C D E]; B and D are off
    const on = [true, true, false, true, false, true];
    assertEquals(stepSlots(on, 1, 'right', 3), 3);
    assertEquals(stepSlots(on, 3, 'left', 3), 1);
    assertEquals(stepSlots(on, 5, 'right', 3), 5);
    assertEquals(stepSlots(on, 0, 'down', 3), 3);
    assertEquals(stepSlots(on, 3, 'up', 3), 0);
    assertEquals(stepSlots(on, 1, 'down', 3), 1); // D is off: stay
    assertEquals(stepSlots(on, 5, 'up', 3), 5); // B is off: stay
});

run();
