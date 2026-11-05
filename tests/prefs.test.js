// Regression: the prefs window's Gio.Settings (`settings.raw`, which every row is bound to) must never be
// left in delay-apply mode by Reset / Undo / Import, or later writes stay pending and never reach dconf.
// Every check writes through the prefs instance and reads through a SECOND Gio.Settings on the same
// in-memory backend (the "shell"), and the other way round. Nothing touches the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, assertEquals, run, test} from './harness.js';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const tmp = GLib.dir_make_tmp('spawn-prefs-test-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn.gschema.xml']);
Gio.File.new_for_path(xml).copy(Gio.File.new_for_path(GLib.build_filenamev([tmp, 'schema.gschema.xml'])), Gio.FileCopyFlags.OVERWRITE, null, null);
const [ok, , err] = GLib.spawn_command_line_sync(`glib-compile-schemas ${tmp}`);
if (!ok)
    throw new Error(`glib-compile-schemas failed: ${err}`);
const source = Gio.SettingsSchemaSource.new_from_directory(tmp, Gio.SettingsSchemaSource.get_default(), false);
GLib.spawn_command_line_sync(`rm -rf ${tmp}`); // the compiled schema is already loaded

const {SpawnSettings, SCHEMA_ID, FOLDER_SCHEMA_ID, FolderSettings} = await import('../build/core/settings.js');
const {applyMigration} = await import('../build/migrate/arcmenu.js');
const {resetKeys, resetWithUndo} = await import('../build/prefs/widgets.js');

const PATH = '/org/gnome/shell/extensions/spawn/';

/** `prefs` is the SpawnSettings the window uses; `shell` is another Gio.Settings on the same backend. */
function fixture() {
    const backend = Gio.memory_settings_backend_new();
    const schema = source.lookup(SCHEMA_ID, true);
    const prefs = new SpawnSettings(Gio.Settings.new_full(schema, backend, PATH), source);
    const shell = Gio.Settings.new_full(schema, backend, PATH);
    return {prefs, shell, backend};
}

/** Writing through `prefs` after `action` must reach `shell`, and writing through `shell` must reach `prefs`. */
function assertPropagates(prefs, shell, what) {
    assertEquals(prefs.raw.delay_apply, false, `${what}: prefs.raw is in delay-apply mode`);
    assertEquals(prefs.raw.has_unapplied, false, `${what}: prefs.raw has pending writes`);
    prefs.set('menu-height', 800);
    assertEquals(prefs.raw.has_unapplied, false, `${what}: a write stayed pending`);
    assertEquals(shell.get_int('menu-height'), 800, `${what}: prefs write did not reach the second instance`);
    prefs.set('hide-activities-button', true);
    assertEquals(shell.get_boolean('hide-activities-button'), true, `${what}: boolean write did not propagate`);
    prefs.set('pinned-apps', [{id: 'x.desktop'}]);
    assertEquals(shell.get_value('pinned-apps').recursiveUnpack(), [{id: 'x.desktop'}], `${what}: list write did not propagate`);
    shell.set_int('menu-height', 650);
    assertEquals(prefs.get('menu-height'), 650, `${what}: the second instance's write is not seen by prefs`);
}

const planOf = (items, folders = []) => ({items: items.map(([key, value, differs = true]) => ({key, from: key, value, differsFromDefault: differs})), folders, skipped: [], warnings: []});

test('baseline: a plain write reaches a second instance', () => {
    const {prefs, shell} = fixture();
    assertPropagates(prefs, shell, 'baseline');
});

test('resetKeys leaves settings.raw out of delay mode and resets the keys for everyone', () => {
    const {prefs, shell} = fixture();
    prefs.set('menu-height', 900);
    prefs.set('menu-button-icon-size', 40);
    resetKeys({settings: prefs}, ['menu-height', 'menu-button-icon-size']);
    assertEquals(shell.get_int('menu-height'), 600);
    assert(shell.get_user_value('menu-button-icon-size') === null, 'reset key is still set');
    assertPropagates(prefs, shell, 'resetKeys');
});

test('resetWithUndo + Undo (restore) keep settings.raw writable', () => {
    const {prefs, shell} = fixture();
    prefs.set('menu-height', 900);
    const toasts = [];
    const ctx = {settings: prefs, window: {add_toast: t => toasts.push(t)}};
    resetWithUndo(ctx, ['menu-height'], 'reset');
    assertEquals(shell.get_int('menu-height'), 600);
    assertPropagates(prefs, shell, 'resetWithUndo');

    // The Undo button of the toast.
    prefs.set('menu-height', 900);
    resetWithUndo(ctx, ['menu-height'], 'reset again');
    toasts[toasts.length - 1].emit('button-clicked');
    assertEquals(shell.get_int('menu-height'), 900, 'undo did not restore the value');
    assertPropagates(prefs, shell, 'undo');
});

test('restore(snapshot) restores values and keeps settings.raw writable', () => {
    const {prefs, shell} = fixture();
    prefs.set('menu-height', 700);
    const snap = prefs.snapshot(['menu-height', 'menu-button-icon-size']);
    prefs.set('menu-height', 900);
    prefs.set('menu-button-icon-size', 44);
    prefs.restore(snap);
    assertEquals(shell.get_int('menu-height'), 700);
    assert(shell.get_user_value('menu-button-icon-size') === null, 'unset value was not reset');
    assertPropagates(prefs, shell, 'restore');
});

test('applyMigration + its Undo keep settings.raw writable', () => {
    const {prefs, shell} = fixture();
    prefs.set('menu-button-icon-size', 33);
    const result = applyMigration(planOf([['menu-button-icon-size', 20, false], ['menu-height', 800]]), prefs);
    assertEquals(shell.get_int('menu-height'), 800, 'import did not reach the second instance');
    assert(shell.get_user_value('menu-button-icon-size') === null, 'default-equal item was not reset');
    assertEquals(shell.get_boolean('migration-done'), true);
    assertPropagates(prefs, shell, 'applyMigration');

    prefs.restore(result.undo);
    assertEquals(shell.get_int('menu-button-icon-size'), 33, 'undo did not restore the value');
    assertEquals(shell.get_boolean('migration-done'), false);
    assertPropagates(prefs, shell, 'undo of the import');
});

test('a failed import (batch revert) leaves settings.raw writable and writes nothing', () => {
    const {prefs, shell} = fixture();
    let threw = false;
    try {
        applyMigration(planOf([['menu-height', 800], ['no-such-key', 1]]), prefs);
    } catch {
        threw = true;
    }
    assert(threw, 'expected the import to throw');
    assertEquals(shell.get_int('menu-height'), 600);
    assertPropagates(prefs, shell, 'failed import');
});

test('folders written by the import are visible to a second instance', () => {
    const {prefs, backend} = fixture();
    const uuid = '3c2219f1-a114-4e2e-a06c-51fdefa91991';
    applyMigration(planOf([['pinned-apps', [{id: uuid, name: 'G', isFolder: 'true'}]]], [{uuid, name: 'G', pinnedApps: [{id: 'a.desktop'}]}]), prefs);
    const other = new FolderSettings(uuid, Gio.Settings.new_full(source.lookup(FOLDER_SCHEMA_ID, true), backend, `${PATH}folders/${uuid}/`));
    assertEquals(other.pinnedApps, [{id: 'a.desktop'}]);
    assertEquals(other.name, 'G');
});

test('SpawnSettings.batch: reverts everything when the callback throws, and reports rejected values', () => {
    const {prefs, shell} = fixture();
    let threw = false;
    try {
        prefs.batch(tx => {
            tx.set('menu-height', 900);
            throw new Error('boom');
        });
    } catch {
        threw = true;
    }
    assert(threw, 'batch did not rethrow');
    assertEquals(shell.get_int('menu-height'), 600);
    prefs.batch(tx => {
        assertEquals(tx.set('left-panel-width', 10), false);
        assertEquals(tx.set('menu-height', 900), true);
    });
    assertEquals(shell.get_int('menu-height'), 900);
    assertEquals(shell.get_int('left-panel-width'), 420);
});

run();
