// PinnedStore over real Gio.Settings (in-memory backend, schema compiled into a temp dir),
// so nothing touches the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {FOLDER_SCHEMA_ID, FolderSettings, SCHEMA_ID, SpawnSettings} from '../build/core/settings.js';
import {PinnedStore} from '../build/model/pinned.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

const tmp = GLib.dir_make_tmp('spawn-menu-test-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn-menu.gschema.xml']);
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
        return new FolderSettings(uuid, Gio.Settings.new_full(schema, backend, `/org/gnome/shell/extensions/spawn-menu/folders/${uuid}/`));
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
