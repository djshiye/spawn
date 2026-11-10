// Damaged entries are skipped, absurd numbers are clamped (build/core/entries.js, build/core/limits.js).
import {ENTRY_LIST_KEYS, sanitizeEntries} from '../build/core/entries.js';
import {buttonIconSize, buttonPadding, clampInt, gridIconSize, iconSize} from '../build/core/limits.js';
import {assert, assertEquals, run, test} from './harness.js';

test('an entry without an id is skipped, the rest of the list is kept in order', () => {
    const skipped = [];
    const list = [{id: 'a.desktop'}, {name: 'No id'}, {id: 'b.desktop'}, {id: ''}, {id: '  '}, {id: 'folder', isFolder: 'true', name: 'F'}];
    const out = sanitizeEntries(list, (_e, why) => skipped.push(why));
    assertEquals(out.map(e => e.id), ['a.desktop', 'b.desktop', 'folder']);
    assertEquals(skipped, ['no id', 'no id', 'no id']);
});

test('non-entries (null, strings, arrays, a non-list) never reach the callers', () => {
    assertEquals(sanitizeEntries([null, 'x', ['id'], 3, {id: 'ok'}]).map(e => e.id), ['ok']);
    assertEquals(sanitizeEntries(undefined), []);
    assertEquals(sanitizeEntries({id: 'a'}), []);
});

test('a clean list comes back untouched (same entries)', () => {
    const list = [{id: 'a.desktop'}, {id: 'b.desktop', name: 'B', icon: 'x'}];
    const out = sanitizeEntries(list);
    assertEquals(out.length, 2);
    assert(out[0] === list[0] && out[1] === list[1], 'entries are not copied');
});

test('every entry-list setting is covered', () => {
    for (const k of ['pinned-apps', 'directory-shortcuts', 'application-shortcuts', 'context-menu-items'])
        assert(ENTRY_LIST_KEYS.includes(k), k);
});

test('panel button icon size is limited to 8..64, padding to -1 or 0..64', () => {
    assertEquals([buttonIconSize(20), buttonIconSize(5000), buttonIconSize(-3), buttonIconSize(NaN), buttonIconSize('x')], [20, 64, 8, 20, 20]);
    assertEquals([buttonPadding(-1), buttonPadding(-50), buttonPadding(0), buttonPadding(12), buttonPadding(99999)], [-1, -1, 0, 12, 64]);
});

test('icon-size-* settings: <= 0 is the default, huge values stop at 128', () => {
    assertEquals([iconSize(-1, 28), iconSize(0, 28), iconSize(-40, 28), iconSize(32, 28), iconSize(100000, 28)], [28, 28, 28, 32, 128]);
});

test('the pinned grid icon size is the default or 16..128', () => {
    assertEquals([gridIconSize(undefined, 48), gridIconSize(-1, 48), gridIconSize(4, 48), gridIconSize(64, 48), gridIconSize(1e9, 48)], [48, 48, 16, 64, 128]);
});

test('clampInt rounds and handles non-numbers', () => {
    assertEquals([clampInt(2.6, 0, 10, 5), clampInt(Infinity, 0, 10, 5), clampInt(null, 0, 10, 5)], [3, 5, 5]);
});

run();
