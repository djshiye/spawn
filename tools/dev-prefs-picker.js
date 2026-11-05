// Run by tools/dev-prefs.sh --picker-test INSIDE the sandbox (headless GNOME Shell + sandbox dconf): drives the icon
// picker like a user (switch the source to System, search "start-here", pick it) and checks what reached dconf, which
// is read by a SEPARATE process. Also covers a bundled icon, the style filter, a file path and the current-icon highlight.
// Usage: gjs -m tools/dev-prefs-picker.js <build dir>      (throws, exit != 0, when a check fails)
import System from 'system';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const build = System.programArgs[0];
const {SpawnSettings} = await import(`file://${build}/core/settings.js`);
const {openIconPicker, createIconRow} = await import(`file://${build}/prefs/iconPicker.js`);

const PATH = '/org/gnome/shell/extensions/spawn/';
const source = Gio.SettingsSchemaSource.new_from_directory(`${build}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, PATH), source);

const dconfRead = key => {
    Gio.Settings.sync();
    const [, out] = GLib.spawn_command_line_sync(`dconf read ${PATH}${key}`);
    return new globalThis.TextDecoder().decode(out).trim();
};
const sleep = ms => {
    let done = false;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        done = true;
        return GLib.SOURCE_REMOVE;
    });
    while (!done)
        GLib.MainContext.default().iteration(true);
};
const names = picker => Array.from({length: picker.model.get_n_items()}, (_, i) => picker.model.get_item(i).string);

let failures = 0;
function check(what, ok, detail = '') {
    globalThis.print(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
    if (!ok)
        failures++;
}

const app = new Adw.Application({application_id: 'io.github.djshiye.Spawn.DevPicker'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: 'Spawn', default_width: 900, default_height: 700});
    const page = new Adw.PreferencesPage();
    window.add(page);
    window.present();
    const ctx = {settings, extensionDir: build, window, metadata: {}};
    const group = new Adw.PreferencesGroup();
    group.add(createIconRow(ctx)); // the Button page's row must build and track the value too
    page.add(group);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        try {
            run(ctx);
        } catch (e) {
            globalThis.print(`FAIL exception: ${e}\n${e.stack}`);
            failures++;
        }
        globalThis.print(failures > 0 ? `${failures} check(s) failed` : 'icon picker checks passed');
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

// Names (tooltips) of the realised grid cells that carry the "current icon" mark (the `card` class).
function markedCells(picker) {
    sleep(300); // let the grid lay out and bind its visible cells
    const found = [];
    const walk = widget => {
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            if (child.has_css_class('card'))
                found.push(child.get_tooltip_text());
            walk(child);
        }
    };
    walk(picker.grid);
    return found;
}

function run(ctx) {
    // 1. System: switch the source, search, pick.
    settings.set('menu-button-icon', 'icon-apps-symbolic.svg');
    let picker = openIconPicker(ctx);
    check('picker opens on the source of the current icon (Spawn)', picker.sourceBox.selected === 1, `selected=${picker.sourceBox.selected}`);
    check('Spawn source lists only icon-*.svg', names(picker).length > 0 && names(picker).every(n => n.startsWith('icon-') && n.endsWith('.svg')), `${names(picker).length} items`);
    check('current icon is marked in the grid', markedCells(picker).join() === 'icon-apps-symbolic', markedCells(picker).join());

    const t0 = GLib.get_monotonic_time();
    picker.sourceBox.selected = 3;
    const system = names(picker);
    globalThis.print(`System source: ${system.length} icons, ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(0)} ms to load`);
    check('System source lists theme icons (no bundled .svg)', system.length > 500 && system.every(n => !n.endsWith('.svg')));
    picker.search.text = 'start-here';
    check('search is debounced (list unchanged immediately)', names(picker).length === system.length);
    sleep(400);
    const found = names(picker);
    check('search filters the system icons', found.length > 0 && found.length < 30 && found.every(n => n.includes('start-here')), found.join(','));
    picker.styleBox.selected = 1;
    check('Symbolic style works with System', names(picker).length > 0 && names(picker).every(n => n.includes('-symbolic')), names(picker).join(','));
    picker.styleBox.selected = 2;
    check('Full colour style works with System', names(picker).length > 0 && names(picker).every(n => !n.includes('-symbolic')), names(picker).join(','));
    picker.styleBox.selected = 0;
    const index = names(picker).indexOf('start-here');
    check('"start-here" is listed', index >= 0);
    picker.grid.emit('activate', index);
    check('settings value is the themed name', settings.get('menu-button-icon') === 'start-here', settings.get('menu-button-icon'));
    check('dconf has the themed name', dconfRead('menu-button-icon') === "'start-here'", dconfRead('menu-button-icon'));

    // 2. Reopened on the System source with the current icon highlighted; pick a bundled distro icon.
    picker = openIconPicker(ctx);
    check('picker reopens on System for a themed name', picker.sourceBox.selected === 3);
    check('current themed icon is marked', markedCells(picker).join() === 'start-here', markedCells(picker).join());
    picker.sourceBox.selected = 2;
    picker.search.text = 'fedora';
    sleep(400);
    const distros = names(picker);
    check('Distros source lists only distro-*.svg', distros.length > 0 && distros.every(n => n.startsWith('distro-') && n.endsWith('.svg')), distros.join(','));
    picker.styleBox.selected = 1;
    const fedora = names(picker).indexOf('distro-fedora-symbolic.svg');
    check('Symbolic filter keeps distro-fedora-symbolic.svg', fedora >= 0);
    picker.grid.emit('activate', fedora);
    check('dconf has the bundled file name', dconfRead('menu-button-icon') === "'distro-fedora-symbolic.svg'", dconfRead('menu-button-icon'));

    // 3. All source combines everything; an absolute path (what the file chooser stores) opens the picker fine.
    picker = openIconPicker(ctx);
    picker.sourceBox.selected = 0;
    picker.search.text = 'fedora';
    sleep(400);
    const all = names(picker);
    check('All source mixes bundled and system icons', all.some(n => n.endsWith('.svg')) && all.some(n => !n.endsWith('.svg')), `${all.length} items`);
    picker.dialog.close();
    settings.set('menu-button-icon', `${build}/data/icons/distro-fedora-symbolic.svg`);
    picker = openIconPicker(ctx);
    check('a file path value opens the picker on All icons', picker.sourceBox.selected === 0 && picker.model.get_n_items() > 100, `${picker.model.get_n_items()} items`);
    picker.dialog.close();
    check('dconf keeps the file path', dconfRead('menu-button-icon') === `'${build}/data/icons/distro-fedora-symbolic.svg'`);
    settings.set('menu-button-icon', 'icon-apps-symbolic.svg');
}

app.run([]);
if (failures > 0)
    throw new Error(`JS ERROR: ${failures} icon picker check(s) failed`);
