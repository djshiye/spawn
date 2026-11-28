// Scroll target arithmetic (build/model/scroll.js): scrolling an item into view.
import {scrollTarget} from '../build/model/scroll.js';
import {assertEquals, run, test} from './harness.js';

const view = {viewH: 300, height: 36};

test('the first row under a title scrolls to the very top, so the title shows', () => {
    assertEquals(scrollTarget({...view, value: 21, top: 21}), 0);
    assertEquals(scrollTarget({...view, value: 100, top: 21}), 0);
});

test('a later row above the view scrolls to its top minus the margin', () => {
    assertEquals(scrollTarget({...view, value: 200, top: 57}), 49);
    assertEquals(scrollTarget({...view, value: 200, top: 120}), 112);
});

test('a row below the view scrolls to the bottom rule', () => {
    assertEquals(scrollTarget({...view, value: 0, top: 400}), 400 + 36 + 8 - 300);
});

test('a row already in view leaves the offset alone', () => {
    assertEquals(scrollTarget({...view, value: 50, top: 100}), 50);
});

test('the offset is never negative, and 0 stays 0', () => {
    assertEquals(scrollTarget({...view, value: 0, top: 21}), 0);
    assertEquals(scrollTarget({...view, value: 5, top: 0}), 0);
});

run();
