// Drop logic of the pinned list (model/pinnedDrop.ts) for apps dragged out of All Apps / categories / results, over a
// real PinnedStore on Gio.Settings (in-memory backend), so nothing touches the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {FOLDER_SCHEMA_ID, FolderSettings, SCHEMA_ID, SpawnSettings} from '../build/core/settings.js';
import {PinnedStore} from '../build/model/pinned.js';
import {canDrop, performDrop} from '../build/model/pinnedDrop.js';
import {assert, assertEquals, run, test} from './harness.js';

const tmp = GLib.dir_make_tmp('spawn-test-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn.gschema.xml']);
Gio.File.new_for_path(xml).copy(Gio.File.new_for_path(GLib.build_filenamev([tmp, 'schema.gschema.xml'])), Gio.FileCopyFlags.OVERWRITE, null, null);
const [ok, , err] = GLib.spawn_command_line_sync(`glib-compile-schemas ${tmp}`);
if (!ok)
    throw new Error(`glib-compile-schemas failed: ${err}`);

const source = Gio.SettingsSchemaSource.new_from_directory(tmp, Gio.SettingsSchemaSource.get_default(), false);
const backend = Gio.memory_settings_backend_new();
GLib.spawn_command_line_sync(`rm -rf ${tmp}`); // the compiled schema is already loaded

class MemSettings extends SpawnSettings {
    folder(uuid) {
        const schema = source.lookup(FOLDER_SCHEMA_ID, true);
        return new FolderSettings(uuid, Gio.Settings.new_full(schema, backend, `/org/gnome/shell/extensions/spawn/folders/${uuid}/`));
    }
}

let counter = 0;
function fixture(top, folders = {}, missing = new Set()) {
    const raw = Gio.Settings.new_full(source.lookup(SCHEMA_ID, true), backend, null);
    const settings = new MemSettings(raw, source);
    settings.set('pinned-apps', top);
    for (const [uuid, list] of Object.entries(folders))
        settings.folder(uuid).pinnedApps = list;
    const scope = new Scope('t');
    const store = new PinnedStore(scope, settings, {
        exists: id => !missing.has(id),
        newUuid: () => `uuid-${++counter}`,
    });
    return {settings, scope, store};
}

const app = id => ({id: `${id}.desktop`});
const folder = (uuid, name) => ({id: uuid, name, isFolder: 'true'});

const ids = store => store.items().map(i => (i.kind === 'folder' ? `[${i.uuid}]` : i.kind === 'app' ? i.id.replace('.desktop', '') : i.entry.id));
const name = () => 'New Folder';
// an app dragged out of All Apps / a category / the results
const fromList = (id, extra = {}) => ({id: `${id}.desktop`, fromList: true, ...extra});

test('a list app dropped between pinned apps is pinned at that slot', () => {
    const {store, scope} = fixture([app('a'), app('b'), app('c')]);
    assert(performDrop(store, {kind: 'app', id: 'b.desktop'}, fromList('x'), 'before', name));
    assertEquals(ids(store), ['a', 'x', 'b', 'c']);
    assert(performDrop(store, {kind: 'app', id: 'c.desktop'}, fromList('y'), 'after', name));
    assertEquals(ids(store), ['a', 'x', 'b', 'c', 'y']);
    scope.dispose();
});

test('a list app dropped onto a pinned app makes a folder holding both', () => {
    const {store, scope} = fixture([app('a'), app('b')]);
    assert(performDrop(store, {kind: 'app', id: 'a.desktop'}, fromList('x'), 'onto', name));
    const items = store.items();
    assertEquals(items.length, 2);
    assertEquals(items[0].kind, 'folder');
    assertEquals(store.folderApps(items[0].uuid).map(e => e.id), ['a.desktop', 'x.desktop']);
    scope.dispose();
});

test('a list app dropped onto a folder, or onto a folder tile of a popup, joins it', () => {
    const {store, scope} = fixture([app('a'), folder('F', 'Fold')], {F: [app('p'), app('q')]});
    assert(performDrop(store, {kind: 'folder', uuid: 'F'}, fromList('x'), 'onto', name));
    assertEquals(store.folderApps('F').map(e => e.id), ['p.desktop', 'q.desktop', 'x.desktop']);
    assert(performDrop(store, {kind: 'app', id: 'q.desktop', folderUuid: 'F'}, fromList('y'), 'before', name));
    assertEquals(store.folderApps('F').map(e => e.id), ['p.desktop', 'y.desktop', 'q.desktop', 'x.desktop']);
    assert(performDrop(store, {kind: 'grid', index: () => -1, folderUuid: 'F'}, fromList('z'), 'onto', name));
    assertEquals(store.folderApps('F').map(e => e.id).pop(), 'z.desktop');
    scope.dispose();
});

test('a list app dropped next to a folder is pinned before / after it', () => {
    const {store, scope} = fixture([app('a'), folder('F', 'Fold'), app('b')], {F: [app('p')]});
    assert(performDrop(store, {kind: 'folder', uuid: 'F'}, fromList('x'), 'after', name));
    assertEquals(ids(store), ['a', '[F]', 'x', 'b']);
    scope.dispose();
});

test('a list app dropped on the grid background goes to the end, or to the wanted index', () => {
    const {store, scope} = fixture([app('a'), app('b')]);
    assert(performDrop(store, {kind: 'grid', index: () => -1}, fromList('x'), 'onto', name));
    assertEquals(ids(store), ['a', 'b', 'x']);
    assert(performDrop(store, {kind: 'grid', index: () => 1}, fromList('y'), 'onto', name));
    assertEquals(ids(store), ['a', 'y', 'b', 'x']);
    scope.dispose();
});

test('an already pinned app dropped from a list moves, never duplicates', () => {
    const {store, scope} = fixture([app('a'), app('b'), app('c')]);
    assert(performDrop(store, {kind: 'app', id: 'a.desktop'}, fromList('c'), 'before', name));
    assertEquals(ids(store), ['c', 'a', 'b']);
    assert(performDrop(store, {kind: 'back'}, fromList('c'), 'onto', name));
    assertEquals(ids(store), ['a', 'b', 'c']);
    assertEquals(store.items().filter(i => i.kind === 'app' && i.id === 'c.desktop').length, 1);
    scope.dispose();
});

test('an app pinned inside a folder, dragged from a list, moves out or between folders', () => {
    const {store, scope} = fixture([app('a'), folder('F', 'Fold'), folder('G', 'Other')], {F: [app('p'), app('q')], G: [app('r')]});
    assert(performDrop(store, {kind: 'app', id: 'a.desktop'}, fromList('p'), 'after', name));
    assertEquals(ids(store), ['a', 'p', '[F]', '[G]']);
    assertEquals(store.folderApps('F').map(e => e.id), ['q.desktop']);
    assert(performDrop(store, {kind: 'folder', uuid: 'G'}, fromList('q'), 'onto', name));
    assertEquals(store.folderApps('G').map(e => e.id), ['r.desktop', 'q.desktop']);
    assert(!store.items().some(i => i.kind === 'folder' && i.uuid === 'F')); // emptied folder is gone
    assert(performDrop(store, {kind: 'back'}, fromList('r'), 'onto', name));
    assertEquals(ids(store).filter(x => x === 'r').length, 1);
    scope.dispose();
});

test('dropping on Back: a list app is pinned at the end; an app of a folder leaves it; a plain pinned app is refused', () => {
    const {store, scope} = fixture([app('a'), folder('F', 'Fold')], {F: [app('p'), app('q')]});
    assert(performDrop(store, {kind: 'back'}, fromList('x'), 'onto', name));
    assertEquals(ids(store), ['a', '[F]', 'x']);
    assert(performDrop(store, {kind: 'back'}, {id: 'p.desktop', folderUuid: 'F'}, 'onto', name));
    assert(ids(store).includes('p'));
    assert(!canDrop({id: 'a.desktop'}, {kind: 'back'}, 'onto'));
    assert(!canDrop({id: 'F', isFolder: true, folderUuid: 'F'}, {kind: 'back'}, 'onto'));
    scope.dispose();
});

test('the drop runs through payload.apply once, and its change is what pins', () => {
    const {store, scope} = fixture([app('a')]);
    let calls = 0;
    const p = fromList('x', {apply: change => {
        calls++;
        assert(!store.isPinned('x.desktop')); // nothing written before apply runs the change
        change();
    }});
    assert(performDrop(store, {kind: 'back'}, p, 'onto', name));
    assertEquals(calls, 1);
    assertEquals(ids(store), ['a', 'x']);
    scope.dispose();
});

test('undo of a drop pin: captureState / restoreFolder puts the list back', () => {
    const {store, scope} = fixture([app('a'), app('b')]);
    const undo = store.captureState('Pinned');
    performDrop(store, {kind: 'app', id: 'b.desktop'}, fromList('x'), 'before', name);
    store.markDissolved(undo);
    assertEquals(ids(store), ['a', 'x', 'b']);
    assert(store.restoreFolder(undo));
    assertEquals(ids(store), ['a', 'b']);
    scope.dispose();
});

test('canDrop rules for a list app match a pinned app (commands excepted)', () => {
    const p = fromList('x');
    assert(canDrop(p, {kind: 'app', id: 'a.desktop'}, 'onto'));
    assert(canDrop(p, {kind: 'folder', uuid: 'F'}, 'onto'));
    assert(canDrop(p, {kind: 'grid', index: () => -1, folderUuid: 'F'}, 'onto'));
    assert(!canDrop(p, {kind: 'unfolder', folderUuid: ''}, 'onto'));
    assert(!canDrop(p, {kind: 'app', id: 'x.desktop'}, 'before')); // onto itself
    // a pinned command is merged into nothing
    assert(!canDrop(p, {kind: 'app', id: 'cmd', isCustom: true}, 'onto'));
    assert(canDrop(p, {kind: 'app', id: 'cmd', isCustom: true}, 'before'));
});

run();
