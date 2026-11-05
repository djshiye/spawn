// Migration tests: pure mapping against the user's real ArcMenu settings (tests/fixtures/
// arcmenu-user.json, generated from docs/research/user-arcmenu-settings.ini), plus a full
// round trip through Gio.Settings on the in-memory backend (never touches dconf).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, assertEquals, run, test} from './harness.js';

function assertThrows(fn) {
    let threw = false;
    try {
        fn();
    } catch {
        threw = true;
    }
    assert(threw, 'expected an exception');
}

GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

const root = GLib.path_get_dirname(GLib.path_get_dirname(import.meta.url.replace('file://', '')));
const {planMigration, describePlan, convertEntries, convertButtonIcon} = await import('../build/migrate/mapping.js');
const {applyMigration, readArcMenuSnapshot, disableArcMenu, spawnDefaults, iconInstalled} = await import('../build/migrate/arcmenu.js');
const {SpawnSettings, FolderSettings, FOLDER_SCHEMA_ID, isValidFolderId} = await import('../build/core/settings.js');
const {planMigration: planFromMapping, INT_RANGES, customisedKeys} = await import('../build/migrate/mapping.js');

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
        'prefs-visible-page', 'recently-installed-apps', 'update-notifier-project-version',
    ]);
});

test('context-menu-items: the user list maps to exactly the same ten items in order', () => {
    const items = item('context-menu-items').value;
    assertSame(items, [
        {id: 'org.gnome.Nautilus.desktop'},
        {id: 'Spawn_Separator', name: 'Separator', icon: 'list-remove-symbolic'},
        {id: 'com.mattjakeman.ExtensionManager.desktop'},
        {id: 'Spawn_Settings', name: 'Spawn Settings', icon: 'Spawn_SpawnIcon'},
        {id: 'Spawn_PanelExtensionSettings', name: 'Panel Extension Settings', icon: 'application-x-addon-symbolic'},
        {id: 'Spawn_Separator', name: 'Separator', icon: 'list-remove-symbolic'},
        {id: 'org.gnome.Settings.desktop'},
        {id: 'Spawn_Separator', name: 'Separator', icon: 'list-remove-symbolic'},
        {id: 'Spawn_ShowDesktop', name: 'Show Desktop', icon: 'computer-symbolic'},
        {id: 'Spawn_PowerOptions', name: 'Power Options', icon: 'system-shutdown-symbolic'},
    ]);
    assert(!plan.warnings.some(w => w.includes('context-menu-items')), 'unexpected context-menu-items warning');
});

test('context-menu-items: ArcMenu settings pages collapse to Spawn_Settings with a warning; other ids follow the shortcut rules', () => {
    const p = planMigration(snap({'context-menu-items': [
        {id: 'ArcMenu_SettingsAbout', name: 'About', icon: 'ArcMenu_ArcMenuIcon'},
        {id: 'ArcMenu_SettingsTheme', name: 'Theme'},
        {id: 'ArcMenu_Settings', name: 'My ArcMenu', icon: 'preferences-system-symbolic'},
        {id: 'ArcMenu_ActivitiesOverview', name: 'Overview', icon: 'view-fullscreen-symbolic'},
        {id: 'ArcMenu_Spacer'},
        {id: 'ArcMenu_NoSuchThing', name: 'x'},
        {id: 'ArcMenu_PowerOff'},
        {id: 'gnome-extensions prefs arcmenu@arcmenu.com', name: 'y'},
    ]}));
    const value = p.items.find(i => i.key === 'context-menu-items').value;
    assertEquals(value.map(e => e.id), ['Spawn_Settings', 'Spawn_ActivitiesOverview', 'Spawn_Spacer', 'Spawn_PowerOff']);
    assertEquals(value[0], {id: 'Spawn_Settings', name: 'Spawn Settings', icon: 'Spawn_SpawnIcon'});
    assertEquals(p.warnings.filter(w => w.includes('settings page')).length, 2);
    assert(p.warnings.some(w => w.includes('more than once')), 'duplicate Spawn_Settings not reported');
    assert(p.warnings.some(w => w.includes("'x'")), 'unknown item not reported');
    assert(!JSON.stringify(value).includes('ArcMenu_'), 'ArcMenu_ id left in the plan');
});

test('context-menu-items: a custom Settings name and icon are kept; a malformed value is skipped', () => {
    let p = planMigration(snap({'context-menu-items': [{id: 'ArcMenu_Settings', name: 'My ArcMenu', icon: 'preferences-system-symbolic'}]}));
    assertEquals(p.items.find(i => i.key === 'context-menu-items').value, [{id: 'Spawn_Settings', name: 'My ArcMenu', icon: 'preferences-system-symbolic'}]);
    p = planMigration(snap({'context-menu-items': 'nope'}));
    assertEquals(p.skipped, [{key: 'context-menu-items', reason: 'unexpected value format'}]);
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
    assertEquals(p.skipped, []);
    assert(p.warnings.some(w => w.includes('gnome-menu') && w.includes('spawn')));
    const unknown = planMigration(snap({'menu-layout': 'gnome-overview'}));
    assertEquals(unknown.skipped, [{key: 'menu-layout', reason: 'Spawn has a single layout'}]);
    assert(!unknown.items.some(i => i.key === 'pinned-apps-display'), 'a layout without pinned items must keep the default');
});

test('pinned-apps-display follows how the ArcMenu layout shows its items', () => {
    const display = layout => planMigration(snap({'menu-layout': layout})).items.find(i => i.key === 'pinned-apps-display')?.value;
    // The user fixture runs the 'arcmenu' layout: a list.
    assertEquals(item('pinned-apps-display').value, 'List');
    assertEquals(item('pinned-apps-display').from, 'menu-layout');
    for (const l of ['arcmenu', 'brisk', 'budgie', 'gnome-menu', 'mint', 'whisker', 'plasma', 'tognee', 'windows', 'zest', 'runner'])
        assertEquals(display(l), 'List', l);
    for (const l of ['11', 'az', 'enterprise', 'insider', 'pop', 'redmond', 'sleek', 'unity', 'chromebook', 'elementary'])
        assertEquals(display(l), 'Grid', l);
    assertEquals(display('no-such-layout'), undefined);
});

test('hotkeys: Super_L + overlay enabled -> super-key-toggle; others -> spawn-hotkey', () => {
    let p = planMigration(snap({'arcmenu-hotkey': ['Super_L', '<Alt>F1']}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, true);
    assertEquals(p.items.find(i => i.key === 'spawn-hotkey').value, ['<Alt>F1']);
    assert(!p.items.some(i => i.key === 'menu-hotkey'), 'old key name still produced');
    p = planMigration(snap({'arcmenu-hotkey': ['<Alt>F1', '<Ctrl>F2', 'Super_R', '<Alt>F1']}));
    assertEquals(p.items.find(i => i.key === 'spawn-hotkey').value, ['<Alt>F1', '<Ctrl>F2']);
    assert(p.warnings.some(w => w.includes('Super_R')), 'bare modifier not reported');
    p = planMigration(snap({'arcmenu-hotkey-overlay-key-enabled': false}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, false);
    p = planMigration(snap({'arcmenu-hotkey': []}));
    assertEquals(p.items.find(i => i.key === 'super-key-toggle').value, false);
});

test('click actions: ArcMenu -> Menu, ContextMenu -> ContextMenu, None -> None', () => {
    const p = planMigration(snap({
        'menu-button-left-click-action': 'ArcMenu',
        'menu-button-right-click-action': 'ContextMenu',
        'menu-button-middle-click-action': 'None',
    }));
    const v = k => p.items.find(i => i.key === k).value;
    assertEquals([v('menu-button-left-click-action'), v('menu-button-right-click-action'), v('menu-button-middle-click-action')], ['Menu', 'ContextMenu', 'None']);
    assert(!p.warnings.some(w => w.includes('click-action')), 'ContextMenu is supported, no warning expected');
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
    assertEquals(settings.get('pinned-apps-display'), 'List');
    assertEquals(settings.get('directory-shortcuts')[0].id, 'Spawn_Home');
    for (const f of plan.folders) {
        const folder = settings.folder(f.uuid);
        assertEquals(folder.name, f.name);
        assertSame(folder.pinnedApps, f.pinnedApps);
    }
    assertEquals(settings.folder('3c2219f1-a114-4e2e-a06c-51fdefa91991').pinnedApps.length, 5);
});


// ---------------------------------------------------------------- mapping edge cases

test('prefs-visible-page is not migrated', () => {
    const p = planMigration(snap({'prefs-visible-page': 5}));
    assert(!p.items.some(i => i.key === 'prefs-visible-page'));
    assert(p.skipped.some(s => s.key === 'prefs-visible-page'));
});

test('sizes outside the schema range are clamped with a warning', () => {
    const p = planMigration(snap({'left-panel-width': 290, 'right-panel-width': 9000, 'menu-height': 500, 'menu-width-adjustment': 5000}));
    const v = k => p.items.find(i => i.key === k).value;
    assertEquals([v('left-panel-width'), v('right-panel-width'), v('menu-height'), v('menu-width-adjustment')], [420, 600, 500, 800]);
    assertEquals(p.warnings.length, 3);
});

test('INT_RANGES matches the <range> of the compiled schema', () => {
    const dir = compileSpawnSchemas();
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
    for (const [key, [min, max]] of Object.entries(INT_RANGES)) {
        const [type, range] = schema.get_key(key).get_range().deepUnpack();
        assertEquals(type, 'range', key);
        assertEquals(range.deepUnpack(), [min, max], key);
    }
});

test('arcmenu-layout-max-frequent-apps: 0 (no limit) becomes 50, out-of-range values are clamped, with a warning', () => {
    const frequent = v => {
        const p = planMigration(snap({'arcmenu-layout-max-frequent-apps': v}));
        return [p.items.find(i => i.key === 'max-frequent-apps').value, p.warnings.length];
    };
    assertEquals(frequent(12), [12, 0]);
    assertEquals(frequent(0), [50, 1]);
    assertEquals(frequent(80), [50, 1]);
    assertEquals(frequent(-3), [1, 1]);
});

test('customisedKeys leaves out ArcMenu bookkeeping keys', () => {
    assertEquals(customisedKeys(snap({'prefs-visible-page': 2, 'recently-installed-apps': [], 'update-notifier-project-version': 70})), []);
    assertEquals(customisedKeys(snap({'prefs-visible-page': 2, 'menu-height': 700})), ['menu-height']);
    assertEquals(customisedKeys(fixture).length, 35);
});

test('invalid folder ids are dropped with a warning, duplicate folders kept once', () => {
    const uuid = '3c2219f1-a114-4e2e-a06c-51fdefa91991';
    const p = planMigration(snap({'pinned-apps': [
        {id: '', name: 'Empty', isFolder: 'true'},
        {id: 'a/b', name: 'Nested', isFolder: 'true'},
        {id: uuid, name: 'Games', isFolder: 'true'},
        {id: uuid, name: 'Games again', isFolder: 'true'},
        {id: 'firefox.desktop'},
    ]}, {folders: {[uuid]: [{id: 'eden.desktop'}]}}));
    assertEquals(p.items.find(i => i.key === 'pinned-apps').value.map(e => e.id), [uuid, 'firefox.desktop']);
    assertEquals(p.folders.map(f => f.uuid), [uuid]);
    assertEquals(p.warnings.filter(w => w.includes('invalid folder id')).length, 2);
    assertEquals(isValidFolderId(''), false);
    assertEquals(isValidFolderId('a/b'), false);
    assertEquals(isValidFolderId(uuid), true);
});

test('an app is kept once: top level first, then folders in order', () => {
    const f1 = 'f1111111-1111-1111-1111-111111111111';
    const f2 = 'f2222222-2222-2222-2222-222222222222';
    const p = planMigration(snap({'pinned-apps': [
        {id: f1, name: 'One', isFolder: 'true'},
        {id: 'a.desktop'},
        {id: 'a.desktop'},
        {id: f2, name: 'Two', isFolder: 'true'},
    ]}, {folders: {
        [f1]: [{id: 'a.desktop'}, {id: 'b.desktop'}, {id: 'b.desktop'}],
        [f2]: [{id: 'b.desktop'}, {id: 'c.desktop'}],
    }}));
    assertEquals(p.items.find(i => i.key === 'pinned-apps').value.map(e => e.id), [f1, 'a.desktop', f2]);
    const byUuid = Object.fromEntries(p.folders.map(f => [f.uuid, f.pinnedApps.map(e => e.id)]));
    assertEquals(byUuid[f1], ['b.desktop']);
    assertEquals(byUuid[f2], ['c.desktop']);
    assertEquals(p.warnings.filter(w => w.includes('more than once')).length, 4);
});

test('separators may repeat in shortcut lists, other ids may not', () => {
    const p = planMigration(snap({'application-shortcuts': [
        {id: 'ArcMenu_Separator'}, {id: 'x.desktop'}, {id: 'ArcMenu_Separator'}, {id: 'x.desktop'},
    ]}));
    assertEquals(p.items.find(i => i.key === 'application-shortcuts').value.map(e => e.id), ['Spawn_Separator', 'x.desktop', 'Spawn_Separator']);
});

test('a button icon that is not bundled is skipped with a warning', () => {
    const icon = 'resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/icon-future-symbolic.svg';
    let p = planMigration(snap({'menu-button-icon': icon}));
    assertEquals(p.items.find(i => i.key === 'menu-button-icon').value, 'icon-future-symbolic.svg');
    p = planFromMapping(snap({'menu-button-icon': icon}), undefined, {iconExists: () => false});
    assert(!p.items.some(i => i.key === 'menu-button-icon'));
    assert(p.skipped.some(s => s.key === 'menu-button-icon') && p.warnings.some(w => w.includes('icon-future')));
    p = planFromMapping(snap({'menu-button-icon': 'start-here-symbolic'}), undefined, {iconExists: () => false});
    assertEquals(p.items.find(i => i.key === 'menu-button-icon').value, 'start-here-symbolic');
});

// ---------------------------------------------------------------- applyMigration (memory backend)

const spawnDir = compileSpawnSchemas();
const spawnSource = Gio.SettingsSchemaSource.new_from_directory(spawnDir, Gio.SettingsSchemaSource.get_default(), false);
const spawnSchema = spawnSource.lookup('org.gnome.shell.extensions.spawn', true);

/** A SpawnSettings over its own fresh in-memory backend (folder() validates ids like production). */
function freshSettings() {
    const backend = Gio.memory_settings_backend_new();
    class Mem extends SpawnSettings {
        folder(uuid) {
            if (!isValidFolderId(uuid))
                throw new Error(`invalid folder id '${uuid}'`);
            return new FolderSettings(uuid, Gio.Settings.new_full(spawnSource.lookup(FOLDER_SCHEMA_ID, true), backend, `/org/gnome/shell/extensions/spawn/folders/${uuid}/`));
        }
    }
    return new Mem(Gio.Settings.new_full(spawnSchema, backend, '/org/gnome/shell/extensions/spawn/'), spawnSource);
}
const planOf = (items, folders = []) => ({items: items.map(([key, value, differs = true]) => ({key, from: key, value, differsFromDefault: differs})), folders, skipped: [], warnings: []});

test('applyMigration: a throwing item reverts the whole batch', () => {
    const settings = freshSettings();
    settings.set('menu-button-icon-size', 33);
    assertEquals(settings.get('migration-done'), false);
    assertThrows(() => applyMigration(planOf([['menu-button-icon-size', 40], ['no-such-key', 1]]), settings));
    assertEquals(settings.get('menu-button-icon-size'), 33);
    assertEquals(settings.get('migration-done'), false);
});

test('applyMigration: an invalid folder id reverts keys and folders written before it', () => {
    const settings = freshSettings();
    const good = '3c2219f1-a114-4e2e-a06c-51fdefa91991';
    const before = settings.get('pinned-apps');
    const plan = planOf([['menu-button-icon-size', 40], ['pinned-apps', [{id: good, name: 'G', isFolder: 'true'}]]], [
        {uuid: good, name: 'G', pinnedApps: [{id: 'a.desktop'}]},
        {uuid: 'a/b', name: 'Bad', pinnedApps: []},
    ]);
    assertThrows(() => applyMigration(plan, settings));
    assertEquals(settings.get('menu-button-icon-size'), 20);
    assertSame(settings.get('pinned-apps'), before);
    assertEquals(settings.folder(good).pinnedApps, []);
    assertEquals(settings.get('migration-done'), false);
});

test('applyMigration: values GSettings rejects are reported, the rest is applied', () => {
    const settings = freshSettings();
    const result = applyMigration(planOf([['left-panel-width', 50], ['menu-button-icon-size', 40]]), settings);
    assertEquals(result.failed, ['left-panel-width']);
    assertEquals(result.written, 1);
    assertEquals(settings.get('left-panel-width'), 420);
    assertEquals(settings.get('menu-button-icon-size'), 40);
    assertEquals(settings.get('migration-done'), true);
});

test('applyMigration: items equal to the defaults reset the key; undo restores everything', () => {
    const settings = freshSettings();
    settings.set('menu-button-icon-size', 33);
    settings.set('menu-height', 700);
    const uuid = '3c2219f1-a114-4e2e-a06c-51fdefa91991';
    settings.set('pinned-apps', [{id: 'old-folder', name: 'Old', isFolder: 'true'}]);
    settings.folder('old-folder').pinnedApps = [{id: 'old.desktop'}];
    const result = applyMigration(planOf([
        ['menu-button-icon-size', 20, false], ['menu-height', 800],
        ['pinned-apps', [{id: uuid, name: 'G', isFolder: 'true'}]],
    ], [{uuid, name: 'G', pinnedApps: [{id: 'a.desktop'}]}]), settings);
    assertEquals([result.written, result.reset, result.failed], [2, 1, []]);
    assert(settings.raw.get_user_value('menu-button-icon-size') === null, 'default-equal value was written');
    assertEquals(settings.get('menu-height'), 800);
    assertEquals(settings.folder(uuid).pinnedApps, [{id: 'a.desktop'}]);
    assertEquals(settings.folder('old-folder').pinnedApps, []);

    settings.restore(result.undo);
    assertEquals(settings.get('menu-button-icon-size'), 33);
    assertEquals(settings.get('menu-height'), 700);
    assertEquals(settings.get('migration-done'), false);
    assertEquals(settings.get('pinned-apps')[0].id, 'old-folder');
    assertEquals(settings.folder('old-folder').pinnedApps, [{id: 'old.desktop'}]);
    assertEquals(settings.folder(uuid).pinnedApps, []);
});

test('the user fixture applies cleanly against the real defaults: nothing rejected, equal-to-default keys left unset', () => {
    const settings = freshSettings();
    const p = planMigration(fixture, spawnDefaults(settings), {iconExists: v => iconInstalled(root, v)});
    const result = applyMigration(p, settings);
    assertEquals(result.failed, []);
    assertEquals(result.written + result.reset, p.items.length);
    assert(result.reset > 0, 'expected some keys equal to the defaults');
    for (const i of p.items.filter(i => !i.differsFromDefault))
        assert(settings.raw.get_user_value(i.key) === null, `${i.key} was written although equal to the default`);
    for (const i of p.items.filter(i => i.differsFromDefault))
        assertSame(settings.get(i.key), i.value, i.key);
    assertEquals(p.warnings, []);
});

test('SpawnSettings.folder rejects invalid ids; set() reports rejected values', () => {
    const settings = new SpawnSettings(Gio.Settings.new_full(spawnSchema, Gio.memory_settings_backend_new(), '/org/gnome/shell/extensions/spawn/'), spawnSource);
    assertThrows(() => settings.folder(''));
    assertThrows(() => settings.folder('a/b'));
    assertEquals(settings.set('left-panel-width', 10), false);
    assertEquals(settings.set('search-entry-location', 'Auto'), true);
    assertEquals(settings.set('spawn-hotkey', ['<Super>space']), true);
});

test('disableArcMenu is exported (not invoked: would talk to a real shell)', () => {
    assert(typeof disableArcMenu === 'function');
});

run();
