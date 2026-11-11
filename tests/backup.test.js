// Settings backup and restore (build/prefs/backup.js): serialise, validate strictly, apply with Undo, file I/O.
// Runs against the real schema on an in-memory backend; nothing touches the user's dconf or files outside a temp dir.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, assertEquals, run, test} from './harness.js';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const tmp = GLib.dir_make_tmp('spawn-backup-test-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn.gschema.xml']);
const schemaDir = GLib.build_filenamev([tmp, 'schemas']);
GLib.mkdir_with_parents(schemaDir, 0o700);
Gio.File.new_for_path(xml).copy(Gio.File.new_for_path(GLib.build_filenamev([schemaDir, 'schema.gschema.xml'])), Gio.FileCopyFlags.OVERWRITE, null, null);
const [ok, , err] = GLib.spawn_command_line_sync(`glib-compile-schemas ${schemaDir}`);
if (!ok)
    throw new Error(`glib-compile-schemas failed: ${err}`);
const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);

const {SpawnSettings, SCHEMA_ID} = await import('../build/core/settings.js');
const B = await import('../build/prefs/backup.js');

const PATH = '/org/gnome/shell/extensions/spawn/';
const fresh = () => new SpawnSettings(Gio.Settings.new_full(source.lookup(SCHEMA_ID, true), Gio.memory_settings_backend_new(), PATH), source);

/** A configured instance: some scalars, enums, lists and one folder. */
function configured() {
    const s = fresh();
    s.set('menu-height', 700);
    s.set('hide-activities-button', true);
    s.set('position-in-panel', 'Center');
    s.set('hidden-apps', ['a.desktop', 'b.desktop']);
    s.set('known-apps', ['x.desktop']); // internal: must not travel
    s.set('dev-mode', true); // must not travel
    s.set('pinned-apps', [{id: 'one.desktop'}, {id: 'f1', name: 'Games', isFolder: 'true'}]);
    const f = s.folder('f1');
    f.name = 'Games';
    f.pinnedApps = [{id: 'g1.desktop'}, {id: 'g2.desktop'}];
    return s;
}

const doc = (settings = {}, folders = {}, extra = {}) => JSON.stringify({format: 'spawn-settings', version: 1, extensionVersion: '1.3.0', settings, folders, ...extra});
const parsed = (text, s = fresh()) => B.parseBackup(text, s);

test('createBackup: only values that differ from the default, no internal or dev keys', () => {
    const d = JSON.parse(B.createBackup(configured(), '1.3.0'));
    assertEquals(d.format, 'spawn-settings');
    assertEquals(d.version, 1);
    assertEquals(d.extensionVersion, '1.3.0');
    assertEquals(d.settings['menu-height'], '700');
    assertEquals(d.settings['hide-activities-button'], 'true');
    assertEquals(d.settings['position-in-panel'], "'Center'");
    assertEquals(d.settings['hidden-apps'], "['a.desktop', 'b.desktop']");
    for (const k of [...B.BACKUP_EXCLUDED_KEYS, 'dev-mode', 'known-apps', 'new-apps'])
        assert(!(k in d.settings), `${k} must not be in a backup`);
    assertEquals(Object.keys(d.folders), ['f1']);
    assertEquals(d.folders.f1.name, 'Games');
});

test('createBackup: a key set to its default value is left out; a fresh install gives an empty backup', () => {
    const s = fresh();
    s.set('menu-height', s.raw.settings_schema.get_key('menu-height').get_default_value().get_int32());
    assertEquals(JSON.parse(B.createBackup(s, '1')).settings, {});
});

test('round trip: restoring into a fresh instance reproduces every backed-up value and folder', () => {
    const src = configured();
    const r = parsed(B.createBackup(src, '1.3.0'));
    assert(r.ok, r.error);
    const dst = fresh();
    B.applyBackup(dst, r.plan);
    assertEquals(dst.get('menu-height'), 700);
    assertEquals(dst.get('position-in-panel'), 'Center');
    assertEquals(dst.get('hidden-apps'), ['a.desktop', 'b.desktop']);
    assertEquals(dst.get('pinned-apps'), src.get('pinned-apps'));
    assertEquals(dst.folder('f1').name, 'Games');
    assertEquals(dst.folder('f1').pinnedApps, [{id: 'g1.desktop'}, {id: 'g2.desktop'}]);
    assertEquals(dst.get('known-apps'), [], 'internal keys are not restored');
    assertEquals(dst.get('dev-mode'), false);
});

test('unknown and excluded keys are ignored and reported, known ones still apply', () => {
    const r = parsed(doc({'menu-height': '700', 'no-such-key': '1', 'dev-mode': 'true', 'known-apps': "['x']"}));
    assert(r.ok);
    assertEquals([...r.plan.values.keys()], ['menu-height']);
    assertEquals(r.plan.ignored.sort(), ['dev-mode', 'known-apps', 'no-such-key']);
});

test('rejected: not JSON, wrong format, missing / newer version, damaged structure', () => {
    for (const text of ['not json', '[]', '{}', JSON.stringify({format: 'other', version: 1, settings: {}}),
        doc({}, {}, {version: 0}), doc({}, {}, {version: '1'}), doc({}, {}, {version: 2}),
        doc({}, {}, {settings: []}), doc({}, {}, {folders: 'x'})]) {
        assertEquals(parsed(text).ok, false, text);
    }
    assert(parsed(doc({}, {}, {version: 2})).error.includes('newer'));
});

test('rejected: wrong type, bad syntax, out of range, not an enum nick', () => {
    for (const [key, value] of [['menu-height', "'tall'"], ['menu-height', '700 800'], ['menu-height', '99999999'], ['menu-height', 700],
        ['hide-activities-button', '1'], ['position-in-panel', "'Sideways'"], ['hidden-apps', '[1, 2]'], ['pinned-apps', "['x']"]]) {
        const r = parsed(doc({[key]: value}));
        assertEquals(r.ok, false, `${key}=${value}`);
        assert(r.error.includes(key), r.error);
    }
});

test('rejected: an entry list with an entry that has no id', () => {
    assertEquals(parsed(doc({'pinned-apps': "[{'name': 'x'}]"})).ok, false);
    assertEquals(parsed(doc({'directory-shortcuts': "[{'id': ''}]"})).ok, false);
});

test('folders: only those the restored pinned list points at; bad ids and bodies are rejected', () => {
    const pinned = "[{'id': 'f1', 'isFolder': 'true'}]";
    const good = {name: 'G', 'pinned-apps': "[{'id': 'a.desktop'}]"};
    const r = parsed(doc({'pinned-apps': pinned}, {f1: good, stray: good}));
    assert(r.ok);
    assertEquals([...r.plan.folders.keys()], ['f1']);
    assert(r.plan.ignored.includes('folder stray'));
    assertEquals(parsed(doc({'pinned-apps': pinned}, {'../evil': good})).ok, false);
    assertEquals(parsed(doc({'pinned-apps': pinned}, {'a/b': good})).ok, false);
    assertEquals(parsed(doc({'pinned-apps': pinned}, {f1: {name: 5, 'pinned-apps': '[]'}})).ok, false);
    assertEquals(parsed(doc({'pinned-apps': pinned}, {f1: {name: 'G', 'pinned-apps': "[{'x': 'y'}]"}})).ok, false);
    assertEquals(parsed(doc({'pinned-apps': pinned}, {f1: {name: 'x'.repeat(300), 'pinned-apps': '[]'}})).ok, false);
});

test('nothing in the file is executed: GVariant text is data only', () => {
    // a value that looks like code or a shell command is just a string (or a parse error)
    const r = parsed(doc({'hidden-apps': "['$(touch /tmp/pwned)', '`id`', '; rm -rf ~']"}));
    assert(r.ok);
    assertEquals(r.plan.values.get('hidden-apps').recursiveUnpack(), ['$(touch /tmp/pwned)', '`id`', '; rm -rf ~']);
    assertEquals(parsed(doc({'menu-height': 'imports.system.exit(1)'})).ok, false);
});

test('apply: keys absent from the backup return to their defaults; folders not in it are removed', () => {
    const s = configured();
    s.set('menu-height', 500);
    const r = parsed(doc({'menu-height': '650'}));
    const res = B.applyBackup(s, r.plan);
    assertEquals(s.get('menu-height'), 650);
    assertEquals(s.get('hidden-apps'), []);
    assertEquals(s.get('pinned-apps').some(e => e.isFolder === 'true'), false);
    assertEquals(s.folder('f1').name, '', 'the old folder was deleted');
    assertEquals(s.get('known-apps'), ['x.desktop'], 'internal keys are untouched');
    assertEquals(s.get('dev-mode'), true, 'dev-mode is untouched');
    assert(res.written === 1 && res.reset > 50);
});

test('undo: settings.restore(undo) brings back the previous settings and folders', () => {
    const s = configured();
    const before = JSON.parse(B.createBackup(s, '1'));
    const res = B.applyBackup(s, parsed(doc({'menu-height': '650'})).plan);
    assert(JSON.stringify(JSON.parse(B.createBackup(s, '1'))) !== JSON.stringify(before));
    s.restore(res.undo);
    assertEquals(JSON.parse(B.createBackup(s, '1')), before);
    assertEquals(s.folder('f1').pinnedApps.length, 2);
});

test('apply leaves the live settings writable (never in delay mode) and visible to a second instance', () => {
    const backend = Gio.memory_settings_backend_new();
    const schema = source.lookup(SCHEMA_ID, true);
    const s = new SpawnSettings(Gio.Settings.new_full(schema, backend, PATH), source);
    const other = Gio.Settings.new_full(schema, backend, PATH);
    B.applyBackup(s, parsed(doc({'menu-height': '650'})).plan);
    assertEquals(other.get_int('menu-height'), 650);
    s.set('menu-height', 800);
    assertEquals(s.raw.has_unapplied, false);
    assertEquals(other.get_int('menu-height'), 800);
});

test('apply rolls everything back when a value is rejected by GSettings', () => {
    const s = configured();
    const before = JSON.parse(B.createBackup(s, '1'));
    const plan = parsed(doc({'menu-height': '650'})).plan;
    plan.values.set('hidden-apps', GLib.Variant.new_int32(1)); // wrong type: rejected at write time
    let threw = false;
    try {
        B.applyBackup(s, plan);
    } catch {
        threw = true;
    }
    assert(threw);
    assertEquals(JSON.parse(B.createBackup(s, '1')), before);
    assertEquals(s.get('menu-height'), 700);
});

test('files: written with mode 0600, read back; oversize, directory and non-UTF-8 files are refused', () => {
    const path = GLib.build_filenamev([tmp, 'spawn-settings.json']);
    const file = Gio.File.new_for_path(path);
    // an existing, world-readable file is replaced by a private one
    GLib.file_set_contents(path, 'old');
    GLib.chmod(path, 0o644);
    const text = B.createBackup(configured(), '1.3.0');
    B.writeBackupFile(file, text);
    const mode = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777;
    assertEquals(mode.toString(8), '600');
    assertEquals(B.readBackupFile(file), text);

    const big = Gio.File.new_for_path(GLib.build_filenamev([tmp, 'big.json']));
    GLib.file_set_contents(big.get_path(), ' '.repeat(B.MAX_BACKUP_BYTES + 1));
    let msg = '';
    try { B.readBackupFile(big); } catch (e) { msg = e.message; }
    assert(msg.includes('too large'), msg);

    msg = '';
    try { B.readBackupFile(Gio.File.new_for_path(tmp)); } catch (e) { msg = e.message; }
    assert(msg.includes('regular'), msg);

    const bin = Gio.File.new_for_path(GLib.build_filenamev([tmp, 'bin.json']));
    GLib.file_set_contents(bin.get_path(), new Uint8Array([0xff, 0xfe, 0x00]));
    msg = '';
    try { B.readBackupFile(bin); } catch (e) { msg = e.message; }
    assert(msg.includes('not text'), msg);
});

test('describePlan counts settings and folders', () => {
    const r = parsed(doc({'menu-height': '650'}));
    assert(B.describePlan(r.plan).startsWith('The backup holds 1 setting and 0 folders (made with Spawn 1.3.0)'));
});

test('cleanup', () => {
    GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
});

run();
