// PinnedStore over real Gio.Settings (in-memory backend, schema compiled into a temp dir),
// so nothing touches the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {FOLDER_SCHEMA_ID, FolderSettings, SCHEMA_ID, SpawnSettings} from '../build/core/settings.js';
import {PinnedStore} from '../build/model/pinned.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

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

test('items maps apps, folders and custom entries', () => {
    const custom = {id: 'foo --bar', name: 'Foo', icon: 'x'};
    const {store, scope} = fixture([app('a'), folder('F1', 'Fold'), custom], {F1: [app('x')]});
    assertEquals(store.items(), [{kind: 'app', id: 'a.desktop'}, {kind: 'folder', uuid: 'F1', name: 'Fold'}, {kind: 'custom', entry: custom}]);
    scope.dispose();
});

test('missing apps are skipped, flagged on request, and never deleted from settings', () => {
    const {store, settings, scope} = fixture([app('a'), app('gone'), app('b')], {}, new Set(['gone.desktop']));
    assertEquals(store.items().map(i => i.id), ['a.desktop', 'b.desktop']);
    assertEquals(store.items(true).map(i => i.missing ?? false), [false, true, false]);
    // visible indices skip the missing entry
    store.move(0, 1);
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['gone.desktop', 'b.desktop', 'a.desktop']);
    store.pin('c.desktop', 1);
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['gone.desktop', 'b.desktop', 'c.desktop', 'a.desktop']);
    scope.dispose();
});

test('pin / unpin / isPinned write through', () => {
    const {store, settings, scope} = fixture([app('a')]);
    store.pin('b.desktop');
    store.pin('b.desktop');
    assertEquals(settings.get('pinned-apps'), [app('a'), app('b')]);
    assert(store.isPinned('b.desktop'));
    store.unpin('a.desktop');
    assert(!store.isPinned('a.desktop'));
    assertEquals(settings.get('pinned-apps'), [app('b')]);
    scope.dispose();
});

test('createFolder writes the folder schema and the top level entry', () => {
    const {store, settings, scope} = fixture([app('a'), app('b'), app('c')]);
    const uuid = store.createFolder('Fold', ['a.desktop', 'b.desktop']);
    assertEquals(settings.get('pinned-apps'), [folder(uuid, 'Fold'), app('c')]);
    const f = settings.folder(uuid);
    assertEquals(f.name, 'Fold');
    assertEquals(f.pinnedApps, [app('a'), app('b')]);
    assertEquals(store.folderApps(uuid), [app('a'), app('b')]);
    assert(store.isPinned('a.desktop'));
    scope.dispose();
});

test('rename, add, remove and empty-folder cleanup', () => {
    const {store, settings, scope} = fixture([app('a'), app('b')]);
    const uuid = store.createFolder('Fold', ['a.desktop']);
    store.renameFolder(uuid, 'Renamed');
    assertEquals(settings.folder(uuid).name, 'Renamed');
    assertEquals(store.items()[0], {kind: 'folder', uuid, name: 'Renamed'});

    store.addToFolder(uuid, 'b.desktop');
    assertEquals(store.folderApps(uuid), [app('a'), app('b')]);
    assertEquals(settings.get('pinned-apps'), [folder(uuid, 'Renamed')]);

    store.removeFromFolder(uuid, 'a.desktop');
    assertEquals(settings.get('pinned-apps'), [folder(uuid, 'Renamed'), app('a')]);

    store.removeFromFolder(uuid, 'b.desktop', 0);
    // folder is empty now: entry and dconf keys are gone
    assertEquals(settings.get('pinned-apps'), [app('b'), app('a')]);
    assertEquals(settings.folder(uuid).pinnedApps, []);
    assertEquals(settings.folder(uuid).name, '');
    scope.dispose();
});

test('deleteFolder resets folder keys and unpins its apps', () => {
    const {store, settings, scope} = fixture([app('a')]);
    const uuid = store.createFolder('Fold', ['a.desktop']);
    store.deleteFolder(uuid);
    assertEquals(settings.get('pinned-apps'), []);
    assertEquals(settings.folder(uuid).pinnedApps, []);
    assert(!store.isPinned('a.desktop'));
    scope.dispose();
});

test('dissolveFolder keeps the apps pinned at the folder slot and resets the folder keys', () => {
    const {store, settings, scope} = fixture([app('a'), app('b')]);
    const uuid = store.createFolder('Fold', ['b.desktop']);
    store.pin('c.desktop');
    store.dissolveFolder(uuid);
    assertEquals(settings.get('pinned-apps'), [app('a'), app('b'), app('c')]);
    assertEquals(settings.folder(uuid).pinnedApps, []);
    assert(store.isPinned('b.desktop'));
    scope.dispose();
});

test('onChanged fires once per operation and stops after its scope is disposed', () => {
    const {store, scope} = fixture([app('a'), app('b')]);
    const listener = new Scope('l');
    let n = 0;
    store.onChanged(listener, () => n++);
    store.createFolder('F', ['a.desktop', 'b.desktop']);
    assertEquals(n, 1);
    store.pin('c.desktop');
    assertEquals(n, 2);
    store.pin('c.desktop'); // no-op
    assertEquals(n, 2);
    listener.dispose();
    store.pin('d.desktop');
    assertEquals(n, 2);
    scope.dispose();
});

test('moveShown uses the shown index space (ghosts count) and moveInFolder reorders a folder', () => {
    const {store, settings, scope} = fixture([app('a'), app('gone'), app('b'), folder('F1', 'Fold')], {F1: [app('x'), app('y'), app('z')]}, new Set(['gone.desktop']));
    // shown: a, gone, b, F1
    store.moveShown(2, 1);
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['a.desktop', 'b.desktop', 'gone.desktop', 'F1']);
    store.moveShown(0, 3);
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['b.desktop', 'gone.desktop', 'F1', 'a.desktop']);
    store.moveShown(9, 0); // out of range from: no-op
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['b.desktop', 'gone.desktop', 'F1', 'a.desktop']);
    let n = 0;
    store.onChanged(scope, () => n++);
    store.moveInFolder('F1', 0, 2);
    assertEquals(settings.folder('F1').pinnedApps.map(e => e.id), ['y.desktop', 'z.desktop', 'x.desktop']);
    assertEquals(n, 1);
    store.moveInFolder('F1', 2, 2); // no-op, no notification
    assertEquals(n, 1);
    scope.dispose();
});

test('captureFolder + dissolveFolder + restoreFolder brings the folder back exactly', () => {
    const {store, settings, scope} = fixture(
        [app('a'), folder('F1', 'Fold'), app('b'), folder('F2', 'Other')],
        {F1: [app('x'), app('y'), app('z')], F2: [app('q')]},
    );
    settings.folder('F1').name = 'Fold';
    const topBefore = settings.get('pinned-apps');
    const folderBefore = settings.folder('F1').pinnedApps;
    const undo = store.captureFolder('F1');
    assert(undo !== null);
    assertEquals(undo.name, 'Fold');
    store.dissolveFolder('F1');
    store.markDissolved(undo);
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['a.desktop', 'x.desktop', 'y.desktop', 'z.desktop', 'b.desktop', 'F2']);
    assertEquals(settings.folder('F1').pinnedApps, []);
    assert(store.isUnchangedSince(undo));
    assert(store.restoreFolder(undo));
    assertEquals(settings.get('pinned-apps'), topBefore);
    assertEquals(settings.folder('F1').pinnedApps, folderBefore);
    assertEquals(settings.folder('F1').name, 'Fold');
    assertEquals(store.items().map(i => i.kind === 'folder' ? i.name : i.id), ['a.desktop', 'Fold', 'b.desktop', 'Other']);
    assertEquals(store.folderApps('F1').map(e => e.id), ['x.desktop', 'y.desktop', 'z.desktop']);
    scope.dispose();
});

test('restoreFolder refuses once the pinned list changed after the dissolve', () => {
    const {store, settings, scope} = fixture([app('a'), folder('F1', 'Fold')], {F1: [app('x')]});
    const undo = store.captureFolder('F1');
    store.dissolveFolder('F1');
    store.markDissolved(undo);
    store.pin('late.desktop');
    assert(!store.isUnchangedSince(undo));
    assert(!store.restoreFolder(undo));
    assertEquals(settings.get('pinned-apps').map(e => e.id), ['a.desktop', 'x.desktop', 'late.desktop']);
    assertEquals(store.captureFolder('nope'), null);
    scope.dispose();
});

test('external changes to a folder or to pinned-apps notify listeners', () => {
    const {store, settings, scope} = fixture([app('a'), app('b')]);
    const uuid = store.createFolder('F', ['a.desktop']);
    let n = 0;
    store.onChanged(scope, () => n++);
    // simulate another process: write through separate Settings objects
    settings.folder(uuid).pinnedApps = [app('a'), app('z')];
    sleep(100);
    assert(n >= 1, 'folder change notified');
    const before = n;
    settings.set('pinned-apps', [app('q')]);
    sleep(100);
    assert(n > before, 'pinned-apps change notified');
    assertEquals(store.items().map(i => i.id), ['q.desktop']);
    scope.dispose();
});

run();
