// Theme presets: parsing / validation, comparison with the current values, the writes that applying one
// performs, list edits, and a round trip through Gio.Settings on the in-memory backend (never touches dconf).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, assertEquals, run, test} from './harness.js';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const tmp = GLib.dir_make_tmp('spawn-presets-test-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn.gschema.xml']);
Gio.File.new_for_path(xml).copy(Gio.File.new_for_path(GLib.build_filenamev([tmp, 'schema.gschema.xml'])), Gio.FileCopyFlags.OVERWRITE, null, null);
const [ok, , err] = GLib.spawn_command_line_sync(`glib-compile-schemas ${tmp}`);
if (!ok)
    throw new Error(`glib-compile-schemas failed: ${err}`);
const source = Gio.SettingsSchemaSource.new_from_directory(tmp, Gio.SettingsSchemaSource.get_default(), false);
GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);

const {
    colorsEqual, findPreset, moveItem, parsePreset, parsePresets, presetColors, presetFromColors, presetWrites, removeItem,
    renameItem, serializePreset, serializePresets, uniqueName,
} = await import('../build/theme/presets.js');
const {SpawnSettings} = await import('../build/core/settings.js');

const fresh = () => new SpawnSettings(Gio.Settings.new_full(schema, Gio.memory_settings_backend_new(), '/org/gnome/shell/extensions/spawn/'), source);
const defaults = fresh().get('menu-themes');
const ARC = ['ArcMenu Style', 'rgba(48,48,49,0.98)', 'rgb(223,223,223)', 'rgb(60,60,60)', '1', '14', '11',
    'rgba(255,255,255,0.1)', 'rgb(21,83,158)', 'rgb(255,255,255)', 'rgb(25,98,163)', 'rgb(255,255,255)'];

const KEYS = [
    ['background', 'menu-background-color'], ['foreground', 'menu-foreground-color'], ['border', 'menu-border-color'],
    ['borderWidth', 'menu-border-width'], ['borderRadius', 'menu-border-radius'], ['fontSize', 'menu-font-size'],
    ['separator', 'menu-separator-color'], ['itemHoverBg', 'menu-item-hover-bg-color'], ['itemHoverFg', 'menu-item-hover-fg-color'],
    ['itemActiveBg', 'menu-item-active-bg-color'], ['itemActiveFg', 'menu-item-active-fg-color'],
];
const current = settings => Object.fromEntries(KEYS.map(([field, key]) => [field, settings.get(key)]));

test('schema default: ArcMenu\'s four built-in themes, 12 strings each', () => {
    assertEquals(defaults.map(t => t[0]), ['ArcMenu Style', 'Simply Dark', 'Dark Blue', 'Light Blue']);
    for (const t of defaults)
        assertEquals(t.length, 12);
    assertEquals(defaults[0], ARC);
});

test('the built-in themes parse and serialize back to the same strings', () => {
    const {presets, warnings} = parsePresets(defaults);
    assertEquals(warnings, []);
    assertEquals(presets.length, 4);
    assertEquals(serializePresets(presets), defaults);
    assertEquals(presets[1].background, 'rgba(28,28,28,0.98)');
    assertEquals([presets[2].borderWidth, presets[2].borderRadius, presets[2].fontSize], [1, 14, 11]);
    for (const p of presets)
        assertEquals(parsePreset(serializePreset(p)).preset, p);
});

test('malformed entries are rejected with a reason', () => {
    const bad = {
        'not a list': 'x',
        'too short': ARC.slice(0, 11),
        'too long': [...ARC, 'x'],
        'non-string field': [...ARC.slice(0, 4), 1, ...ARC.slice(5)],
        'empty name': ['   ', ...ARC.slice(1)],
        'unsafe colour': [ARC[0], 'red; background: url(x)', ...ARC.slice(2)],
        'empty colour': [...ARC.slice(0, 7), '', ...ARC.slice(8)],
        'width not numeric': [...ARC.slice(0, 4), 'wide', ...ARC.slice(5)],
        'radius float': [...ARC.slice(0, 5), '1.5', ...ARC.slice(6)],
    };
    for (const [what, entry] of Object.entries(bad)) {
        const r = parsePreset(entry);
        assert(r.preset === undefined && r.error.length > 0, what);
    }
    const {presets, warnings} = parsePresets([ARC, bad['too short'], ['Named', 'x'], ARC]);
    assertEquals(presets.length, 2);
    assertEquals(warnings.length, 2);
    assert(warnings[1].includes("'Named'") && warnings[1].includes('#3'), warnings[1]);
    assertEquals(parsePresets(null).presets, []);
});

test('numbers outside the prefs ranges are clamped, not dropped', () => {
    const r = parsePreset([...ARC.slice(0, 4), '99', '-4', '2', ...ARC.slice(7)]);
    assertEquals([r.preset.borderWidth, r.preset.borderRadius, r.preset.fontSize], [5, 0, 8]);
});

test('comparison looks at ALL eleven fields (colours ignoring case and spaces)', () => {
    const {presets} = parsePresets(defaults);
    const base = presetColors(presets[0]);
    assertEquals(findPreset(presets, base), 0);
    assertEquals(findPreset(presets, presetColors(presets[3])), 3);
    assert(colorsEqual(base, {...base, background: 'RGBA( 48, 48, 49, 0.98 )'}));
    for (const [field] of KEYS) {
        const changed = {...base, [field]: typeof base[field] === 'number' ? base[field] + 1 : 'rgb(1,2,3)'};
        assertEquals(findPreset(presets, changed), -1, `${field} must matter`);
    }
    // the last field (itemActiveFg) in particular: ArcMenu's comparison missed one element
    assertEquals(findPreset(presets, {...base, itemActiveFg: 'rgb(0,0,0)'}), -1);
});

test('applying a preset writes the override switch and the eleven keys, never menu-themes', () => {
    const {presets} = parsePresets(defaults);
    const writes = presetWrites(presets[3]);
    assertEquals(writes.length, 12);
    assertEquals(writes[0], ['override-menu-theme', true]);
    assertEquals(writes.slice(1).map(w => w[0]).sort(), KEYS.map(k => k[1]).sort());
    assert(!writes.some(w => w[0] === 'menu-themes'));
});

test('round trip through GSettings: apply -> the current values match that preset, menu-themes untouched', () => {
    const settings = fresh();
    const {presets} = parsePresets(settings.get('menu-themes'));
    // untouched defaults are "ArcMenu Style"
    assertEquals(findPreset(presets, current(settings)), 0);
    for (let i = 0; i < presets.length; i++) {
        settings.batch(tx => {
            for (const [key, value] of presetWrites(presets[i]))
                assert(tx.set(key, value), `${key} rejected`);
        });
        assertEquals(settings.get('override-menu-theme'), true);
        assertEquals(findPreset(presets, current(settings)), i, presets[i].name);
    }
    assertEquals(settings.raw.get_user_value('menu-themes'), null);
    // saving the current values as a preset: it then equals itself and the list round-trips
    settings.set('menu-border-radius', 20);
    const colors = current(settings);
    assertEquals(findPreset(presets, colors), -1);
    const saved = presetFromColors(uniqueName(presets, 'Dark Blue'), colors);
    assertEquals(saved.name, 'Dark Blue 2');
    settings.set('menu-themes', serializePresets([...presets, saved]));
    const reread = parsePresets(settings.get('menu-themes')).presets;
    assertEquals(reread.length, 5);
    assertEquals(findPreset(reread, current(settings)), 4);
});

test('list edits: rename, delete, reorder (immutable)', () => {
    const list = parsePresets(defaults).presets;
    const names = l => l.map(p => p.name);
    assertEquals(names(moveItem(list, 0, 1)), ['Simply Dark', 'ArcMenu Style', 'Dark Blue', 'Light Blue']);
    assertEquals(names(moveItem(list, 3, 2)), ['ArcMenu Style', 'Simply Dark', 'Light Blue', 'Dark Blue']);
    assertEquals(names(moveItem(list, 0, -1)), names(list));
    assertEquals(names(moveItem(list, 3, 4)), names(list));
    assertEquals(names(removeItem(list, 1)), ['ArcMenu Style', 'Dark Blue', 'Light Blue']);
    assertEquals(renameItem(list, 2, '  Navy ')[2].name, 'Navy');
    assertEquals(names(renameItem(list, 2, '   ')), names(list));
    assertEquals(names(list).length, 4);
    assertEquals(uniqueName(list, 'dark blue'), 'dark blue 2');
    assertEquals(uniqueName(list, ''), 'Custom');
});

run();
