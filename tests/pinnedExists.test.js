// PinnedStore's default "desktop file exists" lookup is cached until invalidate() (the wiring that calls it on
// installed-changed lives in Services). XDG_DATA_HOME is set before GIO first reads the desktop dirs.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const data = GLib.dir_make_tmp('spawn-xdg-XXXXXX');
GLib.setenv('XDG_DATA_HOME', data, true);
GLib.mkdir_with_parents(`${data}/applications`, 0o755);

import {Scope} from '../build/core/scope.js';
import {FOLDER_SCHEMA_ID, FolderSettings, SCHEMA_ID, SpawnSettings} from '../build/core/settings.js';
import {PinnedStore} from '../build/model/pinned.js';
import {assertEquals, run, sleep, test} from './harness.js';

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


test('the desktop-file-exists answer is cached until invalidate()', async () => {
    const settings = new MemSettings(Gio.Settings.new_full(source.lookup(SCHEMA_ID, true), backend, null), source);
    settings.set('pinned-apps', [{id: 'm5probe.desktop'}]);
    const store = new PinnedStore(new Scope('t'), settings);
    assertEquals(store.items(), []);
    GLib.file_set_contents(`${data}/applications/m5probe.desktop`, '[Desktop Entry]\nType=Application\nName=P\nExec=true\n');
    await sleep(1200); // GIO's file monitor
    assertEquals(store.items(), [], 'still the cached answer');
    store.invalidate();
    assertEquals(store.items(), [{kind: 'app', id: 'm5probe.desktop'}]);
});

run();
