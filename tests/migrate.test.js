// Migration tests: pure mapping against the user's real ArcMenu settings (tests/fixtures/
// arcmenu-user.json, generated from docs/research/user-arcmenu-settings.ini), plus a full
// round trip through Gio.Settings on the in-memory backend (never touches dconf).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, assertEquals, run, test} from './harness.js';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const root = GLib.path_get_dirname(GLib.path_get_dirname(import.meta.url.replace('file://', '')));
const {planMigration, describePlan, convertEntries, convertButtonIcon} = await import('../build/migrate/mapping.js');
const {applyMigration, readArcMenuSnapshot, disableArcMenu} = await import('../build/migrate/arcmenu.js');
const {SpawnSettings} = await import('../build/core/settings.js');

function loadFixture() {
    const [, bytes] = Gio.File.new_for_path(`${root}/tests/fixtures/arcmenu-user.json`).load_contents(null);
    return JSON.parse(new globalThis.TextDecoder().decode(bytes));
}

// Order-insensitive deep comparison (GVariant dictionaries have no stable key order).
function canon(v) {
    if (Array.isArray(v))
        return v.map(canon);
    if (v !== null && typeof v === 'object')
        return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
    return v;
}
const assertSame = (a, b, msg) => assertEquals(canon(a), canon(b), msg);

const fixture = loadFixture();
const plan = planMigration(fixture);
const item = key => plan.items.find(i => i.key === key);

test('fixture has the 38 user-set keys and 3 folders', () => {
    assertEquals(Object.keys(fixture.values).length, 38);
    assertEquals(Object.keys(fixture.folders).length, 3);
});

test('every user-set key is mapped or skipped with a reason', () => {
    const accounted = new Map();
    for (const i of plan.items)
        for (const f of i.from.split(', '))
            accounted.set(f, 'item');
    for (const s of plan.skipped) {
        assert(s.reason.length > 0, `empty reason for ${s.key}`);
        assert(!accounted.has(s.key), `${s.key} both mapped and skipped`);
        accounted.set(s.key, 'skipped');
    }
    for (const key of Object.keys(fixture.values))
        assert(accounted.has(key), `${key} neither mapped nor skipped`);
    print(`    ${plan.items.length} items, ${plan.skipped.length} skipped, ${plan.warnings.length} warnings`);
});

test('skipped keys of the fixture', () => {
    assertEquals(plan.skipped.map(s => s.key).sort(), [
        'context-menu-items', 'menu-layout', 'recently-installed-apps', 'update-notifier-project-version',
    ]);
});

test('no duplicate target keys', () => {
    const keys = plan.items.map(i => i.key);
    assertEquals(new Set(keys).size, keys.length);
});

test('activities button: hidden by ArcMenu default -> hide-activities-button true', () => {
    assertEquals(item('hide-activities-button').value, true);
});

test('menu button icon resource URI -> bundled file name that exists', () => {
    const icon = item('menu-button-icon').value;
    assertEquals(icon, 'distro-fedora-symbolic.svg');
    assert(Gio.File.new_for_path(`${root}/data/icons/${icon}`).query_exists(null), 'bundled icon is missing');
});

test('plain copies and tuples', () => {
    assertEquals(item('menu-button-icon-size').value, 30);
    assertEquals(item('search-entry-border-radius').value, [true, 25]);
    assertEquals(item('menu-button-border-width').value, [false, 3]);
    assertEquals(item('power-options').value[0], [0, false]);
    assertEquals(item('menu-background-color').value, 'rgba(48,48,49,0.98)');
});

test('shortcut ids are rewritten to Spawn_', () => {
    assertEquals(item('directory-shortcuts').value, [{id: 'Spawn_Home', name: 'Home', icon: 'Spawn_Home'}]);
    const apps = item('application-shortcuts').value;
    assertEquals(apps.map(e => e.id), ['Spawn_Software', 'Spawn_Separator', 'org.gnome.Ptyxis.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Settings.desktop']);
    assert(!JSON.stringify(plan.items).includes('ArcMenu_'), 'ArcMenu_ id left in the plan');
});

test('pinned apps and the three folders are imported with their apps', () => {
    const pinned = item('pinned-apps').value;
    assertEquals(pinned.length, 6);
    assertEquals(plan.folders.map(f => f.name).sort(), ['Games', 'Internet', 'Tarky']);
    const byName = Object.fromEntries(plan.folders.map(f => [f.name, f]));
    assertEquals(byName.Games.uuid, '3c2219f1-a114-4e2e-a06c-51fdefa91991');
    assertEquals(byName.Games.pinnedApps.map(e => e.id), ['eden.desktop', 'com.heroicgameslauncher.hgl.desktop', 'com.usebottles.bottles.desktop', 'org.prismlauncher.PrismLauncher.desktop', 'com.discordapp.Discord.desktop']);
    assertEquals(byName.Internet.pinnedApps.map(e => e.id), ['slack.desktop', 'Zoom.desktop', 'code.desktop', 'obsidian.desktop']);
    assertEquals(byName.Tarky.pinnedApps.map(e => e.id), ['SPT - Server.desktop', 'SPT - Launcher.desktop']);
    for (const f of plan.folders)
        assert(pinned.some(e => e.id === f.uuid && e.isFolder === 'true'), `folder ${f.name} missing from pinned-apps`);
});

test('describePlan lists import, skipped and warnings', () => {
    const lines = describePlan(plan).join('\n');
    assert(lines.includes('Will import') && lines.includes('Skipped') && lines.includes('menu-layout'));
});

test('differsFromDefault uses the supplied Spawn defaults', () => {
    const p = planMigration(fixture, {'menu-button-icon-size': 30, 'menu-height': 1});
    assertEquals(p.items.find(i => i.key === 'menu-button-icon-size').differsFromDefault, false);
    assertEquals(p.items.find(i => i.key === 'menu-button-icon').differsFromDefault, true);
});

const snap = (values, extra = {}) => ({values, defaults: fixture.defaults, folders: {}, ...extra});

test('untouched ArcMenu migrates nothing but the Activities default', () => {
    const p = planMigration(snap({}));
    assertEquals(p.items.map(i => i.key), ['hide-activities-button']);
    assertEquals(p.skipped, []);
});

test('show-activities-button is inverted', () => {
    assertEquals(planMigration(snap({'show-activities-button': true})).items[0].value, false);
});

test('other layouts fall back to spawn with a warning', () => {
    const p = planMigration(snap({'menu-layout': 'gnome-menu'}));
    assertEquals(p.skipped, [{key: 'menu-layout', reason: 'Spawn has a single layout'}]);
    assert(p.warnings.some(w => w.includes('gnome-menu') && w.includes('spawn')));
});

test('hotkeys: Super_L + overlay enabled -> super-key-toggle; others -> menu-hotkey', () => {
    let p = planMigration(snap({'arcmenu-hotkey': ['Super_L', '<Alt>F1']}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, true);
    assertEquals(p.items.find(i => i.key === 'menu-hotkey').value, ['<Alt>F1']);
    p = planMigration(snap({'arcmenu-hotkey-overlay-key-enabled': false}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, false);
    p = planMigration(snap({'arcmenu-hotkey': []}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, false);
});

test('click actions: ArcMenu -> Menu, ContextMenu -> None (with warning)', () => {
    const p = planMigration(snap({
        'menu-button-left-click-action': 'ArcMenu',
        'menu-button-right-click-action': 'ContextMenu',
        'menu-button-middle-click-action': 'None',
    }));
    const v = k => p.items.find(i => i.key === k).value;
    assertEquals([v('menu-button-left-click-action'), v('menu-button-right-click-action'), v('menu-button-middle-click-action')], ['Menu', 'None', 'None']);
    assert(p.warnings.some(w => w.includes('right-click')));
});

test('renamed keys', () => {
    const p = planMigration(snap({'searchbar-default-bottom-location': 'Top', 'arcmenu-layout-max-frequent-apps': 12}));
    assertEquals(p.items.find(i => i.key === 'search-entry-location').value, 'Top');
    assertEquals(p.items.find(i => i.key === 'max-frequent-apps').value, 12);
});

test('invalid values are skipped, not copied', () => {
    const p = planMigration(snap({'menu-height': 'tall', 'default-menu-view': 'Nope', 'power-options': [[0, 'x']]}));
    assertEquals(p.skipped.map(s => s.key).sort(), ['default-menu-view', 'menu-height', 'power-options']);
});

test('ArcMenu-only entries are dropped with warnings; button icon variants', () => {
    const warnings = [];
    const out = convertEntries([
        {id: 'ArcMenu_Settings', name: 'ArcMenu Settings', icon: 'ArcMenu_ArcMenuIcon'},
        {id: 'gnome-extensions prefs arcmenu@arcmenu.com', name: 'x'},
        {id: 'ArcMenu_PowerOff', name: 'Power Off', icon: 'ArcMenu_ArcMenuIcon'},
    ], 'test', warnings);
    assertEquals(out, [{id: 'Spawn_PowerOff', name: 'Power Off'}]);
    assertEquals(warnings.length, 2);
    assertEquals(convertButtonIcon('/home/u/i.png'), '/home/u/i.png');
    assertEquals(convertButtonIcon('start-here-symbolic'), 'start-here-symbolic');
    assertEquals(convertButtonIcon('resource:///other/thing.svg'), null);
});

// ---------------------------------------------------------------- Gio round trip (memory backend)

function compileSpawnSchemas() {
    const dir = GLib.dir_make_tmp('spawn-migrate-XXXXXX');
    for (const f of ['org.gnome.shell.extensions.spawn.gschema.xml']) {
        const src = Gio.File.new_for_path(`${root}/schemas/${f}`);
        src.copy(Gio.File.new_for_path(`${dir}/${f}`), Gio.FileCopyFlags.OVERWRITE, null, null);
    }
    const proc = Gio.Subprocess.new(['glib-compile-schemas', '--strict', dir], Gio.SubprocessFlags.STDERR_PIPE);
    proc.wait(null);
    assert(proc.get_successful(), 'glib-compile-schemas failed');
    return dir;
}

test('round trip: write fixture to ArcMenu schema, read snapshot, plan, apply', () => {
    // 1. put the fixture into the (in-memory) ArcMenu settings through the bundled schema.
    const arcSource = Gio.SettingsSchemaSource.new_from_directory(`${root}/data/migration/arcmenu`, null, false);
    const arcSchema = arcSource.lookup('org.gnome.shell.extensions.arcmenu', false);
    const arcFolderSchema = arcSource.lookup('org.gnome.shell.extensions.arcmenu.pinned-apps-folders', false);
    const arc = Gio.Settings.new_full(arcSchema, null, '/org/gnome/shell/extensions/arcmenu/');
    for (const [key, value] of Object.entries(fixture.values)) {
        const type = arcSchema.get_key(key).get_value_type();
        arc.set_value(key, new GLib.Variant(type.dup_string(), value));
    }
    for (const [uuid, apps] of Object.entries(fixture.folders)) {
        const f = Gio.Settings.new_full(arcFolderSchema, null, `/org/gnome/shell/extensions/arcmenu/pinned-apps-folders/${uuid}/`);
        f.set_value('pinned-apps', new GLib.Variant('aa{ss}', apps));
    }

    // 2. read the snapshot back through the production reader.
    const snapshot = readArcMenuSnapshot(root);
    assert(snapshot !== null, 'snapshot is null');
    assertEquals(Object.keys(snapshot.values).sort(), Object.keys(fixture.values).sort());
    assertSame(snapshot.folders, fixture.folders);
    assertEquals(JSON.stringify(canon(planMigration(snapshot))) === JSON.stringify(canon(plan)), true, 'plan from the live snapshot differs from the fixture plan');
    assertSame(snapshot.values, fixture.values);

    // 3. apply to a Spawn settings object on the same memory backend.
    const dir = compileSpawnSchemas();
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
    const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, '/org/gnome/shell/extensions/spawn/'), source);
    applyMigration(plan, settings);
    assertEquals(settings.get('migration-done'), true);
    assertEquals(settings.get('hide-activities-button'), true);
    assertEquals(settings.get('menu-button-icon'), 'distro-fedora-symbolic.svg');
    assertEquals(settings.get('menu-button-icon-size'), 30);
    assertEquals(settings.get('search-entry-border-radius'), [true, 25]);
    assertEquals(settings.get('pinned-apps').length, 6);
    assertEquals(settings.get('directory-shortcuts')[0].id, 'Spawn_Home');
    for (const f of plan.folders) {
        const folder = settings.folder(f.uuid);
        assertEquals(folder.name, f.name);
        assertSame(folder.pinnedApps, f.pinnedApps);
    }
    assertEquals(settings.folder('3c2219f1-a114-4e2e-a06c-51fdefa91991').pinnedApps.length, 5);
});

test('disableArcMenu is exported (not invoked: would talk to a real shell)', () => {
    assert(typeof disableArcMenu === 'function');
});

run();
