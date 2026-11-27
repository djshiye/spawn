// Regression: the prefs window's Gio.Settings (`settings.raw`, which every row is bound to) must never be
// left in delay-apply mode by Reset / Undo / Import, or later writes stay pending and never reach dconf.
// Every check writes through the prefs instance and reads through a SECOND Gio.Settings on the same
// in-memory backend (the "shell"), and the other way round. Nothing touches the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

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
const {resetKeys, resetWithUndo, isModified, spinBounds, spinRow, optionalSpinRow, subpageRow, watch} = await import('../build/prefs/widgets.js');
const {friendlyIconName} = await import('../build/prefs/iconName.js');

const {keyAction} = await import('../build/prefs/shortcutDialog.js');

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

test('isModified follows the settings live: only a value that differs from the default counts', () => {
    const {prefs} = fixture();
    const ctx = {settings: prefs};
    assertEquals(isModified(ctx, ['menu-height', 'left-panel-width']), false);
    prefs.set('menu-height', 700);
    assertEquals(isModified(ctx, ['menu-height', 'left-panel-width']), true);
    assertEquals(isModified(ctx, ['left-panel-width']), false);
    prefs.set('menu-height', 600); // written, but equal to the default
    assertEquals(isModified(ctx, ['menu-height']), false);
    prefs.set('menu-height', 700);
    resetKeys(ctx, ['menu-height']);
    assertEquals(isModified(ctx, ['menu-height']), false);
});

test('friendlyIconName shows a tidy label, never a raw file name', () => {
    assertEquals(friendlyIconName('icon-apps-symbolic'), 'Icon apps');
    assertEquals(friendlyIconName('distro-fedora.svg'), 'Fedora');
    assertEquals(friendlyIconName('start-here-symbolic.svg'), 'Start here');
    assertEquals(friendlyIconName('/home/me/Pictures/logo.png'), 'logo.png');
});

test('shortcut dialog: keyboard can confirm and navigate', () => {
    const C = Gdk.ModifierType.CONTROL_MASK, A = Gdk.ModifierType.ALT_MASK, S = Gdk.ModifierType.SHIFT_MASK,
        W = Gdk.ModifierType.SUPER_MASK;
    const rows = [
        [Gdk.KEY_Escape, 0, false, false, 'cancel'],
        [Gdk.KEY_BackSpace, 0, true, false, 'clear'],
        [Gdk.KEY_Tab, 0, true, false, 'pass'],
        [Gdk.KEY_ISO_Left_Tab, S, true, false, 'pass'],
        [Gdk.KEY_Tab, C, false, false, 'pass'],
        [Gdk.KEY_Return, 0, true, false, 'confirm'],
        [Gdk.KEY_KP_Enter, 0, true, false, 'confirm'],
        [Gdk.KEY_space, 0, true, false, 'confirm'],
        [Gdk.KEY_Return, 0, false, false, 'warn'],
        [Gdk.KEY_Return, 0, true, true, 'pass'],
        [Gdk.KEY_space, 0, true, true, 'pass'],
        [Gdk.KEY_k, C | A, false, false, 'capture', Gtk.accelerator_name(Gdk.KEY_k, C | A)],
        [Gdk.KEY_K, C | A | S, false, false, 'capture', Gtk.accelerator_name(Gdk.KEY_k, C | A | S)],
        [Gdk.KEY_Return, C, true, false, 'capture', '<Control>Return'],
        [Gdk.KEY_space, W, true, false, 'capture', '<Super>space'],
        [Gdk.KEY_F5, 0, false, false, 'capture', 'F5'],
        [Gdk.KEY_a, 0, false, false, 'warn'],
        [Gdk.KEY_a, S, false, false, 'warn'],
        [Gdk.KEY_Control_L, C, false, false, 'ignore'],
    ];
    for (const [keyval, mask, pending, other, kind, accel] of rows) {
        const r = keyAction(keyval, mask, pending, other);
        assertEquals(r.kind, kind, `key ${keyval} mask ${mask}`);
        if (accel !== undefined)
            assertEquals(r.accel, accel, `accel for key ${keyval} mask ${mask}`);
    }
});

test('spinBounds uses the schema range for ranged keys and the caller\'s bounds otherwise', () => {
    const {prefs} = fixture();
    assertEquals(spinBounds(prefs.raw, 'max-search-results', 1, 20), [1, 50]);
    assertEquals(spinBounds(prefs.raw, 'menu-button-icon-size', 14, 64), [8, 64]);
    assertEquals(spinBounds(prefs.raw, 'menu-button-padding', -1, 25), [-1, 64]);
    assertEquals(spinBounds(prefs.raw, 'icon-size-apps', -1, 64), [-1, 128]);
    assertEquals(spinBounds(prefs.raw, 'menu-button-position-offset', 0, 20), [0, 20]);
    assertEquals(spinBounds(prefs.raw, 'menu-arrow-rise', 0, 50), [0, 50]);
    assertEquals(spinBounds(prefs.raw, 'no-such-key', 3, 7), [3, 7]);
});

test('spin rows show a valid stored value above the call site\'s bounds and never overwrite an external write', () => {
    if (!Gtk.init_check()) {
        print('  skipped: no display (run under xvfb-run)');
        return;
    }
    Adw.init();
    const {prefs, shell} = fixture();
    const ctx = {settings: prefs, window: new Adw.PreferencesWindow()};
    prefs.raw.set_int('max-search-results', 30);
    const row = spinRow(ctx, 'max-search-results', 'R', 1, 20);
    assertEquals(row.value, 30);
    row.get_adjustment().set_value(29);
    assertEquals(shell.get_int('max-search-results'), 29);

    prefs.set('menu-button-border-radius', [true, 10]);
    optionalSpinRow(ctx, 'menu-button-border-radius', 'R', 0, 25);
    shell.set_value('menu-button-border-radius', new GLib.Variant('(bi)', [true, 40]));
    assertEquals(prefs.get('menu-button-border-radius'), [true, 40]);
});

test('visiting a sub-page twice leaves only the latest visit\'s watchers connected', () => {
    if (!Gtk.init_check()) {
        print('  skipped: no display (run under xvfb-run)');
        return;
    }
    Adw.init();
    const {prefs} = fixture();
    const ctx = {settings: prefs, window: Object.assign(new Adw.PreferencesWindow(), {push_subpage() {}})};
    let count = 0;
    const row = subpageRow(ctx, {title: 'T', build: () => {
        const g = new Adw.PreferencesGroup();
        watch(ctx, g, ['menu-height'], () => count++);
        return [g];
    }});
    row.emit('activated');
    row.emit('activated');
    prefs.set('menu-height', 777);
    assertEquals(count, 1);
});

run();
