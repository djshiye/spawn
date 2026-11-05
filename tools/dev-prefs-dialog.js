// Opens one prefs dialog standalone (for screenshots) inside the dev-prefs sandbox.
// Usage: gjs -m tools/dev-prefs-dialog.js <build dir> <icons|icons-system|apps|folder|shortcut|prompt|new-folder|presets>
import System from 'system';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [build, which] = System.programArgs;
const {SpawnSettings} = await import(`file://${build}/core/settings.js`);
const {openIconPicker} = await import(`file://${build}/prefs/iconPicker.js`);
const {chooseApplication, openFolderEditor, promptText} = await import(`file://${build}/prefs/lists.js`);
const {captureShortcut} = await import(`file://${build}/prefs/shortcutDialog.js`);
const {openPresetManager} = await import(`file://${build}/prefs/presets.js`);

const source = Gio.SettingsSchemaSource.new_from_directory(`${build}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, '/org/gnome/shell/extensions/spawn/'), source);

const app = new Adw.Application({application_id: 'io.github.djshiye.Spawn.DevDialog'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: 'Spawn', default_width: 900, default_height: 700});
    window.add(new Adw.PreferencesPage());
    window.present();
    const ctx = {settings, extensionDir: build, window, metadata: {}};
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        switch (which) {
        case 'icons': openIconPicker(ctx); break;
        case 'icons-system': {
            const picker = openIconPicker(ctx);
            picker.sourceBox.selected = 3;
            picker.search.text = 'start';
            break;
        }
        case 'apps': chooseApplication(ctx, new Set(), id => globalThis.print(`picked ${id}`)); break;
        case 'folder': openFolderEditor(ctx, '3c2219f1-a114-4e2e-a06c-51fdefa91991', 'Games'); break;
        case 'shortcut': void captureShortcut(window, '<Super>space'); break;
        case 'prompt': promptText(ctx, 'Rename Folder', 'Games', 'Rename', t => globalThis.print(t)); break;
        case 'presets': openPresetManager(ctx); break;
        default: globalThis.print(`unknown dialog ${which}`);
        }
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
