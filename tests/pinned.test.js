// Pure list operations of the pinned model (build/model/pinnedOps.js).
import * as ops from '../build/model/pinnedOps.js';
import {assert, assertEquals, run, test} from './harness.js';

const app = id => ({id: `${id}.desktop`});
const folder = (uuid, name) => ({id: uuid, name, isFolder: 'true'});
const snap = (top, folders = {}) => ({top, folders});
const ids = s => s.top.map(e => e.id);

const base = () => snap([app('a'), app('b'), app('c')]);
const withFolder = () => snap(
    [app('a'), folder('F', 'Fold'), app('b')],
    {F: [app('x'), app('y')]},
);

test('pin appends and inserts at an index', () => {
    assertEquals(ids(ops.pin(base(), 'd.desktop')), ['a.desktop', 'b.desktop', 'c.desktop', 'd.desktop']);
    assertEquals(ids(ops.pin(base(), 'd.desktop', 1)), ['a.desktop', 'd.desktop', 'b.desktop', 'c.desktop']);
    assertEquals(ids(ops.pin(base(), 'd.desktop', 99)), ['a.desktop', 'b.desktop', 'c.desktop', 'd.desktop']);
    assertEquals(ids(ops.pin(base(), 'd.desktop', -4)), ['d.desktop', 'a.desktop', 'b.desktop', 'c.desktop']);
});

test('pin never duplicates, including ids inside folders, and never mutates its input', () => {
    const s = withFolder();
    const before = JSON.stringify(s);
    assert(ops.pin(s, 'a.desktop') === s, 'already pinned is a no-op');
    assert(ops.pin(s, 'x.desktop') === s, 'already in a folder is a no-op');
    ops.pin(s, 'z.desktop');
    ops.unpin(s, 'x.desktop');
    ops.createFolder(s, 'G', 'G', ['a.desktop']);
    assertEquals(JSON.stringify(s), before);
});

test('isPinnedIn sees top level and folders', () => {
    const s = withFolder();
    assert(ops.isPinnedIn(s, 'a.desktop'));
    assert(ops.isPinnedIn(s, 'y.desktop'));
    assert(ops.isPinnedIn(s, 'F'));
    assert(!ops.isPinnedIn(s, 'nope.desktop'));
});

test('unpin removes from the top level', () => {
    assertEquals(ids(ops.unpin(base(), 'b.desktop')), ['a.desktop', 'c.desktop']);
    const s = base();
    assert(ops.unpin(s, 'zzz.desktop') === s);
});

test('unpin removes every top-level duplicate of the id', () => {
    const s = snap([app('a'), app('b'), app('a')]);
    assertEquals(ids(ops.unpin(s, 'a.desktop')), ['b.desktop']);
});

test('createFolder takes every top-level duplicate into the folder (one place only)', () => {
    const r = ops.createFolder(snap([app('a'), app('b'), app('a')]), 'F', 'Fold', ['a.desktop']);
    assertEquals(ids(r), ['F', 'b.desktop']);
    assertEquals(r.folders.F.map(e => e.id), ['a.desktop']);
});

test('unpin from inside a folder keeps a non-empty folder', () => {
    const r = ops.unpin(withFolder(), 'x.desktop');
    assertEquals(r.folders.F, [app('y')]);
    assertEquals(ids(r), ['a.desktop', 'F', 'b.desktop']);
});

test('unpinning the last app of a folder deletes the folder', () => {
    let r = ops.unpin(withFolder(), 'x.desktop');
    r = ops.unpin(r, 'y.desktop');
    assertEquals(ids(r), ['a.desktop', 'b.desktop']);
    assertEquals(Object.keys(r.folders), []);
});

test('unpin of a folder uuid deletes the folder', () => {
    const r = ops.unpin(withFolder(), 'F');
    assertEquals(ids(r), ['a.desktop', 'b.desktop']);
    assertEquals(Object.keys(r.folders), []);
});

test('move is remove-at-from, insert-at-to', () => {
    assertEquals(ids(ops.move(base(), 0, 2)), ['b.desktop', 'c.desktop', 'a.desktop']);
    assertEquals(ids(ops.move(base(), 2, 0)), ['c.desktop', 'a.desktop', 'b.desktop']);
    assertEquals(ids(ops.move(base(), 0, 1)), ['b.desktop', 'a.desktop', 'c.desktop']);
});

test('move clamps the destination and ignores bad sources', () => {
    assertEquals(ids(ops.move(base(), 0, 99)), ['b.desktop', 'c.desktop', 'a.desktop']);
    assertEquals(ids(ops.move(base(), 2, -5)), ['c.desktop', 'a.desktop', 'b.desktop']);
    const s = base();
    assert(ops.move(s, 5, 0) === s);
    assert(ops.move(s, -1, 0) === s);
    assert(ops.move(s, 1, 1) === s);
});

test('createFolder replaces the first moved app slot by default', () => {
    const r = ops.createFolder(base(), 'F', 'New', ['b.desktop', 'c.desktop']);
    assertEquals(r.top, [app('a'), folder('F', 'New')]);
    assertEquals(r.folders.F, [app('b'), app('c')]);
});

test('createFolder with an explicit index (index is into the list before the op)', () => {
    // b and c leave the list; slot 3 (end) lands at the end of the shortened list
    let r = ops.createFolder(base(), 'F', 'N', ['a.desktop', 'b.desktop'], 3);
    assertEquals(ids(r), ['c.desktop', 'F']);
    // slot 0 stays at 0
    r = ops.createFolder(base(), 'F', 'N', ['c.desktop'], 0);
    assertEquals(ids(r), ['F', 'a.desktop', 'b.desktop']);
    // slot 2 (before c) with a removed in front -> position 1
    r = ops.createFolder(base(), 'F', 'N', ['a.desktop'], 2);
    assertEquals(ids(r), ['b.desktop', 'F', 'c.desktop']);
});

test('createFolder with unpinned ids appends at the end', () => {
    const r = ops.createFolder(base(), 'F', 'N', ['q.desktop', 'r.desktop']);
    assertEquals(ids(r), ['a.desktop', 'b.desktop', 'c.desktop', 'F']);
    assertEquals(r.folders.F, [app('q'), app('r')]);
});

test('createFolder keeps custom entry fields and dedupes ids', () => {
    const custom = {id: 'gnome-terminal', name: 'Term', icon: 'utilities-terminal'};
    const r = ops.createFolder(snap([custom, app('a')]), 'F', 'N', ['gnome-terminal', 'a.desktop', 'a.desktop']);
    assertEquals(r.folders.F, [custom, app('a')]);
});

test('createFolder pulling the last app out of another folder deletes that folder', () => {
    const s = snap([folder('F', 'Old'), app('b')], {F: [app('x')]});
    const r = ops.createFolder(s, 'G', 'New', ['x.desktop', 'b.desktop']);
    assertEquals(r.top, [folder('G', 'New')]);
    assertEquals(Object.keys(r.folders), ['G']);
    assertEquals(r.folders.G, [app('x'), app('b')]);
});

test('createFolder ignores an existing uuid and folder ids', () => {
    const s = withFolder();
    assert(ops.createFolder(s, 'F', 'again', ['a.desktop']) === s);
    const r = ops.createFolder(s, 'G', 'N', ['F', 'a.desktop']);
    assertEquals(r.folders.G, [app('a')]);
    assert(ops.isPinnedIn(r, 'F'));
});

test('renameFolder changes the folder entry name', () => {
    const r = ops.renameFolder(withFolder(), 'F', 'Renamed');
    assertEquals(r.top[1], folder('F', 'Renamed'));
    const s = withFolder();
    assert(ops.renameFolder(s, 'F', 'Fold') === s);
    assert(ops.renameFolder(s, 'nope', 'x') === s);
});

test('deleteFolder removes the folder and unpins its apps', () => {
    const r = ops.deleteFolder(withFolder(), 'F');
    assertEquals(ids(r), ['a.desktop', 'b.desktop']);
    assert(!ops.isPinnedIn(r, 'x.desktop'));
    assertEquals(Object.keys(r.folders), []);
});

test('dissolveFolder moves the contents to the folder slot, nothing is unpinned', () => {
    const s = withFolder();
    const before = JSON.stringify(s);
    const r = ops.dissolveFolder(s, 'F');
    assertEquals(ids(r), ['a.desktop', 'x.desktop', 'y.desktop', 'b.desktop']);
    assertEquals(Object.keys(r.folders), []);
    assert(ops.isPinnedIn(r, 'x.desktop') && ops.isPinnedIn(r, 'y.desktop'));
    assertEquals(JSON.stringify(s), before, 'input not mutated');
    assert(ops.dissolveFolder(s, 'nope') === s, 'unknown folder is a no-op');
});

test('dissolveFolder of an empty folder just removes it; a folder list without a top entry is dropped', () => {
    const empty = snap([app('a'), folder('E', 'Empty')], {E: []});
    assertEquals(ids(ops.dissolveFolder(empty, 'E')), ['a.desktop']);
    const orphan = snap([app('a')], {O: [app('z')]});
    const r = ops.dissolveFolder(orphan, 'O');
    assertEquals(Object.keys(r.folders), []);
    assertEquals(ids(r), ['a.desktop', 'z.desktop']);
});

test('addToFolder moves a top-level app into the folder', () => {
    const r = ops.addToFolder(withFolder(), 'F', 'a.desktop');
    assertEquals(ids(r), ['F', 'b.desktop']);
    assertEquals(r.folders.F, [app('x'), app('y'), app('a')]);
});

test('addToFolder at an index and from an unpinned id', () => {
    let r = ops.addToFolder(withFolder(), 'F', 'b.desktop', 0);
    assertEquals(r.folders.F, [app('b'), app('x'), app('y')]);
    r = ops.addToFolder(withFolder(), 'F', 'new.desktop', 1);
    assertEquals(r.folders.F, [app('x'), app('new'), app('y')]);
    assertEquals(ids(r), ['a.desktop', 'F', 'b.desktop']);
});

test('addToFolder from another folder empties and deletes the source folder', () => {
    const s = snap([folder('F', 'F'), folder('G', 'G')], {F: [app('x'), app('y')], G: [app('z')]});
    const r = ops.addToFolder(s, 'F', 'z.desktop');
    assertEquals(ids(r), ['F']);
    assertEquals(r.folders.F, [app('x'), app('y'), app('z')]);
    assertEquals(Object.keys(r.folders), ['F']);
});

test('addToFolder with an id already in that folder reorders it', () => {
    const s = snap([folder('F', 'F')], {F: [app('x'), app('y'), app('z')]});
    assertEquals(ops.addToFolder(s, 'F', 'x.desktop', 3).folders.F, [app('y'), app('z'), app('x')]);
    assertEquals(ops.addToFolder(s, 'F', 'z.desktop', 0).folders.F, [app('z'), app('x'), app('y')]);
});

test('addToFolder rejects unknown folders and folder ids', () => {
    const s = withFolder();
    assert(ops.addToFolder(s, 'nope', 'a.desktop') === s);
    assert(ops.addToFolder(s, 'F', 'F') === s);
});

test('removeFromFolder moves the app to the end of the top level by default', () => {
    const r = ops.removeFromFolder(withFolder(), 'F', 'x.desktop');
    assertEquals(ids(r), ['a.desktop', 'F', 'b.desktop', 'x.desktop']);
    assertEquals(r.folders.F, [app('y')]);
});

test('removeFromFolder to an index', () => {
    const r = ops.removeFromFolder(withFolder(), 'F', 'x.desktop', 0);
    assertEquals(ids(r), ['x.desktop', 'a.desktop', 'F', 'b.desktop']);
});

test('removeFromFolder of the last app deletes the folder and adjusts the index', () => {
    const s = snap([app('a'), folder('F', 'F'), app('b')], {F: [app('x')]});
    // slot 3 = end of the visible list [a, F, b]; folder disappears so it is index 2
    const r = ops.removeFromFolder(s, 'F', 'x.desktop', 3);
    assertEquals(ids(r), ['a.desktop', 'b.desktop', 'x.desktop']);
    assertEquals(Object.keys(r.folders), []);
    // slot 0 is in front of the folder: unchanged
    assertEquals(ids(ops.removeFromFolder(s, 'F', 'x.desktop', 0)), ['x.desktop', 'a.desktop', 'b.desktop']);
    // default (undefined) appends
    assertEquals(ids(ops.removeFromFolder(s, 'F', 'x.desktop')), ['a.desktop', 'b.desktop', 'x.desktop']);
});

test('removeFromFolder ignores ids that are not in the folder', () => {
    const s = withFolder();
    assert(ops.removeFromFolder(s, 'F', 'a.desktop') === s);
    assert(ops.removeFromFolder(s, 'nope', 'x.desktop') === s);
});

test('visibleToRaw / visibleToRawMove map hidden-entry indices', () => {
    // raw [A, x(hidden), B, C] -> visible raw indices [0, 2, 3]
    const vis = [0, 2, 3];
    assertEquals(ops.visibleToRaw(vis, 4, 1), 2);
    assertEquals(ops.visibleToRaw(vis, 4, 3), 4);
    assertEquals(ops.visibleToRaw(vis, 4, undefined), undefined);
    assertEquals(ops.visibleToRawMove(vis, 4, 2), 3);
    assertEquals(ops.visibleToRawMove(vis, 4, 0), 0);
    assertEquals(ops.visibleToRawMove(vis, 4, 99), 3);
});

run();
