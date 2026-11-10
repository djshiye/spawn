// The settings window's pages are found by name (core/prefsPages.ts), never by a hard-coded index.
import {PREFS_PAGE_NAMES, prefsPageIndex} from '../build/core/prefsPages.js';
import {assert, assertEquals, run, test} from './harness.js';

test('every page name maps to its own position', () => {
    PREFS_PAGE_NAMES.forEach((name, i) => assertEquals(prefsPageIndex(name), i));
    assertEquals(new Set(PREFS_PAGE_NAMES).size, PREFS_PAGE_NAMES.length);
});

test('the Pinned page (shortcut lists) exists and an unknown name has no index', () => {
    assert(prefsPageIndex('pinned') >= 0);
    assertEquals(prefsPageIndex('nope'), -1);
});

run();
